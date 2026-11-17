/**
 * 外部 OAuth 2.0 / OIDC 网关
 * 封装对第三方授权服务器的 HTTP 调用（换取 token、读取 userinfo）以及 userinfo 到统一身份的映射，
 * 路由层不再直接 fetch 外部端点。
 */
import { AppError } from '../middleware/error'
import type { ProviderConfig } from './oauth-provider-registry'

const EXTERNAL_REQUEST_TIMEOUT_MS = 15_000

/** 从 userinfo 响应提取的标准化身份：兼容 OIDC（sub/preferred_username/picture）、GitHub 和 hostid */
export interface ExternalProfile {
  subject: string
  login: string
  email: string | null
  name: string | null
  avatarUrl: string
}

export function mapUserinfo(raw: Record<string, unknown>): ExternalProfile | null {
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

interface TokenResponse {
  access_token?: string
  token_type?: string
  error?: string
  error_description?: string
}

/** RFC 6749 4.1.3：application/x-www-form-urlencoded，client_secret_post（附带 PKCE code_verifier） */
async function exchangeAuthorizationCode(config: ProviderConfig, code: string, codeVerifier: string): Promise<string> {
  const response = await fetch(config.tokenUrl, {
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
      code_verifier: codeVerifier
    }).toString(),
    signal: AbortSignal.timeout(EXTERNAL_REQUEST_TIMEOUT_MS)
  })

  const text = await response.text()
  let data: TokenResponse = {}
  try {
    data = JSON.parse(text)
  } catch {
    // 个别 Provider（如旧版 GitHub）返回表单编码
    data = Object.fromEntries(new URLSearchParams(text))
  }

  if (!response.ok || data.error || !data.access_token) {
    console.error('OAuth token error:', response.status, data.error, data.error_description)
    throw new AppError(`OAuth error: ${data.error_description || data.error || `HTTP ${response.status}`}`, 400)
  }
  if (data.token_type && data.token_type.toLowerCase() !== 'bearer') {
    throw new AppError(`Unsupported token_type: ${data.token_type}`, 400)
  }
  return data.access_token
}

async function fetchUserinfo(config: ProviderConfig, accessToken: string): Promise<ExternalProfile> {
  const response = await fetch(config.userinfoUrl, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json'
    },
    signal: AbortSignal.timeout(EXTERNAL_REQUEST_TIMEOUT_MS)
  })
  if (!response.ok) {
    throw new AppError('Failed to fetch user info', 400)
  }

  const profile = mapUserinfo(await response.json() as Record<string, unknown>)
  if (!profile) {
    throw new AppError('User info response has no subject identifier (sub / id)', 400)
  }
  return profile
}

/** 授权码 → access token → 标准化身份 */
export async function fetchExternalProfile(config: ProviderConfig, code: string, codeVerifier: string): Promise<ExternalProfile> {
  const accessToken = await exchangeAuthorizationCode(config, code, codeVerifier)
  return fetchUserinfo(config, accessToken)
}
