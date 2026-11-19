/**
 * SSO 单点登录个人中心页面
 * 移动端与竖屏采用单栏卡片布局，PC 与横屏平板采用左右分栏个人中心卡片设计
 * 显示当前会话状态、账号资料、Cookie/Token 状态并提供刷新与登出功能
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertCircle,
  Check,
  CheckCircle,
  Clock,
  Cookie,
  Copy,
  Info,
  Key,
  LogIn,
  LogOut,
  Mail,
  Monitor,
  RefreshCw,
  Shield,
  ShieldCheck,
  User,
  UserRound,
  XCircle
} from 'lucide-react'
import { useI18n } from '../i18n/I18nContext'
import { useConfig } from '../contexts/ConfigContext'
import { useAuth } from '../contexts/AuthContext'
import AuthPage, { AuthHeader, AuthLoading } from '../components/AuthPage'
import BrandMark from '../components/BrandMark'
import {
  formatRemainingHours,
  parseSsoCookieAndToken,
  resolveSsoAvatarUrl,
  type CookieInfo,
  type DecodedToken
} from '../lib/ssoInfo'
import '../styles/sso-info.css'

interface SessionUser {
  id: string
  username: string
  nickname?: string | null
  email: string
  role: string
  avatar?: string | null
  avatarUrl?: string | null
}

interface SessionInfo {
  authenticated: boolean
  user?: SessionUser
}

type CopyableField = 'userId' | 'sessionId'

function CopyValueButton({
  copied,
  label,
  copiedLabel,
  onCopy
}: {
  copied: boolean
  label: string
  copiedLabel: string
  onCopy: () => void
}) {
  return (
    <button
      type="button"
      onClick={onCopy}
      className={`sso-copy-btn ${copied ? 'is-copied' : ''}`}
      aria-label={copied ? copiedLabel : label}
      title={copied ? copiedLabel : label}
    >
      {copied ? <Check className="w-3.5 h-3.5" aria-hidden="true" /> : <Copy className="w-3.5 h-3.5" aria-hidden="true" />}
    </button>
  )
}

function SsoAvatar({
  avatarUrl,
  failedAvatarUrl,
  large = false,
  onError
}: {
  avatarUrl: string | null
  failedAvatarUrl: string | null
  large?: boolean
  onError: (url: string) => void
}) {
  return (
    <div className="sso-avatar-wrap">
      <div className={`sso-avatar ${large ? 'sso-avatar--lg' : ''}`}>
        {avatarUrl && avatarUrl !== failedAvatarUrl ? (
          <img src={avatarUrl} alt="" onError={() => onError(avatarUrl)} />
        ) : (
          <User className={large ? 'w-9 h-9' : 'w-6 h-6'} aria-hidden="true" />
        )}
      </div>
      <span className="sso-avatar-dot" aria-hidden="true" />
    </div>
  )
}

function SsoActions({
  authenticated,
  refreshing,
  loggingOut,
  showWorkspaceLinks,
  copy,
  onRefresh,
  onLogout
}: {
  authenticated: boolean
  refreshing: boolean
  loggingOut: boolean
  showWorkspaceLinks: boolean
  copy: {
    refresh: string
    refreshing: string
    logoutAll: string
    loggingOut: string
    signIn: string
    openMailbox: string
    openProfile: string
    quickLinksLabel: string
  }
  onRefresh: () => void
  onLogout: () => void
}) {
  return (
    <div className="sso-actions-stack">
      {authenticated ? (
        <>
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing || loggingOut}
            className="sso-btn auth-btn-primary"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span>{refreshing ? copy.refreshing : copy.refresh}</span>
          </button>

          <button
            type="button"
            onClick={onLogout}
            disabled={loggingOut || refreshing}
            className="sso-btn sso-btn--danger"
          >
            <LogOut className="w-4 h-4" aria-hidden="true" />
            <span>{loggingOut ? copy.loggingOut : copy.logoutAll}</span>
          </button>

          {showWorkspaceLinks && (
            <nav className="sso-quick-links" aria-label={copy.quickLinksLabel}>
              <Link to="/" className="sso-quick-link">
                <Mail className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{copy.openMailbox}</span>
              </Link>
              <Link to="/profile" className="sso-quick-link">
                <UserRound className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{copy.openProfile}</span>
              </Link>
            </nav>
          )}
        </>
      ) : (
        <>
          <Link to="/login?redirect=%2Fsso%2Finfo" className="sso-btn auth-btn-primary">
            <LogIn className="w-4 h-4" aria-hidden="true" />
            <span>{copy.signIn}</span>
          </Link>

          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            className="sso-btn auth-btn-secondary"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span>{refreshing ? copy.refreshing : copy.refresh}</span>
          </button>
        </>
      )}
    </div>
  )
}

export default function SSOInfoPage() {
  const { language } = useI18n()
  const { siteName } = useConfig()
  const { user: authUser, setUser: setAuthUser } = useAuth()
  const zh = language === 'zh-CN'

  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const [errorType, setErrorType] = useState<'fetch' | 'logout' | null>(null)
  const [cookieInfo, setCookieInfo] = useState<CookieInfo | null>(null)
  const [decodedToken, setDecodedToken] = useState<DecodedToken | null>(null)
  const [failedAvatarUrl, setFailedAvatarUrl] = useState<string | null>(null)
  const [copiedField, setCopiedField] = useState<CopyableField | null>(null)
  const copyTimerRef = useRef<number | null>(null)

  const copy = zh ? {
    title: '单点登录信息',
    subtitle: 'SSO 个人中心 · 会话状态与身份凭证',
    checkingSession: '正在校验会话',
    checkingHint: '请稍候…',
    loginStatus: '登录状态',
    accountSession: '账号与会话',
    authenticated: '已登录',
    activeBadge: '会话有效',
    notAuthenticated: '未登录',
    signedOutHint: '暂无活动 SSO 会话',
    noSessionTitle: '当前未检测到有效的 SSO 登录会话',
    noSessionDesc: '登录后，同一信任域下的 HostID 及关联应用将自动共享您的单点登录会话。',
    username: '用户名',
    email: '邮箱',
    userId: '用户 ID',
    role: '角色',
    cookieInfo: 'Cookie 信息',
    name: '名称',
    domain: '域',
    path: '路径',
    expires: '有效期',
    truncatedValue: '值 (已截断)',
    tokenDecoded: 'Token 解码信息',
    sessionId: '会话 ID',
    issuedAt: '签发时间',
    expiresAt: '过期时间',
    remainingHours: (h: number) => `剩余有效期: ${h} 小时`,
    sessionSecurity: '会话凭证与安全',
    credentialMode: '凭证模式',
    credentialHttpOnly: 'HttpOnly Cookie',
    protected: '受保护',
    host: '当前主机',
    transport: '传输协议',
    verification: '校验状态',
    verifiedApi: '已通过 /api/sso/session 验证',
    httpOnlyNote: 'SSO 令牌已启用 HttpOnly 保护，浏览器脚本无法读取明文 Cookie，可有效降低 XSS 窃取风险。',
    protocol: '协议',
    sessionEndpoint: '会话接口',
    signInRoute: '登录入口',
    authState: '认证状态',
    actions: '操作',
    refresh: '刷新状态',
    refreshing: '刷新中…',
    logoutAll: '登出所有会话',
    loggingOut: '登出中…',
    signIn: '前往登录',
    openMailbox: '进入邮箱',
    openProfile: '个人资料',
    quickLinksLabel: '快捷导航',
    copyValue: '复制',
    copied: '已复制',
    sessionFetchError: '无法获取 SSO 会话状态，请检查网络连接后重试。',
    logoutError: '登出请求失败，请稍后重试。'
  } : {
    title: 'SSO Information',
    subtitle: 'SSO Personal Center · Session status & credentials',
    checkingSession: 'Checking session',
    checkingHint: 'Please wait…',
    loginStatus: 'Login Status',
    accountSession: 'Account & Session',
    authenticated: 'Authenticated',
    activeBadge: 'Active',
    notAuthenticated: 'Not Authenticated',
    signedOutHint: 'No active SSO session',
    noSessionTitle: 'No active SSO session detected',
    noSessionDesc: 'Sign in to share your authenticated HostID session across trusted applications on this domain.',
    username: 'Username',
    email: 'Email',
    userId: 'User ID',
    role: 'Role',
    cookieInfo: 'Cookie Information',
    name: 'Name',
    domain: 'Domain',
    path: 'Path',
    expires: 'Expires',
    truncatedValue: 'Value (Truncated)',
    tokenDecoded: 'Token Decoded',
    sessionId: 'Session ID',
    issuedAt: 'Issued At',
    expiresAt: 'Expires At',
    remainingHours: (h: number) => `Remaining: ${h} hours`,
    sessionSecurity: 'Session Credentials & Security',
    credentialMode: 'Credential Mode',
    credentialHttpOnly: 'HttpOnly Cookie',
    protected: 'Protected',
    host: 'Host',
    transport: 'Transport',
    verification: 'Verification',
    verifiedApi: 'Verified via /api/sso/session',
    httpOnlyNote: 'Your SSO token is stored in an HttpOnly cookie, keeping raw token contents inaccessible to client scripts.',
    protocol: 'Protocol',
    sessionEndpoint: 'Session Endpoint',
    signInRoute: 'Sign-in Route',
    authState: 'Auth State',
    actions: 'Actions',
    refresh: 'Refresh',
    refreshing: 'Refreshing…',
    logoutAll: 'Logout All Sessions',
    loggingOut: 'Logging out…',
    signIn: 'Sign In',
    openMailbox: 'Open Mailbox',
    openProfile: 'Profile',
    quickLinksLabel: 'Quick links',
    copyValue: 'Copy',
    copied: 'Copied',
    sessionFetchError: 'Could not reach the SSO session service. Please try again.',
    logoutError: 'Failed to sign out. Please try again.'
  }

  const syncCookieState = useCallback(() => {
    const parsed = parseSsoCookieAndToken(document.cookie, {
      hostname: window.location.hostname,
      protocol: window.location.protocol
    })
    setCookieInfo(parsed.cookieInfo)
    setDecodedToken(parsed.decodedToken)
  }, [])

  const loadSessionInfo = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true)
    }
    setErrorType(null)
    syncCookieState()
    try {
      const res = await fetch('/api/sso/session', {
        credentials: 'include',
        cache: 'no-store'
      })
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`)
      }
      const data = (await res.json()) as SessionInfo
      setSessionInfo(data)
    } catch {
      setErrorType('fetch')
      setSessionInfo(prev => prev ?? { authenticated: false })
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [syncCookieState])

  useEffect(() => {
    void loadSessionInfo(false)
    return () => {
      if (copyTimerRef.current != null) {
        window.clearTimeout(copyTimerRef.current)
      }
    }
  }, [loadSessionInfo])

  const handleLogout = async () => {
    if (loggingOut) return
    setLoggingOut(true)
    setErrorType(null)
    try {
      const res = await fetch('/api/sso/logout', {
        method: 'POST',
        credentials: 'include'
      })
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`)
      }
      setSessionInfo({ authenticated: false })
      setCookieInfo(null)
      setDecodedToken(null)
      if (authUser || localStorage.getItem('token')) {
        localStorage.removeItem('token')
        setAuthUser(null)
      }
    } catch {
      setErrorType('logout')
    } finally {
      setLoggingOut(false)
    }
  }

  const handleCopy = async (field: CopyableField, value: string) => {
    try {
      await navigator.clipboard?.writeText(value)
      setCopiedField(field)
      if (copyTimerRef.current != null) {
        window.clearTimeout(copyTimerRef.current)
      }
      copyTimerRef.current = window.setTimeout(() => {
        setCopiedField(null)
      }, 2000)
    } catch {
      // Clipboard may be unavailable in restricted contexts.
    }
  }

  const formatDate = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleString(zh ? 'zh-CN' : 'en-US')
  }

  const authenticated = Boolean(sessionInfo?.authenticated && sessionInfo.user)
  const ssoUser = sessionInfo?.user
  const avatarUrl = resolveSsoAvatarUrl(ssoUser)
  const displayName = ssoUser?.nickname || ssoUser?.username || ''
  const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:'
  const hostName = typeof window !== 'undefined' ? window.location.hostname : ''
  const showWorkspaceLinks = Boolean(authUser && authenticated)
  const errorMsg = errorType === 'fetch' ? copy.sessionFetchError : errorType === 'logout' ? copy.logoutError : ''

  const desktopHeader = (
    <div className="sso-desktop-header">
      <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--color-text-primary)' }}>
        {copy.title}
      </h1>
      <p className="mt-1 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
        {copy.subtitle}
      </p>
    </div>
  )

  const asideBrand = (
    <div className="sso-aside-brand">
      <BrandMark size={28} className="w-7 h-7 rounded-lg" label={siteName} />
      <span className="sso-aside-brand-name">{siteName}</span>
      <span className="sso-aside-brand-tag">SSO</span>
    </div>
  )

  if (loading) {
    const loadingAside = (
      <div className="sso-aside">
        {asideBrand}
        <div className="sso-aside-profile">
          <div className="sso-avatar sso-avatar--guest">
            <Shield className="w-8 h-8" aria-hidden="true" />
          </div>
          <p className="sso-aside-name">{copy.checkingSession}</p>
          <p className="sso-aside-meta">{copy.checkingHint}</p>
        </div>
        <div />
      </div>
    )

    return (
      <AuthPage
        split
        aside={loadingAside}
        desktopHeader={desktopHeader}
        shellClassName="sso-auth-shell"
        cardClassName="sso-auth-card sso-auth-card--centered"
      >
        <div className="sso-mobile-header">
          <AuthHeader title={copy.title} description={copy.subtitle} />
        </div>
        <AuthLoading />
      </AuthPage>
    )
  }

  const aside = (
    <div className="sso-aside">
      {asideBrand}

      {authenticated && ssoUser ? (
        <div className="sso-aside-profile">
          <SsoAvatar
            avatarUrl={avatarUrl}
            failedAvatarUrl={failedAvatarUrl}
            large
            onError={setFailedAvatarUrl}
          />

          <h2 className="sso-aside-name">{displayName}</h2>
          <p className="sso-aside-meta">
            <span>@{ssoUser.username}</span>
            <span>·</span>
            <span className="sso-role-badge">{ssoUser.role}</span>
          </p>

          <div className="sso-aside-status">
            <span className="sso-status-pill sso-status-pill--active">
              <CheckCircle className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{copy.authenticated}</span>
            </span>
          </div>
        </div>
      ) : (
        <div className="sso-aside-profile">
          <div className="sso-avatar sso-avatar--guest">
            <Shield className="w-8 h-8" aria-hidden="true" />
          </div>
          <h2 className="sso-aside-name">{copy.notAuthenticated}</h2>
          <p className="sso-aside-meta">{copy.signedOutHint}</p>
          <div className="sso-aside-status">
            <span className="sso-status-pill sso-status-pill--inactive">
              <XCircle className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{copy.notAuthenticated}</span>
            </span>
          </div>
        </div>
      )}

      <div className="sso-aside-actions">
        <SsoActions
          authenticated={authenticated}
          refreshing={refreshing}
          loggingOut={loggingOut}
          showWorkspaceLinks={showWorkspaceLinks}
          copy={copy}
          onRefresh={() => void loadSessionInfo(true)}
          onLogout={() => void handleLogout()}
        />
      </div>
    </div>
  )

  return (
    <AuthPage
      split
      aside={aside}
      desktopHeader={desktopHeader}
      shellClassName="sso-auth-shell"
      cardClassName={`sso-auth-card${!authenticated && !cookieInfo && !decodedToken ? ' sso-auth-card--centered' : ''}`}
    >
      <div className="sso-mobile-header">
        <AuthHeader title={copy.title} description={copy.subtitle} />
      </div>

      <main className="sso-panels">
        {errorMsg && (
          <div role="alert" className="sso-alert">
            <AlertCircle className="w-4 h-4" aria-hidden="true" />
            <span>{errorMsg}</span>
          </div>
        )}

        <section aria-labelledby="sso-status-heading">
          <div className="sso-section-head">
            <div className="sso-section-title">
              <span className="sso-section-icon" aria-hidden="true">
                <Monitor className="w-4 h-4" />
              </span>
              <h2 id="sso-status-heading">
                {authenticated ? copy.accountSession : copy.loginStatus}
              </h2>
            </div>
            {authenticated && (
              <span className="sso-status-pill sso-status-pill--subtle">
                {copy.activeBadge}
              </span>
            )}
          </div>

          <div className="sso-panel-card">
            {authenticated && ssoUser ? (
              <>
                <div className="sso-mobile-identity">
                  <SsoAvatar
                    avatarUrl={avatarUrl}
                    failedAvatarUrl={failedAvatarUrl}
                    onError={setFailedAvatarUrl}
                  />
                  <div className="sso-mobile-identity-copy">
                    <span className="sso-mobile-identity-name">{displayName}</span>
                    <span className="sso-mobile-identity-handle">@{ssoUser.username}</span>
                    <span className="sso-status-pill sso-status-pill--active mt-1">
                      <CheckCircle className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>{copy.authenticated}</span>
                    </span>
                  </div>
                </div>

                <dl className="sso-kv-grid">
                  <div className="sso-field sso-field--mono">
                    <dt>{copy.username}</dt>
                    <dd>
                      <span className="sso-value-text">{ssoUser.username}</span>
                    </dd>
                  </div>

                  <div className="sso-field sso-field--mono">
                    <dt>{copy.email}</dt>
                    <dd>
                      <span className="sso-value-text">{ssoUser.email}</span>
                    </dd>
                  </div>

                  <div className="sso-field">
                    <dt>{copy.role}</dt>
                    <dd>
                      <span className="sso-role-badge">{ssoUser.role}</span>
                    </dd>
                  </div>

                  <div className="sso-field sso-field--mono">
                    <dt>{copy.userId}</dt>
                    <dd>
                      <span className="sso-value-text">{ssoUser.id}</span>
                      <CopyValueButton
                        copied={copiedField === 'userId'}
                        label={`${copy.copyValue} ${copy.userId}`}
                        copiedLabel={copy.copied}
                        onCopy={() => void handleCopy('userId', ssoUser.id)}
                      />
                    </dd>
                  </div>
                </dl>
              </>
            ) : (
              <div>
                <div className="sso-unauth-banner">
                  <XCircle className="w-5 h-5" aria-hidden="true" />
                  <div>
                    <h3>{copy.noSessionTitle}</h3>
                    <p>{copy.noSessionDesc}</p>
                  </div>
                </div>

                <dl className="sso-kv-grid">
                  <div className="sso-field sso-field--mono">
                    <dt>{copy.host}</dt>
                    <dd><span className="sso-value-text">{hostName}</span></dd>
                  </div>
                  <div className="sso-field sso-field--mono">
                    <dt>{copy.protocol}</dt>
                    <dd><span className="sso-value-text">{isHttps ? 'HTTPS' : 'HTTP'}</span></dd>
                  </div>
                  <div className="sso-field sso-field--mono">
                    <dt>{copy.sessionEndpoint}</dt>
                    <dd><span className="sso-value-text">/api/sso/session</span></dd>
                  </div>
                  <div className="sso-field">
                    <dt>{copy.authState}</dt>
                    <dd>
                      <span className="sso-status-pill sso-status-pill--inactive">
                        {copy.notAuthenticated}
                      </span>
                    </dd>
                  </div>
                </dl>
              </div>
            )}
          </div>
        </section>

        {cookieInfo && (
          <section aria-labelledby="sso-cookie-heading">
            <div className="sso-section-head">
              <div className="sso-section-title">
                <span className="sso-section-icon" aria-hidden="true">
                  <Cookie className="w-4 h-4" />
                </span>
                <h2 id="sso-cookie-heading">{copy.cookieInfo}</h2>
              </div>
            </div>

            <div className="sso-panel-card space-y-3">
              <dl className="sso-kv-grid sso-kv-grid--compact">
                <div className="sso-field sso-field--mono">
                  <dt>{copy.name}</dt>
                  <dd><span className="sso-value-text">{cookieInfo.name}</span></dd>
                </div>
                <div className="sso-field sso-field--mono">
                  <dt>{copy.domain}</dt>
                  <dd><span className="sso-value-text">{cookieInfo.domain}</span></dd>
                </div>
                <div className="sso-field sso-field--mono">
                  <dt>{copy.path}</dt>
                  <dd><span className="sso-value-text">{cookieInfo.path}</span></dd>
                </div>
                <div className="sso-field sso-field--mono">
                  <dt>{copy.expires}</dt>
                  <dd><span className="sso-value-text">{cookieInfo.expires}</span></dd>
                </div>
              </dl>

              <div className="sso-field">
                <span className="sso-field-label">{copy.truncatedValue}</span>
                <div className="sso-code-box">
                  <span>{cookieInfo.value}</span>
                </div>
              </div>

              <div className="sso-flag-list">
                <span className="sso-flag-pill">
                  <span className={`sso-flag-dot ${cookieInfo.httpOnly ? 'sso-flag-dot--ok' : 'sso-flag-dot--danger'}`} />
                  HttpOnly
                </span>
                <span className="sso-flag-pill">
                  <span className={`sso-flag-dot ${cookieInfo.secure ? 'sso-flag-dot--ok' : 'sso-flag-dot--warn'}`} />
                  Secure
                </span>
                <span className="sso-flag-pill">
                  <span className="sso-flag-dot sso-flag-dot--info" />
                  SameSite: {cookieInfo.sameSite}
                </span>
              </div>
            </div>
          </section>
        )}

        {decodedToken && (
          <section aria-labelledby="sso-token-heading">
            <div className="sso-section-head">
              <div className="sso-section-title">
                <span className="sso-section-icon" aria-hidden="true">
                  <Key className="w-4 h-4" />
                </span>
                <h2 id="sso-token-heading">{copy.tokenDecoded}</h2>
              </div>
            </div>

            <div className="sso-panel-card space-y-3">
              <div className="sso-field">
                <span className="sso-field-label">{copy.sessionId}</span>
                <div className="sso-code-box">
                  <span>{decodedToken.sessionId}</span>
                  <CopyValueButton
                    copied={copiedField === 'sessionId'}
                    label={`${copy.copyValue} ${copy.sessionId}`}
                    copiedLabel={copy.copied}
                    onCopy={() => void handleCopy('sessionId', decodedToken.sessionId)}
                  />
                </div>
              </div>

              <dl className="sso-kv-grid">
                <div className="sso-field sso-field--mono">
                  <dt>{copy.issuedAt}</dt>
                  <dd><span className="sso-value-text">{formatDate(decodedToken.iat)}</span></dd>
                </div>
                <div className="sso-field sso-field--mono">
                  <dt>{copy.expiresAt}</dt>
                  <dd><span className="sso-value-text">{formatDate(decodedToken.exp)}</span></dd>
                </div>
              </dl>

              <div className="sso-flag-list">
                <span className="sso-flag-pill">
                  <Clock className="w-3.5 h-3.5" style={{ color: 'var(--color-text-muted)' }} aria-hidden="true" />
                  <span>{copy.remainingHours(formatRemainingHours(decodedToken.exp))}</span>
                </span>
              </div>
            </div>
          </section>
        )}

        {authenticated && !cookieInfo && !decodedToken && (
          <section aria-labelledby="sso-security-heading">
            <div className="sso-section-head">
              <div className="sso-section-title">
                <span className="sso-section-icon" aria-hidden="true">
                  <ShieldCheck className="w-4 h-4" />
                </span>
                <h2 id="sso-security-heading">{copy.sessionSecurity}</h2>
              </div>
              <span className="sso-status-pill sso-status-pill--active">
                {copy.protected}
              </span>
            </div>

            <div className="sso-panel-card">
              <dl className="sso-kv-grid">
                <div className="sso-field">
                  <dt>{copy.credentialMode}</dt>
                  <dd><span className="sso-value-text">{copy.credentialHttpOnly}</span></dd>
                </div>
                <div className="sso-field sso-field--mono">
                  <dt>{copy.host}</dt>
                  <dd><span className="sso-value-text">{hostName}</span></dd>
                </div>
                <div className="sso-field sso-field--mono">
                  <dt>{copy.transport}</dt>
                  <dd><span className="sso-value-text">{isHttps ? 'HTTPS (Secure)' : 'HTTP'}</span></dd>
                </div>
                <div className="sso-field sso-field--mono">
                  <dt>{copy.verification}</dt>
                  <dd><span className="sso-value-text">{copy.verifiedApi}</span></dd>
                </div>
              </dl>

              <p className="sso-hint-note">{copy.httpOnlyNote}</p>
            </div>
          </section>
        )}

        <section className="sso-mobile-actions" aria-labelledby="sso-actions-heading">
          <div className="sso-section-head">
            <div className="sso-section-title">
              <span className="sso-section-icon" aria-hidden="true">
                <Info className="w-4 h-4" />
              </span>
              <h2 id="sso-actions-heading">{copy.actions}</h2>
            </div>
          </div>

          <div className="sso-panel-card">
            <SsoActions
              authenticated={authenticated}
              refreshing={refreshing}
              loggingOut={loggingOut}
              showWorkspaceLinks={showWorkspaceLinks}
              copy={copy}
              onRefresh={() => void loadSessionInfo(true)}
              onLogout={() => void handleLogout()}
            />
          </div>
        </section>
      </main>
    </AuthPage>
  )
}
