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
const REFRESH_TOKEN_TTL_DAYS = 30 // 30 天

// 存储键前缀
const AUTH_CODE_PREFIX = 'oauth2:code:'
const ACCESS_TOKEN_PREFIX = 'oauth2:token:'

interface AuthorizationCode {
  code: string
  clientId: string
  redirectUri: string
  userId: string
  scope: string
  codeChallenge?: string
  codeChallengeMethod?: 'S256' | 'plain'
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
  userId: string
): Promise<void> {
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000)

  await prisma.refreshToken.create({
    data: {
      token,
      clientId,
      userId,
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
export function verifyPKCE(
  codeVerifier: string,
  codeChallenge: string,
  method: 'S256' | 'plain' = 'S256'
): boolean {
  if (method === 'plain') {
    return codeVerifier === codeChallenge
  }

  // S256 方法
  const hash = crypto
    .createHash('sha256')
    .update(codeVerifier)
    .digest('base64url')

  return hash === codeChallenge
}

/**
 * 清理用户的所有 refresh tokens
 */
export async function cleanupUserRefreshTokens(userId: string): Promise<void> {
  await prisma.refreshToken.deleteMany({
    where: { userId }
  })
}