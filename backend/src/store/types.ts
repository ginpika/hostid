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
