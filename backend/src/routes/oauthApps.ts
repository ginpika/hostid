/**
 * OAuth 应用管理路由
 * 管理 OAuth 授权应用的创建、编辑和密钥重置
 * 仅限管理员用户访问
 */
import { Router, Response } from 'express'
import type { OAuthApp, Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { adminGuard, AuthRequest } from '../middleware/auth'
import { AppError, asyncHandler } from '../middleware/error'
import { maskSecret } from '../services/encryption'
import {
  generateClientId,
  generateClientSecret,
  encryptClientSecret
} from '../services/oauth2'

const router = Router()

const createAppSchema = z.object({
  name: z.string().min(1).max(100),
  redirectUris: z.array(z.string().url()).min(1),
  description: z.string().max(500).optional(),
  homepage: z.string().url().optional(),
  isConfidential: z.boolean().optional()
})

const updateAppSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  redirectUris: z.array(z.string().url()).min(1).optional(),
  description: z.string().max(500).optional(),
  homepage: z.string().url().optional(),
  isConfidential: z.boolean().optional()
})

function parseRedirectUris(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

const toOAuthAppDto = (app: OAuthApp & { user?: { id: string; username: string; email: string } }) => ({
  id: app.id,
  name: app.name,
  clientId: app.clientId,
  clientSecret: maskSecret(app.clientSecret),
  redirectUris: parseRedirectUris(app.redirectUris),
  description: app.description,
  homepage: app.homepage,
  isConfidential: app.isConfidential,
  isActive: app.isActive,
  userId: app.userId,
  createdAt: app.createdAt,
  updatedAt: app.updatedAt
})

// GET all OAuth Apps
router.get('/', ...adminGuard, asyncHandler(async (req: AuthRequest, res: Response) => {
  const apps = await prisma.oAuthApp.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      user: {
        select: { id: true, username: true, email: true }
      }
    }
  })

  res.json({
    apps: apps.map(app => toOAuthAppDto(app))
  })
}))

// GET single OAuth App
router.get('/:id', ...adminGuard, asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params

  const app = await prisma.oAuthApp.findUnique({
    where: { id },
    include: {
      user: {
        select: { id: true, username: true, email: true }
      }
    }
  })

  if (!app) {
    throw new AppError('OAuth App not found', 404)
  }

  res.json(toOAuthAppDto(app))
}))

// POST create new OAuth App
router.post('/', ...adminGuard, asyncHandler(async (req: AuthRequest, res: Response) => {
  const data = createAppSchema.parse(req.body)

  const clientId = generateClientId()
  const clientSecret = generateClientSecret()

  const app = await prisma.oAuthApp.create({
    data: {
      name: data.name,
      clientId,
      clientSecret: encryptClientSecret(clientSecret),
      redirectUris: JSON.stringify(data.redirectUris),
      description: data.description || null,
      homepage: data.homepage || null,
      isConfidential: data.isConfidential ?? true,
      userId: req.userId!
    },
    include: {
      user: {
        select: { id: true, username: true, email: true }
      }
    }
  })

  // 返回完整的 clientSecret（仅在创建时显示一次）
  res.status(201).json({
    ...toOAuthAppDto(app),
    clientSecret, // 显示明文密钥
    secretWarning: 'This secret is shown only once. Save it immediately!'
  })
}))

// PUT update OAuth App
router.put('/:id', ...adminGuard, asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params
  const data = updateAppSchema.parse(req.body)

  const existing = await prisma.oAuthApp.findUnique({
    where: { id }
  })

  if (!existing) {
    throw new AppError('OAuth App not found', 404)
  }

  const updateData: Prisma.OAuthAppUpdateInput = {}

  if (data.name) updateData.name = data.name
  if (data.redirectUris) updateData.redirectUris = JSON.stringify(data.redirectUris)
  if (data.description !== undefined) updateData.description = data.description || null
  if (data.homepage !== undefined) updateData.homepage = data.homepage || null
  if (data.isConfidential !== undefined) updateData.isConfidential = data.isConfidential

  const app = await prisma.oAuthApp.update({
    where: { id },
    data: updateData,
    include: {
      user: {
        select: { id: true, username: true, email: true }
      }
    }
  })

  res.json(toOAuthAppDto(app))
}))

// DELETE OAuth App
router.delete('/:id', ...adminGuard, asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params

  const existing = await prisma.oAuthApp.findUnique({
    where: { id }
  })

  if (!existing) {
    throw new AppError('OAuth App not found', 404)
  }

  await prisma.oAuthApp.delete({
    where: { id }
  })

  res.json({ success: true })
}))

// POST reset client secret
router.post('/:id/reset-secret', ...adminGuard, asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params

  const existing = await prisma.oAuthApp.findUnique({
    where: { id }
  })

  if (!existing) {
    throw new AppError('OAuth App not found', 404)
  }

  const newClientSecret = generateClientSecret()

  const app = await prisma.oAuthApp.update({
    where: { id },
    data: {
      clientSecret: encryptClientSecret(newClientSecret)
    },
    include: {
      user: {
        select: { id: true, username: true, email: true }
      }
    }
  })

  // 返回新的 clientSecret
  res.json({
    ...toOAuthAppDto(app),
    clientSecret: newClientSecret,
    secretWarning: 'This secret is shown only once. Save it immediately!'
  })
}))

// PATCH toggle OAuth App active status
router.patch('/:id/toggle', ...adminGuard, asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params

  const existing = await prisma.oAuthApp.findUnique({
    where: { id }
  })

  if (!existing) {
    throw new AppError('OAuth App not found', 404)
  }

  const app = await prisma.oAuthApp.update({
    where: { id },
    data: { isActive: !existing.isActive },
    include: {
      user: {
        select: { id: true, username: true, email: true }
      }
    }
  })

  res.json(toOAuthAppDto(app))
}))

export default router