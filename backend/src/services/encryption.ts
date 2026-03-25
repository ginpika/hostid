import crypto from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 16
const AUTH_TAG_LENGTH = 16
const SALT = 'hostid-oauth-encryption-salt'

let encryptionKey: Buffer | null = null

function getEncryptionKey(): Buffer {
  if (encryptionKey) return encryptionKey

  const secret = process.env.JWT_SECRET
  if (!secret) {
    throw new Error('JWT_SECRET is not configured')
  }

  encryptionKey = crypto.scryptSync(secret, SALT, 32)
  return encryptionKey
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

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)

  let decrypted = decipher.update(encrypted, 'hex', 'utf8')
  decrypted += decipher.final('utf8')

  return decrypted
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