import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Inbox, Send, Trash2, PenLine, X, UserCircle, Archive, Shield, KeyRound, AppWindow, Star, PanelLeftClose, PanelLeftOpen, ChevronRight, Pin, PinOff, type LucideIcon } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useI18n } from '../i18n/I18nContext'
import { useCompose } from '../contexts/ComposeContext'
import { useTheme } from '../contexts/ThemeContext'
import BrandMark from './BrandMark'
import { isTopModal, restoreModalFocus } from '../lib/modalStack'

export type Folder = 'INBOX' | 'SENT' | 'TRASH' | 'ARCHIVED' | 'STARRED'
interface SidebarProps { isOpen: boolean; onClose: () => void; currentFolder?: Folder; pinned: boolean; onTogglePin: () => void }
export default function Sidebar({ isOpen, onClose, currentFolder, pinned, onTogglePin }: SidebarProps) {
  const { user } = useAuth()
  const { t, language } = useI18n()
  const { openCompose } = useCompose()
  const { layout } = useTheme()
  const classic = layout === 'classic'
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const [expanded, setExpanded] = useState(false)
  const [desktop, setDesktop] = useState(() => window.matchMedia('(min-width: 1024px)').matches)
  const asideRef = useRef<HTMLElement>(null)
  const expandButtonRef = useRef<HTMLButtonElement>(null)
  const keyboardExpandedRef = useRef(false)
  const wide = !desktop || pinned || expanded
  const togglePin = () => {
    keyboardExpandedRef.current = false
    setExpanded(false)
    onTogglePin()
    if (pinned) requestAnimationFrame(() => expandButtonRef.current?.focus())
  }
  const expandSidebar = (event: MouseEvent<HTMLButtonElement>) => {
    const keyboard = event.detail === 0
    keyboardExpandedRef.current = keyboard
    setExpanded(true)
    if (keyboard) requestAnimationFrame(() => asideRef.current?.querySelector<HTMLButtonElement>('button')?.focus())
  }
  useEffect(() => {
    const query = window.matchMedia('(min-width: 1024px)')
    const update = () => setDesktop(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  useEffect(() => {
    if (asideRef.current) asideRef.current.inert = !desktop && !isOpen
    if (desktop || !isOpen) return
    const previous = document.activeElement as HTMLElement | null
    asideRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
    const handleKey = (event: KeyboardEvent) => {
      if (!asideRef.current || !isTopModal(asideRef.current)) return
      if (event.key === 'Escape') { event.preventDefault(); onClose() }
      if (event.key === 'Tab') {
        const items = Array.from(asideRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]),a[href]') || []).filter(item => item.offsetParent !== null)
        if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items[items.length - 1]?.focus() }
        else if (!event.shiftKey && document.activeElement === items[items.length - 1]) { event.preventDefault(); items[0]?.focus() }
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => { document.removeEventListener('keydown', handleKey); restoreModalFocus(previous) }
  }, [desktop, isOpen, onClose])
  useEffect(() => {
    if (!desktop || pinned || !expanded) return
    const closeExpanded = (event: PointerEvent) => {
      if (!asideRef.current?.contains(event.target as Node)) setExpanded(false)
    }
    const closeOnPointerMove = (event: PointerEvent) => {
      if (!keyboardExpandedRef.current && !asideRef.current?.contains(event.target as Node)) setExpanded(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      const modalOwnsFocus = Array.from(document.querySelectorAll<HTMLElement>('[aria-modal="true"][role="dialog"], [aria-modal="true"][role="alertdialog"]')).some(dialog => isTopModal(dialog))
      if (modalOwnsFocus) return
      event.preventDefault()
      setExpanded(false)
      requestAnimationFrame(() => expandButtonRef.current?.focus())
    }
    document.addEventListener('pointerdown', closeExpanded)
    document.addEventListener('pointermove', closeOnPointerMove, { passive: true })
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', closeExpanded)
      document.removeEventListener('pointermove', closeOnPointerMove)
      document.removeEventListener('keydown', escape)
    }
  }, [desktop, pinned, expanded])
  const navGroups: { label: string; items: { path: string; label: string; icon: LucideIcon; folder?: Folder }[] }[] = [
    { label: t('mailbox'), items: [
      { path: '/', label: t('inbox'), icon: Inbox, folder: 'INBOX' },
      { path: '/sent', label: t('sent'), icon: Send, folder: 'SENT' },
      { path: '/starred', label: t('starred'), icon: Star, folder: 'STARRED' },
      { path: '/archived', label: t('archived'), icon: Archive, folder: 'ARCHIVED' },
      { path: '/trash', label: t('trash'), icon: Trash2, folder: 'TRASH' }
    ] },
    { label: t('general'), items: [{ path: '/profile', label: t('profile'), icon: UserCircle }] },
    ...(user?.role === 'admin' ? [{ label: t('adminGroup'), items: [
      { path: '/admin', label: t('admin'), icon: Shield },
      { path: '/admin/oauth', label: t('oauthConfig'), icon: KeyRound },
      { path: '/admin/oauth-apps', label: t('oauthApps'), icon: AppWindow }
    ] }] : [])
  ]
  return <>
    {!desktop && isOpen && <div className="sidebar-backdrop" onClick={onClose} />}
    <aside id="workspace-sidebar" ref={asideRef} className={`workspace-sidebar ${wide ? 'is-wide' : 'is-compact'} ${isOpen ? 'is-open' : ''} ${!pinned && expanded ? 'is-expanded' : ''}`} role={!desktop && isOpen ? 'dialog' : undefined} aria-modal={!desktop && isOpen ? true : undefined} aria-label={t('menu')}
      onPointerDownCapture={() => { keyboardExpandedRef.current = false }}
      onMouseLeave={() => { if (desktop && !pinned && (!keyboardExpandedRef.current || !asideRef.current?.contains(document.activeElement))) setExpanded(false) }}
      onBlur={event => { if (desktop && !pinned && !event.currentTarget.contains(event.relatedTarget as Node | null)) setExpanded(false) }}
      onKeyDown={() => { keyboardExpandedRef.current = true }}>
      <div className="sidebar-inner">
        {classic ? <div className="classic-sidebar-identity">
          {wide && desktop && <button className="mail-icon-button classic-sidebar-pin" onClick={togglePin} aria-label={pinned ? t('unpinSidebar') : t('pinSidebar')} title={pinned ? t('unpinSidebar') : t('pinSidebar')}>{pinned ? <PinOff size={16} /> : <Pin size={16} />}</button>}
          {!wide && <button ref={expandButtonRef} className="mail-icon-button classic-sidebar-expand" onClick={expandSidebar} aria-label={t('expandSidebar')} title={t('expandSidebar')}><PanelLeftOpen size={16} /></button>}
          <div className="classic-sidebar-user">
            <span className="classic-sidebar-avatar">{user?.avatarUrl || user?.avatar ? <img src={user.avatarUrl || (user.avatar?.startsWith('http') ? user.avatar : `/api/auth/avatar/${user.avatar}`)} alt="" /> : <UserCircle size={wide ? 32 : 22} />}</span>
            {wide && <span className="classic-sidebar-user-text"><strong>{user?.nickname || user?.username}</strong><small>{user?.email}</small></span>}
            {!desktop && <button className="mail-icon-button" onClick={onClose} aria-label={t('close')}><X size={20} /></button>}
          </div>
        </div> : <div className="sidebar-brand-row">
          <a href="/" className="sidebar-brand" onClick={event => { event.preventDefault(); navigate('/'); onClose() }} aria-label="HostID"><span className="sidebar-brand-icon"><BrandMark size={36} /></span>{wide && <span>HostID<small>MAIL WORKSPACE</small></span>}</a>
          {wide && <button className="mail-icon-button sidebar-close" onClick={desktop ? togglePin : onClose} aria-label={desktop ? pinned ? t('unpinSidebar') : t('pinSidebar') : t('close')} title={desktop ? pinned ? t('unpinSidebar') : t('pinSidebar') : t('close')}>{desktop ? pinned ? <PanelLeftClose size={17} /> : <PanelLeftOpen size={17} /> : <X size={19} />}</button>}
        </div>}
        {!classic && !wide && <button ref={expandButtonRef} className="mail-icon-button mx-auto mb-3" aria-label={t('expandSidebar')} title={t('expandSidebar')} onClick={expandSidebar}><PanelLeftOpen size={17} /></button>}
        <div className="sidebar-compose-wrap"><button className="sidebar-compose" title={t('compose')} aria-label={t('compose')} onClick={() => { setExpanded(false); openCompose(); onClose() }}><PenLine size={classic ? 20 : 18} />{wide && <span>{classic ? t('compose') : language === 'zh-CN' ? '撰写邮件' : 'Compose'}</span>}</button></div>
        <nav className="sidebar-nav" aria-label={t('mailbox')}>
          {navGroups.map(group => <div className="sidebar-nav-group" key={group.label}>
            {wide && <div className="sidebar-group-label">{group.label}</div>}
            {group.items.map(item => {
              const active = item.folder ? item.folder === currentFolder : item.path === pathname
              return <button key={item.path} title={item.label} aria-label={item.label} aria-current={active ? 'page' : undefined} className={`sidebar-nav-item ${active ? 'is-active' : ''}`} onClick={() => { navigate(item.path); onClose(); if (!pinned) setExpanded(false) }}><item.icon size={19} strokeWidth={active ? 2 : 1.7} />{wide && <><span>{item.label}</span>{active && <span className="sidebar-active-dot" />}</>}</button>
            })}
          </div>)}
        </nav>
        {!classic && <button className="sidebar-account" title={user?.email} aria-label={t('profile')} onClick={() => { navigate('/profile'); onClose() }}>
          <span className="sidebar-avatar">{user?.avatarUrl || user?.avatar ? <img src={user.avatarUrl || (user.avatar?.startsWith('http') ? user.avatar : `/api/auth/avatar/${user.avatar}`)} alt="" /> : <UserCircle size={24} />}</span>
          {wide && <><span className="sidebar-account-text"><strong>{user?.nickname || user?.username}</strong><small>{user?.email}</small></span><ChevronRight size={15} /></>}
        </button>}
      </div>
    </aside>
  </>
}
