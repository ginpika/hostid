import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Save, Loader2, Pencil, X, Shield } from 'lucide-react'
import { useI18n } from '../i18n/I18nContext'
import Layout from '../components/Layout'

interface UserProfile {
  id: string
  email: string
  username: string
  nickname: string | null
  phone: string | null
  birthday: string | null
  avatar: string | null
  language: string
  createdAt: string
}

export default function ProfilePage() {
  const { t } = useI18n()
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState(false)
  const [formData, setFormData] = useState({
    nickname: '',
    phone: '',
    birthday: ''
  })
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    fetchProfile()
  }, [])

  const fetchProfile = async () => {
    try {
      const token = localStorage.getItem('token')
      const res = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (res.ok) {
        const data = await res.json()
        setProfile(data)
        setFormData({
          nickname: data.nickname || '',
          phone: data.phone || '',
          birthday: data.birthday || ''
        })
      }
    } catch (err) {
      console.error('Failed to fetch profile:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    setError('')
    setSuccess('')

    try {
      const token = localStorage.getItem('token')
      const res = await fetch('/api/auth/profile', {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(formData)
      })

      if (res.ok) {
        const data = await res.json()
        setProfile(data)
        setEditing(false)
        setSuccess(t('profileUpdated'))
      } else {
        setError(t('saveFailed'))
      }
    } catch (err) {
      setError(t('saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const handleCancel = () => {
    setFormData({
      nickname: profile?.nickname || '',
      phone: profile?.phone || '',
      birthday: profile?.birthday || ''
    })
    setEditing(false)
    setError('')
  }

  if (loading) {
    return (
      <Layout>
        <div className="flex-1 flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: 'var(--color-accent-primary)' }}></div>
        </div>
      </Layout>
    )
  }

  if (!profile) {
    return (
      <Layout>
        <div className="flex-1 flex items-center justify-center">
          <p style={{ color: 'var(--color-text-tertiary)' }}>{t('profileNotFound')}</p>
        </div>
      </Layout>
    )
  }

  return (
    <Layout>
      <div className="flex-1 overflow-y-auto relative" style={{ backgroundColor: 'var(--color-bg-primary)' }}>
        <Link
          to="/sso/info"
          className="absolute top-4 right-4 z-10 flex items-center gap-2 px-3 py-2 rounded-lg shadow-lg transition-all hover:scale-105"
          style={{ 
            backgroundColor: 'var(--color-bg-secondary)',
            border: '1px solid var(--color-border-primary)',
            color: 'var(--color-text-secondary)'
          }}
          title={t('ssoInfo')}
        >
          <Shield className="w-4 h-4" style={{ color: 'var(--color-accent-primary)' }} />
          <span className="text-sm font-medium">{t('ssoInfo')}</span>
        </Link>
        
        <div className="max-w-3xl mx-auto p-8">
          <div className="mb-8">
            <h2 className="text-2xl font-bold" style={{ color: 'var(--color-text-primary)' }}>{t('profile')}</h2>
            <p className="mt-1" style={{ color: 'var(--color-text-tertiary)' }}>{t('profileDescription')}</p>
          </div>

          {error && (
            <div 
              className="mb-6 p-4 border rounded-lg"
              style={{ 
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                borderColor: 'rgba(239, 68, 68, 0.3)',
                color: '#ef4444'
              }}
            >
              {error}
            </div>
          )}
          {success && (
            <div 
              className="mb-6 p-4 border rounded-lg"
              style={{ 
                backgroundColor: 'rgba(34, 197, 94, 0.1)',
                borderColor: 'rgba(34, 197, 94, 0.3)',
                color: '#22c55e'
              }}
            >
              {success}
            </div>
          )}

          <div 
            className="rounded-lg border"
            style={{ 
              backgroundColor: 'var(--color-bg-secondary)',
              borderColor: 'var(--color-border-primary)'
            }}
          >
            {/* 只读信息区域 */}
            <div className="p-6">
              <h3 className="text-sm font-semibold uppercase tracking-wider mb-4" style={{ color: 'var(--color-text-tertiary)' }}>
                {t('accountInfo')}
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                <div>
                  <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text-tertiary)' }}>{t('username')}</label>
                  <p className="text-base" style={{ color: 'var(--color-text-primary)' }}>{profile.username}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text-tertiary)' }}>{t('email')}</label>
                  <p className="text-base" style={{ color: 'var(--color-text-primary)' }}>{profile.email}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text-tertiary)' }}>{t('registeredAt')}</label>
                  <p className="text-base" style={{ color: 'var(--color-text-primary)' }}>{new Date(profile.createdAt).toLocaleDateString()}</p>
                </div>
              </div>
            </div>

            {/* 分割线 */}
            <div className="border-t" style={{ borderColor: 'var(--color-border-primary)' }} />

            {/* 可编辑信息区域 */}
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-tertiary)' }}>
                  {t('personalInfo')}
                </h3>
                {!editing && (
                  <button
                    onClick={() => setEditing(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors"
                    style={{ 
                      color: 'var(--color-accent-primary)',
                      backgroundColor: 'var(--color-accent-muted)'
                    }}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    {t('edit')}
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                <div>
                  <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>{t('nickname')}</label>
                  <div className="min-h-[42px] flex items-center">
                    {editing ? (
                      <input
                        type="text"
                        value={formData.nickname}
                        onChange={(e) => setFormData({ ...formData, nickname: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg border text-sm transition-colors focus:outline-none focus:ring-2"
                        style={{ 
                          backgroundColor: 'var(--color-bg-primary)',
                          borderColor: 'var(--color-border-primary)',
                          color: 'var(--color-text-primary)'
                        }}
                        placeholder={t('nicknamePlaceholder')}
                      />
                    ) : (
                      <p className="text-base py-2" style={{ color: 'var(--color-text-primary)' }}>{profile.nickname || '-'}</p>
                    )}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>{t('phone')}</label>
                  <div className="min-h-[42px] flex items-center">
                    {editing ? (
                      <input
                        type="tel"
                        value={formData.phone}
                        onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg border text-sm transition-colors focus:outline-none focus:ring-2"
                        style={{ 
                          backgroundColor: 'var(--color-bg-primary)',
                          borderColor: 'var(--color-border-primary)',
                          color: 'var(--color-text-primary)'
                        }}
                        placeholder={t('phonePlaceholder')}
                      />
                    ) : (
                      <p className="text-base py-2" style={{ color: 'var(--color-text-primary)' }}>{profile.phone || '-'}</p>
                    )}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>{t('birthday')}</label>
                  <div className="min-h-[42px] flex items-center">
                    {editing ? (
                      <input
                        type="date"
                        value={formData.birthday}
                        onChange={(e) => setFormData({ ...formData, birthday: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg border text-sm transition-colors focus:outline-none focus:ring-2"
                        style={{ 
                          backgroundColor: 'var(--color-bg-primary)',
                          borderColor: 'var(--color-border-primary)',
                          color: 'var(--color-text-primary)'
                        }}
                      />
                    ) : (
                      <p className="text-base py-2" style={{ color: 'var(--color-text-primary)' }}>{profile.birthday || '-'}</p>
                    )}
                  </div>
                </div>
              </div>

              {editing && (
                <div className="flex justify-end gap-3 mt-6 pt-4 border-t" style={{ borderColor: 'var(--color-border-primary)' }}>
                  <button
                    onClick={handleCancel}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                    style={{ 
                      color: 'var(--color-text-secondary)',
                      backgroundColor: 'var(--color-bg-tertiary)'
                    }}
                    disabled={saving}
                  >
                    <X className="w-4 h-4" />
                    {t('cancel')}
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                    style={{ backgroundColor: 'var(--color-accent-primary)', color: 'var(--color-accent-text)' }}
                  >
                    {saving ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        {t('saving')}
                      </>
                    ) : (
                      <>
                        <Save className="w-4 h-4" />
                        {t('save')}
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </Layout>
  )
}
