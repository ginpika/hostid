import { useEffect, useRef, useCallback, useState } from 'react'
import { useTheme } from '../contexts/ThemeContext'

declare global {
  interface Window {
    turnstile?: {
      render: (container: string | HTMLElement, options: TurnstileOptions) => string
      reset: (widgetId: string) => void
      remove: (widgetId: string) => void
    }
    onTurnstileLoad?: () => void
  }
}

interface TurnstileOptions {
  sitekey: string
  callback: (token: string) => void
  'error-callback'?: () => void
  'expired-callback'?: () => void
  theme?: 'light' | 'dark' | 'auto'
  size?: 'normal' | 'compact'
  language?: string
}

interface TurnstileProps {
  siteKey: string
  onVerify: (token: string) => void
  onError?: () => void
  onExpire?: () => void
  theme?: 'light' | 'dark' | 'auto'
  language?: string
}

const TURNSTILE_WIDTH = 300
const TURNSTILE_HEIGHT = 65

export default function Turnstile({ 
  siteKey, 
  onVerify, 
  onError, 
  onExpire,
  language = 'zh-CN'
}: TurnstileProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const widgetIdRef = useRef<string | null>(null)
  const [widgetRendered, setWidgetRendered] = useState(false)
  const { resolvedSystemTheme, mode, currentTheme } = useTheme()
  
  const getTurnstileTheme = useCallback((): 'light' | 'dark' | 'auto' => {
    if (mode === 'system') {
      return resolvedSystemTheme
    }
    if (currentTheme.id === 'light') return 'light'
    return 'dark'
  }, [mode, resolvedSystemTheme, currentTheme])

  const renderWidget = useCallback(() => {
    if (!window.turnstile || !containerRef.current || widgetIdRef.current) return

    widgetIdRef.current = window.turnstile.render(containerRef.current, {
      sitekey: siteKey,
      callback: onVerify,
      'error-callback': onError,
      'expired-callback': onExpire,
      theme: getTurnstileTheme(),
      size: 'normal',
      language
    })
    setWidgetRendered(true)
  }, [siteKey, onVerify, onError, onExpire, getTurnstileTheme, language])

  useEffect(() => {
    if (window.turnstile) {
      renderWidget()
      return
    }
    
    const script = document.createElement('script')
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    script.async = true
    script.defer = true
    
    script.onload = () => {
      if (window.turnstile) {
        renderWidget()
      }
    }
    
    document.head.appendChild(script)
    
    return () => {
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current)
        widgetIdRef.current = null
      }
    }
  }, [renderWidget])
  
  return (
    <div className="flex justify-center" style={{ minHeight: TURNSTILE_HEIGHT }}>
      {!widgetRendered && (
        <div 
          className="rounded-lg animate-pulse"
          style={{ 
            width: TURNSTILE_WIDTH, 
            height: TURNSTILE_HEIGHT,
            backgroundColor: 'var(--color-bg-tertiary)'
          }}
        />
      )}
      <div 
        ref={containerRef} 
        style={{ 
          visibility: widgetRendered ? 'visible' : 'hidden',
          width: TURNSTILE_WIDTH,
          height: TURNSTILE_HEIGHT
        }} 
      />
    </div>
  )
}
