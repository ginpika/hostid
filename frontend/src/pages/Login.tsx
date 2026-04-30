/**
 * 登录页面
 * 用户登录表单，支持用户名密码登录和 OAuth 登录
 * 包含 RSA 密码加密和登录成功跳转
 */
import { useState, useRef, useEffect } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Mail, Lock, ArrowRight, Globe, LogOut, User, Key } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useI18n } from '../i18n/I18nContext'
import { useDomain } from '../contexts/DomainContext'
import ThemeSelector from '../components/ThemeSelector'
import { encryptPassword } from '../utils/rsa'

interface LocalUser {
  id: string
  email: string
  username: string
  nickname?: string | null
  avatar?: string | null
}

interface OAuthProvider {
  enabled: boolean
  displayName: string
}

interface OAuthStatus {
  providers: Record<string, OAuthProvider>
}

type AnimationPhase = 'idle' | 'formFadeOut' | 'heightTransition' | 'cardFadeIn'

const FADE_DURATION = 500
// 每一个 OAuth 按钮会添加差值 58px 
const HEIGHT_DURATION = 800
const LOGIN_FORM_HEIGHT = 646
const LOGIN_CARD_HEIGHT = 340

export default function Login() {
  const { t, language, setLanguage } = useI18n()
  const { domain, registrationEnabled, loading: domainLoading } = useDomain()
  const { user: authUser, loading: authLoading, logout } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showLanguageMenu, setShowLanguageMenu] = useState(false)
  const [localUser, setLocalUser] = useState<LocalUser | null>(null)
  const [isRedirecting, setIsRedirecting] = useState(false)
  const [animationPhase, setAnimationPhase] = useState<AnimationPhase>('idle')
  const [containerHeight, setContainerHeight] = useState<number | null>(null)
  const [startProgress, setStartProgress] = useState(false)
  const [oauthStatus, setOauthStatus] = useState<OAuthStatus>({ providers: {} })
  const [oauthLoading, setOauthLoading] = useState(false)
  const languageMenuRef = useRef<HTMLDivElement>(null)
  const formRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const [searchParams] = useSearchParams()
  
  const redirectUrl = searchParams.get('redirect') || '/'
  const oauthSuccess = searchParams.get('oauth_success') === 'true'

  const user = localUser || authUser

  useEffect(() => {
    const fetchOAuthStatus = async () => {
      try {
        const res = await fetch('/api/oauth/status')
        if (res.ok) {
          const data = await res.json()
          setOauthStatus(data)
        }
      } catch (e) {
        console.error('Failed to fetch OAuth status:', e)
      }
    }
    fetchOAuthStatus()
  }, [])

  useEffect(() => {
    if (oauthSuccess && !authLoading && authUser && !localUser && animationPhase === 'idle') {
      setIsRedirecting(true)
      startAnimationSequence()
    }
  }, [oauthSuccess, authLoading, authUser, localUser, animationPhase])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (languageMenuRef.current && !languageMenuRef.current.contains(event.target as Node)) {
        setShowLanguageMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    if (!authLoading && authUser && !localUser && animationPhase === 'idle') {
      startAnimationSequence()
    }
  }, [authLoading, authUser, localUser, animationPhase])

  const startAnimationSequence = () => {
    if (formRef.current) {
      setContainerHeight(LOGIN_FORM_HEIGHT)
    }
    setAnimationPhase('formFadeOut')
  }

  useEffect(() => {
    if (animationPhase === 'formFadeOut') {
      const timer = setTimeout(() => {
        setAnimationPhase('heightTransition')
      }, FADE_DURATION)
      return () => clearTimeout(timer)
    }
  }, [animationPhase])

  useEffect(() => {
    if (animationPhase === 'heightTransition' && cardRef.current) {
      requestAnimationFrame(() => {
        if (cardRef.current) {
          setContainerHeight(LOGIN_CARD_HEIGHT)
        }
      })
      const timer = setTimeout(() => {
        setAnimationPhase('cardFadeIn')
      }, HEIGHT_DURATION)
      return () => clearTimeout(timer)
    }
  }, [animationPhase])

  useEffect(() => {
    if (animationPhase === 'cardFadeIn') {
      const timer = setTimeout(() => {
        setStartProgress(true)
      }, FADE_DURATION + 200)
      return () => clearTimeout(timer)
    }
  }, [animationPhase])

  useEffect(() => {
    if (startProgress && isRedirecting) {
      const timer = setTimeout(() => {
        if (redirectUrl.startsWith('http')) {
          window.location.href = redirectUrl
        } else {
          window.location.href = window.location.origin + redirectUrl
        }
      }, 1500)
      return () => clearTimeout(timer)
    }
  }, [startProgress, isRedirecting, redirectUrl])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    
    try {
      const encryptedPassword = await encryptPassword(password)
      
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username, password: encryptedPassword })
      })
      
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Login failed')
      }
      
      const data = await res.json()
      localStorage.setItem('token', data.token)
      setLocalUser(data.user)
      setIsRedirecting(true)
      setLoading(false)
      startAnimationSequence()
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

  const handleLogout = async () => {
    await logout()
    setLocalUser(null)
    setIsRedirecting(false)
    setAnimationPhase('idle')
    setContainerHeight(null)
    setStartProgress(false)
  }

  const handleContinue = () => {
    if (redirectUrl.startsWith('http')) {
      window.location.href = redirectUrl
    } else {
      window.location.href = window.location.origin + redirectUrl
    }
  }

  const isAnimating = animationPhase !== 'idle'
  const isFormFadeOut = animationPhase === 'formFadeOut'
  const isHeightTransition = animationPhase === 'heightTransition'
  const isCardFadeIn = animationPhase === 'cardFadeIn'
  const showForm = animationPhase === 'idle' || animationPhase === 'formFadeOut'

  if (domainLoading || authLoading) {
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
      <div className="w-full max-w-md relative flex flex-col items-center">
        <div 
          className="w-full p-8 rounded-2xl shadow-lg"
          style={{ 
            backgroundColor: 'var(--color-bg-secondary)',
            height: containerHeight ? containerHeight : undefined,
            transition: isHeightTransition ? `height ${HEIGHT_DURATION}ms ease-in-out` : 'none'
          }}
        >
          <div 
            className="flex justify-end mb-6 gap-2 items-center relative z-50"
            style={{
              opacity: isAnimating ? 0 : 1,
              transform: `translateY(${isFormFadeOut ? -10 : 0}px)`,
              transition: `opacity ${FADE_DURATION}ms ease-out, transform ${FADE_DURATION}ms ease-out`,
              pointerEvents: isAnimating ? 'none' : 'auto'
            }}
          >
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

          <div className="relative">
            {showForm && (
              <div 
                ref={formRef}
                className="transition-all ease-out"
                style={{
                  opacity: isFormFadeOut ? 0 : 1,
                  transform: `translateY(${isFormFadeOut ? -20 : 0}px)`,
                  transition: `opacity ${FADE_DURATION}ms ease-out, transform ${FADE_DURATION}ms ease-out`
                }}
              >
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

                {Object.entries(oauthStatus.providers).some(([_, p]) => p.enabled) && (
                  <div className="mt-4">
                    <div className="relative">
                      <div className="absolute inset-0 flex items-center">
                        <div className="w-full border-t" style={{ borderColor: 'var(--color-border-primary)' }}></div>
                      </div>
                      <div className="relative flex justify-center text-sm">
                        <span className="px-2" style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-tertiary)' }}>
                          {t('orContinueWith')}
                        </span>
                      </div>
                    </div>

                    <div className="mt-4 space-y-3">
                      {Object.entries(oauthStatus.providers)
                        .filter(([_, provider]) => provider.enabled)
                        .map(([providerId, provider]) => {
                          const getProviderIcon = () => {
                            const iconClass = "w-5 h-5"
                            
                            if (providerId === 'github') {
                              return (
                                <svg className={iconClass} viewBox="0 0 24 24" fill="currentColor">
                                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                                </svg>
                              )
                            }
                            
                            if (providerId === 'google') {
                              return (
                                <svg className={iconClass} viewBox="0 0 24 24">
                                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                                </svg>
                              )
                            }
                            
                            if (providerId === 'wechat') {
                              return (
                                <svg className={iconClass} viewBox="0 0 24 24" fill="#07C160">
                                  <path d="M8.691 2.188C3.891 2.188 0 5.476 0 9.36c0 2.212 1.17 4.203 3.002 5.555a.59.59 0 0 1 .213.665l-.39 1.48c-.019.07-.048.141-.048.213 0 .163.13.295.29.295a.326.326 0 0 1 .167-.054l1.943-1.154a.934.934 0 0 1 .446-.138c.089 0 .177.018.265.035.907.235 1.863.371 2.853.371.277 0 .549-.016.819-.04-.159-.583-.246-1.187-.246-1.807 0-3.654 3.396-6.66 7.58-6.66.272 0 .538.018.802.047C15.762 4.256 12.528 2.188 8.691 2.188zm-2.935 5.09c.57 0 1.031.462 1.031 1.03 0 .57-.461 1.031-1.03 1.031-.571 0-1.032-.461-1.032-1.03 0-.57.461-1.031 1.031-1.031zm5.872 0c.57 0 1.031.462 1.031 1.03 0 .57-.461 1.031-1.03 1.031-.571 0-1.032-.461-1.032-1.03 0-.57.461-1.031 1.031-1.031zm4.847 3.54c-3.762 0-6.864 2.67-6.864 5.94 0 3.27 3.102 5.94 6.864 5.94.645 0 1.272-.076 1.874-.219a.67.67 0 0 1 .2-.032.54.54 0 0 1 .264.079l1.46.87a.23.23 0 0 0 .124.04c.118 0 .215-.096.215-.215 0-.054-.017-.107-.036-.16l-.29-1.11a.44.44 0 0 1 .16-.5c1.372-1.01 2.256-2.458 2.256-4.093 0-3.27-3.102-5.94-6.864-5.94zm-2.534 3.46c.427 0 .77.344.77.77 0 .427-.343.77-.77.77-.426 0-.77-.343-.77-.77 0-.426.344-.77.77-.77zm5.07 0c.427 0 .77.344.77.77 0 .427-.343.77-.77.77-.426 0-.77-.343-.77-.77 0-.426.344-.77.77-.77z"/>
                                </svg>
                              )
                            }
                            
                            return <Key className={iconClass} />
                          }
                          
                          return (
                            <button
                              key={providerId}
                              type="button"
                              onClick={() => {
                                setOauthLoading(true)
                                setTimeout(() => {
                                  window.location.href = `/api/oauth/${providerId}?redirect=${encodeURIComponent(redirectUrl)}`
                                }, 100)
                              }}
                              disabled={oauthLoading}
                              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-medium transition-all duration-200 border disabled:cursor-not-allowed"
                              style={{
                                backgroundColor: oauthLoading ? 'var(--color-bg-tertiary)' : 'var(--color-bg-primary)',
                                color: oauthLoading ? 'var(--color-text-tertiary)' : 'var(--color-text-primary)',
                                borderColor: oauthLoading ? 'var(--color-border-secondary)' : 'var(--color-border-primary)',
                                opacity: oauthLoading ? 0.7 : 1
                              }}
                            >
                              {oauthLoading ? (
                                <>
                                  <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3"></circle>
                                    <path className="opacity-75" stroke="currentColor" strokeWidth="3" strokeLinecap="round" d="M12 2a10 10 0 0 1 10 10"></path>
                                  </svg>
                                  {t('oauthRedirecting')}
                                </>
                              ) : (
                                <>
                                  {getProviderIcon()}
                                  {language === 'zh-CN' ? `使用 ${provider.displayName} 登录` : `Sign in with ${provider.displayName}`}
                                </>
                              )}
                            </button>
                          )
                        })}
                    </div>
                  </div>
                )}

                {registrationEnabled && (
                  <p 
                    className="mt-6 text-center text-sm"
                    style={{ color: 'var(--color-text-tertiary)' }}
                  >
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
            )}

            {user && (isHeightTransition || isCardFadeIn) && (
              <div 
                ref={cardRef}
                className="transition-all ease-out"
                style={{
                  opacity: isCardFadeIn ? 1 : 0,
                  pointerEvents: isCardFadeIn ? 'auto' : 'none',
                  transition: `opacity ${FADE_DURATION}ms ease-out`
                }}
              >
                <div 
                  className="text-center mb-8"
                  style={{
                    opacity: isCardFadeIn ? 1 : 0,
                    transition: `opacity ${FADE_DURATION}ms ease-out`,
                    transitionDelay: '50ms'
                  }}
                >
                  <div 
                    className="inline-flex items-center justify-center w-16 h-16 rounded-full mb-4 overflow-hidden"
                    style={{ backgroundColor: 'var(--color-accent-muted)' }}
                  >
                    {user.avatar ? (
                      <img 
                        src={user.avatar.startsWith('http') ? user.avatar : `/api/auth/avatar/${user.avatar}`}
                        alt={user.username}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <User className="w-8 h-8" style={{ color: 'var(--color-accent-primary)' }} />
                    )}
                  </div>
                  <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
                    {user.nickname || user.username}
                  </h1>
                  <p className="mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
                    @{user.username}
                  </p>
                </div>

                <div 
                  className="transition-all ease-out"
                  style={{
                    opacity: isCardFadeIn ? 1 : 0,
                    transition: `opacity ${FADE_DURATION}ms ease-out`,
                    transitionDelay: '100ms'
                  }}
                >
                  {isRedirecting ? (
                    <div className="space-y-3">
                      <p className="text-sm text-center mb-3" style={{ color: 'var(--color-text-tertiary)' }}>
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
                            width: startProgress ? '100%' : '0%',
                            transition: 'width 1.5s ease-in-out'
                          }}
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <button
                        onClick={handleContinue}
                        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-medium transition-colors"
                        style={{ backgroundColor: 'var(--color-accent-primary)', color: 'var(--color-accent-text)' }}
                      >
                        {t('continue')}
                        <ArrowRight className="w-4 h-4" />
                      </button>
                      
                      <button
                        onClick={handleLogout}
                        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-medium transition-colors"
                        style={{ 
                          backgroundColor: 'var(--color-bg-tertiary)', 
                          color: 'var(--color-text-secondary)' 
                        }}
                      >
                        <LogOut className="w-4 h-4" />
                        {t('logout')}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        <div 
          className="mt-8 text-center transition-all ease-out"
          style={{
            opacity: isAnimating ? 0 : 1,
            transform: `translateY(${isAnimating ? 10 : 0}px)`,
            transition: `opacity ${FADE_DURATION}ms ease-out, transform ${FADE_DURATION}ms ease-out`
          }}
        >
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
