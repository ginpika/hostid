import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Send, Loader2, Trash2, Paperclip, Reply, ReplyAll, Forward } from 'lucide-react'
import { useI18n } from '../i18n/I18nContext'
import { useDomain } from '../contexts/DomainContext'
import RecipientInput, { Recipient, RecipientType } from './RecipientInput'
import AttachmentUpload, { AttachmentFile } from './AttachmentUpload'
import RichTextEditor from './RichTextEditor'

interface ReferencedAttachment {
  id: string
  originalName: string
  mimeType: string
  size: number
}

interface ReplyData {
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

const STORAGE_KEY = 'compose_email_draft'

export default function ComposeEmail({ onClose, onSent, replyData }: ComposeEmailProps) {
  const { t } = useI18n()
  const { domain } = useDomain()
  const [recipients, setRecipients] = useState<Recipient[]>([])
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [attachments, setAttachments] = useState<AttachmentFile[]>([])
  const [referencedAttachments, setReferencedAttachments] = useState<ReferencedAttachment[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (replyData) {
      const newRecipients: Recipient[] = []
      
      const createRecipient = (email: string, type: RecipientType): Recipient => ({
        id: `reply-${email}-${Date.now()}`,
        username: email.split('@')[0],
        email,
        type
      })
      
      if (replyData.mode === 'reply') {
        newRecipients.push(createRecipient(replyData.from, 'to'))
      } else if (replyData.mode === 'replyAll') {
        newRecipients.push(createRecipient(replyData.from, 'to'))
        replyData.toList.forEach(email => {
          if (email !== replyData.from) {
            newRecipients.push(createRecipient(email, 'to'))
          }
        })
        replyData.ccList.forEach(email => {
          newRecipients.push(createRecipient(email, 'cc'))
        })
      }
      
      setRecipients(newRecipients)
      
      const prefix = replyData.mode === 'forward' ? 'Fwd: ' : 'Re: '
      let newSubject = replyData.subject
      if (!newSubject.toLowerCase().startsWith('re:') && !newSubject.toLowerCase().startsWith('fwd:')) {
        newSubject = prefix + newSubject
      }
      setSubject(newSubject)
      
      const quotedBody = `<br><br><div style="border-left: 2px solid #ccc; padding-left: 10px; color: #666;">---------- ${t('forwardMessage')} ----------<br>${t('from')}: ${replyData.from}<br>${t('date')}: ${new Date(replyData.date).toLocaleString()}<br>${t('subject')}: ${replyData.subject}<br><br>${replyData.body}</div>`
      setBody(quotedBody)
      
      setAttachments([])
      if (replyData.attachments && replyData.attachments.length > 0) {
        setReferencedAttachments(replyData.attachments)
      } else {
        setReferencedAttachments([])
      }
      
      localStorage.removeItem(STORAGE_KEY)
    } else {
      setAttachments([])
      setReferencedAttachments([])
      const savedDraft = localStorage.getItem(STORAGE_KEY)
      if (savedDraft) {
        try {
          const draft = JSON.parse(savedDraft)
          setRecipients(draft.recipients || [])
          setSubject(draft.subject || '')
          setBody(draft.body || '')
        } catch (e) {
          console.error('Failed to load draft:', e)
        }
      }
    }
  }, [replyData, t])

  useEffect(() => {
    if (!replyData) {
      const draft = { recipients, subject, body }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(draft))
    }
  }, [recipients, subject, body, replyData])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    
    if (recipients.length === 0) {
      setError(t('noRecipients'))
      return
    }
    
    setLoading(true)

    try {
      const token = localStorage.getItem('token')
      
      const to = recipients.filter(r => r.type === 'to').map(r => r.email)
      const cc = recipients.filter(r => r.type === 'cc').map(r => r.email)
      const bcc = recipients.filter(r => r.type === 'bcc').map(r => r.email)
      
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
        const data = await res.json()
        throw new Error(data.error || 'Failed to send email')
      }

      localStorage.removeItem(STORAGE_KEY)
      onSent()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send email')
    } finally {
      setLoading(false)
    }
  }

  const handleClear = () => {
    setRecipients([])
    setSubject('')
    setBody('')
    setAttachments([])
    setReferencedAttachments([])
    setError('')
    localStorage.removeItem(STORAGE_KEY)
  }

  const handleClose = () => {
    onClose()
  }

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
    if (!replyData) return null
    switch (replyData.mode) {
      case 'reply': return <Reply className="w-5 h-5" />
      case 'replyAll': return <ReplyAll className="w-5 h-5" />
      case 'forward': return <Forward className="w-5 h-5" />
      default: return null
    }
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50"
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className="rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden max-h-[90vh] flex flex-col"
          style={{ backgroundColor: 'var(--color-bg-secondary)' }}
        >
          <div 
            className="flex items-center justify-between p-4 border-b"
            style={{ borderColor: 'var(--color-border-primary)' }}
          >
            <div className="flex items-center gap-2" style={{ color: 'var(--color-text-primary)' }}>
              {getModeIcon()}
              <h2 className="text-lg font-semibold">{getModeTitle()}</h2>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleClear}
                className="p-2 rounded-lg transition-colors"
                style={{ color: 'var(--color-text-quaternary)' }}
                title={t('clear')}
              >
                <Trash2 className="w-5 h-5 hover:text-red-500" />
              </button>
              <button
                onClick={handleClose}
                className="p-2 rounded-lg transition-colors hover:bg-[var(--color-bg-tertiary)]"
                style={{ color: 'var(--color-text-quaternary)' }}
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="flex-1 overflow-auto">
            <div className="p-4 space-y-4">
              {error && (
                <div 
                  className="p-3 rounded-lg text-sm"
                  style={{ 
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    border: '1px solid rgba(239, 68, 68, 0.3)',
                    color: '#ef4444'
                  }}
                >
                  {error}
                </div>
              )}

              <div>
                <label 
                  className="block text-sm font-medium mb-2"
                  style={{ color: 'var(--color-text-secondary)' }}
                >
                  {t('recipients')}
                </label>
                <RecipientInput
                  recipients={recipients}
                  onChange={setRecipients}
                  domain={domain}
                  maxRecipients={50}
                />
              </div>

              <div>
                <label 
                  className="block text-sm font-medium mb-1"
                  style={{ color: 'var(--color-text-secondary)' }}
                >
                  {t('subject')}
                </label>
                <input
                  type="text"
                  value={subject}
                  onChange={e => setSubject(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-lg border text-sm transition-colors focus:outline-none focus:ring-2"
                  style={{ 
                    backgroundColor: 'var(--color-bg-primary)',
                    borderColor: 'var(--color-border-primary)',
                    color: 'var(--color-text-primary)'
                  }}
                  placeholder={t('subjectPlaceholder')}
                  required
                />
              </div>

              <div>
                <label 
                  className="block text-sm font-medium mb-1"
                  style={{ color: 'var(--color-text-secondary)' }}
                >
                  {t('body')}
                </label>
                <RichTextEditor
                  content={body}
                  onChange={setBody}
                />
              </div>

              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Paperclip className="w-4 h-4" style={{ color: 'var(--color-text-tertiary)' }} />
                  <label 
                    className="text-sm font-medium"
                    style={{ color: 'var(--color-text-secondary)' }}
                  >
                    {t('attachments')}
                  </label>
                </div>
                
                {referencedAttachments.length > 0 && (
                  <div className="mb-2 space-y-1">
                    {referencedAttachments.map(att => (
                      <div
                        key={att.id}
                        className="flex items-center gap-2 px-3 py-2 rounded-lg"
                        style={{ 
                          backgroundColor: 'var(--color-accent-muted)',
                          border: '1px solid var(--color-accent-primary)'
                        }}
                      >
                        <Paperclip className="w-4 h-4" style={{ color: 'var(--color-accent-primary)' }} />
                        <span 
                          className="text-sm flex-1 truncate"
                          style={{ color: 'var(--color-text-primary)' }}
                        >
                          {att.originalName}
                        </span>
                        <span 
                          className="text-xs"
                          style={{ color: 'var(--color-text-tertiary)' }}
                        >
                          {formatFileSize(att.size)}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleRemoveReferencedAttachment(att.id)}
                          className="p-1 rounded"
                          style={{ color: 'var(--color-text-quaternary)' }}
                        >
                          <X className="w-4 h-4 hover:text-red-500" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                
                <AttachmentUpload
                  attachments={attachments}
                  onChange={setAttachments}
                  maxFiles={10}
                  maxSize={10}
                />
              </div>
            </div>

            <div 
              className="flex items-center justify-end gap-3 p-4 border-t"
              style={{ 
                borderColor: 'var(--color-border-primary)',
                backgroundColor: 'var(--color-bg-tertiary)'
              }}
            >
              <button
                type="button"
                onClick={handleClose}
                className="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                style={{ 
                  color: 'var(--color-text-secondary)',
                  backgroundColor: 'var(--color-bg-secondary)'
                }}
              >
                {t('discard')}
              </button>
              <button
                type="submit"
                disabled={loading || recipients.length === 0}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                style={{ backgroundColor: 'var(--color-accent-primary)', color: 'var(--color-accent-text)' }}
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {t('sending')}
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    {t('send')}
                  </>
                )}
              </button>
            </div>
          </form>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
