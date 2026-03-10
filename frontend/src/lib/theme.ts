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
