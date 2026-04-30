/**
 * 注册页面
 * 用户注册表单，支持用户名密码注册
 * 包含 RSA 密码加密、域名显示和 Turnstile 人机验证
 */
import { useState, useRef, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Mail, Lock, ArrowRight, Globe } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useI18n } from '../i18n/I18nContext'
import { useDomain } from '../contexts/DomainContext'
import { useTheme } from '../contexts/ThemeContext'
import ThemeSelector from '../components/ThemeSelector'
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
  const { t, language, setLanguage } = useI18n()
  const { domain, loading: domainLoading } = useDomain()
  const { resolvedSystemTheme, mode, currentTheme } = useTheme()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showLanguageMenu, setShowLanguageMenu] = useState(false)
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const languageMenuRef = useRef<HTMLDivElement>(null)
  const { register } = useAuth()

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (languageMenuRef.current && !languageMenuRef.current.contains(event.target as Node)) {
        setShowLanguageMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

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

  const toggleLanguage = async (newLanguage: 'zh-CN' | 'en-US') => {
    await setLanguage(newLanguage)
    setShowLanguageMenu(false)
  }

  const getTurnstileTheme = (): 'light' | 'dark' | 'auto' => {
    if (mode === 'system') {
      return resolvedSystemTheme
    }
    if (currentTheme.id === 'light') return 'light'
    return 'dark'
  }

  if (domainLoading) {
    return (
      <div 
        className="min-h-screen flex items-center justify-center"
        style={{ backgroundColor: 'var(--color-bg-primary)' }}
      >
        <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: 'var(--color-accent-primary)' }}></div>
      </div>
    )
  }

  return (
    <div 
      className="min-h-screen flex items-center justify-center p-4"
      style={{ backgroundColor: 'var(--color-bg-primary)' }}
    >
      <div className="w-full max-w-md">
        <div 
          className="p-8 rounded-2xl shadow-lg"
          style={{ backgroundColor: 'var(--color-bg-secondary)' }}
        >
          <div className="flex justify-end mb-6 gap-2 items-center">
            <ThemeSelector />
            <div className="relative" ref={languageMenuRef}>
              <button
                onClick={() => setShowLanguageMenu(!showLanguageMenu)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors hover:bg-[var(--color-bg-tertiary)]"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                <Globe className="w-4 h-4" />
                <span className="text-sm font-medium">{language === 'zh-CN' ? t('chinese') : t('english')}</span>
              </button>
              
              {showLanguageMenu && (
                <div 
                  className="absolute top-full right-0 mt-2 w-40 rounded-lg shadow-lg py-1 z-10"
                  style={{ 
                    backgroundColor: 'var(--color-bg-secondary)',
                    border: '1px solid var(--color-border-primary)'
                  }}
                >
                  <button
                    onClick={() => toggleLanguage('zh-CN')}
                    className="w-full text-left px-4 py-2 text-sm transition-colors hover:bg-[var(--color-bg-tertiary)]"
                    style={{ 
                      color: language === 'zh-CN' ? 'var(--color-accent-primary)' : 'var(--color-text-secondary)',
                      backgroundColor: language === 'zh-CN' ? 'var(--color-bg-tertiary)' : 'transparent'
                    }}
                  >
                    {t('chinese')}
                  </button>
                  <button
                    onClick={() => toggleLanguage('en-US')}
                    className="w-full text-left px-4 py-2 text-sm transition-colors hover:bg-[var(--color-bg-tertiary)]"
                    style={{ 
                      color: language === 'en-US' ? 'var(--color-accent-primary)' : 'var(--color-text-secondary)',
                      backgroundColor: language === 'en-US' ? 'var(--color-bg-tertiary)' : 'transparent'
                    }}
                  >
                    {t('english')}
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="text-center mb-8">
            <div 
              className="inline-flex items-center justify-center w-16 h-16 rounded-full mb-4"
              style={{ backgroundColor: 'var(--color-accent-muted)' }}
            >
              <Mail className="w-8 h-8" style={{ color: 'var(--color-accent-primary)' }} />
            </div>
            <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text-primary)' }}>{t('register')}</h1>
            <p className="mt-2" style={{ color: 'var(--color-text-tertiary)' }}>{t('registerToAccount')}</p>
          </div>

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
                <input
                  type="text"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-lg border text-sm transition-colors focus:outline-none focus:ring-2"
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
                  theme={getTurnstileTheme()}
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
        </div>

        <div className="mt-8 text-center">
          <Link 
            to="/tos"
            className="text-sm hover:underline transition-colors"
            style={{ color: 'var(--color-text-muted)' }}
          >
            {t('tosAndPrivacy')}
          </Link>
        </div>
      </div>
    </div>
  )
}
