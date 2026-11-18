/** Personal details and account security, styled to match the workspace. */
import { useState, useEffect, useRef } from 'react'
import { Save, Loader2, Pencil, X, Shield, Camera, UserRound, KeyRound, Github, Check, ArrowUpRight, AlertCircle, RefreshCw, Upload, Fingerprint, Plus, Trash2, Laptop } from 'lucide-react'
import { useI18n } from '../i18n/I18nContext'
import { useAuth } from '../contexts/AuthContext'
import { encryptPassword } from '../utils/rsa'
import {
  formatWebAuthnError,
  isPasskeySupported,
  isPlatformPasskeyAvailable,
  notifyUnknownCredential,
  registerWithPasskey
} from '../utils/passkey'
import ProfileDialog from '../components/ProfileDialog'
import ConfirmDialog from '../components/ConfirmDialog'
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

interface PasskeyItem {
  id: string
  credentialId: string
  name: string
  deviceType: string
  backedUp: boolean
  transports: string[]
  aaguid: string | null
  lastUsedAt: string | null
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
  const [passkeys, setPasskeys] = useState<PasskeyItem[]>([])
  const [passkeyLoginEnabled, setPasskeyLoginEnabled] = useState(false)
  const [webAuthnSupported, setWebAuthnSupported] = useState(true)
  const [platformAvailable, setPlatformAvailable] = useState(true)
  const [showCreatePasskeyModal, setShowCreatePasskeyModal] = useState(false)
  const [creatingPasskey, setCreatingPasskey] = useState(false)
  const [passkeyNameInput, setPasskeyNameInput] = useState('')
  const [authenticatorMode, setAuthenticatorMode] = useState<'platform' | 'all'>('platform')
  const [passkeyModalError, setPasskeyModalError] = useState('')
  const [editingPasskey, setEditingPasskey] = useState<PasskeyItem | null>(null)
  const [editPasskeyName, setEditPasskeyName] = useState('')
  const [renamingPasskey, setRenamingPasskey] = useState(false)
  const [renamePasskeyError, setRenamePasskeyError] = useState('')
  const [deletingPasskey, setDeletingPasskey] = useState<PasskeyItem | null>(null)
  const [deletingPasskeyBusy, setDeletingPasskeyBusy] = useState(false)

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
    loadFailed: '暂时无法加载个人资料', retry: '重新加载',
    passkeyTitle: 'Passkey（通行密钥）',
    passkeyDescription: '通过 MacBook Pro 密码 App、Touch ID 或安全密钥安全登录，无需输入密码。',
    passkeyCreate: '创建 Passkey',
    passkeyCreateTitle: '创建新的 Passkey',
    passkeyCreateDescription: '将弹出系统密码管理器或 Touch ID 验证窗口，完成后密钥会保存在你的账户中。',
    passkeyNameLabel: 'Passkey 名称（可选）',
    passkeyNamePlaceholder: '例如：MacBook Pro、公司电脑（留空自动识别）',
    passkeyModeLabel: '验证器类型',
    passkeyModePlatformTitle: '本机密码管理器 / Touch ID',
    passkeyModePlatformDesc: '优先调用 MacBook 密码 App（iCloud 钥匙串）或本机生物识别',
    passkeyModeAllTitle: '所有可用设备',
    passkeyModeAllDesc: '可选择手机扫码（跨设备）或 USB 安全密钥',
    passkeyCreating: '等待设备确认…',
    passkeyCreated: '已创建并保存 Passkey',
    passkeySynced: '同步钥匙串',
    passkeySingleDevice: '本机密钥',
    passkeyCreatedAt: '创建于',
    passkeyLastUsed: '最近使用',
    passkeyNeverUsed: '尚未使用',
    passkeyLoginOffHint: '当前管理员未开启登录页入口',
    passkeyRenameTitle: '重命名 Passkey',
    passkeyRenameDescription: '为该通行密钥设置一个便于识别的名称。',
    passkeyRenameSave: '保存名称',
    passkeyRenamed: '已更新 Passkey 名称',
    passkeyDeleteTitle: '删除 Passkey',
    passkeyDeleteDescription: '删除后，将无法再使用此通行密钥登录当前账户（建议同步在设备密码管理器中移除）。',
    passkeyDeleted: '已删除 Passkey'
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
    loadFailed: 'Your profile could not be loaded', retry: 'Try again',
    passkeyTitle: 'Passkeys',
    passkeyDescription: 'Sign in quickly using macOS Passwords, Touch ID, or a hardware security key without entering a password.',
    passkeyCreate: 'Create passkey',
    passkeyCreateTitle: 'Create a new Passkey',
    passkeyCreateDescription: 'Your browser will prompt your password manager or Touch ID to generate and save a key.',
    passkeyNameLabel: 'Passkey name (optional)',
    passkeyNamePlaceholder: 'e.g. MacBook Pro (leave blank to auto-detect)',
    passkeyModeLabel: 'Authenticator preference',
    passkeyModePlatformTitle: 'This device / Password Manager',
    passkeyModePlatformDesc: 'Prefer built-in macOS Passwords, iCloud Keychain, or Touch ID',
    passkeyModeAllTitle: 'Any device',
    passkeyModeAllDesc: 'Choose between this device, phone QR code, or USB security key',
    passkeyCreating: 'Waiting for authenticator…',
    passkeyCreated: 'Passkey created and saved',
    passkeySynced: 'Synced',
    passkeySingleDevice: 'Device-bound',
    passkeyCreatedAt: 'Added',
    passkeyLastUsed: 'Last used',
    passkeyNeverUsed: 'Never used',
    passkeyLoginOffHint: 'Sign-in option disabled by admin',
    passkeyRenameTitle: 'Rename Passkey',
    passkeyRenameDescription: 'Give this passkey a recognizable name.',
    passkeyRenameSave: 'Save name',
    passkeyRenamed: 'Passkey renamed',
    passkeyDeleteTitle: 'Delete Passkey',
    passkeyDeleteDescription: 'You will no longer be able to sign in with this passkey.',
    passkeyDeleted: 'Passkey deleted'
  }

  useEffect(() => {
    void fetchProfile()
    void fetchPasskeys()
    const supported = isPasskeySupported()
    setWebAuthnSupported(supported)
    if (supported) {
      isPlatformPasskeyAvailable()
        .then(available => {
          setPlatformAvailable(available)
          setAuthenticatorMode(available ? 'platform' : 'all')
        })
        .catch(() => {
          setPlatformAvailable(false)
          setAuthenticatorMode('all')
        })
    } else {
      setPlatformAvailable(false)
      setAuthenticatorMode('all')
    }
  }, [])

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

  const fetchPasskeys = async () => {
    try {
      const token = localStorage.getItem('token')
      const res = await fetch('/api/auth/passkeys', {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (!res.ok) return
      const data = await res.json()
      setPasskeys(Array.isArray(data.passkeys) ? data.passkeys : [])
      setPasskeyLoginEnabled(Boolean(data.passkeyLoginEnabled))
    } catch {
      // Keep profile usable even if passkey list fails to load
    }
  }

  const handleCreatePasskey = async (event: React.FormEvent) => {
    event.preventDefault()
    if (creatingPasskey) return
    if (!webAuthnSupported) {
      setPasskeyModalError(t('passkeyUnsupported'))
      return
    }
    setCreatingPasskey(true)
    setPasskeyModalError('')
    setError('')
    setSuccess('')

    try {
      const token = localStorage.getItem('token')
      const optionsRes = await fetch('/api/auth/passkeys/register/options', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ authenticatorMode })
      })
      const optionsPayload = await optionsRes.json()
      if (!optionsRes.ok) {
        throw new Error(optionsPayload.error || 'Failed to prepare passkey registration')
      }

      const registrationResponse = await registerWithPasskey(optionsPayload.options)

      const verifyRes = await fetch('/api/auth/passkeys/register/verify', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          challengeId: optionsPayload.challengeId,
          name: passkeyNameInput.trim() || undefined,
          response: registrationResponse
        })
      })
      const verifyPayload = await verifyRes.json()
      if (!verifyRes.ok) {
        throw new Error(verifyPayload.error || 'Failed to save passkey')
      }

      setPasskeys(previous => [verifyPayload.passkey, ...previous])
      setShowCreatePasskeyModal(false)
      setPasskeyNameInput('')
      setSuccess(copy.passkeyCreated)
    } catch (cause) {
      setPasskeyModalError(formatWebAuthnError(cause, t, zh))
    } finally {
      setCreatingPasskey(false)
    }
  }

  const closeCreatePasskeyModal = () => {
    if (creatingPasskey) return
    setShowCreatePasskeyModal(false)
    setPasskeyNameInput('')
    setPasskeyModalError('')
  }

  const openRenamePasskeyModal = (item: PasskeyItem) => {
    setEditingPasskey(item)
    setEditPasskeyName(item.name)
    setRenamePasskeyError('')
  }

  const closeRenamePasskeyModal = () => {
    if (renamingPasskey) return
    setEditingPasskey(null)
    setEditPasskeyName('')
    setRenamePasskeyError('')
  }

  const handleRenamePasskey = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!editingPasskey || renamingPasskey) return
    const trimmed = editPasskeyName.trim()
    if (!trimmed) return

    setRenamingPasskey(true)
    setRenamePasskeyError('')
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/auth/passkeys/${editingPasskey.id}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name: trimmed })
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || t('saveFailed'))
      }
      setPasskeys(previous => previous.map(pk => pk.id === editingPasskey.id ? data.passkey : pk))
      setEditingPasskey(null)
      setEditPasskeyName('')
      setSuccess(copy.passkeyRenamed)
    } catch (cause) {
      setRenamePasskeyError(cause instanceof Error ? cause.message : t('saveFailed'))
    } finally {
      setRenamingPasskey(false)
    }
  }

  const handleDeletePasskey = async () => {
    if (!deletingPasskey || deletingPasskeyBusy) return
    setDeletingPasskeyBusy(true)
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/auth/passkeys/${deletingPasskey.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || t('delete'))
      }
      if (data.credentialId) {
        void notifyUnknownCredential(data.credentialId)
      }
      setPasskeys(previous => previous.filter(pk => pk.id !== deletingPasskey.id))
      setDeletingPasskey(null)
      setSuccess(copy.passkeyDeleted)
    } finally {
      setDeletingPasskeyBusy(false)
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
                  <div className="profile-passkey-section">
                    <div className="profile-passkey-header">
                      <span className="profile-setting-icon" aria-hidden="true">
                        <Fingerprint size={17} strokeWidth={1.7} />
                      </span>
                      <div className="profile-setting-copy">
                        <h4>
                          {copy.passkeyTitle}
                          {passkeys.length > 0 && (
                            <span className="profile-status">
                              <Check size={11} />
                              {zh ? `${passkeys.length} 个已保存` : `${passkeys.length} saved`}
                            </span>
                          )}
                          {!passkeyLoginEnabled && (
                            <span className="profile-passkey-badge profile-passkey-badge--muted">
                              {copy.passkeyLoginOffHint}
                            </span>
                          )}
                        </h4>
                        <p>{copy.passkeyDescription}</p>
                        {!webAuthnSupported && (
                          <p role="alert" style={{ color: '#ef4444' }}>
                            {t('passkeyUnsupported')}
                          </p>
                        )}
                      </div>
                      <button
                        type="button"
                        className="profile-button profile-button--small"
                        disabled={!webAuthnSupported}
                        onClick={() => {
                          setPasskeyModalError('')
                          setPasskeyNameInput('')
                          setAuthenticatorMode(platformAvailable ? 'platform' : 'all')
                          setShowCreatePasskeyModal(true)
                        }}
                      >
                        <Plus size={14} />
                        {copy.passkeyCreate}
                      </button>
                    </div>
                    {passkeys.length > 0 && (
                      <div className="profile-passkey-list">
                        {passkeys.map(pk => {
                          const createdLabel = new Date(pk.createdAt).toLocaleDateString(language, {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric'
                          })
                          const lastUsedLabel = pk.lastUsedAt
                            ? new Date(pk.lastUsedAt).toLocaleDateString(language, {
                              year: 'numeric',
                              month: 'short',
                              day: 'numeric'
                            })
                            : copy.passkeyNeverUsed
                          const isPlatform = pk.transports.includes('internal') || pk.backedUp
                          return (
                            <div key={pk.id} className="profile-passkey-item">
                              <div className="profile-passkey-info">
                                <span className="profile-passkey-icon" aria-hidden="true">
                                  {isPlatform ? <Laptop size={15} /> : <KeyRound size={15} />}
                                </span>
                                <div className="profile-passkey-text">
                                  <div className="profile-passkey-name-row">
                                    <span className="profile-passkey-name">{pk.name}</span>
                                    <span className="profile-passkey-badge">
                                      {pk.backedUp ? copy.passkeySynced : copy.passkeySingleDevice}
                                    </span>
                                  </div>
                                  <div className="profile-passkey-meta">
                                    {`${copy.passkeyCreatedAt} ${createdLabel} · ${copy.passkeyLastUsed}: ${lastUsedLabel}`}
                                  </div>
                                </div>
                              </div>
                              <div className="profile-passkey-actions">
                                <button
                                  type="button"
                                  className="profile-icon-action"
                                  title={t('edit')}
                                  aria-label={`${t('edit')} ${pk.name}`}
                                  onClick={() => openRenamePasskeyModal(pk)}
                                >
                                  <Pencil size={14} />
                                </button>
                                <button
                                  type="button"
                                  className="profile-icon-action profile-icon-action--danger"
                                  title={t('delete')}
                                  aria-label={`${t('delete')} ${pk.name}`}
                                  onClick={() => setDeletingPasskey(pk)}
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            </div>
                          )
                        })}
                      </div>
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

      <ProfileDialog
        open={showCreatePasskeyModal}
        title={copy.passkeyCreateTitle}
        description={copy.passkeyCreateDescription}
        icon={<Fingerprint size={20} />}
        onClose={closeCreatePasskeyModal}
        busy={creatingPasskey}
        footer={(
          <>
            <button type="button" className="profile-button" onClick={closeCreatePasskeyModal} disabled={creatingPasskey}>
              {t('cancel')}
            </button>
            <button
              type="submit"
              form="profile-passkey-create-form"
              className="profile-button profile-button--primary"
              disabled={creatingPasskey}
            >
              {creatingPasskey ? <Loader2 size={15} className="animate-spin" /> : <Fingerprint size={15} />}
              {creatingPasskey ? copy.passkeyCreating : copy.passkeyCreate}
            </button>
          </>
        )}
      >
        <form id="profile-passkey-create-form" className="profile-form-grid" onSubmit={handleCreatePasskey}>
          {passkeyModalError && (
            <div className="profile-feedback profile-feedback--error profile-field--wide" role="alert">
              <AlertCircle size={16} />
              <span>{passkeyModalError}</span>
            </div>
          )}
          <div className="profile-field profile-field--wide">
            <label htmlFor="profile-passkey-name">{copy.passkeyNameLabel}</label>
            <input
              id="profile-passkey-name"
              type="text"
              className="profile-input"
              maxLength={64}
              placeholder={copy.passkeyNamePlaceholder}
              value={passkeyNameInput}
              onChange={event => setPasskeyNameInput(event.target.value)}
              disabled={creatingPasskey}
            />
          </div>
          <div className="profile-field profile-field--wide">
            <label>{copy.passkeyModeLabel}</label>
            <div className="profile-passkey-mode-grid">
              <button
                type="button"
                className={`profile-passkey-mode-option${authenticatorMode === 'platform' ? ' profile-passkey-mode-option--active' : ''}`}
                disabled={creatingPasskey}
                onClick={() => setAuthenticatorMode('platform')}
              >
                <span className="profile-passkey-mode-title">
                  <Laptop size={14} />
                  {copy.passkeyModePlatformTitle}
                </span>
                <span className="profile-passkey-mode-desc">{copy.passkeyModePlatformDesc}</span>
              </button>
              <button
                type="button"
                className={`profile-passkey-mode-option${authenticatorMode === 'all' ? ' profile-passkey-mode-option--active' : ''}`}
                disabled={creatingPasskey}
                onClick={() => setAuthenticatorMode('all')}
              >
                <span className="profile-passkey-mode-title">
                  <KeyRound size={14} />
                  {copy.passkeyModeAllTitle}
                </span>
                <span className="profile-passkey-mode-desc">{copy.passkeyModeAllDesc}</span>
              </button>
            </div>
          </div>
        </form>
      </ProfileDialog>

      <ProfileDialog
        open={Boolean(editingPasskey)}
        title={copy.passkeyRenameTitle}
        description={copy.passkeyRenameDescription}
        icon={<Pencil size={20} />}
        onClose={closeRenamePasskeyModal}
        busy={renamingPasskey}
        footer={(
          <>
            <button type="button" className="profile-button" onClick={closeRenamePasskeyModal} disabled={renamingPasskey}>
              {t('cancel')}
            </button>
            <button
              type="submit"
              form="profile-passkey-rename-form"
              className="profile-button profile-button--primary"
              disabled={!editPasskeyName.trim() || renamingPasskey}
            >
              {renamingPasskey ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
              {copy.passkeyRenameSave}
            </button>
          </>
        )}
      >
        <form id="profile-passkey-rename-form" className="profile-form-grid" onSubmit={handleRenamePasskey}>
          {renamePasskeyError && (
            <div className="profile-feedback profile-feedback--error profile-field--wide" role="alert">
              <AlertCircle size={16} />
              <span>{renamePasskeyError}</span>
            </div>
          )}
          <div className="profile-field profile-field--wide">
            <label htmlFor="profile-passkey-rename-input">{copy.passkeyNameLabel}</label>
            <input
              id="profile-passkey-rename-input"
              type="text"
              className="profile-input"
              maxLength={64}
              value={editPasskeyName}
              onChange={event => setEditPasskeyName(event.target.value)}
              required
              disabled={renamingPasskey}
            />
          </div>
        </form>
      </ProfileDialog>

      <ConfirmDialog
        open={Boolean(deletingPasskey)}
        title={copy.passkeyDeleteTitle}
        description={deletingPasskey ? `${deletingPasskey.name}: ${copy.passkeyDeleteDescription}` : copy.passkeyDeleteDescription}
        confirmLabel={t('delete')}
        cancelLabel={t('cancel')}
        busy={deletingPasskeyBusy}
        onConfirm={handleDeletePasskey}
        onCancel={() => {
          if (!deletingPasskeyBusy) setDeletingPasskey(null)
        }}
      />
    </>
  )
}
