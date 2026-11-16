/**
 * 应用配置上下文
 * 提供应用名称、站点品牌设置（站点名称、Slogan）、版本等配置信息
 * 初始值同步读取 window.__ENV__，挂载后从 /api/auth/site 拉取最新配置并同步 document.title
 */
import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react'
import appConfig from '../config/app.config.json'
import {
  applyDocumentTitle,
  readInitialSiteBranding,
  resolveSiteBranding,
  type RawSiteBranding,
  type SiteBranding
} from '../lib/siteBranding'

interface AppConfig {
  name: string
  displayName: {
    'zh-CN': string
    'en-US': string
  }
  description: {
    'zh-CN': string
    'en-US': string
  }
  version: string
  identifier: string
  author: string
  repository: string
}

interface ConfigContextType {
  config: AppConfig
  siteName: string
  siteSlogan: string
  setSiteBranding: (raw: RawSiteBranding) => void
  refreshSiteBranding: () => Promise<void>
  getDisplayName: (language: 'zh-CN' | 'en-US') => string
  getDescription: (language: 'zh-CN' | 'en-US') => string
}

const ConfigContext = createContext<ConfigContextType | null>(null)

export function ConfigProvider({ children }: { children: ReactNode }) {
  const versionRef = useRef(0)
  const [branding, setBranding] = useState<SiteBranding>(() => {
    const initial = readInitialSiteBranding(typeof window !== 'undefined' ? window.__ENV__ : undefined)
    applyDocumentTitle(initial.siteName)
    return initial
  })

  const setSiteBranding = useCallback((raw: RawSiteBranding) => {
    versionRef.current += 1
    const next = resolveSiteBranding(raw)
    setBranding(next)
    applyDocumentTitle(next.siteName)
  }, [])

  const refreshSiteBranding = useCallback(async () => {
    const requestVersion = versionRef.current
    try {
      const res = await fetch('/api/auth/site', { cache: 'no-store' })
      if (!res.ok || versionRef.current !== requestVersion) return
      const data = await res.json()
      if (versionRef.current !== requestVersion) return
      setSiteBranding(data)
    } catch {
      // Retain default/runtime branding when backend is unreachable.
    }
  }, [setSiteBranding])

  useEffect(() => {
    void refreshSiteBranding()
  }, [refreshSiteBranding])

  useEffect(() => {
    applyDocumentTitle(branding.siteName)
  }, [branding.siteName])

  const getDisplayName = useCallback((language: 'zh-CN' | 'en-US'): string => {
    return branding.siteName || appConfig.displayName[language] || appConfig.name
  }, [branding.siteName])

  const getDescription = useCallback((language: 'zh-CN' | 'en-US'): string => {
    return appConfig.description[language] || ''
  }, [])

  return (
    <ConfigContext.Provider
      value={{
        config: appConfig as AppConfig,
        siteName: branding.siteName,
        siteSlogan: branding.siteSlogan,
        setSiteBranding,
        refreshSiteBranding,
        getDisplayName,
        getDescription
      }}
    >
      {children}
    </ConfigContext.Provider>
  )
}

export function useConfig() {
  const context = useContext(ConfigContext)
  if (!context) {
    throw new Error('useConfig must be used within a ConfigProvider')
  }
  return context
}

export { appConfig }
