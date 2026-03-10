import { useState, useRef, useEffect } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Mail, Lock, ArrowRight, Globe, CheckCircle } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useI18n } from '../i18n/I18nContext'
import { useDomain } from '../contexts/DomainContext'
import ThemeSelector from '../components/ThemeSelector'

export default function Login() {
  const { t, language, setLanguage } = useI18n()
  const { domain, registrationEnabled, loading: domainLoading } = useDomain()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showLanguageMenu, setShowLanguageMenu] = useState(false)
  const [loginSuccess, setLoginSuccess] = useState(false)
  const languageMenuRef = useRef<HTMLDivElement>(null)
  const { login } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  
  const redirectUrl = searchParams.get('redirect') || '/'

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
    setError('')
    setLoading(true)
    
    const isSsoLogin = redirectUrl.startsWith('http') || redirectUrl !== '/'
    
    try {
      if (isSsoLogin) {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ username, password })
        })
        
        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error || 'Login failed')
        }
        
        const data = await res.json()
        localStorage.setItem('token', data.token)
        
        setLoginSuccess(true)
        setLoading(false)
        
        setTimeout(() => {
          if (redirectUrl.startsWith('http')) {
            window.location.href = redirectUrl
          } else {
            window.location.href = redirectUrl
          }
        }, 1500)
      } else {
        await login(username, password)
        navigate('/')
      }
    } catch (err) {
      let errorMessage = t('invalidCredentials')
      if (err instanceof Error) {
        if (err.message === 'Invalid credentials') {
          errorMessage = t('invalidCredentials')
        } else {
          errorMessage = err.message
        }
      }
      setError(errorMessage)
      setLoading(false)
    }
  }

  const toggleLanguage = async (newLanguage: 'zh-CN' | 'en-US') => {
    await setLanguage(newLanguage)
    setShowLanguageMenu(false)
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

  if (loginSuccess) {
    return (
      <div 
        className="min-h-screen flex items-center justify-center p-4"
        style={{ backgroundColor: 'var(--color-bg-primary)' }}
      >
        <div className="text-center w-full max-w-xs">
          <div 
            className="inline-flex items-center justify-center w-16 h-16 rounded-full mb-4"
            style={{ backgroundColor: 'rgba(34, 197, 94, 0.15)' }}
          >
            <CheckCircle className="w-8 h-8" style={{ color: '#22c55e' }} />
          </div>
          <h2 className="text-lg font-medium mb-1" style={{ color: 'var(--color-text-primary)' }}>
            {t('loginSuccess')}
          </h2>
          <p className="text-sm mb-6" style={{ color: 'var(--color-text-tertiary)' }}>
            {t('redirecting')}
          </p>
          <div 
            className="h-1 rounded-full overflow-hidden"
            style={{ backgroundColor: 'var(--color-bg-tertiary)' }}
          >
            <div 
              className="h-full rounded-full"
              style={{ 
                backgroundColor: 'var(--color-accent-primary)',
                animation: 'loading 1.5s ease-in-out forwards'
              }}
            />
          </div>
        </div>
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
            <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text-primary)' }}>{t('login')}</h1>
            <p className="mt-2" style={{ color: 'var(--color-text-tertiary)' }}>{t('loginToAccount')}</p>
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
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-medium transition-colors disabled:opacity-50"
              style={{ backgroundColor: 'var(--color-accent-primary)', color: 'var(--color-accent-text)' }}
            >
              {loading ? t('loading') : t('login')}
              {!loading && <ArrowRight className="w-4 h-4" />}
            </button>
          </form>

          {registrationEnabled && (
            <p className="mt-6 text-center text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
              {t('createAccount')} {' '}
              <Link 
                to="/register" 
                className="font-medium hover:underline"
                style={{ color: 'var(--color-accent-primary)' }}
              >
                {t('register')}
              </Link>
            </p>
          )}
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
