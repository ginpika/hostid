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

export interface ThemeConfig {
  id: string
  name: string
  nameEn: string
  description?: string
  descriptionEn?: string
  preview?: string
  author?: string
  version?: string
  colors: ThemeColors
  background?: ThemeBackground
  customCSS?: string
}

export const themes: ThemeConfig[] = [
  {
    id: 'light',
    name: '浅色模式',
    nameEn: 'Light',
    description: '经典浅色主题',
    descriptionEn: 'Classic light theme',
    colors: {
      bg: { primary: '#f9fafb', secondary: '#ffffff', tertiary: '#f3f4f6', hover: '#f3f4f6' },
      text: { primary: '#111827', secondary: '#374151', tertiary: '#6b7280', quaternary: '#9ca3af', muted: '#9ca3af' },
      border: { primary: '#e5e7eb', secondary: '#d1d5db' },
      accent: { primary: '#0ea5e9', secondary: '#0284c7', muted: 'rgba(14, 165, 233, 0.1)', text: '#ffffff' },
      code: { bg: '#f3f4f6', text: '#1f2937' },
      pre: { bg: '#1e293b', text: '#e2e8f0' }
    }
  },
  {
    id: 'dark',
    name: '深色模式',
    nameEn: 'Dark',
    description: '程序员偏爱的深黑主题',
    descriptionEn: 'Dark theme preferred by developers',
    colors: {
      bg: { primary: '#0a0a0a', secondary: '#141414', tertiary: '#1a1a1a', hover: '#1a1a1a' },
      text: { primary: '#e5e5e5', secondary: '#a3a3a3', tertiary: '#737373', quaternary: '#525252', muted: '#525252' },
      border: { primary: '#262626', secondary: '#333333' },
      accent: { primary: '#00d98a', secondary: '#00c47a', muted: 'rgba(0, 217, 138, 0.1)', text: '#0a0a0a' },
      code: { bg: '#262626', text: '#e5e5e5' },
      pre: { bg: '#0d1117', text: '#c9d1d9' }
    }
  },
  {
    id: 'sakura',
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
    id: 'starry-night',
    name: '星空夜景',
    nameEn: 'Starry Night',
    description: '夜晚星空动漫风格',
    descriptionEn: 'Night sky anime style',
    colors: {
      bg: { primary: '#0f0f23', secondary: '#1a1a2e', tertiary: '#16213e', hover: '#16213e' },
      text: { primary: '#eaeaea', secondary: '#c4c4c4', tertiary: '#888888', quaternary: '#666666', muted: '#666666' },
      border: { primary: '#2d2d44', secondary: '#3d3d5c' },
      accent: { primary: '#e94560', secondary: '#ff6b6b', muted: 'rgba(233, 69, 96, 0.1)', text: '#ffffff' },
      code: { bg: '#1a1a2e', text: '#eaeaea' },
      pre: { bg: '#0a0a1a', text: '#c4c4c4' }
    }
  },
  {
    id: 'forest',
    name: '森林',
    nameEn: 'Forest',
    description: '清新自然绿色主题',
    descriptionEn: 'Fresh natural green theme',
    colors: {
      bg: { primary: '#f0fdf4', secondary: '#ffffff', tertiary: '#dcfce7', hover: '#dcfce7' },
      text: { primary: '#14532d', secondary: '#166534', tertiary: '#15803d', quaternary: '#22c55e', muted: '#22c55e' },
      border: { primary: '#bbf7d0', secondary: '#86efac' },
      accent: { primary: '#16a34a', secondary: '#15803d', muted: 'rgba(22, 163, 74, 0.1)', text: '#ffffff' },
      code: { bg: '#dcfce7', text: '#14532d' },
      pre: { bg: '#14532d', text: '#dcfce7' }
    }
  },
  {
    id: 'ocean',
    name: '海洋',
    nameEn: 'Ocean',
    description: '深邃海洋蓝色主题',
    descriptionEn: 'Deep ocean blue theme',
    colors: {
      bg: { primary: '#0c1929', secondary: '#132f4c', tertiary: '#1a4971', hover: '#1a4971' },
      text: { primary: '#e3f2fd', secondary: '#bbdefb', tertiary: '#90caf9', quaternary: '#64b5f6', muted: '#64b5f6' },
      border: { primary: '#1e3a5f', secondary: '#2e5a8a' },
      accent: { primary: '#29b6f6', secondary: '#0288d1', muted: 'rgba(41, 182, 246, 0.1)', text: '#0c1929' },
      code: { bg: '#132f4c', text: '#e3f2fd' },
      pre: { bg: '#0a1628', text: '#bbdefb' }
    }
  },
  {
    id: 'sunset',
    name: '日落',
    nameEn: 'Sunset',
    description: '温暖日落橙色调',
    descriptionEn: 'Warm sunset orange theme',
    colors: {
      bg: { primary: '#fffbeb', secondary: '#ffffff', tertiary: '#fef3c7', hover: '#fef3c7' },
      text: { primary: '#78350f', secondary: '#92400e', tertiary: '#b45309', quaternary: '#d97706', muted: '#d97706' },
      border: { primary: '#fde68a', secondary: '#fcd34d' },
      accent: { primary: '#f59e0b', secondary: '#d97706', muted: 'rgba(245, 158, 11, 0.1)', text: '#ffffff' },
      code: { bg: '#fef3c7', text: '#78350f' },
      pre: { bg: '#78350f', text: '#fef3c7' }
    }
  },
  {
    id: 'lavender',
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
  }
]

export function getThemeById(id: string): ThemeConfig | undefined {
  return themes.find(t => t.id === id)
}

export function getDefaultTheme(): ThemeConfig {
  return themes[0]
}
