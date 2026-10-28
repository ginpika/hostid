import { useEffect, useId, useRef, useState } from 'react'
import { Check, ChevronDown, Copy } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useI18n } from '../i18n/I18nContext'

interface EmailEnvelopeProps {
  email: {
    from: string
    fromName?: string | null
    to: string
    toList: string
    ccList: string | null
    bccList: string | null
    createdAt: string
  }
}

const parseAddresses = (value: string | null): string[] => {
  try {
    const addresses: unknown = JSON.parse(value || '[]')
    return Array.isArray(addresses)
      ? addresses.filter((address): address is string => typeof address === 'string' && address.trim().length > 0)
      : []
  } catch {
    return []
  }
}

export default function EmailEnvelope({ email }: EmailEnvelopeProps) {
  const { t, language } = useI18n()
  const { user } = useAuth()
  const [expanded, setExpanded] = useState(false)
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null)
  const envelopeRef = useRef<HTMLElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout>>()
  const detailsId = useId()
  const toggleId = useId()

  useEffect(() => () => clearTimeout(copyTimeoutRef.current), [])

  useEffect(() => {
    if (!expanded) return

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!envelopeRef.current?.contains(event.target as Node)) setExpanded(false)
    }
    // HTML 正文使用 iframe，点击其中的内容会让主窗口失去焦点。
    const closeOnWindowBlur = () => setExpanded(false)
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      setExpanded(false)
      toggleRef.current?.focus()
    }

    document.addEventListener('mousedown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    window.addEventListener('blur', closeOnWindowBlur)
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
      window.removeEventListener('blur', closeOnWindowBlur)
    }
  }, [expanded])

  const copyAddress = async (address: string) => {
    try {
      await navigator.clipboard.writeText(address)
      clearTimeout(copyTimeoutRef.current)
      setCopiedAddress(address)
      copyTimeoutRef.current = setTimeout(() => setCopiedAddress(null), 2000)
    } catch (error) {
      console.error('Failed to copy email address:', error)
    }
  }

  const to = parseAddresses(email.toList)
  const cc = parseAddresses(email.ccList)
  const bcc = parseAddresses(email.bccList)
  if (to.length === 0 && cc.length === 0 && bcc.length === 0 && email.to?.trim()) to.push(email.to)
  const groups = [
    { label: t('to'), addresses: to },
    { label: t('cc'), addresses: cc },
    { label: t('bcc'), addresses: bcc }
  ]
  const primaryGroup = groups.find(group => group.addresses.length > 0)
  const recipientCount = groups.reduce((total, group) => total + group.addresses.length, 0)
  const senderName = email.fromName?.trim() || email.from
  const hasSenderName = senderName !== email.from
  const date = new Date(email.createdAt)
  const dateLabel = date.toLocaleDateString(language, { year: 'numeric', month: 'short', day: 'numeric' })
  const timeLabel = date.toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit', hour12: false })
  const fullDate = date.toLocaleString(language, { dateStyle: 'full', timeStyle: 'short' })

  const renderAddress = (address: string) => {
    const copied = copiedAddress === address
    const isMe = user?.email?.toLowerCase() === address.toLowerCase()

    return (
      <button
        key={address}
        type="button"
        className="email-envelope__address-chip"
        onClick={() => copyAddress(address)}
        title={`${t('clickToCopy')}: ${address}`}
        aria-label={`${copied ? t('copied') : t('clickToCopy')}: ${address}`}
      >
        <span className="email-envelope__full-address">{address}</span>
        {isMe && <span className="email-envelope__me">{t('me')}</span>}
        {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
      </button>
    )
  }

  return (
    <section className="email-envelope" ref={envelopeRef} aria-label={t('emailDetails')}>
      <div className="email-envelope__summary">
        <div className="email-envelope__avatar" aria-hidden="true">
          {senderName.charAt(0).toUpperCase()}
        </div>

        <div className="email-envelope__identity">
          <span className="email-envelope__label email-envelope__sender-label">{t('from')}</span>
          <span className="email-envelope__name" title={senderName}>{senderName}</span>
          {hasSenderName && <span className="email-envelope__sender-address" title={email.from}>{email.from}</span>}
        </div>

        <time className="email-envelope__date" dateTime={email.createdAt} title={fullDate}>
          <span>{dateLabel}</span>
          <span className="email-envelope__time">{timeLabel}</span>
        </time>

        <div className="email-envelope__recipients">
          {primaryGroup ? (
            <>
              <span className="email-envelope__label">{primaryGroup.label}</span>
              <span className="email-envelope__recipient" title={primaryGroup.addresses.join(', ')}>
                {primaryGroup.addresses[0]}
              </span>
              {recipientCount > 1 && <span className="email-envelope__count">+{recipientCount - 1}</span>}
            </>
          ) : <span className="email-envelope__label">{t('noRecipientsDisplay')}</span>}
          <button
            ref={toggleRef}
            id={toggleId}
            type="button"
            className="email-envelope__toggle"
            onClick={() => setExpanded(previous => !previous)}
            aria-expanded={expanded}
            aria-controls={detailsId}
            aria-label={expanded ? t('hideEmailDetails') : t('showEmailDetails')}
          >
            {t('details')}
            <ChevronDown size={14} className={expanded ? 'rotate-180' : ''} aria-hidden="true" />
          </button>
        </div>
      </div>

      {expanded && (
        <div id={detailsId} role="region" aria-labelledby={toggleId} className="email-envelope__details">
          <dl className="email-envelope__fields">
            <div className="email-envelope__field">
              <dt>{t('from')}</dt>
              <dd>
                {hasSenderName && <span className="email-envelope__detail-name">{senderName}</span>}
                {renderAddress(email.from)}
              </dd>
            </div>
            {groups.map(group => group.addresses.length > 0 && (
              <div key={group.label} className="email-envelope__field">
                <dt>{group.label}</dt>
                <dd>{group.addresses.map(renderAddress)}</dd>
              </div>
            ))}
            <div className="email-envelope__field email-envelope__date-field">
              <dt>{t('date')}</dt>
              <dd><time dateTime={email.createdAt}>{fullDate}</time></dd>
            </div>
          </dl>
        </div>
      )}
      <span className="sr-only" role="status">{copiedAddress ? t('copied') : ''}</span>
    </section>
  )
}
