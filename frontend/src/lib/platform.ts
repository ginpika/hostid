declare global {
  interface Window {
    __TAURI__?: {
      invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>
    }
  }
}

export type ConnectionMode = 'local' | 'remote'

export interface LocalConfig {
  host: string
  port: number
  autoStart: boolean
}

export interface RemoteConfig {
  url: string
  lastConnected?: string
}

export interface AppConfig {
  mode: ConnectionMode
  local: LocalConfig
  remote: RemoteConfig
}

export interface SystemInfo {
  osName: string
  osVersion: string
  totalMemory: number
  availableMemory: number
  cpuCount: number
}

export const isDesktop = (): boolean => {
  return typeof window !== 'undefined' && '__TAURI__' in window
}

export const isWeb = (): boolean => !isDesktop()

type TauriInvoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>

let tauriInvoke: TauriInvoke | null = null

const getTauriInvoke = async (): Promise<TauriInvoke | null> => {
  if (!isDesktop()) return null
  
  if (!tauriInvoke) {
    try {
      const api = await import('@tauri-apps/api/core')
      tauriInvoke = api.invoke
    } catch {
      return null
    }
  }
  return tauriInvoke
}

export const platform = {
  isDesktop: isDesktop(),
  isWeb: isWeb(),
  
  config: {
    get: async (): Promise<AppConfig> => {
      const invoke = await getTauriInvoke()
      if (invoke) {
        return invoke('get_config') as Promise<AppConfig>
      }
      
      const stored = localStorage.getItem('app_config')
      if (stored) {
        return JSON.parse(stored)
      }
      
      return {
        mode: 'local',
        local: { host: 'localhost', port: 3001, autoStart: false },
        remote: { url: '' }
      }
    },
    
    set: async (config: AppConfig): Promise<void> => {
      const invoke = await getTauriInvoke()
      if (invoke) {
        return invoke('set_config', { config }) as Promise<void>
      }
      
      localStorage.setItem('app_config', JSON.stringify(config))
    }
  },
  
  connection: {
    test: async (mode: ConnectionMode, local: LocalConfig, remote: RemoteConfig): Promise<boolean> => {
      const invoke = await getTauriInvoke()
      if (invoke) {
        return invoke('test_connection', { mode, local, remote }) as Promise<boolean>
      }
      
      const url = mode === 'local' 
        ? `http://${local.host}:${local.port}/health`
        : `${remote.url.replace(/\/$/, '')}/health`
      
      try {
        const response = await fetch(url, { 
          method: 'GET',
          signal: AbortSignal.timeout(5000)
        })
        return response.ok
      } catch {
        return false
      }
    },
    
    checkLocal: async (local: LocalConfig): Promise<boolean> => {
      const invoke = await getTauriInvoke()
      if (invoke) {
        return invoke('check_local_backend', { local }) as Promise<boolean>
      }
      
      try {
        const response = await fetch(`http://${local.host}:${local.port}/health`, {
          signal: AbortSignal.timeout(2000)
        })
        return response.ok
      } catch {
        return false
      }
    }
  },
  
  system: {
    getInfo: async (): Promise<SystemInfo | null> => {
      const invoke = await getTauriInvoke()
      if (invoke) {
        return invoke('get_system_info') as Promise<SystemInfo>
      }
      return null
    }
  }
}

export const getApiBaseUrl = (config: AppConfig): string => {
  if (config.mode === 'local') {
    return `http://${config.local.host}:${config.local.port}`
  }
  return config.remote.url.replace(/\/$/, '')
}

export const createApiClient = (getBaseUrl: () => string) => {
  return {
    getBaseUrl,
    
    async request<T>(path: string, options?: RequestInit): Promise<T> {
      const baseUrl = getBaseUrl()
      const url = `${baseUrl}${path}`
      
      const response = await fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...options?.headers,
        },
      })
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Request failed' }))
        throw new Error(error.error || `HTTP ${response.status}`)
      }
      
      return response.json()
    },
    
    get<T>(path: string, options?: RequestInit): Promise<T> {
      return this.request<T>(path, { ...options, method: 'GET' })
    },
    
    post<T>(path: string, body?: unknown, options?: RequestInit): Promise<T> {
      return this.request<T>(path, {
        ...options,
        method: 'POST',
        body: body ? JSON.stringify(body) : undefined,
      })
    },
    
    put<T>(path: string, body?: unknown, options?: RequestInit): Promise<T> {
      return this.request<T>(path, {
        ...options,
        method: 'PUT',
        body: body ? JSON.stringify(body) : undefined,
      })
    },
    
    patch<T>(path: string, body?: unknown, options?: RequestInit): Promise<T> {
      return this.request<T>(path, {
        ...options,
        method: 'PATCH',
        body: body ? JSON.stringify(body) : undefined,
      })
    },
    
    delete<T>(path: string, options?: RequestInit): Promise<T> {
      return this.request<T>(path, { ...options, method: 'DELETE' })
    }
  }
}

export type ApiClient = ReturnType<typeof createApiClient>
