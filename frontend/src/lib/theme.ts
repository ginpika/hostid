/**
 * 主题 CSS 变量工具（已弃用）
 * 提供主题 CSS 变量的快捷访问
 * 注意：当前未被项目使用，建议使用 ThemeContext 替代
 */
export const theme = {
  bg: {
    primary: 'var(--color-bg-primary)',
    secondary: 'var(--color-bg-secondary)',
    tertiary: 'var(--color-bg-tertiary)',
  },
  text: {
    primary: 'var(--color-text-primary)',
    secondary: 'var(--color-text-secondary)',
    tertiary: 'var(--color-text-tertiary)',
    muted: 'var(--color-text-muted)',
  },
  border: {
    primary: 'var(--color-border-primary)',
    secondary: 'var(--color-border-secondary)',
  },
  accent: {
    primary: 'var(--color-accent-primary)',
    secondary: 'var(--color-accent-secondary)',
  }
}

export const getThemeStyle = (path: string): string => {
  const parts = path.split('.')
  let current: any = theme
  for (const part of parts) {
    current = current[part]
  }
  return current
}
