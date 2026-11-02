/**
 * 首次运行初始化向导
 * 系统中没有任何用户时显示，创建第一个管理员并配置站点地址与邮件域名
 */
import { useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { useI18n } from '../i18n/I18nContext'
import BrandMark from '../components/BrandMark'

const inputClass = 'w-full px-3 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2'
const inputStyle = {
  backgroundColor: 'var(--color-bg-primary)',
  borderColor: 'var(--color-border-primary)',
  color: 'var(--color-text-primary)'
}

export default function SetupPage({ onComplete }: { onComplete: () => void }) {
  const { t } = useI18n()
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [siteUrl, setSiteUrl] = useState(() => window.location.origin)
  const [mailDomain, setMailDomain] = useState(() => window.location.hostname)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (password.length < 12) return setError(t('setupPasswordTooShort'))
    if (password !== confirm) return setError(t('setupPasswordMismatch'))
    setSubmitting(true)
    try {
      const res = await fetch('/api/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, siteUrl, mailDomain })
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok && res.status !== 409) throw new Error(data.error || `HTTP ${res.status}`)
      onComplete()
    } catch (err) {
      setError(`${t('setupFailed')}: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSubmitting(false)
    }
  }

  const field = (id: string, label: string, input: React.ReactNode, hint?: string) => (
    <div>
      <label htmlFor={id} className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>{label}</label>
      {input}
      {hint && <p className="mt-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>{hint}</p>}
    </div>
  )

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ backgroundColor: 'var(--color-bg-primary)' }}>
      <form onSubmit={submit} className="w-full max-w-md rounded-2xl border p-8 space-y-4"
        style={{ backgroundColor: 'var(--color-bg-secondary)', borderColor: 'var(--color-border-primary)' }}>
        <div className="flex items-center gap-3 mb-2">
          <BrandMark />
          <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: 'var(--color-text-primary)' }}>
            <ShieldCheck className="w-5 h-5" style={{ color: 'var(--color-accent-primary)' }} />
            {t('setupTitle')}
          </h1>
        </div>
        <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>{t('setupDescription')}</p>

        {error && <div role="alert" className="p-3 rounded-lg text-sm" style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#ef4444' }}>{error}</div>}

        {field('setup-site-url', t('settingSiteUrl'),
          <input id="setup-site-url" type="url" required value={siteUrl} onChange={e => setSiteUrl(e.target.value)} className={inputClass} style={inputStyle} />,
          t('settingSiteUrlHint'))}
        {field('setup-mail-domain', t('settingMailDomain'),
          <input id="setup-mail-domain" type="text" required value={mailDomain} onChange={e => setMailDomain(e.target.value)} className={inputClass} style={inputStyle} />,
          t('settingMailDomainHint'))}
        {field('setup-username', t('setupUsername'),
          <input id="setup-username" type="text" required autoComplete="username" pattern="[a-zA-Z0-9._]{3,32}" value={username} onChange={e => setUsername(e.target.value)} className={inputClass} style={inputStyle} />,
          username && mailDomain ? `${username.toLowerCase()}@${mailDomain.toLowerCase()}` : undefined)}
        {field('setup-password', t('setupPassword'),
          <input id="setup-password" type="password" required minLength={12} autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} className={inputClass} style={inputStyle} />)}
        {field('setup-confirm', t('setupConfirmPassword'),
          <input id="setup-confirm" type="password" required minLength={12} autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} className={inputClass} style={inputStyle} />)}

        <button type="submit" disabled={submitting} className="w-full py-2 rounded-lg font-medium disabled:opacity-60"
          style={{ backgroundColor: 'var(--color-accent-primary)', color: '#fff' }}>
          {t('setupSubmit')}
        </button>
      </form>
    </div>
  )
}
