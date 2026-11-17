/**
 * OAuth 服务商配置路由
 * 管理 OAuth 登录服务商的添加、编辑和删除
 * 仅限管理员用户访问
 */
import { Router, Response } from 'express'
import type { OAuthProvider, Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { adminGuard, AuthRequest } from '../middleware/auth'
import { AppError, asyncHandler } from '../middleware/error'
import { encrypt, maskSecret } from '../services/encryption'
import { invalidateProviderConfig } from '../services/oauth-provider-registry'

const router = Router()

/** 登录页最多展示 / 允许同时启用的第三方登录数量 */
const MAX_ACTIVE_PROVIDERS = 3

const createProviderSchema = z.object({
  provider: z.string().min(1),
  displayName: z.string().min(1),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  callbackUrl: z.string().url(),
  authorizationUrl: z.string().url(),
  tokenUrl: z.string().url(),
  userinfoUrl: z.string().url()
})

const updateProviderSchema = z.object({
  displayName: z.string().min(1).optional(),
  clientId: z.string().min(1).optional(),
  clientSecret: z.string().min(1).optional(),
  callbackUrl: z.string().url().optional(),
  authorizationUrl: z.string().url().optional(),
  tokenUrl: z.string().url().optional(),
  userinfoUrl: z.string().url().optional()
})

const toOAuthProviderDto = (provider: OAuthProvider) => ({
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
  createdAt: provider.createdAt,
  updatedAt: provider.updatedAt
})

// GET all OAuth providers
router.get('/providers', ...adminGuard, asyncHandler(async (req: AuthRequest, res: Response) => {
  const providers = await prisma.oAuthProvider.findMany({
    orderBy: { createdAt: 'asc' }
  })

  // 启用数量上限见 MAX_ACTIVE_PROVIDERS
  const activeCount = providers.filter(p => p.isActive).length

  res.json({
    providers: providers.map(toOAuthProviderDto),
    activeCount,
    maxActiveProviders: MAX_ACTIVE_PROVIDERS
  })
}))

// GET single OAuth provider
router.get('/providers/:id', ...adminGuard, asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params

  const provider = await prisma.oAuthProvider.findUnique({
    where: { id }
  })

  if (!provider) {
    throw new AppError('Provider not found', 404)
  }

  res.json(toOAuthProviderDto(provider))
}))

// POST create new OAuth provider
router.post('/providers', ...adminGuard, asyncHandler(async (req: AuthRequest, res: Response) => {
  const data = createProviderSchema.parse(req.body)

  // Check if provider already exists
  const existing = await prisma.oAuthProvider.findUnique({
    where: { provider: data.provider }
  })

  if (existing) {
    throw new AppError('Provider already exists', 400)
  }

  const provider = await prisma.oAuthProvider.create({
    data: {
      provider: data.provider,
      displayName: data.displayName,
      clientId: data.clientId,
      clientSecret: encrypt(data.clientSecret),
      callbackUrl: data.callbackUrl,
      authorizationUrl: data.authorizationUrl,
      tokenUrl: data.tokenUrl,
      userinfoUrl: data.userinfoUrl
    }
  })

  invalidateProviderConfig(data.provider)

  res.status(201).json(toOAuthProviderDto(provider))
}))

// PUT update OAuth provider
router.put('/providers/:id', ...adminGuard, asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params
  const data = updateProviderSchema.parse(req.body)

  const existing = await prisma.oAuthProvider.findUnique({
    where: { id }
  })

  if (!existing) {
    throw new AppError('Provider not found', 404)
  }

  const updateData: Prisma.OAuthProviderUpdateInput = {}

  if (data.displayName) updateData.displayName = data.displayName
  if (data.clientId) updateData.clientId = data.clientId
  if (data.clientSecret) updateData.clientSecret = encrypt(data.clientSecret)
  if (data.callbackUrl) updateData.callbackUrl = data.callbackUrl
  if (data.authorizationUrl) updateData.authorizationUrl = data.authorizationUrl
  if (data.tokenUrl) updateData.tokenUrl = data.tokenUrl
  if (data.userinfoUrl) updateData.userinfoUrl = data.userinfoUrl
  const provider = await prisma.oAuthProvider.update({
    where: { id },
    data: updateData
  })

  invalidateProviderConfig(provider.provider)

  res.json(toOAuthProviderDto(provider))
}))

// DELETE OAuth provider
router.delete('/providers/:id', ...adminGuard, asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params

  const existing = await prisma.oAuthProvider.findUnique({
    where: { id }
  })

  if (!existing) {
    throw new AppError('Provider not found', 404)
  }

  await prisma.oAuthProvider.delete({
    where: { id }
  })

  invalidateProviderConfig(existing.provider)

  res.json({ success: true })
}))

// PATCH toggle OAuth provider active status
router.patch('/providers/:id/toggle', ...adminGuard, asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params

  const existing = await prisma.oAuthProvider.findUnique({
    where: { id }
  })

  if (!existing) {
    throw new AppError('Provider not found', 404)
  }

  if (!existing.isActive) {
    const activeCount = await prisma.oAuthProvider.count({
      where: { isActive: true }
    })

    if (activeCount >= MAX_ACTIVE_PROVIDERS) {
      return res.status(400).json({ 
        error: `Maximum ${MAX_ACTIVE_PROVIDERS} active OAuth providers allowed`,
        activeCount,
        maxAllowed: MAX_ACTIVE_PROVIDERS
      })
    }
  }

  const provider = await prisma.oAuthProvider.update({
    where: { id },
    data: { isActive: !existing.isActive }
  })

  invalidateProviderConfig(provider.provider)

  res.json(toOAuthProviderDto(provider))
}))

export default router
