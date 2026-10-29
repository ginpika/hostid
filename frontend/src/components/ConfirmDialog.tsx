import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { isTopModal, restoreModalFocus } from '../lib/modalStack'
import { useI18n } from '../i18n/I18nContext'

interface ConfirmDialogProps {
  open: boolean
  title: string
  description: string
  confirmLabel: string
  cancelLabel: string
  onConfirm: () => void | boolean | Promise<void | boolean>
  onCancel: () => void
  busy?: boolean
}

/** Destructive actions require an explicit choice; Escape always chooses cancel. */
export default function ConfirmDialog({ open, title, description, confirmLabel, cancelLabel, onConfirm, onCancel, busy = false }: ConfirmDialogProps) {
  const { language } = useI18n()
  const titleId = useId()
  const descriptionId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const busyRef = useRef(false)
  busyRef.current = busy || pending
  const cancelCallback = useRef(onCancel)
  cancelCallback.current = onCancel

  useEffect(() => {
    if (!open) return
    setError('')
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    cancelRef.current?.focus()
    const keydown = (event: KeyboardEvent) => {
      if (!dialogRef.current || !isTopModal(dialogRef.current)) return
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        if (!busyRef.current) cancelCallback.current()
      } else if (event.key === 'Tab') {
        const items = dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]')
        if (!items?.length) { event.preventDefault(); dialogRef.current?.focus(); return }
        const first = items[0]
        const last = items[items.length - 1]
        if (event.shiftKey && (document.activeElement === first || !dialogRef.current?.contains(document.activeElement))) {
          event.preventDefault(); last.focus()
        } else if (!event.shiftKey && (document.activeElement === last || !dialogRef.current?.contains(document.activeElement))) {
          event.preventDefault(); first.focus()
        }
        event.stopPropagation()
      }
    }
    const focusin = (event: FocusEvent) => {
      if (dialogRef.current && isTopModal(dialogRef.current) && event.target instanceof Node && !dialogRef.current.contains(event.target)) {
        if (cancelRef.current?.disabled) dialogRef.current.focus()
        else cancelRef.current?.focus()
      }
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
  const confirm = async () => {
    if (busyRef.current) return
    busyRef.current = true
    setPending(true)
    setError('')
    try {
      const result = await onConfirm()
      if (result === false) setError(language === 'zh-CN' ? '操作未完成，请重试。' : 'The action could not be completed. Please try again.')
      else onCancel()
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : title) }
    finally { setPending(false) }
  }
  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-5 bg-black/35 backdrop-blur-sm" onMouseDown={event => { if (event.target === event.currentTarget && !busyRef.current) onCancel() }}>
      <div ref={dialogRef} role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} tabIndex={-1}
        className="w-full max-w-sm rounded-2xl border p-6 shadow-2xl outline-none" style={{ background: 'var(--color-bg-secondary)', borderColor: 'var(--color-border-primary)' }}>
        <span className="flex items-center justify-center w-11 h-11 rounded-xl bg-red-500/10 text-red-500 mb-4"><AlertTriangle className="w-5 h-5" /></span>
        <h2 id={titleId} className="text-base font-semibold" style={{ color: 'var(--color-text-primary)' }}>{title}</h2>
        <p id={descriptionId} className="text-sm leading-6 mt-2" style={{ color: 'var(--color-text-tertiary)' }}>{description}</p>
        {error && <p role="alert" className="text-sm text-red-500 mt-3">{error}</p>}
        <div className="flex justify-end gap-2 mt-6">
          <button ref={cancelRef} type="button" onClick={onCancel} disabled={busy || pending} className="px-4 py-2.5 text-sm rounded-lg border disabled:opacity-50" style={{ color: 'var(--color-text-secondary)', borderColor: 'var(--color-border-primary)' }}>{cancelLabel}</button>
          <button type="button" onClick={confirm} disabled={busy || pending} className="flex items-center gap-2 px-4 py-2.5 text-sm rounded-lg bg-red-600 hover:bg-red-700 text-white disabled:opacity-50">{(busy || pending) && <Loader2 className="w-4 h-4 animate-spin" />}{confirmLabel}</button>
        </div>
      </div>
    </div>, document.body)
}
