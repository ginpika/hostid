/**
 * 融合邮件令牌存储
 * - 令牌按「用户 + 平台 + 邮箱」唯一存储，同平台多个账号互不覆盖
 * - access/refresh token 使用项目现有的 AES-256-GCM（services/encryption）加密
 * - 刷新时对同一账号加锁；Microsoft 会轮换 refresh token，拿到后立即写回
 * - 刷新失败只把该账号标记为需要重新授权
 */
import { prisma } from '../../lib/prisma'
import { encrypt, decrypt } from '../encryption'
import { PLATFORMS, isMailPlatform, normalizeEmail, type MailPlatform } from './platforms'

export const ACCOUNT_STATUS = {
  ACTIVE: 'active',
  REAUTH_REQUIRED: 'reauth_required',
  ERROR: 'error'
} as const

const EXPIRY_SKEW_MS = 60 * 1000

export class FusedMailAuthError extends Error {
  /** true 表示令牌已失效，需要用户重新授权 */
  reauth: boolean
  constructor(message: string, reauth: boolean) {
    super(message)
    this.reauth = reauth
  }
}

export interface TokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  id_token?: string
  scope?: string
  error?: string
  error_description?: string
}

export interface ProviderSecrets {
  clientId: string
  clientSecret: string
  tokenUrl: string
  redirectUri: string
}

/** 以 application/x-www-form-urlencoded 调用 token 端点（Google / Microsoft 都要求表单格式） */
export async function postTokenRequest(tokenUrl: string, params: Record<string, string>): Promise<{ ok: boolean; status: number; data: TokenResponse }> {
  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(params).toString()
  })
  let data: TokenResponse = {}
  try { data = await response.json() as TokenResponse } catch { data = { error: 'invalid_response' } }
  return { ok: response.ok && !data.error, status: response.status, data }
}

export async function getProviderSecrets(providerId: string | null): Promise<ProviderSecrets & { platform: MailPlatform }> {
  if (!providerId) throw new FusedMailAuthError('OAuth provider was removed', true)
  const provider = await prisma.oAuthProvider.findUnique({ where: { id: providerId } })
  if (!provider || !provider.isActive || !provider.useForFusedMail || !isMailPlatform(provider.mailPlatform)) {
    throw new FusedMailAuthError('OAuth provider is not available for fused mail', true)
  }
  return {
    platform: provider.mailPlatform,
    clientId: provider.clientId,
    clientSecret: decrypt(provider.clientSecret),
    tokenUrl: provider.tokenUrl || PLATFORMS[provider.mailPlatform].defaultTokenUrl,
    redirectUri: getFusedMailCallbackUrl(provider.fusedMailCallbackUrl)
  }
}

export function getFusedMailCallbackUrl(configured?: string | null): string {
  if (configured) return configured
  if (process.env.FUSED_MAIL_CALLBACK_URL) return process.env.FUSED_MAIL_CALLBACK_URL
  const base = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '')
  return `${base}/api/fused-mail/oauth/callback`
}

export interface SaveAuthorizedAccountInput {
  userId: string
  providerId: string
  platform: MailPlatform
  email: string
  displayName?: string | null
  tokens: TokenResponse
}

/**
 * 授权回调后保存账号。以返回的邮箱判断是新增还是重新授权：
 * 同一用户 + 平台 + 邮箱 → 更新令牌（重新授权）；否则新建，不会影响同平台的其他账号。
 */
export async function saveAuthorizedAccount(input: SaveAuthorizedAccountInput) {
  const email = normalizeEmail(input.email)
  const { access_token: accessToken, refresh_token: refreshToken, expires_in: expiresIn } = input.tokens
  if (!accessToken) throw new FusedMailAuthError('Token response did not include an access token', true)
  const where = { userId_platform_email: { userId: input.userId, platform: input.platform, email } }
  const existing = await prisma.fusedMailAccount.findUnique({ where })
  // Google 在某些情况下不会再次下发 refresh token；此时保留已有的，新账号则必须要有
  if (!refreshToken && !existing) {
    throw new FusedMailAuthError('No refresh token was returned. Remove the app from your account permissions and try again.', true)
  }
  const accessTokenExpiresAt = new Date(Date.now() + (expiresIn ?? 3600) * 1000)
  const tokenData = {
    accessToken: encrypt(accessToken),
    ...(refreshToken ? { refreshToken: encrypt(refreshToken) } : {}),
    accessTokenExpiresAt,
    providerId: input.providerId,
    status: ACCOUNT_STATUS.ACTIVE,
    lastError: null,
    ...(input.displayName ? { displayName: input.displayName } : {})
  }
  if (existing) {
    const account = await prisma.fusedMailAccount.update({ where: { id: existing.id }, data: tokenData })
    return { account, created: false }
  }
  const account = await prisma.fusedMailAccount.create({
    data: {
      userId: input.userId,
      platform: input.platform,
      email,
      refreshToken: encrypt(refreshToken!),
      ...tokenData
    }
  })
  return { account, created: true }
}

// 同一账号的刷新串行化（单进程锁）。多实例部署需要换成分布式锁，见 docs/fused-mail.md
const refreshLocks = new Map<string, Promise<unknown>>()

export async function withAccountLock<T>(accountId: string, task: () => Promise<T>): Promise<T> {
  const previous = refreshLocks.get(accountId) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>(resolve => { release = resolve })
  const chained = previous.then(() => current)
  refreshLocks.set(accountId, chained)
  await previous.catch(() => undefined)
  try {
    return await task()
  } finally {
    release()
    if (refreshLocks.get(accountId) === chained) refreshLocks.delete(accountId)
  }
}

export async function markAccountReauthRequired(accountId: string, reason: string) {
  await prisma.fusedMailAccount.update({
    where: { id: accountId },
    data: { status: ACCOUNT_STATUS.REAUTH_REQUIRED, lastError: reason.slice(0, 500) }
  }).catch(() => undefined)
}

/** 使用 refresh token 换新的 access token。调用方需持有该账号的锁。 */
async function refreshLocked(accountId: string): Promise<string> {
  const account = await prisma.fusedMailAccount.findUnique({ where: { id: accountId } })
  if (!account) throw new FusedMailAuthError('Account not found', false)
  // 拿到锁后再检查一次：可能已被前一个并发请求刷新过
  if (account.accessTokenExpiresAt && account.accessTokenExpiresAt.getTime() - EXPIRY_SKEW_MS > Date.now() && account.status === ACCOUNT_STATUS.ACTIVE) {
    return decrypt(account.accessToken)
  }
  try {
    const provider = await getProviderSecrets(account.providerId)
    const { ok, status, data } = await postTokenRequest(provider.tokenUrl, {
      grant_type: 'refresh_token',
      refresh_token: decrypt(account.refreshToken),
      client_id: provider.clientId,
      client_secret: provider.clientSecret,
      ...(account.platform === 'outlook' ? { scope: PLATFORMS.outlook.scopes.join(' ') } : {})
    })
    if (!ok || !data.access_token) {
      const reason = data.error_description || data.error || `HTTP ${status}`
      // 4xx（invalid_grant 等）说明令牌被撤销/过期；5xx 或网络问题只记错误，下次再试
      throw new FusedMailAuthError(`Token refresh failed: ${reason}`, status >= 400 && status < 500)
    }
    await prisma.fusedMailAccount.update({
      where: { id: account.id },
      data: {
        accessToken: encrypt(data.access_token),
        // Microsoft 每次刷新都会轮换 refresh token，必须立即写回，否则旧的很快失效
        ...(data.refresh_token ? { refreshToken: encrypt(data.refresh_token) } : {}),
        accessTokenExpiresAt: new Date(Date.now() + (data.expires_in ?? 3600) * 1000),
        status: ACCOUNT_STATUS.ACTIVE,
        lastError: null
      }
    })
    return data.access_token
  } catch (error) {
    if (error instanceof FusedMailAuthError && error.reauth) {
      await markAccountReauthRequired(account.id, error.message)
    } else {
      await prisma.fusedMailAccount.update({
        where: { id: account.id },
        data: { lastError: (error instanceof Error ? error.message : String(error)).slice(0, 500) }
      }).catch(() => undefined)
    }
    throw error
  }
}

export function refreshAccountToken(accountId: string): Promise<string> {
  return withAccountLock(accountId, async () => {
    // 强制刷新：先把过期时间置空
    await prisma.fusedMailAccount.update({ where: { id: accountId }, data: { accessTokenExpiresAt: null } })
    return refreshLocked(accountId)
  })
}

/** 返回可用的 access token，必要时自动刷新 */
export async function getValidAccessToken(accountId: string): Promise<string> {
  const account = await prisma.fusedMailAccount.findUnique({ where: { id: accountId } })
  if (!account) throw new FusedMailAuthError('Account not found', false)
  if (account.status === ACCOUNT_STATUS.REAUTH_REQUIRED) throw new FusedMailAuthError('Account requires re-authorization', true)
  if (account.accessTokenExpiresAt && account.accessTokenExpiresAt.getTime() - EXPIRY_SKEW_MS > Date.now()) {
    return decrypt(account.accessToken)
  }
  return withAccountLock(accountId, () => refreshLocked(accountId))
}
