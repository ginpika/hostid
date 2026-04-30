/**
 * 主题上下文
 * 管理系统主题和自定义主题切换
 * 支持跟随系统、浅色、深色和多种预设主题
 */
import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { themes, ThemeConfig, getThemeById, getDefaultTheme } from '../themes'

type SystemTheme = 'light' | 'dark'
type ThemeMode = 'system' | string

interface ThemeContextType {
  mode: ThemeMode
  setMode: (mode: ThemeMode) => void
  currentTheme: ThemeConfig
  resolvedSystemTheme: SystemTheme
  allThemes: ThemeConfig[]
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

const STORAGE_KEY = 'theme_mode'

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(() => {
    if (typeof window === 'undefined') return 'system'
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored || 'system'
  })

  const [resolvedSystemTheme, setResolvedSystemTheme] = useState<SystemTheme>(() => {
    if (typeof window === 'undefined') return 'light'
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    setResolvedSystemTheme(mediaQuery.matches ? 'dark' : 'light')

    const handler = (e: MediaQueryListEvent) => {
      setResolvedSystemTheme(e.matches ? 'dark' : 'light')
    }
    mediaQuery.addEventListener('change', handler)
    return () => mediaQuery.removeEventListener('change', handler)
  }, [])

  const currentTheme = mode === 'system'
    ? getThemeById(resolvedSystemTheme) || getDefaultTheme()
    : getThemeById(mode) || getDefaultTheme()

  useEffect(() => {
    const root = document.documentElement
    const { colors, background, customCSS } = currentTheme

    root.style.setProperty('--color-bg-primary', colors.bg.primary)
    root.style.setProperty('--color-bg-secondary', colors.bg.secondary)
    root.style.setProperty('--color-bg-tertiary', colors.bg.tertiary)
    root.style.setProperty('--color-bg-hover', colors.bg.hover)
    root.style.setProperty('--color-text-primary', colors.text.primary)
    root.style.setProperty('--color-text-secondary', colors.text.secondary)
    root.style.setProperty('--color-text-tertiary', colors.text.tertiary)
    root.style.setProperty('--color-text-quaternary', colors.text.quaternary)
    root.style.setProperty('--color-text-muted', colors.text.muted)
    root.style.setProperty('--color-border-primary', colors.border.primary)
    root.style.setProperty('--color-border-secondary', colors.border.secondary)
    root.style.setProperty('--color-accent-primary', colors.accent.primary)
    root.style.setProperty('--color-accent-secondary', colors.accent.secondary)
    root.style.setProperty('--color-accent-muted', colors.accent.muted)
    root.style.setProperty('--color-accent-text', colors.accent.text)
    
    if (colors.code) {
      root.style.setProperty('--color-code-bg', colors.code.bg)
      root.style.setProperty('--color-code-text', colors.code.text)
    }
    if (colors.pre) {
      root.style.setProperty('--color-pre-bg', colors.pre.bg)
      root.style.setProperty('--color-pre-text', colors.pre.text)
    }

    if (background?.image) {
      root.style.setProperty('--bg-image', `url(${background.image})`)
      root.style.setProperty('--bg-blur', `${background.blur || 0}px`)
      root.style.setProperty('--bg-opacity', String(background.opacity || 1))
    } else {
      root.style.removeProperty('--bg-image')
      root.style.removeProperty('--bg-blur')
      root.style.removeProperty('--bg-opacity')
    }

    if (background?.pattern) {
      root.style.setProperty('--bg-pattern', `url(${background.pattern})`)
    } else {
      root.style.removeProperty('--bg-pattern')
    }

    let styleEl = document.getElementById('theme-custom-css')
    if (customCSS) {
      if (!styleEl) {
        styleEl = document.createElement('style')
        styleEl.id = 'theme-custom-css'
        document.head.appendChild(styleEl)
      }
      styleEl.textContent = customCSS
    } else if (styleEl) {
      styleEl.textContent = ''
    }

    const oldClasses = Array.from(root.classList).filter(c => c.startsWith('theme-') || c.startsWith('system-'))
    root.classList.remove(...oldClasses)
    root.classList.add(`theme-${currentTheme.id}`)
    
    if (mode === 'system') {
      root.classList.add(`system-${resolvedSystemTheme}`)
    }
  }, [currentTheme, mode, resolvedSystemTheme])

  const setMode = (newMode: ThemeMode) => {
    setModeState(newMode)
    localStorage.setItem(STORAGE_KEY, newMode)
  }

  return (
    <ThemeContext.Provider value={{
      mode,
      setMode,
      currentTheme,
      resolvedSystemTheme,
      allThemes: themes
    }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}
