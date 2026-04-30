/**
 * 应用入口文件
 * 配置路由、认证守卫和全局 Context Provider
 * 包含私有路由、公开路由和 OAuth 回调处理
 */
import { BrowserRouter, Routes, Route, Navigate, useLocation, useSearchParams } from 'react-router-dom'
import { useEffect, useRef } from 'react'
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
import AdminPage from './pages/AdminPage'
import OAuthConfigPage from './pages/OAuthConfigPage'
import OAuthAppsPage from './pages/OAuthAppsPage'
import OAuthAuthorizePage from './pages/OAuthAuthorizePage'
import TosPage from './pages/TosPage'
import SSOInfoPage from './pages/SSOInfoPage'
import OAuthCallback from './pages/OAuthCallback'
import OAuthRegister from './pages/OAuthRegister'
import ComposeModal from './components/ComposeModal'

const PUBLIC_ROUTES = ['/login', '/register', '/tos', '/sso/info', '/oauth/callback', '/oauth/register', '/oauth2/authorize']

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--color-bg-primary)' }}>
        <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: 'var(--color-accent-primary)' }}></div>
      </div>
    )
  }
  
  return user ? <>{children}</> : <Navigate to="/login" />
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  const [searchParams] = useSearchParams()
  const oauthSuccess = searchParams.get('oauth_success') === 'true'
  
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--color-bg-primary)' }}>
        <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: 'var(--color-accent-primary)' }}></div>
      </div>
    )
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

function AppRoutes() {
  const { user } = useAuth()
  const initialLanguage = (user?.language as 'zh-CN' | 'en-US') || 'zh-CN'
  
  return (
    <I18nProvider initialLanguage={initialLanguage}>
      <ComposeModal />
      <RouteGuard>
        <Routes>
          <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
          <Route path="/register" element={<PublicRoute><Register /></PublicRoute>} />
          <Route path="/tos" element={<TosPage />} />
          <Route path="/sso/info" element={<SSOInfoPage />} />
          <Route path="/oauth/callback" element={<OAuthCallback />} />
          <Route path="/oauth/register" element={<OAuthRegister />} />
          <Route path="/" element={<PrivateRoute><Inbox /></PrivateRoute>} />
          <Route path="/sent" element={<PrivateRoute><Inbox /></PrivateRoute>} />
          <Route path="/starred" element={<PrivateRoute><Inbox /></PrivateRoute>} />
          <Route path="/trash" element={<PrivateRoute><Inbox /></PrivateRoute>} />
          <Route path="/archived" element={<PrivateRoute><ArchivePage /></PrivateRoute>} />
          <Route path="/info" element={<PrivateRoute><InfoPage /></PrivateRoute>} />
          <Route path="/profile" element={<PrivateRoute><ProfilePage /></PrivateRoute>} />
          <Route path="/admin" element={<PrivateRoute><AdminPage /></PrivateRoute>} />
          <Route path="/admin/oauth" element={<PrivateRoute><OAuthConfigPage /></PrivateRoute>} />
          <Route path="/admin/oauth-apps" element={<PrivateRoute><OAuthAppsPage /></PrivateRoute>} />
          <Route path="/oauth2/authorize" element={<PrivateRoute><OAuthAuthorizePage /></PrivateRoute>} />
        </Routes>
      </RouteGuard>
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
