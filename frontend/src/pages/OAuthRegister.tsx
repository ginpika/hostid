import { useState, useEffect, useRef } from 'react'
import { useSearchParams, useNavigate, Link } from 'react-router-dom'
import { ArrowRight, Globe, User } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useI18n } from '../i18n/I18nContext'
import { useDomain } from '../contexts/DomainContext'
import ThemeSelector from '../components/ThemeSelector'

export default function OAuthRegister() {
  const { t, language, setLanguage } = useI18n()
  const { domain } = useDomain()
  const { setUser } = useAuth()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  
  const token = searchParams.get('token') || ''
  const redirect = searchParams.get('redirect') || '/'
  const githubLogin = searchParams.get('githubLogin') || ''
  const name = searchParams.get('name') || ''
  const avatar = searchParams.get('avatar') || ''
  
  const [username, setUsername] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showLanguageMenu, setShowLanguageMenu] = useState(false)
  const languageMenuRef = useRef<HTMLDivElement>(null)
  
  useEffect(() => {
    if (githubLogin) {
      setUsername(githubLogin)
    }
  }, [githubLogin])
  
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
    
    try {
      const res = await fetch('/api/oauth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ token, username })
      })
      
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Registration failed')
      }
      
      const data = await res.json()
      localStorage.setItem('token', data.token)
      setUser(data.user)
      
      if (redirect.startsWith('http')) {
        window.location.href = redirect
      } else {
        navigate(redirect, { replace: true })
      }
    } catch (err) {
      let errorMessage = t('registrationFailed')
      if (err instanceof Error) {
        if (err.message === 'Username already taken') {
          errorMessage = t('usernameAlreadyTaken')
        } else if (err.message === 'Invalid or expired OAuth token') {
          errorMessage = t('oauthTokenExpired')
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

  return (
    <div 
      className="min-h-screen flex items-center justify-center p-4"
      style={{ backgroundColor: 'var(--color-bg-primary)' }}
    >
      <div className="w-full max-w-md">
        <div 
          className="w-full p-8 rounded-2xl shadow-lg"
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
              className="inline-flex items-center justify-center w-16 h-16 rounded-full mb-4 overflow-hidden"
              style={{ backgroundColor: 'var(--color-accent-muted)' }}
            >
              {avatar ? (
                <img 
                  src={decodeURIComponent(avatar)} 
                  alt={name || githubLogin}
                  className="w-full h-full object-cover"
                />
              ) : (
                <User className="w-8 h-8" style={{ color: 'var(--color-accent-primary)' }} />
              )}
            </div>
            <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
              {t('completeRegistration')}
            </h1>
            <p className="mt-2" style={{ color: 'var(--color-text-tertiary)' }}>
              {t('githubAccountConnected')}
            </p>
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
              <p className="mt-1 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                {t('usernameHint')}
              </p>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-medium transition-colors disabled:opacity-50"
              style={{ backgroundColor: 'var(--color-accent-primary)', color: 'var(--color-accent-text)' }}
            >
              {loading ? t('loading') : t('completeRegistration')}
              {!loading && <ArrowRight className="w-4 h-4" />}
            </button>
          </form>

          <p 
            className="mt-6 text-center text-sm"
            style={{ color: 'var(--color-text-tertiary)' }}
          >
            <Link 
              to="/login" 
              className="font-medium hover:underline"
              style={{ color: 'var(--color-accent-primary)' }}
            >
              {t('backToLogin')}
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
