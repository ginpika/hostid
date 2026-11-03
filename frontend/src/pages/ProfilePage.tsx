/** Personal details and account security, styled to match the workspace. */
import { useState, useEffect, useRef } from 'react'
import { Save, Loader2, Pencil, X, Shield, Camera, UserRound, KeyRound, Github, Check, ArrowUpRight, AlertCircle, RefreshCw, Upload } from 'lucide-react'
import { useI18n } from '../i18n/I18nContext'
import { useAuth } from '../contexts/AuthContext'
import { encryptPassword } from '../utils/rsa'
import ProfileDialog from '../components/ProfileDialog'
import '../styles/profile.css'

interface UserProfile {
  id: string
  email: string
  username: string
  nickname: string | null
  phone: string | null
  birthday: string | null
  avatar: string | null
  avatarUrl?: string | null
  language: string
  githubId: number | null
  hasPassword: boolean
  createdAt: string
}

export default function ProfilePage() {
  const { t, language } = useI18n()
  const { user, setUser } = useAuth()
  const zh = language === 'zh-CN'
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState(false)
  const [formData, setFormData] = useState({ nickname: '', phone: '', birthday: '' })
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [showAvatarModal, setShowAvatarModal] = useState(false)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [avatarError, setAvatarError] = useState('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const nicknameRef = useRef<HTMLInputElement>(null)
  const editButtonRef = useRef<HTMLButtonElement>(null)
  const [showPasswordModal, setShowPasswordModal] = useState(false)
  const [changingPassword, setChangingPassword] = useState(false)
  const [passwordData, setPasswordData] = useState({ oldPassword: '', newPassword: '', confirmPassword: '' })
  const [passwordError, setPasswordError] = useState('')

  const copy = zh ? {
    avatar: '更换头像', avatarHint: 'JPG、PNG、GIF、WebP，最大 2 MB',
    personalDescription: '让我们更好地认识你。', unset: '未填写',
    security: '登录与安全', securityDescription: '管理密码和关联的登录方式。',
    password: '账户密码', changePassword: '修改密码', setPassword: '设置密码',
    passwordDescription: '使用密码登录你的 HostID 账户。', noPassword: '设置密码后，也可以使用用户名和密码登录。',
    githubDescription: '使用 GitHub 账户快捷登录。', connected: '已关联', connect: '关联账户', viewAccount: '查看账户',
    currentPassword: '当前密码', newPassword: '新密码', confirmPassword: '确认新密码',
    passwordHint: '新密码至少需要 6 个字符。', passwordSaving: '保存中…',
    avatarDescription: '选择一张图片，作为你的账户头像。', selectImage: '选择图片', reselectImage: '重新选择图片',
    upload: '保存头像', uploading: '上传中…', preview: '新头像预览',
    loadFailed: '暂时无法加载个人资料', retry: '重新加载'
  } : {
    avatar: 'Change avatar', avatarHint: 'JPG, PNG, GIF or WebP, up to 2 MB',
    personalDescription: 'A little more about you.', unset: 'Not provided',
    security: 'Sign-in & security', securityDescription: 'Manage your password and connected accounts.',
    password: 'Account password', changePassword: 'Change password', setPassword: 'Set password',
    passwordDescription: 'Sign in to HostID with your password.', noPassword: 'Add a password to sign in with your username, too.',
    githubDescription: 'Sign in quickly with your GitHub account.', connected: 'Connected', connect: 'Connect account', viewAccount: 'View account',
    currentPassword: 'Current password', newPassword: 'New password', confirmPassword: 'Confirm new password',
    passwordHint: 'Use at least 6 characters for your new password.', passwordSaving: 'Saving…',
    avatarDescription: 'Choose an image for your account avatar.', selectImage: 'Choose an image', reselectImage: 'Choose another image',
    upload: 'Save avatar', uploading: 'Uploading…', preview: 'New avatar preview',
    loadFailed: 'Your profile could not be loaded', retry: 'Try again'
  }

  useEffect(() => { void fetchProfile() }, [])

  useEffect(() => {
    if (!selectedFile) { setPreviewUrl(null); return }
    const url = URL.createObjectURL(selectedFile)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [selectedFile])

  useEffect(() => {
    if (editing) nicknameRef.current?.focus()
  }, [editing])

  const fetchProfile = async () => {
    setLoading(true)
    setError('')
    try {
      const token = localStorage.getItem('token')
      const res = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) throw new Error(copy.loadFailed)
      const data: UserProfile = await res.json()
      setProfile(data)
      setFormData({ nickname: data.nickname || '', phone: data.phone || '', birthday: data.birthday || '' })
    } catch {
      setError(copy.loadFailed)
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      const token = localStorage.getItem('token')
      const res = await fetch('/api/auth/profile', {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      })
      if (!res.ok) throw new Error(t('saveFailed'))
      const data = await res.json()
      // The update response omits password and connected-account information.
      setProfile(previous => previous ? { ...previous, ...data } : previous)
      if (user) setUser({ ...user, nickname: data.nickname })
      setEditing(false)
      setSuccess(t('profileUpdated'))
      requestAnimationFrame(() => editButtonRef.current?.focus())
    } catch {
      setError(t('saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const handleCancel = () => {
    setFormData({ nickname: profile?.nickname || '', phone: profile?.phone || '', birthday: profile?.birthday || '' })
    setEditing(false)
    setError('')
    requestAnimationFrame(() => editButtonRef.current?.focus())
  }

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setSelectedFile(null)
    if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(file.type)) {
      setAvatarError(zh ? '请选择 JPG、PNG、GIF 或 WebP 图片' : 'Choose a JPG, PNG, GIF or WebP image')
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      setAvatarError(zh ? '图片大小不能超过 2 MB' : 'Image size cannot exceed 2 MB')
      return
    }
    setSelectedFile(file)
    setAvatarError('')
  }

  const handleAvatarUpload = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!selectedFile || uploadingAvatar) return
    setUploadingAvatar(true)
    setAvatarError('')
    setSuccess('')
    try {
      const body = new FormData()
      body.append('avatar', selectedFile)
      const token = localStorage.getItem('token')
      const res = await fetch('/api/auth/avatar', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || (zh ? '上传失败，请重试' : 'Upload failed. Please try again.'))
      setProfile(previous => previous ? { ...previous, avatar: data.avatar, avatarUrl: data.avatarUrl } : previous)
      if (user) setUser({ ...user, avatar: data.avatar, avatarUrl: data.avatarUrl })
      setShowAvatarModal(false)
      setSelectedFile(null)
      setSuccess(zh ? '头像已更新' : 'Avatar updated')
    } catch (cause) {
      setAvatarError(cause instanceof Error ? cause.message : (zh ? '上传失败，请重试' : 'Upload failed. Please try again.'))
    } finally {
      setUploadingAvatar(false)
    }
  }

  const closeAvatarModal = () => {
    if (uploadingAvatar) return
    setShowAvatarModal(false)
    setSelectedFile(null)
    setAvatarError('')
  }

  const handlePasswordChange = async (event: React.FormEvent) => {
    event.preventDefault()
    if (changingPassword) return
    setPasswordError('')
    if (profile?.hasPassword && !passwordData.oldPassword) {
      setPasswordError(zh ? '请输入当前密码' : 'Please enter your current password')
      return
    }
    if (passwordData.newPassword.length < 6) {
      setPasswordError(copy.passwordHint)
      return
    }
    if (passwordData.newPassword !== passwordData.confirmPassword) {
      setPasswordError(zh ? '两次输入的新密码不一致' : 'New passwords do not match')
      return
    }
    setChangingPassword(true)
    setSuccess('')
    try {
      const payload: { newPassword: string; oldPassword?: string } = { newPassword: await encryptPassword(passwordData.newPassword) }
      if (profile?.hasPassword) payload.oldPassword = await encryptPassword(passwordData.oldPassword)
      const token = localStorage.getItem('token')
      const res = await fetch('/api/auth/password', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || (zh ? '密码保存失败，请重试' : 'Could not save your password. Please try again.'))
      setProfile(previous => previous ? { ...previous, hasPassword: data.hasPassword ?? true } : previous)
      setShowPasswordModal(false)
      setPasswordData({ oldPassword: '', newPassword: '', confirmPassword: '' })
      setSuccess(profile?.hasPassword ? (zh ? '密码已修改' : 'Password changed') : (zh ? '密码已设置' : 'Password set'))
    } catch (cause) {
      setPasswordError(cause instanceof Error ? cause.message : (zh ? '密码保存失败，请重试' : 'Could not save your password. Please try again.'))
    } finally {
      setChangingPassword(false)
    }
  }

  const closePasswordModal = () => {
    if (changingPassword) return
    setShowPasswordModal(false)
    setPasswordData({ oldPassword: '', newPassword: '', confirmPassword: '' })
    setPasswordError('')
  }

  const handleGitHubClick = async () => {
    if (!profile?.githubId) return
    try {
      const res = await fetch(`https://api.github.com/user/${profile.githubId}`)
      if (!res.ok) return
      const data = await res.json()
      if (data.html_url) window.open(data.html_url, '_blank', 'noopener,noreferrer')
    } catch (cause) {
      console.error('Failed to fetch GitHub user info:', cause)
    }
  }

  if (loading || !profile) {
    return (
      <div className="profile-page">
        <div className="profile-empty" role={loading ? 'status' : 'alert'}>
          {loading ? <Loader2 size={26} className="animate-spin" /> : <AlertCircle size={28} />}
          <p>{loading ? t('loading') : error || t('profileNotFound')}</p>
          {!loading && (
            <button type="button" className="profile-button" onClick={() => void fetchProfile()}>
              <RefreshCw size={15} />
              {copy.retry}
            </button>
          )}
        </div>
      </div>
    )
  }

  const avatarUrl = profile.avatarUrl || (profile.avatar ? profile.avatar.startsWith('http') ? profile.avatar : `/api/auth/avatar/${profile.avatar}` : null)
  const passwordTitle = profile.hasPassword ? copy.changePassword : copy.setPassword
  const registeredDate = new Date(profile.createdAt).toLocaleDateString(language, { year: 'numeric', month: 'short', day: 'numeric' })

  return (
    <>
      <div className="profile-page">
        <div className="profile-shell">
          <header className="profile-heading">
            <div className="profile-heading-copy">
              <span className="profile-mark" aria-hidden="true">
                <UserRound size={24} strokeWidth={1.6} />
              </span>
              <div>
                <h2>{t('profile')}</h2>
                <p>{t('profileDescription')}</p>
              </div>
            </div>
            <a
              className="profile-heading-link"
              href="/sso/info"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Shield size={15} />
              {t('ssoInfo')}
              <ArrowUpRight size={14} />
            </a>
          </header>

          {error && (
            <div className="profile-feedback profile-feedback--error" role="alert">
              <AlertCircle size={17} />
              <span>{error}</span>
              <button type="button" onClick={() => setError('')} aria-label={t('close')}>
                <X size={16} />
              </button>
            </div>
          )}
          {success && (
            <div className="profile-feedback profile-feedback--success" role="status">
              <Check size={17} />
              <span>{success}</span>
              <button type="button" onClick={() => setSuccess('')} aria-label={t('close')}>
                <X size={16} />
              </button>
            </div>
          )}

          <div className="profile-layout">
            <aside className="profile-card profile-identity" aria-label={t('accountInfo')}>
              <button
                type="button"
                className="profile-avatar-button"
                onClick={() => setShowAvatarModal(true)}
                aria-label={copy.avatar}
              >
                <span className="profile-avatar">
                  {avatarUrl ? <img src={avatarUrl} alt="" /> : <UserRound size={36} strokeWidth={1.5} />}
                </span>
                <span className="profile-avatar-camera" aria-hidden="true">
                  <Camera size={14} />
                </span>
              </button>
              <h3 className="profile-identity-name">{profile.nickname || profile.username}</h3>
              <p className="profile-identity-handle">@{profile.username}</p>
              <dl className="profile-account-details">
                <div>
                  <dt>{t('username')}</dt>
                  <dd>{profile.username}</dd>
                </div>
                <div>
                  <dt>{t('email')}</dt>
                  <dd>{profile.email}</dd>
                </div>
                <div>
                  <dt>{t('registeredAt')}</dt>
                  <dd><time dateTime={profile.createdAt}>{registeredDate}</time></dd>
                </div>
              </dl>
            </aside>

            <div className="profile-content">
              <section className="profile-card" aria-labelledby="profile-personal-title">
                <header className="profile-section-heading">
                  <span className="profile-section-icon" aria-hidden="true">
                    <UserRound size={19} />
                  </span>
                  <div>
                    <h3 id="profile-personal-title">{t('personalInfo')}</h3>
                    <p>{copy.personalDescription}</p>
                  </div>
                  {!editing && (
                    <button
                      ref={editButtonRef}
                      type="button"
                      className="profile-button profile-button--quiet profile-button--small"
                      onClick={() => { setEditing(true); setSuccess('') }}
                    >
                      <Pencil size={14} />
                      {t('edit')}
                    </button>
                  )}
                </header>
                <form onSubmit={handleSave} aria-label={t('personalInfo')}>
                  <div className="profile-form-grid">
                    <div className="profile-field profile-field--wide">
                      {editing ? (
                        <>
                          <label htmlFor="profile-nickname">{t('nickname')}</label>
                          <input
                            ref={nicknameRef}
                            id="profile-nickname"
                            className="profile-input"
                            autoComplete="nickname"
                            maxLength={50}
                            value={formData.nickname}
                            onChange={event => setFormData({ ...formData, nickname: event.target.value })}
                            placeholder={t('nicknamePlaceholder')}
                            disabled={saving}
                          />
                        </>
                      ) : (
                        <>
                          <span>{t('nickname')}</span>
                          <p className={`profile-field-value${profile.nickname ? '' : ' profile-field-empty'}`}>
                            {profile.nickname || copy.unset}
                          </p>
                        </>
                      )}
                    </div>
                    <div className="profile-field">
                      {editing ? (
                        <>
                          <label htmlFor="profile-phone">{t('phone')}</label>
                          <input
                            id="profile-phone"
                            type="tel"
                            className="profile-input"
                            autoComplete="tel"
                            maxLength={20}
                            value={formData.phone}
                            onChange={event => setFormData({ ...formData, phone: event.target.value })}
                            placeholder={t('phonePlaceholder')}
                            disabled={saving}
                          />
                        </>
                      ) : (
                        <>
                          <span>{t('phone')}</span>
                          <p className={`profile-field-value${profile.phone ? '' : ' profile-field-empty'}`}>
                            {profile.phone || copy.unset}
                          </p>
                        </>
                      )}
                    </div>
                    <div className="profile-field">
                      {editing ? (
                        <>
                          <label htmlFor="profile-birthday">{t('birthday')}</label>
                          <input
                            id="profile-birthday"
                            type="date"
                            className="profile-input"
                            autoComplete="bday"
                            value={formData.birthday}
                            onChange={event => setFormData({ ...formData, birthday: event.target.value })}
                            disabled={saving}
                          />
                        </>
                      ) : (
                        <>
                          <span>{t('birthday')}</span>
                          <p className={`profile-field-value${profile.birthday ? '' : ' profile-field-empty'}`}>
                            {profile.birthday || copy.unset}
                          </p>
                        </>
                      )}
                    </div>
                  </div>
                  {editing && (
                    <div className="profile-form-actions">
                      <button type="button" className="profile-button" onClick={handleCancel} disabled={saving}>
                        {t('cancel')}
                      </button>
                      <button type="submit" className="profile-button profile-button--primary" disabled={saving}>
                        {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                        {t(saving ? 'saving' : 'save')}
                      </button>
                    </div>
                  )}
                </form>
              </section>

              <section className="profile-card" aria-labelledby="profile-security-title">
                <header className="profile-section-heading">
                  <span className="profile-section-icon" aria-hidden="true">
                    <Shield size={19} />
                  </span>
                  <div>
                    <h3 id="profile-security-title">{copy.security}</h3>
                    <p>{copy.securityDescription}</p>
                  </div>
                </header>
                <div className="profile-settings-list">
                  <div className="profile-setting-row">
                    <span className="profile-setting-icon" aria-hidden="true">
                      <KeyRound size={17} strokeWidth={1.7} />
                    </span>
                    <div className="profile-setting-copy">
                      <h4>{copy.password}</h4>
                      <p>{profile.hasPassword ? copy.passwordDescription : copy.noPassword}</p>
                    </div>
                    <button
                      type="button"
                      className="profile-button profile-button--small"
                      onClick={() => setShowPasswordModal(true)}
                    >
                      {passwordTitle}
                    </button>
                  </div>
                  <div className="profile-setting-row">
                    <span className="profile-setting-icon" aria-hidden="true">
                      <Github size={17} strokeWidth={1.7} />
                    </span>
                    <div className="profile-setting-copy">
                      <h4>
                        {'GitHub '}
                        {profile.githubId && (
                          <span className="profile-status">
                            <Check size={11} />
                            {copy.connected}
                          </span>
                        )}
                      </h4>
                      <p>{copy.githubDescription}</p>
                    </div>
                    {profile.githubId ? (
                      <button type="button" className="profile-button profile-button--small" onClick={handleGitHubClick}>
                        {copy.viewAccount}
                        <ArrowUpRight size={13} />
                      </button>
                    ) : (
                      <a
                        className="profile-button profile-button--small"
                        href={`/api/oauth/github?redirect=${encodeURIComponent('/profile')}`}
                      >
                        {copy.connect}
                        <ArrowUpRight size={13} />
                      </a>
                    )}
                  </div>
                </div>
              </section>
            </div>
          </div>
        </div>
      </div>

      <ProfileDialog
        open={showAvatarModal}
        title={copy.avatar}
        description={copy.avatarDescription}
        icon={<Camera size={20} />}
        onClose={closeAvatarModal}
        busy={uploadingAvatar}
        footer={(
          <>
            <button type="button" className="profile-button" onClick={closeAvatarModal} disabled={uploadingAvatar}>
              {t('cancel')}
            </button>
            <button
              type="submit"
              form="profile-avatar-form"
              className="profile-button profile-button--primary"
              disabled={!selectedFile || uploadingAvatar}
            >
              {uploadingAvatar ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
              {uploadingAvatar ? copy.uploading : copy.upload}
            </button>
          </>
        )}
      >
        <form id="profile-avatar-form" onSubmit={handleAvatarUpload}>
          {avatarError && (
            <div className="profile-feedback profile-feedback--error" role="alert">
              <AlertCircle size={16} />
              <span>{avatarError}</span>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            onChange={handleFileSelect}
            hidden
            disabled={uploadingAvatar}
            aria-label={copy.selectImage}
          />
          <button
            type="button"
            className="profile-upload-button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadingAvatar}
          >
            {previewUrl ? (
              <img className="profile-upload-preview" src={previewUrl} alt={copy.preview} />
            ) : (
              <span className="profile-avatar">
                {avatarUrl ? <img src={avatarUrl} alt="" /> : <Camera size={30} strokeWidth={1.5} />}
              </span>
            )}
            <span>{selectedFile ? copy.reselectImage : copy.selectImage}</span>
            <span className="profile-upload-hint">{selectedFile?.name || copy.avatarHint}</span>
          </button>
        </form>
      </ProfileDialog>

      <ProfileDialog
        open={showPasswordModal}
        title={passwordTitle}
        description={copy.passwordHint}
        icon={<KeyRound size={20} />}
        onClose={closePasswordModal}
        busy={changingPassword}
        footer={(
          <>
            <button type="button" className="profile-button" onClick={closePasswordModal} disabled={changingPassword}>
              {t('cancel')}
            </button>
            <button
              type="submit"
              form="profile-password-form"
              className="profile-button profile-button--primary"
              disabled={changingPassword}
            >
              {changingPassword ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
              {changingPassword ? copy.passwordSaving : passwordTitle}
            </button>
          </>
        )}
      >
        <form id="profile-password-form" className="profile-form-grid" onSubmit={handlePasswordChange}>
          {passwordError && (
            <div className="profile-feedback profile-feedback--error profile-field--wide" role="alert">
              <AlertCircle size={16} />
              <span>{passwordError}</span>
            </div>
          )}
          {profile.hasPassword && (
            <div className="profile-field profile-field--wide">
              <label htmlFor="profile-current-password">{copy.currentPassword}</label>
              <input
                id="profile-current-password"
                type="password"
                className="profile-input"
                autoComplete="current-password"
                value={passwordData.oldPassword}
                onChange={event => setPasswordData({ ...passwordData, oldPassword: event.target.value })}
                required
                disabled={changingPassword}
              />
            </div>
          )}
          <div className="profile-field profile-field--wide">
            <label htmlFor="profile-new-password">{copy.newPassword}</label>
            <input
              id="profile-new-password"
              type="password"
              className="profile-input"
              autoComplete="new-password"
              minLength={6}
              value={passwordData.newPassword}
              onChange={event => setPasswordData({ ...passwordData, newPassword: event.target.value })}
              required
              disabled={changingPassword}
            />
          </div>
          <div className="profile-field profile-field--wide">
            <label htmlFor="profile-confirm-password">{copy.confirmPassword}</label>
            <input
              id="profile-confirm-password"
              type="password"
              className="profile-input"
              autoComplete="new-password"
              minLength={6}
              value={passwordData.confirmPassword}
              onChange={event => setPasswordData({ ...passwordData, confirmPassword: event.target.value })}
              required
              disabled={changingPassword}
            />
          </div>
        </form>
      </ProfileDialog>
    </>
  )
}
