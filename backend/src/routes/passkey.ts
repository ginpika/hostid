/**
 * Passkey (FIDO2 / WebAuthn) 路由
 * 提供用户个人资料通行密钥管理（增删改查）以及无密码登录接口
 */
import { Router, Request, Response } from 'express'
import { z } from 'zod'
import type { RegistrationResponseJSON, AuthenticationResponseJSON } from '@simplewebauthn/server'
import { prisma } from '../lib/prisma'
import { auth, AuthRequest } from '../middleware/auth'
import { AppError, asyncHandler } from '../middleware/error'
import { getSettings } from '../services/settings'
import { issueAuthSession } from '../services/session'
import {
  createAuthenticationOptions,
  createRegistrationOptionsForUser,
  formatPasskeyRecord,
  verifyAuthentication,
  verifyRegistrationForUser
} from '../services/passkey'

const router = Router()

function parseBody<T>(schema: z.ZodSchema<T>, body: unknown): T {
  const result = schema.safeParse(body)
  if (!result.success) {
    throw new AppError(result.error.issues[0]?.message || 'Invalid request payload', 400)
  }
  return result.data
}

const registerOptionsSchema = z.object({
  authenticatorMode: z.enum(['platform', 'all']).optional().default('platform')
})

const registerVerifySchema = z.object({
  challengeId: z.string().uuid(),
  name: z.string().max(64).optional(),
  response: z.object({
    id: z.string().min(1),
    rawId: z.string().min(1),
    type: z.literal('public-key'),
    response: z.object({
      clientDataJSON: z.string().min(1),
      attestationObject: z.string().min(1)
    }).passthrough()
  }).passthrough()
})

const renamePasskeySchema = z.object({
  name: z.string().trim().min(1, 'Passkey name is required').max(64)
})

const loginVerifySchema = z.object({
  challengeId: z.string().uuid(),
  response: z.object({
    id: z.string().min(1),
    rawId: z.string().min(1),
    type: z.literal('public-key'),
    response: z.object({
      clientDataJSON: z.string().min(1),
      authenticatorData: z.string().min(1),
      signature: z.string().min(1)
    }).passthrough()
  }).passthrough()
})

router.get('/status', (req: Request, res: Response) => {
  res.json({ enabled: getSettings().passkeyEnabled })
})

router.get('/', auth, asyncHandler(async (req: AuthRequest, res: Response) => {
  const passkeys = await prisma.passkey.findMany({
    where: { userId: req.userId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      credentialId: true,
      name: true,
      deviceType: true,
      backedUp: true,
      transports: true,
      aaguid: true,
      lastUsedAt: true,
      createdAt: true
    }
  })

  res.json({
    passkeys: passkeys.map(formatPasskeyRecord),
    passkeyLoginEnabled: getSettings().passkeyEnabled
  })
}))

router.post('/register/options', auth, asyncHandler(async (req: AuthRequest, res: Response) => {
  const { authenticatorMode } = parseBody(registerOptionsSchema, req.body ?? {})
  const result = await createRegistrationOptionsForUser(req.userId!, req, authenticatorMode)
  res.json(result)
}))

router.post('/register/verify', auth, asyncHandler(async (req: AuthRequest, res: Response) => {
  const { challengeId, name, response } = parseBody(registerVerifySchema, req.body)
  const passkey = await verifyRegistrationForUser({
    userId: req.userId!,
    challengeId,
    name,
    response: response as unknown as RegistrationResponseJSON,
    userAgent: req.get('user-agent')
  })

  res.status(201).json({ passkey })
}))

router.patch('/:id', auth, asyncHandler(async (req: AuthRequest, res: Response) => {
  const { name } = parseBody(renamePasskeySchema, req.body)
  const existing = await prisma.passkey.findUnique({
    where: { id: req.params.id },
    select: { id: true, userId: true }
  })

  if (!existing || existing.userId !== req.userId) {
    throw new AppError('Passkey not found', 404)
  }

  const updated = await prisma.passkey.update({
    where: { id: existing.id },
    data: { name },
    select: {
      id: true,
      credentialId: true,
      name: true,
      deviceType: true,
      backedUp: true,
      transports: true,
      aaguid: true,
      lastUsedAt: true,
      createdAt: true
    }
  })

  res.json({ passkey: formatPasskeyRecord(updated) })
}))

router.delete('/:id', auth, asyncHandler(async (req: AuthRequest, res: Response) => {
  const existing = await prisma.passkey.findUnique({
    where: { id: req.params.id },
    select: { id: true, userId: true, credentialId: true }
  })

  if (!existing || existing.userId !== req.userId) {
    throw new AppError('Passkey not found', 404)
  }

  await prisma.passkey.delete({ where: { id: existing.id } })
  res.json({ success: true, credentialId: existing.credentialId })
}))

router.post('/login/options', asyncHandler(async (req: Request, res: Response) => {
  const result = await createAuthenticationOptions(req)
  res.json(result)
}))

router.post('/login/verify', asyncHandler(async (req: Request, res: Response) => {
  const { challengeId, response } = parseBody(loginVerifySchema, req.body)
  const { user } = await verifyAuthentication({
    challengeId,
    response: response as unknown as AuthenticationResponseJSON
  })

  const authPayload = await issueAuthSession(res, user)
  res.json(authPayload)
}))

export default router
