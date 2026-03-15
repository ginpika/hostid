import { useRef, useState, useEffect } from 'react'
import { ArrowRight, Globe, LogOut, User } from 'lucide-react'
import { useI18n } from '../i18n/I18nContext'
import ThemeSelector from './ThemeSelector'

interface LoggedInCardProps {
  username: string
  nickname?: string | null
  avatar?: string | null
  isRedirecting?: boolean
  onContinue: () => void
  onLogout: () => void
  animateIn?: boolean
}

export default function LoggedInCard({
  username,
  nickname,
  avatar,
  isRedirecting = false,
  onContinue,
  onLogout,
  animateIn = false
}: LoggedInCardProps) {
  const { t, language, setLanguage } = useI18n()
  const [showLanguageMenu, setShowLanguageMenu] = useState(false)
  const [showContent, setShowContent] = useState(false)
  const [startProgress, setStartProgress] = useState(false)
  const languageMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (animateIn) {
      const timer = setTimeout(() => setShowContent(true), 50)
      return () => clearTimeout(timer)
    } else {
      setShowContent(false)
      setStartProgress(false)
    }
  }, [animateIn])

  useEffect(() => {
    if (showContent) {
      const timer = setTimeout(() => setStartProgress(true), 450)
      return () => clearTimeout(timer)
    }
  }, [showContent])

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

  return (
    <div 
      className="p-8 rounded-2xl shadow-lg overflow-hidden"
      style={{ backgroundColor: 'var(--color-bg-secondary)' }}
    >
      <div 
        className="flex justify-end mb-6 gap-2 items-center transition-all ease-out"
        style={{ 
          opacity: showContent ? 1 : 0,
          transform: `translateY(${showContent ? 0 : -10}px)`,
          transition: 'opacity 250ms ease-out, transform 250ms ease-out',
          transitionDelay: '0ms'
        }}
      >
        <ThemeSelector />
        <div className="relative" ref={languageMenuRef}>
          <button
            onClick={() => setShowLanguageMenu(!showLanguageMenu)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors hover:bg-[var(--color-bg-tertiary)]"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            <Globe className="w-4 h-4" />
            <span className="text-sm font-medium">{language === 'zh-CN' ? t('chinese') : t('english')}</span>
          </button>
          
          {showLanguageMenu && (
            <div 
              className="absolute top-full right-0 mt-2 w-40 rounded-lg shadow-lg py-1 z-10"
              style={{ 
                backgroundColor: 'var(--color-bg-secondary)',
                border: '1px solid var(--color-border-primary)'
              }}
            >
              <button
                onClick={() => toggleLanguage('zh-CN')}
                className="w-full text-left px-4 py-2 text-sm transition-colors hover:bg-[var(--color-bg-tertiary)]"
                style={{ 
                  color: language === 'zh-CN' ? 'var(--color-accent-primary)' : 'var(--color-text-secondary)',
                  backgroundColor: language === 'zh-CN' ? 'var(--color-bg-tertiary)' : 'transparent'
                }}
              >
                {t('chinese')}
              </button>
              <button
                onClick={() => toggleLanguage('en-US')}
                className="w-full text-left px-4 py-2 text-sm transition-colors hover:bg-[var(--color-bg-tertiary)]"
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
      </div>

      <div 
        className="text-center mb-8 transition-all ease-out"
        style={{ 
          opacity: showContent ? 1 : 0,
          transform: `translateY(${showContent ? 0 : 10}px)`,
          transition: 'opacity 250ms ease-out, transform 250ms ease-out',
          transitionDelay: '100ms'
        }}
      >
        <div 
          className="inline-flex items-center justify-center w-16 h-16 rounded-full mb-4 overflow-hidden"
          style={{ backgroundColor: 'var(--color-accent-muted)' }}
        >
          {avatar ? (
            <img 
              src={avatar} 
              alt={username}
              className="w-full h-full object-cover"
            />
          ) : (
            <User className="w-8 h-8" style={{ color: 'var(--color-accent-primary)' }} />
          )}
        </div>
        <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
          {nickname || username}
        </h1>
        <p className="mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
          @{username}
        </p>
      </div>

      <div 
        className="transition-all ease-out"
        style={{ 
          opacity: showContent ? 1 : 0,
          transform: `translateY(${showContent ? 0 : 10}px)`,
          transition: 'opacity 250ms ease-out, transform 250ms ease-out',
          transitionDelay: '200ms'
        }}
      >
        {isRedirecting ? (
          <div className="space-y-3">
            <p className="text-sm text-center mb-3" style={{ color: 'var(--color-text-tertiary)' }}>
              {t('redirecting')}
            </p>
            <div 
              className="h-1 rounded-full overflow-hidden"
              style={{ backgroundColor: 'var(--color-bg-tertiary)' }}
            >
              <div 
                className="h-full rounded-full"
                style={{ 
                  backgroundColor: 'var(--color-accent-primary)',
                  width: startProgress ? '100%' : '0%',
                  transition: 'width 1.5s ease-in-out'
                }}
              />
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <button
              onClick={onContinue}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-medium transition-colors"
              style={{ backgroundColor: 'var(--color-accent-primary)', color: 'var(--color-accent-text)' }}
            >
              {t('continue')}
              <ArrowRight className="w-4 h-4" />
            </button>
            
            <button
              onClick={onLogout}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-medium transition-colors"
              style={{ 
                backgroundColor: 'var(--color-bg-tertiary)', 
                color: 'var(--color-text-secondary)' 
              }}
            >
              <LogOut className="w-4 h-4" />
              {t('logout')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
