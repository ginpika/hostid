import { useState, useRef, useEffect } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Mail, Lock, ArrowRight, Globe, LogOut, User } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useI18n } from '../i18n/I18nContext'
import { useDomain } from '../contexts/DomainContext'
import ThemeSelector from '../components/ThemeSelector'

interface LocalUser {
  id: string
  email: string
  username: string
  nickname?: string | null
  avatar?: string | null
}

type AnimationPhase = 'idle' | 'formFadeOut' | 'heightTransition' | 'cardFadeIn'

const FADE_DURATION = 500
const HEIGHT_DURATION = 800
const LOGIN_FORM_HEIGHT = 548
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
  const languageMenuRef = useRef<HTMLDivElement>(null)
  const formRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const [searchParams] = useSearchParams()
  
  const redirectUrl = searchParams.get('redirect') || '/'

  const user = localUser || authUser

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
                        src={user.avatar} 
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
