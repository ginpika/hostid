/**
 * 管理员路由
 * 提供数据库表浏览和管理功能
 * 仅限管理员用户访问
 */
import { Router, Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { AppError, asyncHandler } from '../middleware/error'
import { getJwtSecret } from '../config/secrets'
import { getSettings, getSettingsView, updateSettings } from '../services/settings'
import { getAvatarUrl } from '../utils/avatar'

const USER_SUMMARY_SELECT = {
  id: true,
  email: true,
  username: true,
  nickname: true,
  avatar: true,
  role: true,
  createdAt: true
} as const

function formatUserSummary(user: {
  id: string
  email: string
  username: string
  nickname: string | null
  avatar: string | null
  role: string
  createdAt: Date
}) {
  return {
    ...user,
    avatarUrl: getAvatarUrl(user.avatar)
  }
}

const updateUserRoleSchema = z.object({
  role: z.enum(['admin', 'user'])
})

const router = Router()

interface AuthRequest extends Request {
  userId?: string
}


const auth = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const token = req.headers.authorization?.split(' ')[1]
    if (!token) {
      return res.status(401).json({ error: 'No token provided' })
    }

    const decoded = jwt.verify(token, getJwtSecret()) as { userId: string }
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
      { name: 'OAuthProvider', count: await prisma.oAuthProvider.count() },
      { name: 'Passkey', count: await prisma.passkey.count() }
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
          isActive: true,
          createdAt: true,
          updatedAt: true
        }
      })
      break

    case 'passkey':
      columns = ['id', 'userId', 'name', 'credentialId', 'deviceType', 'backedUp', 'counter', 'lastUsedAt', 'createdAt']
      total = await prisma.passkey.count()
      data = await prisma.passkey.findMany({
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          userId: true,
          name: true,
          credentialId: true,
          deviceType: true,
          backedUp: true,
          counter: true,
          lastUsedAt: true,
          createdAt: true
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

    case 'oauthprovider':
      await prisma.oAuthProvider.delete({ where: { id } })
      break

    case 'passkey':
      await prisma.passkey.delete({ where: { id } })
      break

    default:
      return res.status(400).json({ error: 'Unknown table' })
  }

  res.json({ success: true })
}))

/**
 * 系统设置：读取（敏感值打码）
 */
router.get('/settings', auth, adminOnly, asyncHandler(async (_req: AuthRequest, res: Response) => {
  res.set('Cache-Control', 'no-store')
  res.json({ settings: getSettingsView() })
}))

/**
 * 系统设置：更新。敏感值只写；空字符串/未提供表示保持不变，null 表示清空
 */
router.put('/settings', auth, adminOnly, asyncHandler(async (req: AuthRequest, res: Response) => {
  const body = req.body?.settings ?? req.body
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return res.status(400).json({ error: 'Invalid settings payload' })
  }
  try {
    await updateSettings(body)
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid settings' })
  }
  res.set('Cache-Control', 'no-store')
  res.json({ settings: getSettingsView() })
}))

/**
 * 管理员登录服务：Passkey 开关读取与更新
 */
router.get('/passkey', auth, adminOnly, asyncHandler(async (_req: AuthRequest, res: Response) => {
  res.set('Cache-Control', 'no-store')
  res.json({ enabled: getSettings().passkeyEnabled })
}))

router.put('/passkey', auth, adminOnly, asyncHandler(async (req: AuthRequest, res: Response) => {
  const { enabled } = req.body ?? {}
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled must be a boolean' })
  }
  await updateSettings({ passkeyEnabled: enabled })
  res.set('Cache-Control', 'no-store')
  res.json({ enabled: getSettings().passkeyEnabled })
}))

/**
 * 管理员列表与用户权限调整（按指定用户 ID 提权为管理员 / 降级为普通用户）
 */
router.get('/admins', auth, adminOnly, asyncHandler(async (_req: AuthRequest, res: Response) => {
  const admins = await prisma.user.findMany({
    where: { role: 'admin' },
    orderBy: [{ createdAt: 'asc' }],
    select: USER_SUMMARY_SELECT
  })

  res.set('Cache-Control', 'no-store')
  res.json({
    admins: admins.map(formatUserSummary),
    total: admins.length
  })
}))

router.get('/users/:id', auth, adminOnly, asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.params.id.trim()
  if (!userId) {
    throw new AppError('User ID is required', 400)
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: USER_SUMMARY_SELECT
  })
  if (!user) {
    throw new AppError('User not found', 404)
  }

  res.set('Cache-Control', 'no-store')
  res.json({ user: formatUserSummary(user) })
}))

router.patch('/users/:id/role', auth, adminOnly, asyncHandler(async (req: AuthRequest, res: Response) => {
  const targetId = req.params.id.trim()
  if (!targetId) {
    throw new AppError('User ID is required', 400)
  }

  const parsed = updateUserRoleSchema.safeParse(req.body)
  if (!parsed.success) {
    throw new AppError('Role must be "admin" or "user"', 400)
  }
  const { role } = parsed.data

  const result = await prisma.$transaction(async (tx) => {
    const target = await tx.user.findUnique({
      where: { id: targetId },
      select: USER_SUMMARY_SELECT
    })

    if (!target) {
      throw new AppError('User not found', 404)
    }

    if (role === 'user') {
      if (target.id === req.userId) {
        throw new AppError('Cannot demote your own account', 400)
      }
      if (target.role === 'admin') {
        const adminCount = await tx.user.count({ where: { role: 'admin' } })
        if (adminCount <= 1) {
          throw new AppError('Cannot demote the last remaining administrator', 400)
        }
      }
    }

    if (target.role === role) {
      return { user: formatUserSummary(target), changed: false }
    }

    const updated = await tx.user.update({
      where: { id: target.id },
      data: { role },
      select: USER_SUMMARY_SELECT
    })

    return { user: formatUserSummary(updated), changed: true }
  })

  res.set('Cache-Control', 'no-store')
  res.json(result)
}))

export default router
