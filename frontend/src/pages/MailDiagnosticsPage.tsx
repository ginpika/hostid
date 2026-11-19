/**
 * 邮箱与域名可用性检测面板（管理员）
 * 检测当前邮件域名与 SMTP 服务的 5 项关键指标：
 *   1. 25 端口可出口
 *   2. 25 端口可入口
 *   3. MX 记录合法性
 *   4. SPF 记录合法性
 *   5. DMARC 记录合法性
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  Globe,
  Loader2,
  MailCheck,
  RefreshCw,
  Server,
  ShieldCheck,
  XCircle
} from 'lucide-react'
import { useI18n } from '../i18n/I18nContext'
import { formatDiagnosticMessage, type DiagnosticMessageDto } from '../lib/mailDiagnosticsI18n'

type DiagnosticStatus = 'pass' | 'warn' | 'fail'

interface PortCheckTargetResult {
  host: string
  ip?: string
  port: number
  reachable: boolean
  banner?: string
  matchedInstance?: boolean
  latencyMs?: number
  errorCode?: string
  errorMessage?: string
}

interface MxRecordInfo {
  priority: number
  exchange: string
  addresses: string[]
  privateAddresses: string[]
  isNullMx?: boolean
  isIpLiteral?: boolean
  isCname?: boolean
  cnameTarget?: string
  error?: string
}

interface MailCheckItem<TDetails> {
  id: 'outbound25' | 'inbound25' | 'mx' | 'spf' | 'dmarc'
  status: DiagnosticStatus
  durationMs: number
  summary: DiagnosticMessageDto
  issues: DiagnosticMessageDto[]
  details: TDetails
}

interface MailDiagnosticsReport {
  checkedAt: string
  domain: string
  domainValid: boolean
  smtpPort: number
  smtpRelay: {
    configured: boolean
    host: string
    port: number
  }
  overallStatus: DiagnosticStatus
  checks: {
    outbound25: MailCheckItem<{
      targets: PortCheckTargetResult[]
      succeededTarget?: PortCheckTargetResult
      smtpRelayConfigured: boolean
    }>
    inbound25: MailCheckItem<{
      localPort: number
      localReachable: boolean
      localMatchedInstance: boolean
      localBanner?: string
      localError?: string
      publicTargets: PortCheckTargetResult[]
      matchedPublicTarget?: PortCheckTargetResult
      checkedTargetSource: 'mx' | 'domain' | 'siteUrl' | 'none'
    }>
    mx: MailCheckItem<{
      records: MxRecordInfo[]
      rawCount: number
    }>
    spf: MailCheckItem<{
      record: string | null
      recordCount: number
      dnsLookups: number
      maxDnsLookups: number
      qualifier: string | null
      hasAll: boolean
      hasRedirect: boolean
      mechanisms: string[]
      includedDomains: string[]
    }>
    dmarc: MailCheckItem<{
      record: string | null
      recordCount: number
      lookupDomain: string
      policy: string | null
      subdomainPolicy: string | null
      pct: number | null
      adkim: string | null
      aspf: string | null
      rua: string[]
      ruf: string[]
    }>
  }
}

const STATUS_STYLE: Record<DiagnosticStatus, { bg: string; border: string; text: string }> = {
  pass: {
    bg: 'rgba(34, 197, 94, 0.1)',
    border: 'rgba(34, 197, 94, 0.3)',
    text: '#15803d'
  },
  warn: {
    bg: 'rgba(245, 158, 11, 0.12)',
    border: 'rgba(245, 158, 11, 0.35)',
    text: '#b45309'
  },
  fail: {
    bg: 'rgba(239, 68, 68, 0.1)',
    border: 'rgba(239, 68, 68, 0.3)',
    text: '#dc2626'
  }
}

function StatusIcon({ status, size = 16 }: { status: DiagnosticStatus; size?: number }) {
  if (status === 'pass') return <CheckCircle2 size={size} aria-hidden="true" />
  if (status === 'warn') return <AlertTriangle size={size} aria-hidden="true" />
  return <XCircle size={size} aria-hidden="true" />
}

export default function MailDiagnosticsPage({
  embedded = false,
  active = true
}: {
  embedded?: boolean
  active?: boolean
}) {
  const { t, language } = useI18n()
  const Heading = embedded ? 'h3' : 'h2'

  const [report, setReport] = useState<MailDiagnosticsReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const mountedRef = useRef(true)
  const inFlightRef = useRef(false)
  const lastCheckedDomainRef = useRef<string | null>(null)
  const initialTriggeredRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const runDiagnostics = useCallback(async () => {
    if (inFlightRef.current) return
    inFlightRef.current = true
    setLoading(true)
    setError('')

    try {
      const token = localStorage.getItem('token')
      const res = await fetch('/api/admin/mail-check', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({})
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(res.status === 403 ? t('adminAccessDenied') : (data.error || `HTTP ${res.status}`))
      }
      if (!mountedRef.current) return
      const nextReport = data as MailDiagnosticsReport
      setReport(nextReport)
      lastCheckedDomainRef.current = nextReport.domain
    } catch (err) {
      if (!mountedRef.current) return
      setError(`${t('mailCheckFailed')}: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      inFlightRef.current = false
      if (mountedRef.current) setLoading(false)
    }
  }, [t])

  useEffect(() => {
    if (!active) return
    if (!initialTriggeredRef.current) {
      initialTriggeredRef.current = true
      void runDiagnostics()
      return
    }

    // 切回邮箱检测标签时，如果系统设置中的 mailDomain 已更改，自动刷新检测
    let cancelled = false
    fetch('/api/auth/domain', { cache: 'no-store' })
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (cancelled || !data?.domain) return
        const latestDomain = String(data.domain).trim().toLowerCase().replace(/\.+$/, '')
        if (lastCheckedDomainRef.current !== null && latestDomain !== lastCheckedDomainRef.current) {
          void runDiagnostics()
        }
      })
      .catch(() => {
        // ignore lightweight check error
      })

    return () => {
      cancelled = true
    }
  }, [active, runDiagnostics])

  const statusLabel = (status: DiagnosticStatus) => {
    if (status === 'pass') return t('mailCheckStatusPass')
    if (status === 'warn') return t('mailCheckStatusWarn')
    return t('mailCheckStatusFail')
  }

  const formatTimestamp = (iso: string) => {
    try {
      return new Date(iso).toLocaleString(language)
    } catch {
      return iso
    }
  }

  const renderStatusPill = (status: DiagnosticStatus, extra?: string) => {
    const style = STATUS_STYLE[status]
    return (
      <span
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border shrink-0"
        style={{
          backgroundColor: style.bg,
          borderColor: style.border,
          color: style.text
        }}
      >
        <StatusIcon status={status} size={13} />
        <span>{extra || statusLabel(status)}</span>
      </span>
    )
  }

  const renderIssues = (issues: DiagnosticMessageDto[]) => {
    if (issues.length === 0) return null
    return (
      <ul className="mt-3 space-y-1.5">
        {issues.map((issue, idx) => (
          <li
            key={`${issue.code}-${idx}`}
            className="text-xs leading-relaxed px-3 py-2 rounded-lg border"
            style={{
              backgroundColor: 'var(--color-bg-primary)',
              borderColor: 'var(--color-border-primary)',
              color: 'var(--color-text-secondary)'
            }}
          >
            {formatDiagnosticMessage(issue, language)}
          </li>
        ))}
      </ul>
    )
  }

  const renderProbeTargets = (targets: PortCheckTargetResult[]) => {
    if (targets.length === 0) return null
    return (
      <div className="mt-3 space-y-1.5">
        <div className="text-xs font-medium" style={{ color: 'var(--color-text-tertiary)' }}>
          {t('mailCheckProbedTargets')}
        </div>
        <div className="grid grid-cols-1 gap-1.5">
          {targets.map((target, idx) => (
            <div
              key={`${target.host}-${target.ip ?? ''}-${idx}`}
              className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-lg border text-xs"
              style={{
                backgroundColor: 'var(--color-bg-primary)',
                borderColor: 'var(--color-border-primary)'
              }}
            >
              <div className="min-w-0 flex flex-wrap items-center gap-2 font-mono">
                <span className="font-medium break-all" style={{ color: 'var(--color-text-primary)' }}>
                  {target.host}:{target.port}
                </span>
                {target.ip && target.ip !== target.host && (
                  <span style={{ color: 'var(--color-text-muted)' }}>({target.ip})</span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {target.reachable ? (
                  <>
                    <span style={{ color: '#15803d' }} className="font-medium">
                      220 OK{target.latencyMs !== undefined ? ` · ${target.latencyMs}ms` : ''}
                    </span>
                    {target.matchedInstance === true && (
                      <span
                        className="px-2 py-0.5 rounded text-[11px] font-medium"
                        style={{ backgroundColor: 'rgba(34, 197, 94, 0.12)', color: '#15803d' }}
                      >
                        {t('mailCheckMatchedInstance')}
                      </span>
                    )}
                    {target.matchedInstance === false && (
                      <span
                        className="px-2 py-0.5 rounded text-[11px] font-medium"
                        style={{ backgroundColor: 'rgba(245, 158, 11, 0.14)', color: '#b45309' }}
                      >
                        {t('mailCheckForeignInstance')}
                      </span>
                    )}
                  </>
                ) : (
                  <span className="font-mono" style={{ color: '#dc2626' }}>
                    {target.errorCode || 'FAILED'}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  const checkItems = report
    ? [report.checks.outbound25, report.checks.inbound25, report.checks.mx, report.checks.spf, report.checks.dmarc]
    : []
  const passedCount = checkItems.filter(c => c.status === 'pass').length

  const inboundSourceLabel = (source: 'mx' | 'domain' | 'siteUrl' | 'none') => {
    switch (source) {
      case 'mx': return t('mailCheckTargetSourceMx')
      case 'domain': return t('mailCheckTargetSourceDomain')
      case 'siteUrl': return t('mailCheckTargetSourceSiteUrl')
      default: return t('mailCheckTargetSourceNone')
    }
  }

  return (
    <div className={embedded ? 'admin-panel' : 'flex-1 overflow-y-auto'} style={embedded ? undefined : { backgroundColor: 'var(--color-bg-primary)' }}>
      <div className={embedded ? 'admin-panel-content' : 'max-w-4xl mx-auto p-8'} lang={language}>
        <div className={embedded ? 'admin-panel-header' : 'flex items-center justify-between mb-8 gap-4'}>
          <div>
            <Heading className={embedded ? 'admin-panel-title' : 'text-2xl font-bold flex items-center gap-2'} style={{ color: 'var(--color-text-primary)' }}>
              {!embedded && <MailCheck className="w-7 h-7" style={{ color: 'var(--color-accent-primary)' }} />}
              {t('mailCheckTitle')}
            </Heading>
            <p className={embedded ? 'admin-panel-description' : 'mt-1'} style={{ color: 'var(--color-text-tertiary)' }}>
              {t('mailCheckDescription')}
            </p>
          </div>
          <button
            type="button"
            disabled={loading}
            onClick={() => void runDiagnostics()}
            className={embedded ? 'admin-panel-primary-action' : 'flex items-center gap-2 px-4 py-2 rounded-lg font-medium disabled:opacity-60'}
            style={{ backgroundColor: 'var(--color-accent-primary)', color: 'var(--color-accent-text)' }}
          >
            {loading
              ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              : <RefreshCw className="w-4 h-4" aria-hidden="true" />}
            <span>{loading ? t('mailCheckRunning') : t('mailCheckRun')}</span>
          </button>
        </div>

        {error && (
          <div
            role="alert"
            className="mb-6 p-4 rounded-lg border text-sm"
            style={{
              backgroundColor: 'rgba(239, 68, 68, 0.1)',
              borderColor: 'rgba(239, 68, 68, 0.3)',
              color: '#dc2626'
            }}
          >
            {error}
          </div>
        )}

        {loading && !report ? (
          <div className="flex flex-col items-center justify-center py-14 gap-3">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: 'var(--color-accent-primary)' }} />
            <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{t('mailCheckRunning')}</p>
          </div>
        ) : report && (
          <div className="space-y-5">
            {/* 总览与当前域名上下文 */}
            <section
              className="rounded-xl border p-5"
              style={{
                backgroundColor: 'var(--color-bg-secondary)',
                borderColor: STATUS_STYLE[report.overallStatus].border
              }}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2.5">
                  {renderStatusPill(
                    report.overallStatus,
                    `${passedCount}/5 · ${
                      report.overallStatus === 'pass'
                        ? t('mailCheckOverallPass')
                        : report.overallStatus === 'warn'
                          ? t('mailCheckOverallWarn')
                          : t('mailCheckOverallFail')
                    }`
                  )}
                </div>
                <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  {t('mailCheckCheckedAt')}: {formatTimestamp(report.checkedAt)}
                </span>
              </div>

              <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
                <div
                  className="p-3 rounded-lg border"
                  style={{ backgroundColor: 'var(--color-bg-primary)', borderColor: 'var(--color-border-primary)' }}
                >
                  <div className="flex items-center justify-between gap-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    <span>{t('mailCheckDomainLabel')}</span>
                    <Link
                      to="/admin/settings?tab=general"
                      className="font-medium hover:underline"
                      style={{ color: 'var(--color-accent-primary)' }}
                    >
                      {t('mailCheckEditDomain')}
                    </Link>
                  </div>
                  <div className="mt-1.5 flex items-center flex-wrap gap-2">
                    <span className="font-mono text-sm font-semibold break-all" style={{ color: 'var(--color-text-primary)' }}>
                      {report.domain || '(empty)'}
                    </span>
                    <span
                      className="px-1.5 py-0.5 rounded text-[11px] font-medium"
                      style={report.domainValid
                        ? { backgroundColor: 'rgba(34, 197, 94, 0.12)', color: '#15803d' }
                        : { backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#dc2626' }}
                    >
                      {report.domainValid ? t('mailCheckDomainValidBadge') : t('mailCheckDomainInvalidBadge')}
                    </span>
                  </div>
                </div>

                <div
                  className="p-3 rounded-lg border"
                  style={{ backgroundColor: 'var(--color-bg-primary)', borderColor: 'var(--color-border-primary)' }}
                >
                  <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    {t('mailCheckSmtpPortLabel')}
                  </div>
                  <div className="mt-1.5 font-mono text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                    TCP {report.smtpPort}
                  </div>
                </div>

                <div
                  className="p-3 rounded-lg border"
                  style={{ backgroundColor: 'var(--color-bg-primary)', borderColor: 'var(--color-border-primary)' }}
                >
                  <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    {t('mailCheckDeliveryModeLabel')}
                  </div>
                  <div className="mt-1.5 text-sm font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>
                    {report.smtpRelay.configured
                      ? `${t('settingsSmtpDeliveryRelay')} (${report.smtpRelay.host}:${report.smtpRelay.port})`
                      : t('settingsSmtpDeliveryDirect')}
                  </div>
                </div>
              </div>

              {!report.domainValid && (
                <div
                  role="status"
                  className="mt-3 p-3 rounded-lg border text-xs flex flex-wrap items-center justify-between gap-2"
                  style={{
                    backgroundColor: 'rgba(245, 158, 11, 0.1)',
                    borderColor: 'rgba(245, 158, 11, 0.3)',
                    color: '#b45309'
                  }}
                >
                  <span>{t('mailCheckLocalhostWarning')}</span>
                  <Link to="/admin/settings?tab=general" className="font-semibold underline shrink-0">
                    {t('mailCheckEditDomain')} →
                  </Link>
                </div>
              )}
            </section>

            {/* 1. 25 端口出站 */}
            <section
              className="rounded-xl border p-5"
              style={{ backgroundColor: 'var(--color-bg-secondary)', borderColor: 'var(--color-border-primary)' }}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <span
                    className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                    style={{ backgroundColor: 'var(--color-accent-muted)', color: 'var(--color-accent-primary)' }}
                  >
                    <ArrowUpRight size={17} aria-hidden="true" />
                  </span>
                  <div>
                    <h4 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                      {t('mailCheckCardOutboundTitle')}
                    </h4>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
                      {formatDiagnosticMessage(report.checks.outbound25.summary, language)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-mono" style={{ color: 'var(--color-text-muted)' }}>
                    {report.checks.outbound25.durationMs}ms
                  </span>
                  {renderStatusPill(report.checks.outbound25.status)}
                </div>
              </div>
              {renderIssues(report.checks.outbound25.issues)}
              {renderProbeTargets(report.checks.outbound25.details.targets)}
            </section>

            {/* 2. 25 端口入站 */}
            <section
              className="rounded-xl border p-5"
              style={{ backgroundColor: 'var(--color-bg-secondary)', borderColor: 'var(--color-border-primary)' }}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <span
                    className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                    style={{ backgroundColor: 'var(--color-accent-muted)', color: 'var(--color-accent-primary)' }}
                  >
                    <ArrowDownLeft size={17} aria-hidden="true" />
                  </span>
                  <div>
                    <h4 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                      {t('mailCheckCardInboundTitle')}
                    </h4>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
                      {formatDiagnosticMessage(report.checks.inbound25.summary, language)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-mono" style={{ color: 'var(--color-text-muted)' }}>
                    {report.checks.inbound25.durationMs}ms
                  </span>
                  {renderStatusPill(report.checks.inbound25.status)}
                </div>
              </div>

              <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2.5 text-xs">
                <div
                  className="px-3 py-2 rounded-lg border flex items-center justify-between gap-2"
                  style={{ backgroundColor: 'var(--color-bg-primary)', borderColor: 'var(--color-border-primary)' }}
                >
                  <span style={{ color: 'var(--color-text-tertiary)' }}>
                    {t('mailCheckLocalSmtpLabel')} (127.0.0.1:{report.checks.inbound25.details.localPort})
                  </span>
                  <span
                    className="font-medium"
                    style={{
                      color: report.checks.inbound25.details.localReachable ? '#15803d' : '#dc2626'
                    }}
                  >
                    {report.checks.inbound25.details.localReachable
                      ? t('mailCheckLocalSmtpOk')
                      : t('mailCheckLocalSmtpDown')}
                  </span>
                </div>
                <div
                  className="px-3 py-2 rounded-lg border flex items-center justify-between gap-2"
                  style={{ backgroundColor: 'var(--color-bg-primary)', borderColor: 'var(--color-border-primary)' }}
                >
                  <span style={{ color: 'var(--color-text-tertiary)' }}>{t('mailCheckPublicProbeLabel')}</span>
                  <span className="font-medium" style={{ color: 'var(--color-text-secondary)' }}>
                    {inboundSourceLabel(report.checks.inbound25.details.checkedTargetSource)}
                  </span>
                </div>
              </div>

              {renderIssues(report.checks.inbound25.issues)}
              {renderProbeTargets(report.checks.inbound25.details.publicTargets)}
            </section>

            {/* 3. MX 记录合法性 */}
            <section
              className="rounded-xl border p-5"
              style={{ backgroundColor: 'var(--color-bg-secondary)', borderColor: 'var(--color-border-primary)' }}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <span
                    className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                    style={{ backgroundColor: 'var(--color-accent-muted)', color: 'var(--color-accent-primary)' }}
                  >
                    <Server size={17} aria-hidden="true" />
                  </span>
                  <div>
                    <h4 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                      {t('mailCheckCardMxTitle')}
                    </h4>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
                      {formatDiagnosticMessage(report.checks.mx.summary, language)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-mono" style={{ color: 'var(--color-text-muted)' }}>
                    {report.checks.mx.durationMs}ms
                  </span>
                  {renderStatusPill(report.checks.mx.status)}
                </div>
              </div>

              {renderIssues(report.checks.mx.issues)}

              {report.checks.mx.details.records.length > 0 && (
                <div className="mt-3">
                  <div className="text-xs font-medium mb-1.5" style={{ color: 'var(--color-text-tertiary)' }}>
                    {t('mailCheckMxRecordsLabel')}
                  </div>
                  <div
                    className="rounded-lg border overflow-x-auto"
                    style={{ backgroundColor: 'var(--color-bg-primary)', borderColor: 'var(--color-border-primary)' }}
                  >
                    <table className="w-full text-xs text-left border-collapse">
                      <thead>
                        <tr className="border-b" style={{ borderColor: 'var(--color-border-primary)', color: 'var(--color-text-muted)' }}>
                          <th className="py-2 px-3 font-medium">{t('mailCheckMxPriority')}</th>
                          <th className="py-2 px-3 font-medium">{t('mailCheckMxHost')}</th>
                          <th className="py-2 px-3 font-medium">{t('mailCheckMxAddresses')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.checks.mx.details.records.map((rec, idx) => (
                          <tr
                            key={`${rec.exchange}-${rec.priority}-${idx}`}
                            className="border-b last:border-b-0"
                            style={{ borderColor: 'var(--color-border-primary)' }}
                          >
                            <td className="py-2 px-3 font-mono" style={{ color: 'var(--color-text-secondary)' }}>
                              {rec.priority}
                            </td>
                            <td className="py-2 px-3 font-mono break-all" style={{ color: 'var(--color-text-primary)' }}>
                              {rec.exchange}
                              {rec.isCname && (
                                <span
                                  className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-sans"
                                  style={{ backgroundColor: 'rgba(245, 158, 11, 0.14)', color: '#b45309' }}
                                >
                                  CNAME
                                </span>
                              )}
                              {rec.isNullMx && (
                                <span
                                  className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-sans"
                                  style={{ backgroundColor: 'rgba(239, 68, 68, 0.12)', color: '#dc2626' }}
                                >
                                  Null MX
                                </span>
                              )}
                            </td>
                            <td className="py-2 px-3 font-mono break-all" style={{ color: 'var(--color-text-secondary)' }}>
                              {rec.addresses.length > 0
                                ? rec.addresses.join(', ')
                                : rec.privateAddresses.length > 0
                                  ? `${rec.privateAddresses.join(', ')} (private)`
                                  : '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </section>

            {/* 4. SPF 记录合法性 */}
            <section
              className="rounded-xl border p-5"
              style={{ backgroundColor: 'var(--color-bg-secondary)', borderColor: 'var(--color-border-primary)' }}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <span
                    className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                    style={{ backgroundColor: 'var(--color-accent-muted)', color: 'var(--color-accent-primary)' }}
                  >
                    <ShieldCheck size={17} aria-hidden="true" />
                  </span>
                  <div>
                    <h4 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                      {t('mailCheckCardSpfTitle')}
                    </h4>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
                      {formatDiagnosticMessage(report.checks.spf.summary, language)}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {report.checks.spf.details.record && (
                    <span
                      className="px-2 py-0.5 rounded text-[11px] font-mono"
                      style={{ backgroundColor: 'var(--color-bg-tertiary)', color: 'var(--color-text-secondary)' }}
                    >
                      {t('mailCheckDnsLookups')}: {report.checks.spf.details.dnsLookups}/{report.checks.spf.details.maxDnsLookups}
                    </span>
                  )}
                  {renderStatusPill(report.checks.spf.status)}
                </div>
              </div>

              {report.checks.spf.details.record && (
                <div className="mt-3">
                  <div className="text-xs font-medium mb-1" style={{ color: 'var(--color-text-tertiary)' }}>
                    {t('mailCheckRawRecord')}
                  </div>
                  <code
                    className="block px-3 py-2 rounded-lg border text-xs font-mono break-all"
                    style={{
                      backgroundColor: 'var(--color-bg-primary)',
                      borderColor: 'var(--color-border-primary)',
                      color: 'var(--color-text-primary)'
                    }}
                  >
                    {report.checks.spf.details.record}
                  </code>
                </div>
              )}

              {renderIssues(report.checks.spf.issues)}
            </section>

            {/* 5. DMARC 记录合法性 */}
            <section
              className="rounded-xl border p-5"
              style={{ backgroundColor: 'var(--color-bg-secondary)', borderColor: 'var(--color-border-primary)' }}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <span
                    className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                    style={{ backgroundColor: 'var(--color-accent-muted)', color: 'var(--color-accent-primary)' }}
                  >
                    <Globe size={17} aria-hidden="true" />
                  </span>
                  <div>
                    <h4 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                      {t('mailCheckCardDmarcTitle')}
                    </h4>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
                      {formatDiagnosticMessage(report.checks.dmarc.summary, language)}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className="px-2 py-0.5 rounded text-[11px] font-mono"
                    style={{ backgroundColor: 'var(--color-bg-tertiary)', color: 'var(--color-text-secondary)' }}
                  >
                    {report.checks.dmarc.details.lookupDomain}
                  </span>
                  {renderStatusPill(report.checks.dmarc.status)}
                </div>
              </div>

              {report.checks.dmarc.details.record && (
                <div className="mt-3 space-y-2.5">
                  <div>
                    <div className="text-xs font-medium mb-1" style={{ color: 'var(--color-text-tertiary)' }}>
                      {t('mailCheckRawRecord')}
                    </div>
                    <code
                      className="block px-3 py-2 rounded-lg border text-xs font-mono break-all"
                      style={{
                        backgroundColor: 'var(--color-bg-primary)',
                        borderColor: 'var(--color-border-primary)',
                        color: 'var(--color-text-primary)'
                      }}
                    >
                      {report.checks.dmarc.details.record}
                    </code>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                    <div
                      className="px-3 py-2 rounded-lg border"
                      style={{ backgroundColor: 'var(--color-bg-primary)', borderColor: 'var(--color-border-primary)' }}
                    >
                      <div style={{ color: 'var(--color-text-muted)' }}>{t('mailCheckDmarcPolicy')}</div>
                      <div className="mt-0.5 font-mono font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                        {report.checks.dmarc.details.policy || t('mailCheckNotSet')}
                      </div>
                    </div>
                    <div
                      className="px-3 py-2 rounded-lg border"
                      style={{ backgroundColor: 'var(--color-bg-primary)', borderColor: 'var(--color-border-primary)' }}
                    >
                      <div style={{ color: 'var(--color-text-muted)' }}>{t('mailCheckDmarcSubPolicy')}</div>
                      <div className="mt-0.5 font-mono font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                        {report.checks.dmarc.details.subdomainPolicy || t('mailCheckNotSet')}
                      </div>
                    </div>
                    <div
                      className="px-3 py-2 rounded-lg border"
                      style={{ backgroundColor: 'var(--color-bg-primary)', borderColor: 'var(--color-border-primary)' }}
                    >
                      <div style={{ color: 'var(--color-text-muted)' }}>{t('mailCheckDmarcPct')}</div>
                      <div className="mt-0.5 font-mono font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                        {report.checks.dmarc.details.pct !== null ? `${report.checks.dmarc.details.pct}%` : '100%'}
                      </div>
                    </div>
                    <div
                      className="px-3 py-2 rounded-lg border"
                      style={{ backgroundColor: 'var(--color-bg-primary)', borderColor: 'var(--color-border-primary)' }}
                    >
                      <div style={{ color: 'var(--color-text-muted)' }}>{t('mailCheckDmarcRua')}</div>
                      <div className="mt-0.5 font-mono truncate" title={report.checks.dmarc.details.rua.join(', ')} style={{ color: 'var(--color-text-primary)' }}>
                        {report.checks.dmarc.details.rua.length > 0
                          ? report.checks.dmarc.details.rua.join(', ')
                          : t('mailCheckNotSet')}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {renderIssues(report.checks.dmarc.issues)}
            </section>
          </div>
        )}
      </div>
    </div>
  )
}
