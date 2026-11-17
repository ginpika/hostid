/**
 * OAuth 2.0 授权服务器服务
 * 负责授权请求校验、同意决策、客户端认证、授权码/刷新令牌发放与轮换、UserInfo Claims 组装，
 * 以及供 OAuth 应用管理使用的 clientId/secret 生成与加密。
 */
import crypto from 'crypto'
import type { OAuthApp } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { memoryStore } from '../store'
import { getAvatarUrl } from '../utils/avatar'
import { encrypt, decrypt } from './encryption'
import { getSiteUrl } from './settings'

// Token 有效期配置
const AUTHORIZATION_CODE_TTL = 10 * 60 * 1000 // 10 分钟
const ACCESS_TOKEN_TTL = 60 * 60 * 1000 // 1 小时
export const ACCESS_TOKEN_TTL_SECONDS = ACCESS_TOKEN_TTL / 1000
const REFRESH_TOKEN_TTL_DAYS = 30 // 30 天

export const SUPPORTED_SCOPES = ['openid', 'profile', 'email'] as const
const DEFAULT_SCOPE = SUPPORTED_SCOPES.join(' ')

const AUTH_CODE_PREFIX = 'oauth2:code:'
const ACCESS_TOKEN_PREFIX = 'oauth2:token:'

const PKCE_CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/
const PKCE_VERIFIER_RE = /^[A-Za-z0-9._~-]{43,128}$/

export type OAuthErrorCode =
  | 'invalid_request' | 'invalid_client' | 'invalid_grant' | 'unauthorized_client'
  | 'unsupported_grant_type' | 'invalid_scope' | 'access_denied'
  | 'unsupported_response_type' | 'server_error'

export class OAuthError extends Error {
  constructor(public code: OAuthErrorCode, public description: string, public status = 400) {
    super(description)
  }
}

interface AuthorizationCode {
  code: string
  clientId: string
  redirectUri: string
  /** authorize 请求是否显式带了 redirect_uri（RFC 6749 4.1.3） */
  redirectUriProvided?: boolean
  userId: string
  scope: string
  codeChallenge?: string
  codeChallengeMethod?: 'S256'
}

interface AccessToken {
  token: string
  clientId: string
  userId: string
  scope: string
}

export interface AuthorizeParams {
  response_type?: string
  client_id?: string
  redirect_uri?: string
  scope?: string
  state?: string
  code_challenge?: string
  code_challenge_method?: string
}

export interface ValidatedAuthorize {
  app: { name: string; description: string | null; homepage: string | null; clientId: string }
  redirectUri: string
  scope: string
  state?: string
  codeChallenge?: string
}

export type AuthorizeValidationResult =
  | { ok: true; value: ValidatedAuthorize }
  | { ok: false; status: number; body: Record<string, string> }

export interface ClientCredentials {
  clientId?: string
  clientSecret?: string
  method: 'basic' | 'post' | 'none'
}

export interface TokenGrantRequest {
  grantType?: string
  code?: string
  redirectUri?: string
  codeVerifier?: string
  refreshToken?: string
  scope?: string
}

const nonEmptyStr = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined)

function parseRedirectUris(raw: string): string[] {
  try {
    const value = JSON.parse(raw)
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

function timingSafeEqualString(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a).digest()
  const hb = crypto.createHash('sha256').update(b).digest()
  return crypto.timingSafeEqual(ha, hb) && a.length === b.length
}

/**
 * 规范化请求的 scope：未提供时使用默认值；忽略不支持的 scope（RFC 6749 3.3 允许服务器缩小范围）；
 * 结果为空时返回 null（invalid_scope）
 */
export function normalizeScope(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === '') return DEFAULT_SCOPE
  if (typeof raw !== 'string') return null
  const requested = new Set(raw.split(/\s+/).filter(Boolean))
  const granted = SUPPORTED_SCOPES.filter(s => requested.has(s))
  return granted.length ? granted.join(' ') : null
}

// ---------------------------------------------------------------------------
// 客户端凭据生成与加解密（供 OAuth 应用管理调用）
// ---------------------------------------------------------------------------

export function generateClientId(): string {
  return `hostid_${crypto.randomBytes(16).toString('hex')}`
}

export function generateClientSecret(): string {
  return crypto.randomBytes(32).toString('hex')
}

export function encryptClientSecret(secret: string): string {
  return encrypt(secret)
}

// ---------------------------------------------------------------------------
// 内部令牌存储与 PKCE 校验
// ---------------------------------------------------------------------------

const randomHex = (bytes = 32) => crypto.randomBytes(bytes).toString('hex')

async function saveAuthorizationCode(codeData: AuthorizationCode): Promise<void> {
  await memoryStore.set(`${AUTH_CODE_PREFIX}${codeData.code}`, JSON.stringify(codeData), AUTHORIZATION_CODE_TTL)
}

async function consumeAuthorizationCode(code: string): Promise<AuthorizationCode | null> {
  const key = `${AUTH_CODE_PREFIX}${code}`
  const data = await memoryStore.get(key)
  if (!data) return null
  await memoryStore.delete(key)
  return JSON.parse(data) as AuthorizationCode
}

async function saveAccessToken(tokenData: AccessToken): Promise<void> {
  await memoryStore.set(`${ACCESS_TOKEN_PREFIX}${tokenData.token}`, JSON.stringify(tokenData), ACCESS_TOKEN_TTL)
}

async function verifyAccessToken(token: string): Promise<AccessToken | null> {
  const data = await memoryStore.get(`${ACCESS_TOKEN_PREFIX}${token}`)
  return data ? (JSON.parse(data) as AccessToken) : null
}

async function saveRefreshToken(
  token: string,
  clientId: string,
  userId: string,
  scope: string = DEFAULT_SCOPE
): Promise<void> {
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000)
  await prisma.refreshToken.create({
    data: { token, clientId, userId, scope, expiresAt }
  })
}

async function consumeRefreshToken(token: string, clientId: string): Promise<{ userId: string; scope: string } | null> {
  const record = await prisma.refreshToken.findUnique({ where: { token } })
  if (!record || record.clientId !== clientId) return null
  const { count } = await prisma.refreshToken.deleteMany({ where: { token, clientId } })
  if (count !== 1 || record.expiresAt < new Date()) return null
  return { userId: record.userId, scope: record.scope }
}

function verifyPKCE(codeVerifier: string, codeChallenge: string): boolean {
  // 只支持 S256（RFC 7636 4.2；不接受 plain）
  const hash = crypto.createHash('sha256').update(codeVerifier).digest()
  const expected = Buffer.from(codeChallenge, 'base64url')
  return expected.length === hash.length && crypto.timingSafeEqual(hash, expected)
}

// ---------------------------------------------------------------------------
// 授权端点用例
// ---------------------------------------------------------------------------

/**
 * RFC 6749 4.1.2.1：client_id / redirect_uri 无效时不得重定向（返回 400 JSON）；
 * 其余错误在 redirect_uri 已验证后通过 redirectUrl 返回给前端跳转。
 */
export async function validateAuthorizeRequest(p: AuthorizeParams): Promise<AuthorizeValidationResult> {
  const clientId = nonEmptyStr(p.client_id)
  if (!clientId) {
    return { ok: false, status: 400, body: { error: 'invalid_request', error_description: 'client_id is required' } }
  }

  const app = await prisma.oAuthApp.findUnique({ where: { clientId } })
  if (!app || !app.isActive) {
    return { ok: false, status: 400, body: { error: 'invalid_client', error_description: 'Unknown or disabled client' } }
  }

  const registered = parseRedirectUris(app.redirectUris)
  // redirect_uri 可省略：仅当注册了唯一地址时（RFC 6749 3.1.2.3）
  const redirectUri = nonEmptyStr(p.redirect_uri) ?? (registered.length === 1 ? registered[0] : undefined)
  if (!redirectUri || !registered.includes(redirectUri)) {
    return { ok: false, status: 400, body: { error: 'invalid_request', error_description: 'redirect_uri is missing or not registered for this client' } }
  }

  const fail = (error: OAuthErrorCode, description: string): AuthorizeValidationResult => {
    const url = new URL(redirectUri)
    url.searchParams.set('error', error)
    url.searchParams.set('error_description', description)
    if (nonEmptyStr(p.state)) url.searchParams.set('state', p.state!)
    return { ok: false, status: 400, body: { error, error_description: description, redirectUrl: url.toString() } }
  }

  if (p.response_type !== 'code') return fail('unsupported_response_type', 'Only response_type=code is supported')

  const scope = normalizeScope(p.scope)
  if (scope === null) return fail('invalid_scope', `Supported scopes: ${SUPPORTED_SCOPES.join(' ')}`)

  const codeChallenge = nonEmptyStr(p.code_challenge)
  const method = nonEmptyStr(p.code_challenge_method) ?? (codeChallenge ? 'plain' : undefined)
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
      state: nonEmptyStr(p.state),
      codeChallenge
    }
  }
}

export async function getAuthorizeConsentPreview(userId: string, params: AuthorizeParams) {
  const result = await validateAuthorizeRequest(params)
  if (!result.ok) return { ok: false as const, status: result.status, body: result.body }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { username: true, email: true, nickname: true }
  })
  if (!user) return { ok: false as const, status: 401, body: { error: 'User not found' } }

  const { app, redirectUri, scope, state, codeChallenge } = result.value
  return {
    ok: true as const,
    body: {
      app: { name: app.name, description: app.description, homepage: app.homepage },
      user,
      clientId: app.clientId,
      redirectUri,
      scope,
      state,
      codeChallenge,
      codeChallengeMethod: codeChallenge ? 'S256' : undefined
    }
  }
}

export async function decideAuthorization(userId: string, params: AuthorizeParams & { approve?: unknown }) {
  const result = await validateAuthorizeRequest({ ...params, response_type: params.response_type ?? 'code' })
  if (!result.ok) return { ok: false as const, status: result.status, body: result.body }

  const { app, redirectUri, scope, state, codeChallenge } = result.value
  const redirectUrl = new URL(redirectUri)

  if (params.approve !== true && params.approve !== 'true') {
    redirectUrl.searchParams.set('error', 'access_denied')
    redirectUrl.searchParams.set('error_description', 'The user denied the authorization request')
    if (state) redirectUrl.searchParams.set('state', state)
    return { ok: true as const, redirectUrl: redirectUrl.toString() }
  }

  const code = randomHex()
  await saveAuthorizationCode({
    code,
    clientId: app.clientId,
    redirectUri,
    redirectUriProvided: !!nonEmptyStr(params.redirect_uri),
    userId,
    scope,
    codeChallenge,
    codeChallengeMethod: codeChallenge ? 'S256' : undefined
  })

  redirectUrl.searchParams.set('code', code)
  if (state) redirectUrl.searchParams.set('state', state)
  return { ok: true as const, redirectUrl: redirectUrl.toString() }
}

// ---------------------------------------------------------------------------
// 令牌端点用例（客户端认证 + 授权码/刷新令牌策略分发）
// ---------------------------------------------------------------------------

export async function authenticateOAuthClient(creds: ClientCredentials): Promise<OAuthApp> {
  if (!creds.clientId) throw new OAuthError('invalid_client', 'Client authentication failed', 401)
  const app = await prisma.oAuthApp.findUnique({ where: { clientId: creds.clientId } })
  if (!app || !app.isActive) throw new OAuthError('invalid_client', 'Client authentication failed', 401)

  if (app.isConfidential) {
    if (!creds.clientSecret || !timingSafeEqualString(creds.clientSecret, decrypt(app.clientSecret))) {
      throw new OAuthError('invalid_client', 'Client authentication failed', 401)
    }
  } else if (creds.clientSecret) {
    // 公共客户端没有可验证的密钥
    throw new OAuthError('invalid_client', 'Public clients must not send a client secret', 401)
  }

  return app
}

type GrantResolver = (app: OAuthApp, request: TokenGrantRequest) => Promise<{ userId: string; scope: string }>

const resolveAuthorizationCodeGrant: GrantResolver = async (app, req) => {
  const code = nonEmptyStr(req.code)
  if (!code) throw new OAuthError('invalid_request', 'code is required')

  const codeData = await consumeAuthorizationCode(code)
  if (!codeData || codeData.clientId !== app.clientId) {
    throw new OAuthError('invalid_grant', 'Invalid, expired or already used authorization code')
  }

  // RFC 6749 4.1.3：authorize 时带了 redirect_uri，则必须原样提供
  const redirectUri = nonEmptyStr(req.redirectUri)
  if ((codeData.redirectUriProvided !== false || redirectUri) && redirectUri !== codeData.redirectUri) {
    throw new OAuthError('invalid_grant', 'redirect_uri does not match the authorization request')
  }

  if (codeData.codeChallenge) {
    const verifier = nonEmptyStr(req.codeVerifier)
    if (!verifier || !PKCE_VERIFIER_RE.test(verifier)) {
      throw new OAuthError('invalid_grant', 'Missing or malformed code_verifier')
    }
    if (!verifyPKCE(verifier, codeData.codeChallenge)) {
      throw new OAuthError('invalid_grant', 'PKCE verification failed')
    }
  } else if (nonEmptyStr(req.codeVerifier)) {
    throw new OAuthError('invalid_grant', 'code_verifier sent but no code_challenge was used')
  }

  return { userId: codeData.userId, scope: codeData.scope }
}

const resolveRefreshTokenGrant: GrantResolver = async (app, req) => {
  const refreshToken = nonEmptyStr(req.refreshToken)
  if (!refreshToken) throw new OAuthError('invalid_request', 'refresh_token is required')

  // 原子消费（轮换），防止并发重放
  const tokenData = await consumeRefreshToken(refreshToken, app.clientId)
  if (!tokenData) throw new OAuthError('invalid_grant', 'Invalid or expired refresh token')

  let scope = tokenData.scope
  const requestedScope = nonEmptyStr(req.scope)
  if (requestedScope) {
    const requested = normalizeScope(requestedScope)
    const granted = new Set(scope.split(' '))
    if (requested === null || requested.split(' ').some(s => !granted.has(s))) {
      throw new OAuthError('invalid_scope', 'Requested scope exceeds the original grant')
    }
    scope = requested
  }

  return { userId: tokenData.userId, scope }
}

const GRANT_HANDLERS: Record<string, GrantResolver> = {
  authorization_code: resolveAuthorizationCodeGrant,
  refresh_token: resolveRefreshTokenGrant
}

export async function issueOAuthTokens(creds: ClientCredentials, grantReq: TokenGrantRequest) {
  const grantType = nonEmptyStr(grantReq.grantType)
  if (!grantType) throw new OAuthError('invalid_request', 'grant_type is required')

  const resolver = GRANT_HANDLERS[grantType]
  if (!resolver) {
    throw new OAuthError('unsupported_grant_type', 'Supported grant types: authorization_code, refresh_token')
  }

  const app = await authenticateOAuthClient(creds)
  const { userId, scope } = await resolver(app, grantReq)

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } })
  if (!user) throw new OAuthError('invalid_grant', 'Resource owner no longer exists')

  const accessToken = randomHex()
  await saveAccessToken({ token: accessToken, clientId: app.clientId, userId, scope })
  const newRefreshToken = randomHex()
  await saveRefreshToken(newRefreshToken, app.clientId, userId, scope)

  return {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    refresh_token: newRefreshToken,
    scope
  }
}

// ---------------------------------------------------------------------------
// UserInfo 用例
// ---------------------------------------------------------------------------

export type UserInfoResolution =
  | { ok: true; claims: Record<string, unknown> }
  | { ok: false; error: string; description: string }

export async function resolveUserInfoClaims(token: string, requestOrigin: string): Promise<UserInfoResolution> {
  const tokenData = token ? await verifyAccessToken(token) : null
  if (!tokenData) {
    return { ok: false, error: 'invalid_token', description: 'The access token is invalid or expired' }
  }

  const user = await prisma.user.findUnique({
    where: { id: tokenData.userId },
    select: { id: true, username: true, email: true, nickname: true, avatar: true, updatedAt: true }
  })
  if (!user) {
    return { ok: false, error: 'invalid_token', description: 'The resource owner no longer exists' }
  }

  const scopes = new Set(tokenData.scope.split(' '))
  const claims: Record<string, unknown> = { sub: user.id }

  if (scopes.has('profile')) {
    claims.name = user.nickname || user.username
    claims.preferred_username = user.username
    claims.username = user.username
    if (user.nickname) claims.nickname = user.nickname
    claims.updated_at = Math.floor(user.updatedAt.getTime() / 1000)

    let picture = getAvatarUrl(user.avatar)
    if (picture && picture.startsWith('/')) {
      const base = getSiteUrl() || requestOrigin
      picture = `${base}${picture}`
    }
    if (picture) claims.picture = picture
  }

  if (scopes.has('email')) {
    claims.email = user.email
    // 邮箱为本实例托管的邮箱地址
    claims.email_verified = true
  }

  return { ok: true, claims }
}
