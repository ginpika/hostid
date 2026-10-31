import { useState, useRef, useEffect, useCallback } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Menu, Globe, LogOut, Upload, Loader2, ChevronRight, CheckCircle2, AlertCircle, X, Columns2, List } from 'lucide-react'
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
  const [mailLayoutMode, setMailLayoutMode] = useState<'split' | 'list'>(() => localStorage.getItem('inboxLayoutMode') === 'list' ? 'list' : 'split')
  const [importLoading, setImportLoading] = useState(false)
  const [notice, setNotice] = useState<{ message: string; type: NoticeType } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderPaths: Record<string, Folder> = { '/': 'INBOX', '/sent': 'SENT', '/starred': 'STARRED', '/archived': 'ARCHIVED', '/trash': 'TRASH' }
  const folder = folderPaths[pathname]
  const toggleMailLayout = () => {
    const next = mailLayoutMode === 'split' ? 'list' : 'split'
    setMailLayoutMode(next)
    localStorage.setItem('inboxLayoutMode', next)
  }
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
            <button disabled={importLoading} className={classic ? 'classic-header-button' : 'mail-icon-button'} title={t('importMail')} aria-label={t('importMail')} onClick={() => fileInputRef.current?.click()}>{importLoading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={classic ? 16 : 18} />}{classic && <span className="hidden sm:inline">{t('importMail')}</span>}</button>
            {folder && <button className="mail-icon-button" aria-label={mailLayoutMode === 'split' ? t('listLayout') : t('splitLayout')} title={mailLayoutMode === 'split' ? t('listLayout') : t('splitLayout')} onClick={toggleMailLayout}>{mailLayoutMode === 'split' ? <List size={17} /> : <Columns2 size={17} />}</button>}
            <ThemeSelector />
            <div className="relative" ref={menuRef}>
              <button ref={menuButtonRef} className={`${classic ? 'classic-header-button' : 'mail-icon-button'}${menuOpen ? ' is-active' : ''}`} aria-label={zh ? '界面语言' : 'Language'} aria-expanded={menuOpen} aria-controls="topbar-languages" onClick={() => setMenuOpen(!menuOpen)}><Globe size={classic ? 16 : 18} />{classic && <span className="hidden sm:inline">{zh ? t('chinese') : t('english')}</span>}</button>
              {menuOpen && <div id="topbar-languages" className="topbar-language-menu">
                {(['zh-CN', 'en-US'] as const).map(value => <button key={value} aria-pressed={language === value} onClick={async () => { await setLanguage(value); setMenuOpen(false) }}>{value === 'zh-CN' ? t('chinese') : t('english')}</button>)}
              </div>}
            </div>
            {!classic && <span className="topbar-account hidden md:inline" title={user?.email}>{user?.email}</span>}
            <button className="mail-icon-button" title={t('logout')} aria-label={t('logout')} onClick={logout}><LogOut size={classic ? 20 : 18} /></button>
          </div>
        </header>
        <Outlet context={{ layoutMode: mailLayoutMode }} />
      </main>
      <input ref={fileInputRef} type="file" accept=".eml" onChange={handleImport} className="hidden" aria-label={t('importMail')} />
      {notice && <div className={`workspace-notice workspace-notice--${notice.type}`} role={notice.type === 'error' ? 'alert' : 'status'}>
        {notice.type === 'error' ? <AlertCircle size={19} /> : <CheckCircle2 size={19} />}<span>{notice.message}</span><button className="mail-icon-button" onClick={() => setNotice(null)} aria-label={t('close')}><X size={16} /></button>
      </div>}
    </div>
  )
}
