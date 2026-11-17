/**
 * 邮件路由
 * 处理邮件列表查询、发送、删除、恢复和归档
 * 路由只负责 HTTP 适配（参数解析/校验 → 调用服务 → 响应）；
 * 发信落库与外部投递在 services/mail-delivery，附件生命周期在 services/attachment
 */
import { Router, Response } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { auth, AuthRequest } from '../middleware/auth'
import { AppError, asyncHandler } from '../middleware/error'
import { upload, emlUpload } from '../middleware/upload'
import { parseEmailFile } from '../lib/parse-email-file'
import { getParsedEmailBody } from '../lib/parsed-email-body'
import { extractAddresses } from '../lib/mail-addresses'
import { buildEmailListWhere, getEmailPagination, parseEmailListQuery } from '../lib/mail-list-query'
import { EMAIL_WITH_ATTACHMENTS_INCLUDE, toEmailDto } from '../lib/email-dto'
import {
  FOLDER_ARCHIVED,
  FOLDER_INBOX,
  FOLDER_TRASH,
  MAILBOX_FOLDERS,
  type MailboxFolder
} from '../lib/domain-constants'
import { deliverOutgoingEmail } from '../services/mail-delivery'
import { deleteAttachmentIfUnreferenced, removeStoredFile, removeUploadedFiles } from '../services/attachment'

const router = Router()

router.use(auth)

// ---------------------------------------------------------------------------
// 查询辅助
// ---------------------------------------------------------------------------

/** 只在“属于当前用户”的范围内查找邮件，不属于则统一 404（不泄露他人邮件是否存在） */
async function requireOwnedEmail(id: string, userId: string | undefined) {
  const email = await prisma.email.findFirst({ where: { id, userId } })
  if (!email) throw new AppError('Email not found', 404)
  return email
}

async function requireOwnedEmailWithAttachments(id: string, userId: string | undefined) {
  const email = await prisma.email.findFirst({
    where: { id, userId },
    include: EMAIL_WITH_ATTACHMENTS_INCLUDE
  })
  if (!email) throw new AppError('Email not found', 404)
  return email
}

async function moveToFolder(id: string, userId: string | undefined, folder: MailboxFolder) {
  const email = await requireOwnedEmail(id, userId)
  return prisma.email.update({ where: { id: email.id }, data: { folder } })
}

function parseStringList(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const value = JSON.parse(raw)
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// 列表 / 详情 / 导出
// ---------------------------------------------------------------------------

router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const query = parseEmailListQuery(req.query)
  const whereCondition = buildEmailListWhere(req.userId!, query)

  // Count and read the same snapshot. When a deletion removes the final page,
  // return the nearest available page rather than an apparently empty mailbox.
  const { emails, pagination } = await prisma.$transaction(async tx => {
    const total = await tx.email.count({ where: whereCondition })
    const pagination = getEmailPagination(query.page, query.limit, total)
    const emails = await tx.email.findMany({
      where: whereCondition,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: EMAIL_WITH_ATTACHMENTS_INCLUDE,
      skip: (pagination.page - 1) * pagination.limit,
      take: pagination.limit
    })
    return { emails, pagination }
  })

  res.json({ emails: emails.map(toEmailDto), pagination })
}))

router.get('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const email = await requireOwnedEmailWithAttachments(req.params.id, req.userId)

  if (!email.isRead) {
    await prisma.email.update({
      where: { id: email.id },
      data: { isRead: true }
    })
  }

  res.json(toEmailDto(email))
}))

router.get('/:id/export', asyncHandler(async (req: AuthRequest, res: Response) => {
  const email = await requireOwnedEmail(req.params.id, req.userId)

  const fromHeader = email.fromName
    ? `From: "${email.fromName}" <${email.from}>`
    : `From: <${email.from}>`

  const toList = parseStringList(email.toList)
  const toHeader = toList.length > 0 ? `To: ${toList.join(', ')}` : `To: ${email.to}`

  const ccList = parseStringList(email.ccList)
  const ccHeader = ccList.length > 0 ? `Cc: ${ccList.join(', ')}` : ''

  const headers = [
    fromHeader,
    toHeader,
    ...(ccHeader ? [ccHeader] : []),
    `Date: ${new Date(email.createdAt).toUTCString()}`,
    `Subject: ${email.subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8'
  ].join('\r\n')

  const filename = `${email.subject.replace(/[\\/:*?"<>|]/g, '_') || 'no-subject'}.eml`
  res.setHeader('Content-Type', 'message/rfc822')
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`)
  res.send(`${headers}\r\n\r\n${email.body}`)
}))

// ---------------------------------------------------------------------------
// 发送 / 导入
// ---------------------------------------------------------------------------

/** multipart 表单里同名字段出现一次是字符串、多次是数组，统一成数组 */
const addressField = z.union([z.string(), z.array(z.string())]).optional()
  .transform(value => (value === undefined ? [] : Array.isArray(value) ? value : [value]))

const sendEmailSchema = z.object({
  to: addressField,
  cc: addressField,
  bcc: addressField,
  subject: z.string().default(''),
  body: z.string().default('')
})

/** referencedAttachments 以 JSON 字符串（或数组）传入的附件 ID 列表 */
function parseIdList(raw: unknown): string[] {
  const value = typeof raw === 'string' ? (() => { try { return JSON.parse(raw) } catch { return [] } })() : raw
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []
}

router.post('/', upload.array('files', 10), asyncHandler(async (req: AuthRequest, res: Response) => {
  const files = (req.files as Express.Multer.File[] | undefined) ?? []

  try {
    const input = sendEmailSchema.parse(req.body ?? {})

    // 附件只来自本次 multipart 上传（文件名/路径由服务端生成）或对已有附件的 ID 引用，
    // 不再信任客户端 JSON 里自带的 path/filename。
    const email = await deliverOutgoingEmail({
      senderId: req.userId!,
      to: input.to,
      cc: input.cc,
      bcc: input.bcc,
      subject: input.subject,
      body: input.body,
      uploads: files,
      referencedAttachmentIds: parseIdList(req.body?.referencedAttachments)
    })

    res.status(201).json(email)
  } catch (error) {
    // 请求失败时，已落盘的上传文件不会有任何记录指向它们，必须清理
    await removeUploadedFiles(files)
    throw error
  }
}))

router.post('/import', emlUpload.single('file'), asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.file) {
    throw new AppError('No file uploaded', 400)
  }

  let parsed
  try {
    parsed = await parseEmailFile(req.file.path)
  } catch {
    throw new AppError('Failed to parse EML file', 400)
  } finally {
    await removeStoredFile(req.file.path)
  }

  const [from] = extractAddresses(parsed.from)
  const toAddresses = extractAddresses(parsed.to)

  const email = await prisma.email.create({
    data: {
      from: from?.address || 'unknown@unknown',
      fromName: from?.name ?? null,
      to: toAddresses[0]?.address || 'unknown@unknown',
      toList: JSON.stringify(toAddresses.map(a => a.address)),
      ccList: JSON.stringify(extractAddresses(parsed.cc).map(a => a.address)),
      bccList: JSON.stringify(extractAddresses(parsed.bcc).map(a => a.address)),
      subject: parsed.subject || '(No Subject)',
      body: getParsedEmailBody(parsed),
      folder: FOLDER_INBOX,
      userId: req.userId!
    }
  })

  res.status(201).json(email)
}))

// ---------------------------------------------------------------------------
// 删除 / 状态流转
// ---------------------------------------------------------------------------

router.delete('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const mode = req.query.permanent
  if (mode !== undefined && mode !== 'true' && mode !== 'false') {
    throw new AppError('Invalid deletion mode', 400)
  }
  const permanent = mode === 'true'

  const email = await requireOwnedEmailWithAttachments(req.params.id, req.userId)

  if (permanent && email.folder !== FOLDER_TRASH) {
    throw new AppError('Move this email to trash before permanently deleting it', 409)
  }

  // The caller must explicitly request permanent deletion. Retrying a normal
  // DELETE after a lost response must never turn a move-to-trash into a purge.
  if (permanent) {
    await prisma.email.delete({ where: { id: email.id } })
    // 邮件删除后，不再被任何邮件引用的附件才会被真正清除
    await Promise.all(email.attachments.map(link => deleteAttachmentIfUnreferenced(link.attachmentId)))
  } else {
    await prisma.email.update({
      where: { id: email.id },
      data: { folder: FOLDER_TRASH }
    })
  }

  res.json({ success: true })
}))

router.post('/:id/restore', asyncHandler(async (req: AuthRequest, res: Response) => {
  res.json(await moveToFolder(req.params.id, req.userId, FOLDER_INBOX))
}))

router.post('/:id/archive', asyncHandler(async (req: AuthRequest, res: Response) => {
  res.json(await moveToFolder(req.params.id, req.userId, FOLDER_ARCHIVED))
}))

const folderSchema = z.object({
  folder: z.enum(MAILBOX_FOLDERS, { errorMap: () => ({ message: 'Invalid folder' }) })
})

router.patch('/:id/folder', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { folder } = folderSchema.parse(req.body ?? {})
  res.json(await moveToFolder(req.params.id, req.userId, folder))
}))

const readSchema = z.object({ isRead: z.boolean().optional() })
const starSchema = z.object({ isStarred: z.boolean().optional() })

router.patch('/:id/read', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { isRead } = readSchema.parse(req.body ?? {})
  const email = await requireOwnedEmail(req.params.id, req.userId)

  res.json(await prisma.email.update({
    where: { id: email.id },
    data: { isRead: isRead ?? true }
  }))
}))

router.patch('/:id/star', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { isStarred } = starSchema.parse(req.body ?? {})
  const email = await requireOwnedEmail(req.params.id, req.userId)

  res.json(await prisma.email.update({
    where: { id: email.id },
    data: { isStarred: isStarred ?? !email.isStarred }
  }))
}))

export default router
