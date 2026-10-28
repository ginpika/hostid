/**
 * 侧边栏导航组件
 * 提供邮件文件夹导航、撰写按钮和管理员入口
 * 作为持久化组件，不会随路由切换重新渲染
 */
import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Inbox, Send, Trash2, Pen, X, UserCircle, Archive, Shield, Key, AppWindow, Star, Pin, PinOff, Menu } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useI18n } from '../i18n/I18nContext'
import { useCompose } from '../contexts/ComposeContext'

type Folder = 'INBOX' | 'SENT' | 'TRASH' | 'ARCHIVED' | 'STARRED'

// 窄形态展开/收起动画时序（毫秒）：先淡出内容，再过渡宽度，最后淡入内容
const FADE_DURATION = 120
const WIDTH_DURATION = 200

interface SidebarProps {
  isOpen: boolean
  onClose: () => void
  currentFolder?: Folder
  pinned: boolean
  onTogglePin: () => void
}

export default function Sidebar({ isOpen, currentFolder, onClose, pinned, onTogglePin }: SidebarProps) {
  const { user } = useAuth()
  const { t } = useI18n()
  const { openCompose } = useCompose()
  const location = useLocation()
  const navigate = useNavigate()

  // 桌面端窄菜单模式下点击菜单按钮临时展开，鼠标离开后自动收起
  const [clickExpanded, setClickExpanded] = useState(false)
  const [visualExpanded, setVisualExpanded] = useState(false)
  // 内容可见性：展开/收起过程中先隐藏内容，避免排版跳变导致的闪烁
  const [contentVisible, setContentVisible] = useState(true)
  const visualExpandedRef = useRef(false)
  const animationTimers = useRef<number[]>([])

  useEffect(() => {
    const clearTimers = () => {
      animationTimers.current.forEach(id => window.clearTimeout(id))
      animationTimers.current = []
    }
    const schedule = (fn: () => void, delay: number) => {
      animationTimers.current.push(window.setTimeout(fn, delay))
    }

    clearTimers()

    // 固定展开模式不做淡出动画，直接展示完整内容
    if (pinned) {
      visualExpandedRef.current = true
      setVisualExpanded(true)
      setContentVisible(true)
      return clearTimers
    }

    // 视觉状态与目标一致时无需动画
    if (visualExpandedRef.current === clickExpanded) {
      setContentVisible(true)
      return clearTimers
    }

    setContentVisible(false)
    schedule(() => {
      visualExpandedRef.current = clickExpanded
      setVisualExpanded(clickExpanded)
    }, FADE_DURATION)
    schedule(() => setContentVisible(true), FADE_DURATION + WIDTH_DURATION)

    return clearTimers
  }, [clickExpanded, pinned])

  const expanded = pinned || visualExpanded

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

  const handleNavigate = (path: string) => {
    navigate(path)
    onClose()
  }

  return (
    <>
      <div 
        className={`fixed inset-0 bg-black/50 z-20 transition-opacity lg:hidden ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} 
        onClick={onClose} 
      />
      
      <aside 
        className={`fixed lg:relative inset-y-0 left-0 z-30 transform transition-all duration-200 flex-shrink-0 w-64 ${
          pinned ? 'lg:w-64' : 'lg:w-[68px]'
        } ${
          isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
        style={{ backgroundColor: 'var(--color-bg-secondary)' }}
        onMouseLeave={() => {
          if (!pinned) setClickExpanded(false)
        }}
      >
        <div 
          className={`h-full w-64 transition-all duration-200 lg:absolute lg:inset-y-0 lg:left-0 lg:w-64 ${
            expanded ? '' : 'lg:w-[68px]'
          } ${!pinned && visualExpanded ? 'lg:shadow-2xl' : ''}`}
          style={{ 
            backgroundColor: 'var(--color-bg-secondary)',
            borderRight: '1px solid var(--color-border-primary)'
          }}
        >
          <div
            className={`h-full flex flex-col transition-opacity duration-100 ${
              contentVisible ? 'lg:opacity-100' : 'lg:opacity-0 lg:pointer-events-none'
            }`}
          >
            <div className="relative flex-shrink-0 border-b" style={{ borderColor: 'var(--color-border-primary)' }}>
              {expanded && (
                <button
                  onClick={onTogglePin}
                  className="hidden lg:block absolute top-2 right-2 z-10 p-1.5 rounded-md transition-colors hover:bg-[var(--color-bg-tertiary)]"
                  style={{ color: pinned ? 'var(--color-accent-primary)' : 'var(--color-text-muted)' }}
                  title={pinned ? t('unpinSidebar') : t('pinSidebar')}
                >
                  {pinned ? <PinOff className="w-4 h-4" /> : <Pin className="w-4 h-4" />}
                </button>
              )}

              <div className={`p-4 ${expanded ? 'lg:pr-10' : 'lg:p-2 lg:pt-2 lg:pb-3'}`}>
                {!expanded && (
                  <button
                    onClick={() => setClickExpanded(true)}
                    className="hidden lg:flex mx-auto mb-1 p-1 rounded-md transition-colors hover:bg-[var(--color-bg-tertiary)]"
                    style={{ color: 'var(--color-text-muted)' }}
                    title={t('expandSidebar')}
                  >
                    <Menu className="w-4 h-4" />
                  </button>
                )}
                <div className="flex items-center gap-3 lg:justify-center">
                  <div 
                    className={`w-14 h-14 rounded-full flex-shrink-0 overflow-hidden flex items-center justify-center ${expanded ? '' : 'lg:w-9 lg:h-9'}`}
                    style={{ 
                      backgroundColor: user?.avatar ? 'transparent' : `color-mix(in srgb, var(--color-accent-primary) 20%, transparent)`,
                      color: 'var(--color-accent-primary)'
                    }}
                  >
                    {user?.avatar || user?.avatarUrl ? (
                      <img src={user.avatarUrl || (user.avatar?.startsWith('http') ? user.avatar : `/api/auth/avatar/${user.avatar}`)} alt={user.nickname || user.username} className="w-full h-full object-cover" />
                    ) : (
                      <UserCircle className={`w-8 h-8 ${expanded ? '' : 'lg:w-5 lg:h-5'}`} />
                    )}
                  </div>
                  <div className={`flex-1 min-w-0 ${expanded ? '' : 'lg:hidden'}`}>
                    <p className="text-base font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>
                      {user?.nickname || user?.username}
                    </p>
                    <p className="text-sm truncate" style={{ color: 'var(--color-text-muted)' }}>
                      {user?.email}
                    </p>
                  </div>
                  <button onClick={onClose} className="lg:hidden p-1 rounded hover:bg-[var(--color-bg-tertiary)]" style={{ color: 'var(--color-text-muted)' }}>
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </div>

            <div className={`${expanded ? 'px-3 py-4' : 'px-3 py-4 lg:px-2 lg:py-3'}`}>
              <button
                onClick={() => openCompose()}
                title={t('compose')}
                className={`w-full flex items-center justify-center gap-2.5 rounded-xl font-semibold tracking-wide overflow-hidden ${
                  expanded ? 'py-3.5 px-5 text-[15px]' : 'py-3.5 px-5 text-[15px] lg:px-0 lg:py-3'
                }`}
                style={{
                  background: 'linear-gradient(135deg, var(--color-accent-primary) 0%, var(--color-accent-secondary) 100%)',
                  color: 'var(--color-accent-text)'
                }}
              >
                <Pen className="w-5 h-5" strokeWidth={2.5} />
                <span className={expanded ? '' : 'lg:hidden'}>{t('compose')}</span>
              </button>
            </div>

            <nav className="flex-1 px-2 overflow-y-auto">
              {navGroups.map((group, groupIndex) => (
                <div key={groupIndex} className="mb-4">
                  <div className={`px-4 py-2 text-xs font-semibold uppercase tracking-wider ${expanded ? '' : 'lg:hidden'}`} style={{ color: 'var(--color-text-muted)' }}>
                    {group.label}
                  </div>
                  {group.items.map(item => {
                    const isActive = (item.folder && currentFolder === item.folder) || location.pathname === item.path
                    return (
                      <button
                        key={item.path}
                        onClick={() => handleNavigate(item.path)}
                        title={item.label}
                        className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-left transition-colors hover:bg-[var(--color-bg-tertiary)] ${expanded ? '' : 'lg:justify-center lg:px-0'}`}
                        style={{
                          backgroundColor: isActive ? 'var(--color-bg-tertiary)' : 'transparent',
                          color: isActive ? 'var(--color-accent-primary)' : 'var(--color-text-secondary)'
                        }}
                      >
                        <item.icon className="w-5 h-5" />
                        <span className={`font-medium ${expanded ? '' : 'lg:hidden'}`}>{item.label}</span>
                      </button>
                    )
                  })}
                </div>
              ))}
            </nav>
          </div>
        </div>
      </aside>
    </>
  )
}

export { type Folder }
