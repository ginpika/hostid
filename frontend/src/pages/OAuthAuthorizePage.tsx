import { useState, useEffect } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { Shield, Check, X, User, ExternalLink } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useI18n } from '../i18n/I18nContext'

interface ScopeInfo {
  name: string
  description: string
}

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
  scope: ScopeInfo[]
  requestedScope: string
  clientId: string
  redirectUri: string
  state: string | null
  codeChallenge: string | null
  codeChallengeMethod: string
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

  // Get OAuth parameters from URL
  const clientId = searchParams.get('client_id')
  const redirectUri = searchParams.get('redirect_uri')
  const responseType = searchParams.get('response_type')
  const scope = searchParams.get('scope') || 'openid profile email'
  const state = searchParams.get('state')
  const codeChallenge = searchParams.get('code_challenge')
  const codeChallengeMethod = searchParams.get('code_challenge_method') || 'S256'

  useEffect(() => {
    if (!user) {
      // User not logged in, redirect to login
      navigate('/login', { state: { from: window.location.pathname + window.location.search } })
      return
    }

    if (!clientId || !redirectUri || responseType !== 'code') {
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
        response_type: 'code',
        client_id: clientId!,
        redirect_uri: redirectUri!,
        scope,
        ...(state && { state }),
        ...(codeChallenge && { code_challenge: codeChallenge }),
        ...(codeChallengeMethod && { code_challenge_method: codeChallengeMethod })
      })

      const res = await fetch(`/api/oauth2/authorize?${params}`, {
        headers: { Authorization: `Bearer ${token}` }
      })

      if (res.ok) {
        const result = await res.json()
        setData(result)
      } else {
        const result = await res.json()
        setError(result.error || (language === 'zh-CN' ? '获取授权信息失败' : 'Failed to fetch authorization info'))
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
          redirect_uri: data.redirectUri,
          scope: data.requestedScope,
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
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--color-bg-primary)' }}>
        <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: 'var(--color-accent-primary)' }}></div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{ backgroundColor: 'var(--color-bg-primary)' }}>
        <div
          className="max-w-md w-full p-6 rounded-xl text-center"
          style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border-primary)' }}
        >
          <X className="w-12 h-12 mx-auto mb-4 text-red-500" />
          <h2 className="text-xl font-semibold mb-2" style={{ color: 'var(--color-text-primary)' }}>
            {language === 'zh-CN' ? '授权错误' : 'Authorization Error'}
          </h2>
          <p style={{ color: 'var(--color-text-secondary)' }}>{error}</p>
        </div>
      </div>
    )
  }

  if (!data) return null

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ backgroundColor: 'var(--color-bg-primary)' }}>
      <div
        className="max-w-md w-full rounded-xl overflow-hidden shadow-xl"
        style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border-primary)' }}
      >
        {/* Header */}
        <div
          className="px-6 py-4 border-b"
          style={{ borderColor: 'var(--color-border-primary)', backgroundColor: 'var(--color-bg-tertiary)' }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center"
              style={{ backgroundColor: 'var(--color-accent-muted)' }}
            >
              <Shield className="w-5 h-5" style={{ color: 'var(--color-accent-primary)' }} />
            </div>
            <div>
              <h1 className="text-lg font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                {t('authorizeApp')}
              </h1>
              <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                {language === 'zh-CN' ? '验证应用权限请求' : 'Verify app permission request'}
              </p>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="p-6">
          {/* App Info */}
          <div className="text-center mb-6">
            <h2 className="text-xl font-semibold mb-1" style={{ color: 'var(--color-text-primary)' }}>
              {data.app.name}
            </h2>
            {data.app.description && (
              <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                {data.app.description}
              </p>
            )}
            {data.app.homepage && (
              <a
                href={data.app.homepage}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm mt-1 hover:underline"
                style={{ color: 'var(--color-accent-primary)' }}
              >
                {data.app.homepage}
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>

          {/* User Info */}
          <div
            className="mb-6 p-3 rounded-lg flex items-center gap-3"
            style={{ backgroundColor: 'var(--color-bg-tertiary)' }}
          >
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center"
              style={{ backgroundColor: 'var(--color-accent-muted)' }}
            >
              <User className="w-4 h-4" style={{ color: 'var(--color-accent-primary)' }} />
            </div>
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
                {data.user.nickname || data.user.username}
              </p>
              <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                {data.user.email}
              </p>
            </div>
          </div>

          {/* Permissions */}
          <div className="mb-6">
            <p className="text-sm font-medium mb-3" style={{ color: 'var(--color-text-secondary)' }}>
              {t('appPermissions')}
            </p>
            <div className="space-y-2">
              {data.scope.map((s, index) => (
                <div
                  key={index}
                  className="flex items-center gap-3 p-2 rounded-lg"
                  style={{ backgroundColor: 'var(--color-bg-tertiary)' }}
                >
                  <Check className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--color-accent-primary)' }} />
                  <div>
                    <p className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
                      {s.name}
                    </p>
                    <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                      {s.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Warning */}
          <p className="text-xs mb-6" style={{ color: 'var(--color-text-muted)' }}>
            {language === 'zh-CN'
              ? '授权后，该应用将能够访问上述信息。请确保您信任该应用。'
              : 'By authorizing, this app will be able to access the information above. Make sure you trust this app.'}
          </p>

          {/* Actions */}
          <div className="flex gap-3">
            <button
              onClick={() => handleAuthorize(false)}
              disabled={submitting}
              className="flex-1 px-4 py-3 rounded-lg font-medium transition-colors disabled:opacity-50"
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
              className="flex-1 px-4 py-3 rounded-lg font-medium transition-colors disabled:opacity-50"
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
      </div>
    </div>
  )
}