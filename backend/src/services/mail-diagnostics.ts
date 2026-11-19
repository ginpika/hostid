/**
 * 邮箱与域名可用性诊断服务
 * 面向管理员提供 5 项实时检查：
 *   1. 25 端口是否可出口（向外部公网 MX 发起 TCP 25 连接并验证 SMTP 220 横幅）
 *   2. 25 端口是否可入口（验证本地 SMTP 监听，并经公网 MX / 目标地址 25 端口做带 nonce 的 EHLO 回环确认）
 *   3. MX 记录是否合法（存在性、非 Null MX、非 IP 字面量、非 CNAME、可解析为公网 A/AAAA）
 *   4. SPF 记录是否合法（唯一 v=spf1 记录、语法与 CIDR 校验、递归 include/redirect 10 次 DNS 查询上限）
 *   5. DMARC 记录是否合法（_dmarc.<domain> 唯一 v=DMARC1 记录、标签顺序与语法、策略及报告 URI 校验）
 */
import crypto from 'node:crypto'
import dnsPromises from 'node:dns/promises'
import net from 'node:net'
import { domainToASCII } from 'node:url'
import { getSettings, type Settings } from './settings'
import { getSmtpPort, trackInboundProbe } from '../smtp'

export type DiagnosticStatus = 'pass' | 'warn' | 'fail'

export interface DiagnosticMessage {
  code: string
  params?: Record<string, string | number | boolean>
  fallback: string
}

export interface PortCheckTargetResult {
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

export interface MxRecordInfo {
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

export interface SpfCheckDetails {
  record: string | null
  recordCount: number
  dnsLookups: number
  maxDnsLookups: number
  qualifier: string | null
  hasAll: boolean
  hasRedirect: boolean
  mechanisms: string[]
  includedDomains: string[]
}

export interface DmarcCheckDetails {
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
}

export interface MailCheckItem<TDetails = unknown> {
  id: 'outbound25' | 'inbound25' | 'mx' | 'spf' | 'dmarc'
  status: DiagnosticStatus
  durationMs: number
  summary: DiagnosticMessage
  issues: DiagnosticMessage[]
  details: TDetails
}

export interface Outbound25Details {
  targets: PortCheckTargetResult[]
  succeededTarget?: PortCheckTargetResult
  smtpRelayConfigured: boolean
}

export interface Inbound25Details {
  localPort: number
  localReachable: boolean
  localMatchedInstance: boolean
  localBanner?: string
  localError?: string
  publicTargets: PortCheckTargetResult[]
  matchedPublicTarget?: PortCheckTargetResult
  checkedTargetSource: 'mx' | 'domain' | 'siteUrl' | 'none'
}

export interface MxCheckDetails {
  records: MxRecordInfo[]
  rawCount: number
}

export interface MailDiagnosticsReport {
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
    outbound25: MailCheckItem<Outbound25Details>
    inbound25: MailCheckItem<Inbound25Details>
    mx: MailCheckItem<MxCheckDetails>
    spf: MailCheckItem<SpfCheckDetails>
    dmarc: MailCheckItem<DmarcCheckDetails>
  }
}

export interface DnsResolver {
  resolveMx(hostname: string): Promise<{ exchange: string; priority: number }[]>
  resolveTxt(hostname: string): Promise<string[][]>
  resolve4(hostname: string): Promise<string[]>
  resolve6(hostname: string): Promise<string[]>
  resolveCname(hostname: string): Promise<string[]>
}

export interface SmtpProbeInput {
  host: string
  ip?: string
  port: number
  timeoutMs?: number
  sendEhloHost?: string
  signal?: AbortSignal
}

export interface InboundProbeTracker {
  wait(timeoutMs?: number): Promise<boolean>
  cleanup(): void
}

export interface MailDiagnosticsDeps {
  dns?: DnsResolver
  probeSmtp?: (input: SmtpProbeInput) => Promise<PortCheckTargetResult>
  getSettings?: () => Settings
  getSmtpPort?: () => number
  trackInboundProbe?: (ehloHost: string) => InboundProbeTracker
  outboundProbeDomains?: string[]
  dnsTimeoutMs?: number
  smtpTimeoutMs?: number
}

const DEFAULT_DNS_TIMEOUT_MS = 4000
const DEFAULT_SMTP_TIMEOUT_MS = 4500
const MAX_SMTP_RESPONSE_BYTES = 8192
const MAX_SPF_DNS_LOOKUPS = 10
const MAX_SPF_RECURSION_DEPTH = 10
const MAX_SPF_TOTAL_QUERIES = 25
const DEFAULT_OUTBOUND_PROBE_DOMAINS = ['gmail.com', 'outlook.com', 'qq.com']

const NON_PUBLIC_BLOCKLIST = new net.BlockList()
NON_PUBLIC_BLOCKLIST.addSubnet('0.0.0.0', 8, 'ipv4')
NON_PUBLIC_BLOCKLIST.addSubnet('10.0.0.0', 8, 'ipv4')
NON_PUBLIC_BLOCKLIST.addSubnet('100.64.0.0', 10, 'ipv4')
NON_PUBLIC_BLOCKLIST.addSubnet('127.0.0.0', 8, 'ipv4')
NON_PUBLIC_BLOCKLIST.addSubnet('169.254.0.0', 16, 'ipv4')
NON_PUBLIC_BLOCKLIST.addSubnet('172.16.0.0', 12, 'ipv4')
NON_PUBLIC_BLOCKLIST.addSubnet('192.0.0.0', 24, 'ipv4')
NON_PUBLIC_BLOCKLIST.addSubnet('192.0.2.0', 24, 'ipv4')
NON_PUBLIC_BLOCKLIST.addSubnet('192.168.0.0', 16, 'ipv4')
NON_PUBLIC_BLOCKLIST.addSubnet('198.18.0.0', 15, 'ipv4')
NON_PUBLIC_BLOCKLIST.addSubnet('198.51.100.0', 24, 'ipv4')
NON_PUBLIC_BLOCKLIST.addSubnet('203.0.113.0', 24, 'ipv4')
NON_PUBLIC_BLOCKLIST.addSubnet('224.0.0.0', 4, 'ipv4')
NON_PUBLIC_BLOCKLIST.addSubnet('240.0.0.0', 4, 'ipv4')

NON_PUBLIC_BLOCKLIST.addAddress('::', 'ipv6')
NON_PUBLIC_BLOCKLIST.addAddress('::1', 'ipv6')
NON_PUBLIC_BLOCKLIST.addSubnet('fc00::', 7, 'ipv6')
NON_PUBLIC_BLOCKLIST.addSubnet('fe80::', 10, 'ipv6')
NON_PUBLIC_BLOCKLIST.addSubnet('ff00::', 8, 'ipv6')
NON_PUBLIC_BLOCKLIST.addSubnet('2001:db8::', 32, 'ipv6')

export function normalizeDomain(raw: string): string {
  const trimmed = raw.trim().replace(/\.+$/, '')
  if (!trimmed) return ''
  const ascii = domainToASCII(trimmed)
  return (ascii || trimmed).toLowerCase().replace(/\.+$/, '')
}

export function isValidPublicDomain(domain: string): boolean {
  if (!domain || domain.length > 253) return false
  if (net.isIP(domain) !== 0) return false
  if (domain === 'localhost' || domain.endsWith('.localhost') || domain.endsWith('.local')) return false
  const labels = domain.split('.')
  if (labels.length < 2) return false
  return labels.every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
}

export function isPublicIp(ip: string): boolean {
  const family = net.isIP(ip)
  if (!family) return false
  return !NON_PUBLIC_BLOCKLIST.check(ip, family === 4 ? 'ipv4' : 'ipv6')
}

function isDnsNotFoundError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | undefined)?.code
  return code === 'ENODATA' || code === 'ENOTFOUND' || code === 'ENONAME'
}

function formatErrorCode(err: unknown): string {
  const code = (err as NodeJS.ErrnoException | undefined)?.code
  if (code) return code
  return err instanceof Error ? err.message : 'UNKNOWN_ERROR'
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, code = 'ETIMEOUT'): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          const err = new Error(`Operation timed out after ${timeoutMs}ms`) as NodeJS.ErrnoException
          err.code = code
          reject(err)
        }, timeoutMs)
        timer.unref?.()
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function createDefaultDnsResolver(timeoutMs: number): DnsResolver {
  return {
    resolveMx: host => withTimeout(dnsPromises.resolveMx(host), timeoutMs),
    resolveTxt: host => withTimeout(dnsPromises.resolveTxt(host), timeoutMs),
    resolve4: host => withTimeout(dnsPromises.resolve4(host), timeoutMs),
    resolve6: host => withTimeout(dnsPromises.resolve6(host), timeoutMs),
    resolveCname: host => withTimeout(dnsPromises.resolveCname(host), timeoutMs)
  }
}

async function resolvePublicAndPrivateAddresses(
  hostname: string,
  dns: DnsResolver
): Promise<{ publicIps: string[]; privateIps: string[]; error?: string }> {
  const [v4Res, v6Res] = await Promise.allSettled([
    dns.resolve4(hostname),
    dns.resolve6(hostname)
  ])

  const allIps: string[] = []
  const errors: string[] = []

  if (v4Res.status === 'fulfilled') {
    allIps.push(...v4Res.value)
  } else if (!isDnsNotFoundError(v4Res.reason)) {
    errors.push(formatErrorCode(v4Res.reason))
  }

  if (v6Res.status === 'fulfilled') {
    allIps.push(...v6Res.value)
  } else if (!isDnsNotFoundError(v6Res.reason)) {
    errors.push(formatErrorCode(v6Res.reason))
  }

  const publicIps: string[] = []
  const privateIps: string[] = []
  for (const ip of allIps) {
    if (isPublicIp(ip)) publicIps.push(ip)
    else if (net.isIP(ip) !== 0) privateIps.push(ip)
  }

  return {
    publicIps,
    privateIps,
    ...(publicIps.length === 0 && privateIps.length === 0 && errors.length > 0 ? { error: errors[0] } : {})
  }
}

/**
 * 发起一次轻量 SMTP TCP 探针：读取 220 欢迎横幅，可选发送 EHLO，最后发送 QUIT 优雅断开。
 */
export function probeSmtpPort(input: SmtpProbeInput): Promise<PortCheckTargetResult> {
  const timeoutMs = input.timeoutMs ?? DEFAULT_SMTP_TIMEOUT_MS
  const targetHost = input.ip || input.host
  const startedAt = Date.now()

  return new Promise(resolve => {
    if (input.signal?.aborted) {
      resolve({
        host: input.host,
        ip: input.ip,
        port: input.port,
        reachable: false,
        errorCode: 'ABORTED',
        errorMessage: 'Probe aborted'
      })
      return
    }

    const socket = net.createConnection({ host: targetHost, port: input.port })
    let settled = false
    let stage: 'banner' | 'ehlo' | 'quit' = 'banner'
    let buffer = ''
    let totalBytes = 0
    let bannerText = ''
    let responseLines: string[] = []
    let quitTimer: ReturnType<typeof setTimeout> | undefined

    const finish = (result: Omit<PortCheckTargetResult, 'host' | 'ip' | 'port' | 'latencyMs'>) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (quitTimer) clearTimeout(quitTimer)
      input.signal?.removeEventListener('abort', onAbort)
      if (!socket.destroyed) socket.destroy()
      resolve({
        host: input.host,
        ip: input.ip,
        port: input.port,
        latencyMs: Date.now() - startedAt,
        ...result
      })
    }

    const onAbort = () => {
      finish({ reachable: false, errorCode: 'ABORTED', errorMessage: 'Probe aborted' })
    }
    input.signal?.addEventListener('abort', onAbort, { once: true })

    const timer = setTimeout(() => {
      finish({
        reachable: false,
        errorCode: 'ETIMEDOUT',
        errorMessage: `Timed out after ${timeoutMs}ms`
      })
    }, timeoutMs)
    timer.unref?.()

    socket.setTimeout(timeoutMs)

    const handleSmtpLine = (line: string) => {
      const match = /^(\d{3})([ -]?)(.*)$/.exec(line)
      if (!match) {
        finish({
          reachable: false,
          errorCode: 'NOT_SMTP',
          errorMessage: `Non-SMTP response: ${line.slice(0, 120)}`
        })
        return
      }

      const code = match[1]
      const separator = match[2]
      const text = match[3]
      responseLines.push(text ? `${code} ${text}` : code)

      if (separator === '-') {
        return
      }

      const fullReply = responseLines.join(' | ').trim()
      responseLines = []

      if (stage === 'banner') {
        if (code !== '220') {
          try { socket.write('QUIT\r\n') } catch { /* ignore */ }
          finish({
            reachable: false,
            errorCode: `SMTP_${code}`,
            errorMessage: `Unexpected SMTP greeting: ${fullReply}`
          })
          return
        }

        bannerText = fullReply
        if (input.sendEhloHost) {
          stage = 'ehlo'
          socket.write(`EHLO ${input.sendEhloHost}\r\n`)
          return
        }

        stage = 'quit'
        try { socket.end('QUIT\r\n') } catch { /* ignore */ }
        quitTimer = setTimeout(() => finish({ reachable: true, banner: bannerText }), 300)
        quitTimer.unref?.()
        return
      }

      if (stage === 'ehlo') {
        stage = 'quit'
        try { socket.end('QUIT\r\n') } catch { /* ignore */ }
        quitTimer = setTimeout(() => finish({ reachable: true, banner: bannerText }), 300)
        quitTimer.unref?.()
        return
      }

      if (stage === 'quit') {
        finish({ reachable: true, banner: bannerText })
      }
    }

    socket.on('data', chunk => {
      if (settled) return
      totalBytes += chunk.length
      if (totalBytes > MAX_SMTP_RESPONSE_BYTES) {
        finish({
          reachable: false,
          errorCode: 'RESPONSE_TOO_LARGE',
          errorMessage: 'SMTP response exceeded buffer limit'
        })
        return
      }

      buffer += chunk.toString('utf8')
      let newlineIdx: number
      while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIdx).replace(/\r$/, '')
        buffer = buffer.slice(newlineIdx + 1)
        if (!line) continue
        handleSmtpLine(line)
        if (settled) return
      }
    })

    socket.on('timeout', () => {
      finish({
        reachable: false,
        errorCode: 'ETIMEDOUT',
        errorMessage: `Socket timed out after ${timeoutMs}ms`
      })
    })

    socket.on('error', err => {
      const errno = err as NodeJS.ErrnoException
      finish({
        reachable: false,
        errorCode: errno.code || 'SOCKET_ERROR',
        errorMessage: err.message
      })
    })

    socket.on('end', () => {
      if (!settled) {
        if (stage === 'quit') {
          finish({ reachable: true, banner: bannerText })
        } else {
          finish({
            reachable: false,
            errorCode: 'ECONNRESET',
            errorMessage: 'Connection closed before SMTP greeting completed'
          })
        }
      }
    })
  })
}

export async function validateMxRecords(
  domain: string,
  dns: DnsResolver
): Promise<MailCheckItem<MxCheckDetails>> {
  const startedAt = Date.now()
  const issues: DiagnosticMessage[] = []

  if (!isValidPublicDomain(domain)) {
    return {
      id: 'mx',
      status: 'fail',
      durationMs: Date.now() - startedAt,
      summary: {
        code: 'MX_INVALID_DOMAIN',
        params: { domain: domain || '(empty)' },
        fallback: `Domain "${domain || '(empty)'}" is not a valid public mail domain`
      },
      issues: [],
      details: { records: [], rawCount: 0 }
    }
  }

  let rawMx: { exchange: string; priority: number }[]
  try {
    rawMx = await dns.resolveMx(domain)
  } catch (err) {
    const code = formatErrorCode(err)
    if (isDnsNotFoundError(err)) {
      return {
        id: 'mx',
        status: 'fail',
        durationMs: Date.now() - startedAt,
        summary: {
          code: 'MX_NOT_FOUND',
          params: { domain },
          fallback: `No MX records found for ${domain}`
        },
        issues: [],
        details: { records: [], rawCount: 0 }
      }
    }
    return {
      id: 'mx',
      status: 'fail',
      durationMs: Date.now() - startedAt,
      summary: {
        code: 'MX_DNS_ERROR',
        params: { domain, error: code },
        fallback: `Failed to query MX records for ${domain}: ${code}`
      },
      issues: [],
      details: { records: [], rawCount: 0 }
    }
  }

  if (rawMx.length === 0) {
    return {
      id: 'mx',
      status: 'fail',
      durationMs: Date.now() - startedAt,
      summary: {
        code: 'MX_NOT_FOUND',
        params: { domain },
        fallback: `No MX records found for ${domain}`
      },
      issues: [],
      details: { records: [], rawCount: 0 }
    }
  }

  const sorted = [...rawMx].sort((a, b) => a.priority - b.priority)
  const records: MxRecordInfo[] = await Promise.all(
    sorted.map(async entry => {
      const rawExchange = (entry.exchange || '').trim()
      const exchange = rawExchange.replace(/\.+$/, '').toLowerCase()

      if (!rawExchange || rawExchange === '.' || exchange === '') {
        return {
          priority: entry.priority,
          exchange: rawExchange || '.',
          addresses: [],
          privateAddresses: [],
          isNullMx: true
        }
      }

      if (net.isIP(exchange) !== 0) {
        return {
          priority: entry.priority,
          exchange,
          addresses: [],
          privateAddresses: [],
          isIpLiteral: true
        }
      }

      if (!isValidPublicDomain(exchange)) {
        return {
          priority: entry.priority,
          exchange,
          addresses: [],
          privateAddresses: [],
          error: 'INVALID_HOSTNAME'
        }
      }

      const [cnameRes, addrRes] = await Promise.all([
        dns.resolveCname(exchange).catch(() => [] as string[]),
        resolvePublicAndPrivateAddresses(exchange, dns)
      ])

      const cnameTarget = cnameRes.length > 0 ? cnameRes[0].replace(/\.+$/, '').toLowerCase() : undefined
      return {
        priority: entry.priority,
        exchange,
        addresses: addrRes.publicIps,
        privateAddresses: addrRes.privateIps,
        ...(cnameTarget ? { isCname: true, cnameTarget } : {}),
        ...(addrRes.error ? { error: addrRes.error } : {})
      }
    })
  )

  const hasNullMx = records.some(r => r.isNullMx)
  const ipLiteralRecords = records.filter(r => r.isIpLiteral)
  const invalidHostRecords = records.filter(r => r.error === 'INVALID_HOSTNAME')
  const cnameRecords = records.filter(r => r.isCname)
  const validPublicRecords = records.filter(r => !r.isNullMx && !r.isIpLiteral && r.error !== 'INVALID_HOSTNAME' && r.addresses.length > 0)
  const privateOnlyRecords = records.filter(r => !r.isNullMx && !r.isIpLiteral && r.addresses.length === 0 && r.privateAddresses.length > 0)
  const unresolvableRecords = records.filter(
    r => !r.isNullMx && !r.isIpLiteral && r.error !== 'INVALID_HOSTNAME' && r.addresses.length === 0 && r.privateAddresses.length === 0
  )

  if (hasNullMx) {
    issues.push({
      code: 'MX_ISSUE_NULL_MX',
      fallback: 'Null MX (".") explicitly rejects all incoming mail (RFC 7505)'
    })
  }
  for (const r of ipLiteralRecords) {
    issues.push({
      code: 'MX_ISSUE_IP_LITERAL',
      params: { exchange: r.exchange },
      fallback: `MX target "${r.exchange}" must be a hostname, not an IP address (RFC 5321)`
    })
  }
  for (const r of invalidHostRecords) {
    issues.push({
      code: 'MX_ISSUE_INVALID_HOST',
      params: { exchange: r.exchange },
      fallback: `MX target "${r.exchange}" is not a valid public hostname`
    })
  }
  for (const r of privateOnlyRecords) {
    issues.push({
      code: 'MX_ISSUE_PRIVATE_IP',
      params: { exchange: r.exchange, ips: r.privateAddresses.join(', ') },
      fallback: `MX target "${r.exchange}" resolves only to private/reserved IP(s): ${r.privateAddresses.join(', ')}`
    })
  }
  for (const r of unresolvableRecords) {
    issues.push({
      code: 'MX_ISSUE_UNRESOLVABLE',
      params: { exchange: r.exchange },
      fallback: `MX target "${r.exchange}" has no public A or AAAA records`
    })
  }
  for (const r of cnameRecords) {
    issues.push({
      code: 'MX_ISSUE_CNAME',
      params: { exchange: r.exchange, target: r.cnameTarget || '' },
      fallback: `MX target "${r.exchange}" is a CNAME; RFC 2181 requires MX targets to resolve directly to A/AAAA`
    })
  }

  let status: DiagnosticStatus
  let summary: DiagnosticMessage

  if (hasNullMx) {
    status = 'fail'
    summary = {
      code: 'MX_NULL_RECORD',
      params: { domain },
      fallback: `${domain} has a Null MX record that disables mail delivery`
    }
  } else if (ipLiteralRecords.length > 0 || invalidHostRecords.length > 0) {
    status = 'fail'
    summary = {
      code: 'MX_INVALID_EXCHANGE',
      params: { domain },
      fallback: `MX records for ${domain} contain invalid host targets`
    }
  } else if (validPublicRecords.length === 0) {
    status = 'fail'
    summary = privateOnlyRecords.length > 0
      ? {
          code: 'MX_PRIVATE_IP',
          params: { domain },
          fallback: `MX targets for ${domain} resolve only to non-public IP addresses`
        }
      : {
          code: 'MX_EXCHANGE_UNRESOLVABLE',
          params: { domain },
          fallback: `MX targets for ${domain} cannot resolve to any public A/AAAA address`
        }
  } else if (issues.length > 0) {
    status = 'warn'
    summary = {
      code: 'MX_VALID_WITH_WARNINGS',
      params: { domain, count: validPublicRecords.length },
      fallback: `Found ${validPublicRecords.length} usable MX record(s) for ${domain}, with warnings`
    }
  } else {
    status = 'pass'
    summary = {
      code: 'MX_VALID',
      params: { domain, count: validPublicRecords.length, primary: validPublicRecords[0].exchange },
      fallback: `${domain} has ${validPublicRecords.length} valid MX record(s) (primary: ${validPublicRecords[0].exchange})`
    }
  }

  return {
    id: 'mx',
    status,
    durationMs: Date.now() - startedAt,
    summary,
    issues,
    details: { records, rawCount: rawMx.length }
  }
}

function isValidSpfDomainSpec(spec: string): boolean {
  if (!spec || /\s/.test(spec)) return false
  if (spec.includes('%{')) {
    const cleaned = spec.replace(/%\{[slodiphcrtv]\d*r?[.+-,/_=-]*\}/gi, 'macro').replace(/%[%\-_]/g, 'x')
    if (cleaned.includes('%')) return false
    return /^[a-z0-9._-]+$/i.test(cleaned)
  }
  const normalized = spec.replace(/\.+$/, '')
  if (!normalized || normalized.length > 253 || net.isIP(normalized) !== 0) return false
  const labels = normalized.split('.')
  if (labels.length < 2) return false
  return labels.every(label => /^[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?$/i.test(label))
}

function validateCidrPair(v4Str?: string, v6Str?: string): boolean {
  if (v4Str !== undefined) {
    if (!/^\d+$/.test(v4Str)) return false
    const n = Number(v4Str)
    if (n < 0 || n > 32) return false
  }
  if (v6Str !== undefined) {
    if (!/^\d+$/.test(v6Str)) return false
    const n = Number(v6Str)
    if (n < 0 || n > 128) return false
  }
  return true
}

interface SpfEvalState {
  dnsLookups: number
  dnsQueries: number
  visited: Set<string>
  errors: DiagnosticMessage[]
  warnings: DiagnosticMessage[]
  includedDomains: string[]
}

async function evaluateSpfRecordTree(
  domain: string,
  record: string,
  depth: number,
  dns: DnsResolver,
  state: SpfEvalState
): Promise<{
  hasAll: boolean
  qualifier: string | null
  hasRedirect: boolean
  mechanisms: string[]
  seenAfterAll: boolean
}> {
  const tokens = record.trim().split(/\s+/).filter(Boolean)
  const mechanisms: string[] = []
  let hasAll = false
  let qualifier: string | null = null
  let hasRedirect = false
  let hasExp = false
  let seenAfterAll = false

  if (tokens.length === 0 || tokens[0].toLowerCase() !== 'v=spf1') {
    state.errors.push({
      code: 'SPF_ISSUE_INVALID_VERSION',
      params: { domain },
      fallback: `SPF record on ${domain} must begin with "v=spf1"`
    })
    return { hasAll, qualifier, hasRedirect, mechanisms, seenAfterAll }
  }

  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i]
    mechanisms.push(token)

    const hasExplicitQualifier = /^[+\-~?]/.test(token)
    const modMatch = !hasExplicitQualifier ? /^([a-z][a-z0-9_.-]*)=(.*)$/i.exec(token) : null

    if (modMatch) {
      const modName = modMatch[1].toLowerCase()
      const modVal = modMatch[2]

      if (modName === 'redirect') {
        if (hasRedirect) {
          state.errors.push({
            code: 'SPF_ISSUE_DUPLICATE_MODIFIER',
            params: { modifier: 'redirect', domain },
            fallback: `Duplicate "redirect=" modifier in SPF record for ${domain}`
          })
          continue
        }
        hasRedirect = true
        if (!isValidSpfDomainSpec(modVal)) {
          state.errors.push({
            code: 'SPF_ISSUE_INVALID_DOMAIN_SPEC',
            params: { term: token },
            fallback: `Invalid domain-spec in "${token}"`
          })
          continue
        }
        state.dnsLookups += 1
        if (!modVal.includes('%{')) {
          const target = modVal.replace(/\.+$/, '').toLowerCase()
          state.includedDomains.push(target)
          await followSpfTarget(target, 'redirect', depth + 1, dns, state)
        }
        continue
      }

      if (modName === 'exp') {
        if (hasExp) {
          state.errors.push({
            code: 'SPF_ISSUE_DUPLICATE_MODIFIER',
            params: { modifier: 'exp', domain },
            fallback: `Duplicate "exp=" modifier in SPF record for ${domain}`
          })
        }
        hasExp = true
        if (!isValidSpfDomainSpec(modVal)) {
          state.errors.push({
            code: 'SPF_ISSUE_INVALID_DOMAIN_SPEC',
            params: { term: token },
            fallback: `Invalid domain-spec in "${token}"`
          })
        }
        continue
      }

      if (['include', 'ip4', 'ip6', 'a', 'mx', 'ptr', 'exists'].includes(modName)) {
        state.warnings.push({
          code: 'SPF_ISSUE_TYPO_EQUALS',
          params: { term: token, expected: `${modName}:${modVal}` },
          fallback: `Term "${token}" uses "=" instead of ":"; did you mean "${modName}:${modVal}"?`
        })
      }
      continue
    }

    if (hasAll && depth === 0) {
      seenAfterAll = true
    }

    const q = hasExplicitQualifier ? token[0] : '+'
    const body = hasExplicitQualifier ? token.slice(1) : token

    if (body.toLowerCase() === 'all') {
      hasAll = true
      if (depth === 0) {
        qualifier = q
        if (q === '+') {
          state.warnings.push({
            code: 'SPF_ISSUE_PLUS_ALL',
            fallback: 'SPF uses "+all", allowing any host on the internet to send as this domain'
          })
        } else if (q === '?') {
          state.warnings.push({
            code: 'SPF_ISSUE_NEUTRAL_ALL',
            fallback: 'SPF uses "?all" (neutral); consider "~all" or "-all"'
          })
        }
      }
      continue
    }

    if (/^ip4:/i.test(body)) {
      const arg = body.slice(4)
      const slashIdx = arg.indexOf('/')
      const ip = slashIdx === -1 ? arg : arg.slice(0, slashIdx)
      const prefix = slashIdx === -1 ? undefined : arg.slice(slashIdx + 1)
      if (!net.isIPv4(ip) || (prefix !== undefined && !validateCidrPair(prefix, undefined))) {
        state.errors.push({
          code: 'SPF_ISSUE_INVALID_IP4',
          params: { term: token },
          fallback: `Invalid ip4 mechanism: "${token}"`
        })
      }
      continue
    }

    if (/^ip6:/i.test(body)) {
      const arg = body.slice(4)
      const slashIdx = arg.indexOf('/')
      const ip = slashIdx === -1 ? arg : arg.slice(0, slashIdx)
      const prefix = slashIdx === -1 ? undefined : arg.slice(slashIdx + 1)
      if (!net.isIPv6(ip) || (prefix !== undefined && !validateCidrPair(undefined, prefix))) {
        state.errors.push({
          code: 'SPF_ISSUE_INVALID_IP6',
          params: { term: token },
          fallback: `Invalid ip6 mechanism: "${token}"`
        })
      }
      continue
    }

    const amxMatch = /^(a|mx)(?::([^/]+))?(?:\/(\d+)(?:\/\/(\d+))?|\/\/(\d+))?$/i.exec(body)
    if (amxMatch) {
      const targetDomain = amxMatch[2]
      const v4Cidr = amxMatch[3]
      const v6Cidr = amxMatch[4] ?? amxMatch[5]
      if ((targetDomain && !isValidSpfDomainSpec(targetDomain)) || !validateCidrPair(v4Cidr, v6Cidr)) {
        state.errors.push({
          code: 'SPF_ISSUE_INVALID_TERM',
          params: { term: token },
          fallback: `Invalid SPF term: "${token}"`
        })
        continue
      }
      state.dnsLookups += 1
      continue
    }

    const ptrMatch = /^ptr(?::(.+))?$/i.exec(body)
    if (ptrMatch) {
      if (ptrMatch[1] && !isValidSpfDomainSpec(ptrMatch[1])) {
        state.errors.push({
          code: 'SPF_ISSUE_INVALID_TERM',
          params: { term: token },
          fallback: `Invalid SPF term: "${token}"`
        })
        continue
      }
      state.dnsLookups += 1
      if (depth === 0) {
        state.warnings.push({
          code: 'SPF_ISSUE_DEPRECATED_PTR',
          fallback: 'The "ptr" mechanism is deprecated by RFC 7208 and unreliable'
        })
      }
      continue
    }

    const existsMatch = /^exists:(.+)$/i.exec(body)
    if (existsMatch) {
      if (!isValidSpfDomainSpec(existsMatch[1])) {
        state.errors.push({
          code: 'SPF_ISSUE_INVALID_DOMAIN_SPEC',
          params: { term: token },
          fallback: `Invalid domain-spec in "${token}"`
        })
        continue
      }
      state.dnsLookups += 1
      continue
    }

    const includeMatch = /^include:(.+)$/i.exec(body)
    if (includeMatch) {
      const targetRaw = includeMatch[1]
      if (!isValidSpfDomainSpec(targetRaw)) {
        state.errors.push({
          code: 'SPF_ISSUE_INVALID_DOMAIN_SPEC',
          params: { term: token },
          fallback: `Invalid domain-spec in "${token}"`
        })
        continue
      }
      state.dnsLookups += 1
      if (!targetRaw.includes('%{')) {
        const target = targetRaw.replace(/\.+$/, '').toLowerCase()
        state.includedDomains.push(target)
        await followSpfTarget(target, 'include', depth + 1, dns, state)
      }
      continue
    }

    state.errors.push({
      code: 'SPF_ISSUE_INVALID_TERM',
      params: { term: token },
      fallback: `Unrecognized or malformed SPF mechanism: "${token}"`
    })
  }

  return { hasAll, qualifier, hasRedirect, mechanisms, seenAfterAll }
}

async function followSpfTarget(
  target: string,
  kind: 'include' | 'redirect',
  depth: number,
  dns: DnsResolver,
  state: SpfEvalState
): Promise<void> {
  if (state.visited.has(target)) {
    state.errors.push({
      code: 'SPF_ISSUE_CYCLE',
      params: { target },
      fallback: `Circular SPF ${kind} detected for ${target}`
    })
    return
  }
  if (depth > MAX_SPF_RECURSION_DEPTH || state.dnsQueries >= MAX_SPF_TOTAL_QUERIES || state.dnsLookups > MAX_SPF_DNS_LOOKUPS) {
    return
  }

  state.visited.add(target)
  state.dnsQueries += 1

  try {
    const txt = await dns.resolveTxt(target)
    const spfRecords = txt.map(chunks => chunks.join('')).filter(r => /^v=spf1(?:\s|$)/i.test(r))
    if (spfRecords.length === 0) {
      state.errors.push({
        code: 'SPF_ISSUE_INCLUDE_MISSING',
        params: { target, kind },
        fallback: `SPF ${kind} target "${target}" has no SPF record (PermError)`
      })
      return
    }
    if (spfRecords.length > 1) {
      state.errors.push({
        code: 'SPF_ISSUE_INCLUDE_MULTIPLE',
        params: { target, count: spfRecords.length },
        fallback: `SPF ${kind} target "${target}" has ${spfRecords.length} SPF records (PermError)`
      })
      return
    }
    await evaluateSpfRecordTree(target, spfRecords[0], depth, dns, state)
  } catch (err) {
    state.errors.push({
      code: 'SPF_ISSUE_INCLUDE_DNS_ERROR',
      params: { target, kind, error: formatErrorCode(err) },
      fallback: `Failed to resolve SPF ${kind} target "${target}": ${formatErrorCode(err)}`
    })
  } finally {
    state.visited.delete(target)
  }
}

export async function validateSpfRecord(
  domain: string,
  dns: DnsResolver
): Promise<MailCheckItem<SpfCheckDetails>> {
  const startedAt = Date.now()
  const emptyDetails: SpfCheckDetails = {
    record: null,
    recordCount: 0,
    dnsLookups: 0,
    maxDnsLookups: MAX_SPF_DNS_LOOKUPS,
    qualifier: null,
    hasAll: false,
    hasRedirect: false,
    mechanisms: [],
    includedDomains: []
  }

  if (!isValidPublicDomain(domain)) {
    return {
      id: 'spf',
      status: 'fail',
      durationMs: Date.now() - startedAt,
      summary: {
        code: 'SPF_INVALID_DOMAIN',
        params: { domain: domain || '(empty)' },
        fallback: `Domain "${domain || '(empty)'}" is not a valid public mail domain`
      },
      issues: [],
      details: emptyDetails
    }
  }

  let txtRows: string[][]
  try {
    txtRows = await dns.resolveTxt(domain)
  } catch (err) {
    if (isDnsNotFoundError(err)) {
      return {
        id: 'spf',
        status: 'fail',
        durationMs: Date.now() - startedAt,
        summary: {
          code: 'SPF_NOT_FOUND',
          params: { domain },
          fallback: `No SPF TXT record found for ${domain}`
        },
        issues: [],
        details: emptyDetails
      }
    }
    const code = formatErrorCode(err)
    return {
      id: 'spf',
      status: 'fail',
      durationMs: Date.now() - startedAt,
      summary: {
        code: 'SPF_DNS_ERROR',
        params: { domain, error: code },
        fallback: `Failed to query TXT records for ${domain}: ${code}`
      },
      issues: [],
      details: emptyDetails
    }
  }

  const allTxt = txtRows.map(chunks => chunks.join(''))
  const spfRecords = allTxt.filter(r => /^v=spf1(?:\s|$)/i.test(r))

  if (spfRecords.length === 0) {
    const nearMiss = allTxt.find(r => /^(?:v\s*=\s*spf|spf1\b)/i.test(r))
    return {
      id: 'spf',
      status: 'fail',
      durationMs: Date.now() - startedAt,
      summary: {
        code: 'SPF_NOT_FOUND',
        params: { domain },
        fallback: `No SPF TXT record found for ${domain}`
      },
      issues: nearMiss
        ? [{
            code: 'SPF_ISSUE_NEAR_MISS',
            params: { record: nearMiss },
            fallback: `Found TXT record "${nearMiss}" that does not start with valid "v=spf1 "`
          }]
        : [],
      details: emptyDetails
    }
  }

  if (spfRecords.length > 1) {
    return {
      id: 'spf',
      status: 'fail',
      durationMs: Date.now() - startedAt,
      summary: {
        code: 'SPF_MULTIPLE_RECORDS',
        params: { domain, count: spfRecords.length },
        fallback: `Found ${spfRecords.length} SPF records on ${domain}; RFC 7208 permits at most 1 (PermError)`
      },
      issues: [],
      details: {
        ...emptyDetails,
        record: spfRecords[0],
        recordCount: spfRecords.length
      }
    }
  }

  const record = spfRecords[0]
  const state: SpfEvalState = {
    dnsLookups: 0,
    dnsQueries: 1,
    visited: new Set([domain]),
    errors: [],
    warnings: [],
    includedDomains: []
  }

  const rootEval = await evaluateSpfRecordTree(domain, record, 0, dns, state)

  if (state.dnsLookups > MAX_SPF_DNS_LOOKUPS) {
    state.errors.push({
      code: 'SPF_ISSUE_TOO_MANY_LOOKUPS',
      params: { count: state.dnsLookups, max: MAX_SPF_DNS_LOOKUPS },
      fallback: `SPF requires ${state.dnsLookups} DNS lookups, exceeding the RFC 7208 limit of ${MAX_SPF_DNS_LOOKUPS}`
    })
  } else if (state.dnsLookups >= 8) {
    state.warnings.push({
      code: 'SPF_ISSUE_HIGH_LOOKUPS',
      params: { count: state.dnsLookups, max: MAX_SPF_DNS_LOOKUPS },
      fallback: `SPF uses ${state.dnsLookups}/${MAX_SPF_DNS_LOOKUPS} DNS lookups, close to the RFC limit`
    })
  }

  if (rootEval.hasAll && rootEval.hasRedirect) {
    state.warnings.push({
      code: 'SPF_ISSUE_ALL_AND_REDIRECT',
      fallback: 'Both "all" and "redirect=" are present; RFC 7208 ignores "redirect=" when "all" is present'
    })
  } else if (!rootEval.hasAll && !rootEval.hasRedirect) {
    state.warnings.push({
      code: 'SPF_ISSUE_NO_TERMINATOR',
      fallback: 'SPF record lacks an "all" mechanism (such as "~all" or "-all") or "redirect="'
    })
  }

  if (rootEval.seenAfterAll) {
    state.warnings.push({
      code: 'SPF_ISSUE_TERMS_AFTER_ALL',
      fallback: 'Terms appearing after "all" are never evaluated'
    })
  }

  if (record.length > 450) {
    state.warnings.push({
      code: 'SPF_ISSUE_LONG_RECORD',
      params: { length: record.length },
      fallback: `SPF record is ${record.length} bytes long (RFC 7208 recommends keeping DNS UDP responses <= 450 bytes)`
    })
  }

  const issues = [...state.errors, ...state.warnings]
  let status: DiagnosticStatus
  let summary: DiagnosticMessage

  if (state.errors.length > 0) {
    status = 'fail'
    summary = {
      code: 'SPF_INVALID',
      params: { domain },
      fallback: `SPF record for ${domain} is invalid`
    }
  } else if (state.warnings.length > 0) {
    status = 'warn'
    summary = {
      code: 'SPF_VALID_WITH_WARNINGS',
      params: { domain },
      fallback: `SPF record for ${domain} is syntactically valid but has warnings`
    }
  } else {
    status = 'pass'
    summary = {
      code: 'SPF_VALID',
      params: { domain, lookups: state.dnsLookups, max: MAX_SPF_DNS_LOOKUPS },
      fallback: `SPF record for ${domain} is valid (${state.dnsLookups}/${MAX_SPF_DNS_LOOKUPS} DNS lookups)`
    }
  }

  return {
    id: 'spf',
    status,
    durationMs: Date.now() - startedAt,
    summary,
    issues,
    details: {
      record,
      recordCount: 1,
      dnsLookups: state.dnsLookups,
      maxDnsLookups: MAX_SPF_DNS_LOOKUPS,
      qualifier: rootEval.qualifier,
      hasAll: rootEval.hasAll,
      hasRedirect: rootEval.hasRedirect,
      mechanisms: rootEval.mechanisms,
      includedDomains: [...new Set(state.includedDomains)]
    }
  }
}

function isValidDmarcMailtoUri(rawUri: string): boolean {
  const match = /^mailto:([^\s@,!]+)@([^\s@,!]+?)(?:!(\d+[kmgt]?))?$/i.exec(rawUri.trim())
  if (!match) return false
  const host = match[2]
  return host.includes('.') && /^[a-z0-9.-]+$/i.test(host)
}

export async function validateDmarcRecord(
  domain: string,
  dns: DnsResolver
): Promise<MailCheckItem<DmarcCheckDetails>> {
  const startedAt = Date.now()
  const lookupDomain = domain ? `_dmarc.${domain}` : '_dmarc'
  const emptyDetails: DmarcCheckDetails = {
    record: null,
    recordCount: 0,
    lookupDomain,
    policy: null,
    subdomainPolicy: null,
    pct: null,
    adkim: null,
    aspf: null,
    rua: [],
    ruf: []
  }

  if (!isValidPublicDomain(domain)) {
    return {
      id: 'dmarc',
      status: 'fail',
      durationMs: Date.now() - startedAt,
      summary: {
        code: 'DMARC_INVALID_DOMAIN',
        params: { domain: domain || '(empty)' },
        fallback: `Domain "${domain || '(empty)'}" is not a valid public mail domain`
      },
      issues: [],
      details: emptyDetails
    }
  }

  let txtRows: string[][]
  try {
    txtRows = await dns.resolveTxt(lookupDomain)
  } catch (err) {
    if (isDnsNotFoundError(err)) {
      return {
        id: 'dmarc',
        status: 'fail',
        durationMs: Date.now() - startedAt,
        summary: {
          code: 'DMARC_NOT_FOUND',
          params: { lookupDomain },
          fallback: `No DMARC TXT record found at ${lookupDomain}`
        },
        issues: [],
        details: emptyDetails
      }
    }
    const code = formatErrorCode(err)
    return {
      id: 'dmarc',
      status: 'fail',
      durationMs: Date.now() - startedAt,
      summary: {
        code: 'DMARC_DNS_ERROR',
        params: { lookupDomain, error: code },
        fallback: `Failed to query TXT records at ${lookupDomain}: ${code}`
      },
      issues: [],
      details: emptyDetails
    }
  }

  const dmarcRecords = txtRows
    .map(chunks => chunks.join(''))
    .filter(r => /^v\s*=\s*dmarc1(?:\s*;|$)/i.test(r.trim()))

  if (dmarcRecords.length === 0) {
    return {
      id: 'dmarc',
      status: 'fail',
      durationMs: Date.now() - startedAt,
      summary: {
        code: 'DMARC_NOT_FOUND',
        params: { lookupDomain },
        fallback: `No DMARC TXT record found at ${lookupDomain}`
      },
      issues: [],
      details: emptyDetails
    }
  }

  if (dmarcRecords.length > 1) {
    return {
      id: 'dmarc',
      status: 'fail',
      durationMs: Date.now() - startedAt,
      summary: {
        code: 'DMARC_MULTIPLE_RECORDS',
        params: { lookupDomain, count: dmarcRecords.length },
        fallback: `Found ${dmarcRecords.length} DMARC records at ${lookupDomain}; RFC 7489 requires at most 1`
      },
      issues: [],
      details: {
        ...emptyDetails,
        record: dmarcRecords[0],
        recordCount: dmarcRecords.length
      }
    }
  }

  const record = dmarcRecords[0].trim()
  const rawSegments = record.split(';')
  const segments: string[] = []
  const errors: DiagnosticMessage[] = []
  const warnings: DiagnosticMessage[] = []

  for (let i = 0; i < rawSegments.length; i++) {
    const seg = rawSegments[i].trim()
    if (!seg) {
      if (i < rawSegments.length - 1) {
        errors.push({
          code: 'DMARC_ISSUE_EMPTY_TAG',
          fallback: 'DMARC record contains an empty semicolon segment (";;")'
        })
      }
      continue
    }
    segments.push(seg)
  }

  const seenTags = new Set<string>()
  let policy: string | null = null
  let subdomainPolicy: string | null = null
  let pct: number | null = null
  let adkim: string | null = null
  let aspf: string | null = null
  const rua: string[] = []
  const ruf: string[] = []

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    const eqIdx = seg.indexOf('=')
    if (eqIdx <= 0) {
      errors.push({
        code: 'DMARC_ISSUE_SYNTAX',
        params: { segment: seg },
        fallback: `Invalid DMARC tag syntax: "${seg}"`
      })
      continue
    }

    const tag = seg.slice(0, eqIdx).trim().toLowerCase()
    const value = seg.slice(eqIdx + 1).trim()

    if (i === 0) {
      if (tag !== 'v') {
        errors.push({
          code: 'DMARC_ISSUE_VERSION_FIRST',
          fallback: 'Tag "v=DMARC1" must be the first tag in a DMARC record'
        })
      } else if (value !== 'DMARC1') {
        errors.push({
          code: 'DMARC_ISSUE_VERSION_CASE',
          params: { value },
          fallback: `DMARC version tag value "${value}" must be uppercase "DMARC1" (RFC 7489)`
        })
      }
    }

    if (seenTags.has(tag)) {
      errors.push({
        code: 'DMARC_ISSUE_DUPLICATE_TAG',
        params: { tag },
        fallback: `Duplicate DMARC tag "${tag}"`
      })
      continue
    }
    seenTags.add(tag)

    switch (tag) {
      case 'v':
        break
      case 'p': {
        const lower = value.toLowerCase()
        if (!['none', 'quarantine', 'reject'].includes(lower)) {
          errors.push({
            code: 'DMARC_ISSUE_INVALID_POLICY',
            params: { tag: 'p', value },
            fallback: `Invalid policy "p=${value}"; must be none, quarantine, or reject`
          })
        } else {
          policy = lower
        }
        break
      }
      case 'sp': {
        const lower = value.toLowerCase()
        if (!['none', 'quarantine', 'reject'].includes(lower)) {
          errors.push({
            code: 'DMARC_ISSUE_INVALID_POLICY',
            params: { tag: 'sp', value },
            fallback: `Invalid subdomain policy "sp=${value}"; must be none, quarantine, or reject`
          })
        } else {
          subdomainPolicy = lower
        }
        break
      }
      case 'pct': {
        if (!/^\d+$/.test(value) || Number(value) < 0 || Number(value) > 100) {
          errors.push({
            code: 'DMARC_ISSUE_INVALID_PCT',
            params: { value },
            fallback: `Invalid "pct=${value}"; must be an integer between 0 and 100`
          })
        } else {
          pct = Number(value)
        }
        break
      }
      case 'adkim': {
        const lower = value.toLowerCase()
        if (lower !== 'r' && lower !== 's') {
          errors.push({
            code: 'DMARC_ISSUE_INVALID_ALIGNMENT',
            params: { tag: 'adkim', value },
            fallback: `Invalid "adkim=${value}"; must be "r" or "s"`
          })
        } else {
          adkim = lower
        }
        break
      }
      case 'aspf': {
        const lower = value.toLowerCase()
        if (lower !== 'r' && lower !== 's') {
          errors.push({
            code: 'DMARC_ISSUE_INVALID_ALIGNMENT',
            params: { tag: 'aspf', value },
            fallback: `Invalid "aspf=${value}"; must be "r" or "s"`
          })
        } else {
          aspf = lower
        }
        break
      }
      case 'ri': {
        if (!/^\d+$/.test(value) || Number(value) <= 0) {
          errors.push({
            code: 'DMARC_ISSUE_INVALID_RI',
            params: { value },
            fallback: `Invalid reporting interval "ri=${value}"; must be a positive integer`
          })
        }
        break
      }
      case 'fo': {
        const items = value.split(':').map(item => item.trim().toLowerCase())
        if (items.length === 0 || items.some(item => !['0', '1', 'd', 's'].includes(item))) {
          errors.push({
            code: 'DMARC_ISSUE_INVALID_FO',
            params: { value },
            fallback: `Invalid "fo=${value}"; allowed values are 0, 1, d, s separated by ":"`
          })
        }
        break
      }
      case 'rf': {
        const items = value.split(':').map(item => item.trim().toLowerCase())
        if (items.length === 0 || items.some(item => !item)) {
          errors.push({
            code: 'DMARC_ISSUE_SYNTAX',
            params: { segment: seg },
            fallback: `Invalid "rf" value: "${value}"`
          })
        } else if (items.some(item => item !== 'afrf')) {
          warnings.push({
            code: 'DMARC_ISSUE_UNCOMMON_RF',
            params: { value },
            fallback: `Report format "rf=${value}" uses non-standard format (RFC 7489 defines "afrf")`
          })
        }
        break
      }
      case 'rua':
      case 'ruf': {
        const uris = value.split(',').map(u => u.trim()).filter(Boolean)
        if (uris.length === 0) {
          errors.push({
            code: 'DMARC_ISSUE_INVALID_URI',
            params: { tag, uri: value },
            fallback: `Tag "${tag}" has no valid mailto: URI`
          })
        } else {
          for (const uri of uris) {
            if (!isValidDmarcMailtoUri(uri)) {
              errors.push({
                code: 'DMARC_ISSUE_INVALID_URI',
                params: { tag, uri },
                fallback: `Invalid DMARC reporting URI in "${tag}": "${uri}" (expected mailto:user@domain)`
              })
            } else if (tag === 'rua') {
              rua.push(uri)
            } else {
              ruf.push(uri)
            }
          }
        }
        break
      }
      default: {
        warnings.push({
          code: 'DMARC_ISSUE_UNKNOWN_TAG',
          params: { tag },
          fallback: `Unknown DMARC tag "${tag}"`
        })
      }
    }
  }

  if (!seenTags.has('p')) {
    errors.push({
      code: 'DMARC_ISSUE_MISSING_POLICY',
      fallback: 'Required DMARC tag "p=" (policy) is missing'
    })
  }

  if (policy === 'none' && rua.length === 0 && errors.length === 0) {
    warnings.push({
      code: 'DMARC_ISSUE_NONE_WITHOUT_RUA',
      fallback: 'Policy is "p=none" without a "rua=" reporting address; no enforcement or reporting occurs'
    })
  }

  const issues = [...errors, ...warnings]
  let status: DiagnosticStatus
  let summary: DiagnosticMessage

  if (errors.length > 0) {
    status = 'fail'
    summary = {
      code: 'DMARC_INVALID',
      params: { lookupDomain },
      fallback: `DMARC record at ${lookupDomain} is invalid`
    }
  } else if (warnings.length > 0) {
    status = 'warn'
    summary = {
      code: 'DMARC_VALID_WITH_WARNINGS',
      params: { lookupDomain, policy: policy || '' },
      fallback: `DMARC record at ${lookupDomain} is valid (p=${policy}) with warnings`
    }
  } else {
    status = 'pass'
    summary = {
      code: 'DMARC_VALID',
      params: { lookupDomain, policy: policy || '' },
      fallback: `DMARC record at ${lookupDomain} is valid (p=${policy})`
    }
  }

  return {
    id: 'dmarc',
    status,
    durationMs: Date.now() - startedAt,
    summary,
    issues,
    details: {
      record,
      recordCount: 1,
      lookupDomain,
      policy,
      subdomainPolicy,
      pct,
      adkim,
      aspf,
      rua,
      ruf
    }
  }
}

async function checkOutbound25(
  dns: DnsResolver,
  probeSmtp: (input: SmtpProbeInput) => Promise<PortCheckTargetResult>,
  probeDomains: string[],
  smtpTimeoutMs: number,
  smtpRelayConfigured: boolean,
  relayHost: string,
  relayPort: number
): Promise<MailCheckItem<Outbound25Details>> {
  const startedAt = Date.now()

  const candidateTargets = (
    await Promise.all(
      probeDomains.map(async probeDomain => {
        try {
          const mxList = await dns.resolveMx(probeDomain)
          const sorted = [...mxList].sort((a, b) => a.priority - b.priority)
          for (const mx of sorted) {
            const exchange = (mx.exchange || '').trim().replace(/\.+$/, '').toLowerCase()
            if (!exchange || exchange === '.' || !isValidPublicDomain(exchange)) continue
            const { publicIps } = await resolvePublicAndPrivateAddresses(exchange, dns)
            if (publicIps.length > 0) {
              return { host: exchange, ip: publicIps[0], port: 25 }
            }
          }
        } catch {
          // ignore failing probe domain DNS resolution
        }
        return null
      })
    )
  ).filter((target): target is { host: string; ip: string; port: number } => target !== null)

  if (candidateTargets.length === 0) {
    const issues: DiagnosticMessage[] = smtpRelayConfigured
      ? [{
          code: 'OUTBOUND25_RELAY_FALLBACK',
          params: { host: relayHost, port: relayPort },
          fallback: `SMTP relay (${relayHost}:${relayPort}) is configured for outbound mail`
        }]
      : []

    return {
      id: 'outbound25',
      status: 'fail',
      durationMs: Date.now() - startedAt,
      summary: {
        code: 'OUTBOUND25_NO_TARGETS',
        fallback: 'Unable to resolve any external MX target to test outbound port 25'
      },
      issues,
      details: {
        targets: [],
        smtpRelayConfigured
      }
    }
  }

  const controller = new AbortController()
  let succeededTarget: PortCheckTargetResult | undefined

  const settledTargets = await Promise.all(
    candidateTargets.map(async candidate => {
      const result = await probeSmtp({
        host: candidate.host,
        ip: candidate.ip,
        port: 25,
        timeoutMs: smtpTimeoutMs,
        signal: controller.signal
      })
      if (result.reachable && !succeededTarget) {
        succeededTarget = result
        controller.abort()
      }
      return result
    })
  )

  if (succeededTarget) {
    const reportedTargets = settledTargets.filter(target => target.errorCode !== 'ABORTED')
    return {
      id: 'outbound25',
      status: 'pass',
      durationMs: Date.now() - startedAt,
      summary: {
        code: 'OUTBOUND25_OPEN',
        params: {
          host: succeededTarget.host,
          ip: succeededTarget.ip || '',
          latencyMs: succeededTarget.latencyMs ?? 0
        },
        fallback: `Outbound TCP port 25 is open (verified via ${succeededTarget.host})`
      },
      issues: [],
      details: {
        targets: reportedTargets,
        succeededTarget,
        smtpRelayConfigured
      }
    }
  }

  const issues: DiagnosticMessage[] = smtpRelayConfigured
    ? [{
        code: 'OUTBOUND25_RELAY_FALLBACK',
        params: { host: relayHost, port: relayPort },
        fallback: `Direct outbound port 25 failed, but SMTP relay (${relayHost}:${relayPort}) is configured for sending`
      }]
    : [{
        code: 'OUTBOUND25_DIRECT_BLOCKED_HINT',
        fallback: 'Direct delivery to external MX servers requires outbound TCP port 25 or an SMTP relay'
      }]

  return {
    id: 'outbound25',
    status: 'fail',
    durationMs: Date.now() - startedAt,
    summary: {
      code: 'OUTBOUND25_BLOCKED',
      params: { count: settledTargets.length },
      fallback: `Outbound TCP port 25 appears blocked (tested ${settledTargets.length} external MX host(s))`
    },
    issues,
    details: {
      targets: settledTargets,
      smtpRelayConfigured
    }
  }
}

async function resolvePublicInboundTargets(
  domain: string,
  domainValid: boolean,
  mxCheck: MailCheckItem<MxCheckDetails>,
  siteUrl: string,
  dns: DnsResolver
): Promise<{ source: Inbound25Details['checkedTargetSource']; candidates: { host: string; ip: string }[] }> {
  const mxCandidates: { host: string; ip: string }[] = []
  for (const record of mxCheck.details.records) {
    if (record.isNullMx || record.isIpLiteral || record.addresses.length === 0) continue
    mxCandidates.push({ host: record.exchange, ip: record.addresses[0] })
    if (mxCandidates.length >= 2) break
  }
  if (mxCandidates.length > 0) {
    return { source: 'mx', candidates: mxCandidates }
  }

  if (domainValid) {
    const domainAddrs = await resolvePublicAndPrivateAddresses(domain, dns)
    if (domainAddrs.publicIps.length > 0) {
      return { source: 'domain', candidates: [{ host: domain, ip: domainAddrs.publicIps[0] }] }
    }
  }

  if (siteUrl) {
    try {
      const siteHost = normalizeDomain(new URL(siteUrl).hostname)
      if (siteHost && siteHost !== domain && isValidPublicDomain(siteHost)) {
        const siteAddrs = await resolvePublicAndPrivateAddresses(siteHost, dns)
        if (siteAddrs.publicIps.length > 0) {
          return { source: 'siteUrl', candidates: [{ host: siteHost, ip: siteAddrs.publicIps[0] }] }
        }
      }
    } catch {
      // ignore invalid siteUrl
    }
  }

  return { source: 'none', candidates: [] }
}

async function probeLocalSmtp(
  localPort: number,
  probeSmtp: (input: SmtpProbeInput) => Promise<PortCheckTargetResult>,
  trackerFactory: (ehloHost: string) => InboundProbeTracker,
  smtpTimeoutMs: number
) {
  const token = `probe-${crypto.randomBytes(8).toString('hex')}.hostid-check.invalid`
  const tracker = trackerFactory(token)
  try {
    const res = await probeSmtp({
      host: '127.0.0.1',
      ip: '127.0.0.1',
      port: localPort,
      timeoutMs: Math.min(smtpTimeoutMs, 2500),
      sendEhloHost: token
    })
    const matched = res.reachable ? await tracker.wait(300) : false
    return { ...res, matchedInstance: matched }
  } finally {
    tracker.cleanup()
  }
}

async function runPublicInboundProbe(
  candidates: { host: string; ip: string }[],
  probeSmtp: (input: SmtpProbeInput) => Promise<PortCheckTargetResult>,
  trackerFactory: (ehloHost: string) => InboundProbeTracker,
  smtpTimeoutMs: number
): Promise<{ results: PortCheckTargetResult[]; matchedTarget?: PortCheckTargetResult; foreignReachable?: PortCheckTargetResult }> {
  const results: PortCheckTargetResult[] = []
  let matchedTarget: PortCheckTargetResult | undefined
  let foreignReachable: PortCheckTargetResult | undefined

  for (const candidate of candidates) {
    const token = `probe-${crypto.randomBytes(8).toString('hex')}.hostid-check.invalid`
    const tracker = trackerFactory(token)
    try {
      const probeResult = await probeSmtp({
        host: candidate.host,
        ip: candidate.ip,
        port: 25,
        timeoutMs: smtpTimeoutMs,
        sendEhloHost: token
      })
      const matched = probeResult.reachable ? await tracker.wait(350) : false
      const enriched: PortCheckTargetResult = { ...probeResult, matchedInstance: matched }
      results.push(enriched)

      if (enriched.reachable && matched) {
        matchedTarget = enriched
        break
      }
      if (enriched.reachable && !foreignReachable) {
        foreignReachable = enriched
      }
    } finally {
      tracker.cleanup()
    }
  }

  return { results, matchedTarget, foreignReachable }
}

/**
 * 执行全部 5 项邮箱与域名检测
 */
export async function runMailDiagnostics(
  options: { domain?: string } = {},
  deps: MailDiagnosticsDeps = {}
): Promise<MailDiagnosticsReport> {
  const settings = (deps.getSettings ?? getSettings)()
  const domain = normalizeDomain(options.domain ?? settings.mailDomain)
  const domainValid = isValidPublicDomain(domain)
  const localPort = (deps.getSmtpPort ?? getSmtpPort)()
  const dnsTimeoutMs = deps.dnsTimeoutMs ?? DEFAULT_DNS_TIMEOUT_MS
  const smtpTimeoutMs = deps.smtpTimeoutMs ?? DEFAULT_SMTP_TIMEOUT_MS
  const dns = deps.dns ?? createDefaultDnsResolver(dnsTimeoutMs)
  const probeSmtp = deps.probeSmtp ?? probeSmtpPort
  const trackerFactory = deps.trackInboundProbe ?? trackInboundProbe
  const outboundProbeDomains = deps.outboundProbeDomains ?? DEFAULT_OUTBOUND_PROBE_DOMAINS
  const smtpRelayConfigured = Boolean(settings.smtpRelayHost && settings.smtpRelayUser && settings.smtpRelayPass)

  const inboundStartedAt = Date.now()

  const mxPromise = validateMxRecords(domain, dns)
  const spfPromise = validateSpfRecord(domain, dns)
  const dmarcPromise = validateDmarcRecord(domain, dns)
  const outboundPromise = checkOutbound25(
    dns,
    probeSmtp,
    outboundProbeDomains,
    smtpTimeoutMs,
    smtpRelayConfigured,
    settings.smtpRelayHost,
    settings.smtpRelayPort
  )
  const localInboundPromise = probeLocalSmtp(localPort, probeSmtp, trackerFactory, smtpTimeoutMs)

  // 一旦 MX 结果出来就立即发起公网入站探测，无需等待出站 25 超时
  const publicInboundPromise = mxPromise.then(async mxCheck => {
    if (!domainValid) {
      return {
        source: 'none' as const,
        results: [] as PortCheckTargetResult[],
        matchedTarget: undefined,
        foreignReachable: undefined
      }
    }
    const { source, candidates } = await resolvePublicInboundTargets(domain, domainValid, mxCheck, settings.siteUrl, dns)
    if (candidates.length === 0) {
      return {
        source,
        results: [] as PortCheckTargetResult[],
        matchedTarget: undefined,
        foreignReachable: undefined
      }
    }
    const probe = await runPublicInboundProbe(candidates, probeSmtp, trackerFactory, smtpTimeoutMs)
    return { source, ...probe }
  })

  const [mx, spf, dmarc, outbound25, localInbound, publicInbound] = await Promise.all([
    mxPromise,
    spfPromise,
    dmarcPromise,
    outboundPromise,
    localInboundPromise,
    publicInboundPromise
  ])

  const inboundIssues: DiagnosticMessage[] = []
  let inboundStatus: DiagnosticStatus
  let inboundSummary: DiagnosticMessage

  if (!localInbound.reachable) {
    inboundStatus = 'fail'
    inboundSummary = {
      code: 'INBOUND25_LOCAL_DOWN',
      params: { port: localPort, error: localInbound.errorCode || 'UNREACHABLE' },
      fallback: `Local SMTP receiver on port ${localPort} is not responding`
    }
    inboundIssues.push({
      code: 'INBOUND25_ISSUE_START_LOCAL',
      params: { port: localPort },
      fallback: `Check that HostID's inbound SMTP listener is running on port ${localPort}`
    })
  } else if (!domainValid) {
    inboundStatus = 'fail'
    inboundSummary = {
      code: 'INBOUND25_INVALID_DOMAIN',
      params: { domain: domain || '(empty)', port: localPort },
      fallback: `Local SMTP (port ${localPort}) is running, but "${domain || '(empty)'}" is not a valid public domain`
    }
  } else if (publicInbound.source === 'none' || publicInbound.results.length === 0) {
    inboundStatus = 'fail'
    inboundSummary = {
      code: 'INBOUND25_NO_PUBLIC_TARGET',
      params: { domain, port: localPort },
      fallback: `Local SMTP (port ${localPort}) is running, but no public MX or A/AAAA target could be resolved for ${domain}`
    }
  } else if (publicInbound.matchedTarget) {
    if (publicInbound.source === 'mx') {
      inboundStatus = 'pass'
      inboundSummary = {
        code: 'INBOUND25_OPEN',
        params: {
          host: publicInbound.matchedTarget.host,
          ip: publicInbound.matchedTarget.ip || '',
          localPort,
          latencyMs: publicInbound.matchedTarget.latencyMs ?? 0
        },
        fallback: `Inbound port 25 is open on ${publicInbound.matchedTarget.host} and routes to this HostID SMTP server (local port ${localPort})`
      }
    } else {
      inboundStatus = 'warn'
      inboundSummary = {
        code: 'INBOUND25_OPEN_NO_MX',
        params: {
          host: publicInbound.matchedTarget.host,
          ip: publicInbound.matchedTarget.ip || '',
          localPort
        },
        fallback: `Inbound port 25 on ${publicInbound.matchedTarget.host} reaches this HostID SMTP server, but no MX record is configured`
      }
    }
  } else if (publicInbound.foreignReachable) {
    inboundStatus = 'warn'
    inboundSummary = {
      code: 'INBOUND25_FOREIGN_BANNER',
      params: {
        host: publicInbound.foreignReachable.host,
        ip: publicInbound.foreignReachable.ip || '',
        banner: publicInbound.foreignReachable.banner || ''
      },
      fallback: `Port 25 on ${publicInbound.foreignReachable.host} responded, but did not reach this HostID SMTP instance`
    }
    inboundIssues.push({
      code: 'INBOUND25_ISSUE_CHECK_MX_TARGET',
      params: { banner: publicInbound.foreignReachable.banner || '' },
      fallback: 'Verify that your MX record points to this server or an upstream SMTP proxy forwarding to HostID'
    })
  } else if (publicInbound.results.some(r => r.errorCode === 'ECONNREFUSED')) {
    const refused = publicInbound.results.find(r => r.errorCode === 'ECONNREFUSED')!
    inboundStatus = 'fail'
    inboundSummary = {
      code: 'INBOUND25_REFUSED',
      params: { host: refused.host, ip: refused.ip || '', localPort },
      fallback: `Connection to ${refused.host} (${refused.ip}):25 was refused (local SMTP on port ${localPort} is healthy)`
    }
    inboundIssues.push({
      code: 'INBOUND25_ISSUE_PORT_MAPPING',
      params: { localPort },
      fallback: `Ensure host port 25 is mapped/forwarded to container port ${localPort} (e.g. Docker -p 25:${localPort})`
    })
  } else if (outbound25.status === 'pass') {
    const failed = publicInbound.results[0]
    inboundStatus = 'fail'
    inboundSummary = {
      code: 'INBOUND25_UNREACHABLE',
      params: { host: failed.host, ip: failed.ip || '', error: failed.errorCode || 'ETIMEDOUT' },
      fallback: `Unable to reach ${failed.host} (${failed.ip}):25 (${failed.errorCode || 'ETIMEDOUT'})`
    }
    inboundIssues.push({
      code: 'INBOUND25_ISSUE_FIREWALL_OR_HAIRPIN',
      params: { localPort },
      fallback: `Check firewall/security group for inbound TCP 25, Docker port mapping 25:${localPort}, and NAT hairpinning`
    })
  } else {
    const target = publicInbound.results[0]
    inboundStatus = 'warn'
    inboundSummary = {
      code: 'INBOUND25_UNVERIFIABLE_OUTBOUND_BLOCKED',
      params: { host: target.host, ip: target.ip || '', localPort },
      fallback: `Local SMTP (port ${localPort}) is listening, but self-probe to ${target.host}:25 could not complete because outbound port 25 is blocked`
    }
    inboundIssues.push({
      code: 'INBOUND25_ISSUE_EXTERNAL_VERIFY',
      params: { host: target.host },
      fallback: `Test from an external machine using "nc -vz ${target.host} 25" or send a real email from an external mailbox`
    })
  }

  const inbound25: MailCheckItem<Inbound25Details> = {
    id: 'inbound25',
    status: inboundStatus,
    durationMs: Date.now() - inboundStartedAt,
    summary: inboundSummary,
    issues: inboundIssues,
    details: {
      localPort,
      localReachable: localInbound.reachable,
      localMatchedInstance: Boolean(localInbound.matchedInstance),
      localBanner: localInbound.banner,
      localError: localInbound.errorCode ? `${localInbound.errorCode}${localInbound.errorMessage ? `: ${localInbound.errorMessage}` : ''}` : undefined,
      publicTargets: publicInbound.results,
      matchedPublicTarget: publicInbound.matchedTarget,
      checkedTargetSource: publicInbound.source
    }
  }

  const allStatuses = [outbound25.status, inbound25.status, mx.status, spf.status, dmarc.status]
  const overallStatus: DiagnosticStatus = allStatuses.includes('fail')
    ? 'fail'
    : allStatuses.includes('warn')
      ? 'warn'
      : 'pass'

  return {
    checkedAt: new Date().toISOString(),
    domain,
    domainValid,
    smtpPort: localPort,
    smtpRelay: {
      configured: smtpRelayConfigured,
      host: settings.smtpRelayHost,
      port: settings.smtpRelayPort
    },
    overallStatus,
    checks: {
      outbound25,
      inbound25,
      mx,
      spf,
      dmarc
    }
  }
}
