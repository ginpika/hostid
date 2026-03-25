import { Router, Request, Response, NextFunction } from 'express'
import { PrismaClient } from '@prisma/client'
import jwt from 'jsonwebtoken'
import { z } from 'zod'
import { asyncHandler } from '../middleware/error'
import { encrypt, maskSecret } from '../services/encryption'
import { clearProviderCache } from './oauth'

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
  scope: z.string().optional()
})

const updateProviderSchema = z.object({
  displayName: z.string().min(1).optional(),
  clientId: z.string().min(1).optional(),
  clientSecret: z.string().min(1).optional(),
  callbackUrl: z.string().url().optional(),
  scope: z.string().optional()
})

// Transform provider for API response (mask secret)
const transformProvider = (provider: any) => ({
  id: provider.id,
  provider: provider.provider,
  displayName: provider.displayName,
  clientId: provider.clientId,
  clientSecret: maskSecret(provider.clientSecret),
  callbackUrl: provider.callbackUrl,
  scope: provider.scope,
  isActive: provider.isActive,
  createdAt: provider.createdAt,
  updatedAt: provider.updatedAt
})

// GET all OAuth providers
router.get('/providers', auth, adminOnly, asyncHandler(async (req: AuthRequest, res: Response) => {
  const providers = await prisma.oAuthProvider.findMany({
    orderBy: { createdAt: 'asc' }
  })

  res.json({
    providers: providers.map(transformProvider)
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

  const provider = await prisma.oAuthProvider.create({
    data: {
      provider: data.provider,
      displayName: data.displayName,
      clientId: data.clientId,
      clientSecret: encrypt(data.clientSecret),
      callbackUrl: data.callbackUrl,
      scope: data.scope || ''
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
  if (data.scope !== undefined) updateData.scope = data.scope

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

  const provider = await prisma.oAuthProvider.update({
    where: { id },
    data: { isActive: !existing.isActive }
  })

  clearProviderCache(provider.provider)

  res.json(transformProvider(provider))
}))

export default router