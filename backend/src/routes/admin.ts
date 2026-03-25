import { Router, Request, Response, NextFunction } from 'express'
import { PrismaClient } from '@prisma/client'
import jwt from 'jsonwebtoken'
import { asyncHandler } from '../middleware/error'

const router = Router()
const prisma = new PrismaClient()

interface AuthRequest extends Request {
  userId?: string
}

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key'

const auth = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const token = req.headers.authorization?.split(' ')[1]
    if (!token) {
      return res.status(401).json({ error: 'No token provided' })
    }

    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string }
    req.userId = decoded.userId
    next()
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' })
  }
}

const adminOnly = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { role: true }
    })

    if (!user || (user.role !== 'admin')) {
      return res.status(403).json({ error: 'Admin access required' })
    }

    next()
  } catch (error) {
    return res.status(500).json({ error: 'Internal server error' })
  }
}

router.get('/tables', auth, adminOnly, asyncHandler(async (req: AuthRequest, res: Response) => {
  res.json({
    tables: [
      { name: 'User', count: await prisma.user.count() },
      { name: 'Email', count: await prisma.email.count() },
      { name: 'Attachment', count: await prisma.attachment.count() },
      { name: 'EmailAttachment', count: await prisma.emailAttachment.count() },
      { name: 'SSOApp', count: await prisma.sSOApp.count() },
      { name: 'OAuthProvider', count: await prisma.oAuthProvider.count() }
    ]
  })
}))

router.get('/tables/:tableName', auth, adminOnly, asyncHandler(async (req: AuthRequest, res: Response) => {
  const { tableName } = req.params
  const page = parseInt(req.query.page as string) || 1
  const pageSize = parseInt(req.query.pageSize as string) || 20
  const skip = (page - 1) * pageSize

  let columns: string[] = []
  let data: any[] = []
  let total = 0

  switch (tableName.toLowerCase()) {
    case 'user':
      columns = ['id', 'email', 'username', 'nickname', 'phone', 'birthday', 'avatar', 'role', 'language', 'githubId', 'createdAt', 'updatedAt']
      total = await prisma.user.count()
      data = await prisma.user.findMany({
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          username: true,
          nickname: true,
          phone: true,
          birthday: true,
          avatar: true,
          role: true,
          language: true,
          githubId: true,
          createdAt: true,
          updatedAt: true
        }
      })
      break

    case 'email':
      columns = ['id', 'from', 'fromName', 'to', 'toList', 'ccList', 'bccList', 'subject', 'summary', 'folder', 'isRead', 'isStarred', 'createdAt', 'updatedAt', 'userId']
      total = await prisma.email.count()
      data = await prisma.email.findMany({
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          from: true,
          fromName: true,
          to: true,
          toList: true,
          ccList: true,
          bccList: true,
          subject: true,
          summary: true,
          folder: true,
          isRead: true,
          isStarred: true,
          createdAt: true,
          updatedAt: true,
          userId: true
        }
      })
      break

    case 'attachment':
      columns = ['id', 'filename', 'originalName', 'mimeType', 'size', 'path', 'createdAt']
      total = await prisma.attachment.count()
      data = await prisma.attachment.findMany({
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' }
      })
      break

    case 'emailattachment':
      columns = ['id', 'emailId', 'attachmentId']
      total = await prisma.emailAttachment.count()
      data = await prisma.emailAttachment.findMany({
        skip,
        take: pageSize,
        orderBy: { emailId: 'asc' }
      })
      break

    case 'ssoapp':
      columns = ['id', 'name', 'domain', 'description', 'isActive', 'userId', 'createdAt', 'updatedAt']
      total = await prisma.sSOApp.count()
      data = await prisma.sSOApp.findMany({
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          domain: true,
          description: true,
          isActive: true,
          userId: true,
          createdAt: true,
          updatedAt: true
        }
      })
      break

    case 'oauthprovider':
      columns = ['id', 'provider', 'displayName', 'clientId', 'callbackUrl', 'scope', 'isActive', 'createdAt', 'updatedAt']
      total = await prisma.oAuthProvider.count()
      data = await prisma.oAuthProvider.findMany({
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          provider: true,
          displayName: true,
          clientId: true,
          callbackUrl: true,
          scope: true,
          isActive: true,
          createdAt: true,
          updatedAt: true
        }
      })
      break

    default:
      return res.status(400).json({ error: 'Unknown table' })
  }

  res.json({
    columns,
    data,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize)
    }
  })
}))

router.delete('/tables/:tableName/:id', auth, adminOnly, asyncHandler(async (req: AuthRequest, res: Response) => {
  const { tableName, id } = req.params

  switch (tableName.toLowerCase()) {
    case 'user':
      await prisma.user.delete({ where: { id } })
      break

    case 'email':
      await prisma.email.delete({ where: { id } })
      break

    case 'attachment':
      await prisma.attachment.delete({ where: { id } })
      break

    case 'emailattachment':
      await prisma.emailAttachment.delete({ where: { id } })
      break

    case 'ssoapp':
      await prisma.sSOApp.delete({ where: { id } })
      break

    case 'oauthprovider':
      await prisma.oAuthProvider.delete({ where: { id } })
      break

    default:
      return res.status(400).json({ error: 'Unknown table' })
  }

  res.json({ success: true })
}))

export default router
