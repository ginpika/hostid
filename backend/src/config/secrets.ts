/**
 * 密钥管理（零配置）
 * - JWT_SECRET / DATA_ENCRYPTION_KEY 环境变量优先（必须至少 32 字符）
 * - 未设置时，首次启动自动生成 48 字节随机值，写入数据目录的 secrets.json（权限 0600），之后启动直接读取
 * - 若已有部署通过环境变量提供了 JWT_SECRET，会一并记录到 secrets.json，
 *   这样以后去掉环境变量也不会让会话或旧密文失效
 * 数据目录：HOSTID_DATA_DIR，否则为 DATABASE_URL 指向的 SQLite 文件所在目录，否则 ./data
 */
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

export const MIN_SECRET_LENGTH = 32
const SECRETS_FILENAME = 'secrets.json'

interface SecretsFile {
  jwtSecret?: string
  /** 升级前使用的过短 JWT_SECRET，仅用于解密旧密文 */
  legacyJwtSecret?: string
  dataEncryptionKey?: string
  createdAt?: string
}

interface ResolvedSecrets {
  jwtSecret: string
  dataEncryptionKey: string
  /** 旧版密钥来源：用于派生兼容旧密文的解密密钥 */
  legacyJwtSecret: string
}

let cached: ResolvedSecrets | null = null

export function resolveDataDir(): string {
  if (process.env.HOSTID_DATA_DIR) return path.resolve(process.env.HOSTID_DATA_DIR)
  const url = process.env.DATABASE_URL
  if (url && url.startsWith('file:')) {
    const filePath = url.slice('file:'.length).split('?')[0]
    // Prisma 将相对路径解析为相对于 schema 所在的 prisma/ 目录
    const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), 'prisma', filePath)
    return path.dirname(absolute)
  }
  return path.resolve(process.cwd(), 'data')
}

export function getSecretsFilePath(): string {
  return path.join(resolveDataDir(), SECRETS_FILENAME)
}

function generateSecret(): string {
  return crypto.randomBytes(48).toString('base64')
}

function readEnvSecret(name: string): string | null {
  const value = process.env[name]
  if (!value) return null
  if (value.length < MIN_SECRET_LENGTH) {
    throw new Error(`${name} must be at least ${MIN_SECRET_LENGTH} characters long (or unset it to use an auto-generated value)`)
  }
  return value
}

function readSecretsFile(file: string): SecretsFile {
  if (!fs.existsSync(file)) return {}
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as SecretsFile
  } catch (error) {
    throw new Error(`Failed to parse ${file}: ${error instanceof Error ? error.message : error}. Refusing to overwrite it.`)
  }
}

function writeSecretsFile(file: string, data: SecretsFile): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 })
  fs.renameSync(tmp, file)
  try { fs.chmodSync(file, 0o600) } catch { /* ignore on platforms without chmod */ }
}

export function loadSecrets(): ResolvedSecrets {
  if (cached) return cached
  // 兼容升级：旧部署的 JWT_SECRET 可能不足 32 位。不再拒绝启动，
  // 只把它当作旧密文的解密密钥，签发 token 改用自动生成的强密钥。
  const rawEnvJwt = process.env.JWT_SECRET || null
  const weakEnvJwt = rawEnvJwt && rawEnvJwt.length < MIN_SECRET_LENGTH ? rawEnvJwt : null
  if (weakEnvJwt) {
    console.warn(`[Security] JWT_SECRET is shorter than ${MIN_SECRET_LENGTH} characters; it is now used only to decrypt legacy data. A strong signing secret is used instead (existing sessions must log in again). You can remove JWT_SECRET from the environment.`)
  }
  const envJwt = weakEnvJwt ? null : readEnvSecret('JWT_SECRET')
  const envDataKey = readEnvSecret('DATA_ENCRYPTION_KEY')
  const file = getSecretsFilePath()
  const stored = readSecretsFile(file)
  const next: SecretsFile = { ...stored }
  let changed = false

  if (weakEnvJwt && !next.legacyJwtSecret) {
    next.legacyJwtSecret = weakEnvJwt
    changed = true
  }
  if (!next.jwtSecret) {
    next.jwtSecret = envJwt || generateSecret()
    changed = true
  }
  if (!next.dataEncryptionKey) {
    next.dataEncryptionKey = envDataKey || generateSecret()
    changed = true
  }
  if (changed) {
    next.createdAt = next.createdAt || new Date().toISOString()
    writeSecretsFile(file, next)
    console.log(`[Security] Secrets persisted to ${file} (back up this file together with the database)`)
  }

  cached = {
    jwtSecret: envJwt || next.jwtSecret!,
    dataEncryptionKey: envDataKey || next.dataEncryptionKey!,
    legacyJwtSecret: next.legacyJwtSecret || envJwt || next.jwtSecret!
  }
  return cached
}

export function getJwtSecret(): string {
  return loadSecrets().jwtSecret
}

export function getDataEncryptionKeySecret(): string {
  return loadSecrets().dataEncryptionKey
}

/** 旧版加密密钥来源（JWT_SECRET），用于解密升级前写入的密文 */
export function getLegacyEncryptionSecret(): string {
  return loadSecrets().legacyJwtSecret
}

/** 仅供测试：清除缓存 */
export function resetSecretsCache(): void {
  cached = null
}

/** 启动时调用：加载/生成密钥，配置不合规直接抛错 */
export function assertSecurityConfig(): void {
  loadSecrets()
}
