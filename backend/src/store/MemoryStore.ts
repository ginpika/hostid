/**
 * 内存存储类
 * 实现键值存储，支持 TTL 过期和自动清理
 * 用于 OAuth 状态、会话和临时数据存储
 */
import type { KeyValueStore, KVStoreOptions, StoreEntry } from './types'

export class MemoryStore implements KeyValueStore {
  private store: Map<string, StoreEntry> = new Map()
  private defaultTTL: number
  private cleanupInterval: NodeJS.Timeout | null = null

  constructor(options: KVStoreOptions = {}) {
    this.defaultTTL = options.defaultTTL || 3600 * 1000
    this.cleanupInterval = setInterval(() => this.cleanup(), options.cleanupInterval || 60000)
  }

  private cleanup(): void {
    const now = Date.now()
    for (const [key, entry] of this.store.entries()) {
      if (entry.expiresAt < now) {
        this.store.delete(key)
      }
    }
  }

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key)
    if (!entry) return null

    if (entry.expiresAt < Date.now()) {
      this.store.delete(key)
      return null
    }

    return entry.value
  }

  async set(key: string, value: string, ttl?: number): Promise<void> {
    this.store.set(key, { value, expiresAt: Date.now() + (ttl || this.defaultTTL) })
  }

  async delete(key: string): Promise<boolean> {
    return this.store.delete(key)
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }
    this.store.clear()
  }
}

export const memoryStore = new MemoryStore()
