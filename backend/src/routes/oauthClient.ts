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
import { getAvatarUrl } from '../utils/avatar'
import { getJwtSecret } from '../config/secrets'
import { getSettings, getSiteUrl, getSessionTtlMs } from '../services/settings'

const router = Router()


interface ProviderConfig {
  clientId: string
  clientSecret: string
  callbackUrl: string
  authorizationUrl: string
  tokenUrl: string
  userinfoUrl: string
}

/** 登录流程只使用启用且勾选了「登录」用途的 provider */
export const loginProviderWhere = { isActive: true, useForLogin: true } as const

const providerCache = new Map<string, { config: ProviderConfig; expiresAt: number }>()
const CACHE_TTL = 5 * 60 * 1000

async function getProviderConfig(provider: string): Promise<ProviderConfig | null> {
  const cached = providerCache.get(provider)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.config
  }

  const dbConfig = await prisma.oAuthProvider.findUnique({
    where: { provider, isActive: true, useForLogin: true }
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

interface OAuthState {
  redirect: string
  provider: string
  codeVerifier: string
  createdAt: number
}

/** 从 userinfo 响应提取标准化身份：兼容 OIDC（sub/preferred_username/picture）、GitHub 和 hostid */
interface ExternalProfile {
  subject: string
  login: string
  email: string | null
  name: string | null
  avatarUrl: string
}

function mapUserinfo(raw: Record<string, unknown>): ExternalProfile | null {
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      const v = raw[k]
      if ((typeof v === 'string' && v) || typeof v === 'number') return String(v)
    }
    return null
  }
  const subject = pick('sub', 'id')
  if (!subject) return null
  const email = pick('email')
  return {
    subject,
    login: pick('preferred_username', 'username', 'login', 'nickname') || (email ? email.split('@')[0] : subject),
    email,
    name: pick('name', 'nickname'),
    avatarUrl: pick('picture', 'avatar_url', 'avatar') || ''
  }
}

const OAUTH_STATE_COOKIE = 'hostid_oauth_state'

interface PendingOAuthUser {
  provider: string
  subject: string
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

const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next)
  }
}

router.get('/status', asyncHandler(async (req: Request, res: Response) => {
  const providers = await prisma.oAuthProvider.findMany({
    where: loginProviderWhere,
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

  const rawRedirect = typeof req.query.redirect === 'string' ? req.query.redirect : '/'
  // 只允许站内相对路径，防止开放重定向
  const redirect = rawRedirect.startsWith('/') && !rawRedirect.startsWith('//') ? rawRedirect : '/'
  const state = generateState()
  const codeVerifier = crypto.randomBytes(32).toString('base64url')
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url')

  const stateData: OAuthState = { redirect, provider, codeVerifier, createdAt: Date.now() }
  await memoryStore.set(getStateKey(state), JSON.stringify(stateData), 10 * 60 * 1000)
  // state 绑定到发起登录的浏览器（RFC 6749 10.12）
  res.cookie(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure || getSettings().ssoCookieSecure,
    path: '/api/oauth',
    maxAge: 10 * 60 * 1000
  })

  const authUrl = new URL(config.authorizationUrl)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('client_id', config.clientId)
  authUrl.searchParams.set('redirect_uri', config.callbackUrl)
  authUrl.searchParams.set('scope', 'openid profile email')
  authUrl.searchParams.set('state', state)
  authUrl.searchParams.set('code_challenge', codeChallenge)
  authUrl.searchParams.set('code_challenge_method', 'S256')

  res.redirect(authUrl.toString())
}))

router.get('/:provider/callback', asyncHandler(async (req: Request, res: Response) => {
  const { code, state, error, error_description: errorDescription } = req.query

  const cookieState = req.cookies?.[OAUTH_STATE_COOKIE]
  res.clearCookie(OAUTH_STATE_COOKIE, { path: '/api/oauth' })

  if (typeof state !== 'string' || !state || state !== cookieState) {
    throw new AppError('Invalid or expired OAuth state', 400)
  }

  const stateDataStr = await memoryStore.get(getStateKey(state))
  if (!stateDataStr) {
    throw new AppError('Invalid or expired OAuth state', 400)
  }
  await memoryStore.delete(getStateKey(state))
  const stateData: OAuthState = JSON.parse(stateDataStr)

  if (stateData.provider !== req.params.provider) {
    throw new AppError('OAuth state does not match provider', 400)
  }

  // 授权服务器返回的错误（RFC 6749 4.1.2.1），例如用户拒绝
  if (typeof error === 'string' && error) {
    const msg = typeof errorDescription === 'string' && errorDescription ? errorDescription : error
    res.redirect(`${getSiteUrl()}/login?oauth_error=${encodeURIComponent(msg)}`)
    return
  }

  if (typeof code !== 'string' || !code) {
    throw new AppError('Invalid OAuth callback', 400)
  }

  const config = await getProviderConfig(stateData.provider)
  if (!config) {
    throw new AppError(`${stateData.provider} OAuth is not configured`, 500)
  }

  // RFC 6749 4.1.3：application/x-www-form-urlencoded，client_secret_post
  const tokenResponse = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json'
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.callbackUrl,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code_verifier: stateData.codeVerifier
    }).toString(),
    signal: AbortSignal.timeout(15000)
  })

  const tokenText = await tokenResponse.text()
  let tokenData: { access_token?: string; token_type?: string; error?: string; error_description?: string } = {}
  try {
    tokenData = JSON.parse(tokenText)
  } catch {
    tokenData = Object.fromEntries(new URLSearchParams(tokenText))
  }

  if (!tokenResponse.ok || tokenData.error || !tokenData.access_token) {
    console.error('OAuth token error:', tokenResponse.status, tokenData.error, tokenData.error_description)
    throw new AppError(`OAuth error: ${tokenData.error_description || tokenData.error || `HTTP ${tokenResponse.status}`}`, 400)
  }
  if (tokenData.token_type && tokenData.token_type.toLowerCase() !== 'bearer') {
    throw new AppError(`Unsupported token_type: ${tokenData.token_type}`, 400)
  }

  const userResponse = await fetch(config.userinfoUrl, {
    headers: {
      'Authorization': `Bearer ${tokenData.access_token}`,
      'Accept': 'application/json'
    },
    signal: AbortSignal.timeout(15000)
  })

  if (!userResponse.ok) {
    throw new AppError('Failed to fetch user info', 400)
  }

  const profile = mapUserinfo(await userResponse.json() as Record<string, unknown>)
  if (!profile) {
    throw new AppError('User info response has no subject identifier (sub / id)', 400)
  }

  const identity = await prisma.userIdentity.findUnique({
    where: { provider_subject: { provider: stateData.provider, subject: profile.subject } },
    include: { user: true }
  })
  // 兼容旧数据：GitHub 账号曾以 githubId 绑定
  const legacyGithubId = stateData.provider === 'github' && /^\d+$/.test(profile.subject) ? Number(profile.subject) : null
  // 不按 email 自动关联已有账号：外部 provider 断言的邮箱不可信，可能导致账号接管；需登录后绑定
  const existingUser = identity?.user
    ?? (legacyGithubId !== null ? await prisma.user.findUnique({ where: { githubId: legacyGithubId } }) : null)

  if (existingUser) {
    const token = jwt.sign({ userId: existingUser.id }, getJwtSecret(), { expiresIn: '7d' })

    const sessionId = await createSSOSession({
      id: existingUser.id,
      username: existingUser.username,
      email: existingUser.email,
      role: existingUser.role
    })
    const ssoToken = jwt.sign({ sessionId }, getJwtSecret(), { expiresIn: '7d' })
    setSSOCookie(res, ssoToken)

    const frontendCallback = `${getSiteUrl()}/oauth/callback?token=${token}&user=${encodeURIComponent(JSON.stringify({
      id: existingUser.id,
      email: existingUser.email,
      username: existingUser.username,
      nickname: existingUser.nickname,
      avatar: existingUser.avatar,
      avatarUrl: getAvatarUrl(existingUser.avatar),
      language: existingUser.language,
      role: existingUser.role
    }))}&redirect=${encodeURIComponent(stateData.redirect)}`

    res.redirect(frontendCallback)
    return
  }

  const oauthToken = generateOAuthToken()
  const pendingUser: PendingOAuthUser = {
    provider: stateData.provider,
    subject: profile.subject,
    githubLogin: profile.login,
    email: profile.email,
    name: profile.name,
    avatarUrl: profile.avatarUrl,
    createdAt: Date.now()
  }

  await memoryStore.set(getPendingOAuthKey(oauthToken), JSON.stringify(pendingUser), 10 * 60 * 1000)

  const registerUrl = `${getSiteUrl()}/oauth/register?token=${oauthToken}&redirect=${encodeURIComponent(stateData.redirect)}&githubLogin=${encodeURIComponent(profile.login)}&name=${encodeURIComponent(profile.name || '')}&avatar=${encodeURIComponent(profile.avatarUrl)}`

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

  const email = `${username}@${getSettings().mailDomain}`
  
  const user = await prisma.user.create({
    data: {
      username,
      email,
      password: '',
      nickname: pendingUser.name || pendingUser.githubLogin,
      avatar: pendingUser.avatarUrl || null,
      identities: { create: { provider: pendingUser.provider, subject: pendingUser.subject } }
    }
  })

  const jwtToken = jwt.sign({ userId: user.id }, getJwtSecret(), { expiresIn: '7d' })
  
  const sessionId = await createSSOSession({
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role
  })
  const ssoToken = jwt.sign({ sessionId }, getJwtSecret(), { expiresIn: '7d' })
  setSSOCookie(res, ssoToken)

  res.json({
    token: jwtToken,
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
    const decoded = jwt.verify(jwtToken, getJwtSecret()) as { userId: string }
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

  const existingIdentity = await prisma.userIdentity.findUnique({
    where: { provider_subject: { provider: pendingUser.provider, subject: pendingUser.subject } }
  })

  if (existingIdentity && existingIdentity.userId !== userId) {
    throw new AppError('This GitHub account is already bound to another user', 400)
  }

  if (!existingIdentity) {
    await prisma.userIdentity.create({
      data: { provider: pendingUser.provider, subject: pendingUser.subject, userId }
    })
  }

  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } })

  res.json({
    success: true,
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      nickname: user.nickname,
      avatar: user.avatar,
      avatarUrl: getAvatarUrl(user.avatar),
      language: user.language,
      role: user.role,
      githubId: user.githubId
    }
  })
}))

export default router