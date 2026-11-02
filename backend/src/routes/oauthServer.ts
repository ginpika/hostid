/**
 * OAuth 2.0 授权服务器路由
 * RFC 6749 授权码模式 + RFC 7636 PKCE (S256) + RFC 6750 Bearer userinfo
 *
 * 浏览器流程：客户端把用户带到 GET /api/oauth2/authorize（无 Authorization 头）
 * → 302 到前端同意页 /oauth2/authorize → 同意页用用户 JWT 调用本 API 校验 / 授权
 * → 返回 redirectUrl（code 或 error），由前端跳回客户端。
 */
import { Router, Request, Response, NextFunction } from 'express'
import crypto from 'crypto'
import { prisma } from '../lib/prisma'
import { auth, AuthRequest } from '../middleware/auth'
import {
  generateAuthorizationCode,
  generateAccessToken,
  generateRefreshToken,
  saveAuthorizationCode,
  consumeAuthorizationCode,
  saveAccessToken,
  saveRefreshToken,
  verifyAccessToken,
  consumeRefreshToken,
  verifyPKCE,
  decryptClientSecret,
  ACCESS_TOKEN_TTL_SECONDS,
  SUPPORTED_SCOPES,
  normalizeScope
} from '../services/oauth2'
import { getAvatarUrl } from '../utils/avatar'
import { getSiteUrl } from '../services/settings'

const router = Router()

const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next)
  }
}

const PKCE_CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/
const PKCE_VERIFIER_RE = /^[A-Za-z0-9._~-]{43,128}$/

type OAuthErrorCode =
  | 'invalid_request' | 'invalid_client' | 'invalid_grant' | 'unauthorized_client'
  | 'unsupported_grant_type' | 'invalid_scope' | 'access_denied'
  | 'unsupported_response_type' | 'server_error'

class OAuthError extends Error {
  constructor(public code: OAuthErrorCode, public description: string, public status = 400) {
    super(description)
  }
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined)

const parseRedirectUris = (raw: string): string[] => {
  try {
    const value = JSON.parse(raw)
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

const timingSafeEqualString = (a: string, b: string): boolean => {
  const ha = crypto.createHash('sha256').update(a).digest()
  const hb = crypto.createHash('sha256').update(b).digest()
  return crypto.timingSafeEqual(ha, hb) && a.length === b.length
}

// ---------------------------------------------------------------------------
// Authorization endpoint
// ---------------------------------------------------------------------------

interface AuthorizeParams {
  response_type?: string
  client_id?: string
  redirect_uri?: string
  scope?: string
  state?: string
  code_challenge?: string
  code_challenge_method?: string
}

interface ValidatedAuthorize {
  app: { name: string; description: string | null; homepage: string | null; clientId: string }
  redirectUri: string
  scope: string
  state?: string
  codeChallenge?: string
}

/**
 * RFC 6749 4.1.2.1：client_id / redirect_uri 无效时不得重定向（返回 400 JSON）；
 * 其余错误在 redirect_uri 已验证后通过 redirectUrl 返回给前端跳转。
 */
type AuthorizeResult =
  | { ok: true; value: ValidatedAuthorize }
  | { ok: false; status: number; body: Record<string, string> }

async function validateAuthorizeRequest(p: AuthorizeParams): Promise<AuthorizeResult> {
  const clientId = str(p.client_id)
  if (!clientId) return { ok: false, status: 400, body: { error: 'invalid_request', error_description: 'client_id is required' } }

  const app = await prisma.oAuthApp.findUnique({ where: { clientId } })
  if (!app || !app.isActive) {
    return { ok: false, status: 400, body: { error: 'invalid_client', error_description: 'Unknown or disabled client' } }
  }

  const registered = parseRedirectUris(app.redirectUris)
  // redirect_uri 可省略：仅当注册了唯一地址时（RFC 6749 3.1.2.3）
  const redirectUri = str(p.redirect_uri) ?? (registered.length === 1 ? registered[0] : undefined)
  if (!redirectUri || !registered.includes(redirectUri)) {
    return { ok: false, status: 400, body: { error: 'invalid_request', error_description: 'redirect_uri is missing or not registered for this client' } }
  }

  const fail = (error: OAuthErrorCode, description: string): AuthorizeResult => {
    const url = new URL(redirectUri)
    url.searchParams.set('error', error)
    url.searchParams.set('error_description', description)
    if (str(p.state)) url.searchParams.set('state', p.state!)
    return { ok: false, status: 400, body: { error, error_description: description, redirectUrl: url.toString() } }
  }

  if (p.response_type !== 'code') return fail('unsupported_response_type', 'Only response_type=code is supported')

  const scope = normalizeScope(p.scope)
  if (scope === null) return fail('invalid_scope', `Supported scopes: ${SUPPORTED_SCOPES.join(' ')}`)

  const codeChallenge = str(p.code_challenge)
  const method = str(p.code_challenge_method) ?? (codeChallenge ? 'plain' : undefined)
  if (codeChallenge) {
    if (method !== 'S256') return fail('invalid_request', 'code_challenge_method must be S256')
    if (!PKCE_CHALLENGE_RE.test(codeChallenge)) return fail('invalid_request', 'Malformed code_challenge')
  } else if (!app.isConfidential) {
    return fail('invalid_request', 'PKCE (code_challenge with S256) is required for public clients')
  }

  return {
    ok: true,
    value: {
      app: { name: app.name, description: app.description, homepage: app.homepage, clientId },
      redirectUri,
      scope,
      state: str(p.state),
      codeChallenge
    }
  }
}

// Browser navigation from an OAuth client (no bearer token): hand off to the
// frontend consent page, which logs the user in and then calls this API.
const redirectBrowserToConsentPage = (req: Request, res: Response, next: NextFunction) => {
  if (req.headers.authorization) return next()
  const query = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : ''
  res.redirect(302, `/oauth2/authorize${query}`)
}

router.get('/authorize', redirectBrowserToConsentPage, auth, asyncHandler(async (req: AuthRequest, res: Response) => {
  const result = await validateAuthorizeRequest(req.query as AuthorizeParams)
  if (!result.ok) {
    res.status(result.status).json(result.body)
    return
  }
  const { app, redirectUri, scope, state, codeChallenge } = result.value

  const user = await prisma.user.findUnique({
    where: { id: req.userId! },
    select: { username: true, email: true, nickname: true }
  })
  if (!user) {
    res.status(401).json({ error: 'User not found' })
    return
  }

  res.json({
    app: { name: app.name, description: app.description, homepage: app.homepage },
    user,
    clientId: app.clientId,
    redirectUri,
    scope,
    state,
    codeChallenge,
    codeChallengeMethod: codeChallenge ? 'S256' : undefined
  })
}))

router.post('/authorize', auth, asyncHandler(async (req: AuthRequest, res: Response) => {
  const body = (req.body ?? {}) as AuthorizeParams & { approve?: unknown }
  const result = await validateAuthorizeRequest({ ...body, response_type: body.response_type ?? 'code' })
  if (!result.ok) {
    res.status(result.status).json(result.body)
    return
  }
  const { app, redirectUri, scope, state, codeChallenge } = result.value
  const redirectUrl = new URL(redirectUri)

  if (body.approve !== true && body.approve !== 'true') {
    redirectUrl.searchParams.set('error', 'access_denied')
    redirectUrl.searchParams.set('error_description', 'The user denied the authorization request')
    if (state) redirectUrl.searchParams.set('state', state)
    res.json({ redirectUrl: redirectUrl.toString() })
    return
  }

  const code = generateAuthorizationCode()
  await saveAuthorizationCode({
    code,
    clientId: app.clientId,
    redirectUri,
    redirectUriProvided: !!str(body.redirect_uri),
    userId: req.userId!,
    scope,
    codeChallenge,
    codeChallengeMethod: codeChallenge ? 'S256' : undefined
  })

  redirectUrl.searchParams.set('code', code)
  if (state) redirectUrl.searchParams.set('state', state)
  res.json({ redirectUrl: redirectUrl.toString() })
}))

// ---------------------------------------------------------------------------
// Token endpoint
// ---------------------------------------------------------------------------

interface ClientCredentials { clientId?: string; clientSecret?: string; method: 'basic' | 'post' | 'none' }

/** RFC 6749 2.3.1：Basic 中的 id/secret 先做 application/x-www-form-urlencoded 编码 */
const formDecode = (s: string) => decodeURIComponent(s.replace(/\+/g, ' '))

function readClientCredentials(req: Request): ClientCredentials {
  const header = req.headers.authorization
  const body = req.body ?? {}
  if (header && /^Basic\s+/i.test(header)) {
    if (str(body.client_secret)) throw new OAuthError('invalid_request', 'Use only one client authentication method')
    const decoded = Buffer.from(header.replace(/^Basic\s+/i, ''), 'base64').toString('utf8')
    const idx = decoded.indexOf(':')
    if (idx <= 0) throw new OAuthError('invalid_client', 'Malformed Basic credentials', 401)
    let clientId: string, clientSecret: string
    try {
      clientId = formDecode(decoded.slice(0, idx))
      clientSecret = formDecode(decoded.slice(idx + 1))
    } catch {
      throw new OAuthError('invalid_client', 'Malformed Basic credentials', 401)
    }
    if (str(body.client_id) && body.client_id !== clientId) throw new OAuthError('invalid_request', 'client_id mismatch')
    return { clientId, clientSecret, method: 'basic' }
  }
  if (str(body.client_secret)) return { clientId: str(body.client_id), clientSecret: body.client_secret, method: 'post' }
  return { clientId: str(body.client_id), method: 'none' }
}

async function authenticateClient(req: Request) {
  const creds = readClientCredentials(req)
  if (!creds.clientId) throw new OAuthError('invalid_client', 'Client authentication failed', 401)
  const app = await prisma.oAuthApp.findUnique({ where: { clientId: creds.clientId } })
  if (!app || !app.isActive) throw new OAuthError('invalid_client', 'Client authentication failed', 401)
  if (app.isConfidential) {
    if (!creds.clientSecret || !timingSafeEqualString(creds.clientSecret, decryptClientSecret(app.clientSecret))) {
      throw new OAuthError('invalid_client', 'Client authentication failed', 401)
    }
  } else if (creds.clientSecret) {
    // 公共客户端没有可验证的密钥
    throw new OAuthError('invalid_client', 'Public clients must not send a client secret', 401)
  }
  return { app, method: creds.method }
}

const tokenNoStore = (_req: Request, res: Response, next: NextFunction) => {
  res.set('Cache-Control', 'no-store')
  res.set('Pragma', 'no-cache')
  next()
}

router.post('/token', tokenNoStore, asyncHandler(async (req: Request, res: Response) => {
  const body = req.body ?? {}
  const grantType = str(body.grant_type)
  if (!grantType) throw new OAuthError('invalid_request', 'grant_type is required')
  if (grantType !== 'authorization_code' && grantType !== 'refresh_token') {
    throw new OAuthError('unsupported_grant_type', 'Supported grant types: authorization_code, refresh_token')
  }

  const { app } = await authenticateClient(req)
  let userId: string
  let scope: string

  if (grantType === 'authorization_code') {
    const code = str(body.code)
    if (!code) throw new OAuthError('invalid_request', 'code is required')
    const codeData = await consumeAuthorizationCode(code)
    if (!codeData || codeData.clientId !== app.clientId) {
      throw new OAuthError('invalid_grant', 'Invalid, expired or already used authorization code')
    }
    // RFC 6749 4.1.3：authorize 时带了 redirect_uri，则必须原样提供
    const redirectUri = str(body.redirect_uri)
    if ((codeData.redirectUriProvided !== false || redirectUri) && redirectUri !== codeData.redirectUri) {
      throw new OAuthError('invalid_grant', 'redirect_uri does not match the authorization request')
    }
    if (codeData.codeChallenge) {
      const verifier = str(body.code_verifier)
      if (!verifier || !PKCE_VERIFIER_RE.test(verifier)) throw new OAuthError('invalid_grant', 'Missing or malformed code_verifier')
      if (!verifyPKCE(verifier, codeData.codeChallenge)) throw new OAuthError('invalid_grant', 'PKCE verification failed')
    } else if (str(body.code_verifier)) {
      throw new OAuthError('invalid_grant', 'code_verifier sent but no code_challenge was used')
    }
    userId = codeData.userId
    scope = codeData.scope
  } else {
    const refreshToken = str(body.refresh_token)
    if (!refreshToken) throw new OAuthError('invalid_request', 'refresh_token is required')
    // 原子消费（轮换），防止并发重放
    const tokenData = await consumeRefreshToken(refreshToken, app.clientId)
    if (!tokenData) throw new OAuthError('invalid_grant', 'Invalid or expired refresh token')
    userId = tokenData.userId
    scope = tokenData.scope
    if (str(body.scope)) {
      const requested = normalizeScope(body.scope)
      const granted = new Set(scope.split(' '))
      if (requested === null || requested.split(' ').some(s => !granted.has(s))) {
        throw new OAuthError('invalid_scope', 'Requested scope exceeds the original grant')
      }
      scope = requested
    }
  }

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } })
  if (!user) throw new OAuthError('invalid_grant', 'Resource owner no longer exists')

  const accessToken = generateAccessToken()
  await saveAccessToken({ token: accessToken, clientId: app.clientId, userId, scope })
  const newRefreshToken = generateRefreshToken()
  await saveRefreshToken(newRefreshToken, app.clientId, userId, scope)

  res.json({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    refresh_token: newRefreshToken,
    scope
  })
}))

// ---------------------------------------------------------------------------
// UserInfo (RFC 6750 Bearer; OIDC standard claims)
// ---------------------------------------------------------------------------

const bearerChallenge = (res: Response, status: number, error?: string, description?: string) => {
  const parts = ['realm="hostid"']
  if (error) parts.push(`error="${error}"`)
  if (description) parts.push(`error_description="${description}"`)
  res.set('WWW-Authenticate', `Bearer ${parts.join(', ')}`)
  res.status(status).json(error ? { error, error_description: description } : { error: 'invalid_request', error_description: 'Bearer token required' })
}

const userinfo = asyncHandler(async (req: Request, res: Response) => {
  res.set('Cache-Control', 'no-store')
  res.set('Pragma', 'no-cache')
  const header = req.headers.authorization
  if (!header || !/^Bearer\s+/i.test(header)) {
    bearerChallenge(res, 401)
    return
  }
  const token = header.replace(/^Bearer\s+/i, '').trim()
  const tokenData = token ? await verifyAccessToken(token) : null
  if (!tokenData) {
    bearerChallenge(res, 401, 'invalid_token', 'The access token is invalid or expired')
    return
  }

  const user = await prisma.user.findUnique({
    where: { id: tokenData.userId },
    select: { id: true, username: true, email: true, nickname: true, avatar: true, updatedAt: true }
  })
  if (!user) {
    bearerChallenge(res, 401, 'invalid_token', 'The resource owner no longer exists')
    return
  }

  const scopes = new Set(tokenData.scope.split(' '))
  const response: Record<string, unknown> = { sub: user.id }
  if (scopes.has('profile')) {
    response.name = user.nickname || user.username
    response.preferred_username = user.username
    response.username = user.username
    if (user.nickname) response.nickname = user.nickname
    response.updated_at = Math.floor(user.updatedAt.getTime() / 1000)
    let picture = getAvatarUrl(user.avatar)
    if (picture && picture.startsWith('/')) {
      const base = getSiteUrl() || `${req.protocol}://${req.get('host')}`
      picture = `${base}${picture}`
    }
    if (picture) response.picture = picture
  }
  if (scopes.has('email')) {
    response.email = user.email
    // 邮箱为本实例托管的邮箱地址
    response.email_verified = true
  }
  res.json(response)
})

router.get('/userinfo', userinfo)
router.post('/userinfo', userinfo)

// ---------------------------------------------------------------------------
// Error formatting (RFC 6749 5.2)
// ---------------------------------------------------------------------------

router.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
  if (!(err instanceof OAuthError)) return next(err)
  if (err.code === 'invalid_client' && err.status === 401) {
    res.set('WWW-Authenticate', 'Basic realm="hostid", charset="UTF-8"')
  }
  res.status(err.status).json({ error: err.code, error_description: err.description })
})

/** RFC 8414 授权服务器元数据 */
export function authorizationServerMetadata(req: Request, res: Response) {
  const issuer = getSiteUrl() || `${req.protocol}://${req.get('host')}`
  res.set('Cache-Control', 'public, max-age=300')
  res.json({
    issuer,
    authorization_endpoint: `${issuer}/api/oauth2/authorize`,
    token_endpoint: `${issuer}/api/oauth2/token`,
    userinfo_endpoint: `${issuer}/api/oauth2/userinfo`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
    code_challenge_methods_supported: ['S256'],
    scopes_supported: [...SUPPORTED_SCOPES]
  })
}

export default router
