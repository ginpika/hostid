/**
 * 邮件落库与投递服务
 * 站内发信（POST /emails）与入站 SMTP 共用 createMailboxCopy，避免两处各写一份 prisma.email.create。
 * 发信流程在单个事务内写入“发件箱副本 + 全部站内收件副本 + 新附件记录”，
 * 事务提交后才触发外部 SMTP 投递，外部投递失败不会回滚已落库的邮件。
 */
import type { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { AppError } from '../middleware/error'
import { getAttachmentPath } from '../config/paths'
import { FOLDER_INBOX, FOLDER_SENT, USERNAME_PATTERN, type MailboxFolder } from '../lib/domain-constants'
import { EMAIL_WITH_ATTACHMENTS_INCLUDE, toEmailDto } from '../lib/email-dto'
import { getSettings } from './settings'
import { extractEmailExcerpt } from './mail-excerpt'
import { sendEmail } from './mailer'

type RecipientType = 'to' | 'cc' | 'bcc'

interface Recipient {
  email: string
  type: RecipientType
}

/** 已落盘的上传文件（multer 文件的最小子集，避免服务层依赖 multer 类型） */
interface StoredUpload {
  filename: string
  originalname: string
  mimetype: string
  size: number
  path: string
}

export interface OutgoingEmailCommand {
  senderId: string
  /** 原始收件人输入：可含逗号/中文逗号分隔的多个地址，也可只写用户名（自动补全本站域名） */
  to: string[]
  cc: string[]
  bcc: string[]
  subject: string
  body: string
  uploads: StoredUpload[]
  referencedAttachmentIds: string[]
}

interface MailboxCopyInput {
  folder: MailboxFolder
  userId: string
  from: string
  fromName: string | null
  /** 列表中展示的“收件人”摘要文本 */
  to: string
  toList: string[]
  ccList: string[]
  bccList: string[]
  subject: string
  body: string
  summary: string | null
  isRead?: boolean
  attachmentIds: string[]
}

/** 在指定用户的某个文件夹中创建一封邮件副本 */
export function createMailboxCopy(db: Prisma.TransactionClient, input: MailboxCopyInput) {
  return db.email.create({
    data: {
      from: input.from,
      fromName: input.fromName,
      to: input.to,
      toList: JSON.stringify(input.toList),
      ccList: JSON.stringify(input.ccList),
      bccList: JSON.stringify(input.bccList),
      subject: input.subject,
      body: input.body,
      summary: input.summary,
      folder: input.folder,
      isRead: input.isRead ?? false,
      userId: input.userId,
      attachments: {
        create: input.attachmentIds.map(attachmentId => ({ attachmentId }))
      }
    },
    include: EMAIL_WITH_ATTACHMENTS_INCLUDE
  })
}

/** 解析一段收件人输入；非法用户名的片段会被忽略 */
function parseRecipients(input: string, type: RecipientType): Recipient[] {
  const recipients: Recipient[] = []
  const parts = input.split(/[,，]/).map(s => s.trim()).filter(Boolean)

  for (const part of parts) {
    const hasDomain = part.includes('@')
    const email = hasDomain ? part.toLowerCase() : `${part}@${getSettings().mailDomain}`
    const username = hasDomain ? part.split('@')[0] : part

    if (USERNAME_PATTERN.test(username)) {
      recipients.push({ email, type })
    }
  }

  return recipients
}

function collectRecipients(command: OutgoingEmailCommand): Recipient[] {
  return [
    ...command.to.flatMap(value => parseRecipients(value, 'to')),
    ...command.cc.flatMap(value => parseRecipients(value, 'cc')),
    ...command.bcc.flatMap(value => parseRecipients(value, 'bcc'))
  ]
}

const emailsOf = (recipients: Recipient[], type: RecipientType) =>
  recipients.filter(r => r.type === type).map(r => r.email)

/** 发件箱列表里展示的收件人：优先 to，其次 cc，最后 bcc */
function pickDisplayTo(to: string[], cc: string[], bcc: string[]): string {
  if (to.length > 0) return to.join(', ')
  if (cc.length > 0) return cc[0]
  return bcc[0]
}

export async function deliverOutgoingEmail(command: OutgoingEmailCommand) {
  const recipients = collectRecipients(command)
  if (recipients.length === 0) {
    throw new AppError('At least one recipient is required', 400)
  }

  const sender = await prisma.user.findUnique({ where: { id: command.senderId } })
  if (!sender) {
    throw new AppError('User not found', 404)
  }

  // 只允许引用当前用户自己邮件中的附件，防止越权获取他人附件
  const referencedAttachments = await prisma.attachment.findMany({
    where: {
      id: { in: command.referencedAttachmentIds },
      emails: { some: { email: { userId: command.senderId } } }
    }
  })

  const toEmails = emailsOf(recipients, 'to')
  const ccEmails = emailsOf(recipients, 'cc')
  const bccEmails = emailsOf(recipients, 'bcc')
  const uniqueEmails = [...new Set(recipients.map(r => r.email))]
  const fromName = sender.nickname || sender.username || null
  const summary = extractEmailExcerpt(command.body)

  // 一次查询找出全部站内收件人，取代逐个收件人查库
  const localUsers = await prisma.user.findMany({
    where: { email: { in: uniqueEmails } },
    select: { id: true, email: true }
  })
  const localUserByEmail = new Map(localUsers.map(user => [user.email, user]))

  const { sent, newAttachments } = await prisma.$transaction(async tx => {
    const created = []
    for (const upload of command.uploads) {
      created.push(await tx.attachment.create({
        data: {
          filename: upload.filename,
          originalName: upload.originalname,
          mimeType: upload.mimetype,
          size: upload.size,
          path: upload.path
        }
      }))
    }
    const attachmentIds = [...created, ...referencedAttachments].map(a => a.id)

    const sentCopy = await createMailboxCopy(tx, {
      folder: FOLDER_SENT,
      userId: sender.id,
      from: sender.email,
      fromName,
      to: pickDisplayTo(toEmails, ccEmails, bccEmails),
      toList: toEmails,
      ccList: ccEmails,
      bccList: bccEmails,
      subject: command.subject,
      body: command.body,
      summary,
      isRead: false,
      attachmentIds
    })

    for (const email of uniqueEmails) {
      const localUser = localUserByEmail.get(email)
      if (!localUser) continue

      await createMailboxCopy(tx, {
        folder: FOLDER_INBOX,
        userId: localUser.id,
        from: sender.email,
        fromName,
        to: email,
        toList: toEmails,
        ccList: ccEmails,
        // 密送收件人只能看到自己，其他人看不到密送名单
        bccList: bccEmails.includes(email) ? [email] : [],
        subject: command.subject,
        body: command.body,
        summary,
        isRead: false,
        attachmentIds
      })
    }

    return { sent: sentCopy, newAttachments: created }
  }, { timeout: 15_000 })

  const externalEmails = new Set(uniqueEmails.filter(email => !localUserByEmail.has(email)))
  if (externalEmails.size > 0) {
    const onlyExternal = (emails: string[]) => emails.filter(email => externalEmails.has(email))

    // 邮件此时已提交落库。外部投递的任何失败都只记录日志、绝不向上抛出：
    // 一旦抛出，调用方会误以为发送失败并清理已被记录引用的上传文件。
    try {
      await sendEmail({
        from: sender.email,
        fromName: sender.nickname || sender.username || undefined,
        to: onlyExternal(toEmails),
        cc: onlyExternal(ccEmails),
        bcc: onlyExternal(bccEmails),
        subject: command.subject,
        html: command.body,
        attachments: [...newAttachments, ...referencedAttachments].map(att => ({
          filename: att.originalName,
          path: getAttachmentPath(att.filename),
          contentType: att.mimeType
        }))
      })
    } catch (error) {
      console.error('[MAIL] External delivery failed unexpectedly:', error instanceof Error ? error.message : error)
    }
  }

  return toEmailDto(sent)
}
