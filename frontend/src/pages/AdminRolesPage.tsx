/**
 * 管理员账户与权限管理页面
 * 查看当前邮件系统管理员，并支持按用户 ID 提权为管理员或降级为普通用户
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, Copy, Mail, RefreshCw, Search, Shield, ShieldCheck, UserMinus, UserPlus, Users } from 'lucide-react'
import ConfirmDialog from '../components/ConfirmDialog'
import { useAuth } from '../contexts/AuthContext'
import { useI18n } from '../i18n/I18nContext'

interface AdminUserSummary {
  id: string
  email: string
  username: string
  nickname: string | null
  avatar: string | null
  avatarUrl: string | null
  role: 'admin' | 'user' | string
  createdAt: string
}

interface PendingRoleChange {
  user: AdminUserSummary
  targetRole: 'admin' | 'user'
}

function getAuthHeaders(): HeadersInit {
  const token = localStorage.getItem('token')
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json'
  }
}

export default function AdminRolesPage({ embedded = false }: { embedded?: boolean }) {
  const { user: currentUser } = useAuth()
  const { t, language } = useI18n()
  const Heading = embedded ? 'h3' : 'h2'

  const [admins, setAdmins] = useState<AdminUserSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const [userIdInput, setUserIdInput] = useState('')
  const [lookingUp, setLookingUp] = useState(false)
  const [lookedUpUser, setLookedUpUser] = useState<AdminUserSummary | null>(null)
  const [pendingChange, setPendingChange] = useState<PendingRoleChange | null>(null)
  const [updatingRole, setUpdatingRole] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const mapBackendError = (message?: string): string => {
    switch (message) {
      case 'User not found':
        return t('adminUserNotFound')
      case 'Cannot demote your own account':
        return t('adminCannotDemoteSelf')
      case 'Cannot demote the last remaining administrator':
        return t('adminCannotDemoteLast')
      default:
        return message || t('saveFailed')
    }
  }

  const fetchAdmins = async (silent = false) => {
    if (silent) setRefreshing(true)
    else setLoading(true)

    try {
      const res = await fetch('/api/admin/admins', {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (res.status === 403) throw new Error(t('adminAccessDenied'))
        throw new Error(mapBackendError(data.error))
      }
      setAdmins(Array.isArray(data.admins) ? data.admins : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : t('settingsLoadFailed'))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    void fetchAdmins()
  }, [])

  const copyId = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id)
      setCopiedId(id)
      setTimeout(() => {
        setCopiedId(prev => (prev === id ? null : prev))
      }, 2000)
    } catch {
      // Clipboard may be blocked in insecure contexts
    }
  }

  const fetchUserById = async (rawId: string): Promise<AdminUserSummary | null> => {
    const trimmed = rawId.trim()
    if (!trimmed) return null

    const res = await fetch(`/api/admin/users/${encodeURIComponent(trimmed)}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(mapBackendError(data.error))
    }
    return data.user as AdminUserSummary
  }

  const handleLookup = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = userIdInput.trim()
    if (!trimmed || lookingUp) return

    setLookingUp(true)
    setError('')
    setSuccess('')
    try {
      const found = await fetchUserById(trimmed)
      setLookedUpUser(found)
    } catch (err) {
      setLookedUpUser(null)
      setError(err instanceof Error ? err.message : t('adminUserNotFound'))
    } finally {
      setLookingUp(false)
    }
  }

  const requestRoleChangeForId = async (targetRole: 'admin' | 'user') => {
    const trimmed = userIdInput.trim()
    if (!trimmed || lookingUp || updatingRole) return

    setError('')
    setSuccess('')

    let target = lookedUpUser && lookedUpUser.id === trimmed ? lookedUpUser : null
    if (!target) {
      setLookingUp(true)
      try {
        target = await fetchUserById(trimmed)
        setLookedUpUser(target)
      } catch (err) {
        setLookedUpUser(null)
        setError(err instanceof Error ? err.message : t('adminUserNotFound'))
        return
      } finally {
        setLookingUp(false)
      }
    }

    if (!target) return
    openConfirmForUser(target, targetRole)
  }

  const openConfirmForUser = (target: AdminUserSummary, targetRole: 'admin' | 'user') => {
    setError('')
    setSuccess('')

    if (target.role === targetRole) {
      setError(targetRole === 'admin' ? t('adminAlreadyAdmin') : t('adminAlreadyUser'))
      return
    }
    if (targetRole === 'user') {
      if (target.id === currentUser?.id) {
        setError(t('adminCannotDemoteSelf'))
        return
      }
      if (admins.length <= 1 && target.role === 'admin') {
        setError(t('adminCannotDemoteLast'))
        return
      }
    }

    setPendingChange({ user: target, targetRole })
  }

  const confirmRoleChange = async () => {
    if (!pendingChange || updatingRole) return
    const { user: target, targetRole } = pendingChange
    setUpdatingRole(true)
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(target.id)}/role`, {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify({ role: targetRole })
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(mapBackendError(data.error))
      }

      const updatedUser = data.user as AdminUserSummary
      if (lookedUpUser?.id === updatedUser.id) {
        setLookedUpUser(updatedUser)
      }
      await fetchAdmins(true)
      setPendingChange(null)
      setSuccess(targetRole === 'admin' ? t('adminPromoteSuccess') : t('adminDemoteSuccess'))
    } catch (err) {
      setPendingChange(null)
      setError(err instanceof Error ? err.message : t('saveFailed'))
    } finally {
      setUpdatingRole(false)
    }
  }

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString(language, {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      })
    } catch {
      return iso
    }
  }

  const renderAvatar = (item: AdminUserSummary) => {
    const initial = (item.nickname || item.username || item.email || '?').charAt(0).toUpperCase()
    if (item.avatarUrl) {
      return (
        <img
          src={item.avatarUrl}
          alt={item.nickname || item.username}
          className="w-10 h-10 rounded-full object-cover shrink-0 border"
          style={{ borderColor: 'var(--color-border-primary)' }}
        />
      )
    }
    return (
      <div
        className="w-10 h-10 rounded-full shrink-0 flex items-center justify-center text-sm font-semibold"
        style={{ backgroundColor: 'var(--color-accent-muted)', color: 'var(--color-accent-primary)' }}
        aria-hidden="true"
      >
        {initial}
      </div>
    )
  }

  return (
    <>
      <div className={embedded ? 'admin-panel' : 'flex-1 overflow-y-auto'} style={embedded ? undefined : { backgroundColor: 'var(--color-bg-primary)' }}>
        <div className={embedded ? 'admin-panel-content' : 'max-w-4xl mx-auto p-8'}>
          <div className={embedded ? 'admin-panel-header' : 'flex items-center justify-between mb-8 gap-4'}>
            <div>
              <Heading className={embedded ? 'admin-panel-title' : 'text-2xl font-bold flex items-center gap-2'} style={{ color: 'var(--color-text-primary)' }}>
                {!embedded && <Users className="w-7 h-7" style={{ color: 'var(--color-accent-primary)' }} />}
                {t('settingsAdminAccounts')}
              </Heading>
              <p className={embedded ? 'admin-panel-description' : 'mt-1'} style={{ color: 'var(--color-text-tertiary)' }}>
                {t('adminRolesDescription')}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void fetchAdmins(true)}
              disabled={loading || refreshing}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium border transition-colors disabled:opacity-50"
              style={{
                backgroundColor: 'var(--color-bg-secondary)',
                borderColor: 'var(--color-border-primary)',
                color: 'var(--color-text-secondary)'
              }}
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
              {t('refresh')}
            </button>
          </div>

          {error && (
            <div
              role="alert"
              className="mb-6 p-4 rounded-lg text-sm"
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
              role="status"
              className="mb-6 p-4 rounded-lg text-sm"
              style={{
                backgroundColor: 'rgba(34, 197, 94, 0.1)',
                border: '1px solid rgba(34, 197, 94, 0.3)',
                color: '#22c55e'
              }}
            >
              {success}
            </div>
          )}

          <div className="space-y-6">
            {/* 按用户 ID 提权 / 降级 */}
            <section
              className="rounded-xl border p-5 sm:p-6"
              style={{
                backgroundColor: 'var(--color-bg-secondary)',
                borderColor: 'var(--color-border-primary)'
              }}
            >
              <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
                <div>
                  <h4 className="text-base font-semibold flex items-center gap-2" style={{ color: 'var(--color-text-primary)' }}>
                    <Shield className="w-4 h-4" style={{ color: 'var(--color-accent-primary)' }} />
                    {t('adminPromoteUserTitle')}
                  </h4>
                  <p className="text-sm mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
                    {t('adminPromoteUserHint')}
                  </p>
                </div>
                <Link
                  to="/admin/settings?tab=database"
                  className="text-xs font-medium hover:underline shrink-0"
                  style={{ color: 'var(--color-accent-primary)' }}
                >
                  {t('adminOpenUsersTable')} →
                </Link>
              </div>

              <form onSubmit={handleLookup} className="flex flex-col sm:flex-row gap-3">
                <input
                  id="admin-target-user-id"
                  type="text"
                  value={userIdInput}
                  onChange={e => {
                    setUserIdInput(e.target.value)
                    if (lookedUpUser && lookedUpUser.id !== e.target.value.trim()) {
                      setLookedUpUser(null)
                    }
                  }}
                  placeholder={t('adminUserIdPlaceholder')}
                  className="flex-1 px-3.5 py-2 rounded-lg border text-sm font-mono"
                  style={{
                    backgroundColor: 'var(--color-bg-primary)',
                    borderColor: 'var(--color-border-primary)',
                    color: 'var(--color-text-primary)'
                  }}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="submit"
                    disabled={!userIdInput.trim() || lookingUp || updatingRole}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border text-sm font-medium transition-colors disabled:opacity-50"
                    style={{
                      backgroundColor: 'var(--color-bg-primary)',
                      borderColor: 'var(--color-border-primary)',
                      color: 'var(--color-text-primary)'
                    }}
                  >
                    <Search className="w-4 h-4" />
                    {t('adminLookupUser')}
                  </button>
                  <button
                    type="button"
                    disabled={!userIdInput.trim() || lookingUp || updatingRole}
                    onClick={() => void requestRoleChangeForId('admin')}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium transition-opacity disabled:opacity-50"
                    style={{
                      backgroundColor: 'var(--color-accent-primary)',
                      color: 'var(--color-accent-text)'
                    }}
                  >
                    <UserPlus className="w-4 h-4" />
                    {t('adminPromoteAction')}
                  </button>
                  <button
                    type="button"
                    disabled={!userIdInput.trim() || lookingUp || updatingRole}
                    onClick={() => void requestRoleChangeForId('user')}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border text-sm font-medium transition-colors disabled:opacity-50"
                    style={{
                      backgroundColor: 'var(--color-bg-primary)',
                      borderColor: 'rgba(239, 68, 68, 0.35)',
                      color: '#ef4444'
                    }}
                  >
                    <UserMinus className="w-4 h-4" />
                    {t('adminDemoteAction')}
                  </button>
                </div>
              </form>

              {lookedUpUser && (
                <div
                  className="mt-4 p-4 rounded-lg border flex flex-wrap items-center justify-between gap-4"
                  style={{
                    backgroundColor: 'var(--color-bg-primary)',
                    borderColor: 'var(--color-border-primary)'
                  }}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {renderAvatar(lookedUpUser)}
                    <div className="min-w-0">
                      <div className="flex items-center flex-wrap gap-2">
                        <span className="font-semibold text-sm" style={{ color: 'var(--color-text-primary)' }}>
                          {lookedUpUser.nickname || lookedUpUser.username}
                        </span>
                        <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                          @{lookedUpUser.username}
                        </span>
                        <span
                          className="px-2 py-0.5 rounded text-xs font-medium"
                          style={{
                            backgroundColor: lookedUpUser.role === 'admin' ? 'var(--color-accent-muted)' : 'var(--color-bg-tertiary)',
                            color: lookedUpUser.role === 'admin' ? 'var(--color-accent-primary)' : 'var(--color-text-muted)'
                          }}
                        >
                          {lookedUpUser.role === 'admin' ? t('adminRoleAdmin') : t('adminRoleUser')}
                        </span>
                      </div>
                      <div className="flex items-center flex-wrap gap-x-3 gap-y-1 mt-1 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                        <span className="inline-flex items-center gap-1">
                          <Mail className="w-3.5 h-3.5" />
                          {lookedUpUser.email}
                        </span>
                        <span className="font-mono">ID: {lookedUpUser.id}</span>
                      </div>
                    </div>
                  </div>
                  {lookedUpUser.role !== 'admin' ? (
                    <button
                      type="button"
                      onClick={() => openConfirmForUser(lookedUpUser, 'admin')}
                      disabled={updatingRole}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium"
                      style={{
                        backgroundColor: 'var(--color-accent-primary)',
                        color: 'var(--color-accent-text)'
                      }}
                    >
                      <UserPlus className="w-3.5 h-3.5" />
                      {t('adminPromoteAction')}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => openConfirmForUser(lookedUpUser, 'user')}
                      disabled={updatingRole || lookedUpUser.id === currentUser?.id || admins.length <= 1}
                      title={
                        lookedUpUser.id === currentUser?.id
                          ? t('adminCannotDemoteSelf')
                          : admins.length <= 1
                            ? t('adminCannotDemoteLast')
                            : t('adminDemoteAction')
                      }
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                      style={{
                        backgroundColor: 'var(--color-bg-secondary)',
                        borderColor: 'rgba(239, 68, 68, 0.35)',
                        color: '#ef4444'
                      }}
                    >
                      <UserMinus className="w-3.5 h-3.5" />
                      {t('adminDemoteAction')}
                    </button>
                  )}
                </div>
              )}
            </section>

            {/* 当前管理员列表 */}
            <section
              className="rounded-xl border p-5 sm:p-6"
              style={{
                backgroundColor: 'var(--color-bg-secondary)',
                borderColor: 'var(--color-border-primary)'
              }}
            >
              <div className="flex items-center justify-between gap-3 mb-4">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5" style={{ color: 'var(--color-accent-primary)' }} />
                  <h4 className="text-base font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                    {t('adminListTitle')}
                  </h4>
                  <span
                    className="px-2 py-0.5 rounded text-xs font-medium"
                    style={{
                      backgroundColor: 'var(--color-bg-tertiary)',
                      color: 'var(--color-text-secondary)'
                    }}
                  >
                    {admins.length} {t('adminCountLabel')}
                  </span>
                </div>
              </div>

              {loading ? (
                <div className="flex items-center justify-center py-10">
                  <div className="animate-spin rounded-full h-7 w-7 border-b-2" style={{ borderColor: 'var(--color-accent-primary)' }} />
                </div>
              ) : (
                <div className="space-y-3">
                  {admins.map(admin => {
                    const isSelf = admin.id === currentUser?.id
                    const disableDemote = isSelf || admins.length <= 1 || updatingRole
                    const demoteTitle = isSelf
                      ? t('adminCannotDemoteSelf')
                      : admins.length <= 1
                        ? t('adminCannotDemoteLast')
                        : t('adminDemoteAction')

                    return (
                      <div
                        key={admin.id}
                        className="p-4 rounded-lg border flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                        style={{
                          backgroundColor: 'var(--color-bg-primary)',
                          borderColor: isSelf ? 'var(--color-accent-primary)' : 'var(--color-border-primary)'
                        }}
                      >
                        <div className="flex items-start sm:items-center gap-3 min-w-0">
                          {renderAvatar(admin)}
                          <div className="min-w-0">
                            <div className="flex items-center flex-wrap gap-2">
                              <span className="font-semibold text-sm" style={{ color: 'var(--color-text-primary)' }}>
                                {admin.nickname || admin.username}
                              </span>
                              <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                                @{admin.username}
                              </span>
                              <span
                                className="px-2 py-0.5 rounded text-xs font-medium"
                                style={{
                                  backgroundColor: 'var(--color-accent-muted)',
                                  color: 'var(--color-accent-primary)'
                                }}
                              >
                                {t('adminRoleAdmin')}
                              </span>
                              {isSelf && (
                                <span
                                  className="px-2 py-0.5 rounded text-xs font-medium"
                                  style={{
                                    backgroundColor: 'rgba(34, 197, 94, 0.12)',
                                    color: '#22c55e'
                                  }}
                                >
                                  {t('adminCurrentSelf')}
                                </span>
                              )}
                            </div>

                            <div className="flex items-center flex-wrap gap-x-3 gap-y-1 mt-1 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                              <span className="inline-flex items-center gap-1 break-all">
                                <Mail className="w-3.5 h-3.5 shrink-0" />
                                {admin.email}
                              </span>
                              <span>{formatDate(admin.createdAt)}</span>
                            </div>

                            <div className="flex items-center gap-1.5 mt-1.5">
                              <code
                                className="px-2 py-0.5 rounded text-[11px] font-mono break-all"
                                style={{
                                  backgroundColor: 'var(--color-bg-secondary)',
                                  color: 'var(--color-text-secondary)'
                                }}
                              >
                                {admin.id}
                              </code>
                              <button
                                type="button"
                                onClick={() => void copyId(admin.id)}
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] transition-colors hover:bg-[var(--color-bg-tertiary)]"
                                style={{ color: copiedId === admin.id ? '#22c55e' : 'var(--color-text-tertiary)' }}
                                title={copiedId === admin.id ? t('adminCopiedId') : t('adminCopyId')}
                              >
                                {copiedId === admin.id ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                                {copiedId === admin.id ? t('adminCopiedId') : ''}
                              </button>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center justify-end shrink-0">
                          <button
                            type="button"
                            onClick={() => openConfirmForUser(admin, 'user')}
                            disabled={disableDemote}
                            title={demoteTitle}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors disabled:opacity-45 disabled:cursor-not-allowed"
                            style={{
                              backgroundColor: 'var(--color-bg-secondary)',
                              borderColor: 'rgba(239, 68, 68, 0.35)',
                              color: '#ef4444'
                            }}
                          >
                            <UserMinus className="w-3.5 h-3.5" />
                            {t('adminDemoteAction')}
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </section>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={Boolean(pendingChange)}
        title={pendingChange?.targetRole === 'admin' ? t('adminPromoteConfirmTitle') : t('adminDemoteConfirmTitle')}
        description={
          pendingChange
            ? `${pendingChange.targetRole === 'admin' ? t('adminPromoteConfirmDesc') : t('adminDemoteConfirmDesc')} (${pendingChange.user.username} · ${pendingChange.user.email} · ID: ${pendingChange.user.id})`
            : ''
        }
        confirmLabel={pendingChange?.targetRole === 'admin' ? t('adminPromoteAction') : t('adminDemoteAction')}
        cancelLabel={t('cancel')}
        busy={updatingRole}
        onConfirm={confirmRoleChange}
        onCancel={() => {
          if (!updatingRole) setPendingChange(null)
        }}
      />
    </>
  )
}
