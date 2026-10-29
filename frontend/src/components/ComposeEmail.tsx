/**
 * 撰写邮件组件
 * 邮件撰写表单，支持收件人、主题、正文和附件
 * 提供回复/转发功能，自动填充引用内容
 */
import { useState, useEffect, useRef, useId } from 'react'
import { createPortal } from 'react-dom'
import { X, Send, Loader2, Trash2, Paperclip, Reply, ReplyAll, Forward, PenLine, Check, AlertCircle, Save } from 'lucide-react'
import { useI18n } from '../i18n/I18nContext'
import { useTheme } from '../contexts/ThemeContext'
import '../styles/classic-reading.css'
import { useDomain } from '../contexts/DomainContext'
import { useAuth } from '../contexts/AuthContext'
import { composeDraftKey, readComposeDraft, saveComposeDraft, readComposeFiles, saveComposeFiles, discardComposeDraft, type ComposeDraft } from '../lib/composeDrafts'
import { isTopModal, restoreModalFocus } from '../lib/modalStack'
import RecipientInput, { Recipient, RecipientType, type RecipientInputHandle } from './RecipientInput'
import AttachmentUpload, { AttachmentFile } from './AttachmentUpload'
import RichTextEditor from './RichTextEditor'

interface ReferencedAttachment {
  id: string
  originalName: string
  mimeType: string
  size: number
}

interface ReplyData {
  id?: string
  mode: 'reply' | 'replyAll' | 'forward'
  from: string
  toList: string[]
  ccList: string[]
  subject: string
  body: string
  date: string
  attachments?: ReferencedAttachment[]
}

interface ComposeEmailProps {
  onClose: () => void
  onSent: () => void
  replyData?: ReplyData | null
}

type Translate = ReturnType<typeof useI18n>['t']
type Language = ReturnType<typeof useI18n>['language']

interface ComposeInitialState {
  recipients: Recipient[]
  subject: string
  body: string
  referencedAttachments: ReferencedAttachment[]
}

const createRecipient = (email: string, type: RecipientType): Recipient => ({
  id: `reply-${email}-${Date.now()}`,
  username: email.split('@')[0],
  email,
  type
})

// 根据回复/转发数据构建初始表单内容
const buildReplyState = (replyData: ReplyData, t: Translate, language: Language): ComposeInitialState => {
  const recipients: Recipient[] = []

  if (replyData.mode === 'reply') {
    recipients.push(createRecipient(replyData.from, 'to'))
  } else if (replyData.mode === 'replyAll') {
    recipients.push(createRecipient(replyData.from, 'to'))
    replyData.toList.forEach(email => {
      if (email !== replyData.from) {
        recipients.push(createRecipient(email, 'to'))
      }
    })
    replyData.ccList.forEach(email => {
      recipients.push(createRecipient(email, 'cc'))
    })
  }

  const prefix = replyData.mode === 'forward' ? 'Fwd: ' : 'Re: '
  let subject = replyData.subject
  if (!subject.toLowerCase().startsWith('re:') && !subject.toLowerCase().startsWith('fwd:')) {
    subject = prefix + subject
  }

  const quoteTitle = replyData.mode === 'forward' ? t('forwardMessage') : language === 'zh-CN' ? '原邮件' : 'Original message'
  const quotedBody = `<br><br><div style="border-left: 2px solid #ccc; padding-left: 10px; color: #666;">---------- ${quoteTitle} ----------<br>${t('from')}: ${replyData.from}<br>${t('date')}: ${new Date(replyData.date).toLocaleString()}<br>${t('subject')}: ${replyData.subject}<br><br>${replyData.body}</div>`

  return {
    recipients,
    subject,
    body: quotedBody,
    referencedAttachments: replyData.attachments && replyData.attachments.length > 0 ? replyData.attachments : []
  }
}

const buildInitialState = (key: string, replyData: ReplyData | null | undefined, t: Translate, language: Language): ComposeInitialState => {
  const draft = readComposeDraft(key, !replyData)
  if (draft) return draft
  return replyData ? buildReplyState(replyData, t, language) : { recipients: [], subject: '', body: '', referencedAttachments: [] }
}

// A separate keyed editor prevents switching to another message from overwriting
// the previous draft, while language changes leave the active editor intact.
export default function ComposeEmail(props: ComposeEmailProps) {
  const { user } = useAuth()
  const initialAccount = useRef(user?.id)
  const accountChanged = initialAccount.current !== user?.id
  useEffect(() => {
    if (accountChanged) props.onClose()
  }, [accountChanged, props.onClose])
  // The global compose context can outlive a session; never re-use its quoted
  // message when another account signs in.
  if (!user || accountChanged) return null
  const draftKey = composeDraftKey(user?.id || 'local', props.replyData)
  return <ComposeEditor key={draftKey} {...props} draftKey={draftKey} />
}

function ComposeEditor({ onClose, onSent, replyData, draftKey }: ComposeEmailProps & { draftKey: string }) {
  const { t, language } = useI18n()
  const { layout } = useTheme()
  const classic = layout === 'classic'
  const { domain } = useDomain()
  const [initialState] = useState(() => buildInitialState(draftKey, replyData, t, language))
  const [recipients, setRecipients] = useState<Recipient[]>(initialState.recipients)
  const [subject, setSubject] = useState(initialState.subject)
  const [body, setBody] = useState(initialState.body)
  const [attachments, setAttachments] = useState<AttachmentFile[]>([])
  const [referencedAttachments, setReferencedAttachments] = useState<ReferencedAttachment[]>(initialState.referencedAttachments)
  const [attachmentsReady, setAttachmentsReady] = useState(false)
  const [filesSaved, setFilesSaved] = useState<boolean | null>(null)
  const [textSaved, setTextSaved] = useState(true)
  const [missingFiles, setMissingFiles] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [closing, setClosing] = useState(false)
  const [error, setError] = useState('')
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const discardRef = useRef(false)
  const closeRef = useRef(() => {})
  const mountedRef = useRef(true)
  const closingRef = useRef(false)
  const titleId = useId()
  const subjectId = useId()
  const recipientId = useId()
  const recipientInputRef = useRef<RecipientInputHandle>(null)
  const copy = language === 'zh-CN' ? {
    subtitle: '把想说的话，好好写下来。',
    saved: '草稿已保存在此设备', saving: '正在保存草稿…',
    sessionFiles: '正文已保存；附件仅在本次会话保留',
    sessionDraft: '草稿仅在本次会话保留，请勿刷新页面',
    saveClose: '保存并关闭',
    discardQuestion: '丢弃这封草稿？', discardHint: '正文和附件将一并移除。',
    keepEditing: '继续编辑', discardConfirm: '丢弃草稿',
    missingFiles: '部分附件无法恢复，请重新添加：',
    invalidFiles: '请先移除或重新添加有错误的附件。',
    sendFailed: '发送失败，请重试。', sent: '邮件已发送',
    loadingDraft: '正在恢复草稿…', removeAttachment: '移除附件',
    recipients: '收件人', body: '正文'
  } : {
    subtitle: 'A little space for what you want to say.',
    saved: 'Draft saved on this device', saving: 'Saving draft…',
    sessionFiles: 'Text saved; attachments kept for this session only',
    sessionDraft: 'Draft kept for this session only. Please do not refresh.',
    saveClose: 'Save & close',
    discardQuestion: 'Discard this draft?', discardHint: 'The message and attachments will be removed.',
    keepEditing: 'Keep writing', discardConfirm: 'Discard draft',
    missingFiles: 'Some attachments could not be restored. Please add them again: ',
    invalidFiles: 'Remove or re-add attachments with errors before sending.',
    sendFailed: 'Could not send your email. Please try again.', sent: 'Email sent',
    loadingDraft: 'Restoring your draft…', removeAttachment: 'Remove attachment',
    recipients: 'Recipients', body: 'Message'
  }

  const draft: ComposeDraft = { recipients, subject, body, referencedAttachments, attachmentNames: attachments.map(item => item.file.name) }
  const currentDraftRef = useRef({ draft, attachments, attachmentsReady, textSaved, filesSaved })
  currentDraftRef.current = { draft, attachments, attachmentsReady, textSaved, filesSaved }

  useEffect(() => {
    let active = true
    const expectedFiles = readComposeDraft(draftKey)?.attachmentNames || []
    void readComposeFiles(draftKey).then(files => {
      if (!active) return
      setAttachments(files)
      setMissingFiles(expectedFiles.filter(name => !files.some(item => item.file.name === name)))
      setAttachmentsReady(true)
    })
    return () => { active = false }
  }, [draftKey])

  useEffect(() => {
    if (!attachmentsReady || discardRef.current) return
    setTextSaved(saveComposeDraft(draftKey, { recipients, subject, body, referencedAttachments, attachmentNames: attachments.map(item => item.file.name) }))
  }, [draftKey, recipients, subject, body, referencedAttachments, attachments, attachmentsReady])

  useEffect(() => {
    if (!attachmentsReady || discardRef.current) return
    let active = true
    setFilesSaved(null)
    void saveComposeFiles(draftKey, attachments).then(saved => {
      if (active) setFilesSaved(saved)
    })
    return () => { active = false }
  }, [draftKey, attachments, attachmentsReady])

  useEffect(() => {
    const previousFocus = document.activeElement
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      const current = currentDraftRef.current
      if (current.attachmentsReady && !discardRef.current) {
        saveComposeDraft(draftKey, current.draft)
        void saveComposeFiles(draftKey, current.attachments)
      }
      restoreModalFocus(previousFocus instanceof HTMLElement ? previousFocus : null)
    }
  }, [draftKey])

  useEffect(() => {
    const preventUnsavedExit = (event: BeforeUnloadEvent) => {
      const current = currentDraftRef.current
      if (discardRef.current || !current.attachmentsReady) return
      saveComposeDraft(draftKey, current.draft)
      if (!current.textSaved || (current.attachments.length > 0 && current.filesSaved !== true)) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', preventUnsavedExit)
    return () => window.removeEventListener('beforeunload', preventUnsavedExit)
  }, [draftKey])

  useEffect(() => {
    if (!attachmentsReady) return
    if (dialogRef.current && isTopModal(dialogRef.current)) dialogRef.current.querySelector<HTMLInputElement>('input:not([type="file"])')?.focus()
  }, [attachmentsReady])

  closeRef.current = async () => {
    if (loading || closingRef.current || !attachmentsReady) return
    closingRef.current = true
    setClosing(true)
    saveComposeDraft(draftKey, draft)
    await saveComposeFiles(draftKey, attachments)
    if (mountedRef.current) onClose()
  }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const dialog = dialogRef.current
      // The editor's fullscreen mode uses its own portal and Escape handler.
      if (event.defaultPrevented || !dialog || !isTopModal(dialog) || !(event.target instanceof Node) || !dialog.contains(event.target)) return
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        closeRef.current()
      }
      if (event.key !== 'Tab') return
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [contenteditable="true"], [tabindex="0"], a[href]')).filter(element => element.getClientRects().length > 0)
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (!first) { event.preventDefault(); dialog.focus(); return }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (loading || closing || !attachmentsReady) return
    setError('')

    // Submission can happen without blur, so validate and commit the final entry here.
    const sendRecipients = recipientInputRef.current ? recipientInputRef.current.commit() : recipients
    if (!sendRecipients) return
    if (sendRecipients.length === 0) {
      setError(t('noRecipients'))
      return
    }
    
    if (attachments.some(attachment => attachment.error || attachment.uploading)) {
      setError(copy.invalidFiles)
      return
    }

    setLoading(true)
    const sendingDraft = { ...draft, recipients: sendRecipients }
    saveComposeDraft(draftKey, sendingDraft)

    try {
      const token = localStorage.getItem('token')
      
      const to = sendRecipients.filter(r => r.type === 'to').map(r => r.email)
      const cc = sendRecipients.filter(r => r.type === 'cc').map(r => r.email)
      const bcc = sendRecipients.filter(r => r.type === 'bcc').map(r => r.email)
      
      const formData = new FormData()
      
      if (to.length > 0) {
        to.forEach(email => formData.append('to', email))
      }
      if (cc.length > 0) {
        cc.forEach(email => formData.append('cc', email))
      }
      if (bcc.length > 0) {
        bcc.forEach(email => formData.append('bcc', email))
      }
      
      formData.append('subject', subject)
      formData.append('body', body)
      
      attachments.forEach(att => {
        formData.append('files', att.file)
      })
      
      if (referencedAttachments.length > 0) {
        formData.append('referencedAttachments', JSON.stringify(referencedAttachments.map(a => a.id)))
      }
      
      const res = await fetch('/api/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`
        },
        body: formData
      })

      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || copy.sendFailed)
      }

      discardRef.current = true
      discardComposeDraft(draftKey, sendingDraft, attachments)
      if (!mountedRef.current) return
      window.dispatchEvent(new CustomEvent('hostid:mail-updated'))
      window.dispatchEvent(new CustomEvent('hostid:notice', { detail: { message: copy.sent, type: 'success' } }))
      onSent()
    } catch (err) {
      if (mountedRef.current) setError(err instanceof Error ? err.message : copy.sendFailed)
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }

  const handleDiscard = () => {
    if (loading || closing || !attachmentsReady) return
    discardRef.current = true
    discardComposeDraft(draftKey)
    onClose()
  }

  const handleClose = () => closeRef.current()

  const handleRemoveReferencedAttachment = (id: string) => {
    setReferencedAttachments(prev => prev.filter(a => a.id !== id))
  }

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const getModeTitle = () => {
    if (!replyData) return t('compose')
    switch (replyData.mode) {
      case 'reply': return t('reply')
      case 'replyAll': return t('replyAll')
      case 'forward': return t('forward')
      default: return t('compose')
    }
  }

  const getModeIcon = () => {
    if (!replyData) return <PenLine className="w-5 h-5" />
    switch (replyData.mode) {
      case 'reply': return <Reply className="w-5 h-5" />
      case 'replyAll': return <ReplyAll className="w-5 h-5" />
      case 'forward': return <Forward className="w-5 h-5" />
      default: return null
    }
  }

  const savedLabel = !textSaved ? copy.sessionDraft : filesSaved === null ? copy.saving : !filesSaved ? copy.sessionFiles : copy.saved
  const storageWarning = !textSaved || filesSaved === false

  return createPortal(
    <div className="mail-compose-overlay fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 backdrop-blur-sm p-2 sm:p-6">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="mail-compose-dialog w-full max-w-4xl max-h-[94dvh] rounded-2xl sm:rounded-3xl overflow-hidden flex flex-col outline-none border shadow-[0_32px_100px_-24px_rgba(15,23,42,0.35)]"
        style={{ backgroundColor: 'var(--color-bg-secondary)', borderColor: 'var(--color-border-primary)' }}
      >
        <header className="mail-compose-header flex items-center justify-between gap-3 px-5 sm:px-7 py-5 border-b flex-shrink-0" style={{ borderColor: 'var(--color-border-primary)' }}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="mail-compose-mode-icon flex items-center justify-center w-11 h-11 rounded-2xl shrink-0" style={{ color: 'var(--color-accent-primary)', backgroundColor: 'var(--color-accent-muted)' }}>{classic && !replyData ? null : getModeIcon()}</div>
            <div className="min-w-0">
              <h2 id={titleId} className="text-lg font-semibold tracking-tight" style={{ color: 'var(--color-text-primary)' }}>{getModeTitle()}</h2>
              <p className="mail-compose-subtitle text-xs mt-1 truncate" style={{ color: 'var(--color-text-tertiary)' }}>{copy.subtitle}</p>
            </div>
          </div>
          <button type="button" onClick={handleClose} disabled={loading || closing || !attachmentsReady} aria-label={copy.saveClose} title={copy.saveClose} className="p-2.5 rounded-xl transition-colors hover:bg-[var(--color-bg-tertiary)] disabled:opacity-40" style={{ color: 'var(--color-text-tertiary)' }}><X className="w-5 h-5" /></button>
        </header>

        <form onSubmit={handleSubmit} aria-busy={loading || closing} className="flex-1 min-h-0 flex flex-col">
          <div className="flex-1 min-h-0 overflow-auto">
            {!attachmentsReady ? (
              <div className="flex items-center justify-center gap-3 h-48 text-sm" role="status" style={{ color: 'var(--color-text-tertiary)' }}><Loader2 className="w-5 h-5 animate-spin" />{copy.loadingDraft}</div>
            ) : (
              <fieldset disabled={loading || closing} className={`mail-compose-fields px-5 sm:px-7 py-5 space-y-5 min-w-0 ${(loading || closing) ? 'pointer-events-none opacity-70' : ''}`} onKeyDownCapture={(loading || closing) ? event => event.preventDefault() : undefined}>
                {error && <div role="alert" className="flex items-start gap-2 p-3 rounded-xl text-sm border border-red-500/20 bg-red-500/10 text-red-600"><AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />{error}</div>}
                {missingFiles.length > 0 && <div role="alert" className="p-3 rounded-xl text-xs border border-amber-500/20 bg-amber-500/10 text-amber-700">{copy.missingFiles}{missingFiles.join('、')}</div>}

                <section role="group" aria-labelledby={recipientId}>
                  <div id={recipientId} className="text-xs font-semibold mb-2" style={{ color: 'var(--color-text-tertiary)' }}>{copy.recipients}</div>
                  <RecipientInput ref={recipientInputRef} recipients={recipients} onChange={setRecipients} domain={domain} maxRecipients={50} />
                </section>

                <div>
                  <label htmlFor={subjectId} className="block text-xs font-semibold mb-2" style={{ color: 'var(--color-text-tertiary)' }}>{t('subject')}</label>
                  <input id={subjectId} type="text" value={subject} onChange={event => setSubject(event.target.value)} className="mail-compose-subject w-full px-4 py-3 rounded-xl border text-[15px] font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-primary)]" style={{ backgroundColor: 'var(--color-bg-primary)', borderColor: 'var(--color-border-primary)', color: 'var(--color-text-primary)' }} placeholder={t('subjectPlaceholder')} required />
                </div>

                <section aria-label={copy.body}>
                  {classic && <div className="mail-compose-body-label">{t('body')}</div>}
                  <RichTextEditor content={body} onChange={setBody} />
                </section>

                <section aria-label={t('attachments')}>
                  <div className="flex items-center gap-2 mb-3 text-xs font-semibold" style={{ color: 'var(--color-text-tertiary)' }}><Paperclip className="w-3.5 h-3.5" />{t('attachments')}</div>
                  {referencedAttachments.length > 0 && <div className="mb-3 flex flex-wrap gap-2">{referencedAttachments.map(attachment => (
                    <div key={attachment.id} className="flex items-center gap-2 px-3 py-2 rounded-xl border max-w-full" style={{ backgroundColor: 'var(--color-accent-muted)', borderColor: 'var(--color-border-primary)' }}>
                      <Paperclip className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--color-accent-primary)' }} />
                      <span className="text-xs truncate" style={{ color: 'var(--color-text-secondary)' }}>{attachment.originalName}</span>
                      <span className="text-[11px] shrink-0" style={{ color: 'var(--color-text-tertiary)' }}>{formatFileSize(attachment.size)}</span>
                      <button type="button" onClick={() => handleRemoveReferencedAttachment(attachment.id)} aria-label={`${copy.removeAttachment}: ${attachment.originalName}`} className="p-1 rounded-md hover:bg-red-500/10 hover:text-red-500"><X className="w-3.5 h-3.5" /></button>
                    </div>
                  ))}</div>}
                  <AttachmentUpload attachments={attachments} onChange={files => { setAttachments(files); setMissingFiles([]) }} maxFiles={10} maxSize={10} />
                </section>
              </fieldset>
            )}
          </div>

          <footer className="mail-compose-footer px-5 sm:px-7 py-4 border-t flex-shrink-0" style={{ borderColor: 'var(--color-border-primary)', backgroundColor: 'var(--color-bg-primary)' }}>
            {confirmDiscard ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div><p className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>{copy.discardQuestion}</p><p className="text-xs mt-1" style={{ color: 'var(--color-text-tertiary)' }}>{copy.discardHint}</p></div>
                <div className="flex items-center gap-2"><button type="button" onClick={() => setConfirmDiscard(false)} className="px-3 py-2 text-sm rounded-xl hover:bg-[var(--color-bg-tertiary)]">{copy.keepEditing}</button><button type="button" onClick={handleDiscard} disabled={loading || closing} className="px-3 py-2 text-sm rounded-xl bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">{copy.discardConfirm}</button></div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-[11px] min-w-0" role="status" style={{ color: storageWarning ? '#b45309' : 'var(--color-text-tertiary)' }}>
                  {storageWarning ? <AlertCircle className="w-3.5 h-3.5 shrink-0" /> : filesSaved === null ? <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" /> : <Check className="w-3.5 h-3.5 shrink-0" />}<span>{savedLabel}</span>
                </div>
                <div className="flex items-center gap-2 ml-auto">
                  <button type="button" onClick={() => setConfirmDiscard(true)} disabled={loading || closing || !attachmentsReady} aria-label={copy.discardConfirm} title={copy.discardConfirm} className="mail-compose-discard p-2.5 rounded-xl transition-colors hover:bg-red-500/10 hover:text-red-600 disabled:opacity-40" style={{ color: 'var(--color-text-tertiary)' }}><Trash2 className="w-4 h-4" />{classic && <span>{t('discard')}</span>}</button>
                  <button type="button" onClick={handleClose} disabled={loading || closing || !attachmentsReady} className="mail-compose-save-close flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium border transition-colors hover:bg-[var(--color-bg-tertiary)] disabled:opacity-40" style={{ color: 'var(--color-text-secondary)', borderColor: 'var(--color-border-primary)', backgroundColor: 'var(--color-bg-secondary)' }}>{closing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}<span className="hidden sm:inline">{copy.saveClose}</span><span className="sm:hidden">{t('close')}</span></button>
                  <button type="submit" disabled={loading || closing || !attachmentsReady} className="mail-compose-send flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-colors disabled:opacity-40 hover:brightness-95" style={{ backgroundColor: 'var(--color-accent-primary)', color: 'var(--color-accent-text)', boxShadow: '0 3px 10px -4px var(--color-accent-primary)' }}>{loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}{loading ? t('sending') : t('send')}</button>
                </div>
              </div>
            )}
          </footer>
        </form>
      </div>
    </div>,
    document.body
  )
}
