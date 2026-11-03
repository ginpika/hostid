/**
 * 首次运行初始化向导
 * 系统中没有任何用户时显示，创建第一个管理员并配置站点地址与邮件域名
 */
import { useState } from 'react'
import { ShieldCheck, Globe, Mail, User, Lock, type LucideIcon } from 'lucide-react'
import { useI18n } from '../i18n/I18nContext'
import AuthPage, { AuthHeader } from '../components/AuthPage'

const inputClass = 'w-full pl-10 pr-4 py-2.5 rounded-lg border text-sm transition-colors focus:outline-none focus:ring-2'
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

  const field = (id: string, label: string, input: React.ReactNode, Icon: LucideIcon, hint?: string) => (
    <div>
      <label htmlFor={id} className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>{label}</label>
      <div className="relative">
        <Icon aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5" style={{ color: 'var(--color-text-quaternary)' }} />
        {input}
      </div>
      {hint && <p className="mt-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>{hint}</p>}
    </div>
  )

  return (
    <AuthPage>
      <AuthHeader title={t('setupTitle')} description={t('setupDescription')} />
      <form onSubmit={submit} className="space-y-4">

        {error && <div role="alert" className="p-3 rounded-lg text-sm" style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', color: '#ef4444' }}>{error}</div>}

        {field('setup-site-url', t('settingSiteUrl'),
          <input id="setup-site-url" type="url" required value={siteUrl} onChange={e => setSiteUrl(e.target.value)} className={inputClass} style={inputStyle} />,
          Globe, t('settingSiteUrlHint'))}
        {field('setup-mail-domain', t('settingMailDomain'),
          <input id="setup-mail-domain" type="text" required value={mailDomain} onChange={e => setMailDomain(e.target.value)} className={inputClass} style={inputStyle} />,
          Mail, t('settingMailDomainHint'))}
        {field('setup-username', t('setupUsername'),
          <input id="setup-username" type="text" required autoComplete="username" pattern="[a-zA-Z0-9._]{3,32}" value={username} onChange={e => setUsername(e.target.value)} className={inputClass} style={inputStyle} />,
          User, username && mailDomain ? `${username.toLowerCase()}@${mailDomain.toLowerCase()}` : undefined)}
        {field('setup-password', t('setupPassword'),
          <input id="setup-password" type="password" required minLength={12} autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} className={inputClass} style={inputStyle} />, Lock)}
        {field('setup-confirm', t('setupConfirmPassword'),
          <input id="setup-confirm" type="password" required minLength={12} autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} className={inputClass} style={inputStyle} />, Lock)}

        <button type="submit" disabled={submitting} className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ backgroundColor: 'var(--color-accent-primary)', color: 'var(--color-accent-text)' }}>
          <ShieldCheck aria-hidden="true" className="w-4 h-4" />
          {t('setupSubmit')}
        </button>
      </form>
    </AuthPage>
  )
}
