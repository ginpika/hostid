/**
 * SSO 单点登录信息页面
 * 显示当前会话状态、Cookie 信息和 Token 解码内容
 * 提供刷新状态和登出功能
 */
import { useState, useEffect } from 'react'
import { Shield, Monitor, Key, Cookie, Clock, LogOut, RefreshCw, CheckCircle, XCircle, Info } from 'lucide-react'
import { useI18n } from '../i18n/I18nContext'

interface SessionInfo {
  authenticated: boolean
  user?: {
    id: string
    username: string
    email: string
    role: string
  }
}

interface CookieInfo {
  name: string
  value: string
  domain: string
  path: string
  expires: string
  httpOnly: boolean
  secure: boolean
  sameSite: string
}

interface DecodedToken {
  sessionId: string
  iat: number
  exp: number
}

export default function SSOInfoPage() {
  const { language } = useI18n()
  
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [cookieInfo, setCookieInfo] = useState<CookieInfo | null>(null)
  const [decodedToken, setDecodedToken] = useState<DecodedToken | null>(null)

  useEffect(() => {
    loadSessionInfo()
    parseCookieAndToken()
  }, [])

  const loadSessionInfo = async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true)
    }
    try {
      const res = await fetch('/api/sso/session', { credentials: 'include' })
      const data = await res.json()
      setSessionInfo(data)
    } catch (err) {
      setSessionInfo({ authenticated: false })
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  const parseCookieAndToken = () => {
    const cookies = document.cookie.split(';').reduce((acc, cookie) => {
      const [key, value] = cookie.trim().split('=')
      acc[key] = value
      return acc
    }, {} as Record<string, string>)

    const ssoToken = cookies['sso_token']
    
    if (ssoToken) {
      setCookieInfo({
        name: 'sso_token',
        value: ssoToken.substring(0, 20) + '...' + ssoToken.substring(ssoToken.length - 10),
        domain: window.location.hostname,
        path: '/',
        expires: 'Session (7 days)',
        httpOnly: true,
        secure: window.location.protocol === 'https:',
        sameSite: 'Lax'
      })

      try {
        const parts = ssoToken.split('.')
        if (parts.length === 3) {
          const payload = JSON.parse(atob(parts[1]))
          setDecodedToken({
            sessionId: payload.sessionId,
            iat: payload.iat,
            exp: payload.exp
          })
        }
      } catch (e) {
        console.error('Failed to decode token:', e)
      }
    }
  }

  const handleLogout = async () => {
    try {
      await fetch('/api/sso/logout', {
        method: 'POST',
        credentials: 'include'
      })
      setSessionInfo({ authenticated: false })
      setCookieInfo(null)
      setDecodedToken(null)
    } catch (err) {
      console.error('Logout failed:', err)
    }
  }

  const formatDate = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleString(language === 'zh-CN' ? 'zh-CN' : 'en-US')
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--color-bg-primary)' }}>
        <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: 'var(--color-accent-primary)' }}></div>
      </div>
    )
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--color-bg-primary)' }}>
      <header 
        className="border-b px-6 py-4 flex items-center gap-4"
        style={{ 
          backgroundColor: 'var(--color-bg-secondary)',
          borderColor: 'var(--color-border-primary)'
        }}
      >
        <Shield className="w-5 h-5" style={{ color: 'var(--color-accent-primary)' }} />
        <h1 className="text-lg font-semibold" style={{ color: 'var(--color-text-primary)' }}>
          {language === 'zh-CN' ? '单点登录信息' : 'SSO Information'}
        </h1>
      </header>

      <main className="max-w-4xl mx-auto p-6 space-y-6">
        <section>
          <div className="flex items-center gap-3 mb-4">
            <div 
              className="p-2 rounded-lg"
              style={{ backgroundColor: 'var(--color-accent-muted)' }}
            >
              <Monitor className="w-5 h-5" style={{ color: 'var(--color-accent-primary)' }} />
            </div>
            <h2 className="text-lg font-semibold" style={{ color: 'var(--color-text-primary)' }}>
              {language === 'zh-CN' ? '登录状态' : 'Login Status'}
            </h2>
          </div>
          
          <div 
            className="rounded-xl p-6"
            style={{ 
              backgroundColor: 'var(--color-bg-secondary)',
              border: '1px solid var(--color-border-primary)'
            }}
          >
            {sessionInfo?.authenticated ? (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <CheckCircle className="w-6 h-6" style={{ color: 'var(--color-accent-primary)' }} />
                  <span className="font-medium" style={{ color: 'var(--color-accent-primary)' }}>
                    {language === 'zh-CN' ? '已登录' : 'Authenticated'}
                  </span>
                </div>
                
                <div className="grid grid-cols-2 gap-4 mt-4">
                  <div>
                    <label className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>
                      {language === 'zh-CN' ? '用户名' : 'Username'}
                    </label>
                    <p className="font-mono text-sm mt-1" style={{ color: 'var(--color-text-primary)' }}>
                      {sessionInfo.user?.username}
                    </p>
                  </div>
                  <div>
                    <label className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>
                      {language === 'zh-CN' ? '邮箱' : 'Email'}
                    </label>
                    <p className="font-mono text-sm mt-1" style={{ color: 'var(--color-text-primary)' }}>
                      {sessionInfo.user?.email}
                    </p>
                  </div>
                  <div>
                    <label className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>
                      {language === 'zh-CN' ? '用户ID' : 'User ID'}
                    </label>
                    <p className="font-mono text-sm mt-1" style={{ color: 'var(--color-text-primary)' }}>
                      {sessionInfo.user?.id}
                    </p>
                  </div>
                  <div>
                    <label className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>
                      {language === 'zh-CN' ? '角色' : 'Role'}
                    </label>
                    <p className="font-mono text-sm mt-1" style={{ color: 'var(--color-text-primary)' }}>
                      {sessionInfo.user?.role}
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <XCircle className="w-6 h-6" style={{ color: '#ef4444' }} />
                <span className="font-medium" style={{ color: '#ef4444' }}>
                  {language === 'zh-CN' ? '未登录' : 'Not Authenticated'}
                </span>
              </div>
            )}
          </div>
        </section>

        {cookieInfo && (
          <section>
            <div className="flex items-center gap-3 mb-4">
              <div 
                className="p-2 rounded-lg"
                style={{ backgroundColor: 'var(--color-accent-muted)' }}
              >
                <Cookie className="w-5 h-5" style={{ color: 'var(--color-accent-primary)' }} />
              </div>
              <h2 className="text-lg font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                {language === 'zh-CN' ? 'Cookie 信息' : 'Cookie Information'}
              </h2>
            </div>
            
            <div 
              className="rounded-xl p-6"
              style={{ 
                backgroundColor: 'var(--color-bg-secondary)',
                border: '1px solid var(--color-border-primary)'
              }}
            >
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>
                      {language === 'zh-CN' ? '名称' : 'Name'}
                    </label>
                    <p className="font-mono text-sm mt-1" style={{ color: 'var(--color-text-primary)' }}>
                      {cookieInfo.name}
                    </p>
                  </div>
                  <div>
                    <label className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>
                      {language === 'zh-CN' ? '域' : 'Domain'}
                    </label>
                    <p className="font-mono text-sm mt-1" style={{ color: 'var(--color-text-primary)' }}>
                      {cookieInfo.domain}
                    </p>
                  </div>
                  <div>
                    <label className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>
                      {language === 'zh-CN' ? '路径' : 'Path'}
                    </label>
                    <p className="font-mono text-sm mt-1" style={{ color: 'var(--color-text-primary)' }}>
                      {cookieInfo.path}
                    </p>
                  </div>
                  <div>
                    <label className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>
                      {language === 'zh-CN' ? '有效期' : 'Expires'}
                    </label>
                    <p className="font-mono text-sm mt-1" style={{ color: 'var(--color-text-primary)' }}>
                      {cookieInfo.expires}
                    </p>
                  </div>
                </div>
                
                <div>
                  <label className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>
                    {language === 'zh-CN' ? '值 (已截断)' : 'Value (Truncated)'}
                  </label>
                  <p 
                    className="font-mono text-xs mt-1 p-2 rounded-lg break-all"
                    style={{ 
                      color: 'var(--color-text-primary)',
                      backgroundColor: 'var(--color-bg-tertiary)'
                    }}
                  >
                    {cookieInfo.value}
                  </p>
                </div>

                <div className="flex gap-4 mt-4">
                  <div className="flex items-center gap-2">
                    <div 
                      className={`w-3 h-3 rounded-full ${cookieInfo.httpOnly ? 'bg-green-500' : 'bg-red-500'}`}
                    />
                    <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                      HttpOnly
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div 
                      className={`w-3 h-3 rounded-full ${cookieInfo.secure ? 'bg-green-500' : 'bg-yellow-500'}`}
                    />
                    <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                      Secure
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div 
                      className="w-3 h-3 rounded-full bg-blue-500"
                    />
                    <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                      SameSite: {cookieInfo.sameSite}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {decodedToken && (
          <section>
            <div className="flex items-center gap-3 mb-4">
              <div 
                className="p-2 rounded-lg"
                style={{ backgroundColor: 'var(--color-accent-muted)' }}
              >
                <Key className="w-5 h-5" style={{ color: 'var(--color-accent-primary)' }} />
              </div>
              <h2 className="text-lg font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                {language === 'zh-CN' ? 'Token 解码信息' : 'Token Decoded'}
              </h2>
            </div>
            
            <div 
              className="rounded-xl p-6"
              style={{ 
                backgroundColor: 'var(--color-bg-secondary)',
                border: '1px solid var(--color-border-primary)'
              }}
            >
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>
                    {language === 'zh-CN' ? '会话ID' : 'Session ID'}
                  </label>
                  <p 
                    className="font-mono text-xs mt-1 p-2 rounded-lg break-all"
                    style={{ 
                      color: 'var(--color-text-primary)',
                      backgroundColor: 'var(--color-bg-tertiary)'
                    }}
                  >
                    {decodedToken.sessionId}
                  </p>
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>
                      {language === 'zh-CN' ? '签发时间' : 'Issued At'}
                    </label>
                    <p className="font-mono text-sm mt-1" style={{ color: 'var(--color-text-primary)' }}>
                      {formatDate(decodedToken.iat)}
                    </p>
                  </div>
                  <div>
                    <label className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>
                      {language === 'zh-CN' ? '过期时间' : 'Expires At'}
                    </label>
                    <p className="font-mono text-sm mt-1" style={{ color: 'var(--color-text-primary)' }}>
                      {formatDate(decodedToken.exp)}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 mt-4">
                  <Clock className="w-4 h-4" style={{ color: 'var(--color-text-muted)' }} />
                  <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    {language === 'zh-CN' 
                      ? `剩余有效期: ${Math.max(0, Math.floor((decodedToken.exp * 1000 - Date.now()) / 1000 / 60 / 60))} 小时`
                      : `Remaining: ${Math.max(0, Math.floor((decodedToken.exp * 1000 - Date.now()) / 1000 / 60 / 60))} hours`}
                  </span>
                </div>
              </div>
            </div>
          </section>
        )}

        <section>
          <div className="flex items-center gap-3 mb-4">
            <div 
              className="p-2 rounded-lg"
              style={{ backgroundColor: 'rgba(251, 191, 36, 0.15)' }}
            >
              <Info className="w-5 h-5" style={{ color: '#fbbf24' }} />
            </div>
            <h2 className="text-lg font-semibold" style={{ color: 'var(--color-text-primary)' }}>
              {language === 'zh-CN' ? '操作' : 'Actions'}
            </h2>
          </div>
          
          <div 
            className="rounded-xl p-6"
            style={{ 
              backgroundColor: 'var(--color-bg-secondary)',
              border: '1px solid var(--color-border-primary)'
            }}
          >
            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => loadSessionInfo(true)}
                disabled={refreshing}
                className="flex items-center gap-2 px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
                style={{ 
                  backgroundColor: 'var(--color-bg-tertiary)',
                  color: 'var(--color-text-primary)'
                }}
              >
                <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
                {refreshing 
                  ? (language === 'zh-CN' ? '刷新中...' : 'Refreshing...') 
                  : (language === 'zh-CN' ? '刷新状态' : 'Refresh')}
              </button>
              
              {sessionInfo?.authenticated && (
                <button
                  onClick={handleLogout}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg transition-colors"
                  style={{ 
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    color: '#ef4444'
                  }}
                >
                  <LogOut className="w-4 h-4" />
                  {language === 'zh-CN' ? '登出所有会话' : 'Logout All Sessions'}
                </button>
              )}
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}
