/**
 * OAuth 2.0 服务
 * 实现授权码、访问令牌和刷新令牌的生成与验证
 * 支持 PKCE 验证和令牌持久化
 */
import crypto from 'crypto'
import { prisma } from '../lib/prisma'
import { memoryStore } from '../store'
import { encrypt, decrypt } from './encryption'

// Token 有效期配置
const AUTHORIZATION_CODE_TTL = 10 * 60 * 1000 // 10 分钟
const ACCESS_TOKEN_TTL = 60 * 60 * 1000 // 1 小时
export const ACCESS_TOKEN_TTL_SECONDS = ACCESS_TOKEN_TTL / 1000

export const SUPPORTED_SCOPES = ['openid', 'profile', 'email'] as const
export const DEFAULT_SCOPE = SUPPORTED_SCOPES.join(' ')

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
const REFRESH_TOKEN_TTL_DAYS = 30 // 30 天

// 存储键前缀
const AUTH_CODE_PREFIX = 'oauth2:code:'
const ACCESS_TOKEN_PREFIX = 'oauth2:token:'

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

/**
 * 生成随机的 Client ID
 */
export function generateClientId(): string {
  return `hostid_${crypto.randomBytes(16).toString('hex')}`
}

/**
 * 生成随机的 Client Secret
 */
export function generateClientSecret(): string {
  return crypto.randomBytes(32).toString('hex')
}

/**
 * 生成授权码
 */
export function generateAuthorizationCode(): string {
  return crypto.randomBytes(32).toString('hex')
}

/**
 * 生成 Access Token
 */
export function generateAccessToken(): string {
  return crypto.randomBytes(32).toString('hex')
}

/**
 * 生成 Refresh Token
 */
export function generateRefreshToken(): string {
  return crypto.randomBytes(32).toString('hex')
}

/**
 * 加密 Client Secret
 */
export function encryptClientSecret(secret: string): string {
  return encrypt(secret)
}

/**
 * 解密 Client Secret
 */
export function decryptClientSecret(encryptedSecret: string): string {
  return decrypt(encryptedSecret)
}

/**
 * 保存授权码
 */
export async function saveAuthorizationCode(codeData: AuthorizationCode): Promise<void> {
  await memoryStore.set(
    `${AUTH_CODE_PREFIX}${codeData.code}`,
    JSON.stringify(codeData),
    AUTHORIZATION_CODE_TTL
  )
}

/**
 * 获取并删除授权码（一次性使用）
 */
export async function consumeAuthorizationCode(code: string): Promise<AuthorizationCode | null> {
  const key = `${AUTH_CODE_PREFIX}${code}`
  const data = await memoryStore.get(key)

  if (!data) {
    return null
  }

  // 立即删除，确保一次性使用
  await memoryStore.delete(key)

  return JSON.parse(data) as AuthorizationCode
}

/**
 * 保存 Access Token
 */
export async function saveAccessToken(tokenData: AccessToken): Promise<void> {
  await memoryStore.set(
    `${ACCESS_TOKEN_PREFIX}${tokenData.token}`,
    JSON.stringify(tokenData),
    ACCESS_TOKEN_TTL
  )
}

/**
 * 验证 Access Token
 */
export async function verifyAccessToken(token: string): Promise<AccessToken | null> {
  const data = await memoryStore.get(`${ACCESS_TOKEN_PREFIX}${token}`)

  if (!data) {
    return null
  }

  return JSON.parse(data) as AccessToken
}

/**
 * 撤销 Access Token
 */
export async function revokeAccessToken(token: string): Promise<void> {
  await memoryStore.delete(`${ACCESS_TOKEN_PREFIX}${token}`)
}

/**
 * 保存 Refresh Token 到数据库
 */
export async function saveRefreshToken(
  token: string,
  clientId: string,
  userId: string,
  scope: string = DEFAULT_SCOPE
): Promise<void> {
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000)

  await prisma.refreshToken.create({
    data: {
      token,
      clientId,
      userId,
      scope,
      expiresAt
    }
  })
}

/**
 * 验证 Refresh Token
 */
export async function verifyRefreshToken(token: string): Promise<{
  userId: string
  clientId: string
} | null> {
  const refreshToken = await prisma.refreshToken.findUnique({
    where: { token }
  })

  if (!refreshToken) {
    return null
  }

  if (refreshToken.expiresAt < new Date()) {
    await prisma.refreshToken.delete({ where: { token } })
    return null
  }

  return {
    userId: refreshToken.userId,
    clientId: refreshToken.clientId
  }
}

/**
 * 原子消费 Refresh Token（轮换）：只有成功删除记录的请求才能换取新令牌
 */
export async function consumeRefreshToken(token: string, clientId: string): Promise<{
  userId: string
  scope: string
} | null> {
  const record = await prisma.refreshToken.findUnique({ where: { token } })
  if (!record || record.clientId !== clientId) return null
  const { count } = await prisma.refreshToken.deleteMany({ where: { token, clientId } })
  if (count !== 1 || record.expiresAt < new Date()) return null
  return { userId: record.userId, scope: record.scope }
}

/**
 * 撤销 Refresh Token
 */
export async function revokeRefreshToken(token: string): Promise<void> {
  await prisma.refreshToken.delete({ where: { token } }).catch(() => {
    // 忽略不存在的错误
  })
}

/**
 * 验证 PKCE code_verifier
 */
export function verifyPKCE(codeVerifier: string, codeChallenge: string): boolean {
  // 只支持 S256（RFC 7636 4.2；不接受 plain）
  const hash = crypto.createHash('sha256').update(codeVerifier).digest()
  const expected = Buffer.from(codeChallenge, 'base64url')
  return expected.length === hash.length && crypto.timingSafeEqual(hash, expected)
}

/**
 * 清理用户的所有 refresh tokens
 */
export async function cleanupUserRefreshTokens(userId: string): Promise<void> {
  await prisma.refreshToken.deleteMany({
    where: { userId }
  })
}