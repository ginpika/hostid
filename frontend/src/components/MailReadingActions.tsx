import { useEffect, useRef, useState } from 'react'
import { Archive, Download, Forward, Inbox, MoreHorizontal, Reply, ReplyAll, RotateCcw, Star, Trash2 } from 'lucide-react'
import { useI18n } from '../i18n/I18nContext'
import ConfirmDialog from './ConfirmDialog'

type Action = () => void | boolean | Promise<void | boolean>
export interface MailReadingActionsProps {
  isStarred: boolean
  isTrash: boolean
  isArchived: boolean
  busy?: boolean
  onStar: Action
  onReply?: Action
  onReplyAll?: Action
  onForward?: Action
  onArchive?: Action
  onUnarchive?: Action
  onDelete: Action
  onRestore?: Action
  onExport: Action
}

export default function MailReadingActions({ isStarred, isTrash, isArchived, busy = false, onStar,
  onReply, onReplyAll, onForward, onArchive, onUnarchive, onDelete, onRestore, onExport }: MailReadingActionsProps) {
  const { t, language } = useI18n()
  const zh = language === 'zh-CN'
  const [open, setOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const more = zh ? '更多操作' : 'More actions'
  const deleteLabel = isTrash ? (zh ? '永久删除' : 'Delete permanently') : (zh ? '移到垃圾箱' : 'Move to trash')
  const unarchiveLabel = zh ? '移回收件箱' : 'Move to inbox'
  const closeMenu = () => { setOpen(false); triggerRef.current?.focus() }

  useEffect(() => {
    if (!open) return
    const outside = (event: MouseEvent) => { if (!menuRef.current?.contains(event.target as Node)) setOpen(false) }
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    document.addEventListener('mousedown', outside)
    return () => document.removeEventListener('mousedown', outside)
  }, [open])

  const iconClass = 'inline-flex shrink-0 items-center justify-center w-9 h-9 rounded-lg transition-colors hover:bg-[var(--color-bg-tertiary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-accent-primary)] disabled:opacity-40 disabled:cursor-wait'
  const items = [
    ...(onReplyAll ? [{ label: t('replyAll'), icon: ReplyAll, action: onReplyAll }] : []),
    ...(onForward ? [{ label: t('forward'), icon: Forward, action: onForward }] : []),
    { label: t('exportMail'), icon: Download, action: onExport }
  ]
  return (
    <div className="flex items-center gap-1.5 shrink-0" aria-label={zh ? '邮件操作' : 'Message actions'}>
      {onReply && <button type="button" disabled={busy} onClick={onReply} className="inline-flex items-center gap-2 h-9 px-3.5 rounded-lg text-xs font-semibold transition-colors hover:brightness-95 disabled:opacity-40" style={{ background: 'var(--color-accent-primary)', color: 'var(--color-accent-text)' }}><Reply className="w-4 h-4" />{t('reply')}</button>}
      <span className="h-5 w-px mx-1" style={{ background: 'var(--color-border-primary)' }} />
      <button type="button" disabled={busy} onClick={onStar} className={iconClass} title={isStarred ? t('unstar') : t('star')} aria-label={isStarred ? t('unstar') : t('star')} aria-pressed={isStarred} style={{ color: isStarred ? '#d69b20' : 'var(--color-text-tertiary)' }}><Star className={`w-[17px] h-[17px] ${isStarred ? 'fill-current' : ''}`} /></button>
      {isTrash && onRestore ? <button type="button" disabled={busy} onClick={onRestore} className={iconClass} title={t('restore')} aria-label={t('restore')} style={{ color: 'var(--color-text-tertiary)' }}><RotateCcw className="w-[17px] h-[17px]" /></button>
        : isArchived && onUnarchive ? <button type="button" disabled={busy} onClick={onUnarchive} className={iconClass} title={unarchiveLabel} aria-label={unarchiveLabel} style={{ color: 'var(--color-text-tertiary)' }}><Inbox className="w-[17px] h-[17px]" /></button>
          : !isTrash && !isArchived && onArchive && <button type="button" disabled={busy} onClick={onArchive} className={iconClass} title={t('archive')} aria-label={t('archive')} style={{ color: 'var(--color-text-tertiary)' }}><Archive className="w-[17px] h-[17px]" /></button>}
      <button type="button" disabled={busy} onClick={() => isTrash ? setConfirmDelete(true) : onDelete()} className={`${iconClass} hover:text-red-500`} title={deleteLabel} aria-label={deleteLabel} style={{ color: isTrash ? '#dc5858' : 'var(--color-text-tertiary)' }}><Trash2 className="w-[17px] h-[17px]" /></button>
      <div ref={menuRef} className="relative" onKeyDown={event => {
        if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); closeMenu() }
        if (!open || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
        event.preventDefault()
        const buttons = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') || [])
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
        buttons[next]?.focus()
      }}>
        <button type="button" ref={triggerRef} disabled={busy} onClick={() => setOpen(value => !value)} className={iconClass} aria-label={more} title={more} aria-haspopup="menu" aria-expanded={open} style={{ color: 'var(--color-text-tertiary)' }}><MoreHorizontal className="w-5 h-5" /></button>
        {open && <div role="menu" aria-label={more} className="absolute right-0 top-full mt-2 z-40 w-44 rounded-xl border p-1.5 shadow-xl" style={{ background: 'var(--color-bg-secondary)', borderColor: 'var(--color-border-primary)' }}>
          {items.map(item => <button type="button" key={item.label} role="menuitem" onClick={() => { closeMenu(); void item.action() }} className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs text-left hover:bg-[var(--color-bg-tertiary)] focus:bg-[var(--color-bg-tertiary)] focus:outline-none" style={{ color: 'var(--color-text-secondary)' }}><item.icon className="w-4 h-4" />{item.label}</button>)}
        </div>}
      </div>
      <ConfirmDialog open={confirmDelete} title={zh ? '永久删除这封邮件？' : 'Permanently delete this message?'} description={zh ? '邮件及其附件将被永久删除，此操作无法撤销。' : 'The message and its attachments will be permanently deleted. This cannot be undone.'} confirmLabel={zh ? '永久删除' : 'Delete permanently'} cancelLabel={t('cancel')} busy={busy} onCancel={() => setConfirmDelete(false)} onConfirm={onDelete} />
    </div>
  )
}
