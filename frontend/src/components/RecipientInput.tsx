/**
 * 收件人输入组件
 * 支持添加多个收件人，包含 to/cc/bcc 三种类型
 * 提供用户名验证和重复检测
 */
import React, { forwardRef, useImperativeHandle, useState, useRef, useEffect, useId } from 'react'
import { createPortal } from 'react-dom'
import { X, ChevronDown, Plus, Mail, Users, EyeOff } from 'lucide-react'
import { useI18n } from '../i18n/I18nContext'
import { isTopModal, restoreModalFocus } from '../lib/modalStack'

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

export interface RecipientInputHandle {
  /** Commit the unfinished entry, or keep it visible and block sending if invalid. */
  commit: () => Recipient[] | null
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

export default forwardRef<RecipientInputHandle, RecipientInputProps>(function RecipientInput({ recipients, onChange, domain, maxRecipients = 50 }, ref) {
  const { t } = useI18n()
  const [inputValue, setInputValue] = useState('')
  const [showTypeMenu, setShowTypeMenu] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [showAddModal, setShowAddModal] = useState(false)
  const [modalInput, setModalInput] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const addButtonRef = useRef<HTMLButtonElement>(null)
  const modalRef = useRef<HTMLDivElement>(null)
  const modalInputRef = useRef<HTMLInputElement>(null)
  const fieldId = useId()
  const hintId = useId()
  const errorId = useId()
  const modalTitleId = useId()
  const modalFieldId = useId()
  const menuPrefix = useId()
  const closeAddModal = () => {
    setShowAddModal(false)
    setModalInput('')
    setError('')
  }
  const closeModalRef = useRef(closeAddModal)
  closeModalRef.current = closeAddModal

  useEffect(() => {
    if (!showAddModal) return
    const previous = addButtonRef.current || (document.activeElement instanceof HTMLElement ? document.activeElement : null)
    modalInputRef.current?.focus()
    const keydown = (event: KeyboardEvent) => {
      const dialog = modalRef.current
      if (!dialog || !isTopModal(dialog)) return
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        closeModalRef.current()
      } else if (event.key === 'Tab') {
        const items = Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]')).filter(element => element.getClientRects().length > 0)
        const first = items[0]
        const last = items[items.length - 1]
        if (!first) { event.preventDefault(); dialog.focus(); return }
        if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last.focus() }
        else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first.focus() }
        event.stopPropagation()
      }
    }
    const focusin = (event: FocusEvent) => {
      if (modalRef.current && isTopModal(modalRef.current) && event.target instanceof Node && !modalRef.current.contains(event.target)) modalInputRef.current?.focus()
    }
    document.addEventListener('keydown', keydown, true)
    document.addEventListener('focusin', focusin)
    return () => {
      document.removeEventListener('keydown', keydown, true)
      document.removeEventListener('focusin', focusin)
      restoreModalFocus(previous)
    }
  }, [showAddModal])

  useEffect(() => {
    if (!showTypeMenu) return
    const menu = containerRef.current?.querySelector<HTMLElement>('[role="menu"]')
    menu?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus()
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Element && !event.target.closest('[data-recipient-type-menu], [data-recipient-type-trigger]')) setShowTypeMenu(null)
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [showTypeMenu])

  const focusTypeTrigger = (id: string) => {
    Array.from(containerRef.current?.querySelectorAll<HTMLButtonElement>('[data-recipient-type-trigger]') || []).find(button => button.dataset.recipientTypeTrigger === id)?.focus()
  }

  const usernameRegex = /^[a-zA-Z0-9._]+$/

  const validateUsername = (username: string): boolean => {
    return usernameRegex.test(username) && username.length >= 3 && username.length <= 30
  }

  const parseInput = (input: string): { input: string; username: string; email: string; valid: boolean }[] => {
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
      const addressParts = email.split('@')
      const validDomain = addressParts.length === 2 && addressParts[1].split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))
      
      return {
        input: part,
        username,
        email,
        valid: validateUsername(username) && validDomain
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
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Enter' && inputValue.trim()) {
      e.preventDefault()
      addRecipientsFromInput(inputValue)
    } else if (e.key === 'Backspace' && !inputValue && recipients.length > 0) {
      const lastRecipient = recipients[recipients.length - 1]
      removeRecipient(lastRecipient.id)
    }
  }

  const handleBlur = () => {
    // Commit before a subsequent send click; a delayed blur can omit the last recipient.
    if (inputValue.trim()) addRecipientsFromInput(inputValue)
  }

  const addRecipientsFromInput = (input: string): Recipient[] | null => {
    const parsed = parseInput(input)
    const validRecipients: Recipient[] = []
    const invalidUsernames: string[] = []
    const unfinished: string[] = []
    let limitReached = false
    
    for (const item of parsed) {
      if (!item.valid) {
        invalidUsernames.push(item.input)
        unfinished.push(item.input)
        continue
      }
      
      if ([...recipients, ...validRecipients].some(r => r.email.toLowerCase() === item.email.toLowerCase())) {
        continue
      }
      
      if (recipients.length + validRecipients.length >= maxRecipients) {
        limitReached = true
        unfinished.push(item.input)
        continue
      }
      
      validRecipients.push({
        id: `${Date.now()}-${Math.random()}`,
        username: item.username,
        email: item.email,
        type: 'to'
      })
    }
    
    setError([
      ...(invalidUsernames.length ? [`${t('invalidUsernames')}: ${invalidUsernames.join(', ')}`] : []),
      ...(limitReached ? [t('maxRecipientsReached')] : [])
    ].join(' '))
    
    if (validRecipients.length > 0) {
      onChange([...recipients, ...validRecipients])
    }
    
    setInputValue(unfinished.join(', '))
    return unfinished.length ? null : [...recipients, ...validRecipients]
  }

  useImperativeHandle(ref, () => ({
    commit: () => {
      if (!inputValue.trim()) return recipients
      const committed = addRecipientsFromInput(inputValue)
      if (!committed) inputRef.current?.focus()
      return committed
    }
  }))

  const addSingleRecipient = () => {
    if (!modalInput.trim()) return
    
    const parsed = parseInput(modalInput)
    const validRecipients: Recipient[] = []
    
    for (const item of parsed) {
      if (!item.valid) {
        setError(`${t('invalidUsername')}: ${item.input}`)
        return
      }
      
      if ([...recipients, ...validRecipients].some(r => r.email.toLowerCase() === item.email.toLowerCase())) {
        setError(`${t('duplicateEmail')}: ${item.email}`)
        return
      }
      
      if (recipients.length + validRecipients.length >= maxRecipients) {
        setError(t('maxRecipientsReached'))
        return
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
    focusTypeTrigger(id)
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
    inputRef.current?.focus()
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
        className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-sm border relative min-w-0 max-w-full"
        style={{ 
          backgroundColor: colors.bg,
          color: colors.text,
          borderColor: colors.border
        }}
      >
        <span className="font-medium min-w-0 truncate" title={recipient.email}>{recipient.email}</span>
        <button
          type="button"
          onClick={(e) => handleTypeMenuToggle(e, recipient.id)}
          onKeyDown={event => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setShowTypeMenu(recipient.id) }
          }}
          data-recipient-type-trigger={recipient.id}
          aria-label={`${t('changeType')}: ${recipient.email}, ${t(typeConfig[recipient.type].label)}`}
          aria-haspopup="menu"
          aria-expanded={showTypeMenu === recipient.id}
          aria-controls={showTypeMenu === recipient.id ? `${menuPrefix}-${recipient.id}` : undefined}
          className="ml-1 hover:opacity-70 flex items-center justify-center w-6 h-6 shrink-0 rounded-full focus-visible:outline focus-visible:outline-2"
        >
          <ChevronDown className="w-3 h-3" />
        </button>
        <button
          type="button"
          onClick={(e) => handleRemoveClick(e, recipient.id)}
          aria-label={`${t('delete')}: ${recipient.email}`}
          className="hover:opacity-70 ml-1 shrink-0 flex items-center justify-center w-6 h-6 rounded-full focus-visible:outline focus-visible:outline-2"
        >
          <X className="w-3 h-3" />
        </button>
        
        {showTypeMenu === recipient.id && (
          <div 
            id={`${menuPrefix}-${recipient.id}`}
            data-recipient-type-menu
            role="menu"
            aria-label={t('changeType')}
            className="absolute top-full left-0 mt-1 rounded-lg shadow-lg py-1 z-20 border min-w-[140px]"
            style={{ 
              backgroundColor: 'var(--color-bg-secondary)',
              borderColor: 'var(--color-border-primary)'
            }}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
            }}
            onKeyDown={event => {
              if (event.key === 'Escape') {
                event.preventDefault(); event.stopPropagation(); setShowTypeMenu(null); focusTypeTrigger(recipient.id)
              } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                event.preventDefault(); event.stopPropagation()
                const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'))
                const current = items.indexOf(document.activeElement as HTMLButtonElement)
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
                items[next]?.focus()
              } else if (event.key === 'Tab') setShowTypeMenu(null)
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
                  role="menuitemradio"
                  aria-checked={isActive}
                  tabIndex={-1}
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
    <div ref={containerRef} className="space-y-3 min-w-0">
      {error && !showAddModal && (
        <div 
          id={errorId}
          role="alert"
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
        <div className="flex-1 min-w-0 relative">
          <label htmlFor={fieldId} className="sr-only">{t('recipients')}</label>
          <input
            id={fieldId}
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onBlur={handleBlur}
            aria-describedby={`${hintId}${error && !showAddModal ? ` ${errorId}` : ''}`}
            aria-invalid={Boolean(error && !showAddModal)}
            className="w-full px-4 py-2.5 rounded-lg border text-sm transition-colors focus:outline-none focus:ring-2 sm:pr-32"
            style={{ 
              backgroundColor: 'var(--color-bg-primary)',
              borderColor: 'var(--color-border-primary)',
              color: 'var(--color-text-primary)'
            }}
            placeholder={t('recipientPlaceholder')}
          />
          <span 
            className="hidden sm:block absolute right-3 top-1/2 -translate-y-1/2 text-sm max-w-[42%] truncate pointer-events-none"
            style={{ color: 'var(--color-text-quaternary)' }}
          >
            @{domain}
          </span>
        </div>
        
        <button
          ref={addButtonRef}
          type="button"
          onClick={() => { setShowTypeMenu(null); setShowAddModal(true) }}
          aria-label={t('addRecipient')}
          aria-haspopup="dialog"
          aria-expanded={showAddModal}
          aria-controls={showAddModal ? `${modalTitleId}-dialog` : undefined}
          className="flex items-center justify-center gap-1 px-3 sm:px-4 py-2 min-h-[42px] shrink-0 rounded-lg text-sm font-medium transition-colors"
          style={{ 
            color: 'var(--color-text-secondary)',
            backgroundColor: 'var(--color-bg-tertiary)'
          }}
        >
          <Plus className="w-4 h-4" />
          <span className="hidden sm:inline">{t('addRecipient')}</span>
        </button>
      </div>
      
      <p id={hintId} className="text-xs" style={{ color: 'var(--color-text-quaternary)' }}>
        {t('recipientHint')} ({recipients.length}/{maxRecipients})
      </p>
      
      {showAddModal && createPortal(
        <div 
          className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-[80]"
          onClick={closeAddModal}
        >
          <div 
            ref={modalRef}
            id={`${modalTitleId}-dialog`}
            role="dialog"
            aria-modal="true"
            aria-labelledby={modalTitleId}
            tabIndex={-1}
            className="rounded-2xl shadow-2xl w-full max-w-md overflow-hidden outline-none"
            style={{ backgroundColor: 'var(--color-bg-secondary)' }}
            onClick={e => e.stopPropagation()}
          >
            <div 
              className="flex items-center justify-between p-4 border-b"
              style={{ borderColor: 'var(--color-border-primary)' }}
            >
              <h3 id={modalTitleId} className="text-lg font-semibold" style={{ color: 'var(--color-text-primary)' }}>{t('addRecipient')}</h3>
              <button
                type="button"
                onClick={closeAddModal}
                aria-label={t('close')}
                className="p-2 rounded-lg transition-colors hover:bg-[var(--color-bg-tertiary)]"
                style={{ color: 'var(--color-text-quaternary)' }}
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-4 space-y-4">
              {error && (
                <div 
                  id={`${errorId}-modal`}
                  role="alert"
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
                  htmlFor={modalFieldId}
                  className="block text-sm font-medium mb-1"
                  style={{ color: 'var(--color-text-secondary)' }}
                >
                  {t('username')}
                </label>
                <div className="relative">
                  <input
                    ref={modalInputRef}
                    id={modalFieldId}
                    type="text"
                    value={modalInput}
                    aria-invalid={Boolean(error)}
                    aria-describedby={error ? `${errorId}-modal` : undefined}
                    onChange={(e) => setModalInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        addSingleRecipient()
                      }
                    }}
                    className="w-full px-4 py-2.5 rounded-lg border text-sm transition-colors focus:outline-none focus:ring-2 sm:pr-32"
                    style={{ 
                      backgroundColor: 'var(--color-bg-primary)',
                      borderColor: 'var(--color-border-primary)',
                      color: 'var(--color-text-primary)'
                    }}
                    placeholder={t('recipientPlaceholder')}
                  />
                  <span 
                    className="hidden sm:block absolute right-3 top-1/2 -translate-y-1/2 text-sm max-w-[42%] truncate pointer-events-none"
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
                onClick={closeAddModal}
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
        </div>, document.body
      )}
    </div>
  )
})
