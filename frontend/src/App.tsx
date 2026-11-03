/**
 * 应用入口文件
 * 配置路由、认证守卫和全局 Context Provider
 * 包含私有路由、公开路由和 OAuth 回调处理
 * 使用嵌套路由实现侧边栏持久化
 */
import { BrowserRouter, Routes, Route, Navigate, useLocation, useSearchParams } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { I18nProvider } from './i18n/I18nContext'
import { ThemeProvider } from './contexts/ThemeContext'
import { ComposeProvider } from './contexts/ComposeContext'
import { DomainProvider } from './contexts/DomainContext'
import { ConfigProvider } from './contexts/ConfigContext'
import Login from './pages/Login'
import Register from './pages/Register'
import Inbox from './pages/Inbox'
import ArchivePage from './pages/ArchivePage'
import InfoPage from './pages/InfoPage'
import ProfilePage from './pages/ProfilePage'
import AdminSettingsPage from './pages/AdminSettingsPage'
import SetupPage from './pages/SetupPage'
import OAuthAuthorizePage from './pages/OAuthAuthorizePage'
import TosPage from './pages/TosPage'
import SSOInfoPage from './pages/SSOInfoPage'
import OAuthCallback from './pages/OAuthCallback'
import OAuthRegister from './pages/OAuthRegister'
import ComposeModal from './components/ComposeModal'
import Layout from './components/Layout'
import AuthPage, { AuthHeader, AuthLoading } from './components/AuthPage'

const PUBLIC_ROUTES = ['/setup', '/login', '/register', '/tos', '/sso/info', '/oauth/callback', '/oauth/register', '/oauth2/authorize']

function AuthPending() {
  return (
    <AuthPage>
      <AuthHeader title="HostID" />
      <AuthLoading />
    </AuthPage>
  )
}

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  
  if (loading) {
    return <AuthPending />
  }
  
  return user ? <>{children}</> : <Navigate to="/login" />
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  const [searchParams] = useSearchParams()
  const oauthSuccess = searchParams.get('oauth_success') === 'true'
  
  if (loading) {
    return <AuthPending />
  }
  
  if (user && oauthSuccess) {
    return <>{children}</>
  }
  
  return user ? <Navigate to="/" /> : <>{children}</>
}

function RouteGuard({ children }: { children: React.ReactNode }) {
  const { user, checkSSOSession, logout } = useAuth()
  const location = useLocation()
  const checkingRef = useRef(false)
  
  useEffect(() => {
    const validateSession = async () => {
      if (checkingRef.current) return
      if (PUBLIC_ROUTES.includes(location.pathname)) return
      if (!user) return
      
      checkingRef.current = true
      try {
        const isValid = await checkSSOSession()
        if (!isValid) {
          await logout()
          window.location.href = '/login'
        }
      } catch {
        await logout()
        window.location.href = '/login'
      } finally {
        checkingRef.current = false
      }
    }
    
    validateSession()
  }, [location.pathname, user, checkSSOSession, logout])
  
  return <>{children}</>
}

/**
 * 首次运行检查：没有任何用户时强制进入 /setup
 */
function SetupGate({ children }: { children: React.ReactNode }) {
  const location = useLocation()
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/setup/status')
      .then(res => (res.ok ? res.json() : { needsSetup: false }))
      .then(data => { if (!cancelled) setNeedsSetup(!!data.needsSetup) })
      .catch(() => { if (!cancelled) setNeedsSetup(false) })
    return () => { cancelled = true }
  }, [])

  if (needsSetup === null) return <AuthPending />
  if (needsSetup) {
    if (location.pathname !== '/setup') return <Navigate to="/setup" replace />
    return <SetupPage onComplete={() => { setNeedsSetup(false); window.location.replace('/login') }} />
  }
  if (location.pathname === '/setup') return <Navigate to="/login" replace />
  return <>{children}</>
}

function AppRoutes() {
  const { user } = useAuth()
  const initialLanguage = (user?.language as 'zh-CN' | 'en-US') || 'zh-CN'
  
  return (
    <I18nProvider initialLanguage={initialLanguage}>
      <ComposeModal />
      <SetupGate>
      <RouteGuard>
        <Routes>
          <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
          <Route path="/register" element={<PublicRoute><Register /></PublicRoute>} />
          <Route path="/tos" element={<TosPage />} />
          <Route path="/sso/info" element={<SSOInfoPage />} />
          <Route path="/oauth/callback" element={<OAuthCallback />} />
          <Route path="/oauth/register" element={<OAuthRegister />} />
          
          <Route path="/" element={<PrivateRoute><Layout /></PrivateRoute>}>
            <Route index element={<Inbox />} />
            <Route path="sent" element={<Inbox />} />
            <Route path="starred" element={<Inbox />} />
            <Route path="trash" element={<Inbox />} />
            <Route path="archived" element={<ArchivePage />} />
            <Route path="info" element={<InfoPage />} />
            <Route path="profile" element={<ProfilePage />} />
            <Route path="admin" element={<Navigate to="/admin/settings?tab=database" replace />} />
            <Route path="admin/oauth" element={<Navigate to="/admin/settings?tab=providers" replace />} />
            <Route path="admin/oauth-apps" element={<Navigate to="/admin/settings?tab=apps" replace />} />
            <Route path="admin/settings" element={<AdminSettingsPage />} />
          </Route>
          
          <Route path="/oauth2/authorize" element={<PrivateRoute><OAuthAuthorizePage /></PrivateRoute>} />
        </Routes>
      </RouteGuard>
      </SetupGate>
    </I18nProvider>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <ConfigProvider>
        <ThemeProvider>
          <DomainProvider>
            <AuthProvider>
              <ComposeProvider>
                <AppRoutes />
              </ComposeProvider>
            </AuthProvider>
          </DomainProvider>
        </ThemeProvider>
      </ConfigProvider>
    </BrowserRouter>
  )
}
