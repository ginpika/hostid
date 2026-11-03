/**
 * 注册页面
 * 用户注册表单，支持用户名密码注册
 * 包含 RSA 密码加密、域名显示和 Turnstile 人机验证
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Lock, ArrowRight, User } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useI18n } from '../i18n/I18nContext'
import { useDomain } from '../contexts/DomainContext'
import AuthPage, { AuthHeader, AuthLoading } from '../components/AuthPage'
import Turnstile from '../components/Turnstile'

declare global {
  interface Window {
    __ENV__?: {
      CF_TURNSTILE_SITE_KEY?: string
    }
  }
}

const CF_TURNSTILE_SITE_KEY = window.__ENV__?.CF_TURNSTILE_SITE_KEY || import.meta.env.CF_TURNSTILE_SITE_KEY || ''

export default function Register() {
  const { t, language } = useI18n()
  const { domain, loading: domainLoading } = useDomain()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const { register } = useAuth()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (CF_TURNSTILE_SITE_KEY && !turnstileToken) {
      setError(t('pleaseCompleteVerification'))
      return
    }
    
    setError('')
    setLoading(true)
    
    try {
      await register(username, password, turnstileToken || undefined)
    } catch (err) {
      let errorMessage = t('emailAlreadyRegistered')
      if (err instanceof Error) {
        if (err.message === 'Username already taken') {
          errorMessage = t('usernameAlreadyTaken')
        } else {
          errorMessage = err.message
        }
      }
      setError(errorMessage)
      setTurnstileToken(null)
    } finally {
      setLoading(false)
    }
  }

  if (domainLoading) {
    return (
      <AuthPage>
        <AuthHeader title={t('register')} description={t('registerToAccount')} />
        <AuthLoading />
      </AuthPage>
    )
  }

  return (
    <AuthPage>
      <AuthHeader title={t('register')} description={t('registerToAccount')} />

      {error && (
        <div 
          className="mb-4 p-3 rounded-lg text-sm"
          style={{ 
            backgroundColor: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            color: '#ef4444'
          }}
        >
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label 
            className="block text-sm font-medium mb-1"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            {t('username')}
          </label>
          <div className="relative">
            <User
              aria-hidden="true"
              className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5"
              style={{ color: 'var(--color-text-quaternary)' }}
            />
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 rounded-lg border text-sm transition-colors focus:outline-none focus:ring-2"
              style={{ 
                backgroundColor: 'var(--color-bg-primary)',
                borderColor: 'var(--color-border-primary)',
                color: 'var(--color-text-primary)'
              }}
              placeholder="username"
              required
              minLength={3}
              maxLength={30}
              pattern="[a-zA-Z0-9._]+"
              title="Username can only contain letters, numbers, dots and underscores"
            />
            {domain && (
              <span 
                className="absolute right-3 top-1/2 -translate-y-1/2 text-sm"
                style={{ color: 'var(--color-text-quaternary)' }}
              >
                @{domain}
              </span>
            )}
          </div>
          <p className="text-xs mt-1" style={{ color: 'var(--color-text-quaternary)' }}>{t('usernameHint')}</p>
        </div>

        <div>
          <label 
            className="block text-sm font-medium mb-1"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            {t('password')}
          </label>
          <div className="relative">
            <Lock 
              className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5" 
              style={{ color: 'var(--color-text-quaternary)' }}
            />
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 rounded-lg border text-sm transition-colors focus:outline-none focus:ring-2"
              style={{ 
                backgroundColor: 'var(--color-bg-primary)',
                borderColor: 'var(--color-border-primary)',
                color: 'var(--color-text-primary)'
              }}
              placeholder="••••••••"
              required
              minLength={6}
            />
          </div>
        </div>

        {CF_TURNSTILE_SITE_KEY && (
          <div className="flex justify-center py-2">
            <Turnstile
              siteKey={CF_TURNSTILE_SITE_KEY}
              onVerify={setTurnstileToken}
              onExpire={() => setTurnstileToken(null)}
              onError={() => setTurnstileToken(null)}
              language={language}
            />
          </div>
        )}

        <button
          type="submit"
          disabled={loading || (CF_TURNSTILE_SITE_KEY && !turnstileToken)}
          className="w-full flex items-center justify-center gap-1 px-4 py-2.5 rounded-lg font-medium transition-colors disabled:opacity-50"
          style={{ backgroundColor: 'var(--color-accent-primary)', color: 'var(--color-accent-text)' }}
        >
          {loading ? t('loading') : t('register')}
          {!loading && <ArrowRight className="w-4 h-4" />}
        </button>
      </form>

      <p className="mt-6 text-center text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
        {t('alreadyHaveAccount')} {' '}
        <Link 
          to="/login" 
          className="font-medium hover:underline"
          style={{ color: 'var(--color-accent-primary)' }}
        >
          {t('login')}
        </Link>
      </p>
    </AuthPage>
  )
}
