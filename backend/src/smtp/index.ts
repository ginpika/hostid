/**
 * SMTP 接收服务器
 * 接收外部邮件并存储到本地用户邮箱
 * 使用 mailparser 解析邮件内容；落库复用 services/mail-delivery 的 createMailboxCopy
 */
import { SMTPServer } from 'smtp-server'
import { simpleParser } from 'mailparser'
import fs from 'node:fs/promises'
import path from 'node:path'
import { prisma } from '../lib/prisma'
import { extractEmailExcerpt } from '../services/mail-excerpt'
import { createMailboxCopy } from '../services/mail-delivery'
import { removeStoredFile } from '../services/attachment'
import { getParsedEmailBody } from '../lib/parsed-email-body'
import { extractAddresses } from '../lib/mail-addresses'
import { FOLDER_INBOX } from '../lib/domain-constants'
import { UPLOAD_DIR, toSafeStoredFilename } from '../config/paths'
import { getSettings } from '../services/settings'

/** 将解析出的附件写入上传目录；文件名由服务端生成，发件人提供的名字只作为后缀且经过净化 */
async function saveInboundAttachment(att: { filename?: string; content: Buffer }) {
  const safeName = toSafeStoredFilename(att.filename)
  const filename = `${Date.now()}-${Math.random().toString(36).substring(7)}-${safeName}`
  const filePath = path.join(UPLOAD_DIR, filename)
  await fs.writeFile(filePath, att.content)
  return { filename, filePath }
}

export function createSMTPServer() {
  const server = new SMTPServer({
    authOptional: true,
    disabledCommands: ['STARTTLS'],
    banner: `ESMTP ${getSettings().mailDomain}`,

    onRcptTo: async (address, session, callback) => {
      const email = address.address.toLowerCase()
      console.log(`[SMTP] RCPT TO: ${email}`)

      const user = await prisma.user.findUnique({
        where: { email }
      })

      if (!user) {
        console.log(`[SMTP] User not found: ${email}`)
        return callback(new Error('User not found'))
      }

      callback()
    },

    onData: async (stream, session, callback) => {
      const writtenFiles: string[] = []
      try {
        const parsed = await simpleParser(stream)

        const envelopeRecipients = session.envelope.rcptTo.map(r => r.address.toLowerCase())

        console.log(`[SMTP] Received email from: ${parsed.from?.text}`)
        console.log(`[SMTP] To: ${envelopeRecipients.join(', ')}`)
        console.log(`[SMTP] Subject: ${parsed.subject}`)
        console.log(`[SMTP] Attachments: ${parsed.attachments?.length || 0}`)

        const [from] = extractAddresses(parsed.from)
        const fromAddress = from?.address || parsed.from?.text || 'unknown@unknown'
        const fromName = from?.name ?? null

        const headerToList = extractAddresses(parsed.to, { lowercase: true }).map(a => a.address)
        const headerCcList = extractAddresses(parsed.cc, { lowercase: true }).map(a => a.address)
        const headerBccList = extractAddresses(parsed.bcc, { lowercase: true }).map(a => a.address)

        const body = getParsedEmailBody(parsed)
        const summary = extractEmailExcerpt(parsed.text || parsed.html || '')

        const storedAttachments: {
          filename: string
          filePath: string
          originalName: string
          mimeType: string
          size: number
        }[] = []
        for (const att of parsed.attachments ?? []) {
          const { filename, filePath } = await saveInboundAttachment(att)
          writtenFiles.push(filePath)
          storedAttachments.push({
            filename,
            filePath,
            originalName: att.filename || 'attachment',
            mimeType: att.contentType || 'application/octet-stream',
            size: att.size
          })
          console.log(`[SMTP] Saved attachment: ${att.filename}`)
        }

        const users = await prisma.user.findMany({
          where: { email: { in: [...new Set(envelopeRecipients)] } },
          select: { id: true, email: true }
        })

        // 附件记录与所有收件人副本在同一事务内落库，避免只写入一部分
        await prisma.$transaction(async tx => {
          const attachmentIds: string[] = []
          for (const stored of storedAttachments) {
            const record = await tx.attachment.create({
              data: {
                filename: stored.filename,
                originalName: stored.originalName,
                mimeType: stored.mimeType,
                size: stored.size,
                path: stored.filePath
              }
            })
            attachmentIds.push(record.id)
          }

          for (const user of users) {
            const recipientEmail = user.email.toLowerCase()
            const isListed = headerToList.includes(recipientEmail)
              || headerCcList.includes(recipientEmail)
              || headerBccList.includes(recipientEmail)

            // 信封收件人没出现在任何头部，说明是被密送的
            const bccList = isListed ? headerBccList : [...headerBccList, recipientEmail]

            await createMailboxCopy(tx, {
              folder: FOLDER_INBOX,
              userId: user.id,
              from: fromAddress,
              fromName,
              to: headerToList.length > 0
                ? headerToList.join(', ')
                : (headerCcList.length > 0 ? headerCcList[0] : recipientEmail),
              toList: headerToList,
              ccList: headerCcList,
              bccList,
              subject: parsed.subject || '(No Subject)',
              body,
              summary,
              isRead: false,
              attachmentIds
            })

            console.log(`[SMTP] Email saved for user: ${recipientEmail}`)
          }
        }, { timeout: 15_000 })

        callback()
      } catch (error) {
        // 落库失败时，已写入磁盘的附件没有任何记录引用，需要清理
        await Promise.all(writtenFiles.map(removeStoredFile))
        console.error('[SMTP] Error processing email:', error)
        callback(new Error('Error processing email'))
      }
    },

    onAuth: (auth, session, callback) => {
      callback(null, { user: auth.username })
    }
  })

  server.on('error', (err) => {
    console.error('[SMTP] Server error:', err)
  })

  return server
}

export function startSMTPServer(port = 25) {
  const server = createSMTPServer()

  server.listen(port, () => {
    console.log(`[SMTP] Server listening on port ${port}`)
  })

  return server
}
