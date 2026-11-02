/** One reading surface for desktop split view and the accessible message dialog. */
import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertCircle, Check, Download, Loader2, Paperclip, RefreshCw, X, ZoomIn, Star, Upload, Trash2, RotateCcw, Reply, ReplyAll, Forward, Archive } from 'lucide-react'
import { useI18n } from '../i18n/I18nContext'
import { useTheme } from '../contexts/ThemeContext'
import { notify, refreshMail } from '../lib/mailEvents'
import { isTopModal, restoreModalFocus } from '../lib/modalStack'
import EmailBody from './EmailBody'
import EmailEnvelope from './EmailEnvelope'
import MailReadingActions from './MailReadingActions'
import ConfirmDialog from './ConfirmDialog'
import type { Email } from './EmailList'
import '../styles/classic-reading.css'

interface EmailDetailProps {
  emailId: string
  embedded?: boolean
  onClose: () => void
  onDelete: () => void
  onRestore: () => void
  onReply?: (email: Email) => void
  onReplyAll?: (email: Email) => void
  onForward?: (email: Email) => void
  onToggleStar?: (emailId: string, isStarred: boolean) => void
  onArchive?: (emailId: string) => void
  onRead?: (emailId: string) => void
  onFeedback?: (message: string, tone: 'success' | 'error') => void
}

const formatFileSize = (bytes: number) => bytes < 1024 ? `${bytes} B`
  : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`
const isImage = (mimeType: string, name: string) => mimeType.startsWith('image/') || /\.(jpe?g|png|gif|webp|bmp|svg)$/i.test(name)
const focusableSelector = 'button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), iframe, [tabindex="0"]'

export default function EmailDetail({ emailId, embedded = false, onClose, onDelete, onRestore,
  onReply, onReplyAll, onForward, onToggleStar, onArchive, onRead, onFeedback }: EmailDetailProps) {
  const { t, language } = useI18n()
  const { layout } = useTheme()
  const classic = layout === 'classic'
  const zh = language === 'zh-CN'
  const headingId = useId()
  const [email, setEmail] = useState<Email | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [revision, setRevision] = useState(0)
  const [busy, setBusy] = useState(false)
  const [confirmClassicDelete, setConfirmClassicDelete] = useState(false)
  const [status, setStatus] = useState<{ message: string; tone: 'success' | 'error' } | null>(null)
  const [previewImage, setPreviewImage] = useState<{ url: string; name: string } | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const previewCloseRef = useRef<HTMLButtonElement>(null)
  const callbackRef = useRef({ onClose, onRead, onFeedback })
  callbackRef.current = { onClose, onRead, onFeedback }
  const busyRef = useRef(false)
  busyRef.current = busy
  const activeRef = useRef(true)
  const currentEmailIdRef = useRef(emailId)
  currentEmailIdRef.current = emailId

  useEffect(() => {
    activeRef.current = true
    return () => { activeRef.current = false }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    busyRef.current = false
    setBusy(false)
    setPreviewImage(null)
    setEmail(null)
    setLoadError('')
    setStatus(null)
    setConfirmClassicDelete(false)
    fetch(`/api/emails/${encodeURIComponent(emailId)}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }, signal: controller.signal
    }).then(async response => {
      if (!response.ok) throw new Error(String(response.status))
      const data: Email = await response.json()
      if (!controller.signal.aborted) {
        setEmail({ ...data, isRead: true })
        callbackRef.current.onRead?.(data.id)
      }
    }).catch(error => {
      if (!controller.signal.aborted) setLoadError(error instanceof Error && error.message === '404' ? 'not-found' : 'failed')
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [emailId, revision])

  useEffect(() => {
    if (embedded) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (dialogRef.current && isTopModal(dialogRef.current)) closeRef.current?.focus()
    const keydown = (event: KeyboardEvent) => {
      // A compose or confirmation dialog may be open above this reading dialog.
      if (!dialogRef.current || !isTopModal(dialogRef.current) || event.defaultPrevented) return
      if (event.key === 'Escape' && !event.defaultPrevented && !busyRef.current) {
        // The envelope owns Escape while its address popover is open.
        if (dialogRef.current.querySelector('.email-envelope__toggle[aria-expanded="true"]')) return
        event.preventDefault()
        callbackRef.current.onClose()
      } else if (event.key === 'Tab') {
        const elements = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(focusableSelector)).filter(element => element.getClientRects().length > 0)
        const first = elements[0]
        const last = elements[elements.length - 1]
        if (event.shiftKey && (document.activeElement === first || !dialogRef.current.contains(document.activeElement))) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && (document.activeElement === last || !dialogRef.current.contains(document.activeElement))) { event.preventDefault(); first?.focus() }
      }
    }
    const focusin = (event: FocusEvent) => {
      if (dialogRef.current && isTopModal(dialogRef.current) && event.target instanceof Node && !dialogRef.current.contains(event.target)) {
        if (closeRef.current?.disabled) dialogRef.current.focus()
        else closeRef.current?.focus()
      }
    }
    document.addEventListener('keydown', keydown)
    document.addEventListener('focusin', focusin)
    return () => {
      document.removeEventListener('keydown', keydown)
      document.removeEventListener('focusin', focusin)
      restoreModalFocus(previous)
    }
  }, [embedded])

  useEffect(() => {
    if (!previewImage) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    previewCloseRef.current?.focus()
    const keydown = (event: KeyboardEvent) => {
      if (!previewRef.current || !isTopModal(previewRef.current)) return
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); setPreviewImage(null) }
      else if (event.key === 'Tab') { event.preventDefault(); previewCloseRef.current?.focus() }
    }
    const focusin = (event: FocusEvent) => {
      if (previewRef.current && isTopModal(previewRef.current) && event.target instanceof Node && !previewRef.current.contains(event.target)) previewCloseRef.current?.focus()
    }
    document.addEventListener('keydown', keydown, true)
    document.addEventListener('focusin', focusin)
    return () => {
      document.removeEventListener('keydown', keydown, true)
      document.removeEventListener('focusin', focusin)
      restoreModalFocus(previous)
    }
  }, [previewImage])

  const feedback = (message: string, tone: 'success' | 'error', current: boolean) => {
    if (current) setStatus({ message, tone })
    if (current && callbackRef.current.onFeedback) callbackRef.current.onFeedback(message, tone)
    else notify(message, tone)
  }
  const request = async (suffix: string, method: string, body?: object) => {
    const response = await fetch(`/api/emails/${encodeURIComponent(emailId)}${suffix}`, {
      method, headers: { Authorization: `Bearer ${localStorage.getItem('token')}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {})
    })
    if (!response.ok) throw new Error('request-failed')
    return response
  }
  const runAction = async (action: () => Promise<void>, success: string, afterSuccess?: () => void) => {
    if (busyRef.current) return false
    const operationEmailId = emailId
    const isCurrent = () => activeRef.current && currentEmailIdRef.current === operationEmailId
    busyRef.current = true
    setBusy(true)
    setStatus(null)
    try {
      await action()
      const current = isCurrent()
      feedback(success, 'success', current)
      if (current) afterSuccess?.()
      else if (afterSuccess) refreshMail()
      return true
    }
    catch {
      feedback(zh ? '操作未完成，请检查连接后重试。' : 'Could not complete the action. Check your connection and try again.', 'error', isCurrent())
      return false
    }
    finally { if (isCurrent()) { busyRef.current = false; setBusy(false) } }
  }
  const toggleStar = () => runAction(async () => {
    if (!email) return
    const next = !email.isStarred
    await request('/star', 'PATCH', { isStarred: next })
  }, email?.isStarred ? (zh ? '已取消星标' : 'Star removed') : (zh ? '已添加星标' : 'Message starred'), () => {
    if (!email) return
    const next = !email.isStarred
    setEmail(current => current?.id === email.id ? { ...current, isStarred: next } : current)
    onToggleStar?.(email.id, next)
  })
  const deleteEmail = () => runAction(async () => { await request(email?.folder === 'TRASH' ? '?permanent=true' : '', 'DELETE') }, email?.folder === 'TRASH' ? (zh ? '邮件已永久删除' : 'Message permanently deleted') : (zh ? '邮件已移到垃圾箱' : 'Message moved to trash'), onDelete)
  const restoreEmail = () => runAction(async () => { await request('/restore', 'POST') }, zh ? '邮件已移回收件箱' : 'Message moved to inbox', onRestore)
  const archiveEmail = () => runAction(async () => { await request('/archive', 'POST') }, zh ? '邮件已归档' : 'Message archived', () => onArchive?.(emailId))
  const saveBlob = (blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = name
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }
  const exportEmail = () => runAction(async () => {
    const response = await request('/export', 'GET')
    const disposition = response.headers.get('Content-Disposition')
    const encoded = disposition?.match(/filename\*?=(?:UTF-8''|")?([^";]+)/)?.[1]
    let name = 'email.eml'
    try { if (encoded) name = decodeURIComponent(encoded) } catch { /* use the safe fallback filename */ }
    saveBlob(await response.blob(), name)
  }, zh ? '邮件已导出' : 'Message exported')
  const downloadAttachment = (id: string, name: string) => runAction(async () => {
    const response = await fetch(`/api/attachments/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } })
    if (!response.ok) throw new Error('download-failed')
    saveBlob(await response.blob(), name)
  }, zh ? '附件已下载' : 'Attachment downloaded')
  const attachmentUrl = (id: string) => `/api/attachments/${encodeURIComponent(id)}?token=${encodeURIComponent(localStorage.getItem('token') || '')}`

  const panel = (
    <div ref={dialogRef} role={embedded ? undefined : 'dialog'} aria-modal={embedded ? undefined : true} aria-labelledby={headingId} aria-busy={loading} tabIndex={embedded ? undefined : -1}
      className={embedded ? 'mail-message-surface flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden' : 'mail-reading-panel classic-reader-dialog w-full max-w-5xl h-[92dvh] sm:h-[86dvh] rounded-2xl border shadow-2xl flex flex-col overflow-hidden'}
      style={{ background: 'var(--color-bg-secondary)', borderColor: 'var(--color-border-primary)' }}>
      {classic ? <header className={`classic-reader-header${!embedded ? ' has-close' : ''}`}>
        <div className="classic-reader-title">
          <button type="button" disabled={!email || busy} onClick={() => void toggleStar()} className="classic-reader-icon classic-reader-star" title={email?.isStarred ? t('unstar') : t('star')} aria-label={email?.isStarred ? t('unstar') : t('star')} aria-pressed={!!email?.isStarred} style={{ color: email?.isStarred ? '#eab308' : 'var(--color-text-quaternary)' }}><Star className={`w-5 h-5 ${email?.isStarred ? 'fill-current' : ''}`} /></button>
          <h2 id={headingId} tabIndex={-1} className="classic-reader-subject" title={email?.subject}>{email?.subject || (loading ? (zh ? '正在打开邮件…' : 'Opening message…') : t('mail'))}</h2>
        </div>
        <div className="classic-reader-header-actions">
          {email?.folder === 'TRASH' && <button type="button" disabled={busy} onClick={() => void restoreEmail()} className="classic-reader-icon" title={t('restore')} aria-label={t('restore')}><RotateCcw className="w-5 h-5" /></button>}
          <button type="button" disabled={!email || busy} onClick={() => void exportEmail()} className="classic-reader-icon" title={t('exportMail')} aria-label={t('exportMail')}><Upload className="w-5 h-5" /></button>
          <button type="button" disabled={!email || busy} onClick={() => email?.folder === 'TRASH' ? setConfirmClassicDelete(true) : void deleteEmail()} className="classic-reader-icon" title={email?.folder === 'TRASH' ? (zh ? '永久删除' : 'Delete permanently') : t('delete')} aria-label={email?.folder === 'TRASH' ? (zh ? '永久删除' : 'Delete permanently') : t('delete')}><Trash2 className="w-5 h-5" /></button>
          {!embedded && <button ref={closeRef} type="button" disabled={busy} onClick={onClose} className="classic-reader-icon classic-reader-close" title={t('close')} aria-label={t('close')}><X className="w-5 h-5" /></button>}
        </div>
      </header> : <>
      <header className="relative px-5 sm:px-7 pt-5 pb-4 shrink-0 border-b" style={{ borderColor: 'var(--color-border-primary)' }}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <span className="block text-[10px] font-semibold tracking-[0.16em] uppercase mb-2" style={{ color: 'var(--color-text-tertiary)' }}>{zh ? '邮件详情' : 'Message'}</span>
            <h2 id={headingId} tabIndex={-1} className="text-xl font-semibold leading-7 break-words" style={{ color: 'var(--color-text-primary)', letterSpacing: '-0.025em' }}>{email?.subject || (loading ? (zh ? '正在打开邮件…' : 'Opening message…') : t('mail'))}</h2>
          </div>
          {!embedded && <button ref={closeRef} type="button" disabled={busy} onClick={onClose} aria-label={t('close')} title={t('close')} className="absolute right-3 top-2.5 w-7 h-7 flex items-center justify-center rounded-lg hover:bg-[var(--color-bg-tertiary)] disabled:opacity-50" style={{ color: 'var(--color-text-tertiary)' }}><X className="w-5 h-5" /></button>}
        </div>
        {email && <div className="mt-4 flex items-center justify-between gap-2">
          <span className="text-[11px] hidden sm:block" style={{ color: 'var(--color-text-tertiary)' }}>{email.folder === 'TRASH' ? (zh ? '垃圾箱中的邮件' : 'Message in trash') : email.folder === 'ARCHIVED' ? (zh ? '已归档邮件' : 'Archived message') : (zh ? '阅读与回复' : 'Read & reply')}</span>
          <MailReadingActions isStarred={!!email.isStarred} isTrash={email.folder === 'TRASH'} isArchived={email.folder === 'ARCHIVED'} busy={busy} onStar={toggleStar}
            onReply={onReply ? () => onReply(email) : undefined} onReplyAll={onReplyAll ? () => onReplyAll(email) : undefined} onForward={onForward ? () => onForward(email) : undefined}
            onArchive={archiveEmail} onUnarchive={restoreEmail} onDelete={deleteEmail} onRestore={restoreEmail} onExport={exportEmail} />
        </div>}
      </header>
      </>}
      {status && <div role={status.tone === 'error' ? 'alert' : 'status'} className={`flex items-center gap-2 px-6 py-3 text-xs shrink-0 ${status.tone === 'error' ? 'bg-red-500/10 text-red-600' : ''}`} style={status.tone === 'success' ? { background: 'var(--color-accent-muted)', color: 'var(--color-accent-primary)' } : undefined}>
        {status.tone === 'error' ? <AlertCircle className="w-4 h-4 shrink-0" /> : <Check className="w-4 h-4 shrink-0" />}<span className="flex-1">{status.message}</span><button type="button" onClick={() => setStatus(null)} aria-label={t('close')} className="p-1"><X className="w-3.5 h-3.5" /></button>
      </div>}
      <div className="flex-1 min-h-0 overflow-auto">
        {loading ? <div role="status" className="flex h-full min-h-52 items-center justify-center gap-2 text-sm" style={{ color: 'var(--color-text-tertiary)' }}><Loader2 className="w-5 h-5 animate-spin" /><span>{zh ? '正在加载邮件…' : 'Loading message…'}</span></div>
          : loadError || !email ? <div className="flex flex-col h-full min-h-64 items-center justify-center gap-3 px-6 text-center" style={{ color: 'var(--color-text-tertiary)' }}><AlertCircle className="w-7 h-7" /><p role="alert" className="text-sm">{loadError === 'not-found' ? t('emailNotFound') : zh ? '暂时无法加载这封邮件' : 'Unable to load this message'}</p><button type="button" onClick={() => setRevision(value => value + 1)} className="flex items-center gap-2 text-xs font-medium px-4 py-2 rounded-lg" style={{ background: 'var(--color-accent-muted)', color: 'var(--color-accent-primary)' }}><RefreshCw className="w-3.5 h-3.5" />{zh ? '重新加载' : 'Try again'}</button></div>
            : <>
              <EmailEnvelope key={email.id} email={{ ...email, toList: email.toList || '[]', ccList: email.ccList || null, bccList: email.bccList || null }} />
              {!!email.attachments?.length && <section className="mail-attachment-section px-5 sm:px-7 pt-5" aria-label={t('attachments')}>
                <div className="mail-attachment-heading flex items-center gap-2 mb-3 text-xs" style={{ color: 'var(--color-text-tertiary)' }}><Paperclip className="w-3.5 h-3.5" />{t('attachments')}<span className="px-1.5 py-0.5 rounded text-[10px]" style={{ background: 'var(--color-bg-tertiary)' }}>{email.attachments.length}</span></div>
                <div className="mail-attachment-list grid gap-2 sm:grid-cols-2">
                  {email.attachments.map(attachment => <div key={attachment.id} className="mail-attachment-item flex min-w-0 items-center gap-3 p-3 rounded-xl border" style={{ borderColor: 'var(--color-border-primary)', background: 'color-mix(in srgb, var(--color-bg-tertiary) 45%, transparent)' }}>
                    <span className="flex items-center justify-center w-9 h-10 rounded-lg shrink-0" style={{ background: 'var(--color-bg-secondary)', color: 'var(--color-accent-primary)' }}><Paperclip className="w-4 h-4" /></span>
                    <div className="flex-1 min-w-0"><p className="text-xs font-medium truncate" title={attachment.originalName} style={{ color: 'var(--color-text-secondary)' }}>{attachment.originalName}</p><p className="text-[11px] mt-1" style={{ color: 'var(--color-text-tertiary)' }}>{formatFileSize(attachment.size)}</p></div>
                    <div className="flex items-center shrink-0 gap-1">
                      {isImage(attachment.mimeType, attachment.originalName) && <button type="button" onClick={() => setPreviewImage({ url: attachmentUrl(attachment.id), name: attachment.originalName })} className="w-8 h-9 flex items-center justify-center rounded-lg hover:bg-[var(--color-bg-tertiary)]" aria-label={`${t('preview')} ${attachment.originalName}`} title={t('preview')} style={{ color: 'var(--color-text-tertiary)' }}><ZoomIn className="w-4 h-4" /></button>}
                      <button type="button" disabled={busy} onClick={() => void downloadAttachment(attachment.id, attachment.originalName)} className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-[var(--color-bg-tertiary)] disabled:opacity-40" aria-label={`${t('download')} ${attachment.originalName}`} title={t('download')} style={{ color: 'var(--color-accent-primary)' }}><Download className="w-4 h-4" /></button>
                    </div>
                  </div>)}
                </div>
              </section>}
              <div className="mail-message-body px-5 sm:px-7 py-6"><div className="mail-message-content mx-auto max-w-[920px]"><EmailBody content={email.body} className="leading-relaxed text-[15px]" style={{ color: 'var(--color-text-secondary)' }} /></div></div>
            </>}
      </div>
      {classic && email && <footer className="classic-reader-footer">
        <div className="classic-reader-footer-group">
          {onReply && <button type="button" disabled={busy} onClick={() => onReply(email)} title={t('reply')} aria-label={t('reply')}><Reply className="w-4 h-4" /><span>{t('reply')}</span></button>}
          {onReplyAll && <button type="button" disabled={busy} onClick={() => onReplyAll(email)} title={t('replyAll')} aria-label={t('replyAll')}><ReplyAll className="w-4 h-4" /><span>{t('replyAll')}</span></button>}
          {onForward && <button type="button" disabled={busy} onClick={() => onForward(email)} title={t('forward')} aria-label={t('forward')}><Forward className="w-4 h-4" /><span>{t('forward')}</span></button>}
        </div>
        {email.folder === 'ARCHIVED' ? <button type="button" disabled={busy} onClick={() => void restoreEmail()} title={t('unarchive')} aria-label={t('unarchive')}><RotateCcw className="w-4 h-4" /><span>{t('unarchive')}</span></button> : email.folder !== 'TRASH' && <button type="button" disabled={busy} onClick={() => void archiveEmail()} title={t('archive')} aria-label={t('archive')}><Archive className="w-4 h-4" /><span>{t('archive')}</span></button>}
      </footer>}
      <ConfirmDialog open={confirmClassicDelete} title={zh ? '永久删除这封邮件？' : 'Permanently delete this message?'} description={zh ? '邮件及不再使用的附件将被永久移除，此操作无法撤销。' : 'The message and unused attachments will be permanently removed. This cannot be undone.'} confirmLabel={zh ? '永久删除' : 'Delete permanently'} cancelLabel={t('cancel')} busy={busy} onCancel={() => setConfirmClassicDelete(false)} onConfirm={deleteEmail} />

    </div>
  )
  const preview = previewImage && createPortal(
    <div ref={previewRef} role="dialog" aria-modal="true" aria-label={previewImage.name} className="fixed inset-0 z-[80] flex items-center justify-center p-6 bg-black/90" onClick={event => { if (event.target === event.currentTarget) setPreviewImage(null) }}>
      <button ref={previewCloseRef} type="button" onClick={() => setPreviewImage(null)} aria-label={t('close')} className="absolute top-4 right-4 w-11 h-11 flex items-center justify-center text-white rounded-xl hover:bg-white/10"><X className="w-6 h-6" /></button>
      <img src={previewImage.url} alt={previewImage.name} className="max-w-full max-h-full object-contain rounded-lg" />
    </div>, document.body)
  return <>{embedded ? panel : createPortal(<div className="mail-reader-overlay fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-6 bg-black/35 backdrop-blur-sm" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose() }}>{panel}</div>, document.body)}{preview}</>
}
