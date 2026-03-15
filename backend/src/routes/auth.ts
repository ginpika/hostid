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
import fs from 'fs'

const router = Router()

const MAIL_DOMAIN = process.env.MAIL_DOMAIN || 'localhost'
const CF_TURNSTILE_SECRET_KEY = process.env.CF_TURNSTILE_SECRET_KEY || ''
const JWT_SECRET = process.env.JWT_SECRET || 'secret'
const SESSION_TTL = parseInt(process.env.SESSION_TTL || '604800', 10) * 1000
const SSO_COOKIE_NAME = process.env.SSO_COOKIE_NAME || 'sso_token'
const SSO_COOKIE_DOMAIN = process.env.SSO_COOKIE_DOMAIN || ''
const SSO_COOKIE_PATH = process.env.SSO_COOKIE_PATH || '/'
const SSO_COOKIE_SECURE = process.env.SSO_COOKIE_SECURE === 'true'
const SSO_COOKIE_SAMESITE = (process.env.SSO_COOKIE_SAMESITE || 'lax') as 'strict' | 'lax' | 'none'

interface TurnstileVerifyResponse {
  success: boolean
  'error-codes'?: string[]
}

async function verifyTurnstile(token: string, ip?: string): Promise<boolean> {
  if (!CF_TURNSTILE_SECRET_KEY) return true
  
  const formData = new URLSearchParams()
  formData.append('secret', CF_TURNSTILE_SECRET_KEY)
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
    expiresAt: Date.now() + SESSION_TTL
  }
  
  await memoryStore.set(getSessionKey(sessionId), JSON.stringify(session), SESSION_TTL)
  return sessionId
}

function setSSOCookie(res: Response, token: string): void {
  const cookieOptions: any = {
    httpOnly: true,
    secure: SSO_COOKIE_SECURE,
    sameSite: SSO_COOKIE_SAMESITE,
    path: SSO_COOKIE_PATH,
    maxAge: SESSION_TTL
  }
  
  if (SSO_COOKIE_DOMAIN) {
    cookieOptions.domain = SSO_COOKIE_DOMAIN
  }
  
  res.cookie(SSO_COOKIE_NAME, token, cookieOptions)
}

router.post('/register', asyncHandler(async (req: Request, res: Response) => {
  const { username, password, turnstileToken } = registerSchema.parse(req.body)
  
  if (CF_TURNSTILE_SECRET_KEY) {
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

  const email = `${username}@${MAIL_DOMAIN}`
  const hashedPassword = await bcrypt.hash(password, 12)
  const user = await prisma.user.create({ data: { email, username, password: hashedPassword } })

  const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET!, { expiresIn: '7d' })
  
  const sessionId = await createSSOSession({
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role
  }, req)
  const ssoToken = jwt.sign({ sessionId }, JWT_SECRET, { expiresIn: '7d' })
  setSSOCookie(res, ssoToken)

  res.status(201).json({
    token,
    user: { id: user.id, email: user.email, username: user.username, nickname: user.nickname, avatar: user.avatar, language: user.language, role: user.role }
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

  const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET!, { expiresIn: '7d' })
  
  const sessionId = await createSSOSession({
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role
  }, req)
  const ssoToken = jwt.sign({ sessionId }, JWT_SECRET, { expiresIn: '7d' })
  setSSOCookie(res, ssoToken)

  res.json({
    token,
    user: { id: user.id, email: user.email, username: user.username, nickname: user.nickname, avatar: user.avatar, language: user.language, role: user.role }
  })
}))

router.get('/me', auth, asyncHandler(async (req: AuthRequest, res: Response) => {
  const user = await prisma.user.findUnique({
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
      createdAt: true 
    }
  })
  res.json(user)
}))

router.post('/logout', asyncHandler(async (req: Request, res: Response) => {
  const token = req.cookies?.[SSO_COOKIE_NAME]
  
  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as { sessionId: string }
      if (decoded?.sessionId) {
        await memoryStore.delete(getSessionKey(decoded.sessionId))
      }
    } catch (e) {
      // Token invalid, ignore
    }
  }
  
  const cookieOptions: any = {
    httpOnly: true,
    secure: SSO_COOKIE_SECURE,
    sameSite: SSO_COOKIE_SAMESITE,
    path: SSO_COOKIE_PATH
  }
  
  if (SSO_COOKIE_DOMAIN) {
    cookieOptions.domain = SSO_COOKIE_DOMAIN
  }
  
  res.clearCookie(SSO_COOKIE_NAME, cookieOptions)
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

  res.json(updatedUser)
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
  res.json({ domain: MAIL_DOMAIN })
})

router.post('/avatar', auth, avatarUpload.single('avatar'), asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.file) {
    throw new AppError('No file uploaded', 400)
  }

  const user = await prisma.user.findUnique({
    where: { id: req.userId },
    select: { avatar: true }
  })

  if (user?.avatar) {
    const oldAvatarPath = getAvatarPath(user.avatar)
    if (fs.existsSync(oldAvatarPath)) {
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
  
  if (!fs.existsSync(filePath)) {
    throw new AppError('Avatar not found', 404)
  }

  res.setHeader('Cache-Control', 'public, max-age=31536000')
  res.sendFile(filePath)
}))

const changePasswordSchema = z.object({
  oldPassword: z.string(),
  newPassword: z.string()
})

router.post('/password', auth, asyncHandler(async (req: AuthRequest, res: Response) => {
  const { oldPassword, newPassword } = changePasswordSchema.parse(req.body)

  let decryptedOldPassword: string
  let decryptedNewPassword: string
  try {
    decryptedOldPassword = decryptPassword(oldPassword)
    decryptedNewPassword = decryptPassword(newPassword)
  } catch {
    throw new AppError('Invalid password format', 400)
  }

  if (decryptedOldPassword.length < 6 || decryptedNewPassword.length < 6) {
    throw new AppError('Password must be at least 6 characters', 400)
  }

  const user = await prisma.user.findUnique({
    where: { id: req.userId },
    select: { password: true }
  })

  if (!user) {
    throw new AppError('User not found', 404)
  }

  const isValid = await bcrypt.compare(decryptedOldPassword, user.password)
  if (!isValid) {
    throw new AppError('Current password is incorrect', 400)
  }

  const hashedPassword = await bcrypt.hash(decryptedNewPassword, 12)
  
  await prisma.user.update({
    where: { id: req.userId },
    data: { password: hashedPassword }
  })

  res.json({ success: true })
}))

export default router
