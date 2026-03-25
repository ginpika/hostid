import { Router, Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { asyncHandler } from '../middleware/error'
import { maskSecret } from '../services/encryption'
import {
  generateClientId,
  generateClientSecret,
  encryptClientSecret,
  decryptClientSecret
} from '../services/oauth2'

const router = Router()

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

const createAppSchema = z.object({
  name: z.string().min(1).max(100),
  redirectUris: z.array(z.string().url()).min(1),
  description: z.string().max(500).optional(),
  homepage: z.string().url().optional(),
  scope: z.string().optional(),
  isConfidential: z.boolean().optional()
})

const updateAppSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  redirectUris: z.array(z.string().url()).min(1).optional(),
  description: z.string().max(500).optional(),
  homepage: z.string().url().optional(),
  scope: z.string().optional(),
  isConfidential: z.boolean().optional()
})

// Transform OAuth App for API response (mask secret)
const transformApp = (app: any, includeSecret = false) => ({
  id: app.id,
  name: app.name,
  clientId: app.clientId,
  clientSecret: includeSecret ? decryptClientSecret(app.clientSecret) : maskSecret(app.clientSecret),
  redirectUris: JSON.parse(app.redirectUris),
  description: app.description,
  homepage: app.homepage,
  scope: app.scope,
  isConfidential: app.isConfidential,
  isActive: app.isActive,
  userId: app.userId,
  createdAt: app.createdAt,
  updatedAt: app.updatedAt
})

// GET all OAuth Apps
router.get('/', auth, adminOnly, asyncHandler(async (req: AuthRequest, res: Response) => {
  const apps = await prisma.oAuthApp.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      user: {
        select: { id: true, username: true, email: true }
      }
    }
  })

  res.json({
    apps: apps.map(app => transformApp(app))
  })
}))

// GET single OAuth App
router.get('/:id', auth, adminOnly, asyncHandler(async (req: AuthRequest, res: Response) => {
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
    return res.status(404).json({ error: 'OAuth App not found' })
  }

  res.json(transformApp(app))
}))

// POST create new OAuth App
router.post('/', auth, adminOnly, asyncHandler(async (req: AuthRequest, res: Response) => {
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
      scope: data.scope || 'openid profile email',
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
    ...transformApp(app),
    clientSecret, // 显示明文密钥
    secretWarning: 'This secret is shown only once. Save it immediately!'
  })
}))

// PUT update OAuth App
router.put('/:id', auth, adminOnly, asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params
  const data = updateAppSchema.parse(req.body)

  const existing = await prisma.oAuthApp.findUnique({
    where: { id }
  })

  if (!existing) {
    return res.status(404).json({ error: 'OAuth App not found' })
  }

  const updateData: any = {}

  if (data.name) updateData.name = data.name
  if (data.redirectUris) updateData.redirectUris = JSON.stringify(data.redirectUris)
  if (data.description !== undefined) updateData.description = data.description || null
  if (data.homepage !== undefined) updateData.homepage = data.homepage || null
  if (data.scope) updateData.scope = data.scope
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

  res.json(transformApp(app))
}))

// DELETE OAuth App
router.delete('/:id', auth, adminOnly, asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params

  const existing = await prisma.oAuthApp.findUnique({
    where: { id }
  })

  if (!existing) {
    return res.status(404).json({ error: 'OAuth App not found' })
  }

  await prisma.oAuthApp.delete({
    where: { id }
  })

  res.json({ success: true })
}))

// POST reset client secret
router.post('/:id/reset-secret', auth, adminOnly, asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params

  const existing = await prisma.oAuthApp.findUnique({
    where: { id }
  })

  if (!existing) {
    return res.status(404).json({ error: 'OAuth App not found' })
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
    ...transformApp(app),
    clientSecret: newClientSecret,
    secretWarning: 'This secret is shown only once. Save it immediately!'
  })
}))

// PATCH toggle OAuth App active status
router.patch('/:id/toggle', auth, adminOnly, asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params

  const existing = await prisma.oAuthApp.findUnique({
    where: { id }
  })

  if (!existing) {
    return res.status(404).json({ error: 'OAuth App not found' })
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

  res.json(transformApp(app))
}))

export default router