/**
 * OAuth 应用管理页面
 * 管理 OAuth 授权应用，让其他应用通过 Hostid 登录
 * 支持创建、编辑、删除应用和重置密钥
 */
import { useState, useEffect } from 'react'
import { AppWindow, Plus, Trash2, Edit, Power, PowerOff, X, Check, RefreshCw, Copy, Eye, EyeOff } from 'lucide-react'
import Layout from '../components/Layout'
import { useI18n } from '../i18n/I18nContext'

interface OAuthApp {
  id: string
  name: string
  clientId: string
  clientSecret: string
  redirectUris: string[]
  description: string | null
  homepage: string | null
  scope: string
  isConfidential: boolean
  isActive: boolean
  userId: string
  createdAt: string
  updatedAt: string
  user?: {
    id: string
    username: string
    email: string
  }
  secretWarning?: string
}

interface AppFormData {
  name: string
  redirectUris: string
  description: string
  homepage: string
  scope: string
  isConfidential: boolean
}

export default function OAuthAppsPage() {
  const { t, language } = useI18n()
  const [apps, setApps] = useState<OAuthApp[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Modal state
  const [showModal, setShowModal] = useState(false)
  const [editingApp, setEditingApp] = useState<OAuthApp | null>(null)
  const [formData, setFormData] = useState<AppFormData>({
    name: '',
    redirectUris: '',
    description: '',
    homepage: '',
    scope: 'openid profile email',
    isConfidential: true
  })
  const [saving, setSaving] = useState(false)

  // New secret display
  const [newSecret, setNewSecret] = useState<string | null>(null)
  const [showSecret, setShowSecret] = useState(false)

  useEffect(() => {
    fetchApps()
  }, [])

  const fetchApps = async () => {
    setLoading(true)
    try {
      const token = localStorage.getItem('token')
      const res = await fetch('/api/admin/oauth-apps', {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (res.ok) {
        const data = await res.json()
        setApps(data.apps)
      } else if (res.status === 403) {
        setError(t('adminAccessDenied'))
      }
    } catch (err) {
      console.error('Failed to fetch apps:', err)
      setError(language === 'zh-CN' ? '获取应用列表失败' : 'Failed to fetch apps')
    } finally {
      setLoading(false)
    }
  }

  const openAddModal = () => {
    setEditingApp(null)
    setFormData({
      name: '',
      redirectUris: '',
      description: '',
      homepage: '',
      scope: 'openid profile email',
      isConfidential: true
    })
    setNewSecret(null)
    setShowSecret(false)
    setShowModal(true)
  }

  const openEditModal = (app: OAuthApp) => {
    setEditingApp(app)
    setFormData({
      name: app.name,
      redirectUris: app.redirectUris.join('\n'),
      description: app.description || '',
      homepage: app.homepage || '',
      scope: app.scope,
      isConfidential: app.isConfidential
    })
    setNewSecret(null)
    setShowSecret(false)
    setShowModal(true)
  }

  const closeModal = () => {
    setShowModal(false)
    setEditingApp(null)
    setError('')
    setNewSecret(null)
    setShowSecret(false)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError('')

    try {
      const token = localStorage.getItem('token')
      const url = editingApp
        ? `/api/admin/oauth-apps/${editingApp.id}`
        : '/api/admin/oauth-apps'
      const method = editingApp ? 'PUT' : 'POST'

      // Parse redirect URIs (one per line)
      const redirectUrisArray = formData.redirectUris
        .split('\n')
        .map(uri => uri.trim())
        .filter(uri => uri.length > 0)

      if (redirectUrisArray.length === 0) {
        setError(language === 'zh-CN' ? '请至少输入一个回调地址' : 'At least one redirect URI is required')
        setSaving(false)
        return
      }

      const body: any = {
        name: formData.name,
        redirectUris: redirectUrisArray,
        description: formData.description || null,
        homepage: formData.homepage || null,
        isConfidential: formData.isConfidential
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
        const data = await res.json()
        if (data.clientSecret && !editingApp) {
          // Show the new secret
          setNewSecret(data.clientSecret)
          setSuccess(language === 'zh-CN' ? '应用创建成功！请保存以下密钥' : 'App created! Save the secret below')
        } else if (data.clientSecret && editingApp) {
          setNewSecret(data.clientSecret)
          setSuccess(language === 'zh-CN' ? '密钥重置成功！请保存以下新密钥' : 'Secret reset! Save the new secret below')
        } else {
          setSuccess(t('configSaved'))
          closeModal()
          fetchApps()
        }
        if (!data.clientSecret) {
          setTimeout(() => setSuccess(''), 3000)
        }
        fetchApps()
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

  const handleDelete = async (app: OAuthApp) => {
    if (!confirm(t('confirmDeleteOAuthApp'))) return

    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/admin/oauth-apps/${app.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      })

      if (res.ok) {
        setSuccess(t('configDeleted'))
        fetchApps()
        setTimeout(() => setSuccess(''), 3000)
      }
    } catch (err) {
      console.error('Failed to delete app:', err)
    }
  }

  const handleToggle = async (app: OAuthApp) => {
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/admin/oauth-apps/${app.id}/toggle`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` }
      })

      if (res.ok) {
        fetchApps()
      }
    } catch (err) {
      console.error('Failed to toggle app:', err)
    }
  }

  const handleResetSecret = async (app: OAuthApp) => {
    if (!confirm(t('resetSecretConfirm'))) return

    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/admin/oauth-apps/${app.id}/reset-secret`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      })

      if (res.ok) {
        const data = await res.json()
        setNewSecret(data.clientSecret)
        setSuccess(language === 'zh-CN' ? '密钥重置成功！请保存以下新密钥' : 'Secret reset! Save the new secret below')
        fetchApps()
      }
    } catch (err) {
      console.error('Failed to reset secret:', err)
    }
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    setSuccess(language === 'zh-CN' ? '已复制到剪贴板' : 'Copied to clipboard')
    setTimeout(() => setSuccess(''), 2000)
  }

  return (
    <Layout>
      <div className="flex-1 overflow-y-auto" style={{ backgroundColor: 'var(--color-bg-primary)' }}>
        <div className="max-w-4xl mx-auto p-8">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h2 className="text-2xl font-bold flex items-center gap-2" style={{ color: 'var(--color-text-primary)' }}>
                <AppWindow className="w-7 h-7" style={{ color: 'var(--color-accent-primary)' }} />
                {t('oauthApps')}
              </h2>
              <p className="mt-1" style={{ color: 'var(--color-text-tertiary)' }}>{t('oauthAppsDescription')}</p>
            </div>
            <button
              onClick={openAddModal}
              className="flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors"
              style={{ backgroundColor: 'var(--color-accent-primary)', color: 'var(--color-accent-text)' }}
            >
              <Plus className="w-4 h-4" />
              {t('createOAuthApp')}
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
          ) : apps.length === 0 ? (
            <div
              className="text-center py-12 rounded-lg border"
              style={{
                borderColor: 'var(--color-border-primary)',
                backgroundColor: 'var(--color-bg-secondary)'
              }}
            >
              <AppWindow className="w-12 h-12 mx-auto mb-4" style={{ color: 'var(--color-text-muted)' }} />
              <p style={{ color: 'var(--color-text-secondary)' }}>{t('noOAuthApps')}</p>
              <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>{t('noOAuthAppsHint')}</p>
            </div>
          ) : (
            <div className="space-y-4">
              {apps.map(app => (
                <div
                  key={app.id}
                  className="rounded-lg border p-6 transition-all"
                  style={{
                    borderColor: app.isActive ? 'var(--color-accent-primary)' : 'var(--color-border-primary)',
                    backgroundColor: 'var(--color-bg-secondary)',
                    opacity: app.isActive ? 1 : 0.7
                  }}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-4">
                      <div
                        className="w-12 h-12 rounded-full flex items-center justify-center"
                        style={{ backgroundColor: 'var(--color-accent-muted)' }}
                      >
                        <AppWindow className="w-6 h-6" style={{ color: 'var(--color-text-primary)' }} />
                      </div>
                      <div>
                        <h3 className="text-lg font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                          {app.name}
                        </h3>
                        <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                          {app.description || app.clientId}
                        </p>
                      </div>
                      <span
                        className="px-2 py-1 rounded text-xs font-medium"
                        style={{
                          backgroundColor: app.isActive ? 'rgba(34, 197, 94, 0.1)' : 'var(--color-bg-tertiary)',
                          color: app.isActive ? '#22c55e' : 'var(--color-text-muted)'
                        }}
                      >
                        {app.isActive ? t('oauthAppActive') : t('oauthAppInactive')}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleToggle(app)}
                        className="p-2 rounded-lg transition-colors hover:bg-[var(--color-bg-tertiary)]"
                        title={t('toggleActive')}
                        style={{ color: app.isActive ? '#22c55e' : 'var(--color-text-muted)' }}
                      >
                        {app.isActive ? <Power className="w-5 h-5" /> : <PowerOff className="w-5 h-5" />}
                      </button>
                      <button
                        onClick={() => handleResetSecret(app)}
                        className="p-2 rounded-lg transition-colors hover:bg-[var(--color-bg-tertiary)]"
                        title={t('resetSecret')}
                        style={{ color: 'var(--color-text-secondary)' }}
                      >
                        <RefreshCw className="w-5 h-5" />
                      </button>
                      <button
                        onClick={() => openEditModal(app)}
                        className="p-2 rounded-lg transition-colors hover:bg-[var(--color-bg-tertiary)]"
                        title={t('edit')}
                        style={{ color: 'var(--color-text-secondary)' }}
                      >
                        <Edit className="w-5 h-5" />
                      </button>
                      <button
                        onClick={() => handleDelete(app)}
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
                      <div className="flex items-center gap-2">
                        <p
                          className="flex-1 px-3 py-2 rounded-lg font-mono text-xs truncate"
                          style={{ backgroundColor: 'var(--color-bg-tertiary)', color: 'var(--color-text-primary)' }}
                        >
                          {app.clientId}
                        </p>
                        <button
                          onClick={() => copyToClipboard(app.clientId)}
                          className="p-2 rounded-lg transition-colors hover:bg-[var(--color-bg-tertiary)]"
                          title={t('clickToCopy')}
                          style={{ color: 'var(--color-text-secondary)' }}
                        >
                          <Copy className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className="block font-medium mb-1" style={{ color: 'var(--color-text-tertiary)' }}>{t('clientSecret')}</label>
                      <p
                        className="px-3 py-2 rounded-lg font-mono text-xs"
                        style={{ backgroundColor: 'var(--color-bg-tertiary)', color: 'var(--color-text-muted)' }}
                      >
                        {app.clientSecret}
                      </p>
                    </div>
                    <div className="md:col-span-2">
                      <label className="block font-medium mb-1" style={{ color: 'var(--color-text-tertiary)' }}>{t('redirectUris')}</label>
                      <div className="space-y-1">
                        {app.redirectUris.map((uri, index) => (
                          <p
                            key={index}
                            className="px-3 py-1.5 rounded-lg font-mono text-xs truncate"
                            style={{ backgroundColor: 'var(--color-bg-tertiary)', color: 'var(--color-text-primary)' }}
                          >
                            {uri}
                          </p>
                        ))}
                      </div>
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
            className="rounded-xl shadow-2xl max-w-lg w-full mx-4 overflow-hidden max-h-[90vh] overflow-y-auto"
            style={{ backgroundColor: 'var(--color-bg-secondary)' }}
            onClick={e => e.stopPropagation()}
          >
            <div
              className="px-6 py-4 border-b flex items-center justify-between sticky top-0"
              style={{ borderColor: 'var(--color-border-primary)', backgroundColor: 'var(--color-bg-secondary)' }}
            >
              <h3 className="text-lg font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                {editingApp ? t('editOAuthApp') : t('createOAuthApp')}
              </h3>
              <button
                onClick={closeModal}
                className="p-1.5 rounded-lg transition-colors hover:bg-[var(--color-bg-tertiary)]"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {newSecret ? (
              <div className="p-6">
                <div
                  className="mb-4 p-4 rounded-lg"
                  style={{
                    backgroundColor: 'rgba(234, 179, 8, 0.1)',
                    border: '1px solid rgba(234, 179, 8, 0.3)',
                    color: '#eab308'
                  }}
                >
                  <p className="font-medium">{t('secretWarning')}</p>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>
                      {t('clientId')}
                    </label>
                    <div className="flex items-center gap-2">
                      <p
                        className="flex-1 px-3 py-2 rounded-lg font-mono text-xs break-all"
                        style={{ backgroundColor: 'var(--color-bg-tertiary)', color: 'var(--color-text-primary)' }}
                      >
                        {editingApp?.clientId || apps[apps.length - 1]?.clientId}
                      </p>
                      <button
                        onClick={() => copyToClipboard(editingApp?.clientId || apps[apps.length - 1]?.clientId || '')}
                        className="p-2 rounded-lg transition-colors hover:bg-[var(--color-bg-tertiary)]"
                        style={{ color: 'var(--color-text-secondary)' }}
                      >
                        <Copy className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>
                      {t('clientSecret')}
                    </label>
                    <div className="flex items-center gap-2">
                      <p
                        className="flex-1 px-3 py-2 rounded-lg font-mono text-xs break-all"
                        style={{ backgroundColor: 'var(--color-bg-tertiary)', color: showSecret ? 'var(--color-text-primary)' : 'transparent', userSelect: 'all' }}
                      >
                        {showSecret ? newSecret : '••••••••••••••••••••••••••••••••'}
                      </p>
                      <button
                        onClick={() => setShowSecret(!showSecret)}
                        className="p-2 rounded-lg transition-colors hover:bg-[var(--color-bg-tertiary)]"
                        style={{ color: 'var(--color-text-secondary)' }}
                      >
                        {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                      <button
                        onClick={() => copyToClipboard(newSecret)}
                        className="p-2 rounded-lg transition-colors hover:bg-[var(--color-bg-tertiary)]"
                        style={{ color: 'var(--color-text-secondary)' }}
                      >
                        <Copy className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>

                <div className="mt-6 flex justify-end">
                  <button
                    onClick={closeModal}
                    className="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                    style={{ backgroundColor: 'var(--color-accent-primary)', color: 'var(--color-accent-text)' }}
                  >
                    {t('continue')}
                  </button>
                </div>
              </div>
            ) : (
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

                <div>
                  <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>
                    {language === 'zh-CN' ? '应用名称' : 'App Name'} *
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={e => setFormData({ ...formData, name: e.target.value })}
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
                    {t('redirectUris')} *
                  </label>
                  <textarea
                    value={formData.redirectUris}
                    onChange={e => setFormData({ ...formData, redirectUris: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border text-sm font-mono transition-colors focus:outline-none focus:ring-2 resize-none"
                    style={{
                      backgroundColor: 'var(--color-bg-primary)',
                      borderColor: 'var(--color-border-primary)',
                      color: 'var(--color-text-primary)'
                    }}
                    rows={3}
                    placeholder={language === 'zh-CN' ? '每行一个回调地址' : 'One redirect URI per line'}
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>
                    {language === 'zh-CN' ? '应用描述' : 'Description'}
                  </label>
                  <input
                    type="text"
                    value={formData.description}
                    onChange={e => setFormData({ ...formData, description: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border text-sm transition-colors focus:outline-none focus:ring-2"
                    style={{
                      backgroundColor: 'var(--color-bg-primary)',
                      borderColor: 'var(--color-border-primary)',
                      color: 'var(--color-text-primary)'
                    }}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>
                    {language === 'zh-CN' ? '主页地址' : 'Homepage URL'}
                  </label>
                  <input
                    type="url"
                    value={formData.homepage}
                    onChange={e => setFormData({ ...formData, homepage: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border text-sm font-mono transition-colors focus:outline-none focus:ring-2"
                    style={{
                      backgroundColor: 'var(--color-bg-primary)',
                      borderColor: 'var(--color-border-primary)',
                      color: 'var(--color-text-primary)'
                    }}
                    placeholder="https://example.com"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="isConfidential"
                    checked={formData.isConfidential}
                    onChange={e => setFormData({ ...formData, isConfidential: e.target.checked })}
                    className="rounded"
                  />
                  <label htmlFor="isConfidential" className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                    {t('isConfidential')}
                  </label>
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
            )}
          </div>
        </div>
      )}
    </Layout>
  )
}