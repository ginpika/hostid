/**
 * 收件人输入组件
 * 支持添加多个收件人，包含 to/cc/bcc 三种类型
 * 提供用户名验证和重复检测
 */
import React, { useState, useRef } from 'react'
import { X, ChevronDown, Plus, Mail, Users, EyeOff } from 'lucide-react'
import { useI18n } from '../i18n/I18nContext'

export type RecipientType = 'to' | 'cc' | 'bcc'

export interface Recipient {
  id: string
  username: string
  email: string
  type: RecipientType
}

interface RecipientInputProps {
  recipients: Recipient[]
  onChange: (recipients: Recipient[]) => void
  domain: string
  maxRecipients?: number
}

const typeConfig = {
  to: {
    icon: Mail,
    label: 'to' as const
  },
  cc: {
    icon: Users,
    label: 'cc' as const
  },
  bcc: {
    icon: EyeOff,
    label: 'bcc' as const
  }
}

export default function RecipientInput({ recipients, onChange, domain, maxRecipients = 50 }: RecipientInputProps) {
  const { t } = useI18n()
  const [inputValue, setInputValue] = useState('')
  const [showTypeMenu, setShowTypeMenu] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [showAddModal, setShowAddModal] = useState(false)
  const [modalInput, setModalInput] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const usernameRegex = /^[a-zA-Z0-9._]+$/

  const validateUsername = (username: string): boolean => {
    return usernameRegex.test(username) && username.length >= 3 && username.length <= 30
  }

  const parseInput = (input: string): { username: string; email: string; valid: boolean }[] => {
    const parts = input.split(/[,，]/).map(s => s.trim()).filter(s => s)
    
    return parts.map(part => {
      let email: string
      let username: string
      
      if (part.includes('@')) {
        email = part.toLowerCase()
        username = part.split('@')[0]
      } else {
        username = part
        email = `${part}@${domain}`
      }
      
      return {
        username,
        email,
        valid: validateUsername(username)
      }
    })
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setInputValue(value)
    setError('')
    
    if (value.includes(',') || value.includes('，')) {
      addRecipientsFromInput(value)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && inputValue.trim()) {
      e.preventDefault()
      addRecipientsFromInput(inputValue)
    } else if (e.key === 'Backspace' && !inputValue && recipients.length > 0) {
      const lastRecipient = recipients[recipients.length - 1]
      removeRecipient(lastRecipient.id)
    }
  }

  const handleBlur = () => {
    setTimeout(() => {
      if (inputValue.trim()) {
        addRecipientsFromInput(inputValue)
      }
    }, 100)
  }

  const addRecipientsFromInput = (input: string) => {
    const parsed = parseInput(input)
    const validRecipients: Recipient[] = []
    const invalidUsernames: string[] = []
    
    for (const item of parsed) {
      if (!item.valid) {
        invalidUsernames.push(item.username)
        continue
      }
      
      if (recipients.some(r => r.email === item.email)) {
        continue
      }
      
      if (recipients.length + validRecipients.length >= maxRecipients) {
        setError(t('maxRecipientsReached'))
        break
      }
      
      validRecipients.push({
        id: `${Date.now()}-${Math.random()}`,
        username: item.username,
        email: item.email,
        type: 'to'
      })
    }
    
    if (invalidUsernames.length > 0) {
      setError(`${t('invalidUsernames')}: ${invalidUsernames.join(', ')}`)
    }
    
    if (validRecipients.length > 0) {
      onChange([...recipients, ...validRecipients])
    }
    
    setInputValue('')
  }

  const addSingleRecipient = () => {
    if (!modalInput.trim()) return
    
    const parsed = parseInput(modalInput)
    const validRecipients: Recipient[] = []
    
    for (const item of parsed) {
      if (!item.valid) {
        setError(`${t('invalidUsername')}: ${item.username}`)
        return
      }
      
      if (recipients.some(r => r.email === item.email)) {
        setError(`${t('duplicateEmail')}: ${item.email}`)
        return
      }
      
      if (recipients.length + validRecipients.length >= maxRecipients) {
        setError(t('maxRecipientsReached'))
        break
      }
      
      validRecipients.push({
        id: `${Date.now()}-${Math.random()}`,
        username: item.username,
        email: item.email,
        type: 'to'
      })
    }
    
    if (validRecipients.length > 0) {
      onChange([...recipients, ...validRecipients])
      setModalInput('')
      setShowAddModal(false)
      setError('')
    }
  }

  const removeRecipient = (id: string) => {
    onChange(recipients.filter(r => r.id !== id))
  }

  const changeRecipientType = (e: React.MouseEvent, id: string, newType: RecipientType) => {
    e.preventDefault()
    e.stopPropagation()
    onChange(recipients.map(r => 
      r.id === id ? { ...r, type: newType } : r
    ))
    setShowTypeMenu(null)
  }

  const handleTypeMenuToggle = (e: React.MouseEvent, id: string) => {
    e.preventDefault()
    e.stopPropagation()
    setShowTypeMenu(showTypeMenu === id ? null : id)
  }

  const handleRemoveClick = (e: React.MouseEvent, id: string) => {
    e.preventDefault()
    e.stopPropagation()
    removeRecipient(id)
  }

  const getTypeColor = (type: RecipientType) => {
    switch (type) {
      case 'to': return { bg: 'rgba(34, 197, 94, 0.1)', text: '#22c55e', border: 'rgba(34, 197, 94, 0.3)' }
      case 'cc': return { bg: 'rgba(59, 130, 246, 0.1)', text: '#3b82f6', border: 'rgba(59, 130, 246, 0.3)' }
      case 'bcc': return { bg: 'rgba(239, 68, 68, 0.1)', text: '#ef4444', border: 'rgba(239, 68, 68, 0.3)' }
    }
  }

  const renderRecipientTag = (recipient: Recipient) => {
    const colors = getTypeColor(recipient.type)
    
    return (
      <div
        key={recipient.id}
        className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-sm border relative"
        style={{ 
          backgroundColor: colors.bg,
          color: colors.text,
          borderColor: colors.border
        }}
      >
        <span className="font-medium">{recipient.email}</span>
        <button
          type="button"
          onClick={(e) => handleTypeMenuToggle(e, recipient.id)}
          className="ml-1 hover:opacity-70 flex items-center"
        >
          <ChevronDown className="w-3 h-3" />
        </button>
        <button
          type="button"
          onClick={(e) => handleRemoveClick(e, recipient.id)}
          className="hover:opacity-70 ml-1"
        >
          <X className="w-3 h-3" />
        </button>
        
        {showTypeMenu === recipient.id && (
          <div 
            className="absolute top-full left-0 mt-1 rounded-lg shadow-lg py-1 z-20 border min-w-[140px]"
            style={{ 
              backgroundColor: 'var(--color-bg-secondary)',
              borderColor: 'var(--color-border-primary)'
            }}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
            }}
          >
            <div 
              className="px-3 py-1 text-xs border-b"
              style={{ 
                color: 'var(--color-text-tertiary)',
                borderColor: 'var(--color-border-primary)'
              }}
            >
              {t('changeType')}
            </div>
            {(['to', 'cc', 'bcc'] as RecipientType[]).map(type => {
              const TypeIcon = typeConfig[type].icon
              const isActive = recipient.type === type
              return (
                <button
                  type="button"
                  key={type}
                  onClick={(e) => changeRecipientType(e, recipient.id, type)}
                  className="w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 transition-colors"
                  style={{ 
                    color: isActive ? 'var(--color-accent-primary)' : 'var(--color-text-secondary)',
                    backgroundColor: isActive ? 'var(--color-bg-tertiary)' : 'transparent'
                  }}
                >
                  <TypeIcon className="w-3 h-3" />
                  {t(typeConfig[type].label)}
                </button>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {error && (
        <div 
          className="p-2 rounded-lg text-sm"
          style={{ 
            backgroundColor: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            color: '#ef4444'
          }}
        >
          {error}
        </div>
      )}
      
      {recipients.length > 0 && (
        <div 
          className="p-3 rounded-lg border"
          style={{ 
            backgroundColor: 'var(--color-bg-tertiary)',
            borderColor: 'var(--color-border-primary)'
          }}
        >
          <div className="flex items-center gap-2 mb-2">
            <Users className="w-4 h-4" style={{ color: 'var(--color-text-tertiary)' }} />
            <span className="text-sm font-medium" style={{ color: 'var(--color-text-secondary)' }}>{t('recipients')}</span>
            <span className="text-xs" style={{ color: 'var(--color-text-quaternary)' }}>({recipients.length})</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {recipients.map(renderRecipientTag)}
          </div>
        </div>
      )}
      
      <div className="flex gap-2">
        <div className="flex-1 relative">
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onBlur={handleBlur}
            className="w-full px-4 py-2.5 rounded-lg border text-sm transition-colors focus:outline-none focus:ring-2 pr-24"
            style={{ 
              backgroundColor: 'var(--color-bg-primary)',
              borderColor: 'var(--color-border-primary)',
              color: 'var(--color-text-primary)'
            }}
            placeholder={t('recipientPlaceholder')}
          />
          <span 
            className="absolute right-3 top-1/2 -translate-y-1/2 text-sm"
            style={{ color: 'var(--color-text-quaternary)' }}
          >
            @{domain}
          </span>
        </div>
        
        <button
          type="button"
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          style={{ 
            color: 'var(--color-text-secondary)',
            backgroundColor: 'var(--color-bg-tertiary)'
          }}
        >
          <Plus className="w-4 h-4" />
          {t('addRecipient')}
        </button>
      </div>
      
      <p className="text-xs" style={{ color: 'var(--color-text-quaternary)' }}>
        {t('recipientHint')} ({recipients.length}/{maxRecipients})
      </p>
      
      {showAddModal && (
        <div 
          className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50" 
          onClick={() => { setShowAddModal(false); setModalInput(''); setError(''); }}
        >
          <div 
            className="rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
            style={{ backgroundColor: 'var(--color-bg-secondary)' }}
            onClick={e => e.stopPropagation()}
          >
            <div 
              className="flex items-center justify-between p-4 border-b"
              style={{ borderColor: 'var(--color-border-primary)' }}
            >
              <h3 className="text-lg font-semibold" style={{ color: 'var(--color-text-primary)' }}>{t('addRecipient')}</h3>
              <button
                type="button"
                onClick={() => {
                  setShowAddModal(false)
                  setModalInput('')
                  setError('')
                }}
                className="p-2 rounded-lg transition-colors hover:bg-[var(--color-bg-tertiary)]"
                style={{ color: 'var(--color-text-quaternary)' }}
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-4 space-y-4">
              {error && (
                <div 
                  className="p-2 rounded-lg text-sm"
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
                  className="block text-sm font-medium mb-1"
                  style={{ color: 'var(--color-text-secondary)' }}
                >
                  {t('username')}
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={modalInput}
                    onChange={(e) => setModalInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        addSingleRecipient()
                      }
                    }}
                    className="w-full px-4 py-2.5 rounded-lg border text-sm transition-colors focus:outline-none focus:ring-2 pr-24"
                    style={{ 
                      backgroundColor: 'var(--color-bg-primary)',
                      borderColor: 'var(--color-border-primary)',
                      color: 'var(--color-text-primary)'
                    }}
                    placeholder={t('recipientPlaceholder')}
                    autoFocus
                  />
                  <span 
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-sm"
                    style={{ color: 'var(--color-text-quaternary)' }}
                  >
                    @{domain}
                  </span>
                </div>
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
                onClick={() => {
                  setShowAddModal(false)
                  setModalInput('')
                  setError('')
                }}
                className="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                style={{ 
                  color: 'var(--color-text-secondary)',
                  backgroundColor: 'var(--color-bg-secondary)'
                }}
              >
                {t('close')}
              </button>
              <button
                type="button"
                onClick={addSingleRecipient}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                style={{ backgroundColor: 'var(--color-accent-primary)', color: 'var(--color-accent-text)' }}
              >
                <Plus className="w-4 h-4" />
                {t('add')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
