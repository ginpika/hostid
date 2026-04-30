/**
 * 收件箱页面
 * 显示邮件列表和邮件详情预览面板
 * 支持收件箱、已发送和垃圾箱文件夹切换
 */
import { useState, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { CheckSquare, Trash, Mail, MailOpen, ChevronLeft, ChevronRight, RotateCcw, Loader2, Users, EyeOff, Paperclip, Download, ZoomIn, Reply, ReplyAll, Forward, Star, StarOff, Copy, Check as CheckIcon, ChevronDown, ChevronUp, Archive, X } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useI18n } from '../i18n/I18nContext'
import { useCompose } from '../contexts/ComposeContext'
import Layout from '../components/Layout'
import EmailList from '../components/EmailList'
import EmailBody from '../components/EmailBody'

type Folder = 'INBOX' | 'SENT' | 'TRASH'

interface Pagination {
  page: number
  limit: number
  total: number
  totalPages: number
}

interface Attachment {
  id: string
  filename: string
  originalName: string
  mimeType: string
  size: number
  createdAt: string
}

export default function InboxPage() {
  const location = useLocation()
  const { t } = useI18n()
  const { openCompose } = useCompose()
  const [selectedEmail, setSelectedEmail] = useState<any>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [selectedEmailIds, setSelectedEmailIds] = useState<Set<string>>(new Set())
  const [isSelectMode, setIsSelectMode] = useState(false)
  const [emails, setEmails] = useState<any[]>([])
  const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 20, total: 0, totalPages: 0 })
  const [loading, setLoading] = useState(false)

  const getFolder = (): Folder => {
    const path = location.pathname
    if (path === '/sent') return 'SENT'
    if (path === '/trash') return 'TRASH'
    return 'INBOX'
  }

  const folder = getFolder()

  const fetchEmails = async (page: number = 1) => {
    setLoading(true)
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/emails?folder=${folder}&page=${page}&limit=${pagination.limit}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (res.ok) {
        const data = await res.json()
        setEmails(data.emails)
        setPagination(data.pagination)
      }
    } catch (err) {
      console.error('Failed to fetch emails:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchEmails(1)
    setSelectedEmail(null)
    setIsSelectMode(false)
    setSelectedEmailIds(new Set())
  }, [folder, refreshKey])

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= pagination.totalPages) {
      fetchEmails(newPage)
      setSelectedEmail(null)
    }
  }

  const handleEmailDeleted = () => {
    setSelectedEmail(null)
    setRefreshKey(k => k + 1)
  }

  const handleSelectEmail = async (email: any) => {
    if (isSelectMode) {
      const newSelected = new Set(selectedEmailIds)
      if (newSelected.has(email.id)) {
        newSelected.delete(email.id)
      } else {
        newSelected.add(email.id)
      }
      setSelectedEmailIds(newSelected)
    } else {
      setSelectedEmail(email)

      if (!email.isRead) {
        try {
          const token = localStorage.getItem('token')
          await fetch(`/api/emails/${email.id}/read`, {
            method: 'PATCH',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ isRead: true })
          })
          setEmails(prev => prev.map(e =>
            e.id === email.id ? { ...e, isRead: true } : e
          ))
          setSelectedEmail({ ...email, isRead: true })
        } catch (err) {
          console.error('Failed to mark as read:', err)
        }
      }
    }
  }

  const handleToggleSelectMode = () => {
    setIsSelectMode(!isSelectMode)
    if (isSelectMode) {
      setSelectedEmailIds(new Set())
    }
  }

  const handleSelectAll = (emailIds: string[]) => {
    if (selectedEmailIds.size === emailIds.length) {
      setSelectedEmailIds(new Set())
    } else {
      setSelectedEmailIds(new Set(emailIds))
    }
  }

  const handleBatchDelete = async () => {
    if (selectedEmailIds.size === 0) return

    try {
      const token = localStorage.getItem('token')
      await Promise.all(
        Array.from(selectedEmailIds).map(id =>
          fetch(`/api/emails/${id}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` }
          })
        )
      )
      setSelectedEmailIds(new Set())
      setIsSelectMode(false)
      setRefreshKey(k => k + 1)
    } catch (err) {
      console.error('Failed to delete emails:', err)
    }
  }

  const handleBatchToggleRead = async () => {
    if (selectedEmailIds.size === 0) return

    const selectedEmails = emails.filter(e => selectedEmailIds.has(e.id))
    const allRead = selectedEmails.every(e => e.isRead)
    const newReadState = !allRead

    try {
      const token = localStorage.getItem('token')
      await Promise.all(
        Array.from(selectedEmailIds).map(id =>
          fetch(`/api/emails/${id}/read`, {
            method: 'PATCH',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ isRead: newReadState })
          })
        )
      )
      setEmails(prev => prev.map(e =>
        selectedEmailIds.has(e.id) ? { ...e, isRead: newReadState } : e
      ))
      setSelectedEmailIds(new Set())
      setIsSelectMode(false)
    } catch (err) {
      console.error('Failed to toggle read status:', err)
    }
  }

  const handleToggleStar = async (emailId: string, isStarred: boolean) => {
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/emails/${emailId}/star`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ isStarred })
      })

      if (!res.ok) {
        throw new Error('Failed to update star status')
      }

      setEmails(prev => prev.map(e =>
        e.id === emailId ? { ...e, isStarred } : e
      ))
      if (selectedEmail?.id === emailId) {
        setSelectedEmail((prev: any) => prev ? { ...prev, isStarred } : null)
      }
    } catch (err) {
      console.error('Failed to toggle star:', err)
    }
  }

  const parseEmailList = (list: string | null): string[] => {
    if (!list) return []
    try {
      return JSON.parse(list)
    } catch {
      return []
    }
  }

  const handleReply = (email: any) => {
    openCompose({
      mode: 'reply',
      from: email.from,
      toList: parseEmailList(email.toList),
      ccList: [],
      subject: email.subject,
      body: email.body,
      date: email.createdAt,
      attachments: email.attachments || []
    })
  }

  const handleReplyAll = (email: any) => {
    openCompose({
      mode: 'replyAll',
      from: email.from,
      toList: parseEmailList(email.toList),
      ccList: parseEmailList(email.ccList),
      subject: email.subject,
      body: email.body,
      date: email.createdAt,
      attachments: email.attachments || []
    })
  }

  const handleForward = (email: any) => {
    openCompose({
      mode: 'forward',
      from: email.from,
      toList: [],
      ccList: [],
      subject: email.subject,
      body: email.body,
      date: email.createdAt,
      attachments: email.attachments || []
    })
  }

  const selectedEmailsData = emails.filter(e => selectedEmailIds.has(e.id))
  const allSelectedRead = selectedEmailsData.length > 0 && selectedEmailsData.every(e => e.isRead)

  return (
    <Layout folder={folder}>
      <div className="flex-1 flex min-h-0">
        <div
          className="w-full md:w-2/5 lg:w-1/3 xl:w-1/4 border-r flex flex-col"
          style={{
            backgroundColor: 'var(--color-bg-secondary)',
            borderRightColor: 'var(--color-border-primary)'
          }}
        >
          <div
            className="border-b px-4 py-2 flex items-center justify-between flex-shrink-0"
            style={{
              backgroundColor: 'var(--color-bg-tertiary)',
              borderBottomColor: 'var(--color-border-primary)'
            }}
          >
            {isSelectMode ? (
              <div className="flex items-center gap-2 w-full">
                <button
                  onClick={handleToggleSelectMode}
                  className="p-1.5 rounded transition-colors"
                  style={{ color: 'var(--color-text-secondary)' }}
                  title={t('cancel')}
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                  {t('selected')}: {selectedEmailIds.size}
                </span>
                <div className="flex-1" />
                {selectedEmailIds.size > 0 && (
                  <>
                    <button
                      onClick={handleBatchDelete}
                      className="flex items-center gap-1 px-2 py-1 text-sm rounded transition-colors"
                      style={{ color: 'var(--color-accent-primary)' }}
                      title={t('delete')}
                    >
                      <Trash className="w-4 h-4" />
                      <span className="hidden sm:inline">{t('delete')}</span>
                    </button>
                    <button
                      onClick={handleBatchToggleRead}
                      className="flex items-center gap-1 px-2 py-1 text-sm rounded transition-colors"
                      style={{ color: 'var(--color-accent-primary)' }}
                      title={allSelectedRead ? t('markAsUnread') : t('markAsRead')}
                    >
                      {allSelectedRead ? (
                        <>
                          <MailOpen className="w-4 h-4" />
                          <span className="hidden sm:inline">{t('markAsUnread')}</span>
                        </>
                      ) : (
                        <>
                          <Mail className="w-4 h-4" />
                          <span className="hidden sm:inline">{t('markAsRead')}</span>
                        </>
                      )}
                    </button>
                  </>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2 w-full">
                <span className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>{t('emails')}</span>
                <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>({pagination.total})</span>
                <div className="flex-1" />
                <button
                  onClick={handleToggleSelectMode}
                  className="flex items-center gap-1 px-2 py-1 text-sm rounded transition-colors"
                  style={{ color: 'var(--color-text-secondary)' }}
                  title={t('select')}
                >
                  <CheckSquare className="w-4 h-4" />
                  <span className="hidden sm:inline">{t('select')}</span>
                </button>
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center h-32">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2" style={{ borderColor: 'var(--color-accent-primary)' }}></div>
              </div>
            ) : (
              <EmailList
                key={`${refreshKey}-${pagination.page}`}
                folder={folder}
                emails={emails}
                onSelectEmail={handleSelectEmail}
                selectedEmailId={selectedEmail?.id}
                isSelectMode={isSelectMode}
                selectedEmailIds={selectedEmailIds}
                onSelectAll={handleSelectAll}
              />
            )}
          </div>

          {pagination.totalPages > 1 && (
            <div
              className="border-t px-4 py-2 flex items-center justify-between flex-shrink-0"
              style={{
                backgroundColor: 'var(--color-bg-tertiary)',
                borderTopColor: 'var(--color-border-primary)'
              }}
            >
              <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                {t('page')} {pagination.page} / {pagination.totalPages}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => handlePageChange(pagination.page - 1)}
                  disabled={pagination.page <= 1}
                  className="p-1.5 rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  style={{ color: 'var(--color-text-secondary)' }}
                  title={t('previous')}
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  onClick={() => handlePageChange(pagination.page + 1)}
                  disabled={pagination.page >= pagination.totalPages}
                  className="p-1.5 rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  style={{ color: 'var(--color-text-secondary)' }}
                  title={t('next')}
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="hidden md:flex flex-1 flex-col min-w-0" style={{ backgroundColor: 'var(--color-bg-primary)' }}>
          {selectedEmail ? (
            <EmailPreviewPanel
              emailId={selectedEmail.id}
              onDelete={handleEmailDeleted}
              onRestore={handleEmailDeleted}
              onToggleStar={handleToggleStar}
              onReply={handleReply}
              onReplyAll={handleReplyAll}
              onForward={handleForward}
              onArchive={() => setRefreshKey(k => k + 1)}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center" style={{ color: 'var(--color-text-tertiary)' }}>
                <Mail className="w-16 h-16 mx-auto mb-4" style={{ color: 'var(--color-text-muted)' }} />
                <p className="text-lg">{t('selectEmailToView')}</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </Layout>
  )
}

interface EmailPreviewPanelProps {
  emailId: string
  onDelete: () => void
  onRestore: () => void
  onToggleStar: (emailId: string, isStarred: boolean) => void
  onReply?: (email: any) => void
  onReplyAll?: (email: any) => void
  onForward?: (email: any) => void
  onArchive?: (emailId: string) => void
}

const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const isImageFile = (mimeType: string, filename: string): boolean => {
  if (mimeType.startsWith('image/')) return true
  const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg']
  const ext = filename.toLowerCase().substring(filename.lastIndexOf('.'))
  return imageExtensions.includes(ext)
}

const getFileExtension = (filename: string): string => {
  const lastDot = filename.lastIndexOf('.')
  return lastDot !== -1 ? filename.substring(lastDot).toLowerCase() : ''
}

const getFileIconColor = (filename: string): string => {
  const ext = getFileExtension(filename)
  const colorMap: Record<string, string> = {
    '.pdf': '#ef4444',
    '.doc': '#3b82f6',
    '.docx': '#3b82f6',
    '.xls': '#22c55e',
    '.xlsx': '#22c55e',
    '.ppt': '#f97316',
    '.pptx': '#f97316',
    '.zip': '#eab308',
    '.rar': '#eab308',
    '.mp3': '#a855f7',
    '.mp4': '#ec4899',
  }
  return colorMap[ext] || 'var(--color-text-tertiary)'
}

function EmailPreviewPanel({
  emailId,
  onDelete,
  onRestore,
  onToggleStar,
  onReply,
  onReplyAll,
  onForward,
  onArchive
}: EmailPreviewPanelProps) {
  const { t } = useI18n()
  const { user } = useAuth()
  const [email, setEmail] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [previewImage, setPreviewImage] = useState<string | null>(null)
  const [copiedEmail, setCopiedEmail] = useState<string | null>(null)
  const [showDetails, setShowDetails] = useState(false)
  const [isStarred, setIsStarred] = useState(false)

  useEffect(() => {
    const fetchEmail = async () => {
      try {
        const token = localStorage.getItem('token')
        const res = await fetch(`/api/emails/${emailId}`, {
          headers: { Authorization: `Bearer ${token}` }
        })

        if (!res.ok) throw new Error('Failed to fetch email')

        const data = await res.json()
        setEmail(data)
        setIsStarred(data.isStarred || false)
      } catch (err) {
        console.error(err)
      } finally {
        setLoading(false)
      }
    }

    fetchEmail()
  }, [emailId])

  const handleDelete = async () => {
    if (!email) return
    setActionLoading(true)

    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/emails/${email.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      })

      if (!res.ok) throw new Error('Failed to delete email')

      onDelete()
    } catch (err) {
      console.error(err)
    } finally {
      setActionLoading(false)
    }
  }

  const handleRestore = async () => {
    if (!email) return
    setActionLoading(true)

    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/emails/${email.id}/restore`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      })

      if (!res.ok) throw new Error('Failed to restore email')

      onRestore()
    } catch (err) {
      console.error(err)
    } finally {
      setActionLoading(false)
    }
  }

  const handleToggleStar = async () => {
    if (!email) return
    const newStarred = !isStarred
    setIsStarred(newStarred)

    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/emails/${email.id}/star`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ isStarred: newStarred })
      })

      if (!res.ok) {
        throw new Error('Failed to update star status')
      }

      onToggleStar(email.id, newStarred)
    } catch (err) {
      console.error(err)
      setIsStarred(!newStarred)
    }
  }

  const handleArchive = async () => {
    if (!email) return

    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/emails/${email.id}/archive`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      })

      if (!res.ok) throw new Error('Failed to archive email')

      onArchive?.(email.id)
    } catch (err) {
      console.error(err)
    }
  }

  const getAttachmentUrl = (attachmentId: string): string => {
    const token = localStorage.getItem('token')
    return `/api/attachments/${attachmentId}?token=${token}`
  }

  const handleDownload = async (attachmentId: string) => {
    const token = localStorage.getItem('token')
    const res = await fetch(`/api/attachments/${attachmentId}`, {
      headers: { Authorization: `Bearer ${token}` }
    })

    if (res.ok) {
      const blob = await res.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = email?.attachments.find((a: Attachment) => a.id === attachmentId)?.originalName || 'download'
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
    }
  }

  const handleImagePreview = (attachmentId: string) => {
    const url = getAttachmentUrl(attachmentId)
    setPreviewImage(url)
  }

  const handleCopyEmail = async (emailAddress: string) => {
    try {
      await navigator.clipboard.writeText(emailAddress)
      setCopiedEmail(emailAddress)
      setTimeout(() => setCopiedEmail(null), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  const parseEmailList = (list: string | null): string[] => {
    if (!list) return []
    try {
      return JSON.parse(list)
    } catch {
      return []
    }
  }

  const isCurrentUser = (emailAddress: string): boolean => {
    return user?.email?.toLowerCase() === emailAddress.toLowerCase()
  }

  const renderEmailTag = (emailAddress: string, bgColor: string, textColor: string) => {
    const isMe = isCurrentUser(emailAddress)
    const isCopied = copiedEmail === emailAddress

    return (
      <span
        key={emailAddress}
        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium cursor-pointer transition-all group"
        style={{
          backgroundColor: isMe ? 'var(--color-text-primary)' : bgColor,
          color: isMe ? 'var(--color-bg-primary)' : textColor
        }}
        onClick={() => handleCopyEmail(emailAddress)}
        title={t('clickToCopy')}
      >
        {emailAddress}
        {isMe && <span className="ml-0.5 text-[10px] opacity-70">(me)</span>}
        {isCopied ? (
          <CheckIcon className="w-3 h-3 opacity-70" />
        ) : (
          <Copy className="w-3 h-3 opacity-0 group-hover:opacity-50 transition-opacity" />
        )}
      </span>
    )
  }

  const renderRecipientRow = (label: string, emails: string[], icon: React.ReactNode, color: string) => {
    if (emails.length === 0) return null

    return (
      <div className="flex items-center gap-3 py-1.5">
        <div className="flex items-center gap-1.5 shrink-0 w-14" style={{ color }}>
          <span className="flex-shrink-0">{icon}</span>
          <span className="text-xs font-medium whitespace-nowrap">{label}</span>
        </div>
        <div className="flex flex-wrap gap-1.5 items-center">
          {emails.map(emailAddr => renderEmailTag(emailAddr, `${color}20`, color))}
        </div>
      </div>
    )
  }

  const getAvatarColor = (emailAddress: string): { bg: string; text: string } => {
    const colors = [
      { bg: '#fee2e2', text: '#dc2626' },
      { bg: '#ffedd5', text: '#ea580c' },
      { bg: '#fef3c7', text: '#d97706' },
      { bg: '#fef9c3', text: '#ca8a04' },
      { bg: '#ecfccb', text: '#65a30d' },
      { bg: '#dcfce7', text: '#16a34a' },
      { bg: '#d1fae5', text: '#059669' },
      { bg: '#ccfbf1', text: '#0d9488' },
      { bg: '#cffafe', text: '#0891b2' },
      { bg: '#e0f2fe', text: '#0284c7' },
      { bg: '#dbeafe', text: '#2563eb' },
      { bg: '#e0e7ff', text: '#4f46e5' },
      { bg: '#ede9fe', text: '#7c3aed' },
      { bg: '#f3e8ff', text: '#9333ea' },
      { bg: '#fae8ff', text: '#c026d3' },
      { bg: '#fce7f3', text: '#db2777' },
    ]
    let hash = 0
    for (let i = 0; i < emailAddress.length; i++) {
      hash = emailAddress.charCodeAt(i) + ((hash << 5) - hash)
    }
    return colors[Math.abs(hash) % colors.length]
  }

  const formatDate = (dateString: string): string => {
    const date = new Date(dateString)
    const now = new Date()
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24))

    if (diffDays === 0) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    } else if (diffDays === 1) {
      return t('yesterday') + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    } else if (diffDays < 7) {
      return date.toLocaleDateString([], { weekday: 'long' }) + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    } else {
      return date.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' })
    }
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--color-accent-primary)' }} />
      </div>
    )
  }

  if (!email) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p style={{ color: 'var(--color-text-tertiary)' }}>{t('emailNotFound')}</p>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center justify-between px-5 py-3 border-b flex-shrink-0"
        style={{
          borderColor: 'var(--color-border-secondary)',
          backgroundColor: 'var(--color-bg-secondary)'
        }}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <button
            onClick={handleToggleStar}
            className="p-1.5 rounded-lg transition-colors flex-shrink-0"
            style={{
              color: isStarred ? '#eab308' : 'var(--color-text-quaternary)',
              backgroundColor: isStarred ? 'rgba(234, 179, 8, 0.1)' : 'transparent'
            }}
            title={isStarred ? t('unstar') : t('star')}
          >
            {isStarred ? <StarOff className="w-5 h-5 fill-current" /> : <Star className="w-5 h-5" />}
          </button>
          <h2 className="text-lg font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>{email.subject}</h2>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {email.folder === 'TRASH' && (
            <button
              onClick={handleRestore}
              disabled={actionLoading}
              className="p-2 rounded-lg transition-colors"
              style={{ color: 'var(--color-text-quaternary)' }}
              title={t('restore')}
            >
              {actionLoading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <RotateCcw className="w-5 h-5" />
              )}
            </button>
          )}
          <button
            onClick={handleDelete}
            disabled={actionLoading}
            className="p-2 rounded-lg transition-colors"
            style={{ color: 'var(--color-text-quaternary)' }}
            title={t('delete')}
          >
            {actionLoading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Trash className="w-5 h-5" />
            )}
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        <div>
          {/* Sender info */}
          <div className="p-5 border-b" style={{ borderColor: 'var(--color-border-secondary)' }}>
            <div className="flex items-start gap-3">
              <div
                className="w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 font-medium text-sm"
                style={{
                  backgroundColor: getAvatarColor(email.from).bg,
                  color: getAvatarColor(email.from).text
                }}
              >
                {(email.fromName || email.from).charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-2">
                  <span className="font-medium" style={{ color: 'var(--color-text-primary)' }}>
                    {email.fromName ? `${email.fromName} <${email.from}>` : email.from}
                  </span>
                  <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                    {formatDate(email.createdAt)}
                  </span>
                </div>

                <div className="text-sm mt-1">
                  <button
                    onClick={() => setShowDetails(!showDetails)}
                    className="inline-flex items-center gap-1 transition-colors"
                    style={{ color: 'var(--color-text-tertiary)' }}
                  >
                    <span className="inline-flex items-center gap-1.5">
                      {(() => {
                        const toList = parseEmailList(email.toList)
                        const ccList = parseEmailList(email.ccList)
                        const bccList = parseEmailList(email.bccList)

                        if (toList.length > 0) {
                          return (
                            <>
                              <span style={{ color: 'var(--color-text-quaternary)' }}>{t('to')}:</span>
                              <span style={{ color: 'var(--color-text-secondary)' }}>{toList.slice(0, 2).join(', ')}{toList.length > 2 && ` +${toList.length - 2}`}</span>
                            </>
                          )
                        } else if (ccList.length > 0) {
                          return (
                            <>
                              <span style={{ color: 'var(--color-text-quaternary)' }}>{t('cc')}:</span>
                              <span style={{ color: 'var(--color-text-secondary)' }}>{ccList.slice(0, 2).join(', ')}{ccList.length > 2 && ` +${ccList.length - 2}`}</span>
                            </>
                          )
                        } else if (bccList.length > 0) {
                          return (
                            <>
                              <span style={{ color: 'var(--color-text-quaternary)' }}>{t('bcc')}:</span>
                              <span style={{ color: 'var(--color-text-secondary)' }}>{bccList.slice(0, 2).join(', ')}{bccList.length > 2 && ` +${bccList.length - 2}`}</span>
                            </>
                          )
                        } else {
                          return <span style={{ color: 'var(--color-text-quaternary)' }}>{t('noRecipientsDisplay')}</span>
                        }
                      })()}
                    </span>
                    {showDetails ? <ChevronUp className="w-4 h-4 ml-1" /> : <ChevronDown className="w-4 h-4 ml-1" />}
                  </button>

                  {showDetails && (
                    <div className="mt-3 pt-3 border-t" style={{ borderColor: 'var(--color-border-secondary)' }}>
                      {renderRecipientRow(
                        t('to'),
                        parseEmailList(email.toList),
                        <Mail className="w-3.5 h-3.5" />,
                        '#16a34a'
                      )}
                      {renderRecipientRow(
                        t('cc'),
                        parseEmailList(email.ccList),
                        <Users className="w-3.5 h-3.5" />,
                        '#2563eb'
                      )}
                      {renderRecipientRow(
                        t('bcc'),
                        parseEmailList(email.bccList),
                        <EyeOff className="w-3.5 h-3.5" />,
                        '#dc2626'
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Attachments */}
          {email.attachments && email.attachments.length > 0 && (
            <div className="px-5 pt-5">
              <div className="border rounded-xl overflow-hidden" style={{ borderColor: 'var(--color-border-primary)' }}>
                <div
                  className="px-4 py-2.5 border-b flex items-center gap-2"
                  style={{
                    borderColor: 'var(--color-border-primary)',
                    backgroundColor: 'var(--color-bg-tertiary)'
                  }}
                >
                  <Paperclip className="w-4 h-4" style={{ color: 'var(--color-text-tertiary)' }} />
                  <span className="text-sm font-medium" style={{ color: 'var(--color-text-secondary)' }}>{t('attachments')} ({email.attachments.length})</span>
                </div>
                <div className="p-3 space-y-2">
                  {email.attachments.map((attachment: Attachment) => {
                    const isImage = isImageFile(attachment.mimeType, attachment.originalName)
                    const iconColor = isImage ? '#3b82f6' : getFileIconColor(attachment.originalName)

                    return (
                      <div
                        key={attachment.id}
                        className="flex items-center gap-3 p-2.5 rounded-lg transition-colors group"
                        style={{ backgroundColor: 'var(--color-bg-tertiary)' }}
                      >
                        <div
                          className="w-10 h-10 rounded-lg border flex items-center justify-center shrink-0 overflow-hidden"
                          style={{
                            backgroundColor: 'var(--color-bg-secondary)',
                            borderColor: 'var(--color-border-secondary)'
                          }}
                        >
                          {isImage ? (
                            <img
                              src={getAttachmentUrl(attachment.id)}
                              alt={attachment.originalName}
                              className="w-full h-full object-cover cursor-pointer"
                              onClick={() => handleImagePreview(attachment.id)}
                            />
                          ) : (
                            <Paperclip className="w-5 h-5" style={{ color: iconColor }} />
                          )}
                        </div>

                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate" style={{ color: 'var(--color-text-primary)' }}>
                            {attachment.originalName}
                          </p>
                          <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                            {formatFileSize(attachment.size)}
                          </p>
                        </div>

                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          {isImage && (
                            <button
                              onClick={() => handleImagePreview(attachment.id)}
                              className="p-1.5 rounded-lg transition-colors"
                              style={{ color: 'var(--color-text-quaternary)' }}
                              title={t('preview')}
                            >
                              <ZoomIn className="w-4 h-4" />
                            </button>
                          )}
                          <button
                            onClick={() => handleDownload(attachment.id)}
                            className="p-1.5 rounded-lg transition-colors"
                            style={{ color: 'var(--color-text-quaternary)' }}
                            title={t('download')}
                          >
                            <Download className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Body */}
          <div className="p-5">
            <EmailBody content={email.body} className="leading-relaxed text-[15px]" style={{ color: 'var(--color-text-secondary)' }} />
          </div>
        </div>
      </div>

      {/* Footer actions */}
      <div
        className="border-t px-4 py-2.5 flex items-center justify-between flex-shrink-0"
        style={{
          borderColor: 'var(--color-border-secondary)',
          backgroundColor: 'var(--color-bg-secondary)'
        }}
      >
        <div className="flex items-center gap-1">
          <button
            onClick={() => onReply?.(email)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors"
            style={{ color: 'var(--color-text-secondary)' }}
            title={t('reply')}
          >
            <Reply className="w-4 h-4" />
            <span className="hidden sm:inline">{t('reply')}</span>
          </button>
          <button
            onClick={() => onReplyAll?.(email)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors"
            style={{ color: 'var(--color-text-secondary)' }}
            title={t('replyAll')}
          >
            <ReplyAll className="w-4 h-4" />
            <span className="hidden sm:inline">{t('replyAll')}</span>
          </button>
          <button
            onClick={() => onForward?.(email)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors"
            style={{ color: 'var(--color-text-secondary)' }}
            title={t('forward')}
          >
            <Forward className="w-4 h-4" />
            <span className="hidden sm:inline">{t('forward')}</span>
          </button>
        </div>

        <div className="flex items-center gap-1">
          {email.folder !== 'ARCHIVED' && (
            <button
              onClick={handleArchive}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors"
              style={{ color: 'var(--color-text-secondary)' }}
              title={t('archive')}
            >
              <Archive className="w-4 h-4" />
              <span className="hidden sm:inline">{t('archive')}</span>
            </button>
          )}
        </div>
      </div>

      {/* Image preview modal */}
      {previewImage && (
        <div
          className="fixed inset-0 bg-black/90 flex items-center justify-center p-4 z-50"
          onClick={() => setPreviewImage(null)}
        >
          <button
            onClick={() => setPreviewImage(null)}
            className="absolute top-4 right-4 p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
          <img
            src={previewImage}
            alt="Preview"
            className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  )
}