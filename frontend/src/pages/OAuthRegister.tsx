import { useState, useEffect, useRef } from 'react'
import { useSearchParams, useNavigate, Link } from 'react-router-dom'
import { ArrowRight, Globe, User, Link2, ArrowLeftRight } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useI18n } from '../i18n/I18nContext'
import { useDomain } from '../contexts/DomainContext'
import ThemeSelector from '../components/ThemeSelector'

export default function OAuthRegister() {
  const { t, language, setLanguage } = useI18n()
  const { domain } = useDomain()
  const { user: currentUser, setUser } = useAuth()
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

  // Check if user is already logged in (binding mode vs register mode)
  const localToken = localStorage.getItem('token')
  const isBindingMode = !!localToken && !!currentUser

  // Get local user avatar URL
  const getLocalAvatarUrl = () => {
    if (currentUser?.avatar) {
      return currentUser.avatar.startsWith('http') ? currentUser.avatar : `/api/auth/avatar/${currentUser.avatar}`
    }
    return null
  }
  
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

  const handleBind = async () => {
    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/oauth/bind', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localToken}`
        },
        body: JSON.stringify({ token })
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Binding failed')
      }

      const data = await res.json()
      setUser(data.user)

      if (redirect.startsWith('http')) {
        window.location.href = redirect
      } else {
        navigate(redirect, { replace: true })
      }
    } catch (err) {
      let errorMessage = language === 'zh-CN' ? '绑定失败' : 'Binding failed'
      if (err instanceof Error) {
        if (err.message === 'This GitHub account is already bound to another user') {
          errorMessage = language === 'zh-CN' ? '该 GitHub 账号已被其他用户绑定' : 'This GitHub account is already bound to another user'
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
              {isBindingMode
                ? (language === 'zh-CN' ? '绑定 GitHub 账号' : 'Link GitHub Account')
                : t('completeRegistration')}
            </h1>
            <p className="mt-2" style={{ color: 'var(--color-text-tertiary)' }}>
              {isBindingMode
                ? (language === 'zh-CN'
                    ? `是否将 GitHub 账号 @${githubLogin} 绑定到当前账户？`
                    : `Link GitHub account @${githubLogin} to your current account?`)
                : t('githubAccountConnected')}
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

          {isBindingMode ? (
            <div className="space-y-6">
              {/* Binding Relationship Display */}
              <div className="flex items-center justify-center gap-4">
                {/* Local Account */}
                <div className="flex flex-col items-center gap-2 flex-1">
                  <div
                    className="w-16 h-16 rounded-full overflow-hidden border-2 flex items-center justify-center"
                    style={{
                      borderColor: 'var(--color-accent-primary)',
                      backgroundColor: 'var(--color-bg-tertiary)'
                    }}
                  >
                    {getLocalAvatarUrl() ? (
                      <img
                        src={getLocalAvatarUrl()!}
                        alt={currentUser?.username}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <User className="w-8 h-8" style={{ color: 'var(--color-text-muted)' }} />
                    )}
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-medium truncate max-w-[100px]" style={{ color: 'var(--color-text-primary)' }}>
                      {currentUser?.nickname || currentUser?.username}
                    </p>
                    <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                      {language === 'zh-CN' ? '本地账户' : 'Local Account'}
                    </p>
                  </div>
                </div>

                {/* Connection Arrow */}
                <div className="flex flex-col items-center">
                  <ArrowLeftRight
                    className="w-6 h-6"
                    style={{ color: 'var(--color-accent-primary)' }}
                  />
                </div>

                {/* GitHub Account */}
                <div className="flex flex-col items-center gap-2 flex-1">
                  <div
                    className="w-16 h-16 rounded-full overflow-hidden border-2 flex items-center justify-center"
                    style={{
                      borderColor: '#22c55e',
                      backgroundColor: 'var(--color-bg-tertiary)'
                    }}
                  >
                    {avatar ? (
                      <img
                        src={decodeURIComponent(avatar)}
                        alt={githubLogin}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <svg className="w-8 h-8" style={{ color: 'var(--color-text-muted)' }} viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                      </svg>
                    )}
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-medium truncate max-w-[100px]" style={{ color: 'var(--color-text-primary)' }}>
                      @{githubLogin}
                    </p>
                    <p className="text-xs" style={{ color: '#22c55e' }}>
                      GitHub
                    </p>
                  </div>
                </div>
              </div>

              {/* Description */}
              <p
                className="text-center text-sm"
                style={{ color: 'var(--color-text-tertiary)' }}
              >
                {language === 'zh-CN'
                  ? '绑定后，您可以使用 GitHub 账号登录此账户'
                  : 'After linking, you can sign in with your GitHub account'}
              </p>

              {/* Error Message */}
              {error && (
                <div
                  className="p-3 rounded-lg text-sm"
                  style={{
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    border: '1px solid rgba(239, 68, 68, 0.3)',
                    color: '#ef4444'
                  }}
                >
                  {error}
                </div>
              )}

              {/* Action Buttons */}
              <div className="space-y-3">
                <button
                  onClick={handleBind}
                  disabled={loading}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-medium transition-colors disabled:opacity-50"
                  style={{ backgroundColor: 'var(--color-accent-primary)', color: 'var(--color-accent-text)' }}
                >
                  {loading
                    ? (language === 'zh-CN' ? '绑定中...' : 'Linking...')
                    : (language === 'zh-CN' ? '确认绑定' : 'Confirm Link')}
                  {!loading && <Link2 className="w-4 h-4" />}
                </button>

                <button
                  onClick={() => navigate(redirect, { replace: true })}
                  className="w-full px-4 py-2.5 rounded-lg font-medium transition-colors"
                  style={{
                    color: 'var(--color-text-secondary)',
                    backgroundColor: 'var(--color-bg-tertiary)'
                  }}
                >
                  {language === 'zh-CN' ? '取消' : 'Cancel'}
                </button>
              </div>
            </div>
          ) : (
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
          )}

          {!isBindingMode && (
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
