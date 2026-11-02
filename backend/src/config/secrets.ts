/**
 * 安全配置
 * - JWT_SECRET：必须配置且至少 32 个字符，没有任何硬编码回退值
 * - DATA_ENCRYPTION_KEY：数据加密专用密钥（与 JWT 签名密钥分离）；未配置时回退到旧的 JWT_SECRET 派生密钥并告警
 * 均在调用时读取 process.env，避免模块加载早于 dotenv.config()
 */
export const MIN_SECRET_LENGTH = 32

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`JWT_SECRET must be set and at least ${MIN_SECRET_LENGTH} characters long`)
  }
  return secret
}

export function getDataEncryptionKeySecret(): string | null {
  const key = process.env.DATA_ENCRYPTION_KEY
  if (!key) return null
  if (key.length < MIN_SECRET_LENGTH) {
    throw new Error(`DATA_ENCRYPTION_KEY must be at least ${MIN_SECRET_LENGTH} characters long`)
  }
  return key
}

/** 启动时调用：配置不合规直接退出 */
export function assertSecurityConfig(): void {
  getJwtSecret()
  if (!getDataEncryptionKeySecret()) {
    console.warn('[Security] DATA_ENCRYPTION_KEY is not set; falling back to the legacy JWT_SECRET-derived encryption key. Set DATA_ENCRYPTION_KEY to separate signing and encryption keys.')
  }
}
