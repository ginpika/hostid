/**
 * 主布局组件
 * 提供侧边栏和内容区域布局
 * 使用 React Router 的 Outlet 来渲染子页面
 */
import { useState, useRef, useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Menu, Globe, LogOut, Download, Loader2 } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useI18n } from '../i18n/I18nContext'
import ThemeSelector from './ThemeSelector'
import Sidebar, { Folder } from './Sidebar'

export default function Layout() {
  const { user, logout } = useAuth()
  const { language, setLanguage, t } = useI18n()
  const location = useLocation()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [showLanguageMenu, setShowLanguageMenu] = useState(false)
  const [importLoading, setImportLoading] = useState(false)
  const languageMenuRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (languageMenuRef.current && !languageMenuRef.current.contains(event.target as Node)) {
        setShowLanguageMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const toggleLanguage = async (newLanguage: 'zh-CN' | 'en-US') => {
    await setLanguage(newLanguage)
    setShowLanguageMenu(false)
  }

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImportLoading(true)
    try {
      const token = localStorage.getItem('token')
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch('/api/emails/import', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData
      })
      if (!res.ok) throw new Error('Import failed')
      window.location.reload()
    } catch (err) {
      console.error('Import failed:', err)
      alert(t('importMailFailed'))
    } finally {
      setImportLoading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const getFolderFromPath = (pathname: string): Folder | undefined => {
    if (pathname === '/') return 'INBOX'
    if (pathname === '/sent') return 'SENT'
    if (pathname === '/starred') return 'STARRED'
    if (pathname === '/archived') return 'ARCHIVED'
    if (pathname === '/trash') return 'TRASH'
    return undefined
  }

  const folder = getFolderFromPath(location.pathname)

  const getNavItems = () => {
    const isAdmin = user?.role === 'admin'
    return [
      { path: '/', label: t('inbox'), folder: 'INBOX' as Folder },
      { path: '/sent', label: t('sent'), folder: 'SENT' as Folder },
      { path: '/starred', label: t('starred'), folder: 'STARRED' as Folder },
      { path: '/archived', label: t('archived'), folder: 'ARCHIVED' as Folder },
      { path: '/trash', label: t('trash'), folder: 'TRASH' as Folder },
      { path: '/profile', label: t('profile') },
      { path: '/info', label: t('about') },
      ...(isAdmin ? [
        { path: '/admin', label: t('admin') },
        { path: '/admin/oauth', label: t('oauthConfig') },
        { path: '/admin/oauth-apps', label: t('oauthApps') }
      ] : [])
    ]
  }

  const navItems = getNavItems()
  const currentPageLabel = navItems.find(item => 
    (item.folder && folder === item.folder) || location.pathname === item.path
  )?.label || t('mail')

  return (
    <div className="h-screen flex overflow-hidden" style={{ backgroundColor: 'var(--color-bg-primary)' }}>
      <Sidebar 
        isOpen={sidebarOpen} 
        onClose={() => setSidebarOpen(false)}
        currentFolder={folder}
      />

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
              {currentPageLabel}
            </h1>
          </div>
          
          <div className="flex items-center gap-2">
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={importLoading}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors hover:bg-[var(--color-bg-tertiary)]"
              style={{ color: 'var(--color-text-secondary)' }}
              title={t('importMail')}
            >
              {importLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Download className="w-4 h-4" />
              )}
              <span className="text-sm font-medium hidden sm:inline">{t('importMail')}</span>
            </button>
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

        <Outlet />
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".eml"
        onChange={handleImport}
        className="hidden"
      />
    </div>
  )
}