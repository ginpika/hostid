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
  scope: string
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
  scope: string
}

const PROVIDER_TYPES = [
  { value: 'github', label: 'GitHub' },
  { value: 'google', label: 'Google' },
  { value: 'gitlab', label: 'GitLab' },
  { value: 'wechat', label: 'WeChat' },
]

export default function OAuthConfigPage() {
  const { t, language } = useI18n()
  const [providers, setProviders] = useState<OAuthProvider[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Modal state
  const [showModal, setShowModal] = useState(false)
  const [editingProvider, setEditingProvider] = useState<OAuthProvider | null>(null)
  const [formData, setFormData] = useState<ProviderFormData>({
    provider: 'github',
    displayName: 'GitHub',
    clientId: '',
    clientSecret: '',
    callbackUrl: '',
    scope: 'user:email'
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
      provider: 'github',
      displayName: 'GitHub',
      clientId: '',
      clientSecret: '',
      callbackUrl: '',
      scope: 'user:email'
    })
    setShowModal(true)
  }

  const openEditModal = (provider: OAuthProvider) => {
    setEditingProvider(provider)
    setFormData({
      provider: provider.provider,
      displayName: provider.displayName,
      clientId: provider.clientId,
      clientSecret: '', // Don't prefill secret
      callbackUrl: provider.callbackUrl,
      scope: provider.scope
    })
    setShowModal(true)
  }

  const closeModal = () => {
    setShowModal(false)
    setEditingProvider(null)
    setError('')
  }

  const handleProviderTypeChange = (type: string) => {
    const providerLabel = PROVIDER_TYPES.find(p => p.value === type)?.label || type
    setFormData({
      ...formData,
      provider: type,
      displayName: providerLabel
    })
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
        scope: formData.scope
      }

      // Only include clientSecret if it's provided
      if (formData.clientSecret) {
        body.clientSecret = formData.clientSecret
      }

      // For new provider, include provider type and require secret
      if (!editingProvider) {
        body.provider = formData.provider
        if (!formData.clientSecret) {
          setError(language === 'zh-CN' ? '请输入 Client Secret' : 'Client Secret is required')
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
      }
    } catch (err) {
      console.error('Failed to toggle provider:', err)
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
              <p className="mt-1" style={{ color: 'var(--color-text-tertiary)' }}>{t('oauthConfigDescription')}</p>
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
              {providers.map(provider => (
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
                        {provider.provider === 'github' ? (
                          <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor" style={{ color: 'var(--color-text-primary)' }}>
                            <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                          </svg>
                        ) : (
                          <Key className="w-6 h-6" style={{ color: 'var(--color-text-primary)' }} />
                        )}
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
                  </div>
                </div>
              ))}
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
                    {t('providerType')}
                  </label>
                  <select
                    value={formData.provider}
                    onChange={e => handleProviderTypeChange(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border text-sm transition-colors focus:outline-none focus:ring-2"
                    style={{
                      backgroundColor: 'var(--color-bg-primary)',
                      borderColor: 'var(--color-border-primary)',
                      color: 'var(--color-text-primary)'
                    }}
                  >
                    {PROVIDER_TYPES.map(p => (
                      <option key={p.value} value={p.value}>{p.label}</option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>
                  {t('providerName')}
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
                  {t('clientId')}
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
                  {t('clientSecret')}
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
                  {t('callbackUrl')}
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
                  {t('scope')}
                </label>
                <input
                  type="text"
                  value={formData.scope}
                  onChange={e => setFormData({ ...formData, scope: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border text-sm transition-colors focus:outline-none focus:ring-2"
                  style={{
                    backgroundColor: 'var(--color-bg-primary)',
                    borderColor: 'var(--color-border-primary)',
                    color: 'var(--color-text-primary)'
                  }}
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