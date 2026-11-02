/** Mail list shared by the inbox and archive. Row heights include separators. */
import { useRef, type KeyboardEvent } from 'react'
import { Mail, Paperclip, CheckSquare, Square, Star } from 'lucide-react'
import { useI18n } from '../i18n/I18nContext'
import { useTheme } from '../contexts/ThemeContext'
import { mailPreview } from '../lib/mailPreview'

export const EMAIL_ROW_HEIGHT = 96
export const EMAIL_ROW_HEIGHT_COMPACT = 60
export const SELECT_ALL_ROW_HEIGHT = 40

export interface Email {
  id: string
  from: string
  fromName?: string | null
  to: string
  toList?: string
  ccList?: string | null
  bccList?: string | null
  subject: string
  body: string
  summary: string | null
  folder: string
  isRead: boolean
  isStarred?: boolean
  createdAt: string
  attachments?: { id: string; filename: string; originalName: string; mimeType: string; size: number }[]
}

interface EmailListProps {
  folder: string
  emails: Email[]
  onSelectEmail: (email: Email) => void
  selectedEmailId?: string
  isSelectMode?: boolean
  selectedEmailIds?: Set<string>
  onSelectAll?: (emailIds: string[]) => void
  compact?: boolean
}

export default function EmailList({ folder, emails, onSelectEmail, selectedEmailId,
  isSelectMode = false, selectedEmailIds = new Set(), onSelectAll, compact = false }: EmailListProps) {
  const { t, language } = useI18n()
  const { layout } = useTheme()
  const classic = layout === 'classic'
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([])
  const zh = language === 'zh-CN'
  const allSelected = emails.length > 0 && emails.every(email => selectedEmailIds.has(email.id))
  const focusRow = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = index
    if (event.key === 'ArrowDown') next = Math.min(index + 1, emails.length - 1)
    else if (event.key === 'ArrowUp') next = Math.max(index - 1, 0)
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = emails.length - 1
    else return
    event.preventDefault()
    rowRefs.current[next]?.focus()
  }
  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    const now = new Date()
    if (date.toDateString() === now.toDateString()) {
      return date.toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit', hour12: false })
    }
    if (classic) return date.toLocaleDateString(language, {
      ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' as const } : {}),
      month: 'numeric', day: 'numeric'
    })
    return date.toLocaleDateString(language, {
      ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' as const } : {}),
      month: 'short', day: 'numeric'
    })
  }

  if (emails.length === 0) return (
    <div className="flex flex-col items-center justify-center h-64 px-6 text-center" style={{ color: 'var(--color-text-tertiary)' }}>
      <span className="flex items-center justify-center w-14 h-14 rounded-2xl mb-4" style={{ background: 'var(--color-accent-muted)', color: 'var(--color-accent-primary)' }}><Mail className="w-6 h-6" strokeWidth={1.5} /></span>
      <p className="text-sm font-medium" style={{ color: 'var(--color-text-secondary)' }}>{t('noEmails')}</p>
      <p className="text-xs mt-2">{zh ? '新消息会在这里与你见面' : 'New messages will appear here'}</p>
    </div>
  )

  return (
    <div aria-label={zh ? '邮件列表' : 'Messages'}>
      {isSelectMode && (
        <button type="button" onClick={() => onSelectAll?.(emails.map(email => email.id))}
          aria-pressed={allSelected}
          className="mail-select-all w-full flex items-center gap-3 px-5 text-left text-xs font-medium border-b hover:bg-[var(--color-bg-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--color-accent-primary)]"
          style={{ height: classic ? 37 : SELECT_ALL_ROW_HEIGHT, borderColor: 'var(--color-border-primary)', color: 'var(--color-text-secondary)' }}>
          {allSelected ? <CheckSquare className="w-4 h-4" style={{ color: 'var(--color-accent-primary)' }} /> : <Square className="w-4 h-4" />}
          {t('selectAll')}
        </button>
      )}
      {emails.map((email, index) => {
        const selected = isSelectMode ? selectedEmailIds.has(email.id) : selectedEmailId === email.id
        const sender = folder === 'SENT' ? `${zh ? '收件人' : 'To'}: ${email.to}` : email.fromName || email.from
        const summary = email.summary?.trim() || ''
        const summaryHasMetadata = /^(?:---|\+\+\+)(?:\s|$)|^(?:title|date|description)\s*[:=]/i.test(summary)
        const preview = mailPreview(summaryHasMetadata ? email.body || '' : summary || email.body || '')
        return (
          <button type="button" key={email.id} ref={element => { rowRefs.current[index] = element }}
            onClick={() => onSelectEmail(email)} onKeyDown={event => focusRow(event, index)}
            aria-pressed={selected}
            aria-label={`${!email.isRead ? (zh ? '未读，' : 'Unread, ') : ''}${sender}，${email.subject || (zh ? '无主题' : 'No subject')}，${formatDate(email.createdAt)}`}
            className={`${classic ? `classic-mail-row ${compact ? 'classic-mail-row--compact' : ''}` : ''} group relative w-full block text-left px-5 transition-colors border-b hover:bg-[var(--color-bg-hover)] focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--color-accent-primary)] ${compact ? 'py-2.5' : 'py-3.5'}`}
            style={{ height: classic ? compact ? 41 : 67 : compact ? EMAIL_ROW_HEIGHT_COMPACT : EMAIL_ROW_HEIGHT,
              borderColor: classic ? 'var(--color-border-secondary)' : 'color-mix(in srgb, var(--color-border-primary) 65%, transparent)',
              backgroundColor: selected ? 'var(--color-accent-muted)' : undefined }}>
            {selected && <span className="mail-row-selected-edge absolute left-0 top-4 bottom-4 w-[3px] rounded-r-full" style={{ background: 'var(--color-accent-primary)' }} />}
            {classic ? <span className={`classic-mail-line ${compact ? 'is-compact' : ''}`}>
              {isSelectMode && <span className="classic-mail-check" style={{ color: selected ? 'var(--color-accent-primary)' : 'var(--color-text-quaternary)' }}>{selected ? <CheckSquare size={16} /> : <Square size={16} />}</span>}
              <span className={`classic-mail-read-dot ${email.isRead ? 'is-read' : ''}`} style={{ background: email.isRead ? 'transparent' : 'var(--color-accent-primary)', borderColor: email.isRead ? 'var(--color-text-quaternary)' : 'transparent' }} />
              {compact ? <>
                {email.isStarred && <Star className="classic-mail-star text-yellow-500 fill-current" size={14} aria-label={t('star')} />}
                <span className="classic-mail-sender" style={{ color: email.isRead ? 'var(--color-text-secondary)' : 'var(--color-text-primary)', fontWeight: email.isRead ? 400 : 600 }} title={sender}>{sender}</span>
                <span className="classic-mail-subject" style={{ color: email.isRead ? 'var(--color-text-secondary)' : 'var(--color-text-primary)', fontWeight: email.isRead ? 400 : 600 }}>{email.subject || (zh ? '无主题' : 'No subject')}</span>
                <span className="classic-mail-preview">{preview}</span>
                <span className="classic-mail-meta">{!!email.attachments?.length && <Paperclip size={12} aria-label={t('attachments')} />}<time dateTime={email.createdAt} title={new Date(email.createdAt).toLocaleString(language)}>{formatDate(email.createdAt)}</time></span>
              </> : <span className="classic-mail-copy">
                <span className="classic-mail-first-line"><span className="classic-mail-identity">{email.isStarred && <Star className="classic-mail-star text-yellow-500 fill-current" size={14} aria-label={t('star')} />}<span className="classic-mail-sender" style={{ color: email.isRead ? 'var(--color-text-secondary)' : 'var(--color-text-primary)', fontWeight: email.isRead ? 400 : 600 }} title={sender}>{sender}</span></span><span className="classic-mail-meta">{!!email.attachments?.length && <Paperclip size={12} aria-label={t('attachments')} />}<time dateTime={email.createdAt} title={new Date(email.createdAt).toLocaleString(language)}>{formatDate(email.createdAt)}</time></span></span>
                <span className="classic-mail-subject" style={{ color: email.isRead ? 'var(--color-text-secondary)' : 'var(--color-text-primary)', fontWeight: email.isRead ? 400 : 600 }}>{email.subject || (zh ? '无主题' : 'No subject')}</span>
              </span>}
            </span> : <span className={`flex min-w-0 gap-3 ${compact ? 'items-center h-full' : 'items-start'}`}>
              {isSelectMode ? <span className="shrink-0 mt-0.5" style={{ color: selected ? 'var(--color-accent-primary)' : 'var(--color-text-tertiary)' }}>{selected ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}</span>
                : <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${compact ? '' : 'mt-1.5'}`} style={{ background: email.isRead ? 'transparent' : 'var(--color-accent-primary)' }} />}
              <span className={`min-w-0 flex-1 ${compact ? 'sm:flex sm:items-center sm:gap-5' : ''}`}>
                <span className={`flex items-center justify-between gap-3 ${compact ? 'sm:w-40 sm:shrink-0' : 'mb-1'}`}>
                  <span className="truncate text-xs font-medium" style={{ color: email.isRead ? 'var(--color-text-secondary)' : 'var(--color-text-primary)' }} title={sender}>{sender}</span>
                  {!compact && <time className="text-[11px] tabular-nums shrink-0" dateTime={email.createdAt} style={{ color: 'var(--color-text-tertiary)' }}>{formatDate(email.createdAt)}</time>}
                </span>
                <span className={`flex min-w-0 items-center gap-2 ${compact ? 'flex-1' : ''}`}>
                  <span className={`block truncate text-[13px] ${compact ? 'sm:max-w-[55%]' : ''}`} style={{ color: 'var(--color-text-primary)', fontWeight: email.isRead ? 500 : 650 }}>{email.subject || (zh ? '无主题' : 'No subject')}</span>
                  {email.isStarred && <Star className="w-3 h-3 shrink-0 text-amber-500 fill-current" aria-label={t('star')} />}
                  {!!email.attachments?.length && <Paperclip className="w-3 h-3 shrink-0" style={{ color: 'var(--color-text-tertiary)' }} aria-label={t('attachments')} />}
                  {compact && <span className="hidden sm:block min-w-0 flex-1 truncate text-xs" style={{ color: 'var(--color-text-tertiary)' }}>— {preview}</span>}
                </span>
                {!compact && <span className="block mt-1.5 truncate text-xs leading-4" style={{ color: 'var(--color-text-tertiary)' }}>{preview || (zh ? '此邮件没有正文' : 'No message preview')}</span>}
              </span>
              {compact && <time className="text-[11px] tabular-nums shrink-0" dateTime={email.createdAt} style={{ color: 'var(--color-text-tertiary)' }}>{formatDate(email.createdAt)}</time>}
            </span>}
          </button>
        )
      })}
    </div>
  )
}
