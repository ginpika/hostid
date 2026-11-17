/**
 * 认证路由
 * 仅负责 HTTP 入参校验、文件流输出与 SSO 会话 Cookie 编排；
 * 注册、登录鉴权、改密与资料更新均委托给 services/auth
 */
import { Router, Request, Response } from 'express'
import fs from 'node:fs/promises'
import { z } from 'zod'
import { auth, AuthRequest } from '../middleware/auth'
import { AppError, asyncHandler } from '../middleware/error'
import { avatarUpload, getAvatarPath } from '../middleware/avatarUpload'
import { getPublicKey } from '../utils/rsa'
import { USERNAME_PATTERN } from '../lib/domain-constants'
import { getSettings, getSiteBranding } from '../services/settings'
import { clearSSOCookie, extractSessionClientContext, issueAuthSession, revokeSessionByToken } from '../services/session'
import {
  authenticateWithPassword,
  changeUserPassword,
  getCurrentUserProfile,
  registerLocalUser,
  updateUserAvatar,
  updateUserLanguage,
  updateUserProfile
} from '../services/auth'

const router = Router()

const registerSchema = z.object({
  username: z.string().min(3).max(30).regex(USERNAME_PATTERN, 'Username can only contain letters, numbers, dots and underscores'),
  password: z.string().min(6),
  turnstileToken: z.string().optional()
})

const loginSchema = z.object({
  username: z.string().min(3).max(30).regex(USERNAME_PATTERN, 'Invalid username format'),
  password: z.string()
})

const updateProfileSchema = z.object({
  nickname: z.string().max(50).optional(),
  phone: z.string().max(20).optional(),
  birthday: z.string().optional()
})

const updateLanguageSchema = z.object({
  language: z.enum(['zh-CN', 'en-US'])
})

const changePasswordSchema = z.object({
  oldPassword: z.string().optional(),
  newPassword: z.string()
})

router.get('/public-key', (_req: Request, res: Response) => {
  res.json({ publicKey: getPublicKey() })
})

router.post('/register', asyncHandler(async (req: Request, res: Response) => {
  const { username, password, turnstileToken } = registerSchema.parse(req.body)
  const user = await registerLocalUser({
    username,
    password,
    turnstileToken,
    ip: req.ip || req.socket.remoteAddress
  })

  res.status(201).json(await issueAuthSession(res, user, extractSessionClientContext(req)))
}))

router.post('/login', asyncHandler(async (req: Request, res: Response) => {
  const { username, password } = loginSchema.parse(req.body)
  const user = await authenticateWithPassword(username, password)

  res.json(await issueAuthSession(res, user, extractSessionClientContext(req)))
}))

router.get('/me', auth, asyncHandler(async (req: AuthRequest, res: Response) => {
  res.json(await getCurrentUserProfile(req.userId!))
}))

router.post('/logout', asyncHandler(async (req: Request, res: Response) => {
  const token = req.cookies?.[getSettings().ssoCookieName]
  if (token) {
    await revokeSessionByToken(token)
  }

  clearSSOCookie(res)
  res.json({ success: true })
}))

router.patch('/profile', auth, asyncHandler(async (req: AuthRequest, res: Response) => {
  const data = updateProfileSchema.parse(req.body)
  res.json(await updateUserProfile(req.userId!, data))
}))

router.patch('/language', auth, asyncHandler(async (req: AuthRequest, res: Response) => {
  const { language } = updateLanguageSchema.parse(req.body)
  res.json(await updateUserLanguage(req.userId!, language))
}))

router.get('/domain', (_req: Request, res: Response) => {
  res.json({ domain: getSettings().mailDomain })
})

router.get('/site', (_req: Request, res: Response) => {
  res.set('Cache-Control', 'no-store')
  res.json(getSiteBranding())
})

router.post('/avatar', auth, avatarUpload.single('avatar'), asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.file) {
    throw new AppError('No file uploaded', 400)
  }

  res.json(await updateUserAvatar(req.userId!, req.file.filename))
}))

router.get('/avatar/:filename', asyncHandler(async (req: Request, res: Response) => {
  const filePath = getAvatarPath(req.params.filename)
  if (!filePath) {
    throw new AppError('Avatar not found', 404)
  }

  try {
    await fs.access(filePath)
  } catch {
    throw new AppError('Avatar not found', 404)
  }

  res.setHeader('Cache-Control', 'public, max-age=31536000')
  res.sendFile(filePath)
}))

router.post('/password', auth, asyncHandler(async (req: AuthRequest, res: Response) => {
  const payload = changePasswordSchema.parse(req.body)
  await changeUserPassword(req.userId!, payload)
  res.json({ success: true, hasPassword: true })
}))

export default router
