/**
 * 登录页面
 * 用户登录表单，支持用户名密码登录、Passkey 和 OAuth 登录
 * PC 及横屏平板采用左右分栏极简卡片布局，移动端与竖屏保持紧凑单栏卡片
 */
import { useState, useRef, useEffect } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Lock, ArrowRight, LogOut, User, Key, Fingerprint, Eye, EyeOff } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useI18n } from '../i18n/I18nContext'
import { useDomain } from '../contexts/DomainContext'
import { useConfig } from '../contexts/ConfigContext'
import AuthPage, { AuthHeader, AuthLoading } from '../components/AuthPage'
import BrandMark from '../components/BrandMark'
import { encryptPassword } from '../utils/rsa'
import { authenticateWithPasskey, formatWebAuthnError, isPasskeySupported } from '../utils/passkey'

interface LocalUser {
  id: string
  email: string
  username: string
  nickname?: string | null
  avatar?: string | null
  avatarUrl?: string | null
}

interface OAuthProvider {
  enabled: boolean
  displayName: string
}

interface OAuthStatus {
  providers: Record<string, OAuthProvider>
  passkeyEnabled?: boolean
}

type AnimationPhase = 'idle' | 'formFadeOut' | 'heightTransition' | 'cardFadeIn'

const FADE_DURATION = 500
const HEIGHT_DURATION = 800
const LOGIN_CARD_HEIGHT = 340
const LOGIN_CARD_MAX_WIDTH = 448

function ProviderIcon({ providerId }: { providerId: string }) {
  const iconClass = 'w-4 h-4 shrink-0'

  if (providerId === 'github') {
    return (
      <svg className={iconClass} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
      </svg>
    )
  }

  if (providerId === 'google') {
    return (
      <svg className={iconClass} viewBox="0 0 24 24" aria-hidden="true">
        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
      </svg>
    )
  }

  if (providerId === 'wechat') {
    return (
      <svg className={iconClass} viewBox="0 0 24 24" fill="#07C160" aria-hidden="true">
        <path d="M8.691 2.188C3.891 2.188 0 5.476 0 9.36c0 2.212 1.17 4.203 3.002 5.555a.59.59 0 0 1 .213.665l-.39 1.48c-.019.07-.048.141-.048.213 0 .163.13.295.29.295a.326.326 0 0 1 .167-.054l1.943-1.154a.934.934 0 0 1 .446-.138c.089 0 .177.018.265.035.907.235 1.863.371 2.853.371.277 0 .549-.016.819-.04-.159-.583-.246-1.187-.246-1.807 0-3.654 3.396-6.66 7.58-6.66.272 0 .538.018.802.047C15.762 4.256 12.528 2.188 8.691 2.188zm-2.935 5.09c.57 0 1.031.462 1.031 1.03 0 .57-.461 1.031-1.03 1.031-.571 0-1.032-.461-1.032-1.03 0-.57.461-1.031 1.031-1.031zm5.872 0c.57 0 1.031.462 1.031 1.03 0 .57-.461 1.031-1.03 1.031-.571 0-1.032-.461-1.032-1.03 0-.57.461-1.031 1.031-1.031zm4.847 3.54c-3.762 0-6.864 2.67-6.864 5.94 0 3.27 3.102 5.94 6.864 5.94.645 0 1.272-.076 1.874-.219a.67.67 0 0 1 .2-.032.54.54 0 0 1 .264.079l1.46.87a.23.23 0 0 0 .124.04c.118 0 .215-.096.215-.215 0-.054-.017-.107-.036-.16l-.29-1.11a.44.44 0 0 1 .16-.5c1.372-1.01 2.256-2.458 2.256-4.093 0-3.27-3.102-5.94-6.864-5.94zm-2.534 3.46c.427 0 .77.344.77.77 0 .427-.343.77-.77.77-.426 0-.77-.343-.77-.77 0-.426.344-.77.77-.77zm5.07 0c.427 0 .77.344.77.77 0 .427-.343.77-.77.77-.426 0-.77-.343-.77-.77 0-.426.344-.77.77-.77z" />
      </svg>
    )
  }

  return <Key className={iconClass} aria-hidden="true" />
}

export default function Login() {
  const { t, language } = useI18n()
  const { getDisplayName } = useConfig()
  const { domain, registrationEnabled, loading: domainLoading } = useDomain()
  const { user: authUser, loading: authLoading, logout } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [localUser, setLocalUser] = useState<LocalUser | null>(null)
  const [isRedirecting, setIsRedirecting] = useState(false)
  const [animationPhase, setAnimationPhase] = useState<AnimationPhase>('idle')
  const [cardSize, setCardSize] = useState<{ width?: number; height?: number } | null>(null)
  const [startProgress, setStartProgress] = useState(false)
  const [oauthStatus, setOauthStatus] = useState<OAuthStatus>({ providers: {}, passkeyEnabled: false })
  const [loadingProviderId, setLoadingProviderId] = useState<string | null>(null)
  const [passkeyLoading, setPasskeyLoading] = useState(false)
  const surfaceRef = useRef<HTMLDivElement>(null)
  const [searchParams] = useSearchParams()

  const zh = language === 'zh-CN'
  const appName = getDisplayName(language as 'zh-CN' | 'en-US')
  const redirectUrl = searchParams.get('redirect') || '/'
  const oauthSuccess = searchParams.get('oauth_success') === 'true'
  const oauthLoading = loadingProviderId !== null

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
    if (!authLoading && authUser && !localUser && animationPhase === 'idle') {
      startAnimationSequence()
    }
  }, [authLoading, authUser, localUser, animationPhase])

  const startAnimationSequence = () => {
    if (surfaceRef.current) {
      const rect = surfaceRef.current.getBoundingClientRect()
      setCardSize({ width: Math.round(rect.width), height: Math.round(rect.height) })
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
    if (animationPhase === 'heightTransition') {
      let outerRaf = 0
      let innerRaf = 0
      outerRaf = requestAnimationFrame(() => {
        innerRaf = requestAnimationFrame(() => {
          const singleMainEl = surfaceRef.current?.querySelector('.auth-single-main') as HTMLElement | null
          const targetWidth = Math.min(LOGIN_CARD_MAX_WIDTH, window.innerWidth - 32)
          const measuredHeight = singleMainEl ? Math.ceil(singleMainEl.getBoundingClientRect().height) : LOGIN_CARD_HEIGHT
          setCardSize({
            width: targetWidth,
            height: Math.max(LOGIN_CARD_HEIGHT, measuredHeight)
          })
        })
      })
      const timer = setTimeout(() => {
        setAnimationPhase('cardFadeIn')
      }, HEIGHT_DURATION)
      return () => {
        cancelAnimationFrame(outerRaf)
        cancelAnimationFrame(innerRaf)
        clearTimeout(timer)
      }
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

  const handlePasskeyLogin = async () => {
    if (passkeyLoading || loading || oauthLoading) return
    if (!isPasskeySupported()) {
      setError(t('passkeyUnsupported'))
      return
    }

    setError('')
    setPasskeyLoading(true)

    try {
      const optionsRes = await fetch('/api/auth/passkeys/login/options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })
      const optionsPayload = await optionsRes.json()
      if (!optionsRes.ok) {
        throw new Error(optionsPayload.error || t('passkeyLoginFailed'))
      }

      const assertionResponse = await authenticateWithPasskey(optionsPayload.options)

      const verifyRes = await fetch('/api/auth/passkeys/login/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          challengeId: optionsPayload.challengeId,
          response: assertionResponse
        })
      })
      const verifyPayload = await verifyRes.json()
      if (!verifyRes.ok) {
        throw new Error(verifyPayload.error || t('passkeyLoginFailed'))
      }

      localStorage.setItem('token', verifyPayload.token)
      setLocalUser(verifyPayload.user)
      setIsRedirecting(true)
      setPasskeyLoading(false)
      startAnimationSequence()
    } catch (err) {
      setError(formatWebAuthnError(err, t, zh, 'passkeyLoginFailed'))
      setPasskeyLoading(false)
    }
  }

  const handleLogout = async () => {
    await logout()
    setLocalUser(null)
    setIsRedirecting(false)
    setAnimationPhase('idle')
    setCardSize(null)
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
  const isCompact = isHeightTransition || isCardFadeIn

  const enabledProviders = Object.entries(oauthStatus.providers).filter(([_, provider]) => provider.enabled)
  const altAuthCount = enabledProviders.length + (oauthStatus.passkeyEnabled ? 1 : 0)
  const hasAlternateAuth = altAuthCount > 0

  const fadeOutMotionStyle = {
    opacity: isFormFadeOut ? 0 : 1,
    transform: `translateY(${isFormFadeOut ? -14 : 0}px)`,
    transition: `opacity ${FADE_DURATION}ms ease-out, transform ${FADE_DURATION}ms ease-out`
  }

  const loginAside = (
    <div className="auth-aside-logo-only">
      <BrandMark size={148} className="w-[148px] h-[148px]" label={appName} />
    </div>
  )

  const desktopHeader = (
    <div className="auth-login-desktop-header" style={fadeOutMotionStyle}>
      <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--color-text-primary)' }}>
        {t('login')}
      </h1>
      <p className="mt-1 text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
        {t('loginToAccount')}
      </p>
    </div>
  )

  if (domainLoading || authLoading) {
    return (
      <AuthPage split aside={loginAside} desktopHeader={desktopHeader}>
        <div className="auth-login-mobile-header">
          <AuthHeader title={t('login')} description={t('loginToAccount')} />
        </div>
        <AuthLoading />
      </AuthPage>
    )
  }

  const cardStyle = isFormFadeOut && cardSize
    ? { width: cardSize.width, height: cardSize.height, maxWidth: '100%' }
    : isHeightTransition && cardSize
      ? {
          width: cardSize.width,
          height: cardSize.height,
          maxWidth: '100%',
          overflow: 'hidden',
          transition: `width ${HEIGHT_DURATION}ms cubic-bezier(0.22, 1, 0.36, 1), height ${HEIGHT_DURATION}ms cubic-bezier(0.22, 1, 0.36, 1)`
        }
      : isCardFadeIn
        ? {
            maxWidth: LOGIN_CARD_MAX_WIDTH,
            minHeight: cardSize?.height || LOGIN_CARD_HEIGHT
          }
        : undefined

  return (
    <AuthPage
      split
      compact={isCompact}
      cardRef={surfaceRef}
      aside={loginAside}
      desktopHeader={desktopHeader}
      asideStyle={fadeOutMotionStyle}
      cardStyle={cardStyle}
      toolbarStyle={{
        opacity: isAnimating ? 0 : 1,
        transform: `translateY(${isFormFadeOut ? -10 : 0}px)`,
        transition: `opacity ${FADE_DURATION}ms ease-out, transform ${FADE_DURATION}ms ease-out`,
        pointerEvents: isAnimating ? 'none' : 'auto'
      }}
      footerStyle={{
        opacity: isAnimating ? 0 : 1,
        transform: `translateY(${isAnimating ? 10 : 0}px)`,
        transition: `opacity ${FADE_DURATION}ms ease-out, transform ${FADE_DURATION}ms ease-out`
      }}
    >
      <div className="relative">
        {showForm && (
          <div style={fadeOutMotionStyle}>
            <div className="auth-login-mobile-header">
              <AuthHeader title={t('login')} description={t('loginToAccount')} />
            </div>

            {error && (
              <div
                role="alert"
                className="mb-3.5 p-3 rounded-lg text-sm"
                style={{
                  backgroundColor: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  color: '#ef4444'
                }}
              >
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-3.5">
              <div>
                <label
                  htmlFor="login-username"
                  className="block text-sm font-medium mb-1"
                  style={{ color: 'var(--color-text-secondary)' }}
                >
                  {t('username')}
                </label>
                <div className="auth-input-group">
                  <User aria-hidden="true" className="auth-input-icon" />
                  <input
                    id="login-username"
                    type="text"
                    value={username}
                    onChange={e => setUsername(e.target.value)}
                    className="auth-input-control"
                    placeholder="username"
                    autoComplete="username"
                    required
                    minLength={3}
                    maxLength={30}
                  />
                  {domain && <span className="auth-input-suffix">@{domain}</span>}
                </div>
              </div>

              <div>
                <label
                  htmlFor="login-password"
                  className="block text-sm font-medium mb-1"
                  style={{ color: 'var(--color-text-secondary)' }}
                >
                  {t('password')}
                </label>
                <div className="auth-input-group">
                  <Lock aria-hidden="true" className="auth-input-icon" />
                  <input
                    id="login-password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    className="auth-input-control"
                    placeholder="••••••••"
                    autoComplete="current-password"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(visible => !visible)}
                    aria-label={showPassword ? (zh ? '隐藏密码' : 'Hide password') : (zh ? '显示密码' : 'Show password')}
                    aria-pressed={showPassword}
                    className="auth-input-action"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" aria-hidden="true" /> : <Eye className="w-4 h-4" aria-hidden="true" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading || oauthLoading || passkeyLoading}
                className="auth-btn-primary w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium disabled:opacity-50"
              >
                {loading ? t('loading') : t('login')}
                {!loading && <ArrowRight className="w-4 h-4" aria-hidden="true" />}
              </button>
            </form>

            {hasAlternateAuth && (
              <div className="mt-4">
                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t" style={{ borderColor: 'var(--color-border-primary)' }}></div>
                  </div>
                  <div className="relative flex justify-center text-xs">
                    <span className="px-2" style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-tertiary)' }}>
                      {t('orContinueWith')}
                    </span>
                  </div>
                </div>

                <div
                  className={`mt-3 auth-alt-grid ${altAuthCount >= 2 ? 'auth-alt-grid--multi' : ''} ${altAuthCount > 1 && altAuthCount % 2 === 1 ? 'auth-alt-grid--odd' : ''}`}
                >
                  {enabledProviders.map(([providerId, provider]) => {
                    const isThisLoading = loadingProviderId === providerId
                    return (
                      <button
                        key={providerId}
                        type="button"
                        onClick={() => {
                          setLoadingProviderId(providerId)
                          setTimeout(() => {
                            window.location.href = `/api/oauth/${providerId}?redirect=${encodeURIComponent(redirectUrl)}`
                          }, 100)
                        }}
                        disabled={oauthLoading || passkeyLoading || loading}
                        className="auth-btn-secondary w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium disabled:cursor-not-allowed"
                        style={isThisLoading ? {
                          backgroundColor: 'var(--color-bg-tertiary)',
                          color: 'var(--color-text-tertiary)',
                          borderColor: 'var(--color-border-secondary)',
                          opacity: 0.75
                        } : oauthLoading ? { opacity: 0.6 } : undefined}
                      >
                        {isThisLoading ? (
                          <>
                            <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3"></circle>
                              <path className="opacity-75" stroke="currentColor" strokeWidth="3" strokeLinecap="round" d="M12 2a10 10 0 0 1 10 10"></path>
                            </svg>
                            <span>{t('oauthRedirecting')}</span>
                          </>
                        ) : (
                          <>
                            <ProviderIcon providerId={providerId} />
                            <span>{zh ? `使用 ${provider.displayName} 登录` : `Sign in with ${provider.displayName}`}</span>
                          </>
                        )}
                      </button>
                    )
                  })}

                  {oauthStatus.passkeyEnabled && (
                    <button
                      type="button"
                      onClick={handlePasskeyLogin}
                      disabled={passkeyLoading || oauthLoading || loading}
                      className="auth-btn-secondary w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium disabled:cursor-not-allowed"
                      style={passkeyLoading ? {
                        backgroundColor: 'var(--color-bg-tertiary)',
                        color: 'var(--color-text-tertiary)',
                        borderColor: 'var(--color-border-secondary)',
                        opacity: 0.75
                      } : undefined}
                    >
                      {passkeyLoading ? (
                        <>
                          <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3"></circle>
                            <path className="opacity-75" stroke="currentColor" strokeWidth="3" strokeLinecap="round" d="M12 2a10 10 0 0 1 10 10"></path>
                          </svg>
                          <span>{t('passkeyLoggingIn')}</span>
                        </>
                      ) : (
                        <>
                          <Fingerprint className="w-4 h-4 shrink-0" style={{ color: 'var(--color-accent-primary)' }} aria-hidden="true" />
                          <span>{t('passkeyLogin')}</span>
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>
            )}

            {registrationEnabled && (
              <p
                className="mt-4 text-center text-sm"
                style={{ color: 'var(--color-text-tertiary)' }}
              >
                {t('createAccount')}{' '}
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

        {user && isCompact && (
          <div
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
                {user.avatar || user.avatarUrl ? (
                  <img
                    src={user.avatarUrl || (user.avatar?.startsWith('http') ? user.avatar : `/api/auth/avatar/${user.avatar}`)}
                    alt={user.username}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <User className="w-8 h-8" style={{ color: 'var(--color-accent-primary)' }} aria-hidden="true" />
                )}
              </div>
              <h1 className="text-2xl font-bold break-words" style={{ color: 'var(--color-text-primary)' }}>
                {user.nickname || user.username}
              </h1>
              <p className="mt-1 break-words" style={{ color: 'var(--color-text-tertiary)' }}>
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
                    type="button"
                    onClick={handleContinue}
                    className="auth-btn-primary w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium"
                  >
                    {t('continue')}
                    <ArrowRight className="w-4 h-4" aria-hidden="true" />
                  </button>

                  <button
                    type="button"
                    onClick={handleLogout}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors"
                    style={{
                      backgroundColor: 'var(--color-bg-tertiary)',
                      color: 'var(--color-text-secondary)'
                    }}
                  >
                    <LogOut className="w-4 h-4" aria-hidden="true" />
                    {t('logout')}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </AuthPage>
  )
}
