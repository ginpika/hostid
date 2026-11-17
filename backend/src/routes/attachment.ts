/**
 * 附件路由
 * 处理邮件附件的上传、下载和删除
 * 提供 Token 验证和文件流式传输
 */
import { Router, Response, Request } from 'express'
import jwt from 'jsonwebtoken'
import { prisma } from '../lib/prisma'
import { auth, AuthRequest } from '../middleware/auth'
import { AppError, asyncHandler } from '../middleware/error'
import { upload } from '../middleware/upload'
import { getAttachmentPath } from '../config/paths'
import { getJwtSecret } from '../config/secrets'
import { toAttachmentDto } from '../lib/email-dto'
import { deleteAttachmentIfUnreferenced, removeUploadedFiles } from '../services/attachment'
import fs from 'node:fs/promises'

const router = Router()

/**
 * 下载链接用于 <img src> / 下载按钮，无法携带 Authorization 头，所以同时接受 ?token=。
 * 注意：URL 中的 JWT 可能进入访问日志，后续应改为短时效的一次性签名下载链接。
 */
const getUserIdFromRequest = (req: Request): string | null => {
  const authHeader = req.headers.authorization
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.substring(7)
    : typeof req.query.token === 'string' ? req.query.token : null
  if (!token) return null

  try {
    return (jwt.verify(token, getJwtSecret()) as { userId: string }).userId
  } catch {
    return null
  }
}

/** 当前用户有权访问某附件 = 该用户至少有一封邮件引用了它 */
const isReferencedByUser = (userId: string, attachment: { emails: { email: { userId: string } }[] }) =>
  attachment.emails.some(link => link.email.userId === userId)

router.post('/upload', auth, upload.array('files', 10), asyncHandler(async (req: AuthRequest, res: Response) => {
  const files = (req.files as Express.Multer.File[] | undefined) ?? []

  if (files.length === 0) {
    throw new AppError('No files uploaded', 400)
  }

  try {
    const attachments = await prisma.$transaction(
      files.map(file => prisma.attachment.create({
        data: {
          filename: file.filename,
          originalName: file.originalname,
          mimeType: file.mimetype,
          size: file.size,
          path: file.path
        }
      }))
    )

    res.status(201).json(attachments.map(toAttachmentDto))
  } catch (error) {
    await removeUploadedFiles(files)
    throw error
  }
}))

router.get('/:id', asyncHandler(async (req: Request, res: Response) => {
  const userId = getUserIdFromRequest(req)

  if (!userId) {
    throw new AppError('Unauthorized', 401)
  }

  const attachment = await prisma.attachment.findUnique({
    where: { id: req.params.id },
    include: { emails: { include: { email: { select: { userId: true } } } } }
  })

  if (!attachment) {
    throw new AppError('Attachment not found', 404)
  }
  if (!isReferencedByUser(userId, attachment)) {
    throw new AppError('Access denied', 403)
  }

  const filePath = getAttachmentPath(attachment.filename)
  try {
    await fs.access(filePath)
  } catch {
    throw new AppError('File not found', 404)
  }

  const encodedFilename = encodeURIComponent(attachment.originalName)

  if (attachment.mimeType.startsWith('image/')) {
    res.setHeader('Content-Type', attachment.mimeType)
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodedFilename}`)
    return res.sendFile(filePath)
  }

  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodedFilename}`)
  res.download(filePath, attachment.originalName)
}))

/**
 * 附件可能被多封邮件（含其他用户的收件副本）共享，所以“删除附件”只解除
 * 当前用户邮件对它的引用；只有彻底没有引用时才删除记录与文件。
 */
router.delete('/:id', auth, asyncHandler(async (req: AuthRequest, res: Response) => {
  const attachment = await prisma.attachment.findUnique({
    where: { id: req.params.id },
    include: { emails: { include: { email: { select: { userId: true } } } } }
  })

  if (!attachment) {
    throw new AppError('Attachment not found', 404)
  }
  if (!isReferencedByUser(req.userId!, attachment)) {
    throw new AppError('Access denied', 403)
  }

  await prisma.emailAttachment.deleteMany({
    where: { attachmentId: attachment.id, email: { userId: req.userId } }
  })
  await deleteAttachmentIfUnreferenced(attachment.id)

  res.json({ success: true })
}))

export default router
