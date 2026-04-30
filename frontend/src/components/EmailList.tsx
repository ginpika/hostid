/**
 * 邮件列表组件
 * 显示邮件列表，支持选择模式、未读/星标状态显示
 * 用于收件箱和归档页面
 */
import { Mail, Paperclip, CheckSquare, Square, Star } from 'lucide-react'
import { useI18n } from '../i18n/I18nContext'

interface Attachment {
  id: string
  filename: string
  originalName: string
  mimeType: string
  size: number
}

interface Email {
  id: string
  from: string
  fromName?: string | null
  to: string
  subject: string
  body: string
  summary: string | null
  folder: string
  isRead: boolean
  isStarred?: boolean
  createdAt: string
  attachments?: Attachment[]
}

interface EmailListProps {
  folder: string
  emails: Email[]
  onSelectEmail: (email: Email) => void
  selectedEmailId?: string
  isSelectMode?: boolean
  selectedEmailIds?: Set<string>
  onSelectAll?: (emailIds: string[]) => void
}

export default function EmailList({ 
  folder, 
  emails,
  onSelectEmail, 
  selectedEmailId,
  isSelectMode = false,
  selectedEmailIds = new Set(),
  onSelectAll
}: EmailListProps) {
  const { t } = useI18n()

  if (emails.length === 0) {
    return (
      <div 
        className="flex flex-col items-center justify-center h-64"
        style={{ color: 'var(--color-text-tertiary)' }}
      >
        <Mail className="w-12 h-12 mb-3" style={{ color: 'var(--color-text-quaternary)' }} />
        <p>{t('noEmails')}</p>
      </div>
    )
  }

  const allSelected = emails.length > 0 && emails.every(e => selectedEmailIds.has(e.id))

  const formatSender = (email: Email, folder: string): string => {
    if (folder === 'SENT') {
      return `To: ${email.to}`
    }
    return email.fromName || email.from
  }

  const formatEmailDate = (dateString: string): string => {
    const date = new Date(dateString)
    const today = new Date()
    
    if (
      date.getFullYear() === today.getFullYear() &&
      date.getMonth() === today.getMonth() &&
      date.getDate() === today.getDate()
    ) {
      return date.toLocaleTimeString('en-US', { 
        hour: 'numeric', 
        minute: '2-digit',
        hour12: true
      })
    }
    
    return date.toLocaleDateString()
  }

  return (
    <div>
      {isSelectMode && (
        <div 
          onClick={() => onSelectAll?.(emails.map(e => e.id))}
          className="border-b cursor-pointer transition-colors"
          style={{ 
            borderColor: 'var(--color-border-secondary)',
            backgroundColor: 'var(--color-bg-tertiary)'
          }}
          onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--color-bg-hover)'}
          onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'var(--color-bg-tertiary)'}
        >
          <div className="pl-4 pr-4 py-2 border-l-4 border-l-transparent flex items-center gap-3">
            <div className="w-4 h-4 flex items-center justify-center flex-shrink-0">
              {allSelected ? (
                <CheckSquare className="w-4 h-4" style={{ color: 'var(--color-accent-primary)' }} />
              ) : (
                <Square className="w-4 h-4" style={{ color: 'var(--color-text-quaternary)' }} />
              )}
            </div>
            <div className="w-2 flex-shrink-0" />
            <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>{t('selectAll')}</span>
          </div>
        </div>
      )}
      
      {emails.map(email => {
        const isSelected = email.id === selectedEmailId
        const isChecked = selectedEmailIds.has(email.id)
        
        return (
          <div
            key={email.id}
            onClick={() => onSelectEmail(email)}
            className="border-b cursor-pointer transition-colors"
            style={{ 
              borderColor: 'var(--color-border-secondary)',
              backgroundColor: (isSelectMode && isChecked) || isSelected 
                ? 'var(--color-accent-muted)' 
                : 'transparent'
            }}
            onMouseEnter={(e) => {
              if (!(isSelectMode && isChecked) && !isSelected) {
                e.currentTarget.style.backgroundColor = 'var(--color-bg-hover)'
              }
            }}
            onMouseLeave={(e) => {
              if (!(isSelectMode && isChecked) && !isSelected) {
                e.currentTarget.style.backgroundColor = 'transparent'
              }
            }}
          >
            <div 
              className="pl-4 pr-4 py-3"
              style={{ 
                borderLeftWidth: '4px',
                borderLeftStyle: 'solid',
                borderLeftColor: isSelected && !isSelectMode 
                  ? 'var(--color-accent-primary)' 
                  : 'transparent'
              }}
            >
              <div className="flex items-start gap-3">
                {isSelectMode && (
                  <div className="w-4 h-4 mt-0.5 flex items-center justify-center flex-shrink-0">
                    {isChecked ? (
                      <CheckSquare className="w-4 h-4" style={{ color: 'var(--color-accent-primary)' }} />
                    ) : (
                      <Square className="w-4 h-4" style={{ color: 'var(--color-text-quaternary)' }} />
                    )}
                  </div>
                )}
                <div 
                  className={`w-2 h-2 mt-2 rounded-full flex-shrink-0 ${email.isRead ? 'border' : ''}`}
                  style={{ 
                    backgroundColor: email.isRead ? 'transparent' : 'var(--color-accent-primary)',
                    borderColor: email.isRead ? 'var(--color-text-quaternary)' : 'transparent'
                  }} 
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-0.5">
                    <div className="flex items-center gap-1.5 min-w-0">
                      {email.isStarred && (
                        <Star className="w-3.5 h-3.5 text-yellow-500 fill-yellow-500 flex-shrink-0" />
                      )}
                      <span 
                        className="text-sm truncate"
                        style={{ 
                          color: email.isRead ? 'var(--color-text-secondary)' : 'var(--color-text-primary)',
                          fontWeight: email.isRead ? 'normal' : '600'
                        }}
                      >
                        {formatSender(email, folder)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {email.attachments && email.attachments.length > 0 && (
                        <Paperclip className="w-3 h-3" style={{ color: 'var(--color-text-quaternary)' }} />
                      )}
                      <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                        {formatEmailDate(email.createdAt)}
                      </span>
                    </div>
                  </div>
                  <h3 
                    className="text-sm mb-0.5 truncate"
                    style={{ 
                      color: email.isRead ? 'var(--color-text-secondary)' : 'var(--color-text-primary)',
                      fontWeight: email.isRead ? 'normal' : '600'
                    }}
                  >
                    {email.subject}
                  </h3>
                </div>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
