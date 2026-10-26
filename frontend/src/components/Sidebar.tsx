/**
 * 侧边栏导航组件
 * 提供邮件文件夹导航、撰写按钮和管理员入口
 * 作为持久化组件，不会随路由切换重新渲染
 */
import { useLocation, useNavigate } from 'react-router-dom'
import { Inbox, Send, Trash2, Pen, X, UserCircle, Archive, Shield, Key, AppWindow, Star, Pin, PinOff } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useI18n } from '../i18n/I18nContext'
import { useCompose } from '../contexts/ComposeContext'

type Folder = 'INBOX' | 'SENT' | 'TRASH' | 'ARCHIVED' | 'STARRED'

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
        className={`fixed lg:static inset-y-0 left-0 z-30 transform transition-all duration-200 flex-shrink-0 w-64 ${
          pinned ? 'lg:w-64' : 'lg:w-[68px]'
        } ${
          isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
        style={{ 
          backgroundColor: 'var(--color-bg-secondary)',
          borderRight: '1px solid var(--color-border-primary)'
        }}
      >
        <div className="h-full flex flex-col">
          <div className="relative flex-shrink-0 border-b" style={{ borderColor: 'var(--color-border-primary)' }}>
            <button
              onClick={onTogglePin}
              className="hidden lg:block absolute top-2 right-2 z-10 p-1.5 rounded-md transition-colors hover:bg-[var(--color-bg-tertiary)]"
              style={{ color: pinned ? 'var(--color-accent-primary)' : 'var(--color-text-muted)' }}
              title={pinned ? t('unpinSidebar') : t('pinSidebar')}
            >
              {pinned ? <PinOff className="w-4 h-4" /> : <Pin className="w-4 h-4" />}
            </button>

            <div className={`p-4 ${pinned ? 'lg:pr-10' : 'lg:p-2 lg:pt-10 lg:pb-3'}`}>
              <div className="flex items-center gap-3 lg:justify-center">
                <div 
                  className={`w-14 h-14 rounded-full flex-shrink-0 overflow-hidden flex items-center justify-center ${pinned ? '' : 'lg:w-9 lg:h-9'}`}
                  style={{ 
                    backgroundColor: user?.avatar ? 'transparent' : `color-mix(in srgb, var(--color-accent-primary) 20%, transparent)`,
                    color: 'var(--color-accent-primary)'
                  }}
                >
                  {user?.avatar || user?.avatarUrl ? (
                    <img src={user.avatarUrl || (user.avatar?.startsWith('http') ? user.avatar : `/api/auth/avatar/${user.avatar}`)} alt={user.nickname || user.username} className="w-full h-full object-cover" />
                  ) : (
                    <UserCircle className={`w-8 h-8 ${pinned ? '' : 'lg:w-5 lg:h-5'}`} />
                  )}
                </div>
                <div className={`flex-1 min-w-0 ${pinned ? '' : 'lg:hidden'}`}>
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

          <div className={`${pinned ? 'px-3 py-4' : 'px-3 py-4 lg:px-2 lg:py-3'}`}>
            <button
              onClick={() => openCompose()}
              title={t('compose')}
              className={`group relative w-full flex items-center justify-center gap-2.5 rounded-xl font-semibold tracking-wide overflow-hidden transition-all duration-300 ease-out shadow-lg hover:shadow-xl hover:-translate-y-0.5 active:translate-y-0 ${
                pinned ? 'py-3.5 px-5 text-[15px]' : 'py-3.5 px-5 text-[15px] lg:px-0 lg:py-3'
              }`}
              style={{
                background: 'linear-gradient(135deg, var(--color-accent-primary) 0%, var(--color-accent-secondary) 100%)',
                color: 'var(--color-accent-text)',
                boxShadow: '0 4px 14px -3px color-mix(in srgb, var(--color-accent-primary) 50%, transparent)'
              }}
            >
              <Pen className="w-5 h-5 transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" strokeWidth={2.5} />
              <span className={pinned ? '' : 'lg:hidden'}>{t('compose')}</span>
            </button>
          </div>

          <nav className="flex-1 px-2 overflow-y-auto">
            {navGroups.map((group, groupIndex) => (
              <div key={groupIndex} className="mb-4">
                <div className={`px-4 py-2 text-xs font-semibold uppercase tracking-wider ${pinned ? '' : 'lg:hidden'}`} style={{ color: 'var(--color-text-muted)' }}>
                  {group.label}
                </div>
                {group.items.map(item => {
                  const isActive = (item.folder && currentFolder === item.folder) || location.pathname === item.path
                  return (
                    <button
                      key={item.path}
                      onClick={() => handleNavigate(item.path)}
                      title={item.label}
                      className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-left transition-colors hover:bg-[var(--color-bg-tertiary)] ${pinned ? '' : 'lg:justify-center lg:px-0'}`}
                      style={{
                        backgroundColor: isActive ? 'var(--color-bg-tertiary)' : 'transparent',
                        color: isActive ? 'var(--color-accent-primary)' : 'var(--color-text-secondary)'
                      }}
                    >
                      <item.icon className="w-5 h-5" />
                      <span className={`font-medium ${pinned ? '' : 'lg:hidden'}`}>{item.label}</span>
                    </button>
                  )
                })}
              </div>
            ))}
          </nav>
        </div>
      </aside>
    </>
  )
}

export { type Folder }