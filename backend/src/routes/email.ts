import { Router, Response, NextFunction, Request } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { auth, AuthRequest } from '../middleware/auth'
import { AppError } from '../middleware/error'
import { generateSummary } from '../services/ai'
import { sendEmail } from '../services/mailer'
import { upload } from '../middleware/upload'
import fs from 'fs'
import path from 'path'

const router = Router()

const MAIL_DOMAIN = process.env.MAIL_DOMAIN || 'localhost'
const UPLOAD_DIR = path.join(process.cwd(), 'uploads')

const usernameRegex = /^[a-zA-Z0-9._]+$/

const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next)
  }
}

router.use(auth)

type RecipientType = 'to' | 'cc' | 'bcc'

interface Recipient {
  username: string
  email: string
  type: RecipientType
}

interface AttachmentInfo {
  id?: string
  filename: string
  originalName: string
  mimeType: string
  size: number
  path: string
}

function parseRecipients(input: string, type: RecipientType = 'to'): Recipient[] {
  const recipients: Recipient[] = []
  const parts = input.split(/[,，]/).map(s => s.trim()).filter(s => s)
  
  for (const part of parts) {
    let email: string
    let username: string
    
    if (part.includes('@')) {
      email = part.toLowerCase()
      username = part.split('@')[0]
    } else {
      username = part
      email = `${part}@${MAIL_DOMAIN}`
    }
    
    if (usernameRegex.test(username)) {
      recipients.push({ username, email, type })
    }
  }
  
  return recipients
}

function recipientsToEmails(recipients: Recipient[]): string[] {
  return recipients.map(r => r.email)
}

router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const folder = (req.query.folder as string) || 'INBOX'
  const page = parseInt(req.query.page as string) || 1
  const limit = parseInt(req.query.limit as string) || 20
  const skip = (page - 1) * limit
  
  const [emails, total] = await Promise.all([
    prisma.email.findMany({
      where: { userId: req.userId, folder },
      orderBy: { createdAt: 'desc' },
      include: { 
        attachments: {
          include: { attachment: true }
        }
      },
      skip,
      take: limit
    }),
    prisma.email.count({
      where: { userId: req.userId, folder }
    })
  ])
  
  const emailsWithAttachments = emails.map(email => ({
    ...email,
    attachments: email.attachments.map(ea => ea.attachment)
  }))
  
  res.json({
    emails: emailsWithAttachments,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    }
  })
}))

router.get('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const email = await prisma.email.findFirst({
    where: { id: req.params.id, userId: req.userId },
    include: { 
      attachments: {
        include: { attachment: true }
      }
    }
  })

  if (!email) {
    throw new AppError('Email not found', 404)
  }

  if (!email.isRead) {
    await prisma.email.update({
      where: { id: email.id },
      data: { isRead: true }
    })
  }

  res.json({
    ...email,
    attachments: email.attachments.map(ea => ea.attachment)
  })
}))

router.post('/', upload.array('files', 10), asyncHandler(async (req: AuthRequest, res: Response) => {
  const body = req.body
  const files = req.files as Express.Multer.File[] | undefined
  
  let to = body.to
  let cc = body.cc
  let bcc = body.bcc
  let attachments: AttachmentInfo[] = []
  let referencedAttachmentIds: string[] = []
  
  if (typeof body.attachments === 'string') {
    try {
      attachments = JSON.parse(body.attachments)
    } catch (e) {
      attachments = []
    }
  } else if (Array.isArray(body.attachments)) {
    attachments = body.attachments
  }
  
  if (typeof body.referencedAttachments === 'string') {
    try {
      referencedAttachmentIds = JSON.parse(body.referencedAttachments)
    } catch (e) {
      referencedAttachmentIds = []
    }
  }
  
  if (files && files.length > 0) {
    attachments = files.map(file => ({
      filename: file.filename,
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      path: file.path
    }))
  }
  
  const referencedAttachments = await prisma.attachment.findMany({
    where: { id: { in: referencedAttachmentIds } }
  })
  
  const allRecipients: Recipient[] = []
  
  if (to) {
    const toList = Array.isArray(to) ? to : [to]
    for (const t of toList) {
      allRecipients.push(...parseRecipients(t, 'to'))
    }
  }
  
  if (cc) {
    const ccList = Array.isArray(cc) ? cc : [cc]
    for (const c of ccList) {
      allRecipients.push(...parseRecipients(c, 'cc'))
    }
  }
  
  if (bcc) {
    const bccList = Array.isArray(bcc) ? bcc : [bcc]
    for (const b of bccList) {
      allRecipients.push(...parseRecipients(b, 'bcc'))
    }
  }
  
  if (allRecipients.length === 0) {
    throw new AppError('At least one recipient is required', 400)
  }
  
  const user = await prisma.user.findUnique({ where: { id: req.userId } })
  
  const summary = await generateSummary(body.body)
  
  const toRecipients = allRecipients.filter(r => r.type === 'to')
  const ccRecipients = allRecipients.filter(r => r.type === 'cc')
  const bccRecipients = allRecipients.filter(r => r.type === 'bcc')
  
  const displayTo = toRecipients.length > 0 
    ? toRecipients.map(r => r.email).join(', ')
    : ccRecipients.length > 0 
      ? ccRecipients[0].email 
      : bccRecipients[0].email
  
  const newAttachmentRecords = await Promise.all(
    attachments.map(att => 
      prisma.attachment.create({
        data: {
          filename: att.filename,
          originalName: att.originalName,
          mimeType: att.mimeType,
          size: att.size,
          path: att.path
        }
      })
    )
  )
  
  const allAttachmentIds = [
    ...newAttachmentRecords.map(a => a.id),
    ...referencedAttachments.map(a => a.id)
  ]
  
  const allAttachmentRecords = [...newAttachmentRecords, ...referencedAttachments]
  
  const email = await prisma.email.create({
    data: {
      from: user!.email,
      fromName: user!.nickname || user!.username || null,
      to: displayTo,
      toList: JSON.stringify(toRecipients.map(r => r.email)),
      ccList: JSON.stringify(ccRecipients.map(r => r.email)),
      bccList: JSON.stringify(bccRecipients.map(r => r.email)),
      subject: body.subject,
      body: body.body,
      summary,
      folder: 'SENT',
      userId: req.userId!,
      attachments: {
        create: allAttachmentIds.map(attachmentId => ({
          attachmentId
        }))
      }
    },
    include: { 
      attachments: {
        include: { attachment: true }
      }
    }
  })

  const allEmails = recipientsToEmails(allRecipients)
  const localRecipients: string[] = []
  const externalRecipients: string[] = []
  
  for (const recipientEmail of allEmails) {
    const recipientUser = await prisma.user.findUnique({
      where: { email: recipientEmail }
    })
    
    if (recipientUser) {
      localRecipients.push(recipientEmail)
      const isBcc = bccRecipients.some(r => r.email === recipientEmail)
      
      await prisma.email.create({
        data: {
          from: user!.email,
          fromName: user!.nickname || user!.username || null,
          to: recipientEmail,
          toList: JSON.stringify(toRecipients.map(r => r.email)),
          ccList: JSON.stringify(ccRecipients.map(r => r.email)),
          bccList: isBcc ? JSON.stringify([recipientEmail]) : '[]',
          subject: body.subject,
          body: body.body,
          summary,
          folder: 'INBOX',
          isRead: false,
          userId: recipientUser.id,
          attachments: {
            create: allAttachmentIds.map(attachmentId => ({
              attachmentId
            }))
          }
        }
      })
      
      console.log(`[MAIL] Delivered to local user: ${recipientEmail}`)
    } else {
      externalRecipients.push(recipientEmail)
    }
  }
  
  if (externalRecipients.length > 0) {
    console.log(`[MAIL] Sending to external recipients: ${externalRecipients.join(', ')}`)
    
    const sendResults = await sendEmail({
      from: user!.email,
      fromName: user!.nickname || user!.username || undefined,
      to: toRecipients.filter(r => externalRecipients.includes(r.email)).map(r => r.email),
      cc: ccRecipients.filter(r => externalRecipients.includes(r.email)).map(r => r.email),
      bcc: bccRecipients.filter(r => externalRecipients.includes(r.email)).map(r => r.email),
      subject: body.subject,
      html: body.body,
      attachments: allAttachmentRecords.map(att => ({
        filename: att.originalName,
        path: att.path,
        contentType: att.mimeType
      }))
    })
    
    for (const result of sendResults) {
      if (result.success) {
        console.log(`[MAIL] Sent to ${result.recipient}: ${result.messageId}`)
      } else {
        console.error(`[MAIL] Failed to send to ${result.recipient}: ${result.error}`)
      }
    }
  }

  res.status(201).json({
    ...email,
    attachments: email.attachments.map(ea => ea.attachment)
  })
}))

router.delete('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const email = await prisma.email.findFirst({
    where: { id: req.params.id, userId: req.userId },
    include: { 
      attachments: {
        include: { attachment: true }
      }
    }
  })

  if (!email) {
    throw new AppError('Email not found', 404)
  }

  if (email.folder === 'TRASH') {
    for (const ea of email.attachments) {
      const otherReferences = await prisma.emailAttachment.count({
        where: { 
          attachmentId: ea.attachmentId,
          emailId: { not: email.id }
        }
      })
      
      if (otherReferences === 0) {
        if (fs.existsSync(ea.attachment.path)) {
          fs.unlinkSync(ea.attachment.path)
        }
        await prisma.attachment.delete({ where: { id: ea.attachmentId } })
      }
    }
    await prisma.email.delete({ where: { id: email.id } })
  } else {
    await prisma.email.update({
      where: { id: email.id },
      data: { folder: 'TRASH' }
    })
  }

  res.json({ success: true })
}))

router.post('/:id/restore', asyncHandler(async (req: AuthRequest, res: Response) => {
  const email = await prisma.email.findFirst({
    where: { id: req.params.id, userId: req.userId }
  })

  if (!email) {
    throw new AppError('Email not found', 404)
  }

  const updated = await prisma.email.update({
    where: { id: email.id },
    data: { folder: 'INBOX' }
  })

  res.json(updated)
}))

router.patch('/:id/read', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { isRead } = req.body
  
  const email = await prisma.email.findFirst({
    where: { id: req.params.id, userId: req.userId }
  })

  if (!email) {
    throw new AppError('Email not found', 404)
  }

  const updated = await prisma.email.update({
    where: { id: email.id },
    data: { isRead: isRead ?? true }
  })

  res.json(updated)
}))

router.patch('/:id/star', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { isStarred } = req.body
  console.log('[STAR] Request received:', { id: req.params.id, isStarred, userId: req.userId })
  
  const email = await prisma.email.findFirst({
    where: { id: req.params.id, userId: req.userId }
  })

  if (!email) {
    throw new AppError('Email not found', 404)
  }

  const updated = await prisma.email.update({
    where: { id: email.id },
    data: { isStarred: isStarred ?? !email.isStarred }
  })
  
  console.log('[STAR] Updated email:', { id: updated.id, isStarred: updated.isStarred })

  res.json(updated)
}))

router.patch('/:id/folder', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { folder } = req.body
  
  const validFolders = ['INBOX', 'SENT', 'TRASH', 'ARCHIVED']
  if (!folder || !validFolders.includes(folder)) {
    throw new AppError('Invalid folder', 400)
  }

  const email = await prisma.email.findFirst({
    where: { id: req.params.id, userId: req.userId }
  })

  if (!email) {
    throw new AppError('Email not found', 404)
  }

  const updated = await prisma.email.update({
    where: { id: email.id },
    data: { folder }
  })

  res.json(updated)
}))

router.post('/:id/archive', asyncHandler(async (req: AuthRequest, res: Response) => {
  const email = await prisma.email.findFirst({
    where: { id: req.params.id, userId: req.userId }
  })

  if (!email) {
    throw new AppError('Email not found', 404)
  }

  const updated = await prisma.email.update({
    where: { id: email.id },
    data: { folder: 'ARCHIVED' }
  })

  res.json(updated)
}))

export default router
