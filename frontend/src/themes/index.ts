/**
 * 主题配置模块
 * 定义预设浅色主题的配色方案
 * 默认深空灰，保留深空灰、默认蓝、樱花、薰衣草以及经典浅色主题
 */
export interface ThemeColors {
  bg: {
    primary: string
    secondary: string
    tertiary: string
    hover: string
  }
  text: {
    primary: string
    secondary: string
    tertiary: string
    quaternary: string
    muted: string
  }
  border: {
    primary: string
    secondary: string
  }
  accent: {
    primary: string
    secondary: string
    muted: string
    text: string
  }
  code?: {
    bg: string
    text: string
  }
  pre?: {
    bg: string
    text: string
  }
}

export interface ThemeBackground {
  image?: string
  blur?: number
  opacity?: number
  pattern?: string
}

export type ThemeLayout = 'workspace' | 'classic'

export interface ThemeConfig {
  id: string
  colorScheme: 'light'
  name: string
  nameEn: string
  description?: string
  descriptionEn?: string
  preview?: string
  author?: string
  version?: string
  colors: ThemeColors
  layout?: ThemeLayout
  background?: ThemeBackground
  customCSS?: string
}

export const themes: ThemeConfig[] = [
  {
    id: 'business',
    colorScheme: 'light',
    name: '深空灰',
    nameEn: 'Space Gray',
    description: '白与浅灰的留白空间，搭配深灰强调',
    descriptionEn: 'A clean white and light-gray workspace with charcoal accents',
    colors: {
      bg: { primary: '#f5f5f5', secondary: '#ffffff', tertiary: '#efefef', hover: '#f0f0f0' },
      text: { primary: '#1f1f1f', secondary: '#4b4b4b', tertiary: '#626262', quaternary: '#6b6b6b', muted: '#6b6b6b' },
      border: { primary: '#e3e3e3', secondary: '#d4d4d4' },
      accent: { primary: '#333333', secondary: '#1f1f1f', muted: 'rgba(51, 51, 51, 0.07)', text: '#ffffff' },
      code: { bg: '#efefef', text: '#333333' },
      pre: { bg: '#202020', text: '#ededed' }
    }
  },
  {
    id: 'light',
    colorScheme: 'light',
    name: '默认蓝',
    nameEn: 'Default Blue',
    description: '留白充足的工作空间，搭配经典蓝强调',
    descriptionEn: 'A spacious light workspace with classic blue accents',
    colors: {
      bg: { primary: '#f4f6fa', secondary: '#ffffff', tertiary: '#edf1f7', hover: '#f4f7fc' },
      text: { primary: '#202b40', secondary: '#526078', tertiary: '#627188', quaternary: '#8490a4', muted: '#8490a4' },
      border: { primary: '#e4e9f1', secondary: '#d5deea' },
      accent: { primary: '#286cde', secondary: '#1e5cc5', muted: 'rgba(40, 108, 222, 0.075)', text: '#ffffff' },
      code: { bg: '#f3f4f6', text: '#1f2937' },
      pre: { bg: '#1e293b', text: '#e2e8f0' }
    }
  },
  {
    id: 'sakura',
    colorScheme: 'light',
    name: '樱花',
    nameEn: 'Sakura',
    description: '粉色樱花动漫风格',
    descriptionEn: 'Pink sakura anime style',
    colors: {
      bg: { primary: '#fef2f2', secondary: '#ffffff', tertiary: '#fce7f3', hover: '#fce7f3' },
      text: { primary: '#831843', secondary: '#9d174d', tertiary: '#be185d', quaternary: '#ec4899', muted: '#ec4899' },
      border: { primary: '#fbcfe8', secondary: '#f9a8d4' },
      accent: { primary: '#ec4899', secondary: '#db2777', muted: 'rgba(236, 72, 153, 0.1)', text: '#ffffff' },
      code: { bg: '#fce7f3', text: '#831843' },
      pre: { bg: '#831843', text: '#fce7f3' }
    }
  },
  {
    id: 'lavender',
    colorScheme: 'light',
    name: '薰衣草',
    nameEn: 'Lavender',
    description: '优雅薰衣草紫色主题',
    descriptionEn: 'Elegant lavender purple theme',
    colors: {
      bg: { primary: '#faf5ff', secondary: '#ffffff', tertiary: '#f3e8ff', hover: '#f3e8ff' },
      text: { primary: '#581c87', secondary: '#6b21a8', tertiary: '#7e22ce', quaternary: '#a855f7', muted: '#a855f7' },
      border: { primary: '#e9d5ff', secondary: '#d8b4fe' },
      accent: { primary: '#a855f7', secondary: '#9333ea', muted: 'rgba(168, 85, 247, 0.1)', text: '#ffffff' },
      code: { bg: '#f3e8ff', text: '#581c87' },
      pre: { bg: '#581c87', text: '#f3e8ff' }
    }
  },
  {
    id: 'classic',
    colorScheme: 'light',
    name: '经典',
    nameEn: 'Classic',
    description: '保留旧版布局与浅色配色',
    descriptionEn: 'Original layout and light palette',
    layout: 'classic',
    colors: {
      bg: { primary: '#f9fafb', secondary: '#ffffff', tertiary: '#f3f4f6', hover: '#f3f4f6' },
      text: { primary: '#111827', secondary: '#374151', tertiary: '#626b78', quaternary: '#626b78', muted: '#626b78' },
      border: { primary: '#e5e7eb', secondary: '#d1d5db' },
      accent: { primary: '#0ea5e9', secondary: '#0284c7', muted: 'rgba(14, 165, 233, 0.1)', text: '#ffffff' },
      code: { bg: '#f3f4f6', text: '#1f2937' },
      pre: { bg: '#1e293b', text: '#e2e8f0' }
    }
  }
]

export function getThemeById(id: string): ThemeConfig | undefined {
  // Restore saved Sunset preferences using its replacement palette.
  const themeId = id === 'sunset' ? 'business' : id
  return themes.find(t => t.id === themeId)
}

export function getDefaultTheme(): ThemeConfig {
  return themes[0]
}

/** Layout belongs to the theme; existing color themes use the modern workspace. */
export function getThemeLayout(theme: ThemeConfig): ThemeLayout {
  return theme.layout || 'workspace'
}

export function resolveTheme(mode: string): ThemeConfig {
  return getThemeById(mode) || getDefaultTheme()
}

export function getThemeClasses(theme: ThemeConfig): string[] {
  return [`theme-${theme.id}`, `design-${getThemeLayout(theme)}`]
}
