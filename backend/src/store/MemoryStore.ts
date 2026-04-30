/**
 * 内存存储类
 * 实现键值存储，支持 TTL 过期和自动清理
 * 用于 OAuth 状态、会话和临时数据存储
 */
import { KVStoreOptions, StoreEntry, ClusterNode, ReplicationConfig } from './types'

export class MemoryStore {
  private store: Map<string, StoreEntry> = new Map()
  private defaultTTL: number
  private cleanupInterval: NodeJS.Timeout | null = null
  
  private replicationConfig: ReplicationConfig = {
    enabled: false,
    nodes: [],
    consistency: 'eventual'
  }

  constructor(options: KVStoreOptions = {}) {
    this.defaultTTL = options.defaultTTL || 3600 * 1000
    this.startCleanup(options.cleanupInterval || 60000)
  }

  private startCleanup(interval: number): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanup()
    }, interval)
  }

  private cleanup(): void {
    const now = Date.now()
    for (const [key, entry] of this.store.entries()) {
      if (entry.expiresAt && entry.expiresAt < now) {
        this.store.delete(key)
      }
    }
  }

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key)
    if (!entry) return null
    
    if (entry.expiresAt && entry.expiresAt < Date.now()) {
      this.store.delete(key)
      return null
    }
    
    return entry.value
  }

  async set(key: string, value: string, ttl?: number): Promise<void> {
    const expiresAt = ttl ? Date.now() + ttl : Date.now() + this.defaultTTL
    this.store.set(key, { value, expiresAt })
  }

  async setWithoutExpiry(key: string, value: string): Promise<void> {
    this.store.set(key, { value, expiresAt: null })
  }

  async delete(key: string): Promise<boolean> {
    return this.store.delete(key)
  }

  async exists(key: string): Promise<boolean> {
    const entry = this.store.get(key)
    if (!entry) return false
    
    if (entry.expiresAt && entry.expiresAt < Date.now()) {
      this.store.delete(key)
      return false
    }
    
    return true
  }

  async mget(keys: string[]): Promise<(string | null)[]> {
    return Promise.all(keys.map(key => this.get(key)))
  }

  async mset(entries: { key: string; value: string; ttl?: number }[]): Promise<void> {
    for (const entry of entries) {
      await this.set(entry.key, entry.value, entry.ttl)
    }
  }

  async keys(pattern: string): Promise<string[]> {
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$')
    const result: string[] = []
    const now = Date.now()
    
    for (const [key, entry] of this.store.entries()) {
      if (entry.expiresAt && entry.expiresAt < now) {
        this.store.delete(key)
        continue
      }
      if (regex.test(key)) {
        result.push(key)
      }
    }
    
    return result
  }

  async ttl(key: string): Promise<number> {
    const entry = this.store.get(key)
    if (!entry) return -2
    if (!entry.expiresAt) return -1
    return Math.max(0, Math.floor((entry.expiresAt - Date.now()) / 1000))
  }

  async expire(key: string, ttl: number): Promise<boolean> {
    const entry = this.store.get(key)
    if (!entry) return false
    entry.expiresAt = Date.now() + ttl * 1000
    return true
  }

  async incr(key: string): Promise<number> {
    const entry = this.store.get(key)
    const currentValue = entry ? parseInt(entry.value, 10) || 0 : 0
    const newValue = currentValue + 1
    await this.set(key, String(newValue))
    return newValue
  }

  async decr(key: string): Promise<number> {
    const entry = this.store.get(key)
    const currentValue = entry ? parseInt(entry.value, 10) || 0 : 0
    const newValue = currentValue - 1
    await this.set(key, String(newValue))
    return newValue
  }

  async flush(): Promise<void> {
    this.store.clear()
  }

  async size(): Promise<number> {
    return this.store.size
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }
    this.store.clear()
  }

  configureReplication(config: ReplicationConfig): void {
    this.replicationConfig = config
  }

  getReplicationConfig(): ReplicationConfig {
    return { ...this.replicationConfig }
  }

  async replicateToNode(key: string, value: string, node: ClusterNode): Promise<void> {
    if (!this.replicationConfig.enabled) {
      throw new Error('Replication is not enabled')
    }
    
    // Reserved for future implementation
    // Will use HTTP/gRPC to replicate data to other nodes
    console.log(`[Replication] Would replicate ${key} to ${node.address}`)
  }
}

export const memoryStore = new MemoryStore()
