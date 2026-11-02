/**
 * 融合邮件平台配置
 * 定义 Gmail / Outlook 的 IMAP、SMTP 服务器与 OAuth2 scope
 * 以及构造授权地址、从 id_token 解析邮箱等纯函数
 */
export type MailPlatform = 'gmail' | 'outlook'

export interface PlatformConfig {
  platform: MailPlatform
  label: string
  imap: { host: string; port: number }
  smtp: { host: string; port: number; secure: boolean }
  scopes: string[]
  /** 额外的授权参数（多账号：强制选择账号；Google 需要 offline + consent 才能拿到 refresh token） */
  authParams: Record<string, string>
  defaultAuthorizationUrl: string
  defaultTokenUrl: string
}

export const PLATFORMS: Record<MailPlatform, PlatformConfig> = {
  gmail: {
    platform: 'gmail',
    label: 'Gmail',
    imap: { host: 'imap.gmail.com', port: 993 },
    smtp: { host: 'smtp.gmail.com', port: 465, secure: true },
    scopes: ['https://mail.google.com/', 'openid', 'email'],
    authParams: { access_type: 'offline', prompt: 'select_account consent', include_granted_scopes: 'true' },
    defaultAuthorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    defaultTokenUrl: 'https://oauth2.googleapis.com/token'
  },
  outlook: {
    platform: 'outlook',
    label: 'Outlook / Hotmail',
    imap: { host: 'outlook.office365.com', port: 993 },
    smtp: { host: 'smtp-mail.outlook.com', port: 587, secure: false },
    scopes: ['https://outlook.office.com/IMAP.AccessAsUser.All', 'offline_access', 'openid', 'email'],
    authParams: { prompt: 'select_account' },
    defaultAuthorizationUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    defaultTokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token'
  }
}

export function isMailPlatform(value: unknown): value is MailPlatform {
  return value === 'gmail' || value === 'outlook'
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export interface AuthorizationUrlInput {
  platform: MailPlatform
  authorizationUrl: string
  clientId: string
  redirectUri: string
  state: string
  codeChallenge: string
  loginHint?: string
}

export function buildAuthorizationUrl(input: AuthorizationUrlInput): string {
  const config = PLATFORMS[input.platform]
  const url = new URL(input.authorizationUrl || config.defaultAuthorizationUrl)
  url.searchParams.set('client_id', input.clientId)
  url.searchParams.set('redirect_uri', input.redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', config.scopes.join(' '))
  url.searchParams.set('state', input.state)
  url.searchParams.set('code_challenge', input.codeChallenge)
  url.searchParams.set('code_challenge_method', 'S256')
  for (const [key, value] of Object.entries(config.authParams)) url.searchParams.set(key, value)
  if (input.loginHint) url.searchParams.set('login_hint', input.loginHint)
  return url.toString()
}

/**
 * 从 token 端点直接返回的 id_token 中读取邮箱。
 * id_token 是通过 TLS 直接从授权服务器拿到的（不是经由浏览器转交），按 OIDC 规范可以不再校验签名。
 */
export function emailFromIdToken(idToken: string | undefined): string | null {
  if (!idToken) return null
  const parts = idToken.split('.')
  if (parts.length < 2) return null
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Record<string, unknown>
    const candidate = payload.email || payload.preferred_username || payload.upn
    return typeof candidate === 'string' && candidate.includes('@') ? normalizeEmail(candidate) : null
  } catch {
    return null
  }
}
