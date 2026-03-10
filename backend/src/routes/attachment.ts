import { Router, Response, NextFunction, Request } from 'express'
import { prisma } from '../lib/prisma'
import { auth, AuthRequest } from '../middleware/auth'
import { AppError } from '../middleware/error'
import { upload, getAttachmentPath } from '../middleware/upload'
import fs from 'fs'
import path from 'path'
import jwt from 'jsonwebtoken'

const router = Router()

const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next)
  }
}

const getUserIdFromRequest = (req: Request): string | null => {
  const authHeader = req.headers.authorization
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7)
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET!) as { userId: string }
      return decoded.userId
    } catch {
      return null
    }
  }
  
  const tokenFromQuery = req.query.token as string
  if (tokenFromQuery) {
    try {
      const decoded = jwt.verify(tokenFromQuery, process.env.JWT_SECRET!) as { userId: string }
      return decoded.userId
    } catch {
      return null
    }
  }
  
  return null
}

router.post('/upload', auth, upload.array('files', 10), asyncHandler(async (req: AuthRequest, res: Response) => {
  const files = req.files as Express.Multer.File[]
  
  if (!files || files.length === 0) {
    throw new AppError('No files uploaded', 400)
  }
  
  const attachments = await Promise.all(
    files.map(file => 
      prisma.attachment.create({
        data: {
          filename: file.filename,
          originalName: file.originalname,
          mimeType: file.mimetype,
          size: file.size,
          path: file.path
        }
      })
    )
  )
  
  res.status(201).json(attachments)
}))

router.get('/:id', asyncHandler(async (req: Request, res: Response) => {
  const userId = getUserIdFromRequest(req)
  
  if (!userId) {
    throw new AppError('Unauthorized', 401)
  }
  
  const attachment = await prisma.attachment.findUnique({
    where: { id: req.params.id },
    include: {
      emails: {
        include: { email: true }
      }
    }
  })
  
  if (!attachment) {
    throw new AppError('Attachment not found', 404)
  }
  
  const hasAccess = attachment.emails.some(ea => ea.email.userId === userId)
  if (!hasAccess) {
    throw new AppError('Access denied', 403)
  }
  
  const filePath = getAttachmentPath(attachment.filename)
  
  if (!fs.existsSync(filePath)) {
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

router.delete('/:id', auth, asyncHandler(async (req: AuthRequest, res: Response) => {
  const attachment = await prisma.attachment.findUnique({
    where: { id: req.params.id },
    include: {
      emails: {
        include: { email: true }
      }
    }
  })
  
  if (!attachment) {
    throw new AppError('Attachment not found', 404)
  }
  
  const hasAccess = attachment.emails.some(ea => ea.email.userId === req.userId)
  if (!hasAccess) {
    throw new AppError('Access denied', 403)
  }
  
  const filePath = getAttachmentPath(attachment.filename)
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath)
  }
  
  await prisma.attachment.delete({ where: { id: attachment.id } })
  
  res.json({ success: true })
}))

export default router
