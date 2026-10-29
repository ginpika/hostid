/** Shared mailbox workspace for inbox, sent, starred, archive and trash. */
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import { useLocation } from 'react-router-dom'
import { Search, X, Mail, MailOpen, CheckSquare, Trash2, ChevronLeft, ChevronRight, Columns2, List, RefreshCw, ArrowLeft, AlertCircle, Inbox, RotateCcw } from 'lucide-react'
import { useI18n } from '../i18n/I18nContext'
import { useCompose } from '../contexts/ComposeContext'
import { useTheme } from '../contexts/ThemeContext'
import '../styles/classic-mailbox.css'
import EmailList, { type Email } from '../components/EmailList'
import EmailDetail from '../components/EmailDetail'
import ConfirmDialog from '../components/ConfirmDialog'
import { notify, refreshMail } from '../lib/mailEvents'
import { clampMailListWidth, getMailListWidthBounds } from '../lib/mailLayout'

type Folder = 'INBOX' | 'SENT' | 'STARRED' | 'ARCHIVED' | 'TRASH'
type MailRecord = Email
interface Pagination { page: number; limit: number; total: number; totalPages: number }
const folderPaths: Record<string, Folder> = { '/': 'INBOX', '/sent': 'SENT', '/starred': 'STARRED', '/archived': 'ARCHIVED', '/trash': 'TRASH' }
const savedWidth = () => {
  const value = Number(localStorage.getItem('mail-list-width'))
  return Number.isFinite(value) && value >= 300 ? Math.min(value, 600) : 390
}

export default function InboxPage() {
  const { pathname } = useLocation()
  const folder = folderPaths[pathname] || 'INBOX'
  const { t, language } = useI18n()
  const { openCompose } = useCompose()
  const { layout } = useTheme()
  const classic = layout === 'classic'
  const zh = language === 'zh-CN'
  const [layoutMode, setLayoutMode] = useState(() => localStorage.getItem('inboxLayoutMode') === 'list' ? 'list' : 'split')
  const [listWidth, setListWidth] = useState(savedWidth)
  const [classicListWidth, setClassicListWidth] = useState<number | null>(() => {
    const value = Number(localStorage.getItem('classic-mail-list-width'))
    return Number.isFinite(value) && value >= 240 ? Math.max(300, Math.min(value, 600)) : null
  })
  const [measuredListWidth, setMeasuredListWidth] = useState(listWidth)
  const [workspaceWidth, setWorkspaceWidth] = useState(1000)
  const workspaceRef = useRef<HTMLDivElement>(null)
  const listScrollRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ x: number; width: number } | null>(null)
  const [resizing, setResizing] = useState(false)
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [page, setPage] = useState(1)
  const [revision, setRevision] = useState(0)
  const [emails, setEmails] = useState<MailRecord[]>([])
  const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 20, total: 0, totalPages: 0 })
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [selectedEmail, setSelectedEmail] = useState<MailRecord | null>(null)
  const [showDetail, setShowDetail] = useState(false)
  const [isSelectMode, setIsSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const batchBusyRef = useRef(false)
  const [wideScreen, setWideScreen] = useState(() => window.matchMedia('(min-width: 768px)').matches)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [operationError, setOperationError] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const detailIsModal = showDetail && (layoutMode === 'list' || !wideScreen)
  const scopeKey = `${folder}:${query}:${unreadOnly}`
  const scopeRef = useRef({ key: scopeKey, version: 0 })
  if (scopeRef.current.key !== scopeKey) scopeRef.current = { key: scopeKey, version: scopeRef.current.version + 1 }
  const folderLabel = t(({ INBOX: 'inbox', SENT: 'sent', STARRED: 'starred', ARCHIVED: 'archived', TRASH: 'trash' } as const)[folder])

  useEffect(() => {
    const breakpoint = window.matchMedia('(min-width: 768px)')
    const update = () => setWideScreen(breakpoint.matches)
    breakpoint.addEventListener('change', update)
    return () => breakpoint.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => { setQuery(search.trim()); setPage(1) }, 250)
    return () => window.clearTimeout(timer)
  }, [search])

  useEffect(() => {
    setIsSelectMode(false)
    setConfirmDelete(false)
    setOperationError('')
    setPage(1)
  }, [folder, query, unreadOnly])

  useEffect(() => {
    setSelectedEmail(null)
    setShowDetail(false)
    setSelectedIds(new Set())
    if (listScrollRef.current) listScrollRef.current.scrollTop = 0
  }, [page, folder, query, unreadOnly])

  useEffect(() => {
    dragRef.current = null
    setResizing(false)
  }, [layout, layoutMode])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setLoadError(false)
    const params = new URLSearchParams({ folder, page: String(page), limit: '20' })
    if (query) params.set('q', query)
    if (unreadOnly) params.set('read', 'unread')
    fetch(`/api/emails?${params}`, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }, signal: controller.signal })
      .then(async res => {
        if (!res.ok) throw new Error('mail-list-failed')
        const data = await res.json()
        if (!controller.signal.aborted) {
          setEmails(data.emails)
          setPagination(data.pagination)
          if (data.pagination.page !== page) setPage(data.pagination.page)
        }
      })
      .catch(() => { if (!controller.signal.aborted) setLoadError(true) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [folder, page, query, unreadOnly, revision])

  useEffect(() => {
    const refresh = () => setRevision(value => value + 1)
    window.addEventListener('hostid:mail-updated', refresh)
    const shortcut = (event: KeyboardEvent) => {
      if (document.querySelector('[aria-modal="true"]')) return
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', shortcut)
    return () => {
      window.removeEventListener('hostid:mail-updated', refresh)
      window.removeEventListener('keydown', shortcut)
    }
  }, [])

  useEffect(() => {
    if (unreadOnly && selectedEmail && !detailIsModal && !emails.some(email => email.id === selectedEmail.id) && document.activeElement === document.body) {
      workspaceRef.current?.querySelector<HTMLElement>('.mail-message-surface h2')?.focus()
    }
  }, [emails, selectedEmail, unreadOnly, detailIsModal])

  useEffect(() => {
    const panel = workspaceRef.current?.querySelector<HTMLElement>('.mail-list-panel')
    if (!panel) return
    const workspace = workspaceRef.current
    const measure = () => {
      setMeasuredListWidth(Math.round(panel.getBoundingClientRect().width))
      setWorkspaceWidth(workspace?.clientWidth || 1000)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(panel)
    if (workspace) observer.observe(workspace)
    return () => observer.disconnect()
  }, [])

  const updateWidth = (value: number) => {
    const available = workspaceRef.current?.clientWidth || 1000
    const next = clampMailListWidth(value, available, classic)
    if (classic) {
      setClassicListWidth(next)
      localStorage.setItem('classic-mail-list-width', String(next))
    } else {
      setListWidth(next)
      localStorage.setItem('mail-list-width', String(next))
    }
  }
  const startResize = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary || event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { x: event.clientX, width: workspaceRef.current?.querySelector('.mail-list-panel')?.getBoundingClientRect().width || listWidth }
    setResizing(true)
  }
  const endResize = () => { dragRef.current = null; setResizing(false) }

  const selectEmail = (email: MailRecord) => {
    if (busy) return
    if (isSelectMode) {
      setSelectedIds(previous => {
        const next = new Set(previous)
        if (next.has(email.id)) next.delete(email.id); else next.add(email.id)
        return next
      })
      return
    }
    setSelectedEmail(email)
    setShowDetail(true)
  }
  const refreshAfterAction = () => {
    setSelectedEmail(null)
    setShowDetail(false)
    setRevision(value => value + 1)
  }
  const toggleStar = (id: string, isStarred: boolean) => {
    setEmails(previous => previous.map(email => email.id === id ? { ...email, isStarred } : email))
    if (folder === 'STARRED' && !isStarred) setRevision(value => value + 1)
  }
  const markRead = (id: string) => {
    setEmails(previous => previous.map(email => email.id === id ? { ...email, isRead: true } : email))
    if (unreadOnly) setRevision(value => value + 1)
  }
  const parseList = (value?: string | null): string[] => {
    try { return value ? JSON.parse(value) : [] } catch { return [] }
  }
  const composeFrom = (email: MailRecord, mode: 'reply' | 'replyAll' | 'forward') => openCompose({
    id: email.id, mode, from: email.from, toList: mode === 'forward' ? [] : parseList(email.toList),
    ccList: mode === 'replyAll' ? parseList(email.ccList) : [], subject: email.subject, body: email.body,
    date: email.createdAt, attachments: email.attachments || []
  })

  const runBatch = async (action: 'delete' | 'read' | 'unarchive') => {
    if (batchBusyRef.current || selectedIds.size === 0 || loading || search.trim() !== query) return false
    batchBusyRef.current = true
    setBusy(true)
    setOperationError('')
    const operationScope = scopeRef.current.version
    const ids = [...selectedIds]
    const makeRead = !emails.filter(email => selectedIds.has(email.id)).every(email => email.isRead)
    const results = await Promise.allSettled(ids.map(async id => {
      const path = action === 'delete' ? folder === 'TRASH' ? '?permanent=true' : '' : action === 'read' ? '/read' : '/restore'
      const res = await fetch(`/api/emails/${id}${path}`, {
        method: action === 'delete' ? 'DELETE' : action === 'read' ? 'PATCH' : 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}`, 'Content-Type': 'application/json' },
        ...(action === 'read' ? { body: JSON.stringify({ isRead: makeRead }) } : {})
      })
      if (!res.ok) throw new Error('mail-action-failed')
      return id
    }))
    if (scopeRef.current.version !== operationScope) {
      batchBusyRef.current = false
      setBusy(false)
      refreshMail()
      return
    }
    const failed = ids.filter((_, index) => results[index].status === 'rejected')
    const succeeded = new Set(ids.filter(id => !failed.includes(id)))
    if (action === 'read') setEmails(previous => previous.map(email => succeeded.has(email.id) ? { ...email, isRead: makeRead } : email))
    else {
      setEmails(previous => previous.filter(email => !succeeded.has(email.id)))
      if (selectedEmail && succeeded.has(selectedEmail.id)) setSelectedEmail(null)
    }
    setSelectedIds(new Set(failed))
    setIsSelectMode(failed.length > 0)
    batchBusyRef.current = false
    setBusy(false)
    setRevision(value => value + 1)
    if (failed.length) {
      setOperationError(zh ? `${failed.length} 封邮件操作失败，已保留选择，请重试。` : `${failed.length} messages could not be updated. Your selection is kept; please retry.`)
      return false
    } else {
      setConfirmDelete(false)
      notify(zh ? (action === 'delete' ? folder === 'TRASH' ? '邮件已永久删除' : '邮件已移至垃圾箱' : action === 'read' ? '已更新阅读状态' : '邮件已移回收件箱') : 'Messages updated', 'success')
    }
  }
  const allSelectedRead = emails.filter(email => selectedIds.has(email.id)).every(email => email.isRead)
  const start = pagination.total ? (pagination.page - 1) * pagination.limit + 1 : 0
  const end = Math.min(pagination.page * pagination.limit, pagination.total)
  const loadingSearch = search.trim() !== query
  const widthBounds = getMailListWidthBounds(workspaceWidth, classic)
  const toggleLayout = () => {
    const next = layoutMode === 'split' ? 'list' : 'split'
    setLayoutMode(next)
    localStorage.setItem('inboxLayoutMode', next)
    setShowDetail(false)
  }
  const toggleSelect = () => {
    setIsSelectMode(!isSelectMode)
    setSelectedIds(new Set())
    setOperationError('')
  }

  const paginationBar = (
    <div className="mail-list-footer">
            <span className="mail-pagination-count" aria-live="polite" title={`${start}–${end} / ${pagination.total}`} aria-label={classic ? (zh ? `${pagination.total} 封邮件` : `${pagination.total} messages`) : undefined}>{classic ? `${start}–${end} ${t('of')} ${pagination.total}` : <>{start}–{end}<span className="mx-1.5 opacity-40">/</span>{pagination.total}</>}</span>
            <div className="mail-pagination-actions flex items-center gap-1">
              {classic && <>
                <button className="mail-icon-button classic-toolbar-refresh" title={t('refresh')} aria-label={t('refresh')} disabled={loading || busy} onClick={() => setRevision(value => value + 1)}><RefreshCw size={15} className={loading ? 'animate-spin' : ''} /></button>
                <button className="mail-icon-button" aria-label={layoutMode === 'split' ? t('listLayout') : t('splitLayout')} title={layoutMode === 'split' ? t('listLayout') : t('splitLayout')} onClick={toggleLayout}>{layoutMode === 'split' ? <List size={16} /> : <Columns2 size={16} />}</button>
                <button className={`mail-select-toggle ${isSelectMode ? 'is-active' : ''}`} disabled={busy || (!isSelectMode && (loading || loadingSearch || !emails.length))} aria-pressed={isSelectMode} aria-label={isSelectMode ? t('cancel') : t('select')} title={isSelectMode ? t('cancel') : t('select')} onClick={toggleSelect}><CheckSquare size={15} /><span>{isSelectMode ? t('cancel') : t('select')}</span></button>
              </>}
              <button className="mail-icon-button" disabled={loading || busy || pagination.page <= 1} title={t('previous')} aria-label={t('previous')} onClick={() => { setPage(pagination.page - 1); setSelectedIds(new Set()) }}><ChevronLeft size={16} /></button>
              <button className="mail-icon-button" disabled={loading || busy || pagination.page >= pagination.totalPages} title={t('next')} aria-label={t('next')} onClick={() => { setPage(pagination.page + 1); setSelectedIds(new Set()) }}><ChevronRight size={16} /></button>
            </div>
          </div>
  )

  return (
    <>
      <div ref={workspaceRef} className={`mail-workspace ${layoutMode === 'list' ? 'mail-workspace--list' : ''} ${resizing ? 'is-resizing' : ''}`} style={{ '--mail-list-width': `${listWidth}px`, ...(classicListWidth ? { '--classic-mail-list-width': `${classicListWidth}px` } : {}) } as CSSProperties}>
        <section className="mail-list-panel" aria-label={folderLabel}>
          {classic && paginationBar}
          <div className="mail-list-heading">
            <div className="flex items-center gap-2.5 min-w-0">
              <h2>{folderLabel}</h2>
              <span className="mail-count" aria-label={zh ? `${pagination.total} 封邮件` : `${pagination.total} messages`}>{pagination.total}</span>
            </div>
            <div className="flex items-center gap-1">
              <button className="mail-icon-button" title={t('refresh')} aria-label={t('refresh')} disabled={loading || busy} onClick={() => setRevision(value => value + 1)}><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /></button>
              <button className="mail-icon-button" aria-label={layoutMode === 'split' ? t('listLayout') : t('splitLayout')} title={layoutMode === 'split' ? t('listLayout') : t('splitLayout')} onClick={toggleLayout}>{layoutMode === 'split' ? <List size={17} /> : <Columns2 size={17} />}</button>
            </div>
          </div>
          <div className="mail-search-tools">
          <div className="mail-search-wrap">
            <div className="mail-search">
              <Search size={17} aria-hidden="true" />
              <input ref={searchRef} value={search} maxLength={200} onChange={event => setSearch(event.target.value)} placeholder={zh ? `搜索${folderLabel}…` : `Search ${folderLabel.toLowerCase()}…`} aria-label={zh ? `搜索${folderLabel}中的邮件` : `Search messages in ${folderLabel}`} onKeyDown={event => { if (event.key === 'Escape') { setSearch(''); event.currentTarget.blur() } }} />
              {search ? <button onClick={() => setSearch('')} className="mail-search-clear" aria-label={zh ? '清除搜索' : 'Clear search'}><X size={15} /></button> : <kbd>⌘ K</kbd>}
            </div>
          </div>
          <div className="mail-list-controls">
            <div className="mail-filter-tabs" aria-label={zh ? '阅读状态筛选' : 'Filter by read status'}>
              <button aria-pressed={!unreadOnly} className={!unreadOnly ? 'is-active' : ''} disabled={busy} onClick={() => { setPage(1); setUnreadOnly(false) }}>{zh ? '全部' : 'All mail'}</button>
              <button aria-pressed={unreadOnly} className={unreadOnly ? 'is-active' : ''} disabled={busy} onClick={() => { setPage(1); setUnreadOnly(true) }}><span className="mail-unread-dot" />{zh ? '未读' : 'Unread'}</button>
            </div>
            <button className={`mail-select-toggle ${isSelectMode ? 'is-active' : ''}`} disabled={busy || (!isSelectMode && (loading || loadingSearch || !emails.length))} aria-pressed={isSelectMode} aria-label={isSelectMode ? t('cancel') : t('select')} title={isSelectMode ? t('cancel') : t('select')} onClick={toggleSelect}><CheckSquare size={15} />{isSelectMode ? t('cancel') : t('select')}</button>
          </div>
          </div>
          {isSelectMode && <div className="mail-batch-toolbar">
            <span className="text-xs whitespace-nowrap">{zh ? `已选 ${selectedIds.size} 封` : `${selectedIds.size} selected`}</span>
            <div className="flex items-center gap-1">
              {folder === 'ARCHIVED' && <button className="mail-icon-button" title={t('unarchive')} aria-label={t('unarchive')} disabled={busy || loading || loadingSearch || !selectedIds.size} onClick={() => void runBatch('unarchive')}><RotateCcw size={16} /></button>}
              <button className="mail-icon-button" title={allSelectedRead ? t('markAsUnread') : t('markAsRead')} aria-label={allSelectedRead ? t('markAsUnread') : t('markAsRead')} disabled={busy || loading || loadingSearch || !selectedIds.size} onClick={() => void runBatch('read')}>{allSelectedRead ? <Mail size={16} /> : <MailOpen size={16} />}</button>
              <button className="mail-icon-button mail-icon-button--danger" title={folder === 'TRASH' ? zh ? '永久删除' : 'Delete permanently' : t('delete')} aria-label={folder === 'TRASH' ? zh ? '永久删除所选邮件' : 'Permanently delete selected messages' : t('delete')} disabled={busy || loading || loadingSearch || !selectedIds.size} onClick={() => folder === 'TRASH' ? setConfirmDelete(true) : void runBatch('delete')}><Trash2 size={16} /></button>
            </div>
          </div>}
          {operationError && <div className="mail-error" role="alert"><AlertCircle size={16} /><span>{operationError}</span></div>}
          <div ref={listScrollRef} className="mail-list-scroll" aria-busy={loading || loadingSearch}>
            {loading || loadingSearch ? <div className="mail-skeletons" aria-label={zh ? '正在加载邮件' : 'Loading messages'}>{[0, 1, 2, 3, 4].map(value => <div key={value} className="mail-skeleton"><i /><div><i /><i /><i /></div></div>)}</div> : loadError ? <div className="mail-empty"><div className="mail-empty-icon"><AlertCircle size={28} /></div><h3>{zh ? '邮件暂时无法加载' : 'Couldn’t load your mail'}</h3><p>{zh ? '请检查连接，然后重试。' : 'Check your connection and try again.'}</p><button className="btn-secondary mt-4 text-sm" onClick={() => setRevision(value => value + 1)}><RefreshCw size={14} className="inline mr-2" />{zh ? '重新加载' : 'Try again'}</button></div> : emails.length === 0 ? <div className="mail-empty"><div className="mail-empty-icon">{query ? <Search size={28} /> : <Inbox size={28} />}</div><h3>{query ? zh ? '没有找到相关邮件' : 'No matching messages' : unreadOnly ? zh ? '未读邮件已清空' : 'You’re all caught up' : t('noEmails')}</h3><p>{query ? zh ? '试试其他关键词，或清除筛选条件。' : 'Try another search or clear your filters.' : zh ? '新的消息，会在这里与你相遇。' : 'Your next conversation starts here.'}</p>{(query || unreadOnly) && <button className="mail-text-button mt-4" onClick={() => { setSearch(''); setUnreadOnly(false) }}>{zh ? '清除筛选' : 'Clear filters'}</button>}</div> : <EmailList folder={folder} emails={emails} onSelectEmail={selectEmail} selectedEmailId={selectedEmail?.id} isSelectMode={isSelectMode} selectedEmailIds={selectedIds} onSelectAll={ids => { if (!busy) setSelectedIds(previous => ids.every(id => previous.has(id)) ? new Set() : new Set(ids)) }} compact={layoutMode === 'list'} />}
          </div>
          {!classic && paginationBar}
        </section>
        {layoutMode === 'split' && <>
          <div className="mail-resizer" role="separator" tabIndex={0} aria-orientation="vertical" aria-label={zh ? '调整邮件列表宽度' : 'Resize message list'} aria-valuemin={widthBounds.min} aria-valuemax={widthBounds.max} aria-valuenow={measuredListWidth} onPointerDown={startResize} onPointerMove={event => { if (dragRef.current) updateWidth(dragRef.current.width + event.clientX - dragRef.current.x) }} onPointerUp={endResize} onPointerCancel={endResize} onLostPointerCapture={endResize} onKeyDown={event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); updateWidth(event.key === 'Home' ? widthBounds.min : event.key === 'End' ? widthBounds.max : measuredListWidth + (event.key === 'ArrowLeft' ? -20 : 20)) } }}><span /></div>
          <section className="mail-reading-panel" aria-label={zh ? '邮件阅读区' : 'Message reader'}>
            {selectedEmail && wideScreen ? <EmailDetail key={selectedEmail.id} embedded emailId={selectedEmail.id} onClose={() => setSelectedEmail(null)} onDelete={refreshAfterAction} onRestore={refreshAfterAction} onArchive={refreshAfterAction} onToggleStar={toggleStar} onRead={markRead} onFeedback={notify} onReply={email => composeFrom(email, 'reply')} onReplyAll={email => composeFrom(email, 'replyAll')} onForward={email => composeFrom(email, 'forward')} /> : classic ? <div className="classic-reader-empty"><Mail className="w-16 h-16 mb-4" /><p>{t('selectEmailToView')}</p></div> : <div className="mail-reader-empty">
              <div className="mail-reader-art" aria-hidden="true"><div className="mail-reader-art-paper"><i /><i /><i /></div><Mail size={42} strokeWidth={1.25} /></div>
              <span className="mail-eyebrow">{zh ? '留一点空间，给重要的消息' : 'A little space for what matters'}</span>
              <h2>{zh ? '每一封信，都值得专注' : 'A calmer place for your mail'}</h2>
              <p>{zh ? '选择一封邮件，开始阅读或回复。' : 'Select a message to read or reply.'}</p>
              <div className="mail-reader-hint"><ArrowLeft size={14} />{zh ? '从左侧选择邮件' : 'Choose a message on the left'}</div>
            </div>}
          </section>
        </>}
      </div>
      {detailIsModal && selectedEmail && <EmailDetail key={`modal-${selectedEmail.id}`} emailId={selectedEmail.id} onClose={() => setShowDetail(false)} onDelete={refreshAfterAction} onRestore={refreshAfterAction} onArchive={refreshAfterAction} onToggleStar={toggleStar} onRead={markRead} onFeedback={notify} onReply={email => composeFrom(email, 'reply')} onReplyAll={email => composeFrom(email, 'replyAll')} onForward={email => composeFrom(email, 'forward')} />}
      <ConfirmDialog open={confirmDelete} title={zh ? `永久删除 ${selectedIds.size} 封邮件？` : `Permanently delete ${selectedIds.size} messages?`} description={zh ? '邮件及不再使用的附件将被永久移除，此操作无法撤销。' : 'These messages and unused attachments will be permanently removed. This cannot be undone.'} confirmLabel={zh ? '永久删除' : 'Delete permanently'} cancelLabel={t('cancel')} onConfirm={() => runBatch('delete')} onCancel={() => setConfirmDelete(false)} busy={busy} />
    </>
  )
}
