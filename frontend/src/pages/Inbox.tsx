import { useState, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { Maximize2, CheckSquare, Trash, Mail, MailOpen, ChevronLeft, ChevronRight } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useI18n } from '../i18n/I18nContext'
import { useCompose } from '../contexts/ComposeContext'
import Layout from '../components/Layout'
import EmailList from '../components/EmailList'
import EmailDetail from '../components/EmailDetail'
import EmailBody from '../components/EmailBody'

type Folder = 'INBOX' | 'SENT' | 'TRASH'

interface Pagination {
  page: number
  limit: number
  total: number
  totalPages: number
}

export default function InboxPage() {
  const location = useLocation()
  const { t } = useI18n()
  const { openCompose } = useCompose()
  const [selectedEmail, setSelectedEmail] = useState<any>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [showDetailModal, setShowDetailModal] = useState(false)
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
      setShowDetailModal(false)
      
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
    setShowDetailModal(false)
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
    setShowDetailModal(false)
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
    setShowDetailModal(false)
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
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
              <div 
                className="px-4 py-3 flex items-center justify-between flex-shrink-0"
                style={{ 
                  backgroundColor: 'var(--color-bg-secondary)',
                  borderBottom: '1px solid var(--color-border-primary)'
                }}
              >
                <h2 className="text-lg font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>{selectedEmail.subject}</h2>
                <button
                  onClick={() => setShowDetailModal(true)}
                  className="p-2 rounded-lg transition-colors flex-shrink-0"
                  style={{ color: 'var(--color-text-muted)' }}
                  title={t('openInNewWindow')}
                >
                  <Maximize2 className="w-5 h-5" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-4">
                <EmailPreviewPanel emailId={selectedEmail.id} />
              </div>
            </div>
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

      {showDetailModal && selectedEmail && (
        <EmailDetail
          emailId={selectedEmail.id}
          onClose={() => setShowDetailModal(false)}
          onDelete={handleEmailDeleted}
          onRestore={handleEmailDeleted}
          onToggleStar={handleToggleStar}
          onReply={handleReply}
          onReplyAll={handleReplyAll}
          onForward={handleForward}
          onArchive={() => setRefreshKey(k => k + 1)}
        />
      )}
    </Layout>
  )
}

function EmailPreviewPanel({ emailId }: { emailId: string }) {
  const { t } = useI18n()
  const { user } = useAuth()
  const [email, setEmail] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchEmail = async () => {
      try {
        const token = localStorage.getItem('token')
        const res = await fetch(`/api/emails/${emailId}`, {
          headers: { Authorization: `Bearer ${token}` }
        })
        
        if (res.ok) {
          const data = await res.json()
          setEmail(data)
        }
      } catch (err) {
        console.error(err)
      } finally {
        setLoading(false)
      }
    }

    fetchEmail()
  }, [emailId])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: 'var(--color-accent-primary)' }}></div>
      </div>
    )
  }

  if (!email) {
    return <p className="text-center" style={{ color: 'var(--color-text-tertiary)' }}>{t('emailNotFound')}</p>
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

  const renderEmailTag = (emailAddress: string, colorClass: string) => {
    const isMe = isCurrentUser(emailAddress)
    
    return (
      <span
        key={emailAddress}
        className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium"
        style={{
          backgroundColor: isMe ? 'var(--color-text-primary)' : `color-mix(in srgb, ${colorClass} 15%, transparent)`,
          color: isMe ? 'var(--color-bg-secondary)' : colorClass
        }}
      >
        {emailAddress}
        {isMe && <span className="ml-0.5 text-[10px] opacity-70">(me)</span>}
      </span>
    )
  }

  return (
    <div className="rounded-xl shadow-sm border h-full flex flex-col" style={{ backgroundColor: 'var(--color-bg-secondary)', borderColor: 'var(--color-border-primary)' }}>
      <div className="p-4 border-b flex-shrink-0" style={{ borderColor: 'var(--color-border-primary)' }}>
        <div className="flex items-start gap-3 mb-3">
          <div 
            className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: 'color-mix(in srgb, var(--color-accent-primary) 15%, transparent)' }}
          >
            <span className="font-medium text-sm" style={{ color: 'var(--color-accent-primary)' }}>
              {(email.fromName || email.from).charAt(0).toUpperCase()}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <span className="font-medium" style={{ color: 'var(--color-text-primary)' }}>
                {email.fromName ? `${email.fromName} <${email.from}>` : email.from}
              </span>
              <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                {new Date(email.createdAt).toLocaleString()}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 text-sm mt-1">
              {(() => {
                const toList = parseEmailList(email.toList)
                const ccList = parseEmailList(email.ccList)
                const bccList = parseEmailList(email.bccList)
                
                if (toList.length > 0) {
                  return (
                    <>
                      <span style={{ color: 'var(--color-text-tertiary)' }}>{t('to')}:</span>
                      {toList.map(e => renderEmailTag(e, 'var(--color-accent-primary)'))}
                      {ccList.length > 0 && (
                        <>
                          <span style={{ color: 'var(--color-text-tertiary)' }}>{t('cc')}:</span>
                          {ccList.map(e => renderEmailTag(e, 'var(--color-accent-secondary)'))}
                        </>
                      )}
                    </>
                  )
                } else if (ccList.length > 0) {
                  return (
                    <>
                      <span style={{ color: 'var(--color-text-tertiary)' }}>{t('cc')}:</span>
                      {ccList.map(e => renderEmailTag(e, 'var(--color-accent-secondary)'))}
                    </>
                  )
                } else if (bccList.length > 0) {
                  return (
                    <>
                      <span style={{ color: 'var(--color-text-tertiary)' }}>{t('bcc')}:</span>
                      {bccList.map(e => renderEmailTag(e, 'var(--color-accent-primary)'))}
                    </>
                  )
                } else {
                  return <span style={{ color: 'var(--color-text-muted)' }}>{t('noRecipientsDisplay')}</span>
                }
              })()}
            </div>
          </div>
        </div>
      </div>
      
      {email.summary && (
        <div className="px-4 py-3 border-b flex-shrink-0" style={{ backgroundColor: 'var(--color-bg-tertiary)', borderColor: 'var(--color-border-primary)' }}>
          <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>{email.summary}</p>
        </div>
      )}
      
      <div className="flex-1 p-4 overflow-y-auto">
        <EmailBody content={email.body} className="leading-relaxed" style={{ color: 'var(--color-text-secondary)' }} />
      </div>
      
      {email.attachments && email.attachments.length > 0 && (
        <div className="p-4 border-t flex-shrink-0" style={{ backgroundColor: 'var(--color-bg-tertiary)', borderColor: 'var(--color-border-primary)' }}>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-sm font-medium" style={{ color: 'var(--color-text-secondary)' }}>{t('attachments')} ({email.attachments.length})</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {email.attachments.map((att: any) => (
              <div
                key={att.id}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm"
                style={{ 
                  backgroundColor: 'var(--color-bg-secondary)',
                  borderColor: 'var(--color-border-secondary)'
                }}
              >
                <span className="truncate max-w-[150px]" style={{ color: 'var(--color-text-primary)' }}>{att.originalName}</span>
                <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  {att.size < 1024 ? `${att.size} B` : att.size < 1024 * 1024 ? `${(att.size / 1024).toFixed(1)} KB` : `${(att.size / (1024 * 1024)).toFixed(1)} MB`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
