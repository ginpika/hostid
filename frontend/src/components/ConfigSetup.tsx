import { useState, useEffect } from 'react'
import { Server, Globe, Check, X, Loader2, Settings, ChevronRight } from 'lucide-react'
import { 
  platform, 
  AppConfig, 
  LocalConfig, 
  RemoteConfig, 
  ConnectionMode 
} from '../lib/platform'
import { useI18n } from '../i18n/I18nContext'

interface ConfigSetupProps {
  onComplete: (config: AppConfig) => void
  initialConfig?: AppConfig
  isModal?: boolean
}

export default function ConfigSetup({ onComplete, initialConfig, isModal = false }: ConfigSetupProps) {
  const { t } = useI18n()
  const [config, setConfig] = useState<AppConfig>(initialConfig || {
    mode: 'local' as ConnectionMode,
    local: { host: 'localhost', port: 3001, autoStart: false },
    remote: { url: '' }
  })
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<'success' | 'failed' | null>(null)
  const [localStatus, setLocalStatus] = useState<'checking' | 'online' | 'offline' | null>(null)

  useEffect(() => {
    if (config.mode === 'local') {
      checkLocalBackend()
    }
  }, [config.local.host, config.local.port])

  const checkLocalBackend = async () => {
    setLocalStatus('checking')
    const isOnline = await platform.connection.checkLocal(config.local)
    setLocalStatus(isOnline ? 'online' : 'offline')
  }

  const handleTestConnection = async () => {
    setTesting(true)
    setTestResult(null)
    
    const success = await platform.connection.test(
      config.mode,
      config.local,
      config.remote
    )
    
    setTestResult(success ? 'success' : 'failed')
    setTesting(false)
  }

  const handleSave = async () => {
    await platform.config.set(config)
    onComplete(config)
  }

  const updateLocalConfig = (updates: Partial<LocalConfig>) => {
    setConfig(prev => ({
      ...prev,
      local: { ...prev.local, ...updates }
    }))
    setTestResult(null)
  }

  const updateRemoteConfig = (updates: Partial<RemoteConfig>) => {
    setConfig(prev => ({
      ...prev,
      remote: { ...prev.remote, ...updates }
    }))
    setTestResult(null)
  }

  const getStatusIcon = () => {
    if (config.mode === 'local') {
      if (localStatus === 'checking') {
        return <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
      }
      if (localStatus === 'online') {
        return <Check className="w-4 h-4 text-green-500" />
      }
      if (localStatus === 'offline') {
        return <X className="w-4 h-4 text-red-500" />
      }
      return null
    }
    
    if (testResult === 'success') {
      return <Check className="w-4 h-4 text-green-500" />
    }
    if (testResult === 'failed') {
      return <X className="w-4 h-4 text-red-500" />
    }
    return null
  }

  const getStatusText = () => {
    if (config.mode === 'local') {
      if (localStatus === 'checking') return t('checking')
      if (localStatus === 'online') return t('localBackendOnline')
      if (localStatus === 'offline') return t('localBackendOffline')
      return ''
    }
    
    if (testResult === 'success') return t('connectionSuccess')
    if (testResult === 'failed') return t('connectionFailed')
    return ''
  }

  const content = (
    <>
      <div className="text-center mb-6">
        <div className="inline-flex items-center justify-center w-12 h-12 bg-primary-100 rounded-full mb-3">
          <Settings className="w-6 h-6 text-primary-600" />
        </div>
        <h2 className="text-xl font-bold text-gray-900">{t('connectionConfig')}</h2>
        <p className="text-gray-500 text-sm mt-1">{t('connectionConfigDesc')}</p>
      </div>

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => setConfig(prev => ({ ...prev, mode: 'local' }))}
            className={`p-4 rounded-lg border-2 text-left transition-all ${
              config.mode === 'local'
                ? 'border-primary-500 bg-primary-50'
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <div className="flex items-center gap-3 mb-2">
              <Server className={`w-5 h-5 ${config.mode === 'local' ? 'text-primary-600' : 'text-gray-400'}`} />
              <span className="font-medium text-gray-900">{t('localMode')}</span>
            </div>
            <p className="text-xs text-gray-500">{t('localModeDesc')}</p>
          </button>

          <button
            onClick={() => setConfig(prev => ({ ...prev, mode: 'remote' }))}
            className={`p-4 rounded-lg border-2 text-left transition-all ${
              config.mode === 'remote'
                ? 'border-primary-500 bg-primary-50'
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <div className="flex items-center gap-3 mb-2">
              <Globe className={`w-5 h-5 ${config.mode === 'remote' ? 'text-primary-600' : 'text-gray-400'}`} />
              <span className="font-medium text-gray-900">{t('remoteMode')}</span>
            </div>
            <p className="text-xs text-gray-500">{t('remoteModeDesc')}</p>
          </button>
        </div>

        {config.mode === 'local' && (
          <div className="space-y-3 p-4 bg-gray-50 rounded-lg">
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('host')}</label>
                <input
                  type="text"
                  value={config.local.host}
                  onChange={e => updateLocalConfig({ host: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  placeholder="localhost"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('port')}</label>
                <input
                  type="number"
                  value={config.local.port}
                  onChange={e => updateLocalConfig({ port: parseInt(e.target.value) || 3001 })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  placeholder="3001"
                />
              </div>
            </div>
            
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {getStatusIcon()}
                <span className="text-sm text-gray-600">{getStatusText()}</span>
              </div>
              <button
                onClick={checkLocalBackend}
                className="text-sm text-primary-600 hover:text-primary-700"
              >
                {t('refresh')}
              </button>
            </div>
          </div>
        )}

        {config.mode === 'remote' && (
          <div className="space-y-3 p-4 bg-gray-50 rounded-lg">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('serverUrl')}</label>
              <input
                type="url"
                value={config.remote.url}
                onChange={e => updateRemoteConfig({ url: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                placeholder="https://mail.example.com"
              />
            </div>
            
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {getStatusIcon()}
                <span className="text-sm text-gray-600">{getStatusText()}</span>
              </div>
              <button
                onClick={handleTestConnection}
                disabled={testing || !config.remote.url}
                className="flex items-center gap-1 text-sm text-primary-600 hover:text-primary-700 disabled:opacity-50"
              >
                {testing && <Loader2 className="w-3 h-3 animate-spin" />}
                {t('testConnection')}
              </button>
            </div>
          </div>
        )}

        <button
          onClick={handleSave}
          disabled={config.mode === 'local' && localStatus === 'offline'}
          className="w-full btn-primary flex items-center justify-center gap-2"
        >
          {t('saveConfig')}
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </>
  )

  if (isModal) {
    return (
      <div className="bg-white rounded-xl p-6 max-w-lg w-full">
        {content}
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-primary-50 to-primary-100">
      <div className="w-full max-w-lg">
        <div className="bg-white rounded-xl p-6 shadow-lg">
          {content}
        </div>
      </div>
    </div>
  )
}
