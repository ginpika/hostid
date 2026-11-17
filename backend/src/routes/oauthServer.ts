/**
 * OAuth 2.0 授权服务器路由（HTTP 协议适配器）
 * RFC 6749 授权码模式 + RFC 7636 PKCE (S256) + RFC 6750 Bearer userinfo
 *
 * 浏览器流程：客户端把用户带到 GET /api/oauth2/authorize（无 Authorization 头）
 * → 302 到前端同意页 /oauth2/authorize → 同意页用用户 JWT 调用本 API 校验 / 授权
 * → 返回 redirectUrl（code 或 error），由前端跳回客户端。
 */
import { Router, Request, Response, NextFunction } from 'express'
import { auth, AuthRequest } from '../middleware/auth'
import { asyncHandler } from '../middleware/error'
import {
  OAuthError,
  SUPPORTED_SCOPES,
  decideAuthorization,
  getAuthorizeConsentPreview,
  issueOAuthTokens,
  resolveUserInfoClaims,
  type AuthorizeParams,
  type ClientCredentials
} from '../services/oauth2'
import { getSiteUrl } from '../services/settings'

const router = Router()

const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined)

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
    let clientId: string
    let clientSecret: string
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

// Browser navigation from an OAuth client (no bearer token): hand off to the
// frontend consent page, which logs the user in and then calls this API.
const redirectBrowserToConsentPage = (req: Request, res: Response, next: NextFunction) => {
  if (req.headers.authorization) return next()
  const query = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : ''
  res.redirect(302, `/oauth2/authorize${query}`)
}

router.get('/authorize', redirectBrowserToConsentPage, auth, asyncHandler(async (req: AuthRequest, res: Response) => {
  const outcome = await getAuthorizeConsentPreview(req.userId!, req.query as AuthorizeParams)
  if (!outcome.ok) {
    res.status(outcome.status).json(outcome.body)
    return
  }
  res.json(outcome.body)
}))

router.post('/authorize', auth, asyncHandler(async (req: AuthRequest, res: Response) => {
  const body = (req.body ?? {}) as AuthorizeParams & { approve?: unknown }
  const outcome = await decideAuthorization(req.userId!, body)
  if (!outcome.ok) {
    res.status(outcome.status).json(outcome.body)
    return
  }
  res.json({ redirectUrl: outcome.redirectUrl })
}))

const noStore = (_req: Request, res: Response, next: NextFunction) => {
  res.set('Cache-Control', 'no-store')
  res.set('Pragma', 'no-cache')
  next()
}

router.post('/token', noStore, asyncHandler(async (req: Request, res: Response) => {
  const body = req.body ?? {}
  const creds = readClientCredentials(req)
  const payload = await issueOAuthTokens(creds, {
    grantType: str(body.grant_type),
    code: str(body.code),
    redirectUri: str(body.redirect_uri),
    codeVerifier: str(body.code_verifier),
    refreshToken: str(body.refresh_token),
    scope: str(body.scope)
  })
  res.json(payload)
}))

const bearerChallenge = (res: Response, status: number, error?: string, description?: string) => {
  const parts = ['realm="hostid"']
  if (error) parts.push(`error="${error}"`)
  if (description) parts.push(`error_description="${description}"`)
  res.set('WWW-Authenticate', `Bearer ${parts.join(', ')}`)
  res.status(status).json(error
    ? { error, error_description: description }
    : { error: 'invalid_request', error_description: 'Bearer token required' })
}

const userinfo = asyncHandler(async (req: Request, res: Response) => {
  const header = req.headers.authorization
  if (!header || !/^Bearer\s+/i.test(header)) {
    bearerChallenge(res, 401)
    return
  }
  const token = header.replace(/^Bearer\s+/i, '').trim()
  const outcome = await resolveUserInfoClaims(token, `${req.protocol}://${req.get('host')}`)
  if (!outcome.ok) {
    bearerChallenge(res, 401, outcome.error, outcome.description)
    return
  }
  res.json(outcome.claims)
})

router.get('/userinfo', noStore, userinfo)
router.post('/userinfo', noStore, userinfo)

// RFC 6749 5.2 错误响应格式
router.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
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
