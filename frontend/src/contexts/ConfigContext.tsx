import { createContext, useContext, ReactNode } from 'react'
import appConfig from '../config/app.config.json'

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
  getDisplayName: (language: 'zh-CN' | 'en-US') => string
  getDescription: (language: 'zh-CN' | 'en-US') => string
}

const ConfigContext = createContext<ConfigContextType | null>(null)

export function ConfigProvider({ children }: { children: ReactNode }) {
  const getDisplayName = (language: 'zh-CN' | 'en-US'): string => {
    return appConfig.displayName[language] || appConfig.name
  }

  const getDescription = (language: 'zh-CN' | 'en-US'): string => {
    return appConfig.description[language] || ''
  }

  return (
    <ConfigContext.Provider value={{ config: appConfig as AppConfig, getDisplayName, getDescription }}>
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
