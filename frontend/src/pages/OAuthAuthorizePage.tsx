/**
 * OAuth 授权确认页面
 * 显示第三方应用请求授权的信息
 * 用户可批准或拒绝授权请求
 */
import { useState, useEffect } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { Shield, X, User, ExternalLink } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useI18n } from '../i18n/I18nContext'
import AuthPage, { AuthHeader, AuthLoading } from '../components/AuthPage'
import BrandMark from '../components/BrandMark'
import '../styles/oauth-authorize.css'

interface AuthorizeData {
  app: {
    name: string
    description: string | null
    homepage: string | null
  }
  user: {
    username: string
    nickname: string | null
    email: string
  }
  clientId: string
  redirectUri: string
  state: string | null
  codeChallenge: string | null
  codeChallengeMethod: string
}

function AuthorizeHeader() {
  const { t } = useI18n()
  return (
    <div className="text-center mb-8">
      <BrandMark size={100} className="mx-auto w-[100px] h-[100px]" label="HostID" />
      <h1 className="sr-only">{t('authorizeApp')}</h1>
    </div>
  )
}

export default function OAuthAuthorizePage() {
  const { user } = useAuth()
  const { t, language } = useI18n()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [data, setData] = useState<AuthorizeData | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [failedAvatarUrl, setFailedAvatarUrl] = useState<string | null>(null)

  const avatarUrl = user?.avatarUrl || (user?.avatar
    ? user.avatar.startsWith('http') ? user.avatar : `/api/auth/avatar/${user.avatar}`
    : null)

  // Get OAuth parameters from URL
  const clientId = searchParams.get('client_id')
  const redirectUri = searchParams.get('redirect_uri')
  const responseType = searchParams.get('response_type')
  const scope = searchParams.get('scope') || ''
  const state = searchParams.get('state')
  const codeChallenge = searchParams.get('code_challenge')
  const codeChallengeMethod = searchParams.get('code_challenge_method') || 'S256'

  useEffect(() => {
    if (!user) {
      // User not logged in, redirect to login
      navigate('/login', { state: { from: window.location.pathname + window.location.search } })
      return
    }

    if (!clientId) {
      setError(language === 'zh-CN' ? '无效的授权请求' : 'Invalid authorization request')
      setLoading(false)
      return
    }

    fetchAuthorizeData()
  }, [user, clientId, redirectUri])

  const fetchAuthorizeData = async () => {
    setLoading(true)
    try {
      const token = localStorage.getItem('token')
      const params = new URLSearchParams({
        response_type: responseType || '',
        client_id: clientId!,
        ...(redirectUri && { redirect_uri: redirectUri }),
        ...(scope && { scope }),
        ...(state && { state }),
        ...(codeChallenge && { code_challenge: codeChallenge }),
        ...(codeChallengeMethod && { code_challenge_method: codeChallengeMethod! })
      })

      const res = await fetch(`/api/oauth2/authorize?${params}`, {
        headers: { Authorization: `Bearer ${token}` }
      })

      if (res.ok) {
        const result = await res.json()
        setData(result)
      } else {
        const result = await res.json()
        // 可重定向的 OAuth 错误（RFC 6749 4.1.2.1）交回客户端
        if (result.redirectUrl) {
          window.location.href = result.redirectUrl
          return
        }
        setError(result.error_description || result.error || (language === 'zh-CN' ? '获取授权信息失败' : 'Failed to fetch authorization info'))
      }
    } catch (err) {
      console.error('Failed to fetch authorize data:', err)
      setError(language === 'zh-CN' ? '获取授权信息失败' : 'Failed to fetch authorization info')
    } finally {
      setLoading(false)
    }
  }

  const handleAuthorize = async (approve: boolean) => {
    if (!data) return

    setSubmitting(true)
    try {
      const token = localStorage.getItem('token')
      const res = await fetch('/api/oauth2/authorize', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          client_id: data.clientId,
          // 原样传回 authorize 请求中的 redirect_uri / scope（RFC 6749 4.1.3）
          ...(redirectUri && { redirect_uri: redirectUri }),
          ...(scope && { scope }),
          state: data.state,
          code_challenge: data.codeChallenge,
          code_challenge_method: data.codeChallengeMethod,
          approve: approve ? 'true' : 'false'
        })
      })

      if (res.ok) {
        const result = await res.json()
        // Redirect to the callback URL
        window.location.href = result.redirectUrl
      } else {
        const result = await res.json()
        setError(result.error || (language === 'zh-CN' ? '授权失败' : 'Authorization failed'))
      }
    } catch (err) {
      console.error('Failed to authorize:', err)
      setError(language === 'zh-CN' ? '授权失败' : 'Authorization failed')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <AuthPage>
        <AuthorizeHeader />
        <AuthLoading message={t('loading')} />
      </AuthPage>
    )
  }

  if (error) {
    return (
      <AuthPage>
        <AuthHeader title={language === 'zh-CN' ? '授权错误' : 'Authorization Error'} />
        <div role="alert" className="p-3 rounded-lg text-sm flex items-start gap-2" style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', color: '#ef4444' }}>
          <X aria-hidden="true" className="w-5 h-5 shrink-0" />
          <p className="break-words min-w-0">{error}</p>
        </div>
      </AuthPage>
    )
  }

  if (!data) return null

  return (
    <AuthPage>
      <AuthorizeHeader />

      {/* Content */}
      <div>
        <section className="oauth-connection" aria-label={language === 'zh-CN' ? '授权账号与应用' : 'Authorizing account and app'}>
          <div className="oauth-connection__identity">
            <div className="oauth-connection__portrait oauth-connection__portrait--user">
              {avatarUrl && avatarUrl !== failedAvatarUrl ? (
                <img src={avatarUrl} alt="" onError={() => setFailedAvatarUrl(avatarUrl)} />
              ) : (
                <User aria-hidden="true" size={30} strokeWidth={1.5} />
              )}
            </div>
            <p className="oauth-connection__label">{language === 'zh-CN' ? '当前账号' : 'Your account'}</p>
            <p className="oauth-connection__name">{data.user.nickname || data.user.username}</p>
            <p className="oauth-connection__email">{data.user.email}</p>
          </div>

          <div className="oauth-connection__flow" aria-hidden="true">
            {Array.from({ length: 7 }, (_, index) => (
              <span key={index} className="oauth-connection__dot" style={{ animationDelay: `${index * 140 - 1600}ms` }} />
            ))}
          </div>

          <div className="oauth-connection__identity">
            <div className="oauth-connection__portrait oauth-connection__portrait--app">
              <Shield aria-hidden="true" size={30} strokeWidth={1.5} />
            </div>
            <p className="oauth-connection__label">{language === 'zh-CN' ? '待授权应用' : 'Requesting app'}</p>
            <h2 className="oauth-connection__name">{data.app.name}</h2>
            {data.app.homepage && (
              <a href={data.app.homepage} target="_blank" rel="noopener noreferrer" className="oauth-connection__homepage">
                <span>{data.app.homepage}</span>
                <ExternalLink aria-hidden="true" size={11} />
              </a>
            )}
          </div>
        </section>

        {/* Warning */}
        <p className="text-sm leading-relaxed mb-6" style={{ color: 'var(--color-text-tertiary)' }}>
          {language === 'zh-CN'
            ? '授权后，该应用将能够访问您的个人资料。请确保您信任该应用。'
            : 'By authorizing, this app will be able to access your profile information. Make sure you trust this app.'}
        </p>

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={() => handleAuthorize(false)}
            disabled={submitting}
            className="flex-1 px-4 py-2.5 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              backgroundColor: 'var(--color-bg-tertiary)',
              color: 'var(--color-text-primary)'
            }}
          >
            {t('deny')}
          </button>
          <button
            onClick={() => handleAuthorize(true)}
            disabled={submitting}
            className="flex-1 px-4 py-2.5 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              backgroundColor: 'var(--color-accent-primary)',
              color: 'var(--color-accent-text)'
            }}
          >
            {submitting ? (
              <span className="flex items-center justify-center gap-2">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2" style={{ borderColor: 'var(--color-accent-text)' }}></div>
                {language === 'zh-CN' ? '处理中...' : 'Processing...'}
              </span>
            ) : (
              t('approve')
            )}
          </button>
        </div>
      </div>
    </AuthPage>
  )
}
