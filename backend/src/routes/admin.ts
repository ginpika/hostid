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
      { name: 'Attachment', count: await prisma.attachment.count() }
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
      columns = ['id', 'email', 'username', 'nickname', 'phone', 'birthday', 'role', 'language', 'createdAt']
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
          role: true,
          language: true,
          createdAt: true
        }
      })
      break

    case 'email':
      columns = ['id', 'from', 'fromName', 'to', 'subject', 'folder', 'isRead', 'isStarred', 'createdAt', 'userId']
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
          subject: true,
          folder: true,
          isRead: true,
          isStarred: true,
          createdAt: true,
          userId: true
        }
      })
      break

    case 'attachment':
      columns = ['id', 'filename', 'originalName', 'mimeType', 'size', 'createdAt']
      total = await prisma.attachment.count()
      data = await prisma.attachment.findMany({
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' }
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

    default:
      return res.status(400).json({ error: 'Unknown table' })
  }

  res.json({ success: true })
}))

export default router
