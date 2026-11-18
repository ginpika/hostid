import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react'
import { Copy, Minus, Square, X } from 'lucide-react'
import { useTheme } from '../contexts/ThemeContext'
import {
  closeWindow,
  isDesktopShell,
  isMacDesktop,
  isWindowFullscreen,
  isWindowMaximized,
  minimizeWindow,
  resizeWindow,
  setWindowBackgroundColor,
  setWindowTheme,
  toggleMaximizeWindow,
} from '../lib/desktop'
import '../styles/desktop-frame.css'

const RESIZE_EDGES = [
  'North',
  'South',
  'West',
  'East',
  'NorthWest',
  'NorthEast',
  'SouthWest',
  'SouthEast',
] as const

export default function DesktopFrame({ children }: { children: ReactNode }) {
  const desktop = isDesktopShell()
  const mac = isMacDesktop()
  const { currentTheme } = useTheme()
  const [maximized, setMaximized] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)

  useLayoutEffect(() => {
    if (!desktop) return
    const root = document.documentElement
    root.dataset.desktop = 'true'
    root.dataset.desktopOs = mac ? 'mac' : 'other'
    return () => {
      delete root.dataset.desktop
      delete root.dataset.desktopOs
      delete root.dataset.desktopMaximized
      delete root.dataset.desktopFullscreen
    }
  }, [desktop, mac])

  useLayoutEffect(() => {
    if (!desktop) return
    const root = document.documentElement
    root.dataset.desktopMaximized = maximized ? 'true' : 'false'
    root.dataset.desktopFullscreen = fullscreen ? 'true' : 'false'
  }, [desktop, maximized, fullscreen])

  useEffect(() => {
    if (!mac) return
    setWindowTheme(currentTheme.colorScheme)
    setWindowBackgroundColor(currentTheme.colors.bg.primary)
  }, [mac, currentTheme.colorScheme, currentTheme.colors.bg.primary])

  useEffect(() => {
    if (!desktop) return
    let active = true
    const sync = () => {
      if (!mac) {
        void isWindowMaximized().then(next => {
          if (active) setMaximized(next)
        })
        return
      }
      void isWindowFullscreen().then(next => {
        if (active) setFullscreen(next)
      })
    }
    sync()
    window.addEventListener('resize', sync)
    return () => {
      active = false
      window.removeEventListener('resize', sync)
    }
  }, [desktop, mac])

  if (!desktop) return <>{children}</>

  return (
    <>
      {!mac && <div className="desktop-top-drag" data-tauri-drag-region aria-hidden="true" />}
      {children}
      {!mac && (
        <>
          <div className="desktop-win-controls" aria-label="Window controls">
            <button
              type="button"
              className="desktop-wbtn"
              title="最小化 / Minimize"
              aria-label="Minimize"
              onClick={minimizeWindow}
            >
              <Minus size={13} />
            </button>
            <button
              type="button"
              className="desktop-wbtn"
              title={maximized ? '还原 / Restore' : '最大化 / Maximize'}
              aria-label={maximized ? 'Restore' : 'Maximize'}
              onClick={() => void toggleMaximizeWindow().then(setMaximized)}
            >
              {maximized ? <Copy size={11} /> : <Square size={11} />}
            </button>
            <button
              type="button"
              className="desktop-wbtn desktop-wbtn--close"
              title="关闭 / Close"
              aria-label="Close"
              onClick={closeWindow}
            >
              <X size={13} />
            </button>
          </div>
          <div className="desktop-resize" aria-hidden="true">
            {RESIZE_EDGES.map(dir => (
              <i
                key={dir}
                data-dir={dir}
                onPointerDown={event => {
                  if (event.button !== 0) return
                  event.preventDefault()
                  resizeWindow(dir)
                }}
              />
            ))}
          </div>
        </>
      )}
    </>
  )
}
