/**
 * 系统设置服务
 * - 设置存储在 system_settings 表，敏感值（isSecret）使用 AES-256-GCM 加密
 * - 优先级：数据库值 > 环境变量（旧版部署） > 默认值
 * - 启动时若数据库缺少某项而旧环境变量存在，会把环境变量导入一次作为初始值（之后以数据库为准）
 * - 读取走内存缓存（同步），更新后立即刷新缓存，绝大多数设置无需重启即可生效
 *   例外：mailDomain 用于入站 SMTP 欢迎横幅（banner），横幅部分需重启后更新
 */
import { prisma } from '../lib/prisma'
import { encrypt, decrypt, maskSecret } from './encryption'

type SettingType = 'string' | 'number' | 'boolean' | 'enum'

interface SettingDef {
  type: SettingType
  env?: string
  default: string | number | boolean
  secret?: boolean
  options?: readonly string[]
  min?: number
  max?: number
  /** 环境变量值转换（如 SESSION_TTL 单位） */
  group: 'site' | 'mail' | 'smtp' | 'turnstile' | 'sso' | 'fusedMail'
}

export const SETTING_DEFS = {
  siteUrl: { type: 'string', env: 'FRONTEND_URL', default: '', group: 'site' },
  corsAllowedOrigins: { type: 'string', env: 'CORS_ALLOWED_ORIGINS', default: '', group: 'site' },
  ssoLoginPageUrl: { type: 'string', env: 'SSO_LOGIN_PAGE_URL', default: '', group: 'site' },
  mailDomain: { type: 'string', env: 'MAIL_DOMAIN', default: 'localhost', group: 'mail' },
  smtpRelayHost: { type: 'string', env: 'SMTP_HOST', default: '', group: 'smtp' },
  smtpRelayPort: { type: 'number', env: 'SMTP_OUT_PORT', default: 25, min: 1, max: 65535, group: 'smtp' },
  smtpRelayUser: { type: 'string', env: 'SMTP_USER', default: '', group: 'smtp' },
  smtpRelayPass: { type: 'string', env: 'SMTP_PASS', default: '', secret: true, group: 'smtp' },
  turnstileSiteKey: { type: 'string', env: 'CF_TURNSTILE_SITE_KEY', default: '', group: 'turnstile' },
  turnstileSecretKey: { type: 'string', env: 'CF_TURNSTILE_SECRET_KEY', default: '', secret: true, group: 'turnstile' },
  ssoCookieDomain: { type: 'string', env: 'SSO_COOKIE_DOMAIN', default: '', group: 'sso' },
  ssoCookieName: { type: 'string', env: 'SSO_COOKIE_NAME', default: 'sso_token', group: 'sso' },
  ssoCookiePath: { type: 'string', env: 'SSO_COOKIE_PATH', default: '/', group: 'sso' },
  ssoCookieSecure: { type: 'boolean', env: 'SSO_COOKIE_SECURE', default: false, group: 'sso' },
  ssoCookieSameSite: { type: 'enum', env: 'SSO_COOKIE_SAMESITE', default: 'lax', options: ['strict', 'lax', 'none'], group: 'sso' },
  /** 会话有效期（秒） */
  sessionTtl: { type: 'number', env: 'SESSION_TTL', default: 604800, min: 300, max: 31536000, group: 'sso' },
  ssoRateMax: { type: 'number', env: 'SSO_RATE_MAX', default: 180, min: 1, max: 100000, group: 'sso' },
  ssoRateWindowMs: { type: 'number', env: 'SSO_RATE_WINDOW_MS', default: 60000, min: 1000, max: 86400000, group: 'sso' },
  fusedMailCallbackUrl: { type: 'string', env: 'FUSED_MAIL_CALLBACK_URL', default: '', group: 'fusedMail' },
  fusedMailInitialSyncLimit: { type: 'number', env: 'FUSED_MAIL_INITIAL_SYNC_LIMIT', default: 200, min: 1, max: 5000, group: 'fusedMail' }
} as const satisfies Record<string, SettingDef>

export type SettingKey = keyof typeof SETTING_DEFS
type ValueOf<K extends SettingKey> =
  (typeof SETTING_DEFS)[K]['type'] extends 'number' ? number
    : (typeof SETTING_DEFS)[K]['type'] extends 'boolean' ? boolean
      : string
export type Settings = { [K in SettingKey]: ValueOf<K> }

const KEYS = Object.keys(SETTING_DEFS) as SettingKey[]

function def(key: SettingKey): SettingDef {
  return SETTING_DEFS[key] as SettingDef
}

/** 把字符串解析为设置值；非法时抛错 */
function parseValue(key: SettingKey, raw: unknown): string | number | boolean {
  const d = def(key)
  switch (d.type) {
    case 'number': {
      const n = typeof raw === 'number' ? raw : parseInt(String(raw).trim(), 10)
      if (!Number.isFinite(n)) throw new Error(`${key} must be a number`)
      if ((d.min !== undefined && n < d.min) || (d.max !== undefined && n > d.max)) {
        throw new Error(`${key} must be between ${d.min} and ${d.max}`)
      }
      return Math.trunc(n)
    }
    case 'boolean':
      if (typeof raw === 'boolean') return raw
      return ['true', '1', 'yes', 'on'].includes(String(raw).trim().toLowerCase())
    case 'enum': {
      const v = String(raw).trim().toLowerCase()
      if (!d.options!.includes(v)) throw new Error(`${key} must be one of ${d.options!.join(', ')}`)
      return v
    }
    default:
      return String(raw ?? '').trim()
  }
}

function validateString(key: SettingKey, value: string): void {
  if (!value) return
  const urlKeys: SettingKey[] = ['siteUrl', 'ssoLoginPageUrl', 'fusedMailCallbackUrl']
  if (urlKeys.includes(key)) {
    let url: URL
    try { url = new URL(value) } catch { throw new Error(`${key} must be an absolute http(s) URL`) }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`${key} must be an absolute http(s) URL`)
  }
  if (key === 'corsAllowedOrigins') {
    for (const origin of value.split(',').map(o => o.trim()).filter(Boolean)) {
      try { new URL(origin) } catch { throw new Error(`corsAllowedOrigins contains an invalid origin: ${origin}`) }
    }
  }
  if (key === 'mailDomain' && !/^[a-z0-9.-]+$/i.test(value)) throw new Error('mailDomain is invalid')
  if (key === 'turnstileSiteKey' && !/^[a-zA-Z0-9_-]*$/.test(value)) throw new Error('turnstileSiteKey is invalid')
  if (key === 'ssoCookieName' && !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('ssoCookieName is invalid')
}

/** 数据库中的原始值（已解密） */
let dbValues = new Map<string, string>()
let snapshot: Settings | null = null

function envValue(key: SettingKey): string | undefined {
  const name = def(key).env
  const value = name ? process.env[name] : undefined
  return value === undefined || value === '' ? undefined : value
}

function build(): Settings {
  const result = {} as Record<SettingKey, string | number | boolean>
  for (const key of KEYS) {
    const raw = dbValues.has(key) ? dbValues.get(key) : envValue(key)
    let value: string | number | boolean = def(key).default
    if (raw !== undefined) {
      try { value = parseValue(key, raw) } catch { value = def(key).default }
    }
    result[key] = value
  }
  return result as Settings
}

/** 同步读取当前设置（内存缓存；未加载数据库前回退到环境变量/默认值） */
export function getSettings(): Settings {
  if (!snapshot) snapshot = build()
  return snapshot
}

/** 规范化后的站点地址（无结尾斜杠，可能为空字符串） */
export function getSiteUrl(): string {
  return getSettings().siteUrl.replace(/\/$/, '')
}

/** SSO 登录页：未配置时为 站点地址 + /login（站点地址为空则为相对路径 /login） */
export function getSsoLoginPageUrl(): string {
  return getSettings().ssoLoginPageUrl || `${getSiteUrl()}/login`
}

export function getSessionTtlMs(): number {
  return getSettings().sessionTtl * 1000
}

export function getSsoCookieOptions(): { httpOnly: true; secure: boolean; sameSite: 'strict' | 'lax' | 'none'; path: string; domain?: string } {
  const s = getSettings()
  return {
    httpOnly: true,
    secure: s.ssoCookieSecure,
    sameSite: s.ssoCookieSameSite as 'strict' | 'lax' | 'none',
    path: s.ssoCookiePath,
    ...(s.ssoCookieDomain ? { domain: s.ssoCookieDomain } : {})
  }
}

async function reload(): Promise<void> {
  const rows = await prisma.systemSetting.findMany()
  const next = new Map<string, string>()
  for (const row of rows) {
    if (!(row.key in SETTING_DEFS)) continue
    try {
      next.set(row.key, row.isSecret ? decrypt(row.value) : row.value)
    } catch (error) {
      console.error(`[Settings] Failed to decrypt setting ${row.key}:`, error instanceof Error ? error.message : error)
    }
  }
  dbValues = next
  snapshot = build()
}

function serialize(key: SettingKey, value: string | number | boolean): { value: string; isSecret: boolean } {
  const text = String(value)
  const secret = !!def(key).secret
  return { value: secret && text ? encrypt(text) : text, isSecret: secret && !!text }
}

/** 启动时调用：把旧环境变量导入一次，然后加载缓存 */
export async function initSettings(): Promise<void> {
  const existing = new Set((await prisma.systemSetting.findMany({ select: { key: true } })).map(r => r.key))
  const imported: string[] = []
  for (const key of KEYS) {
    if (existing.has(key)) continue
    const raw = envValue(key)
    if (raw === undefined) continue
    let value: string | number | boolean
    try { value = parseValue(key, raw) } catch { continue }
    if (def(key).type === 'string') {
      try { validateString(key, value as string) } catch (error) {
        console.warn(`[Settings] Ignoring legacy env ${def(key).env}: ${error instanceof Error ? error.message : error}`)
        continue
      }
    }
    await prisma.systemSetting.upsert({ where: { key }, create: { key, ...serialize(key, value) }, update: {} })
    imported.push(def(key).env!)
  }
  if (imported.length) {
    console.log(`[Settings] Imported legacy environment variables into system settings: ${imported.join(', ')}. They can now be removed; edit values in the admin Settings page.`)
  }
  await reload()
}

export type SettingsUpdate = Partial<Record<SettingKey, unknown>>

/**
 * 更新设置。敏感值：undefined / 空字符串表示保持不变；传 null 表示清空
 * 返回更新后的设置视图（敏感值已打码）
 */
export async function updateSettings(input: SettingsUpdate): Promise<void> {
  const writes: { key: SettingKey; value: string | number | boolean }[] = []
  for (const [rawKey, rawValue] of Object.entries(input)) {
    if (!(rawKey in SETTING_DEFS)) throw new Error(`Unknown setting: ${rawKey}`)
    const key = rawKey as SettingKey
    if (def(key).secret) {
      if (rawValue === undefined || rawValue === '') continue
      if (rawValue === null) { writes.push({ key, value: '' }); continue }
    }
    if (rawValue === undefined) continue
    const value = parseValue(key, rawValue === null ? def(key).default : rawValue)
    if (typeof value === 'string') validateString(key, value)
    writes.push({ key, value })
  }
  await prisma.$transaction(writes.map(({ key, value }) => {
    const data = serialize(key, value)
    return prisma.systemSetting.upsert({ where: { key }, create: { key, ...data }, update: data })
  }))
  await reload()
}

export interface SettingView {
  key: SettingKey
  group: SettingDef['group']
  type: SettingType
  secret: boolean
  options?: readonly string[]
  /** 敏感值打码；非敏感值原样 */
  value: string | number | boolean
  /** 敏感值是否已配置 */
  configured?: boolean
  source: 'database' | 'env' | 'default'
  default: string | number | boolean
}

export function getSettingsView(): SettingView[] {
  const current = getSettings()
  return KEYS.map(key => {
    const d = def(key)
    const value = current[key]
    const source = dbValues.has(key) ? 'database' : envValue(key) !== undefined ? 'env' : 'default'
    const base = { key, group: d.group, type: d.type, secret: !!d.secret, options: d.options, source, default: d.default } as const
    if (d.secret) {
      const text = String(value || '')
      return { ...base, value: text ? maskSecret(text) : '', configured: !!text }
    }
    return { ...base, value }
  })
}

/** 仅供测试 */
export function resetSettingsCache(): void {
  dbValues = new Map()
  snapshot = null
}
