/**
 * OAuth 服务商配置页面
 * 管理 OAuth 登录服务商配置
 * 支持添加、编辑、删除和启用/禁用服务商
 */
import { useState, useEffect } from 'react'
import { Key, Plus, Trash2, Edit, Power, PowerOff, X, Check } from 'lucide-react'
import Layout from '../components/Layout'
import { useI18n } from '../i18n/I18nContext'

interface OAuthProvider {
  id: string
  provider: string
  displayName: string
  clientId: string
  clientSecret: string
  callbackUrl: string
  isActive: boolean
  createdAt: string
  updatedAt: string
}

interface ProviderFormData {
  provider: string
  displayName: string
  clientId: string
  clientSecret: string
  callbackUrl: string
}

export default function OAuthConfigPage() {
  const { t, language } = useI18n()
  const [providers, setProviders] = useState<OAuthProvider[]>([])
  const [activeCount, setActiveCount] = useState(0)
  const [maxActiveProviders, setMaxActiveProviders] = useState(3)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const [showModal, setShowModal] = useState(false)
  const [editingProvider, setEditingProvider] = useState<OAuthProvider | null>(null)
  const [formData, setFormData] = useState<ProviderFormData>({
    provider: '',
    displayName: '',
    clientId: '',
    clientSecret: '',
    callbackUrl: ''
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetchProviders()
  }, [])

  const fetchProviders = async () => {
    setLoading(true)
    try {
      const token = localStorage.getItem('token')
      const res = await fetch('/api/admin/oauth/providers', {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (res.ok) {
        const data = await res.json()
        setProviders(data.providers)
        setActiveCount(data.activeCount)
        setMaxActiveProviders(data.maxActiveProviders)
      } else if (res.status === 403) {
        setError(t('adminAccessDenied'))
      }
    } catch (err) {
      console.error('Failed to fetch providers:', err)
      setError(language === 'zh-CN' ? '获取配置失败' : 'Failed to fetch providers')
    } finally {
      setLoading(false)
    }
  }

  const openAddModal = () => {
    setEditingProvider(null)
    setFormData({
      provider: '',
      displayName: '',
      clientId: '',
      clientSecret: '',
      callbackUrl: '',
      authorizationUrl: '',
      tokenUrl: '',
      userinfoUrl: ''
    })
    setShowModal(true)
  }

  const openEditModal = (provider: OAuthProvider) => {
    setEditingProvider(provider)
    setFormData({
      provider: provider.provider,
      displayName: provider.displayName,
      clientId: provider.clientId,
      clientSecret: '',
      callbackUrl: provider.callbackUrl,
      authorizationUrl: provider.authorizationUrl,
      tokenUrl: provider.tokenUrl,
      userinfoUrl: provider.userinfoUrl
    })
    setShowModal(true)
  }

  const closeModal = () => {
    setShowModal(false)
    setEditingProvider(null)
    setError('')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError('')

    try {
      const token = localStorage.getItem('token')
      const url = editingProvider
        ? `/api/admin/oauth/providers/${editingProvider.id}`
        : '/api/admin/oauth/providers'
      const method = editingProvider ? 'PUT' : 'POST'

      const body: any = {
        displayName: formData.displayName,
        clientId: formData.clientId,
        callbackUrl: formData.callbackUrl,
        authorizationUrl: formData.authorizationUrl,
        tokenUrl: formData.tokenUrl,
        userinfoUrl: formData.userinfoUrl
      }

      if (formData.clientSecret) {
        body.clientSecret = formData.clientSecret
      }

      if (!editingProvider) {
        body.provider = formData.provider
        if (!formData.provider) {
          setError(language === 'zh-CN' ? '请输入服务商标识' : 'Provider identifier is required')
          setSaving(false)
          return
        }
        if (!formData.clientSecret) {
          setError(language === 'zh-CN' ? '请输入 Client Secret' : 'Client Secret is required')
          setSaving(false)
          return
        }
        if (!formData.authorizationUrl) {
          setError(language === 'zh-CN' ? '请输入授权地址' : 'Authorization URL is required')
          setSaving(false)
          return
        }
        if (!formData.tokenUrl) {
          setError(language === 'zh-CN' ? '请输入令牌地址' : 'Token URL is required')
          setSaving(false)
          return
        }
        if (!formData.userinfoUrl) {
          setError(language === 'zh-CN' ? '请输入用户信息地址' : 'Userinfo URL is required')
          setSaving(false)
          return
        }
      }

      const res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      })

      if (res.ok) {
        setSuccess(t('configSaved'))
        closeModal()
        fetchProviders()
        setTimeout(() => setSuccess(''), 3000)
      } else {
        const data = await res.json()
        setError(data.error || (language === 'zh-CN' ? '保存失败' : 'Failed to save'))
      }
    } catch (err) {
      setError(language === 'zh-CN' ? '保存失败' : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (provider: OAuthProvider) => {
    if (!confirm(t('confirmDeleteProvider'))) return

    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/admin/oauth/providers/${provider.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      })

      if (res.ok) {
        setSuccess(t('configDeleted'))
        fetchProviders()
        setTimeout(() => setSuccess(''), 3000)
      }
    } catch (err) {
      console.error('Failed to delete provider:', err)
    }
  }

  const handleToggle = async (provider: OAuthProvider) => {
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/admin/oauth/providers/${provider.id}/toggle`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` }
      })

      if (res.ok) {
        fetchProviders()
      } else {
        const data = await res.json()
        if (data.error && data.maxAllowed) {
          setError(language === 'zh-CN' 
            ? `最多只能启用 ${data.maxAllowed} 个 OAuth 服务商，当前已启用 ${data.activeCount} 个` 
            : `Maximum ${data.maxAllowed} active OAuth providers allowed, currently ${data.activeCount} active`)
        } else {
          setError(data.error || (language === 'zh-CN' ? '操作失败' : 'Operation failed'))
        }
        setTimeout(() => setError(''), 3000)
      }
    } catch (err) {
      console.error('Failed to toggle provider:', err)
      setError(language === 'zh-CN' ? '操作失败' : 'Operation failed')
    }
  }

  return (
    <Layout>
      <div className="flex-1 overflow-y-auto" style={{ backgroundColor: 'var(--color-bg-primary)' }}>
        <div className="max-w-4xl mx-auto p-8">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h2 className="text-2xl font-bold flex items-center gap-2" style={{ color: 'var(--color-text-primary)' }}>
                <Key className="w-7 h-7" style={{ color: 'var(--color-accent-primary)' }} />
                {t('oauthConfig')}
              </h2>
              <p className="mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
                {t('oauthConfigDescription')}
                <span className="ml-2 px-2 py-0.5 rounded text-xs" style={{ 
                  backgroundColor: activeCount >= maxActiveProviders ? 'rgba(239, 68, 68, 0.1)' : 'var(--color-bg-tertiary)',
                  color: activeCount >= maxActiveProviders ? '#ef4444' : 'var(--color-text-muted)'
                }}>
                  {language === 'zh-CN' 
                    ? `已启用 ${activeCount}/${maxActiveProviders} 个` 
                    : `${activeCount}/${maxActiveProviders} active`}
                </span>
              </p>
            </div>
            <button
              onClick={openAddModal}
              className="flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors"
              style={{ backgroundColor: 'var(--color-accent-primary)', color: 'var(--color-accent-text)' }}
            >
              <Plus className="w-4 h-4" />
              {t('addProvider')}
            </button>
          </div>

          {error && (
            <div
              className="mb-6 p-4 rounded-lg"
              style={{
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                color: '#ef4444'
              }}
            >
              {error}
            </div>
          )}

          {success && (
            <div
              className="mb-6 p-4 rounded-lg"
              style={{
                backgroundColor: 'rgba(34, 197, 94, 0.1)',
                border: '1px solid rgba(34, 197, 94, 0.3)',
                color: '#22c55e'
              }}
            >
              {success}
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: 'var(--color-accent-primary)' }}></div>
            </div>
          ) : providers.length === 0 ? (
            <div
              className="text-center py-12 rounded-lg border"
              style={{
                borderColor: 'var(--color-border-primary)',
                backgroundColor: 'var(--color-bg-secondary)'
              }}
            >
              <Key className="w-12 h-12 mx-auto mb-4" style={{ color: 'var(--color-text-muted)' }} />
              <p style={{ color: 'var(--color-text-secondary)' }}>{t('noProviders')}</p>
              <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>{t('noProvidersHint')}</p>
            </div>
          ) : (
            <div className="space-y-4">
              {providers.map(provider => {
                const getProviderLogo = () => {
                  const logoClass = "w-6 h-6"
                  
                  if (provider.provider === 'github') {
                    return (
                      <svg className={logoClass} viewBox="0 0 24 24" fill="currentColor" style={{ color: '#24292e' }}>
                        <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                      </svg>
                    )
                  }
                  
                  if (provider.provider === 'google') {
                    return (
                      <svg className={logoClass} viewBox="0 0 24 24">
                        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                      </svg>
                    )
                  }
                  
                  if (provider.provider === 'wechat') {
                    return (
                      <svg className={logoClass} viewBox="0 0 24 24" fill="#07C160">
                        <path d="M8.691 2.188C3.891 2.188 0 5.476 0 9.36c0 2.212 1.17 4.203 3.002 5.555a.59.59 0 0 1 .213.665l-.39 1.48c-.019.07-.048.141-.048.213 0 .163.13.295.29.295a.326.326 0 0 1 .167-.054l1.943-1.154a.934.934 0 0 1 .446-.138c.089 0 .177.018.265.035.907.235 1.863.371 2.853.371.277 0 .549-.016.819-.04-.159-.583-.246-1.187-.246-1.807 0-3.654 3.396-6.66 7.58-6.66.272 0 .538.018.802.047C15.762 4.256 12.528 2.188 8.691 2.188zm-2.935 5.09c.57 0 1.031.462 1.031 1.03 0 .57-.461 1.031-1.03 1.031-.571 0-1.032-.461-1.032-1.03 0-.57.461-1.031 1.031-1.031zm5.872 0c.57 0 1.031.462 1.031 1.03 0 .57-.461 1.031-1.03 1.031-.571 0-1.032-.461-1.032-1.03 0-.57.461-1.031 1.031-1.031zm4.847 3.54c-3.762 0-6.864 2.67-6.864 5.94 0 3.27 3.102 5.94 6.864 5.94.645 0 1.272-.076 1.874-.219a.67.67 0 0 1 .2-.032.54.54 0 0 1 .264.079l1.46.87a.23.23 0 0 0 .124.04c.118 0 .215-.096.215-.215 0-.054-.017-.107-.036-.16l-.29-1.11a.44.44 0 0 1 .16-.5c1.372-1.01 2.256-2.458 2.256-4.093 0-3.27-3.102-5.94-6.864-5.94zm-2.534 3.46c.427 0 .77.344.77.77 0 .427-.343.77-.77.77-.426 0-.77-.343-.77-.77 0-.426.344-.77.77-.77zm5.07 0c.427 0 .77.344.77.77 0 .427-.343.77-.77.77-.426 0-.77-.343-.77-.77 0-.426.344-.77.77-.77z"/>
                      </svg>
                    )
                  }
                  
                  return <Key className={logoClass} style={{ color: 'var(--color-text-primary)' }} />
                }
                
                return (
                  <div
                    key={provider.id}
                    className="rounded-lg border p-6 transition-all"
                    style={{
                      borderColor: provider.isActive ? 'var(--color-accent-primary)' : 'var(--color-border-primary)',
                      backgroundColor: 'var(--color-bg-secondary)',
                      opacity: provider.isActive ? 1 : 0.7
                    }}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-4">
                        <div
                          className="w-12 h-12 rounded-full flex items-center justify-center"
                          style={{ backgroundColor: 'var(--color-accent-muted)' }}
                        >
                          {getProviderLogo()}
                        </div>
                        <div>
                          <h3 className="text-lg font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                            {provider.displayName}
                          </h3>
                          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                            {provider.provider}
                          </p>
                        </div>
                        <span
                          className="px-2 py-1 rounded text-xs font-medium"
                          style={{
                            backgroundColor: provider.isActive ? 'rgba(34, 197, 94, 0.1)' : 'var(--color-bg-tertiary)',
                            color: provider.isActive ? '#22c55e' : 'var(--color-text-muted)'
                          }}
                        >
                          {provider.isActive ? t('providerActive') : t('providerInactive')}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleToggle(provider)}
                          className="p-2 rounded-lg transition-colors hover:bg-[var(--color-bg-tertiary)]"
                          title={t('toggleActive')}
                          style={{ color: provider.isActive ? '#22c55e' : 'var(--color-text-muted)' }}
                        >
                          {provider.isActive ? <Power className="w-5 h-5" /> : <PowerOff className="w-5 h-5" />}
                        </button>
                        <button
                          onClick={() => openEditModal(provider)}
                          className="p-2 rounded-lg transition-colors hover:bg-[var(--color-bg-tertiary)]"
                          title={t('edit')}
                          style={{ color: 'var(--color-text-secondary)' }}
                        >
                          <Edit className="w-5 h-5" />
                        </button>
                        <button
                          onClick={() => handleDelete(provider)}
                          className="p-2 rounded-lg transition-colors hover:bg-[var(--color-bg-tertiary)]"
                          title={t('delete')}
                          style={{ color: '#ef4444' }}
                        >
                          <Trash2 className="w-5 h-5" />
                        </button>
                      </div>
                    </div>

                    <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                      <div>
                        <label className="block font-medium mb-1" style={{ color: 'var(--color-text-tertiary)' }}>{t('clientId')}</label>
                        <p
                          className="px-3 py-2 rounded-lg font-mono text-xs truncate"
                          style={{ backgroundColor: 'var(--color-bg-tertiary)', color: 'var(--color-text-primary)' }}
                        >
                          {provider.clientId}
                        </p>
                      </div>
                      <div>
                        <label className="block font-medium mb-1" style={{ color: 'var(--color-text-tertiary)' }}>{t('clientSecret')}</label>
                        <div
                          className="px-3 py-2 rounded-lg flex items-center justify-between"
                          style={{ backgroundColor: 'var(--color-bg-tertiary)' }}
                        >
                          <span className="font-mono text-xs truncate" style={{ color: 'var(--color-text-primary)' }}>
                            {provider.clientSecret}
                          </span>
                        </div>
                      </div>
                      <div className="md:col-span-2">
                        <label className="block font-medium mb-1" style={{ color: 'var(--color-text-tertiary)' }}>{t('callbackUrl')}</label>
                        <p
                          className="px-3 py-2 rounded-lg font-mono text-xs truncate"
                          style={{ backgroundColor: 'var(--color-bg-tertiary)', color: 'var(--color-text-primary)' }}
                        >
                          {provider.callbackUrl}
                        </p>
                      </div>
                      <div>
                        <label className="block font-medium mb-1" style={{ color: 'var(--color-text-tertiary)' }}>
                          {language === 'zh-CN' ? '授权地址' : 'Authorization URL'}
                        </label>
                        <p
                          className="px-3 py-2 rounded-lg font-mono text-xs truncate"
                          style={{ backgroundColor: 'var(--color-bg-tertiary)', color: 'var(--color-text-primary)' }}
                        >
                          {provider.authorizationUrl}
                        </p>
                      </div>
                      <div>
                        <label className="block font-medium mb-1" style={{ color: 'var(--color-text-tertiary)' }}>
                          {language === 'zh-CN' ? '令牌地址' : 'Token URL'}
                        </label>
                        <p
                          className="px-3 py-2 rounded-lg font-mono text-xs truncate"
                          style={{ backgroundColor: 'var(--color-bg-tertiary)', color: 'var(--color-text-primary)' }}
                        >
                          {provider.tokenUrl}
                        </p>
                      </div>
                      <div className="md:col-span-2">
                        <label className="block font-medium mb-1" style={{ color: 'var(--color-text-tertiary)' }}>
                          {language === 'zh-CN' ? '用户信息地址' : 'Userinfo URL'}
                        </label>
                        <p
                          className="px-3 py-2 rounded-lg font-mono text-xs truncate"
                          style={{ backgroundColor: 'var(--color-bg-tertiary)', color: 'var(--color-text-primary)' }}
                        >
                          {provider.userinfoUrl}
                        </p>
                      </div>
                    </div>
                  </div>
                )})}
              </div>
            )}
          </div>
        </div>

      {/* Add/Edit Modal */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)' }}
          onClick={closeModal}
        >
          <div
            className="rounded-xl shadow-2xl max-w-lg w-full mx-4 overflow-hidden"
            style={{ backgroundColor: 'var(--color-bg-secondary)' }}
            onClick={e => e.stopPropagation()}
          >
            <div
              className="px-6 py-4 border-b flex items-center justify-between"
              style={{ borderColor: 'var(--color-border-primary)' }}
            >
              <h3 className="text-lg font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                {editingProvider ? t('editProvider') : t('addProvider')}
              </h3>
              <button
                onClick={closeModal}
                className="p-1.5 rounded-lg transition-colors hover:bg-[var(--color-bg-tertiary)]"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {error && (
                <div
                  className="p-3 rounded-lg text-sm"
                  style={{
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    border: '1px solid rgba(239, 68, 68, 0.3)',
                    color: '#ef4444'
                  }}
                >
                  {error}
                </div>
              )}

              {!editingProvider && (
                <div>
                  <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>
                    {language === 'zh-CN' ? '服务商标识' : 'Provider Identifier'} *
                  </label>
                  <input
                    type="text"
                    value={formData.provider}
                    onChange={e => setFormData({ ...formData, provider: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '') })}
                    className="w-full px-3 py-2 rounded-lg border text-sm font-mono transition-colors focus:outline-none focus:ring-2"
                    style={{
                      backgroundColor: 'var(--color-bg-primary)',
                      borderColor: 'var(--color-border-primary)',
                      color: 'var(--color-text-primary)'
                    }}
                    placeholder={language === 'zh-CN' ? '如: github, google' : 'e.g.: github, google'}
                    required
                  />
                  <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
                    {language === 'zh-CN' ? '唯一标识符，仅支持小写字母、数字、下划线和连字符' : 'Unique identifier, lowercase letters, numbers, underscores and hyphens only'}
                  </p>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>
                  {t('providerName')} *
                </label>
                <input
                  type="text"
                  value={formData.displayName}
                  onChange={e => setFormData({ ...formData, displayName: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border text-sm transition-colors focus:outline-none focus:ring-2"
                  style={{
                    backgroundColor: 'var(--color-bg-primary)',
                    borderColor: 'var(--color-border-primary)',
                    color: 'var(--color-text-primary)'
                  }}
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>
                  {t('clientId')} *
                </label>
                <input
                  type="text"
                  value={formData.clientId}
                  onChange={e => setFormData({ ...formData, clientId: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border text-sm font-mono transition-colors focus:outline-none focus:ring-2"
                  style={{
                    backgroundColor: 'var(--color-bg-primary)',
                    borderColor: 'var(--color-border-primary)',
                    color: 'var(--color-text-primary)'
                  }}
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>
                  {t('clientSecret')} {!editingProvider && '*'}
                  {editingProvider && <span className="text-xs ml-1" style={{ color: 'var(--color-text-muted)' }}>
                    ({language === 'zh-CN' ? '留空保持不变' : 'Leave empty to keep unchanged'})
                  </span>}
                </label>
                <input
                  type="password"
                  value={formData.clientSecret}
                  onChange={e => setFormData({ ...formData, clientSecret: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border text-sm font-mono transition-colors focus:outline-none focus:ring-2"
                  style={{
                    backgroundColor: 'var(--color-bg-primary)',
                    borderColor: 'var(--color-border-primary)',
                    color: 'var(--color-text-primary)'
                  }}
                  required={!editingProvider}
                  placeholder={editingProvider ? '••••••••••••' : ''}
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>
                  {t('callbackUrl')} *
                </label>
                <input
                  type="url"
                  value={formData.callbackUrl}
                  onChange={e => setFormData({ ...formData, callbackUrl: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border text-sm font-mono transition-colors focus:outline-none focus:ring-2"
                  style={{
                    backgroundColor: 'var(--color-bg-primary)',
                    borderColor: 'var(--color-border-primary)',
                    color: 'var(--color-text-primary)'
                  }}
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>
                  {language === 'zh-CN' ? '授权地址' : 'Authorization URL'} *
                </label>
                <input
                  type="url"
                  value={formData.authorizationUrl}
                  onChange={e => setFormData({ ...formData, authorizationUrl: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border text-sm font-mono transition-colors focus:outline-none focus:ring-2"
                  style={{
                    backgroundColor: 'var(--color-bg-primary)',
                    borderColor: 'var(--color-border-primary)',
                    color: 'var(--color-text-primary)'
                  }}
                  placeholder={language === 'zh-CN' ? '如: https://github.com/login/oauth/authorize' : 'e.g.: https://github.com/login/oauth/authorize'}
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>
                  {language === 'zh-CN' ? '令牌地址' : 'Token URL'} *
                </label>
                <input
                  type="url"
                  value={formData.tokenUrl}
                  onChange={e => setFormData({ ...formData, tokenUrl: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border text-sm font-mono transition-colors focus:outline-none focus:ring-2"
                  style={{
                    backgroundColor: 'var(--color-bg-primary)',
                    borderColor: 'var(--color-border-primary)',
                    color: 'var(--color-text-primary)'
                  }}
                  placeholder={language === 'zh-CN' ? '如: https://github.com/login/oauth/access_token' : 'e.g.: https://github.com/login/oauth/access_token'}
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>
                  {language === 'zh-CN' ? '用户信息地址' : 'Userinfo URL'} *
                </label>
                <input
                  type="url"
                  value={formData.userinfoUrl}
                  onChange={e => setFormData({ ...formData, userinfoUrl: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border text-sm font-mono transition-colors focus:outline-none focus:ring-2"
                  style={{
                    backgroundColor: 'var(--color-bg-primary)',
                    borderColor: 'var(--color-border-primary)',
                    color: 'var(--color-text-primary)'
                  }}
                  placeholder={language === 'zh-CN' ? '如: https://api.github.com/user' : 'e.g.: https://api.github.com/user'}
                  required
                />
              </div>

              <div
                className="pt-4 border-t flex justify-end gap-3"
                style={{ borderColor: 'var(--color-border-primary)' }}
              >
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                  style={{
                    color: 'var(--color-text-secondary)',
                    backgroundColor: 'var(--color-bg-tertiary)'
                  }}
                >
                  {t('cancel')}
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                  style={{ backgroundColor: 'var(--color-accent-primary)', color: 'var(--color-accent-text)' }}
                >
                  {saving ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2" style={{ borderColor: 'var(--color-accent-text)' }}></div>
                      {t('loading')}
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4" />
                      {t('save')}
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </Layout>
  )
}