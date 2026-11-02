/**
 * 认证路由
 * 处理用户注册、登录、注销和用户信息管理
 * 包含 RSA 密码解密、头像上传和 SSO 会话管理
 */
import { Router, Request, Response, NextFunction } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { auth, AuthRequest } from '../middleware/auth'
import { AppError } from '../middleware/error'
import { memoryStore } from '../store'
import { avatarUpload, getAvatarPath } from '../middleware/avatarUpload'
import { getPublicKey, decryptPassword } from '../utils/rsa'
import { getAvatarUrl } from '../utils/avatar'
import fs from 'fs'
import { getJwtSecret } from '../config/secrets'
import { getSettings, getSessionTtlMs } from '../services/settings'

const router = Router()


interface TurnstileVerifyResponse {
  success: boolean
  'error-codes'?: string[]
}

async function verifyTurnstile(token: string, ip?: string): Promise<boolean> {
  if (!getSettings().turnstileSecretKey) return true
  
  const formData = new URLSearchParams()
  formData.append('secret', getSettings().turnstileSecretKey)
  formData.append('response', token)
  if (ip) formData.append('remoteip', ip)

  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: formData
  })

  const data = await res.json() as TurnstileVerifyResponse
  return data.success === true
}

const usernameRegex = /^[a-zA-Z0-9._]+$/

const registerSchema = z.object({
  username: z.string().min(3).max(30).regex(usernameRegex, 'Username can only contain letters, numbers, dots and underscores'),
  password: z.string().min(6),
  turnstileToken: z.string().optional()
})

const loginSchema = z.object({
  username: z.string().min(3).max(30).regex(usernameRegex, 'Invalid username format'),
  password: z.string()
})

const updateLanguageSchema = z.object({
  language: z.enum(['zh-CN', 'en-US'])
})

const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next)
  }
}

interface SSOSession {
  id: string
  userId: string
  username: string
  email: string
  role: string
  createdAt: number
  expiresAt: number
}

function generateSessionId(): string {
  return crypto.randomBytes(32).toString('hex')
}

router.get('/public-key', (req: Request, res: Response) => {
  res.json({ publicKey: getPublicKey() })
})

function getSessionKey(sessionId: string): string {
  return `sso:session:${sessionId}`
}

async function createSSOSession(user: { id: string; username: string; email: string; role: string }, req: Request): Promise<string> {
  const sessionId = generateSessionId()
  const session: SSOSession = {
    id: sessionId,
    userId: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    createdAt: Date.now(),
    expiresAt: Date.now() + getSessionTtlMs()
  }
  
  await memoryStore.set(getSessionKey(sessionId), JSON.stringify(session), getSessionTtlMs())
  return sessionId
}

function setSSOCookie(res: Response, token: string): void {
  const cookieOptions: any = {
    httpOnly: true,
    secure: getSettings().ssoCookieSecure,
    sameSite: (getSettings().ssoCookieSameSite as 'strict' | 'lax' | 'none'),
    path: getSettings().ssoCookiePath,
    maxAge: getSessionTtlMs()
  }
  
  if (getSettings().ssoCookieDomain) {
    cookieOptions.domain = getSettings().ssoCookieDomain
  }
  
  res.cookie(getSettings().ssoCookieName, token, cookieOptions)
}

router.post('/register', asyncHandler(async (req: Request, res: Response) => {
  const { username, password, turnstileToken } = registerSchema.parse(req.body)
  
  if (getSettings().turnstileSecretKey) {
    if (!turnstileToken) {
      throw new AppError('Turnstile verification required', 400)
    }
    const ip = req.ip || req.socket.remoteAddress
    const isValid = await verifyTurnstile(turnstileToken, ip)
    if (!isValid) {
      throw new AppError('Turnstile verification failed', 400)
    }
  }
  
  const existingUser = await prisma.user.findUnique({ where: { username } })
  if (existingUser) {
    throw new AppError('Username already taken', 400)
  }

  const email = `${username}@${getSettings().mailDomain}`
  const hashedPassword = await bcrypt.hash(password, 12)
  const user = await prisma.user.create({ data: { email, username, password: hashedPassword } })

  const token = jwt.sign({ userId: user.id }, getJwtSecret(), { expiresIn: '7d' })
  
  const sessionId = await createSSOSession({
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role
  }, req)
  const ssoToken = jwt.sign({ sessionId }, getJwtSecret(), { expiresIn: '7d' })
  setSSOCookie(res, ssoToken)

  res.status(201).json({
    token,
    user: { 
      id: user.id, 
      email: user.email, 
      username: user.username, 
      nickname: user.nickname, 
      avatar: user.avatar,
      avatarUrl: getAvatarUrl(user.avatar),
      language: user.language, 
      role: user.role 
    }
  })
}))

router.post('/login', asyncHandler(async (req: Request, res: Response) => {
  const { username, password } = loginSchema.parse(req.body)

  const user = await prisma.user.findUnique({ where: { username } })
  if (!user) {
    throw new AppError('Invalid credentials', 401)
  }

  let decryptedPassword: string
  try {
    decryptedPassword = decryptPassword(password)
  } catch {
    throw new AppError('Invalid credentials', 401)
  }

  const isValid = await bcrypt.compare(decryptedPassword, user.password)
  if (!isValid) {
    throw new AppError('Invalid credentials', 401)
  }

  const token = jwt.sign({ userId: user.id }, getJwtSecret(), { expiresIn: '7d' })
  
  const sessionId = await createSSOSession({
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role
  }, req)
  const ssoToken = jwt.sign({ sessionId }, getJwtSecret(), { expiresIn: '7d' })
  setSSOCookie(res, ssoToken)

  res.json({
    token,
    user: { 
      id: user.id, 
      email: user.email, 
      username: user.username, 
      nickname: user.nickname, 
      avatar: user.avatar,
      avatarUrl: getAvatarUrl(user.avatar),
      language: user.language, 
      role: user.role 
    }
  })
}))

router.get('/me', auth, asyncHandler(async (req: AuthRequest, res: Response) => {
  const [user, passwordExists] = await Promise.all([
    prisma.user.findUnique({
      where: { id: req.userId },
      select: { 
        id: true, 
        email: true, 
        username: true,
        nickname: true,
        phone: true,
        birthday: true,
        avatar: true,
        language: true,
        role: true,
        githubId: true,
        createdAt: true 
      }
    }),
    prisma.user.findUnique({
      where: { id: req.userId },
      select: { password: true }
    })
  ])
  res.json({ 
    ...user, 
    hasPassword: !!passwordExists?.password,
    avatarUrl: getAvatarUrl(user?.avatar)
  })
}))

router.post('/logout', asyncHandler(async (req: Request, res: Response) => {
  const token = req.cookies?.[getSettings().ssoCookieName]
  
  if (token) {
    try {
      const decoded = jwt.verify(token, getJwtSecret()) as { sessionId: string }
      if (decoded?.sessionId) {
        await memoryStore.delete(getSessionKey(decoded.sessionId))
      }
    } catch (e) {
      // Token invalid, ignore
    }
  }
  
  const cookieOptions: any = {
    httpOnly: true,
    secure: getSettings().ssoCookieSecure,
    sameSite: (getSettings().ssoCookieSameSite as 'strict' | 'lax' | 'none'),
    path: getSettings().ssoCookiePath
  }
  
  if (getSettings().ssoCookieDomain) {
    cookieOptions.domain = getSettings().ssoCookieDomain
  }
  
  res.clearCookie(getSettings().ssoCookieName, cookieOptions)
  res.json({ success: true })
}))

const updateProfileSchema = z.object({
  nickname: z.string().max(50).optional(),
  phone: z.string().max(20).optional(),
  birthday: z.string().optional()
})

router.patch('/profile', auth, asyncHandler(async (req: AuthRequest, res: Response) => {
  const data = updateProfileSchema.parse(req.body)

  const updatedUser = await prisma.user.update({
    where: { id: req.userId },
    data,
    select: { 
      id: true, 
      email: true, 
      username: true,
      nickname: true,
      phone: true,
      birthday: true,
      avatar: true,
      language: true,
      createdAt: true 
    }
  })

  res.json({
    ...updatedUser,
    avatarUrl: getAvatarUrl(updatedUser.avatar)
  })
}))

router.patch('/language', auth, asyncHandler(async (req: AuthRequest, res: Response) => {
  const { language } = updateLanguageSchema.parse(req.body)

  const updatedUser = await prisma.user.update({
    where: { id: req.userId },
    data: { language },
    select: { id: true, email: true, username: true, language: true }
  })

  res.json(updatedUser)
}))

router.get('/domain', (req: Request, res: Response) => {
  res.json({ domain: getSettings().mailDomain })
})

router.post('/avatar', auth, avatarUpload.single('avatar'), asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.file) {
    throw new AppError('No file uploaded', 400)
  }

  const user = await prisma.user.findUnique({
    where: { id: req.userId },
    select: { avatar: true }
  })

  // 仅当旧文件名与新文件名不同时才删除旧文件
  // 因为 multer 使用 ${userId}${ext} 命名，相同后缀的文件已被 multer 覆盖
  if (user?.avatar && user.avatar !== req.file.filename) {
    const oldAvatarPath = getAvatarPath(user.avatar)
    if (oldAvatarPath && fs.existsSync(oldAvatarPath)) {
      fs.unlinkSync(oldAvatarPath)
    }
  }

  const avatarUrl = `/api/auth/avatar/${req.file.filename}`
  
  const updatedUser = await prisma.user.update({
    where: { id: req.userId },
    data: { avatar: req.file.filename },
    select: { 
      id: true, 
      email: true, 
      username: true,
      nickname: true,
      avatar: true 
    }
  })

  res.json({ ...updatedUser, avatarUrl })
}))

router.get('/avatar/:filename', asyncHandler(async (req: Request, res: Response) => {
  const { filename } = req.params
  const filePath = getAvatarPath(filename)
  
  if (!filePath || !fs.existsSync(filePath)) {
    throw new AppError('Avatar not found', 404)
  }

  res.setHeader('Cache-Control', 'public, max-age=31536000')
  res.sendFile(filePath)
}))

const changePasswordSchema = z.object({
  oldPassword: z.string().optional(),
  newPassword: z.string()
})

router.post('/password', auth, asyncHandler(async (req: AuthRequest, res: Response) => {
  const { oldPassword, newPassword } = changePasswordSchema.parse(req.body)

  let decryptedNewPassword: string
  try {
    decryptedNewPassword = decryptPassword(newPassword)
  } catch {
    throw new AppError('Invalid password format', 400)
  }

  if (decryptedNewPassword.length < 6) {
    throw new AppError('Password must be at least 6 characters', 400)
  }

  const user = await prisma.user.findUnique({
    where: { id: req.userId },
    select: { password: true }
  })

  if (!user) {
    throw new AppError('User not found', 404)
  }

  if (user.password) {
    if (!oldPassword) {
      throw new AppError('Current password is required', 400)
    }
    let decryptedOldPassword: string
    try {
      decryptedOldPassword = decryptPassword(oldPassword)
    } catch {
      throw new AppError('Invalid password format', 400)
    }
    const isValid = await bcrypt.compare(decryptedOldPassword, user.password)
    if (!isValid) {
      throw new AppError('Current password is incorrect', 400)
    }
  }

  const hashedPassword = await bcrypt.hash(decryptedNewPassword, 12)
  
  await prisma.user.update({
    where: { id: req.userId },
    data: { password: hashedPassword }
  })

  res.json({ success: true, hasPassword: true })
}))

export default router
