import { useState, useRef, useEffect, useCallback } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Menu, Globe, LogOut, Upload, Loader2, MoreHorizontal, ChevronRight, Check, CheckCircle2, AlertCircle, X } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useI18n } from '../i18n/I18nContext'
import ThemeSelector from './ThemeSelector'
import Sidebar, { type Folder } from './Sidebar'
import { notify, refreshMail, type NoticeType } from '../lib/mailEvents'
import { useTheme } from '../contexts/ThemeContext'
import '../styles/classic-shell.css'

export default function Layout() {
  const { user, logout } = useAuth()
  const { language, setLanguage, t } = useI18n()
  const { pathname } = useLocation()
  const { layout } = useTheme()
  const classic = layout === 'classic'
  const zh = language === 'zh-CN'
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const closeSidebar = useCallback(() => setSidebarOpen(false), [])
  const [sidebarPinned, setSidebarPinned] = useState(() => localStorage.getItem('sidebar-pinned') !== 'false')
  const [menuOpen, setMenuOpen] = useState(false)
  const [importLoading, setImportLoading] = useState(false)
  const [notice, setNotice] = useState<{ message: string; type: NoticeType } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderPaths: Record<string, Folder> = { '/': 'INBOX', '/sent': 'SENT', '/starred': 'STARRED', '/archived': 'ARCHIVED', '/trash': 'TRASH' }
  const folder = folderPaths[pathname]
  const pageLabels: Record<string, string> = { '/': t('inbox'), '/sent': t('sent'), '/starred': t('starred'), '/archived': t('archived'), '/trash': t('trash'), '/profile': t('profile'), '/info': t('about'), '/admin': t('admin'), '/admin/oauth': t('oauthConfig'), '/admin/oauth-apps': t('oauthApps') }

  useEffect(() => { setMenuOpen(false) }, [layout])

  useEffect(() => {
    const outside = (event: MouseEvent) => { if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false) }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && menuOpen) { setMenuOpen(false); menuButtonRef.current?.focus() }
    }
    document.addEventListener('mousedown', outside)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', escape) }
  }, [menuOpen])

  useEffect(() => {
    const showNotice = (event: Event) => setNotice((event as CustomEvent).detail)
    window.addEventListener('hostid:notice', showNotice)
    return () => window.removeEventListener('hostid:notice', showNotice)
  }, [])
  useEffect(() => {
    if (!notice || notice.type === 'error') return
    const timer = window.setTimeout(() => setNotice(null), 4500)
    return () => window.clearTimeout(timer)
  }, [notice])

  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setImportLoading(true)
    setMenuOpen(false)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const response = await fetch('/api/emails/import', { method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }, body: formData })
      if (!response.ok) throw new Error('import-failed')
      notify(t('importMailSuccess'))
      refreshMail()
    } catch { notify(t('importMailFailed'), 'error') }
    finally { setImportLoading(false); if (fileInputRef.current) fileInputRef.current.value = '' }
  }

  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link">{zh ? '跳到主要内容' : 'Skip to content'}</a>
      <Sidebar isOpen={sidebarOpen} onClose={closeSidebar} currentFolder={folder} pinned={sidebarPinned} onTogglePin={() => setSidebarPinned(previous => { localStorage.setItem('sidebar-pinned', String(!previous)); return !previous })} />
      <main id="main-content" className="app-main" tabIndex={-1}>
        <header className="workspace-topbar">
          <div className="flex items-center gap-3 min-w-0">
            <button className="mail-icon-button lg:hidden" aria-label={t('menu')} aria-controls="workspace-sidebar" aria-expanded={sidebarOpen} onClick={() => setSidebarOpen(true)}><Menu size={20} /></button>
            {!classic && <><span className="workspace-breadcrumb hidden sm:inline">{zh ? '工作空间' : 'Workspace'}</span>
            <ChevronRight className="workspace-chevron hidden sm:block" size={14} /></>}
            <h1 className="truncate">{pageLabels[pathname] || t('mail')}</h1>
          </div>
          <div className="flex items-center gap-1.5">
            {classic && <button disabled={importLoading} className="classic-header-button" title={t('importMail')} aria-label={t('importMail')} onClick={() => fileInputRef.current?.click()}>{importLoading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}<span className="hidden sm:inline">{t('importMail')}</span></button>}
            {!classic && importLoading && <span className="flex items-center gap-2 text-xs mr-2" style={{ color: 'var(--color-text-tertiary)' }}><Loader2 size={14} className="animate-spin" />{t('importMail')}</span>}
            <ThemeSelector />
            {classic ? <>
              <div className="relative" ref={menuRef}>
                <button ref={menuButtonRef} className="classic-header-button" aria-label={zh ? '界面语言' : 'Language'} aria-expanded={menuOpen} aria-controls="classic-languages" onClick={() => setMenuOpen(!menuOpen)}><Globe size={16} /><span className="hidden sm:inline">{zh ? t('chinese') : t('english')}</span></button>
                {menuOpen && <div id="classic-languages" className="classic-language-menu">
                  {(['zh-CN', 'en-US'] as const).map(value => <button key={value} aria-pressed={language === value} onClick={async () => { await setLanguage(value); setMenuOpen(false) }}>{value === 'zh-CN' ? t('chinese') : t('english')}</button>)}
                </div>}
              </div>
              <button className="mail-icon-button" title={t('logout')} aria-label={t('logout')} onClick={logout}><LogOut size={20} /></button>
            </> : <div className="relative" ref={menuRef}>
              <button ref={menuButtonRef} className={`mail-icon-button ${menuOpen ? 'is-active' : ''}`} aria-expanded={menuOpen} aria-controls="workspace-options" aria-label={zh ? '工作空间选项' : 'Workspace options'} title={zh ? '更多选项' : 'More options'} onClick={() => setMenuOpen(!menuOpen)}><MoreHorizontal size={20} /></button>
              {menuOpen && <div id="workspace-options" className="workspace-menu">
                <span className="workspace-menu-label">{zh ? '邮件工具' : 'MAIL TOOLS'}</span>
                <button disabled={importLoading} onClick={() => fileInputRef.current?.click()}><Upload size={16} /><span>{t('importMail')}</span><span className="workspace-menu-meta">.eml</span></button>
                <div className="workspace-menu-divider" />
                <span className="workspace-menu-label flex items-center gap-2"><Globe size={12} />{zh ? '界面语言' : 'LANGUAGE'}</span>
                {(['zh-CN', 'en-US'] as const).map(value => <button key={value} onClick={async () => { await setLanguage(value); setMenuOpen(false) }}><span className="w-4 text-xs">{value === 'zh-CN' ? '中' : 'EN'}</span><span>{value === 'zh-CN' ? '简体中文' : 'English'}</span>{language === value && <Check size={15} className="ml-auto" />}</button>)}
                <div className="workspace-menu-divider" />
                <div className="workspace-menu-account">{user?.email}</div>
                <button onClick={logout}><LogOut size={16} /><span>{t('logout')}</span></button>
              </div>}
            </div>}
          </div>
        </header>
        <Outlet />
      </main>
      <input ref={fileInputRef} type="file" accept=".eml" onChange={handleImport} className="hidden" aria-label={t('importMail')} />
      {notice && <div className={`workspace-notice workspace-notice--${notice.type}`} role={notice.type === 'error' ? 'alert' : 'status'}>
        {notice.type === 'error' ? <AlertCircle size={19} /> : <CheckCircle2 size={19} />}<span>{notice.message}</span><button className="mail-icon-button" onClick={() => setNotice(null)} aria-label={t('close')}><X size={16} /></button>
      </div>}
    </div>
  )
}
