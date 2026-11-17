/**
 * OAuth 客户端路由（第三方 OAuth 登录）
 * 处理 GitHub 等第三方 OAuth 登录流程
 * 包含授权跳转、回调处理和用户注册/绑定
 * 外部 HTTP 交换在 services/external-oauth，会话签发在 services/session
 */
import { Router, Request, Response } from 'express'
import crypto from 'crypto'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { auth, AuthRequest } from '../middleware/auth'
import { AppError, asyncHandler } from '../middleware/error'
import { memoryStore } from '../store'
import { getSettings, getSiteUrl } from '../services/settings'
import { USERNAME_PATTERN } from '../lib/domain-constants'
import { getActiveProviderConfig } from '../services/oauth-provider-registry'
import { fetchExternalProfile } from '../services/external-oauth'
import { formatAuthUser, extractSessionClientContext, issueAuthSession } from '../services/session'

const router = Router()

const OAUTH_STATE_COOKIE = 'hostid_oauth_state'
const STATE_TTL_MS = 10 * 60 * 1000

interface OAuthState {
  redirect: string
  provider: string
  codeVerifier: string
  createdAt: number
}

interface PendingOAuthUser {
  provider: string
  subject: string
  /** 字段名沿用 githubLogin 以保持与前端的接口契约 */
  githubLogin: string
  email: string | null
  name: string | null
  avatarUrl: string
  createdAt: number
}

const randomHex = (bytes: number) => crypto.randomBytes(bytes).toString('hex')
const getStateKey = (state: string) => `oauth:state:${state}`
const getPendingOAuthKey = (token: string) => `oauth:pending:${token}`

async function takePendingUser(token: string): Promise<PendingOAuthUser> {
  const raw = await memoryStore.get(getPendingOAuthKey(token))
  if (!raw) {
    throw new AppError('Invalid or expired OAuth token', 400)
  }
  await memoryStore.delete(getPendingOAuthKey(token))
  return JSON.parse(raw) as PendingOAuthUser
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

  res.json({
    providers: result,
    passkeyEnabled: getSettings().passkeyEnabled
  })
}))

router.get('/:provider', asyncHandler(async (req: Request, res: Response) => {
  const { provider } = req.params
  const config = await getActiveProviderConfig(provider)

  if (!config) {
    throw new AppError(`${provider} OAuth is not configured`, 500)
  }

  const rawRedirect = typeof req.query.redirect === 'string' ? req.query.redirect : '/'
  // 只允许站内相对路径，防止开放重定向
  const redirect = rawRedirect.startsWith('/') && !rawRedirect.startsWith('//') ? rawRedirect : '/'
  const state = randomHex(16)
  const codeVerifier = crypto.randomBytes(32).toString('base64url')
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url')

  const stateData: OAuthState = { redirect, provider, codeVerifier, createdAt: Date.now() }
  await memoryStore.set(getStateKey(state), JSON.stringify(stateData), STATE_TTL_MS)
  // state 绑定到发起登录的浏览器（RFC 6749 10.12）
  res.cookie(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure || getSettings().ssoCookieSecure,
    path: '/api/oauth',
    maxAge: STATE_TTL_MS
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

  const config = await getActiveProviderConfig(stateData.provider)
  if (!config) {
    throw new AppError(`${stateData.provider} OAuth is not configured`, 500)
  }

  const profile = await fetchExternalProfile(config, code, stateData.codeVerifier)

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
    const { token, user } = await issueAuthSession(res, existingUser, extractSessionClientContext(req))
    const frontendCallback = `${getSiteUrl()}/oauth/callback?token=${token}&user=${encodeURIComponent(JSON.stringify(user))}&redirect=${encodeURIComponent(stateData.redirect)}`

    res.redirect(frontendCallback)
    return
  }

  const oauthToken = randomHex(32)
  const pendingUser: PendingOAuthUser = {
    provider: stateData.provider,
    subject: profile.subject,
    githubLogin: profile.login,
    email: profile.email,
    name: profile.name,
    avatarUrl: profile.avatarUrl,
    createdAt: Date.now()
  }

  await memoryStore.set(getPendingOAuthKey(oauthToken), JSON.stringify(pendingUser), STATE_TTL_MS)

  const registerUrl = `${getSiteUrl()}/oauth/register?token=${oauthToken}&redirect=${encodeURIComponent(stateData.redirect)}&githubLogin=${encodeURIComponent(profile.login)}&name=${encodeURIComponent(profile.name || '')}&avatar=${encodeURIComponent(profile.avatarUrl)}`

  res.redirect(registerUrl)
}))

const completeRegisterSchema = z.object({
  token: z.string(),
  username: z.string().min(3).max(30).regex(USERNAME_PATTERN, 'Username can only contain letters, numbers, dots and underscores')
})

router.post('/register', asyncHandler(async (req: Request, res: Response) => {
  const { token, username } = completeRegisterSchema.parse(req.body)

  const pendingUser = await takePendingUser(token)

  const existingUser = await prisma.user.findUnique({
    where: { username }
  })

  if (existingUser) {
    throw new AppError('Username already taken', 400)
  }

  const user = await prisma.user.create({
    data: {
      username,
      email: `${username}@${getSettings().mailDomain}`,
      password: '',
      nickname: pendingUser.name || pendingUser.githubLogin,
      avatar: pendingUser.avatarUrl || null,
      identities: { create: { provider: pendingUser.provider, subject: pendingUser.subject } }
    }
  })

  res.json(await issueAuthSession(res, user, extractSessionClientContext(req)))
}))

router.get('/pending/:token', asyncHandler(async (req: Request, res: Response) => {
  const raw = await memoryStore.get(getPendingOAuthKey(req.params.token))
  if (!raw) {
    throw new AppError('Invalid or expired OAuth token', 400)
  }

  const pendingUser: PendingOAuthUser = JSON.parse(raw)

  res.json({
    githubLogin: pendingUser.githubLogin,
    name: pendingUser.name,
    avatarUrl: pendingUser.avatarUrl,
    email: pendingUser.email
  })
}))

const bindExternalIdentitySchema = z.object({
  token: z.string()
})

router.post('/bind', auth, asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.userId!
  const { token } = bindExternalIdentitySchema.parse(req.body)

  const pendingUser = await takePendingUser(token)

  const existingIdentity = await prisma.userIdentity.findUnique({
    where: { provider_subject: { provider: pendingUser.provider, subject: pendingUser.subject } }
  })

  // 错误文案是与前端约定的契约（OAuthRegister.tsx 按原文匹配），不要随意改动
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
    user: { ...formatAuthUser(user), githubId: user.githubId }
  })
}))

export default router
