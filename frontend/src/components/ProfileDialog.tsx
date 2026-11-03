import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useI18n } from '../i18n/I18nContext'
import { isTopModal, restoreModalFocus } from '../lib/modalStack'

interface ProfileDialogProps {
  open: boolean
  title: string
  description?: string
  icon?: ReactNode
  children: ReactNode
  footer: ReactNode
  onClose: () => void
  busy?: boolean
}

const focusableSelector = 'button:not(:disabled), a[href], input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

function visible(element: HTMLElement): boolean {
  return element.tabIndex >= 0 && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden'
}

export default function ProfileDialog({ open, title, description, icon, children, footer, onClose, busy = false }: ProfileDialogProps) {
  const { t } = useI18n()
  const titleId = useId()
  const descriptionId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const closeCallback = useRef(onClose)
  const busyRef = useRef(busy)
  closeCallback.current = onClose
  busyRef.current = busy

  useEffect(() => {
    if (!open) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const focusInitial = () => {
      const dialog = dialogRef.current
      if (!dialog || !isTopModal(dialog)) return
      const preferred = Array.from(dialog.querySelectorAll<HTMLElement>('[autofocus], input:not(:disabled):not([type="file"]):not([type="hidden"])')).find(visible)
      if (preferred) preferred.focus({ preventScroll: true })
      else if (closeRef.current && !closeRef.current.disabled) closeRef.current.focus({ preventScroll: true })
      else dialog.focus({ preventScroll: true })
    }
    focusInitial()

    const keydown = (event: KeyboardEvent) => {
      const dialog = dialogRef.current
      if (!dialog || !isTopModal(dialog)) return
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        if (!busyRef.current) closeCallback.current()
      } else if (event.key === 'Tab') {
        const items = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector)).filter(visible)
        const first = items[0]
        const last = items[items.length - 1]
        const outside = !dialog.contains(document.activeElement) || document.activeElement === dialog
        if (!first || !last) {
          event.preventDefault()
          dialog.focus()
        } else if (event.shiftKey && (document.activeElement === first || outside)) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && (document.activeElement === last || outside)) {
          event.preventDefault()
          first.focus()
        }
        event.stopPropagation()
      }
    }
    const focusin = (event: FocusEvent) => {
      const dialog = dialogRef.current
      if (dialog && isTopModal(dialog) && event.target instanceof Node && !dialog.contains(event.target)) focusInitial()
    }
    document.addEventListener('keydown', keydown, true)
    document.addEventListener('focusin', focusin)
    return () => {
      document.removeEventListener('keydown', keydown, true)
      document.removeEventListener('focusin', focusin)
      restoreModalFocus(previous)
    }
  }, [open])

  if (!open) return null

  return createPortal(
    <div className="profile-modal-backdrop" onMouseDown={event => {
      if (event.target === event.currentTarget && !busyRef.current && dialogRef.current && isTopModal(dialogRef.current)) closeCallback.current()
    }}>
      <div ref={dialogRef} className="profile-modal" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined} aria-busy={busy || undefined} tabIndex={-1}>
        <header className="profile-modal-header">
          {icon && <span className="profile-section-icon" aria-hidden="true">{icon}</span>}
          <div>
            <h2 id={titleId}>{title}</h2>
            {description && <p id={descriptionId}>{description}</p>}
          </div>
          <button ref={closeRef} type="button" className="profile-modal-close" aria-label={t('close')} disabled={busy} onClick={onClose}><X size={18} aria-hidden="true" /></button>
        </header>
        <div className="profile-modal-body">{children}</div>
        <footer className="profile-modal-footer">{footer}</footer>
      </div>
    </div>, document.body)
}
