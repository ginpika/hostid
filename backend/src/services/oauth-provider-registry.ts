/**
 * 外部 OAuth Provider 注册表
 * 读取（带 5 分钟缓存并解密 clientSecret）与缓存失效。
 * 过去缓存放在 routes/oauthClient.ts，routes/oauthConfig.ts 为了清缓存反向 import 另一个路由。
 */
import { prisma } from '../lib/prisma'
import { decrypt } from './encryption'

export interface ProviderConfig {
  clientId: string
  clientSecret: string
  callbackUrl: string
  authorizationUrl: string
  tokenUrl: string
  userinfoUrl: string
}

const CACHE_TTL_MS = 5 * 60 * 1000
const providerCache = new Map<string, { config: ProviderConfig; expiresAt: number }>()

/** 返回已启用 Provider 的运行时配置；不存在或未启用返回 null */
export async function getActiveProviderConfig(provider: string): Promise<ProviderConfig | null> {
  const cached = providerCache.get(provider)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.config
  }

  const row = await prisma.oAuthProvider.findUnique({
    where: { provider, isActive: true }
  })
  if (!row) return null

  const config: ProviderConfig = {
    clientId: row.clientId,
    clientSecret: decrypt(row.clientSecret),
    callbackUrl: row.callbackUrl,
    authorizationUrl: row.authorizationUrl,
    tokenUrl: row.tokenUrl,
    userinfoUrl: row.userinfoUrl
  }
  providerCache.set(provider, { config, expiresAt: Date.now() + CACHE_TTL_MS })
  return config
}

export function invalidateProviderConfig(provider?: string): void {
  if (provider) {
    providerCache.delete(provider)
  } else {
    providerCache.clear()
  }
}
