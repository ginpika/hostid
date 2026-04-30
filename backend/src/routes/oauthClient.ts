/**
 * OAuth 客户端路由（第三方 OAuth 登录）
 * 处理 GitHub 等第三方 OAuth 登录流程
 * 包含授权跳转、回调处理和用户注册/绑定
 */
import { Router, Request, Response, NextFunction } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { AppError } from '../middleware/error'
import { memoryStore } from '../store'
import { decrypt } from '../services/encryption'

const router = Router()

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173'
const JWT_SECRET = process.env.JWT_SECRET || 'secret'
const SESSION_TTL = parseInt(process.env.SESSION_TTL || '604800', 10) * 1000
const SSO_COOKIE_NAME = process.env.SSO_COOKIE_NAME || 'sso_token'
const SSO_COOKIE_DOMAIN = process.env.SSO_COOKIE_DOMAIN || ''
const SSO_COOKIE_PATH = process.env.SSO_COOKIE_PATH || '/'
const SSO_COOKIE_SECURE = process.env.SSO_COOKIE_SECURE === 'true'
const SSO_COOKIE_SAMESITE = (process.env.SSO_COOKIE_SAMESITE || 'lax') as 'strict' | 'lax' | 'none'
const MAIL_DOMAIN = process.env.MAIL_DOMAIN || 'localhost'

interface ProviderConfig {
  clientId: string
  clientSecret: string
  callbackUrl: string
  authorizationUrl: string
  tokenUrl: string
  userinfoUrl: string
}

const providerCache = new Map<string, { config: ProviderConfig; expiresAt: number }>()
const CACHE_TTL = 5 * 60 * 1000

async function getProviderConfig(provider: string): Promise<ProviderConfig | null> {
  const cached = providerCache.get(provider)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.config
  }

  const dbConfig = await prisma.oAuthProvider.findUnique({
    where: { provider, isActive: true }
  })

  if (!dbConfig) {
    return null
  }

  const config: ProviderConfig = {
    clientId: dbConfig.clientId,
    clientSecret: decrypt(dbConfig.clientSecret),
    callbackUrl: dbConfig.callbackUrl,
    authorizationUrl: dbConfig.authorizationUrl,
    tokenUrl: dbConfig.tokenUrl,
    userinfoUrl: dbConfig.userinfoUrl
  }

  providerCache.set(provider, {
    config,
    expiresAt: Date.now() + CACHE_TTL
  })

  return config
}

export function clearProviderCache(provider?: string) {
  if (provider) {
    providerCache.delete(provider)
  } else {
    providerCache.clear()
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

interface GitHubUser {
  id: number
  login: string
  email: string | null
  name: string | null
  avatar_url: string
}

interface GitHubEmail {
  email: string
  primary: boolean
  verified: boolean
}

interface OAuthState {
  redirect: string
  createdAt: number
}

interface PendingOAuthUser {
  githubId: number
  githubLogin: string
  email: string | null
  name: string | null
  avatarUrl: string
  createdAt: number
}

function generateSessionId(): string {
  return crypto.randomBytes(32).toString('hex')
}

function generateState(): string {
  return crypto.randomBytes(16).toString('hex')
}

function generateOAuthToken(): string {
  return crypto.randomBytes(32).toString('hex')
}

function getSessionKey(sessionId: string): string {
  return `sso:session:${sessionId}`
}

function getStateKey(state: string): string {
  return `oauth:state:${state}`
}

function getPendingOAuthKey(token: string): string {
  return `oauth:pending:${token}`
}

async function createSSOSession(user: { id: string; username: string; email: string; role: string }): Promise<string> {
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

const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next)
  }
}

router.get('/status', asyncHandler(async (req: Request, res: Response) => {
  const providers = await prisma.oAuthProvider.findMany({
    where: { isActive: true },
    select: { provider: true, displayName: true }
  })

  const result: Record<string, { enabled: boolean; displayName: string }> = {}

  for (const p of providers) {
    result[p.provider] = {
      enabled: true,
      displayName: p.displayName
    }
  }

  res.json({ providers: result })
}))

router.get('/:provider', asyncHandler(async (req: Request, res: Response) => {
  const { provider } = req.params
  const config = await getProviderConfig(provider)

  if (!config) {
    throw new AppError(`${provider} OAuth is not configured`, 500)
  }

  const redirect = req.query.redirect as string || '/'
  const state = generateState()

  await memoryStore.set(getStateKey(state), JSON.stringify({ redirect, provider, createdAt: Date.now() }), 5 * 60 * 1000)

  const authUrl = new URL(config.authorizationUrl)
  authUrl.searchParams.set('client_id', config.clientId)
  authUrl.searchParams.set('redirect_uri', config.callbackUrl)
  authUrl.searchParams.set('scope', 'openid profile email')
  authUrl.searchParams.set('state', state)

  res.redirect(authUrl.toString())
}))

router.get('/:provider/callback', asyncHandler(async (req: Request, res: Response) => {
  const { provider } = req.params
  const { code, state } = req.query

  if (!code || !state) {
    throw new AppError('Invalid OAuth callback', 400)
  }

  const stateDataStr = await memoryStore.get(getStateKey(state as string))
  if (!stateDataStr) {
    throw new AppError('Invalid or expired OAuth state', 400)
  }

  await memoryStore.delete(getStateKey(state as string))

  const stateData: OAuthState & { provider: string } = JSON.parse(stateDataStr)

  const config = await getProviderConfig(stateData.provider)
  if (!config) {
    throw new AppError(`${stateData.provider} OAuth is not configured`, 500)
  }

  const tokenResponse = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: config.callbackUrl,
      state
    })
  })

  const tokenData = await tokenResponse.json() as { access_token?: string; error?: string; error_description?: string }

  if (tokenData.error || !tokenData.access_token) {
    console.error('OAuth token error:', tokenData)
    throw new AppError(`OAuth error: ${tokenData.error_description || tokenData.error}`, 400)
  }

  const userResponse = await fetch(config.userinfoUrl, {
    headers: {
      'Authorization': `Bearer ${tokenData.access_token}`,
      'Accept': 'application/json'
    }
  })

  if (!userResponse.ok) {
    throw new AppError('Failed to fetch user info', 400)
  }

  const oauthUser = await userResponse.json() as GitHubUser

  let primaryEmail = oauthUser.email

  const existingUser = await prisma.user.findFirst({
    where: {
      OR: [
        { githubId: oauthUser.id },
        ...(primaryEmail ? [{ email: primaryEmail }] : [])
      ]
    }
  })

  if (existingUser) {
    const token = jwt.sign({ userId: existingUser.id }, JWT_SECRET, { expiresIn: '7d' })

    const sessionId = await createSSOSession({
      id: existingUser.id,
      username: existingUser.username,
      email: existingUser.email,
      role: existingUser.role
    })
    const ssoToken = jwt.sign({ sessionId }, JWT_SECRET, { expiresIn: '7d' })
    setSSOCookie(res, ssoToken)

    const frontendCallback = `${FRONTEND_URL}/oauth/callback?token=${token}&user=${encodeURIComponent(JSON.stringify({
      id: existingUser.id,
      email: existingUser.email,
      username: existingUser.username,
      nickname: existingUser.nickname,
      avatar: existingUser.avatar,
      language: existingUser.language,
      role: existingUser.role
    }))}&redirect=${encodeURIComponent(stateData.redirect)}`

    res.redirect(frontendCallback)
    return
  }

  const oauthToken = generateOAuthToken()
  const pendingUser: PendingOAuthUser = {
    githubId: oauthUser.id,
    githubLogin: oauthUser.login,
    email: primaryEmail,
    name: oauthUser.name,
    avatarUrl: oauthUser.avatar_url,
    createdAt: Date.now()
  }

  await memoryStore.set(getPendingOAuthKey(oauthToken), JSON.stringify(pendingUser), 10 * 60 * 1000)

  const registerUrl = `${FRONTEND_URL}/oauth/register?token=${oauthToken}&redirect=${encodeURIComponent(stateData.redirect)}&githubLogin=${oauthUser.login}&name=${encodeURIComponent(oauthUser.name || '')}&avatar=${encodeURIComponent(oauthUser.avatar_url)}`

  res.redirect(registerUrl)
}))

const completeRegisterSchema = z.object({
  token: z.string(),
  username: z.string().min(3).max(30).regex(/^[a-zA-Z0-9._]+$/, 'Username can only contain letters, numbers, dots and underscores')
})

router.post('/register', asyncHandler(async (req: Request, res: Response) => {
  const { token, username } = completeRegisterSchema.parse(req.body)

  const pendingUserStr = await memoryStore.get(getPendingOAuthKey(token))
  if (!pendingUserStr) {
    throw new AppError('Invalid or expired OAuth token', 400)
  }

  await memoryStore.delete(getPendingOAuthKey(token))
  
  const pendingUser: PendingOAuthUser = JSON.parse(pendingUserStr)

  const existingUser = await prisma.user.findUnique({
    where: { username }
  })

  if (existingUser) {
    throw new AppError('Username already taken', 400)
  }

  const email = `${username}@${MAIL_DOMAIN}`
  
  const user = await prisma.user.create({
    data: {
      username,
      email,
      password: '',
      nickname: pendingUser.name || pendingUser.githubLogin,
      githubId: pendingUser.githubId
    }
  })

  const jwtToken = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' })
  
  const sessionId = await createSSOSession({
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role
  })
  const ssoToken = jwt.sign({ sessionId }, JWT_SECRET, { expiresIn: '7d' })
  setSSOCookie(res, ssoToken)

  res.json({
    token: jwtToken,
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      nickname: user.nickname,
      avatar: user.avatar,
      language: user.language,
      role: user.role
    }
  })
}))

router.get('/pending/:token', asyncHandler(async (req: Request, res: Response) => {
  const { token } = req.params
  
  const pendingUserStr = await memoryStore.get(getPendingOAuthKey(token))
  if (!pendingUserStr) {
    throw new AppError('Invalid or expired OAuth token', 400)
  }
  
  const pendingUser: PendingOAuthUser = JSON.parse(pendingUserStr)
  
  res.json({
    githubLogin: pendingUser.githubLogin,
    name: pendingUser.name,
    avatarUrl: pendingUser.avatarUrl,
    email: pendingUser.email
  })
}))

const bindGitHubSchema = z.object({
  token: z.string()
})

router.post('/bind', asyncHandler(async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new AppError('Unauthorized', 401)
  }

  const jwtToken = authHeader.substring(7)
  let userId: string

  try {
    const decoded = jwt.verify(jwtToken, JWT_SECRET) as { userId: string }
    userId = decoded.userId
  } catch {
    throw new AppError('Invalid token', 401)
  }

  const { token } = bindGitHubSchema.parse(req.body)

  const pendingUserStr = await memoryStore.get(getPendingOAuthKey(token))
  if (!pendingUserStr) {
    throw new AppError('Invalid or expired OAuth token', 400)
  }

  await memoryStore.delete(getPendingOAuthKey(token))

  const pendingUser: PendingOAuthUser = JSON.parse(pendingUserStr)

  const existingGitHubUser = await prisma.user.findFirst({
    where: {
      githubId: pendingUser.githubId,
      NOT: { id: userId }
    }
  })

  if (existingGitHubUser) {
    throw new AppError('This GitHub account is already bound to another user', 400)
  }

  const user = await prisma.user.update({
    where: { id: userId },
    data: { githubId: pendingUser.githubId }
  })

  res.json({
    success: true,
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      nickname: user.nickname,
      avatar: user.avatar,
      language: user.language,
      role: user.role,
      githubId: user.githubId
    }
  })
}))

export default router