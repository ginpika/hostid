/**
 * SSO 单点登录路由
 * 提供会话状态查询和登出功能
 * 用于跨应用单点登录集成；会话生命周期全部委托给 services/session
 */
import { Router, Request, Response, type RequestHandler } from 'express'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import rateLimit from 'express-rate-limit'
import { prisma } from '../lib/prisma'
import { AppError, asyncHandler } from '../middleware/error'
import { getAvatarUrl } from '../utils/avatar'
import { getSettings } from '../services/settings'
import {
  clearSSOCookie,
  createSSOSession,
  extractSessionClientContext,
  getSSOSession,
  revokeSessionByToken,
  setSSOCookie,
  signSessionToken,
  verifySessionToken,
  type SSOSession
} from '../services/session'

const router = Router()

function buildSsoLimiter(windowMs: number): RequestHandler {
  return rateLimit({
    windowMs,
    limit: () => getSettings().ssoRateMax,
    message: { error: 'Too many requests, please try again later' },
    standardHeaders: true,
    legacyHeaders: false,
    // ssoRateWindowMs 可在后台动态调整并重建限流器，关闭初始化栈告警
    validate: { creationStack: false }
  })
}

// 限流参数来自系统设置：初始化时建好默认限流器，仅在 windowMs 变更时重建（计数会重置）
let limiterWindowMs = getSettings().ssoRateWindowMs
let limiterInstance: RequestHandler = buildSsoLimiter(limiterWindowMs)
const ssoLimiter: RequestHandler = (req, res, next) => {
  const { ssoRateWindowMs } = getSettings()
  if (limiterWindowMs !== ssoRateWindowMs) {
    limiterWindowMs = ssoRateWindowMs
    limiterInstance = buildSsoLimiter(ssoRateWindowMs)
  }
  return limiterInstance(req, res, next)
}

/** SSO 登录接受明文密码（供服务端 / 第三方应用调用，不经过前端 RSA 加密），必须配合 HTTPS 使用 */
const ssoLoginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1)
})

/** 以数据库最新资料（含权限与头像）构造会话用户视图，权限变更无需重新登录即可生效 */
async function toSessionUserDto(session: SSOSession) {
  const dbUser = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { avatar: true, nickname: true, role: true }
  })

  return {
    id: session.userId,
    username: session.username,
    nickname: dbUser?.nickname,
    email: session.email,
    role: dbUser?.role || session.role,
    avatar: dbUser?.avatar || null,
    avatarUrl: getAvatarUrl(dbUser?.avatar)
  }
}

router.post('/verify', ssoLimiter, asyncHandler(async (req: Request, res: Response) => {
  const token = req.cookies?.[getSettings().ssoCookieName] || req.headers.authorization?.replace('Bearer ', '')

  if (!token) {
    res.json({ valid: false, error: 'No token provided' })
    return
  }

  const decoded = verifySessionToken(token)
  if (!decoded) {
    res.json({ valid: false, error: 'Invalid token' })
    return
  }

  const session = await getSSOSession(decoded.sessionId)
  if (!session) {
    res.json({ valid: false, error: 'Session not found or expired' })
    return
  }

  res.json({ valid: true, user: await toSessionUserDto(session) })
}))

router.post('/login', ssoLimiter, asyncHandler(async (req: Request, res: Response) => {
  const parsed = ssoLoginSchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    throw new AppError('Username and password required', 400)
  }
  const { username, password } = parsed.data

  const user = await prisma.user.findUnique({ where: { username } })
  if (!user) {
    throw new AppError('Invalid credentials', 401)
  }

  const isValid = await bcrypt.compare(password, user.password)
  if (!isValid) {
    throw new AppError('Invalid credentials', 401)
  }

  const sessionId = await createSSOSession(user, extractSessionClientContext(req))
  setSSOCookie(res, signSessionToken(sessionId))

  res.json({
    success: true,
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      avatar: user.avatar,
      avatarUrl: getAvatarUrl(user.avatar)
    }
  })
}))

router.post('/logout', ssoLimiter, asyncHandler(async (req: Request, res: Response) => {
  const token = req.cookies?.[getSettings().ssoCookieName]
  if (token) {
    await revokeSessionByToken(token)
  }

  clearSSOCookie(res)
  res.json({ success: true })
}))

router.get('/session', ssoLimiter, asyncHandler(async (req: Request, res: Response) => {
  const token = req.cookies?.[getSettings().ssoCookieName]

  if (!token) {
    res.json({ authenticated: false })
    return
  }

  const decoded = verifySessionToken(token)
  const session = decoded ? await getSSOSession(decoded.sessionId) : null
  if (!session) {
    clearSSOCookie(res)
    res.json({ authenticated: false })
    return
  }

  res.json({ authenticated: true, user: await toSessionUserDto(session) })
}))

export default router
