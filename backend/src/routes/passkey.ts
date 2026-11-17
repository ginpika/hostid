/**
 * Passkey (FIDO2 / WebAuthn) 路由
 * 仅负责 HTTP 请求校验、鉴权提取与响应序列化；WebAuthn 逻辑与持久化均在 services/passkey
 */
import { Router, Request, Response } from 'express'
import { z } from 'zod'
import type { RegistrationResponseJSON, AuthenticationResponseJSON } from '@simplewebauthn/server'
import { auth, AuthRequest } from '../middleware/auth'
import { asyncHandler } from '../middleware/error'
import { getSettings } from '../services/settings'
import { extractSessionClientContext, issueAuthSession } from '../services/session'
import {
  createAuthenticationOptions,
  createRegistrationOptionsForUser,
  deletePasskeyForUser,
  listPasskeysForUser,
  renamePasskeyForUser,
  verifyAuthentication,
  verifyRegistrationForUser
} from '../services/passkey'

const router = Router()

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

router.get('/status', (_req: Request, res: Response) => {
  res.json({ enabled: getSettings().passkeyEnabled })
})

router.get('/', auth, asyncHandler(async (req: AuthRequest, res: Response) => {
  const passkeys = await listPasskeysForUser(req.userId!)
  res.json({
    passkeys,
    passkeyLoginEnabled: getSettings().passkeyEnabled
  })
}))

router.post('/register/options', auth, asyncHandler(async (req: AuthRequest, res: Response) => {
  const { authenticatorMode } = registerOptionsSchema.parse(req.body ?? {})
  res.json(await createRegistrationOptionsForUser(req.userId!, req, authenticatorMode))
}))

router.post('/register/verify', auth, asyncHandler(async (req: AuthRequest, res: Response) => {
  const { challengeId, name, response } = registerVerifySchema.parse(req.body ?? {})
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
  const { name } = renamePasskeySchema.parse(req.body ?? {})
  const passkey = await renamePasskeyForUser(req.userId!, req.params.id, name)
  res.json({ passkey })
}))

router.delete('/:id', auth, asyncHandler(async (req: AuthRequest, res: Response) => {
  const credentialId = await deletePasskeyForUser(req.userId!, req.params.id)
  res.json({ success: true, credentialId })
}))

router.post('/login/options', asyncHandler(async (req: Request, res: Response) => {
  res.json(await createAuthenticationOptions(req))
}))

router.post('/login/verify', asyncHandler(async (req: Request, res: Response) => {
  const { challengeId, response } = loginVerifySchema.parse(req.body ?? {})
  const { user } = await verifyAuthentication({
    challengeId,
    response: response as unknown as AuthenticationResponseJSON
  })

  res.json(await issueAuthSession(res, user, extractSessionClientContext(req)))
}))

export default router
