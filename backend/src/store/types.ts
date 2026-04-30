/**
 * 内存存储类型定义
 * 定义存储选项、条目结构和集群配置
 */
export interface KVStoreOptions {
  defaultTTL?: number
  cleanupInterval?: number
}

export interface StoreEntry {
  value: string
  expiresAt: number | null
}

export interface ClusterNode {
  id: string
  address: string
  weight: number
}

export interface ReplicationConfig {
  enabled: boolean
  nodes: ClusterNode[]
  consistency: 'eventual' | 'strong'
}
