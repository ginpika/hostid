/**
 * 加密服务
 * 使用 AES-256-GCM 加密 OAuth 密钥等敏感数据
 * 提供加密、解密和密钥掩码功能
 */
import crypto from 'crypto'
import { getDataEncryptionKeySecret, getLegacyEncryptionSecret } from '../config/secrets'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 16
const AUTH_TAG_LENGTH = 16
const LEGACY_SALT = 'hostid-oauth-encryption-salt'
const DATA_KEY_SALT = 'hostid-data-encryption-key-v1'

let primaryKey: Buffer | null = null
let legacyKey: Buffer | null = null

/** 旧密钥：由 JWT_SECRET 派生（兼容升级前写入的密文） */
function getLegacyKey(): Buffer {
  if (legacyKey) return legacyKey
  legacyKey = crypto.scryptSync(getLegacyEncryptionSecret(), LEGACY_SALT, 32)
  return legacyKey
}

/** 当前加密密钥：由 DATA_ENCRYPTION_KEY（环境变量或自动生成）派生 */
function getEncryptionKey(): Buffer {
  if (primaryKey) return primaryKey
  primaryKey = crypto.scryptSync(getDataEncryptionKeySecret(), DATA_KEY_SALT, 32)
  return primaryKey
}

/** 仅供测试：清除派生密钥缓存 */
export function resetEncryptionKeyCache(): void {
  primaryKey = null
  legacyKey = null
}

function decryptWithKey(key: Buffer, iv: Buffer, authTag: Buffer, encrypted: string): string {
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)

  let decrypted = decipher.update(encrypted, 'hex', 'utf8')
  decrypted += decipher.final('utf8')

  return decrypted
}

/**
 * Encrypt text using AES-256-GCM
 * Returns encrypted string with format: enc:<iv>:<authTag>:<encrypted>
 */
export function encrypt(text: string): string {
  const key = getEncryptionKey()
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)

  let encrypted = cipher.update(text, 'utf8', 'hex')
  encrypted += cipher.final('hex')

  const authTag = cipher.getAuthTag()

  return `enc:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`
}

/**
 * Decrypt text encrypted with AES-256-GCM
 * Accepts both encrypted format (enc:...) and plain text (for backward compatibility)
 */
export function decrypt(encryptedText: string): string {
  // If not encrypted, return as is (backward compatibility)
  if (!encryptedText.startsWith('enc:')) {
    return encryptedText
  }

  const key = getEncryptionKey()
  const parts = encryptedText.split(':')

  if (parts.length !== 4) {
    throw new Error('Invalid encrypted text format')
  }

  const [, ivHex, authTagHex, encrypted] = parts

  const iv = Buffer.from(ivHex, 'hex')
  const authTag = Buffer.from(authTagHex, 'hex')

  try {
    return decryptWithKey(key, iv, authTag, encrypted)
  } catch (error) {
    // 已切换到 DATA_ENCRYPTION_KEY 时，旧数据仍是用 JWT_SECRET 派生密钥加密的
    const legacy = getLegacyKey()
    if (!legacy.equals(key)) return decryptWithKey(legacy, iv, authTag, encrypted)
    throw error
  }
}

/**
 * Mask a secret for display (show first 4 and last 4 characters)
 */
export function maskSecret(secret: string): string {
  if (!secret || secret.length <= 8) {
    return '****'
  }
  return `${secret.substring(0, 4)}****${secret.substring(secret.length - 4)}`
}