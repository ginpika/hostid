/**
 * SSO 单点登录路由
 * 提供会话状态查询和登出功能
 * 用于跨应用单点登录集成
 */
import { Router, Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { memoryStore } from '../store'
import { AppError } from '../middleware/error'

const router = Router()

const SSO_COOKIE_NAME = process.env.SSO_COOKIE_NAME || 'sso_token'
const SSO_COOKIE_DOMAIN = process.env.SSO_COOKIE_DOMAIN || ''
const SSO_COOKIE_PATH = process.env.SSO_COOKIE_PATH || '/'
const SSO_COOKIE_SECURE = process.env.SSO_COOKIE_SECURE === 'true'
const SSO_COOKIE_SAMESITE = (process.env.SSO_COOKIE_SAMESITE || 'lax') as 'strict' | 'lax' | 'none'
const JWT_SECRET = process.env.JWT_SECRET || 'secret'
const SESSION_TTL = parseInt(process.env.SESSION_TTL || '604800', 10) * 1000

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
  userAgent?: string
  ip?: string
}

interface JWTUserPayload {
  userId: string
  username: string
  email: string
  role: string
}

function generateSessionId(): string {
  return crypto.randomBytes(32).toString('hex')
}

function getSessionKey(sessionId: string): string {
  return `sso:session:${sessionId}`
}

function createSessionToken(sessionId: string): string {
  return jwt.sign({ sessionId }, JWT_SECRET, { expiresIn: '7d' })
}

function verifySessionToken(token: string): { sessionId: string } | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { sessionId: string }
    return decoded
  } catch {
    return null
  }
}

async function createSession(user: JWTUserPayload, req: Request): Promise<string> {
  const sessionId = generateSessionId()
  const session: SSOSession = {
    id: sessionId,
    userId: user.userId,
    username: user.username,
    email: user.email,
    role: user.role,
    createdAt: Date.now(),
    expiresAt: Date.now() + SESSION_TTL,
    userAgent: req.headers['user-agent'],
    ip: req.ip || req.socket.remoteAddress
  }
  
  await memoryStore.set(getSessionKey(sessionId), JSON.stringify(session), SESSION_TTL)
  return sessionId
}

async function getSession(sessionId: string): Promise<SSOSession | null> {
  const data = await memoryStore.get(getSessionKey(sessionId))
  if (!data) return null
  
  try {
    return JSON.parse(data) as SSOSession
  } catch {
    return null
  }
}

async function deleteSession(sessionId: string): Promise<void> {
  await memoryStore.delete(getSessionKey(sessionId))
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

function clearSSOCookie(res: Response): void {
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
}

const verifySchema = z.object({
  token: z.string().optional()
})

router.post('/verify', asyncHandler(async (req: Request, res: Response) => {
  const token = req.cookies?.[SSO_COOKIE_NAME] || req.headers.authorization?.replace('Bearer ', '')
  
  if (!token) {
    res.json({ valid: false, error: 'No token provided' })
    return
  }
  
  const decoded = verifySessionToken(token)
  if (!decoded) {
    res.json({ valid: false, error: 'Invalid token' })
    return
  }
  
  const session = await getSession(decoded.sessionId)
  if (!session) {
    res.json({ valid: false, error: 'Session not found' })
    return
  }
  
  if (session.expiresAt < Date.now()) {
    await deleteSession(decoded.sessionId)
    res.json({ valid: false, error: 'Session expired' })
    return
  }
  
  res.json({
    valid: true,
    user: {
      id: session.userId,
      username: session.username,
      email: session.email,
      role: session.role
    }
  })
}))

router.post('/login', asyncHandler(async (req: Request, res: Response) => {
  const { username, password } = req.body
  
  if (!username || !password) {
    throw new AppError('Username and password required', 400)
  }
  
  const user = await prisma.user.findUnique({
    where: { username }
  })
  
  if (!user) {
    throw new AppError('Invalid credentials', 401)
  }
  
  const bcrypt = await import('bcryptjs')
  const isValid = await bcrypt.compare(password, user.password)
  
  if (!isValid) {
    throw new AppError('Invalid credentials', 401)
  }
  
  const sessionId = await createSession({
    userId: user.id,
    username: user.username,
    email: user.email,
    role: user.role
  }, req)
  
  const token = createSessionToken(sessionId)
  setSSOCookie(res, token)
  
  res.json({
    success: true,
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role
    }
  })
}))

router.post('/logout', asyncHandler(async (req: Request, res: Response) => {
  const token = req.cookies?.[SSO_COOKIE_NAME]
  
  if (token) {
    const decoded = verifySessionToken(token)
    if (decoded) {
      await deleteSession(decoded.sessionId)
    }
  }
  
  clearSSOCookie(res)
  res.json({ success: true })
}))

router.get('/session', asyncHandler(async (req: Request, res: Response) => {
  const token = req.cookies?.[SSO_COOKIE_NAME]
  
  if (!token) {
    res.json({ authenticated: false })
    return
  }
  
  const decoded = verifySessionToken(token)
  if (!decoded) {
    clearSSOCookie(res)
    res.json({ authenticated: false })
    return
  }
  
  const session = await getSession(decoded.sessionId)
  if (!session || session.expiresAt < Date.now()) {
    clearSSOCookie(res)
    if (session) {
      await deleteSession(decoded.sessionId)
    }
    res.json({ authenticated: false })
    return
  }
  
  res.json({
    authenticated: true,
    user: {
      id: session.userId,
      username: session.username,
      email: session.email,
      role: session.role
    }
  })
}))

router.get('/apps', asyncHandler(async (req: Request, res: Response) => {
  const apps = await prisma.sSOApp.findMany({
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      domain: true,
      description: true
    }
  })
  
  res.json({ apps })
}))

export default router
