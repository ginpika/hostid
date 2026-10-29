/** A visual appearance picker shared by the mailbox and authentication pages. */
import { useState, useRef, useEffect, useLayoutEffect, useId, type CSSProperties, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { Check, Moon, Palette, Sun, SunMoon, X } from 'lucide-react'
import { useTheme } from '../contexts/ThemeContext'
import { useI18n } from '../i18n/I18nContext'
import { getThemeLayout, type ThemeConfig } from '../themes'
import { isTopModal, restoreModalFocus } from '../lib/modalStack'
import '../styles/theme-selector.css'

function ThemePreview({ theme }: { theme: ThemeConfig }) {
  const colors = theme.colors
  const style = {
    '--preview-bg': colors.bg.primary,
    '--preview-surface': colors.bg.secondary,
    '--preview-subtle': colors.bg.tertiary,
    '--preview-border': colors.border.primary,
    '--preview-ink': colors.text.primary,
    '--preview-accent': colors.accent.primary,
    '--preview-selection': colors.accent.muted,
  } as CSSProperties
  return <span className={`appearance-preview appearance-preview--${getThemeLayout(theme)}`} style={style} aria-hidden="true">
    <span className="appearance-preview-top"><i /><b /><span><i /><i /></span></span>
    <span className="appearance-preview-content">
      <span className="appearance-preview-sidebar"><b /><i /><i /><i /></span>
      <span className="appearance-preview-list"><i /><i /><i /></span>
      <span className="appearance-preview-reader"><b /><i /><i /><i /><em /></span>
    </span>
  </span>
}

interface PanelPosition { left: number; top: number; width: number; maxHeight: number }

export default function ThemeSelector() {
  const { language, t } = useI18n()
  const { mode, setMode, currentTheme, allThemes, resolvedSystemTheme } = useTheme()
  const zh = language === 'zh-CN'
  const [isOpen, setIsOpen] = useState(false)
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 599px)').matches)
  const [position, setPosition] = useState<PanelPosition>({ left: 12, top: 60, width: 408, maxHeight: 640 })
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const descriptionId = useId()
  const panelId = useId()
  const selectedMode = mode === 'system' ? mode : currentTheme.id
  const currentName = zh ? currentTheme.name : currentTheme.nameEn
  const currentLabel = mode === 'system' ? `${zh ? '跟随系统' : 'System'} · ${currentName}` : currentName
  const close = (restoreFocus = false) => {
    setIsOpen(false)
    if (restoreFocus) requestAnimationFrame(() => restoreModalFocus(triggerRef.current))
  }

  useEffect(() => {
    const media = window.matchMedia('(max-width: 599px)')
    const update = () => setMobile(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useLayoutEffect(() => {
    if (!isOpen || mobile) return
    const update = () => {
      const trigger = triggerRef.current
      const panel = panelRef.current
      if (!trigger || !panel) return
      const rect = trigger.getBoundingClientRect()
      const width = Math.min(408, window.innerWidth - 24)
      const headerHeight = panel.querySelector('header')?.getBoundingClientRect().height || 76
      const footerHeight = panel.querySelector('footer')?.getBoundingClientRect().height || 45
      const desiredHeight = Math.min(680, headerHeight + footerHeight + (contentRef.current?.scrollHeight || 440) + 2)
      const top = Math.max(12, Math.min(rect.bottom + 10, window.innerHeight - Math.min(desiredHeight, window.innerHeight - 24) - 12))
      const next = { left: Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12)), top, width, maxHeight: window.innerHeight - top - 12 }
      setPosition(previous => Object.keys(next).every(key => previous[key as keyof PanelPosition] === next[key as keyof PanelPosition]) ? previous : next)
    }
    update()
    // The provider applies the selected palette and layout in its own layout effect.
    const frame = requestAnimationFrame(update)
    const scroll = (event: Event) => {
      if (event.target instanceof Node && panelRef.current?.contains(event.target)) return
      update()
    }
    window.addEventListener('resize', update)
    document.addEventListener('scroll', scroll, true)
    return () => { cancelAnimationFrame(frame); window.removeEventListener('resize', update); document.removeEventListener('scroll', scroll, true) }
  }, [isOpen, mobile, currentTheme.id, language])

  useEffect(() => {
    if (!isOpen) return
    const panel = panelRef.current
    const frame = requestAnimationFrame(() => {
      const selected = panel?.querySelector<HTMLButtonElement>('[role="radio"][aria-checked="true"]')
      selected?.focus({ preventScroll: true })
      selected?.scrollIntoView({ block: 'nearest' })
    })
    const outside = (event: PointerEvent) => {
      if (!panel?.contains(event.target as Node) && !triggerRef.current?.contains(event.target as Node)) {
        setIsOpen(false)
        if (mobile) requestAnimationFrame(() => restoreModalFocus(triggerRef.current))
      }
    }
    const focus = (event: FocusEvent) => {
      if (!panel || panel.contains(event.target as Node) || (!mobile && triggerRef.current?.contains(event.target as Node))) return
      if (mobile && isTopModal(panel)) panel.querySelector<HTMLButtonElement>('[role="radio"][aria-checked="true"]')?.focus({ preventScroll: true })
      else setIsOpen(false)
    }
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || (mobile && panel && !isTopModal(panel))) return
      event.preventDefault()
      setIsOpen(false)
      requestAnimationFrame(() => restoreModalFocus(triggerRef.current))
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('focusin', focus)
    document.addEventListener('keydown', escape)
    const previousOverflow = document.body.style.overflow
    if (mobile) document.body.style.overflow = 'hidden'
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('focusin', focus)
      document.removeEventListener('keydown', escape)
      if (mobile) document.body.style.overflow = previousOverflow
    }
  }, [isOpen, mobile])

  const select = (value: string) => setMode(value)
  const navigateThemes = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
    const options = Array.from(panelRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]') || [])
    const index = options.indexOf(document.activeElement as HTMLButtonElement)
    if (index < 0) return
    event.preventDefault()
    let next = index
    if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = options.length - 1
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') next = (index + (event.key === 'ArrowLeft' ? -1 : 1) + options.length) % options.length
    else {
      const rect = options[index].getBoundingClientRect()
      const direction = event.key === 'ArrowUp' ? -1 : 1
      const candidates = options.map((option, optionIndex) => ({ rect: option.getBoundingClientRect(), index: optionIndex }))
        .filter(item => direction * (item.rect.top - rect.top) > 4)
        .sort((a, b) => Math.abs(a.rect.top - rect.top) - Math.abs(b.rect.top - rect.top) || Math.abs(a.rect.left + a.rect.width / 2 - rect.left - rect.width / 2) - Math.abs(b.rect.left + b.rect.width / 2 - rect.left - rect.width / 2))
      next = candidates[0]?.index ?? (direction < 0 ? options.length - 1 : 0)
    }
    const option = options[next]
    select(option.dataset.theme || 'system')
    option.focus({ preventScroll: true })
    option.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }
  const trapFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!mobile || event.key !== 'Tab') return
    const items = Array.from(panelRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || []).filter(item => item.tabIndex >= 0)
    const first = items[0]
    const last = items[items.length - 1]
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
  }
  const groups = [
    { layout: 'workspace' as const, label: zh ? '现代界面' : 'Modern', hint: zh ? '柔和留白' : 'Room to breathe' },
    { layout: 'classic' as const, label: zh ? '经典界面' : 'Classic', hint: zh ? '熟悉的三栏布局' : 'The familiar three-column view' },
  ]

  return <>
    <button ref={triggerRef} type="button" onClick={() => isOpen ? close(true) : setIsOpen(true)} aria-label={t('selectTheme')} title={t('selectTheme')} aria-expanded={isOpen} aria-haspopup="dialog" aria-controls={isOpen ? panelId : undefined}
      className={`mail-icon-button appearance-trigger ${isOpen ? 'is-active' : ''}`}>
      <Palette size={18} />
    </button>
    {isOpen && createPortal(<div className="appearance-layer">
      <div className="appearance-backdrop" aria-hidden="true" onClick={() => close(true)} />
      <div ref={panelRef} id={panelId} role="dialog" aria-modal={mobile || undefined} aria-labelledby={titleId} aria-describedby={descriptionId} className="appearance-panel" style={mobile ? undefined : position} onKeyDown={trapFocus}>
        <header className="appearance-header">
          <div><h2 id={titleId}>{zh ? '外观' : 'Appearance'}</h2><p id={descriptionId}>{zh ? '选择你喜欢的界面与配色' : 'Make this space feel like yours.'}</p></div>
          <button type="button" className="appearance-close" aria-label={t('close')} onClick={() => close(true)}><X size={18} /></button>
        </header>
        <div ref={contentRef} className="appearance-content" role="radiogroup" aria-label={t('selectTheme')} onKeyDown={navigateThemes}>
          <button type="button" role="radio" aria-checked={selectedMode === 'system'} tabIndex={selectedMode === 'system' ? 0 : -1} data-theme="system" className={`appearance-system ${selectedMode === 'system' ? 'is-selected' : ''}`} onClick={() => select('system')}>
            <span className="appearance-system-art" aria-hidden="true"><SunMoon size={23} strokeWidth={1.6} /></span>
            <span className="appearance-system-copy"><strong>{zh ? '跟随系统' : 'Match system'}</strong><small>{zh ? '自动切换现代浅色与深色' : 'Auto-switch between Modern light and dark'}</small></span>
            <span className="appearance-radio-mark" aria-hidden="true">{selectedMode === 'system' && <Check size={11} strokeWidth={3} />}</span>
          </button>
          {groups.map(group => <section key={group.layout} className={`appearance-section appearance-section--${group.layout}`} aria-label={group.label}>
            <div className="appearance-section-heading"><h3>{group.label}</h3><span>{group.hint}</span></div>
            <div className="appearance-grid">
              {allThemes.filter(theme => getThemeLayout(theme) === group.layout).map(theme => {
                const selected = selectedMode === theme.id
                const name = zh ? theme.name : theme.nameEn
                return <button type="button" role="radio" key={theme.id} data-theme={theme.id} aria-label={name} aria-checked={selected} tabIndex={selected ? 0 : -1} className={`appearance-option ${selected ? 'is-selected' : ''}`} title={zh ? theme.description : theme.descriptionEn} onClick={() => select(theme.id)}>
                  <span className="appearance-option-art"><ThemePreview theme={theme} />{selected && <span className="appearance-option-check" aria-hidden="true"><Check size={11} strokeWidth={3} /></span>}</span>
                  <span className="appearance-option-name">{name}{group.layout === 'classic' && <span aria-hidden="true">{theme.colorScheme === 'dark' ? <Moon size={12} /> : <Sun size={12} />}</span>}</span>
                </button>
              })}
            </div>
          </section>)}
        </div>
        <footer className="appearance-footer">
          <span className="appearance-current"><i style={{ backgroundColor: currentTheme.colors.accent.primary }} /><span>{currentLabel}</span></span>
          <span className="appearance-saved" role="status" aria-live="polite" aria-label={`${zh ? '已保存' : 'Saved'}: ${currentLabel}`}><Check size={12} />{zh ? '已保存' : 'Saved'}</span>
        </footer>
        <span className="sr-only">{zh ? '系统当前为' : 'System appearance:'} {resolvedSystemTheme === 'dark' ? zh ? '深色' : 'dark' : zh ? '浅色' : 'light'}</span>
      </div>
    </div>, document.body)}
  </>
}
