/**
 * 主布局组件
 * 提供侧边栏导航、顶部栏、主题选择器和语言切换
 * 包含邮件文件夹导航和管理员入口
 */
import { useState, useRef, useEffect, ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Inbox, Send, Trash2, Pen, LogOut, Menu, X, UserCircle, Globe, Info, Shield, Archive, Key, AppWindow, Star } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useI18n } from '../i18n/I18nContext'
import { useCompose } from '../contexts/ComposeContext'
import ThemeSelector from './ThemeSelector'

type Folder = 'INBOX' | 'SENT' | 'TRASH' | 'ARCHIVED' | 'STARRED'

interface LayoutProps {
  children: ReactNode
  folder?: Folder
}

export default function Layout({ children, folder }: LayoutProps) {
  const { user, logout } = useAuth()
  const { language, setLanguage, t } = useI18n()
  const { openCompose } = useCompose()
  const location = useLocation()
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [showLanguageMenu, setShowLanguageMenu] = useState(false)
  const languageMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (languageMenuRef.current && !languageMenuRef.current.contains(event.target as Node)) {
        setShowLanguageMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const isAdmin = user?.role === 'admin'

  const navGroups: {
    label: string
    items: {
      path: string
      label: string
      icon: React.ComponentType<any>
      folder?: Folder
    }[]
  }[] = [
    {
      label: t('mailbox'),
      items: [
        { path: '/', label: t('inbox'), icon: Inbox, folder: 'INBOX' as Folder },
        { path: '/sent', label: t('sent'), icon: Send, folder: 'SENT' as Folder },
        { path: '/starred', label: t('starred'), icon: Star, folder: 'STARRED' as Folder },
        { path: '/archived', label: t('archived'), icon: Archive, folder: 'ARCHIVED' as Folder },
        { path: '/trash', label: t('trash'), icon: Trash2, folder: 'TRASH' as Folder },
      ]
    },
    {
      label: t('general'),
      items: [
        { path: '/profile', label: t('profile'), icon: UserCircle },
        { path: '/info', label: t('about'), icon: Info },
      ]
    },
    ...(isAdmin ? [{
      label: t('adminGroup'),
      items: [
        { path: '/admin', label: t('admin'), icon: Shield },
        { path: '/admin/oauth', label: t('oauthConfig'), icon: Key },
        { path: '/admin/oauth-apps', label: t('oauthApps'), icon: AppWindow }
      ]
    }] : [])
  ]

  const allNavItems = navGroups.flatMap(g => g.items)

  const toggleLanguage = async (newLanguage: 'zh-CN' | 'en-US') => {
    await setLanguage(newLanguage)
    setShowLanguageMenu(false)
  }

  return (
    <div className="h-screen flex overflow-hidden" style={{ backgroundColor: 'var(--color-bg-primary)' }}>
      <div className={`fixed inset-0 bg-black/50 z-20 lg:hidden ${sidebarOpen ? 'block' : 'hidden'}`} onClick={() => setSidebarOpen(false)} />
      
      <aside 
        className={`fixed lg:static inset-y-0 left-0 z-30 w-64 transform transition-transform duration-200 flex-shrink-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
        style={{ 
          backgroundColor: 'var(--color-bg-secondary)',
          borderRight: '1px solid var(--color-border-primary)'
        }}
      >
        <div className="h-full flex flex-col">
          <div className="p-4 border-b" style={{ borderColor: 'var(--color-border-primary)' }}>
            <div className="flex items-center gap-3">
              <div 
                className="w-14 h-14 rounded-full flex-shrink-0 overflow-hidden flex items-center justify-center"
                style={{ 
                  backgroundColor: user?.avatar ? 'transparent' : `color-mix(in srgb, var(--color-accent-primary) 20%, transparent)`,
                  color: 'var(--color-accent-primary)'
                }}
              >
                {user?.avatar ? (
                  <img src={user.avatar.startsWith('http') ? user.avatar : `/api/auth/avatar/${user.avatar}`} alt={user.nickname || user.username} className="w-full h-full object-cover" />
                ) : (
                  <UserCircle className="w-8 h-8" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-base font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>
                  {user?.nickname || user?.username}
                </p>
                <p className="text-sm truncate" style={{ color: 'var(--color-text-muted)' }}>
                  {user?.email}
                </p>
              </div>
              <button onClick={() => setSidebarOpen(false)} className="lg:hidden p-1 rounded hover:bg-[var(--color-bg-tertiary)]" style={{ color: 'var(--color-text-muted)' }}>
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          <div className="px-3 py-4">
            <button
              onClick={() => openCompose()}
              className="group relative w-full flex items-center justify-center gap-2.5 py-3.5 px-5 rounded-xl font-semibold text-[15px] tracking-wide overflow-hidden transition-all duration-300 ease-out shadow-lg hover:shadow-xl hover:-translate-y-0.5 active:translate-y-0"
              style={{
                background: 'linear-gradient(135deg, var(--color-accent-primary) 0%, var(--color-accent-secondary) 100%)',
                color: 'var(--color-accent-text)',
                boxShadow: '0 4px 14px -3px color-mix(in srgb, var(--color-accent-primary) 50%, transparent)'
              }}
            >
              <Pen className="w-5 h-5 transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" strokeWidth={2.5} />
              <span>{t('compose')}</span>
            </button>
          </div>

          <nav className="flex-1 px-2 overflow-y-auto">
            {navGroups.map((group, groupIndex) => (
              <div key={groupIndex} className="mb-4">
                <div className="px-4 py-2 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>
                  {group.label}
                </div>
                {group.items.map(item => {
                  const isActive = (item.folder && folder === item.folder) || location.pathname === item.path
                  return (
                    <button
                      key={item.path}
                      onClick={() => {
                        navigate(item.path)
                        setSidebarOpen(false)
                      }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-left transition-colors hover:bg-[var(--color-bg-tertiary)]"
                      style={{
                        backgroundColor: isActive ? 'var(--color-bg-tertiary)' : 'transparent',
                        color: isActive ? 'var(--color-accent-primary)' : 'var(--color-text-secondary)'
                      }}
                    >
                      <item.icon className="w-5 h-5" />
                      <span className="font-medium">{item.label}</span>
                    </button>
                  )
                })}
              </div>
            ))}
          </nav>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0 h-full">
        <header 
          className="px-4 py-3 flex items-center justify-between flex-shrink-0"
          style={{ 
            backgroundColor: 'var(--color-bg-secondary)',
            borderBottom: '1px solid var(--color-border-primary)'
          }}
        >
          <div className="flex items-center gap-4">
            <button onClick={() => setSidebarOpen(true)} className="p-1 rounded lg:hidden hover:bg-[var(--color-bg-tertiary)]" style={{ color: 'var(--color-text-muted)' }}>
              <Menu className="w-6 h-6" />
            </button>
            <h1 className="text-lg font-semibold" style={{ color: 'var(--color-text-primary)' }}>
              {allNavItems.find(item => (item.folder && folder === item.folder) || location.pathname === item.path)?.label || t('mail')}
            </h1>
          </div>
          
          <div className="flex items-center gap-2">
            <ThemeSelector />

            <div className="relative" ref={languageMenuRef}>
              <button
                onClick={() => setShowLanguageMenu(!showLanguageMenu)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors hover:bg-[var(--color-bg-tertiary)]"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                <Globe className="w-4 h-4" />
                <span className="text-sm font-medium hidden sm:inline">{language === 'zh-CN' ? t('chinese') : t('english')}</span>
              </button>
              
              {showLanguageMenu && (
                <div 
                  className="absolute top-full right-0 mt-2 w-32 rounded-lg shadow-lg py-1 z-50"
                  style={{ 
                    backgroundColor: 'var(--color-bg-secondary)',
                    border: '1px solid var(--color-border-primary)'
                  }}
                >
                  <button
                    onClick={() => toggleLanguage('zh-CN')}
                    className="w-full text-left px-3 py-1.5 text-sm transition-colors hover:bg-[var(--color-bg-tertiary)]"
                    style={{ 
                      color: language === 'zh-CN' ? 'var(--color-accent-primary)' : 'var(--color-text-secondary)',
                      backgroundColor: language === 'zh-CN' ? 'var(--color-bg-tertiary)' : 'transparent'
                    }}
                  >
                    {t('chinese')}
                  </button>
                  <button
                    onClick={() => toggleLanguage('en-US')}
                    className="w-full text-left px-3 py-1.5 text-sm transition-colors hover:bg-[var(--color-bg-tertiary)]"
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
            
            <button
              onClick={logout}
              className="p-2 rounded-lg transition-colors hover:bg-[var(--color-bg-tertiary)]"
              style={{ color: 'var(--color-text-muted)' }}
              title={t('logout')}
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </header>

        {children}
      </div>
    </div>
  )
}
