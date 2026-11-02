/**
 * 融合邮件页面
 * 以三列响应式卡片展示已关联的外部邮箱账号，支持添加（OAuth2）、重新授权、移除与手动同步
 */
import { useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { AlertCircle, CheckCircle2, Loader2, Mail, Plus, RefreshCw, ShieldAlert, Trash2, X } from 'lucide-react'
import { useI18n } from '../i18n/I18nContext'
import ConfirmDialog from '../components/ConfirmDialog'
import { describeFusedError, needsReauth, parseFusedResult, platformLabel } from '../lib/fusedMail'

interface FusedAccount { id: string; platform: string; email: string; displayName?: string | null; status: string; lastError?: string | null; lastSyncedAt?: string | null; providerId?: string | null; unread: number }
interface FusedProvider { id: string; provider: string; displayName: string; platform: string | null }

const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}`, 'Content-Type': 'application/json' })

export default function FusedMailPage() {
  const { t, language } = useI18n()
  const zh = language === 'zh-CN'
  const location = useLocation()
  const navigate = useNavigate()
  const [accounts, setAccounts] = useState<FusedAccount[]>([])
  const [providers, setProviders] = useState<FusedProvider[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [picking, setPicking] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [removing, setRemoving] = useState<FusedAccount | null>(null)
  const [banner, setBanner] = useState<{ tone: 'success' | 'error'; message: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(false)
    try {
      const [accountsRes, providersRes] = await Promise.all([
        fetch('/api/fused-mail/accounts', { headers: authHeaders() }),
        fetch('/api/fused-mail/providers', { headers: authHeaders() })
      ])
      if (!accountsRes.ok || !providersRes.ok) throw new Error('load-failed')
      setAccounts((await accountsRes.json()).accounts || [])
      setProviders((await providersRes.json()).providers || [])
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  // OAuth 回调返回后展示结果，并清掉地址栏参数
  useEffect(() => {
    const result = parseFusedResult(location.search)
    if (!result) return
    setBanner(result.kind === 'error'
      ? { tone: 'error', message: `${t('fusedResultError')}：${describeFusedError(result, zh)}` }
      : { tone: 'success', message: result.kind === 'added' ? t('fusedResultAdded') : t('fusedResultReauthorized') })
    navigate('/fused-mail', { replace: true })
  }, [location.search, navigate, t, zh])

  const startOAuth = async (providerId: string, accountId?: string) => {
    setBusyId(accountId || providerId)
    try {
      const res = await fetch('/api/fused-mail/oauth/start', { method: 'POST', headers: authHeaders(), credentials: 'same-origin', body: JSON.stringify({ providerId, ...(accountId ? { accountId } : {}) }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.url) throw new Error(data.error || 'start-failed')
      window.location.assign(data.url)
    } catch (err) {
      setBanner({ tone: 'error', message: `${t('fusedResultError')}：${err instanceof Error ? err.message : ''}` })
      setBusyId(null)
    }
  }

  const reauthorize = (account: FusedAccount) => {
    const providerId = account.providerId && providers.some(p => p.id === account.providerId)
      ? account.providerId
      : providers.find(p => p.platform === account.platform)?.id
    if (!providerId) { setBanner({ tone: 'error', message: t('fusedNoProviders') }); return }
    void startOAuth(providerId, account.id)
  }

  const syncOne = async (account: FusedAccount) => {
    setBusyId(account.id)
    try {
      const res = await fetch(`/api/fused-mail/accounts/${encodeURIComponent(account.id)}/sync`, { method: 'POST', headers: authHeaders() })
      if (!res.ok) throw new Error('sync-failed')
      setBanner({ tone: 'success', message: t('fusedSyncDone') })
    } catch {
      setBanner({ tone: 'error', message: t('fusedSyncFailed') })
    } finally {
      setBusyId(null)
      void load()
    }
  }

  const remove = async () => {
    if (!removing) return false
    const res = await fetch(`/api/fused-mail/accounts/${encodeURIComponent(removing.id)}`, { method: 'DELETE', headers: authHeaders() })
    if (!res.ok) return false
    setRemoving(null)
    void load()
    return true
  }

  const formatTime = (value?: string | null) => value ? new Date(value).toLocaleString(language) : t('fusedNeverSynced')

  return (
    <div className="h-full overflow-auto p-4 sm:p-6">
      <div className="max-w-6xl mx-auto">
        <div className="mb-5">
          <h2 className="text-lg font-semibold" style={{ color: 'var(--color-text-primary)' }}>{t('fusedMail')}</h2>
          <p className="text-sm mt-1" style={{ color: 'var(--color-text-tertiary)' }}>{t('fusedMailDescription')}</p>
        </div>

        {banner && <div role={banner.tone === 'error' ? 'alert' : 'status'} className={`mb-4 flex items-center gap-2 rounded-lg px-4 py-3 text-sm ${banner.tone === 'error' ? 'bg-red-500/10 text-red-600' : ''}`} style={banner.tone === 'success' ? { background: 'var(--color-accent-muted)', color: 'var(--color-accent-primary)' } : undefined}>
          {banner.tone === 'error' ? <AlertCircle className="w-4 h-4 shrink-0" /> : <CheckCircle2 className="w-4 h-4 shrink-0" />}
          <span className="flex-1">{banner.message}</span>
          <button type="button" onClick={() => setBanner(null)} aria-label={t('close')} className="p-1"><X className="w-3.5 h-3.5" /></button>
        </div>}

        {loading ? <div role="status" className="flex items-center justify-center gap-2 py-16 text-sm" style={{ color: 'var(--color-text-tertiary)' }}><Loader2 className="w-5 h-5 animate-spin" />{t('fusedLoading')}</div>
          : loadError ? <div className="flex flex-col items-center gap-3 py-16 text-sm" style={{ color: 'var(--color-text-tertiary)' }}><AlertCircle className="w-6 h-6" />{t('fusedLoadFailed')}<button className="btn-secondary text-xs" onClick={() => void load()}><RefreshCw className="w-3.5 h-3.5 inline mr-1" />{zh ? '重试' : 'Retry'}</button></div>
          : <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {accounts.map(account => {
              const reauth = needsReauth(account.status)
              const busy = busyId === account.id
              return <article key={account.id} className="rounded-xl border p-4 flex flex-col gap-3" style={{ background: 'var(--color-bg-secondary)', borderColor: reauth ? 'rgb(239 68 68 / 0.5)' : 'var(--color-border-primary)' }}>
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'var(--color-accent-muted)', color: 'var(--color-accent-primary)' }}><Mail className="w-5 h-5" /></div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }} title={account.email}>{account.email}</div>
                    <div className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{platformLabel(account.platform)}{account.unread ? ` · ${account.unread} ${t('fusedUnread')}` : ''}</div>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${reauth ? 'bg-red-500/10 text-red-600' : 'bg-green-500/10 text-green-600'}`}>{reauth ? t('fusedNeedsReauth') : t('fusedStatusActive')}</span>
                </div>
                <div className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{t('fusedLastSync')}：{formatTime(account.lastSyncedAt)}</div>
                {account.lastError && <div className="text-xs text-red-600 break-words line-clamp-2" title={account.lastError}>{account.lastError}</div>}
                <div className="mt-auto flex flex-wrap gap-2 pt-1">
                  <button type="button" disabled={busy} onClick={() => reauthorize(account)} className={`flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium ${reauth ? 'bg-red-500 text-white' : ''}`} style={reauth ? undefined : { background: 'var(--color-bg-tertiary)', color: 'var(--color-text-secondary)' }}><ShieldAlert className="w-3.5 h-3.5" />{t('fusedReauthorize')}</button>
                  <button type="button" disabled={busy || reauth} onClick={() => void syncOne(account)} className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-50" style={{ background: 'var(--color-bg-tertiary)', color: 'var(--color-text-secondary)' }}>{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}{t('fusedSyncNow')}</button>
                  <button type="button" disabled={busy} onClick={() => setRemoving(account)} className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-500/10 ml-auto"><Trash2 className="w-3.5 h-3.5" />{t('fusedRemove')}</button>
                </div>
              </article>
            })}

            <article className="rounded-xl border-2 border-dashed p-4 flex flex-col items-center justify-center gap-3 min-h-[170px]" style={{ borderColor: 'var(--color-border-primary)' }}>
              {!picking ? <button type="button" onClick={() => setPicking(true)} className="flex flex-col items-center gap-2 text-sm font-medium" style={{ color: 'var(--color-accent-primary)' }}><Plus className="w-7 h-7" />{t('fusedAddAccount')}</button>
                : providers.length === 0 ? <p className="text-xs text-center" style={{ color: 'var(--color-text-tertiary)' }}>{t('fusedNoProviders')}</p>
                : <>
                  <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{t('fusedChoosePlatform')}</p>
                  <div className="flex flex-col gap-2 w-full">
                    {providers.map(provider => <button key={provider.id} type="button" disabled={!!busyId} onClick={() => void startOAuth(provider.id)} className="flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium" style={{ background: 'var(--color-bg-tertiary)', color: 'var(--color-text-primary)' }}>{busyId === provider.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}{provider.displayName || platformLabel(provider.platform)}<span className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>{platformLabel(provider.platform)}</span></button>)}
                  </div>
                  <button type="button" onClick={() => setPicking(false)} className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{t('cancel')}</button>
                </>}
            </article>
          </div>}
      </div>
      <ConfirmDialog open={!!removing} title={t('fusedRemove')} description={`${removing?.email || ''}\n${t('fusedRemoveConfirm')}`} confirmLabel={t('fusedRemove')} cancelLabel={t('cancel')} onConfirm={remove} onCancel={() => setRemoving(null)} />
    </div>
  )
}
