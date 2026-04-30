/**
 * 主题选择器组件
 * 提供下拉菜单切换系统主题和多种预设主题
 * 支持浅色、深色和自定义主题选择
 */
import { useState, useRef, useEffect } from 'react'
import { Check, Monitor, Palette } from 'lucide-react'
import { useTheme } from '../contexts/ThemeContext'
import { useI18n } from '../i18n/I18nContext'

export default function ThemeSelector() {
  const { language } = useI18n()
  const { mode, setMode, allThemes } = useTheme()
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const getThemeName = (theme: { name: string; nameEn: string }) => {
    return language === 'zh-CN' ? theme.name : theme.nameEn
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-center px-3 py-1.5 rounded-lg transition-colors hover:bg-[var(--color-bg-tertiary)]"
        style={{ color: 'var(--color-text-secondary)' }}
      >
        <Palette className="w-4 h-4" />
      </button>

      {isOpen && (
        <div 
          className="absolute top-full right-0 mt-2 w-48 rounded-lg shadow-lg py-1 z-50"
          style={{ 
            backgroundColor: 'var(--color-bg-secondary)',
            border: '1px solid var(--color-border-primary)'
          }}
        >
          <button
            onClick={() => { setMode('system'); setIsOpen(false) }}
            className="w-full flex items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-[var(--color-bg-tertiary)]"
            style={{ 
              color: mode === 'system' ? 'var(--color-accent-primary)' : 'var(--color-text-secondary)',
              backgroundColor: mode === 'system' ? 'var(--color-bg-tertiary)' : 'transparent'
            }}
          >
            <Monitor className="w-5 h-5" />
            <span className="text-sm flex-1">{language === 'zh-CN' ? '跟随系统' : 'System'}</span>
            {mode === 'system' && <Check className="w-4 h-4" style={{ color: 'var(--color-accent-primary)' }} />}
          </button>

          <div className="h-px my-1" style={{ backgroundColor: 'var(--color-border-primary)' }} />

          {allThemes.map(theme => (
            <button
              key={theme.id}
              onClick={() => { setMode(theme.id); setIsOpen(false) }}
              className="w-full flex items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-[var(--color-bg-tertiary)]"
              style={{ 
                color: mode === theme.id ? 'var(--color-accent-primary)' : 'var(--color-text-secondary)',
                backgroundColor: mode === theme.id ? 'var(--color-bg-tertiary)' : 'transparent'
              }}
            >
              <div 
                className="w-5 h-5 rounded"
                style={{ 
                  background: `linear-gradient(135deg, ${theme.colors.bg.secondary} 0%, ${theme.colors.bg.primary} 50%, ${theme.colors.accent.primary} 100%)`
                }}
              />
              <span className="text-sm flex-1">{getThemeName(theme)}</span>
              {mode === theme.id && <Check className="w-4 h-4" style={{ color: 'var(--color-accent-primary)' }} />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
