/**
 * 系统设置页面（管理员）
 * 站点 / 邮件 / SMTP 中继 / 人机验证 / SSO
 * 敏感值只写：服务端仅返回打码值，留空表示保持不变
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Settings, Save, Upload, RotateCcw, Loader2 } from 'lucide-react'
import { useI18n } from '../i18n/I18nContext'
import { useConfig } from '../contexts/ConfigContext'
import { translations } from '../i18n/translations'
import BrandMark from '../components/BrandMark'

type TKey = keyof typeof translations['zh-CN']
type Group = 'site' | 'mail' | 'smtp' | 'turnstile' | 'sso'

interface SettingView {
  key: string
  group: Group
  type: 'string' | 'number' | 'boolean' | 'enum'
  secret: boolean
  options?: string[]
  value: string | number | boolean
  configured?: boolean
  source: 'database' | 'env' | 'default'
  default: string | number | boolean
}

const GROUPS: { id: Group; label: TKey }[] = [
  { id: 'site', label: 'settingsGroupSite' },
  { id: 'mail', label: 'settingsGroupMail' },
  { id: 'smtp', label: 'settingsGroupSmtp' },
  { id: 'turnstile', label: 'settingsGroupTurnstile' },
  { id: 'sso', label: 'settingsGroupSso' }
]

const MAX_SITE_ICON_BYTES = 2 * 1024 * 1024
const ALLOWED_ICON_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/x-icon',
  'image/vnd.microsoft.icon',
  'image/svg+xml'
])
const ALLOWED_ICON_EXT_RE = /\.(png|jpe?g|gif|webp|ico|svg)$/i

const labelKey = (key: string) => `setting${key[0].toUpperCase()}${key.slice(1)}` as TKey
const hintKey = (key: string) => `${labelKey(key)}Hint` as TKey

const inputStyle = {
  backgroundColor: 'var(--color-bg-primary)',
  borderColor: 'var(--color-border-primary)',
  color: 'var(--color-text-primary)'
}

export default function SystemSettingsPage({ embedded = false }: { embedded?: boolean }) {
  const { t, language } = useI18n()
  const { siteIconUrl, setSiteBranding } = useConfig()
  const Heading = embedded ? 'h3' : 'h2'
  const [settings, setSettings] = useState<SettingView[]>([])
  const [form, setForm] = useState<Record<string, string | number | boolean | null>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [siteIconBusy, setSiteIconBusy] = useState<'upload' | 'reset' | null>(null)
  const [siteIconError, setSiteIconError] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const siteIconInputRef = useRef<HTMLInputElement>(null)

  const zh = translations['zh-CN'] as Record<string, string>
  const has = (key: string) => key in zh

  const applyView = (view: SettingView[]) => {
    setSettings(view)
    const next: Record<string, string | number | boolean | null> = {}
    for (const s of view) next[s.key] = s.secret ? '' : s.value
    setForm(next)
  }

  const request = async (method: 'GET' | 'PUT', body?: unknown) => {
    const token = localStorage.getItem('token')
    const res = await fetch('/api/admin/settings', {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(res.status === 403 ? t('adminAccessDenied') : (data.error || `HTTP ${res.status}`))
    return data.settings as SettingView[]
  }

  useEffect(() => {
    request('GET')
      .then(applyView)
      .catch(err => setError(`${t('settingsLoadFailed')}: ${err.message}`))
      .finally(() => setLoading(false))
  }, [])

  const grouped = useMemo(() => GROUPS.map(g => ({ ...g, items: settings.filter(s => s.group === g.id) })), [settings])
  // Use saved settings; an empty password input keeps the existing secret.
  const usesSmtpRelay = Boolean(
    settings.find(s => s.key === 'smtpRelayHost')?.value &&
    settings.find(s => s.key === 'smtpRelayUser')?.value &&
    settings.find(s => s.key === 'smtpRelayPass')?.configured
  )

  const applySiteIconResponse = (data: { branding?: { siteName?: string; siteSlogan?: string; siteIconUrl?: string }; settings?: SettingView[] }) => {
    if (Array.isArray(data.settings)) {
      setSettings(data.settings)
      const nextSiteIcon = data.settings.find(s => s.key === 'siteIcon')?.value
      setForm(prev => ({ ...prev, siteIcon: typeof nextSiteIcon === 'string' ? nextSiteIcon : '' }))
    }
    if (data.branding) {
      setSiteBranding(data.branding)
    }
  }

  const handleSiteIconSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || siteIconBusy) return

    setSiteIconError('')
    setError('')
    setSuccess('')

    if (!ALLOWED_ICON_TYPES.has(file.type) && !ALLOWED_ICON_EXT_RE.test(file.name)) {
      setSiteIconError(t('settingSiteIconInvalidType'))
      return
    }
    if (file.size > MAX_SITE_ICON_BYTES) {
      setSiteIconError(t('settingSiteIconTooLarge'))
      return
    }

    setSiteIconBusy('upload')
    try {
      const body = new FormData()
      body.append('icon', file)
      const token = localStorage.getItem('token')
      const res = await fetch('/api/admin/site-icon', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(res.status === 403 ? t('adminAccessDenied') : (data.error || `HTTP ${res.status}`))
      }
      applySiteIconResponse(data)
      setSuccess(t('settingSiteIconSaved'))
    } catch (err) {
      setSiteIconError(err instanceof Error ? err.message : String(err))
    } finally {
      setSiteIconBusy(null)
    }
  }

  const handleSiteIconReset = async () => {
    if (siteIconBusy) return
    setSiteIconError('')
    setError('')
    setSuccess('')
    setSiteIconBusy('reset')
    try {
      const token = localStorage.getItem('token')
      const res = await fetch('/api/admin/site-icon', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(res.status === 403 ? t('adminAccessDenied') : (data.error || `HTTP ${res.status}`))
      }
      applySiteIconResponse(data)
      setSuccess(t('settingSiteIconResetDone'))
    } catch (err) {
      setSiteIconError(err instanceof Error ? err.message : String(err))
    } finally {
      setSiteIconBusy(null)
    }
  }

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      const payload: Record<string, unknown> = {}
      for (const s of settings) {
        if (s.key === 'siteIcon') continue
        const v = form[s.key]
        if (s.secret) {
          if (v === null) payload[s.key] = null
          else if (typeof v === 'string' && v !== '') payload[s.key] = v
        } else if (v !== s.value) {
          payload[s.key] = v
        }
      }
      const updated = await request('PUT', payload)
      applyView(updated)
      const nextSiteName = updated.find(s => s.key === 'siteName')?.value
      const nextSiteSlogan = updated.find(s => s.key === 'siteSlogan')?.value
      setSiteBranding({
        siteName: typeof nextSiteName === 'string' ? nextSiteName : undefined,
        siteSlogan: typeof nextSiteSlogan === 'string' ? nextSiteSlogan : undefined
      })
      setSuccess(t('settingsSaved'))
    } catch (err) {
      setError(`${t('settingsSaveFailed')}: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSaving(false)
    }
  }

  const renderField = (s: SettingView) => {
    const id = `setting-${s.key}`
    const value = form[s.key]
    const label = has(labelKey(s.key)) ? t(labelKey(s.key)) : s.key
    const hint = has(hintKey(s.key)) ? t(hintKey(s.key)) : ''

    if (s.key === 'siteIcon') {
      const hasCustomSiteIcon = Boolean(String(s.value || '').trim() || siteIconUrl)
      return (
        <div key={s.key} className="col-span-full">
          <div className="text-sm font-medium mb-1.5 flex items-center gap-2" style={{ color: 'var(--color-text-secondary)' }}>
            <label htmlFor={id}>{label}</label>
            <span
              className="px-1.5 py-0.5 rounded text-xs"
              style={hasCustomSiteIcon ? {
                backgroundColor: 'var(--color-accent-muted)',
                color: 'var(--color-accent-primary)'
              } : {
                backgroundColor: 'var(--color-bg-tertiary)',
                color: 'var(--color-text-muted)'
              }}
            >
              {hasCustomSiteIcon ? t('settingSiteIconCustom') : t('settingSiteIconDefault')}
            </span>
          </div>
          <div
            className="rounded-lg border p-4 flex flex-wrap items-center gap-4"
            style={{
              backgroundColor: 'var(--color-bg-primary)',
              borderColor: 'var(--color-border-primary)'
            }}
          >
            <div
              className="w-14 h-14 rounded-xl border flex items-center justify-center overflow-hidden shrink-0"
              style={{
                backgroundColor: 'var(--color-bg-secondary)',
                borderColor: 'var(--color-border-primary)'
              }}
            >
              <BrandMark size={44} className="w-11 h-11" label={label} />
            </div>
            <div className="flex-1 min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2.5">
                <input
                  ref={siteIconInputRef}
                  id={id}
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp,image/x-icon,image/vnd.microsoft.icon,image/svg+xml,.png,.jpg,.jpeg,.gif,.webp,.ico,.svg"
                  onChange={handleSiteIconSelect}
                  className="hidden"
                />
                <button
                  type="button"
                  disabled={siteIconBusy !== null || saving}
                  onClick={() => siteIconInputRef.current?.click()}
                  className="admin-site-icon-btn inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{
                    backgroundColor: 'var(--color-bg-secondary)',
                    borderColor: 'var(--color-border-primary)',
                    color: 'var(--color-text-primary)'
                  }}
                >
                  {siteIconBusy === 'upload'
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                    : <Upload className="w-3.5 h-3.5" aria-hidden="true" />}
                  <span>
                    {siteIconBusy === 'upload'
                      ? t('settingSiteIconUploading')
                      : hasCustomSiteIcon ? t('settingSiteIconReplace') : t('settingSiteIconUpload')}
                  </span>
                </button>
                <button
                  type="button"
                  disabled={!hasCustomSiteIcon || siteIconBusy !== null || saving}
                  onClick={() => void handleSiteIconReset()}
                  className="admin-site-icon-btn inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors disabled:opacity-45 disabled:cursor-not-allowed"
                  style={{
                    backgroundColor: 'var(--color-bg-tertiary)',
                    borderColor: 'var(--color-border-primary)',
                    color: 'var(--color-text-secondary)'
                  }}
                >
                  {siteIconBusy === 'reset'
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                    : <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />}
                  <span>{siteIconBusy === 'reset' ? t('settingSiteIconResetting') : t('settingSiteIconReset')}</span>
                </button>
              </div>
              {hint && <p className="text-xs leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>{hint}</p>}
              {siteIconError && (
                <p role="alert" className="text-xs font-medium" style={{ color: '#ef4444' }}>{siteIconError}</p>
              )}
            </div>
          </div>
        </div>
      )
    }

    let control: React.ReactNode
    if (s.type === 'boolean') {
      control = (
        <input id={id} type="checkbox" checked={!!value}
          onChange={e => setForm({ ...form, [s.key]: e.target.checked })} className="w-4 h-4" />
      )
    } else if (s.type === 'enum') {
      control = (
        <select id={id} value={String(value ?? '')} onChange={e => setForm({ ...form, [s.key]: e.target.value })}
          className="w-full px-3 py-2 rounded-lg border text-sm" style={inputStyle}>
          {(s.options || []).map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      )
    } else if (s.secret) {
      control = (
        <div className="flex items-center gap-2">
          <input id={id} type="password" autoComplete="new-password" value={value === null ? '' : String(value ?? '')}
            disabled={value === null}
            placeholder={s.configured ? `${s.value} · ${t('settingsSecretPlaceholder')}` : t('settingsSecretNotConfigured')}
            onChange={e => setForm({ ...form, [s.key]: e.target.value })}
            className="flex-1 px-3 py-2 rounded-lg border text-sm font-mono" style={inputStyle} />
          {s.configured && (
            <label className="flex items-center gap-1 text-xs whitespace-nowrap" style={{ color: 'var(--color-text-tertiary)' }}>
              <input type="checkbox" checked={value === null}
                onChange={e => setForm({ ...form, [s.key]: e.target.checked ? null : '' })} />
              {t('settingsSecretClear')}
            </label>
          )}
        </div>
      )
    } else {
      const placeholder = s.key === 'siteSlogan'
        ? t('settingSiteSloganPlaceholder')
        : s.default !== '' ? String(s.default) : undefined
      const maxLength = s.key === 'siteName' ? 64 : s.key === 'siteSlogan' ? 120 : undefined
      control = (
        <input id={id} type={s.type === 'number' ? 'number' : 'text'} value={String(value ?? '')}
          placeholder={placeholder}
          maxLength={maxLength}
          onChange={e => setForm({ ...form, [s.key]: s.type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value })}
          className="w-full px-3 py-2 rounded-lg border text-sm font-mono" style={inputStyle} />
      )
    }

    return (
      <div key={s.key} className={s.type === 'boolean' ? 'flex items-center gap-3' : ''}>
        {s.type === 'boolean' && control}
        <label htmlFor={id} className={`text-sm font-medium ${s.type === 'boolean' ? '' : 'block mb-1'}`} style={{ color: 'var(--color-text-secondary)' }}>
          {label}
          {s.secret && (
            <span className="ml-2 px-1.5 py-0.5 rounded text-xs" style={{ backgroundColor: 'var(--color-bg-tertiary)', color: 'var(--color-text-muted)' }}>
              {s.configured ? t('settingsSecretConfigured') : t('settingsSecretNotConfigured')}
            </span>
          )}
          {s.source === 'env' && (
            <span className="ml-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>({t('settingsSourceEnv')})</span>
          )}
        </label>
        {s.type !== 'boolean' && control}
        {hint && <p className="mt-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>{hint}</p>}
      </div>
    )
  }

  return (
    <div className={embedded ? 'admin-panel' : 'flex-1 overflow-y-auto'} style={embedded ? undefined : { backgroundColor: 'var(--color-bg-primary)' }}>
      <form className={embedded ? 'admin-panel-content' : 'max-w-3xl mx-auto p-8'} onSubmit={save} lang={language}>
        <div className={embedded ? 'admin-panel-header' : 'flex items-center justify-between mb-8 gap-4'}>
          <div>
            <Heading className={embedded ? 'admin-panel-title' : 'text-2xl font-bold flex items-center gap-2'} style={{ color: 'var(--color-text-primary)' }}>
              {!embedded && <Settings className="w-7 h-7" style={{ color: 'var(--color-accent-primary)' }} />}
              {t('systemSettings')}
            </Heading>
            <p className={embedded ? 'admin-panel-description' : 'mt-1'} style={{ color: 'var(--color-text-tertiary)' }}>{t('systemSettingsDescription')}</p>
          </div>
          <button type="submit" disabled={saving || loading || siteIconBusy !== null}
            className={embedded ? 'admin-panel-primary-action' : 'flex items-center gap-2 px-4 py-2 rounded-lg font-medium disabled:opacity-60'}
            style={{ backgroundColor: 'var(--color-accent-primary)', color: 'var(--color-accent-text)' }}>
            <Save className="w-4 h-4" />
            {t('settingsSave')}
          </button>
        </div>

        {error && <div role="alert" className="mb-6 p-4 rounded-lg" style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#ef4444' }}>{error}</div>}
        {success && <div role="status" className="mb-6 p-4 rounded-lg" style={{ backgroundColor: 'rgba(34, 197, 94, 0.1)', color: '#22c55e' }}>{success}</div>}

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: 'var(--color-accent-primary)' }}></div>
          </div>
        ) : (
          <div className={embedded ? 'admin-panel-settings-grid' : 'space-y-6'}>
            {grouped.filter(g => g.items.length > 0).map(g => (
              <fieldset key={g.id} className={embedded ? 'admin-panel-settings-group rounded-lg border p-6 space-y-4' : 'rounded-lg border p-6 space-y-4'}
                style={{ borderColor: 'var(--color-border-primary)', backgroundColor: 'var(--color-bg-secondary)' }}>
                <legend className="px-2 text-base font-semibold" style={{ color: 'var(--color-text-primary)' }}>{t(g.label)}</legend>
                {g.id === 'smtp' && (
                  <div role="status" className="col-span-full rounded-lg border p-3"
                    style={{ borderColor: 'var(--color-border-primary)', backgroundColor: 'var(--color-bg-tertiary)' }}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>{t('settingsSmtpDeliveryMode')}</span>
                      <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold"
                        style={{ backgroundColor: 'var(--color-bg-primary)', color: 'var(--color-accent-primary)' }}>
                        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
                        {t(usesSmtpRelay ? 'settingsSmtpDeliveryRelay' : 'settingsSmtpDeliveryDirect')}
                      </span>
                    </div>
                    <p className="mt-2 text-xs leading-relaxed" style={{ color: 'var(--color-text-tertiary)' }}>
                      {t(usesSmtpRelay ? 'settingsSmtpDeliveryRelayHint' : 'settingsSmtpDeliveryDirectHint')}
                    </p>
                  </div>
                )}
                {g.items.map(renderField)}
              </fieldset>
            ))}
          </div>
        )}
      </form>
    </div>
  )
}
