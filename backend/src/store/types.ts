/**
 * 键值存储类型定义
 * KeyValueStore 是业务代码依赖的最小接口；MemoryStore 是当前的进程内实现，
 * 将来需要多实例部署时可替换为 Redis 等实现而不影响调用方。
 */
export interface KeyValueStore {
  get(key: string): Promise<string | null>
  /** ttl 单位毫秒；缺省使用存储的默认过期时间 */
  set(key: string, value: string, ttl?: number): Promise<void>
  delete(key: string): Promise<boolean>
}

export interface KVStoreOptions {
  defaultTTL?: number
  cleanupInterval?: number
}

export interface StoreEntry {
  value: string
  expiresAt: number
}
