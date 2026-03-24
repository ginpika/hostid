import { useState, useEffect, useRef } from 'react'
import { Save, Loader2, Pencil, X, Shield, Camera, User, KeyRound, Github, Check } from 'lucide-react'
import { useI18n } from '../i18n/I18nContext'
import Layout from '../components/Layout'
import { encryptPassword } from '../utils/rsa'

interface UserProfile {
  id: string
  email: string
  username: string
  nickname: string | null
  phone: string | null
  birthday: string | null
  avatar: string | null
  language: string
  githubId: number | null
  createdAt: string
}

export default function ProfilePage() {
  const { t, language } = useI18n()
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
  const [showAvatarModal, setShowAvatarModal] = useState(false)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  
  const [showPasswordModal, setShowPasswordModal] = useState(false)
  const [changingPassword, setChangingPassword] = useState(false)
  const [passwordData, setPasswordData] = useState({
    oldPassword: '',
    newPassword: '',
    confirmPassword: ''
  })
  const [passwordError, setPasswordError] = useState('')

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

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      if (!file.type.startsWith('image/')) {
        setError(language === 'zh-CN' ? '请选择图片文件' : 'Please select an image file')
        return
      }
      if (file.size > 5 * 1024 * 1024) {
        setError(language === 'zh-CN' ? '图片大小不能超过 5MB' : 'Image size cannot exceed 5MB')
        return
      }
      setSelectedFile(file)
      const url = URL.createObjectURL(file)
      setPreviewUrl(url)
      setError('')
    }
  }

  const handleAvatarUpload = async () => {
    if (!selectedFile) return

    setUploadingAvatar(true)
    setError('')

    try {
      const token = localStorage.getItem('token')
      const formData = new FormData()
      formData.append('avatar', selectedFile)

      const res = await fetch('/api/auth/avatar', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`
        },
        body: formData
      })

      if (res.ok) {
        const data = await res.json()
        setProfile(prev => prev ? { ...prev, avatar: data.avatar } : null)
        setShowAvatarModal(false)
        setSelectedFile(null)
        setPreviewUrl(null)
        setSuccess(language === 'zh-CN' ? '头像更新成功' : 'Avatar updated successfully')
      } else {
        const errData = await res.json()
        setError(errData.error || (language === 'zh-CN' ? '上传失败' : 'Upload failed'))
      }
    } catch (err) {
      setError(language === 'zh-CN' ? '上传失败' : 'Upload failed')
    } finally {
      setUploadingAvatar(false)
    }
  }

  const closeAvatarModal = () => {
    setShowAvatarModal(false)
    setSelectedFile(null)
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl)
      setPreviewUrl(null)
    }
    setError('')
  }

  const handlePasswordChange = async () => {
    setPasswordError('')
    
    if (!passwordData.oldPassword || !passwordData.newPassword || !passwordData.confirmPassword) {
      setPasswordError(language === 'zh-CN' ? '请填写所有字段' : 'Please fill in all fields')
      return
    }
    
    if (passwordData.newPassword.length < 6) {
      setPasswordError(language === 'zh-CN' ? '新密码至少需要 6 个字符' : 'New password must be at least 6 characters')
      return
    }
    
    if (passwordData.newPassword !== passwordData.confirmPassword) {
      setPasswordError(language === 'zh-CN' ? '两次输入的新密码不一致' : 'New passwords do not match')
      return
    }

    setChangingPassword(true)

    try {
      const token = localStorage.getItem('token')
      
      const encryptedOldPassword = await encryptPassword(passwordData.oldPassword)
      const encryptedNewPassword = await encryptPassword(passwordData.newPassword)
      
      const res = await fetch('/api/auth/password', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          oldPassword: encryptedOldPassword,
          newPassword: encryptedNewPassword
        })
      })

      if (res.ok) {
        setShowPasswordModal(false)
        setPasswordData({ oldPassword: '', newPassword: '', confirmPassword: '' })
        setSuccess(language === 'zh-CN' ? '密码修改成功' : 'Password changed successfully')
      } else {
        const errData = await res.json()
        setPasswordError(errData.error || (language === 'zh-CN' ? '修改失败' : 'Failed to change password'))
      }
    } catch (err) {
      setPasswordError(language === 'zh-CN' ? '修改失败' : 'Failed to change password')
    } finally {
      setChangingPassword(false)
    }
  }

  const closePasswordModal = () => {
    setShowPasswordModal(false)
    setPasswordData({ oldPassword: '', newPassword: '', confirmPassword: '' })
    setPasswordError('')
  }

  const getAvatarUrl = () => {
    if (profile?.avatar) {
      return profile.avatar.startsWith('http') ? profile.avatar : `/api/auth/avatar/${profile.avatar}`
    }
    return null
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
        <a
          href="/sso/info"
          target="_blank"
          rel="noopener noreferrer"
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
        </a>
        
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
            <div className="p-6">
              <h3 className="text-sm font-semibold uppercase tracking-wider mb-4" style={{ color: 'var(--color-text-tertiary)' }}>
                {language === 'zh-CN' ? '头像' : 'Avatar'}
              </h3>
              <div className="flex items-center gap-6">
                <button
                  onClick={() => setShowAvatarModal(true)}
                  className="relative group cursor-pointer"
                >
                  <div 
                    className="w-24 h-24 rounded-full overflow-hidden border-2 transition-all group-hover:border-[var(--color-accent-primary)]"
                    style={{ 
                      borderColor: 'var(--color-border-primary)',
                      backgroundColor: 'var(--color-bg-tertiary)'
                    }}
                  >
                    {getAvatarUrl() ? (
                      <img 
                        src={getAvatarUrl()!} 
                        alt="Avatar" 
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <User className="w-10 h-10" style={{ color: 'var(--color-text-muted)' }} />
                      </div>
                    )}
                  </div>
                  <div 
                    className="absolute inset-0 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)' }}
                  >
                    <Camera className="w-6 h-6 text-white" />
                  </div>
                </button>
                <div>
                  <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                    {language === 'zh-CN' ? '点击头像更换' : 'Click avatar to change'}
                  </p>
                  <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
                    {language === 'zh-CN' ? '支持 JPG、PNG、GIF，最大 5MB' : 'JPG, PNG, GIF supported, max 5MB'}
                  </p>
                </div>
              </div>
            </div>

            <div className="border-t" style={{ borderColor: 'var(--color-border-primary)' }} />

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
              
              <div className="mt-6 pt-4 border-t" style={{ borderColor: 'var(--color-border-primary)' }}>
                <div className="flex flex-wrap items-center gap-4">
                  <button
                    onClick={() => setShowPasswordModal(true)}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                    style={{ 
                      color: 'var(--color-text-primary)',
                      backgroundColor: 'var(--color-bg-tertiary)'
                    }}
                  >
                    <KeyRound className="w-4 h-4" />
                    {language === 'zh-CN' ? '修改密码' : 'Change Password'}
                  </button>
                  
                  <div 
                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm"
                    style={{ 
                      backgroundColor: profile.githubId 
                        ? 'rgba(34, 197, 94, 0.1)' 
                        : 'var(--color-bg-tertiary)',
                      border: profile.githubId 
                        ? '1px solid rgba(34, 197, 94, 0.3)' 
                        : '1px solid var(--color-border-primary)'
                    }}
                  >
                    <Github className="w-4 h-4" style={{ color: profile.githubId ? '#22c55e' : 'var(--color-text-muted)' }} />
                    <span style={{ color: profile.githubId ? '#22c55e' : 'var(--color-text-secondary)' }}>
                      {language === 'zh-CN' ? 'GitHub' : 'GitHub'}
                    </span>
                    {profile.githubId ? (
                      <>
                        <Check className="w-4 h-4" style={{ color: '#22c55e' }} />
                        <span className="text-xs" style={{ color: '#22c55e' }}>
                          {language === 'zh-CN' ? '已绑定' : 'Connected'}
                        </span>
                      </>
                    ) : (
                      <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                        {language === 'zh-CN' ? '未绑定' : 'Not connected'}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="border-t" style={{ borderColor: 'var(--color-border-primary)' }} />

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

      {showAvatarModal && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)' }}
          onClick={closeAvatarModal}
        >
          <div 
            className="rounded-xl shadow-2xl max-w-md w-full mx-4 overflow-hidden"
            style={{ backgroundColor: 'var(--color-bg-secondary)' }}
            onClick={e => e.stopPropagation()}
          >
            <div 
              className="px-6 py-4 border-b flex items-center justify-between"
              style={{ borderColor: 'var(--color-border-primary)' }}
            >
              <h3 className="text-lg font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                {language === 'zh-CN' ? '更换头像' : 'Change Avatar'}
              </h3>
              <button
                onClick={closeAvatarModal}
                className="p-1.5 rounded-lg transition-colors hover:bg-[var(--color-bg-tertiary)]"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileSelect}
                className="hidden"
              />

              <div 
                className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors hover:border-[var(--color-accent-primary)]"
                style={{ borderColor: 'var(--color-border-primary)' }}
                onClick={() => fileInputRef.current?.click()}
              >
                {previewUrl ? (
                  <div className="flex flex-col items-center">
                    <img 
                      src={previewUrl} 
                      alt="Preview" 
                      className="w-32 h-32 rounded-full object-cover mb-4"
                    />
                    <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                      {language === 'zh-CN' ? '点击重新选择' : 'Click to select another'}
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center">
                    <Camera className="w-12 h-12 mb-4" style={{ color: 'var(--color-text-muted)' }} />
                    <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                      {language === 'zh-CN' ? '点击选择图片' : 'Click to select image'}
                    </p>
                    <p className="text-xs mt-2" style={{ color: 'var(--color-text-muted)' }}>
                      {language === 'zh-CN' ? '支持 JPG、PNG、GIF，最大 5MB' : 'JPG, PNG, GIF supported, max 5MB'}
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div 
              className="px-6 py-4 border-t flex justify-end gap-3"
              style={{ borderColor: 'var(--color-border-primary)' }}
            >
              <button
                onClick={closeAvatarModal}
                className="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                style={{ 
                  color: 'var(--color-text-secondary)',
                  backgroundColor: 'var(--color-bg-tertiary)'
                }}
              >
                {t('cancel')}
              </button>
              <button
                onClick={handleAvatarUpload}
                disabled={!selectedFile || uploadingAvatar}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                style={{ backgroundColor: 'var(--color-accent-primary)', color: 'var(--color-accent-text)' }}
              >
                {uploadingAvatar ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {language === 'zh-CN' ? '上传中...' : 'Uploading...'}
                  </>
                ) : (
                  language === 'zh-CN' ? '确认上传' : 'Upload'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {showPasswordModal && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)' }}
          onClick={closePasswordModal}
        >
          <div 
            className="rounded-xl shadow-2xl max-w-md w-full mx-4 overflow-hidden"
            style={{ backgroundColor: 'var(--color-bg-secondary)' }}
            onClick={e => e.stopPropagation()}
          >
            <div 
              className="px-6 py-4 border-b flex items-center justify-between"
              style={{ borderColor: 'var(--color-border-primary)' }}
            >
              <h3 className="text-lg font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                {language === 'zh-CN' ? '修改密码' : 'Change Password'}
              </h3>
              <button
                onClick={closePasswordModal}
                className="p-1.5 rounded-lg transition-colors hover:bg-[var(--color-bg-tertiary)]"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {passwordError && (
                <div 
                  className="p-3 rounded-lg text-sm"
                  style={{ 
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    border: '1px solid rgba(239, 68, 68, 0.3)',
                    color: '#ef4444'
                  }}
                >
                  {passwordError}
                </div>
              )}
              
              <div>
                <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>
                  {language === 'zh-CN' ? '当前密码' : 'Current Password'}
                </label>
                <input
                  type="password"
                  value={passwordData.oldPassword}
                  onChange={(e) => setPasswordData({ ...passwordData, oldPassword: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border text-sm transition-colors focus:outline-none focus:ring-2"
                  style={{ 
                    backgroundColor: 'var(--color-bg-primary)',
                    borderColor: 'var(--color-border-primary)',
                    color: 'var(--color-text-primary)'
                  }}
                  placeholder="••••••••"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>
                  {language === 'zh-CN' ? '新密码' : 'New Password'}
                </label>
                <input
                  type="password"
                  value={passwordData.newPassword}
                  onChange={(e) => setPasswordData({ ...passwordData, newPassword: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border text-sm transition-colors focus:outline-none focus:ring-2"
                  style={{ 
                    backgroundColor: 'var(--color-bg-primary)',
                    borderColor: 'var(--color-border-primary)',
                    color: 'var(--color-text-primary)'
                  }}
                  placeholder="••••••••"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>
                  {language === 'zh-CN' ? '确认新密码' : 'Confirm New Password'}
                </label>
                <input
                  type="password"
                  value={passwordData.confirmPassword}
                  onChange={(e) => setPasswordData({ ...passwordData, confirmPassword: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border text-sm transition-colors focus:outline-none focus:ring-2"
                  style={{ 
                    backgroundColor: 'var(--color-bg-primary)',
                    borderColor: 'var(--color-border-primary)',
                    color: 'var(--color-text-primary)'
                  }}
                  placeholder="••••••••"
                />
              </div>
            </div>

            <div 
              className="px-6 py-4 border-t flex justify-end gap-3"
              style={{ borderColor: 'var(--color-border-primary)' }}
            >
              <button
                onClick={closePasswordModal}
                className="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                style={{ 
                  color: 'var(--color-text-secondary)',
                  backgroundColor: 'var(--color-bg-tertiary)'
                }}
              >
                {t('cancel')}
              </button>
              <button
                onClick={handlePasswordChange}
                disabled={changingPassword}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                style={{ backgroundColor: 'var(--color-accent-primary)', color: 'var(--color-accent-text)' }}
              >
                {changingPassword ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {language === 'zh-CN' ? '修改中...' : 'Changing...'}
                  </>
                ) : (
                  language === 'zh-CN' ? '确认修改' : 'Confirm'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  )
}
