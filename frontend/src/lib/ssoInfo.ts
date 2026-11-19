/**
 * Pure helpers for parsing client-visible SSO cookie/JWT metadata and resolving user avatars.
 */

export interface CookieInfo {
  name: string
  value: string
  domain: string
  path: string
  expires: string
  httpOnly: boolean
  secure: boolean
  sameSite: string
}

export interface DecodedToken {
  sessionId: string
  iat: number
  exp: number
}

export interface SsoUserAvatarSource {
  avatar?: string | null
  avatarUrl?: string | null
}

function decodeBase64UrlJson(segment: string): Record<string, unknown> | null {
  const normalized = segment.replace(/-/g, '+').replace(/_/g, '/')
  const padLength = (4 - (normalized.length % 4)) % 4
  const padded = normalized + '='.repeat(padLength)
  const binary = atob(padded)
  const bytes = Uint8Array.from(binary, ch => ch.charCodeAt(0))
  const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes))
  return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
}

function formatTruncatedToken(token: string): string {
  if (token.length <= 34) return token
  return `${token.slice(0, 20)}...${token.slice(-10)}`
}

/**
 * Parses `sso_token` from `document.cookie` when accessible to JS (non-HttpOnly environments).
 * In standard deployments where `sso_token` is HttpOnly, both fields remain null.
 */
export function parseSsoCookieAndToken(
  rawCookie: string,
  locationInfo: { hostname: string; protocol: string }
): { cookieInfo: CookieInfo | null; decodedToken: DecodedToken | null } {
  const cookies: Record<string, string> = {}
  for (const part of rawCookie.split(';')) {
    const trimmed = part.trim()
    if (!trimmed) continue
    const eqIndex = trimmed.indexOf('=')
    if (eqIndex <= 0) continue
    cookies[trimmed.slice(0, eqIndex)] = trimmed.slice(eqIndex + 1)
  }

  const ssoToken = cookies['sso_token']
  if (!ssoToken) {
    return { cookieInfo: null, decodedToken: null }
  }

  const cookieInfo: CookieInfo = {
    name: 'sso_token',
    value: formatTruncatedToken(ssoToken),
    domain: locationInfo.hostname,
    path: '/',
    expires: 'Session (7 days)',
    httpOnly: true,
    secure: locationInfo.protocol === 'https:',
    sameSite: 'Lax'
  }

  let decodedToken: DecodedToken | null = null
  try {
    const parts = ssoToken.split('.')
    if (parts.length === 3 && parts[1]) {
      const payload = decodeBase64UrlJson(parts[1])
      if (
        payload &&
        typeof payload.sessionId === 'string' &&
        typeof payload.iat === 'number' &&
        typeof payload.exp === 'number'
      ) {
        decodedToken = {
          sessionId: payload.sessionId,
          iat: payload.iat,
          exp: payload.exp
        }
      }
    }
  } catch {
    decodedToken = null
  }

  return { cookieInfo, decodedToken }
}

export function resolveSsoAvatarUrl(user?: SsoUserAvatarSource | null): string | null {
  if (!user) return null
  if (user.avatarUrl) return user.avatarUrl
  if (!user.avatar) return null
  return user.avatar.startsWith('http') ? user.avatar : `/api/auth/avatar/${user.avatar}`
}

export function formatRemainingHours(expSeconds: number, nowMs = Date.now()): number {
  return Math.max(0, Math.floor((expSeconds * 1000 - nowMs) / 1000 / 60 / 60))
}
