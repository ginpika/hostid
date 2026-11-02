/**
 * OAuth 服务商配置路由
 * 管理 OAuth 登录服务商的添加、编辑和删除
 * 仅限管理员用户访问
 */
import { Router, Request, Response, NextFunction } from 'express'
import { PrismaClient } from '@prisma/client'
import jwt from 'jsonwebtoken'
import { z } from 'zod'
import { asyncHandler } from '../middleware/error'
import { encrypt, maskSecret } from '../services/encryption'
import { clearProviderCache } from './oauthClient'

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

    if (!user || user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' })
    }

    next()
  } catch (error) {
    return res.status(500).json({ error: 'Internal server error' })
  }
}

const createProviderSchema = z.object({
  provider: z.string().min(1),
  displayName: z.string().min(1),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  callbackUrl: z.string().url(),
  authorizationUrl: z.string().url(),
  tokenUrl: z.string().url(),
  userinfoUrl: z.string().url(),
  useForLogin: z.boolean().default(true),
  useForFusedMail: z.boolean().default(false),
  mailPlatform: z.enum(['gmail', 'outlook']).nullable().optional(),
  fusedMailCallbackUrl: z.string().url().nullable().optional().or(z.literal(''))
})

const updateProviderSchema = z.object({
  displayName: z.string().min(1).optional(),
  clientId: z.string().min(1).optional(),
  clientSecret: z.string().min(1).optional(),
  callbackUrl: z.string().url().optional(),
  authorizationUrl: z.string().url().optional(),
  tokenUrl: z.string().url().optional(),
  userinfoUrl: z.string().url().optional(),
  useForLogin: z.boolean().optional(),
  useForFusedMail: z.boolean().optional(),
  mailPlatform: z.enum(['gmail', 'outlook']).nullable().optional(),
  fusedMailCallbackUrl: z.string().url().nullable().optional().or(z.literal(''))
})

/** 用途校验：至少勾选一个；勾选融合邮件时必须指定平台 */
export function validateProviderUsage(data: { useForLogin: boolean; useForFusedMail: boolean; mailPlatform?: string | null }): string | null {
  if (!data.useForLogin && !data.useForFusedMail) return 'Select at least one usage (login or fused mail)'
  if (data.useForFusedMail && data.mailPlatform !== 'gmail' && data.mailPlatform !== 'outlook') return 'Fused mail requires a mail platform (gmail or outlook)'
  return null
}

const transformProvider = (provider: any) => ({
  id: provider.id,
  provider: provider.provider,
  displayName: provider.displayName,
  clientId: provider.clientId,
  clientSecret: maskSecret(provider.clientSecret),
  callbackUrl: provider.callbackUrl,
  authorizationUrl: provider.authorizationUrl,
  tokenUrl: provider.tokenUrl,
  userinfoUrl: provider.userinfoUrl,
  isActive: provider.isActive,
  useForLogin: provider.useForLogin,
  useForFusedMail: provider.useForFusedMail,
  mailPlatform: provider.mailPlatform,
  fusedMailCallbackUrl: provider.fusedMailCallbackUrl,
  createdAt: provider.createdAt,
  updatedAt: provider.updatedAt
})

// GET all OAuth providers
router.get('/providers', auth, adminOnly, asyncHandler(async (req: AuthRequest, res: Response) => {
  const providers = await prisma.oAuthProvider.findMany({
    orderBy: { createdAt: 'asc' }
  })

  // 上限只针对登录按钮（登录页最多展示 3 个）
  const activeCount = providers.filter(p => p.isActive && p.useForLogin).length

  res.json({
    providers: providers.map(transformProvider),
    activeCount,
    maxActiveProviders: 3
  })
}))

// GET single OAuth provider
router.get('/providers/:id', auth, adminOnly, asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params

  const provider = await prisma.oAuthProvider.findUnique({
    where: { id }
  })

  if (!provider) {
    return res.status(404).json({ error: 'Provider not found' })
  }

  res.json(transformProvider(provider))
}))

// POST create new OAuth provider
router.post('/providers', auth, adminOnly, asyncHandler(async (req: AuthRequest, res: Response) => {
  const data = createProviderSchema.parse(req.body)

  // Check if provider already exists
  const existing = await prisma.oAuthProvider.findUnique({
    where: { provider: data.provider }
  })

  if (existing) {
    return res.status(400).json({ error: 'Provider already exists' })
  }

  const usageError = validateProviderUsage(data)
  if (usageError) return res.status(400).json({ error: usageError })

  const provider = await prisma.oAuthProvider.create({
    data: {
      provider: data.provider,
      displayName: data.displayName,
      clientId: data.clientId,
      clientSecret: encrypt(data.clientSecret),
      callbackUrl: data.callbackUrl,
      authorizationUrl: data.authorizationUrl,
      tokenUrl: data.tokenUrl,
      userinfoUrl: data.userinfoUrl,
      useForLogin: data.useForLogin,
      useForFusedMail: data.useForFusedMail,
      mailPlatform: data.mailPlatform || null,
      fusedMailCallbackUrl: data.fusedMailCallbackUrl || null
    }
  })

  clearProviderCache(data.provider)

  res.status(201).json(transformProvider(provider))
}))

// PUT update OAuth provider
router.put('/providers/:id', auth, adminOnly, asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params
  const data = updateProviderSchema.parse(req.body)

  const existing = await prisma.oAuthProvider.findUnique({
    where: { id }
  })

  if (!existing) {
    return res.status(404).json({ error: 'Provider not found' })
  }

  const updateData: any = {}

  if (data.displayName) updateData.displayName = data.displayName
  if (data.clientId) updateData.clientId = data.clientId
  if (data.clientSecret) updateData.clientSecret = encrypt(data.clientSecret)
  if (data.callbackUrl) updateData.callbackUrl = data.callbackUrl
  if (data.authorizationUrl) updateData.authorizationUrl = data.authorizationUrl
  if (data.tokenUrl) updateData.tokenUrl = data.tokenUrl
  if (data.userinfoUrl) updateData.userinfoUrl = data.userinfoUrl
  if (data.useForLogin !== undefined) updateData.useForLogin = data.useForLogin
  if (data.useForFusedMail !== undefined) updateData.useForFusedMail = data.useForFusedMail
  if (data.mailPlatform !== undefined) updateData.mailPlatform = data.mailPlatform || null
  if (data.fusedMailCallbackUrl !== undefined) updateData.fusedMailCallbackUrl = data.fusedMailCallbackUrl || null

  const usageError = validateProviderUsage({
    useForLogin: updateData.useForLogin ?? existing.useForLogin,
    useForFusedMail: updateData.useForFusedMail ?? existing.useForFusedMail,
    mailPlatform: updateData.mailPlatform !== undefined ? updateData.mailPlatform : existing.mailPlatform
  })
  if (usageError) return res.status(400).json({ error: usageError })

  const provider = await prisma.oAuthProvider.update({
    where: { id },
    data: updateData
  })

  clearProviderCache(provider.provider)

  res.json(transformProvider(provider))
}))

// DELETE OAuth provider
router.delete('/providers/:id', auth, adminOnly, asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params

  const existing = await prisma.oAuthProvider.findUnique({
    where: { id }
  })

  if (!existing) {
    return res.status(404).json({ error: 'Provider not found' })
  }

  await prisma.oAuthProvider.delete({
    where: { id }
  })

  clearProviderCache(existing.provider)

  res.json({ success: true })
}))

// PATCH toggle OAuth provider active status
router.patch('/providers/:id/toggle', auth, adminOnly, asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params

  const existing = await prisma.oAuthProvider.findUnique({
    where: { id }
  })

  if (!existing) {
    return res.status(404).json({ error: 'Provider not found' })
  }

  if (!existing.isActive && existing.useForLogin) {
    const activeCount = await prisma.oAuthProvider.count({
      where: { isActive: true, useForLogin: true }
    })

    if (activeCount >= 3) {
      return res.status(400).json({ 
        error: 'Maximum 3 active OAuth providers allowed',
        activeCount,
        maxAllowed: 3
      })
    }
  }

  const provider = await prisma.oAuthProvider.update({
    where: { id },
    data: { isActive: !existing.isActive }
  })

  clearProviderCache(provider.provider)

  res.json(transformProvider(provider))
}))

export default router