/**
 * WebAuthn / FIDO2 Passkey 服务
 * 遵循 WebAuthn Level 2/3 标准，兼容 macOS 密码 App / iCloud 钥匙串 / Touch ID 及跨设备通行密钥
 */
import crypto from 'crypto'
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type RegistrationResponseJSON,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON
} from '@simplewebauthn/server'
import { prisma } from '../lib/prisma'
import { memoryStore } from '../store'
import { AppError } from '../middleware/error'
import { getSettings } from './settings'

const CHALLENGE_TTL_MS = 5 * 60 * 1000
const WEBAUTHN_TIMEOUT_MS = 60_000
// Prioritize ES256 (-7, Apple Secure Enclave), RS256 (-257), EdDSA (-8)
const SUPPORTED_COSE_ALGS = [-7, -257, -8]
const RP_NAME = 'HostID'

export type AuthenticatorMode = 'platform' | 'all'

export interface WebAuthnContext {
  rpID: string
  rpName: string
  expectedOrigin: string
}

/** 结构化请求视图，使 Passkey 服务不依赖 Express Request 类型 */
export interface WebAuthnRequestSource {
  headers: Record<string, string | string[] | undefined>
  protocol?: string
  get(name: string): string | string[] | undefined
}

interface StoredRegistrationChallenge {
  challenge: string
  userId: string
  rpID: string
  expectedOrigin: string
}

interface StoredAuthenticationChallenge {
  challenge: string
  rpID: string
  expectedOrigin: string
}

const WELL_KNOWN_AAGUID_NAMES: Record<string, string> = {
  'fbfc3007-154e-4ecc-8c0b-6e020557d7bd': 'Apple 密码 / iCloud 钥匙串',
  'dd4ec289-e01d-41c9-bb89-70fa845d4bf2': 'iCloud 钥匙串',
  'adce0002-35bc-c60a-648b-0b25f1f05503': 'Mac Touch ID',
  'ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4': 'Google 密码管理器',
  'bada5566-a7aa-401f-bd96-45619a55120d': '1Password',
  'd548826e-79b4-db40-a3d8-11116f7e8349': 'Bitwarden',
  '08987058-cadc-4b81-b6e1-30de50dcbe96': 'Windows Hello',
  '6028b017-b1d4-4c02-b4b3-afcdafc96bb2': 'Windows Hello'
}

function parseOriginUrl(raw: string): URL | null {
  try {
    const parsed = new URL(raw.trim())
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

function getHeaderFirstValue(val: string | string[] | undefined): string {
  if (!val) return ''
  const raw = Array.isArray(val) ? val[0] : val
  return raw.split(',')[0].trim()
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase()
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1' || normalized === '[::1]'
}

/**
 * 解析当前请求的 WebAuthn RP ID 与 Expected Origin
 * 兼容 Vite 开发代理 (changeOrigin: true 导致 Host=localhost:3001 而 Origin=http://localhost:3000) 及 Nginx 反向代理
 */
export function resolveWebAuthnContext(req: WebAuthnRequestSource): WebAuthnContext {
  const settings = getSettings()
  const configuredOrigins = new Set<string>()

  const siteUrl = settings.siteUrl ? parseOriginUrl(settings.siteUrl) : null
  if (siteUrl) {
    configuredOrigins.add(siteUrl.origin)
  }
  if (settings.corsAllowedOrigins) {
    for (const entry of settings.corsAllowedOrigins.split(',')) {
      const parsed = parseOriginUrl(entry)
      if (parsed) configuredOrigins.add(parsed.origin)
    }
  }

  const forwardedHost = getHeaderFirstValue(req.headers['x-forwarded-host'])
  const rawHost = forwardedHost || getHeaderFirstValue(req.get('host')) || 'localhost'
  const hostUrl = parseOriginUrl(`http://${rawHost}`)
  const requestHostname = hostUrl?.hostname || 'localhost'

  const originHeader = getHeaderFirstValue(req.headers.origin)
  if (originHeader) {
    const originUrl = parseOriginUrl(originHeader)
    if (!originUrl) {
      throw new AppError('Invalid WebAuthn origin', 400)
    }

    const inConfiguredOrigins = configuredOrigins.has(originUrl.origin)
    const sameRequestHostname = originUrl.hostname.toLowerCase() === requestHostname.toLowerCase()
    const devLoopback = process.env.NODE_ENV !== 'production' && isLoopbackHostname(originUrl.hostname)

    // 当管理员配置了 siteUrl/corsAllowedOrigins 时，只允许白名单来源或同域反向代理来源
    if (configuredOrigins.size > 0 && !inConfiguredOrigins && !sameRequestHostname && !devLoopback) {
      throw new AppError('Untrusted WebAuthn origin', 403)
    }

    // 浏览器强制要求非安全上下文除 localhost 外必须使用 HTTPS
    if (originUrl.protocol !== 'https:' && !isLoopbackHostname(originUrl.hostname)) {
      throw new AppError('WebAuthn requires HTTPS origin for non-localhost domains', 400)
    }

    return {
      rpID: originUrl.hostname,
      rpName: RP_NAME,
      expectedOrigin: originUrl.origin
    }
  }

  if (siteUrl) {
    return {
      rpID: siteUrl.hostname,
      rpName: RP_NAME,
      expectedOrigin: siteUrl.origin
    }
  }

  const forwardedProto = getHeaderFirstValue(req.headers['x-forwarded-proto']) || req.protocol || 'http'
  const proto = forwardedProto === 'https' ? 'https' : 'http'
  return {
    rpID: requestHostname,
    rpName: RP_NAME,
    expectedOrigin: `${proto}://${rawHost}`
  }
}

function parseTransports(raw: string | null | undefined): string[] | undefined {
  if (!raw) return undefined
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === 'string')
    }
    return undefined
  } catch {
    return undefined
  }
}

function inferPasskeyDefaultName(aaguid?: string, userAgent?: string): string {
  const normalizedAaguid = aaguid?.toLowerCase()
  if (normalizedAaguid && WELL_KNOWN_AAGUID_NAMES[normalizedAaguid]) {
    return WELL_KNOWN_AAGUID_NAMES[normalizedAaguid]
  }

  const ua = (userAgent || '').toLowerCase()
  if (ua.includes('iphone')) return 'iPhone Passkey'
  if (ua.includes('ipad')) return 'iPad Passkey'
  if (ua.includes('macintosh') || ua.includes('mac os')) return 'Mac Passkey'
  if (ua.includes('windows')) return 'Windows Passkey'
  if (ua.includes('android')) return 'Android Passkey'
  return 'Passkey'
}

function getRegistrationChallengeKey(challengeId: string): string {
  return `passkey:reg:${challengeId}`
}

function getAuthenticationChallengeKey(challengeId: string): string {
  return `passkey:auth:${challengeId}`
}

export async function createRegistrationOptionsForUser(
  userId: string,
  req: WebAuthnRequestSource,
  authenticatorMode: AuthenticatorMode = 'platform'
): Promise<{ challengeId: string; options: PublicKeyCredentialCreationOptionsJSON }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, username: true, nickname: true, email: true }
  })
  if (!user) {
    throw new AppError('User not found', 404)
  }

  const ctx = resolveWebAuthnContext(req)
  const existingPasskeys = await prisma.passkey.findMany({
    where: { userId: user.id },
    select: { credentialId: true, transports: true }
  })

  const excludeCredentials = existingPasskeys.map((pk) => ({
    id: pk.credentialId,
    transports: parseTransports(pk.transports)
  }))

  // 非 PII 稳定字节序列作为 WebAuthn user.id，保证同一用户的多把 Passkey 在苹果密码 App 中正确归组
  const userIDBytes = new TextEncoder().encode(user.id)

  const options = await generateRegistrationOptions({
    rpName: ctx.rpName,
    rpID: ctx.rpID,
    userID: userIDBytes,
    userName: user.username || user.email,
    userDisplayName: user.nickname || user.username,
    timeout: WEBAUTHN_TIMEOUT_MS,
    attestationType: 'none',
    excludeCredentials,
    supportedAlgorithmIDs: SUPPORTED_COSE_ALGS,
    authenticatorSelection: {
      residentKey: 'required',
      userVerification: 'preferred'
    },
    ...(authenticatorMode === 'platform' ? { preferredAuthenticatorType: 'localDevice' as const } : {})
  })

  if (authenticatorMode === 'all') {
    options.hints = ['client-device', 'hybrid', 'security-key']
  }

  const challengeId = crypto.randomUUID()
  const payload: StoredRegistrationChallenge = {
    challenge: options.challenge,
    userId: user.id,
    rpID: ctx.rpID,
    expectedOrigin: ctx.expectedOrigin
  }
  await memoryStore.set(getRegistrationChallengeKey(challengeId), JSON.stringify(payload), CHALLENGE_TTL_MS)

  return { challengeId, options }
}

export async function verifyRegistrationForUser(params: {
  userId: string
  challengeId: string
  response: RegistrationResponseJSON
  name?: string
  userAgent?: string
}) {
  const key = getRegistrationChallengeKey(params.challengeId)
  const raw = await memoryStore.get(key)
  // 单次有效挑战，读取后立即销毁防重放
  await memoryStore.delete(key)

  if (!raw) {
    throw new AppError('Passkey registration challenge expired or invalid', 400)
  }

  const stored = JSON.parse(raw) as StoredRegistrationChallenge
  if (stored.userId !== params.userId) {
    throw new AppError('Challenge user mismatch', 403)
  }

  let verification
  try {
    verification = await verifyRegistrationResponse({
      response: params.response,
      expectedChallenge: stored.challenge,
      expectedOrigin: stored.expectedOrigin,
      expectedRPID: stored.rpID,
      requireUserPresence: true,
      requireUserVerification: false,
      supportedAlgorithmIDs: SUPPORTED_COSE_ALGS
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Passkey registration verification failed'
    throw new AppError(message, 400)
  }

  if (!verification.verified || !verification.registrationInfo) {
    throw new AppError('Passkey registration verification failed', 400)
  }

  const { credential, credentialDeviceType, credentialBackedUp, aaguid } = verification.registrationInfo
  const existing = await prisma.passkey.findUnique({
    where: { credentialId: credential.id },
    select: { id: true }
  })
  if (existing) {
    throw new AppError('This passkey is already registered', 409)
  }

  const trimmedName = params.name?.trim()
  const displayName = trimmedName || inferPasskeyDefaultName(aaguid, params.userAgent)
  const transports = credential.transports || params.response.response.transports

  const created = await prisma.passkey.create({
    data: {
      userId: params.userId,
      credentialId: credential.id,
      publicKey: Buffer.from(credential.publicKey),
      counter: credential.counter,
      name: displayName.slice(0, 64),
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
      transports: transports && transports.length > 0 ? JSON.stringify(transports) : null,
      aaguid: aaguid || null
    },
    select: {
      id: true,
      credentialId: true,
      name: true,
      deviceType: true,
      backedUp: true,
      transports: true,
      aaguid: true,
      lastUsedAt: true,
      createdAt: true
    }
  })

  return formatPasskeyRecord(created)
}

export async function createAuthenticationOptions(
  req: WebAuthnRequestSource
): Promise<{ challengeId: string; options: PublicKeyCredentialRequestOptionsJSON }> {
  if (!getSettings().passkeyEnabled) {
    throw new AppError('Passkey login is disabled', 403)
  }

  const ctx = resolveWebAuthnContext(req)
  const options = await generateAuthenticationOptions({
    rpID: ctx.rpID,
    timeout: WEBAUTHN_TIMEOUT_MS,
    userVerification: 'preferred'
  })

  // WebAuthn L3 hints: 优先提示本机密码管理器 (如 macOS 密码 App)，同时保留跨设备选项
  options.hints = ['client-device', 'hybrid', 'security-key']

  const challengeId = crypto.randomUUID()
  const payload: StoredAuthenticationChallenge = {
    challenge: options.challenge,
    rpID: ctx.rpID,
    expectedOrigin: ctx.expectedOrigin
  }
  await memoryStore.set(getAuthenticationChallengeKey(challengeId), JSON.stringify(payload), CHALLENGE_TTL_MS)

  return { challengeId, options }
}

export async function verifyAuthentication(params: {
  challengeId: string
  response: AuthenticationResponseJSON
}) {
  if (!getSettings().passkeyEnabled) {
    throw new AppError('Passkey login is disabled', 403)
  }

  const key = getAuthenticationChallengeKey(params.challengeId)
  const raw = await memoryStore.get(key)
  await memoryStore.delete(key)

  if (!raw) {
    throw new AppError('Passkey authentication challenge expired or invalid', 400)
  }

  const stored = JSON.parse(raw) as StoredAuthenticationChallenge
  const passkey = await prisma.passkey.findUnique({
    where: { credentialId: params.response.id },
    include: { user: true }
  })

  if (!passkey || !passkey.user) {
    throw new AppError('Passkey not recognized', 401)
  }

  let verification
  try {
    verification = await verifyAuthenticationResponse({
      response: params.response,
      expectedChallenge: stored.challenge,
      expectedOrigin: stored.expectedOrigin,
      expectedRPID: stored.rpID,
      credential: {
        id: passkey.credentialId,
        publicKey: new Uint8Array(passkey.publicKey),
        counter: passkey.counter,
        transports: parseTransports(passkey.transports)
      },
      requireUserVerification: false
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Passkey authentication failed'
    throw new AppError(message, 401)
  }

  if (!verification.verified) {
    throw new AppError('Passkey authentication failed', 401)
  }

  await prisma.passkey.update({
    where: { id: passkey.id },
    data: {
      counter: verification.authenticationInfo.newCounter,
      deviceType: verification.authenticationInfo.credentialDeviceType,
      backedUp: verification.authenticationInfo.credentialBackedUp,
      lastUsedAt: new Date()
    }
  })

  return {
    user: passkey.user,
    passkeyId: passkey.id
  }
}

const PASSKEY_VIEW_SELECT = {
  id: true,
  credentialId: true,
  name: true,
  deviceType: true,
  backedUp: true,
  transports: true,
  aaguid: true,
  lastUsedAt: true,
  createdAt: true
} as const

export async function listPasskeysForUser(userId: string) {
  const passkeys = await prisma.passkey.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: PASSKEY_VIEW_SELECT
  })
  return passkeys.map(formatPasskeyRecord)
}

export async function renamePasskeyForUser(userId: string, passkeyId: string, name: string) {
  const existing = await prisma.passkey.findUnique({
    where: { id: passkeyId },
    select: { id: true, userId: true }
  })

  if (!existing || existing.userId !== userId) {
    throw new AppError('Passkey not found', 404)
  }

  const updated = await prisma.passkey.update({
    where: { id: existing.id },
    data: { name },
    select: PASSKEY_VIEW_SELECT
  })

  return formatPasskeyRecord(updated)
}

export async function deletePasskeyForUser(userId: string, passkeyId: string): Promise<string> {
  const existing = await prisma.passkey.findUnique({
    where: { id: passkeyId },
    select: { id: true, userId: true, credentialId: true }
  })

  if (!existing || existing.userId !== userId) {
    throw new AppError('Passkey not found', 404)
  }

  await prisma.passkey.delete({ where: { id: existing.id } })
  return existing.credentialId
}

export function formatPasskeyRecord(record: {
  id: string
  credentialId: string
  name: string
  deviceType: string
  backedUp: boolean
  transports: string | null
  aaguid: string | null
  lastUsedAt: Date | null
  createdAt: Date
}) {
  return {
    id: record.id,
    credentialId: record.credentialId,
    name: record.name,
    deviceType: record.deviceType,
    backedUp: record.backedUp,
    transports: parseTransports(record.transports) || [],
    aaguid: record.aaguid,
    lastUsedAt: record.lastUsedAt,
    createdAt: record.createdAt
  }
}
