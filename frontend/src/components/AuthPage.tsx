import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { Link } from 'react-router-dom'
import { Globe, Loader2 } from 'lucide-react'
import { useI18n } from '../i18n/I18nContext'
import { useConfig } from '../contexts/ConfigContext'
import BrandMark from './BrandMark'
import ThemeSelector from './ThemeSelector'
import '../styles/auth-page.css'

export function AuthToolbar({ style, inline = false }: { style?: CSSProperties; inline?: boolean }) {
  const { t, language, setLanguage } = useI18n()
  const [showLanguageMenu, setShowLanguageMenu] = useState(false)
  const languageMenuRef = useRef<HTMLDivElement>(null)
  const languageButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const closeOutside = (event: MouseEvent) => {
      if (!languageMenuRef.current?.contains(event.target as Node)) setShowLanguageMenu(false)
    }
    document.addEventListener('mousedown', closeOutside)
    return () => document.removeEventListener('mousedown', closeOutside)
  }, [])

  const selectLanguage = async (value: 'zh-CN' | 'en-US') => {
    await setLanguage(value)
    setShowLanguageMenu(false)
  }

  return (
    <div className={`flex justify-end shrink-0 ${inline ? '' : 'mb-6'} gap-2 items-center relative z-50`} style={style}>
      <ThemeSelector />
      <div
        className="relative"
        ref={languageMenuRef}
        onKeyDown={event => {
          if (event.key === 'Escape' && showLanguageMenu) {
            event.stopPropagation()
            setShowLanguageMenu(false)
            languageButtonRef.current?.focus()
          }
        }}
      >
        <button
          ref={languageButtonRef}
          type="button"
          onClick={() => setShowLanguageMenu(open => !open)}
          aria-expanded={showLanguageMenu}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors hover:bg-[var(--color-bg-tertiary)]"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          <Globe className="w-4 h-4" aria-hidden="true" />
          <span className="text-sm font-medium">{language === 'zh-CN' ? t('chinese') : t('english')}</span>
        </button>
        {showLanguageMenu && (
          <div
            className="absolute top-full right-0 mt-2 w-40 rounded-lg shadow-lg py-1 z-10"
            style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border-primary)' }}
          >
            {(['zh-CN', 'en-US'] as const).map(value => (
              <button
                key={value}
                type="button"
                onClick={() => selectLanguage(value)}
                aria-pressed={language === value}
                className="w-full text-left px-4 py-2 text-sm transition-colors hover:bg-[var(--color-bg-tertiary)]"
                style={{
                  color: language === value ? 'var(--color-accent-primary)' : 'var(--color-text-secondary)',
                  backgroundColor: language === value ? 'var(--color-bg-tertiary)' : 'transparent'
                }}
              >
                {value === 'zh-CN' ? t('chinese') : t('english')}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export function AuthHeader({ title, description, children }: { title: string; description?: string; children?: ReactNode }) {
  const { siteName } = useConfig()
  return (
    <div className="text-center mb-8">
      <div className="inline-flex items-center justify-center mb-4">
        <BrandMark size={100} className="w-[100px] h-[100px]" label={siteName} />
      </div>
      <h1 className="text-2xl font-bold break-words" style={{ color: 'var(--color-text-primary)' }}>{title}</h1>
      {description && <p className="mt-2 break-words" style={{ color: 'var(--color-text-tertiary)' }}>{description}</p>}
      {children}
    </div>
  )
}

export function AuthLoading({ message }: { message?: string }) {
  const { t } = useI18n()
  return (
    <div role="status" className="flex flex-col items-center gap-4 py-4 text-center" style={{ color: 'var(--color-text-secondary)' }}>
      <Loader2 className="w-8 h-8 animate-spin" style={{ color: 'var(--color-accent-primary)' }} aria-hidden="true" />
      <p className="text-sm">{message || t('loading')}</p>
    </div>
  )
}

interface AuthPageProps {
  children: ReactNode
  aside?: ReactNode
  desktopHeader?: ReactNode
  footer?: ReactNode
  split?: boolean
  compact?: boolean
  cardRef?: RefObject<HTMLDivElement>
  cardStyle?: CSSProperties
  asideStyle?: CSSProperties
  toolbarStyle?: CSSProperties
  footerStyle?: CSSProperties
}

/** Shared login card for every step of authentication and initial setup. */
export default function AuthPage({
  children,
  aside,
  desktopHeader,
  footer,
  split,
  compact = false,
  cardRef,
  cardStyle,
  asideStyle,
  toolbarStyle,
  footerStyle
}: AuthPageProps) {
  const { t } = useI18n()
  const hasSplitShell = split ?? Boolean(aside)
  const isSplitCard = hasSplitShell && !compact
  const footerContent = footer === undefined ? (
    <Link to="/tos" className="text-sm hover:underline transition-colors" style={{ color: 'var(--color-text-muted)' }}>
      {t('tosAndPrivacy')}
    </Link>
  ) : footer

  return (
    <div className="auth-viewport">
      <div className={`auth-shell relative ${hasSplitShell ? 'auth-shell--split' : ''}`}>
        <div
          ref={cardRef}
          className={`auth-card ${isSplitCard ? 'auth-card--split' : ''}`}
          style={cardStyle}
        >
          {aside && !compact && (
            <aside className="auth-split-aside" style={asideStyle}>
              {aside}
            </aside>
          )}
          <div className={isSplitCard ? 'auth-split-main' : 'auth-single-main'}>
            {isSplitCard ? (
              <>
                <div className="auth-split-top">
                  {desktopHeader}
                  <AuthToolbar style={toolbarStyle} inline />
                </div>
                <div className="auth-split-body">{children}</div>
              </>
            ) : (
              <>
                <AuthToolbar style={toolbarStyle} />
                {children}
              </>
            )}
          </div>
        </div>
        {footerContent != null && (
          <div className={`${isSplitCard ? 'mt-5' : 'mt-8'} text-center transition-all ease-out`} style={footerStyle}>
            {footerContent}
          </div>
        )}
      </div>
    </div>
  )
}
