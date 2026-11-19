import assert from 'node:assert/strict'
import { EventEmitter, once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import net, { type AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import express, { type Express } from 'express'
import jwt from 'jsonwebtoken'

const tempDir = await mkdtemp(join(tmpdir(), 'hostid-mail-diagnostics-test-'))
const dbPath = join(tempDir, 'test.db')
process.env.DATABASE_URL = `file:${dbPath}`
process.env.HOSTID_DATA_DIR = tempDir
process.env.JWT_SECRET = 'hostid-test-jwt-secret-key-32-chars-min'
process.env.DATA_ENCRYPTION_KEY = 'hostid-test-data-encryption-key-32c'

const { prisma } = await import('../src/lib/prisma')
const { memoryStore } = await import('../src/store')
const { initSettings, updateSettings } = await import('../src/services/settings')
const { getJwtSecret } = await import('../src/config/secrets')
const { default: adminRoutes } = await import('../src/routes/admin')
const { errorHandler } = await import('../src/middleware/error')
const { createSMTPServer, trackInboundProbe } = await import('../src/smtp')
const {
  isPublicIp,
  isValidPublicDomain,
  normalizeDomain,
  probeSmtpPort,
  runMailDiagnostics,
  validateDmarcRecord,
  validateMxRecords,
  validateSpfRecord
} = await import('../src/services/mail-diagnostics')

import type { DnsResolver, PortCheckTargetResult, SmtpProbeInput } from '../src/services/mail-diagnostics'
import type { Settings } from '../src/services/settings'

function makeDns(overrides: Partial<DnsResolver> = {}): DnsResolver {
  const notFound = (code = 'ENODATA') => Object.assign(new Error(code), { code })
  return {
    resolveMx: async () => { throw notFound('ENODATA') },
    resolveTxt: async () => { throw notFound('ENODATA') },
    resolve4: async () => { throw notFound('ENODATA') },
    resolve6: async () => { throw notFound('ENODATA') },
    resolveCname: async () => { throw notFound('ENODATA') },
    ...overrides
  }
}

function makeSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    siteName: 'HostID',
    siteSlogan: '',
    siteIcon: '',
    siteUrl: '',
    corsAllowedOrigins: '',
    ssoLoginPageUrl: '',
    mailDomain: 'example.com',
    smtpRelayHost: '',
    smtpRelayPort: 25,
    smtpRelayUser: '',
    smtpRelayPass: '',
    turnstileSiteKey: '',
    turnstileSecretKey: '',
    ssoCookieDomain: '',
    ssoCookieName: 'sso_token',
    ssoCookiePath: '/',
    ssoCookieSecure: false,
    ssoCookieSameSite: 'lax',
    sessionTtl: 604800,
    ssoRateMax: 180,
    ssoRateWindowMs: 60000,
    passkeyEnabled: false,
    ...overrides
  }
}

async function dispatch(
  targetApp: Express,
  opts: {
    method: string
    url: string
    headers?: Record<string, string>
    body?: unknown
  }
) {
  return new Promise<{ status: number; headers: Record<string, string | string[]>; body: any }>((resolve, reject) => {
    const rawHeaders: Record<string, string> = {}
    for (const [k, v] of Object.entries(opts.headers || {})) {
      rawHeaders[k.toLowerCase()] = v
    }

    const req = new EventEmitter() as any
    req.method = opts.method.toUpperCase()
    req.url = opts.url
    req.originalUrl = opts.url
    req.headers = rawHeaders
    req.body = opts.body
    req.cookies = {}
    req.socket = { remoteAddress: '127.0.0.1' }
    req.connection = req.socket
    req.ip = '127.0.0.1'
    req.protocol = 'http'
    req.get = (name: string) => rawHeaders[name.toLowerCase()]
    req.header = req.get

    const resHeaders: Record<string, string | string[]> = {}
    const chunks: Buffer[] = []
    let finished = false

    const res = new EventEmitter() as any
    res.statusCode = 200
    res.locals = {}
    res.headersSent = false
    res.status = (code: number) => {
      res.statusCode = code
      return res
    }
    res.setHeader = (name: string, value: string | string[]) => {
      resHeaders[name.toLowerCase()] = value
    }
    res.getHeader = (name: string) => resHeaders[name.toLowerCase()]
    res.removeHeader = (name: string) => {
      delete resHeaders[name.toLowerCase()]
    }
    res.set = (name: string | Record<string, string>, value?: string) => {
      if (typeof name === 'object') {
        for (const [k, v] of Object.entries(name)) resHeaders[k.toLowerCase()] = v
      } else if (value !== undefined) {
        resHeaders[name.toLowerCase()] = value
      }
      return res
    }
    res.write = (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
      return true
    }
    res.end = (chunk?: Buffer | string) => {
      if (finished) return res
      finished = true
      if (chunk !== undefined) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
      }
      const text = Buffer.concat(chunks).toString('utf8')
      let parsed: any = text
      try {
        parsed = text ? JSON.parse(text) : null
      } catch {
        // leave text
      }
      res.headersSent = true
      res.emit('finish')
      resolve({ status: res.statusCode, headers: resHeaders, body: parsed })
      return res
    }
    res.json = (payload: unknown) => {
      res.setHeader('content-type', 'application/json')
      return res.end(JSON.stringify(payload))
    }

    ;(targetApp as any)(req, res, (err: unknown) => {
      if (err) reject(err)
      else if (!finished) resolve({ status: res.statusCode, headers: resHeaders, body: null })
    })
  })
}

let app: Express
let adminToken: string
let memberToken: string

before(async () => {
  await prisma.$executeRawUnsafe(`CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL UNIQUE,
    "username" TEXT NOT NULL UNIQUE,
    "password" TEXT NOT NULL,
    "nickname" TEXT,
    "phone" TEXT,
    "birthday" TEXT,
    "avatar" TEXT,
    "language" TEXT NOT NULL DEFAULT 'zh-CN',
    "role" TEXT NOT NULL DEFAULT 'user',
    "githubId" INTEGER UNIQUE,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`)
  await prisma.$executeRawUnsafe(`CREATE TABLE "system_settings" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "isSecret" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`)

  await initSettings()

  const admin = await prisma.user.create({
    data: {
      email: 'admin@example.com',
      username: 'admin',
      password: 'hashed-password',
      role: 'admin'
    }
  })
  const member = await prisma.user.create({
    data: {
      email: 'member@example.com',
      username: 'member',
      password: 'hashed-password',
      role: 'user'
    }
  })

  adminToken = jwt.sign({ userId: admin.id }, getJwtSecret(), { expiresIn: '1h' })
  memberToken = jwt.sign({ userId: member.id }, getJwtSecret(), { expiresIn: '1h' })

  app = express()
  app.use(express.json())
  app.use('/api/admin', adminRoutes)
  app.use(errorHandler)
})

after(async () => {
  memoryStore.destroy()
  await prisma.$disconnect()
  await rm(tempDir, { recursive: true, force: true })
})

test('domain and public IP helpers validate inputs properly', () => {
  assert.equal(normalizeDomain('  Example.COM. '), 'example.com')
  assert.equal(isValidPublicDomain('example.com'), true)
  assert.equal(isValidPublicDomain('mail.sub.example.co.uk'), true)
  assert.equal(isValidPublicDomain('localhost'), false)
  assert.equal(isValidPublicDomain('mail.localhost'), false)
  assert.equal(isValidPublicDomain('host.local'), false)
  assert.equal(isValidPublicDomain('1.2.3.4'), false)
  assert.equal(isValidPublicDomain('singlelabel'), false)

  assert.equal(isPublicIp('93.184.216.34'), true)
  assert.equal(isPublicIp('2606:2800:220:1:248:1893:25c8:1946'), true)
  assert.equal(isPublicIp('127.0.0.1'), false)
  assert.equal(isPublicIp('10.0.0.1'), false)
  assert.equal(isPublicIp('172.16.0.5'), false)
  assert.equal(isPublicIp('192.168.1.1'), false)
  assert.equal(isPublicIp('169.254.169.254'), false)
  assert.equal(isPublicIp('::1'), false)
  assert.equal(isPublicIp('::ffff:127.0.0.1'), false)
  assert.equal(isPublicIp('fe80::1'), false)
  assert.equal(isPublicIp('fc00::1'), false)
})

test('MX validation covers valid records, Null MX, IP literals, CNAME warnings, private IPs, and missing records', async () => {
  const validDns = makeDns({
    resolveMx: async () => [
      { priority: 20, exchange: 'mx2.example.com.' },
      { priority: 10, exchange: 'mx1.example.com.' }
    ],
    resolve4: async host => (host === 'mx1.example.com' ? ['93.184.216.34'] : ['93.184.216.35'])
  })
  const validRes = await validateMxRecords('example.com', validDns)
  assert.equal(validRes.status, 'pass')
  assert.equal(validRes.summary.code, 'MX_VALID')
  assert.equal(validRes.details.records[0].exchange, 'mx1.example.com')

  const nullMxRes = await validateMxRecords('example.com', makeDns({
    resolveMx: async () => [{ priority: 0, exchange: '.' }]
  }))
  assert.equal(nullMxRes.status, 'fail')
  assert.equal(nullMxRes.summary.code, 'MX_NULL_RECORD')

  const ipLiteralRes = await validateMxRecords('example.com', makeDns({
    resolveMx: async () => [{ priority: 10, exchange: '93.184.216.34' }]
  }))
  assert.equal(ipLiteralRes.status, 'fail')
  assert.equal(ipLiteralRes.summary.code, 'MX_INVALID_EXCHANGE')

  const cnameWarnRes = await validateMxRecords('example.com', makeDns({
    resolveMx: async () => [{ priority: 10, exchange: 'mx.example.com' }],
    resolveCname: async () => ['target.example.com'],
    resolve4: async () => ['93.184.216.34']
  }))
  assert.equal(cnameWarnRes.status, 'warn')
  assert.equal(cnameWarnRes.issues[0].code, 'MX_ISSUE_CNAME')

  const privateIpRes = await validateMxRecords('example.com', makeDns({
    resolveMx: async () => [{ priority: 10, exchange: 'mx.example.com' }],
    resolve4: async () => ['10.0.0.25']
  }))
  assert.equal(privateIpRes.status, 'fail')
  assert.equal(privateIpRes.summary.code, 'MX_PRIVATE_IP')

  const missingMxRes = await validateMxRecords('example.com', makeDns())
  assert.equal(missingMxRes.status, 'fail')
  assert.equal(missingMxRes.summary.code, 'MX_NOT_FOUND')
})

test('SPF validation covers valid records, chunked TXT, recursive includes, 10-lookup limit, cycles, typos, and warnings', async () => {
  // Valid record with chunked TXT, dual-CIDR a mechanism, ip4, ip6, and exp= after -all
  const validSpf = await validateSpfRecord('example.com', makeDns({
    resolveTxt: async host => {
      if (host === 'example.com') {
        return [['v=spf1 a:mail.example.com/24//64 ', 'ip4:93.184.216.34/32 ip6:2001:4860:4860::8888 -all exp=exp._spf.example.com']]
      }
      return []
    }
  }))
  assert.equal(validSpf.status, 'pass')
  assert.equal(validSpf.details.dnsLookups, 1)
  assert.equal(validSpf.issues.length, 0)

  // Multiple SPF records -> fail
  const multiSpf = await validateSpfRecord('example.com', makeDns({
    resolveTxt: async () => [['v=spf1 mx -all'], ['v=spf1 ip4:93.184.216.34 -all']]
  }))
  assert.equal(multiSpf.status, 'fail')
  assert.equal(multiSpf.summary.code, 'SPF_MULTIPLE_RECORDS')

  // Recursive include exceeding 10 DNS lookups -> fail
  const deepDns = makeDns({
    resolveTxt: async host => {
      if (host === 'example.com') {
        return [['v=spf1 include:spf1.example.com include:spf2.example.com mx a -all']]
      }
      if (host === 'spf1.example.com') {
        return [['v=spf1 a mx a:a1.example.com a:a2.example.com a:a3.example.com a:a4.example.com -all']]
      }
      if (host === 'spf2.example.com') {
        return [['v=spf1 a mx -all']]
      }
      return []
    }
  })
  const tooManyLookups = await validateSpfRecord('example.com', deepDns)
  assert.equal(tooManyLookups.status, 'fail')
  assert.ok(tooManyLookups.details.dnsLookups > 10)
  assert.ok(tooManyLookups.issues.some(i => i.code === 'SPF_ISSUE_TOO_MANY_LOOKUPS'))

  // Circular include -> fail
  const cycleSpf = await validateSpfRecord('example.com', makeDns({
    resolveTxt: async host => {
      if (host === 'example.com') return [['v=spf1 include:b.example.com -all']]
      if (host === 'b.example.com') return [['v=spf1 include:example.com -all']]
      return []
    }
  }))
  assert.equal(cycleSpf.status, 'fail')
  assert.ok(cycleSpf.issues.some(i => i.code === 'SPF_ISSUE_CYCLE'))

  // +all & ptr & missing colon typo -> warn
  const warnSpf = await validateSpfRecord('example.com', makeDns({
    resolveTxt: async () => [['v=spf1 ptr include=other.example.com +all']]
  }))
  assert.equal(warnSpf.status, 'warn')
  assert.ok(warnSpf.issues.some(i => i.code === 'SPF_ISSUE_PLUS_ALL'))
  assert.ok(warnSpf.issues.some(i => i.code === 'SPF_ISSUE_DEPRECATED_PTR'))
  assert.ok(warnSpf.issues.some(i => i.code === 'SPF_ISSUE_TYPO_EQUALS'))

  // Invalid ip4 CIDR -> fail
  const badIp4 = await validateSpfRecord('example.com', makeDns({
    resolveTxt: async () => [['v=spf1 ip4:999.1.2.3/33 -all']]
  }))
  assert.equal(badIp4.status, 'fail')
  assert.ok(badIp4.issues.some(i => i.code === 'SPF_ISSUE_INVALID_IP4'))
})

test('DMARC validation covers valid policies, strict version casing, missing p=, invalid tags, and p=none without rua', async () => {
  const validReject = await validateDmarcRecord('example.com', makeDns({
    resolveTxt: async host => (host === '_dmarc.example.com'
      ? [['v=DMARC1; p=reject; sp=quarantine; pct=100; adkim=s; aspf=r; fo=0:1; rua=mailto:dmarc@example.com!10m;']]
      : [])
  }))
  assert.equal(validReject.status, 'pass')
  assert.equal(validReject.details.policy, 'reject')
  assert.equal(validReject.details.pct, 100)

  // p=none with rua is valid pass
  const validMonitoring = await validateDmarcRecord('example.com', makeDns({
    resolveTxt: async () => [['v=DMARC1; p=none; rua=mailto:dmarc@example.com']]
  }))
  assert.equal(validMonitoring.status, 'pass')

  // p=none without rua -> warn
  const warnNoRua = await validateDmarcRecord('example.com', makeDns({
    resolveTxt: async () => [['v=DMARC1; p=none']]
  }))
  assert.equal(warnNoRua.status, 'warn')
  assert.ok(warnNoRua.issues.some(i => i.code === 'DMARC_ISSUE_NONE_WITHOUT_RUA'))

  // Lowercase dmarc1 -> fail
  const badVersionCase = await validateDmarcRecord('example.com', makeDns({
    resolveTxt: async () => [['v=dmarc1; p=reject']]
  }))
  assert.equal(badVersionCase.status, 'fail')
  assert.ok(badVersionCase.issues.some(i => i.code === 'DMARC_ISSUE_VERSION_CASE'))

  // Missing p= and invalid rua -> fail
  const badTags = await validateDmarcRecord('example.com', makeDns({
    resolveTxt: async () => [['v=DMARC1; pct=150; rua=https://bad.example.com']]
  }))
  assert.equal(badTags.status, 'fail')
  assert.ok(badTags.issues.some(i => i.code === 'DMARC_ISSUE_MISSING_POLICY'))
  assert.ok(badTags.issues.some(i => i.code === 'DMARC_ISSUE_INVALID_PCT'))
  assert.ok(badTags.issues.some(i => i.code === 'DMARC_ISSUE_INVALID_URI'))

  // Duplicate DMARC records -> fail
  const dupDmarc = await validateDmarcRecord('example.com', makeDns({
    resolveTxt: async () => [['v=DMARC1; p=none'], ['v=DMARC1; p=reject']]
  }))
  assert.equal(dupDmarc.status, 'fail')
  assert.equal(dupDmarc.summary.code, 'DMARC_MULTIPLE_RECORDS')
})

test('probeSmtpPort handles real SMTP server, multi-line 220 banner, EHLO probe tracking, and non-SMTP sockets', async () => {
  // 1. Real HostID SMTP server + trackInboundProbe via onClose
  const smtpServer = createSMTPServer()
  await new Promise<void>(resolve => smtpServer.listen(0, '127.0.0.1', resolve))
  const smtpPort = (smtpServer.server.address() as AddressInfo).port

  const token = 'probe-live-test.hostid-check.invalid'
  const tracker = trackInboundProbe(token)
  try {
    const res = await probeSmtpPort({
      host: '127.0.0.1',
      ip: '127.0.0.1',
      port: smtpPort,
      timeoutMs: 3000,
      sendEhloHost: token
    })
    assert.equal(res.reachable, true)
    assert.ok(res.banner?.includes('220'))
    assert.equal(await tracker.wait(500), true)
  } finally {
    tracker.cleanup()
    await new Promise<void>(resolve => smtpServer.close(() => resolve()))
  }

  // 2. Multi-line 220 banner server
  const multilineServer = net.createServer(socket => {
    socket.write('220-mail.mock.test ESMTP Mock\r\n220 Ready for mail\r\n')
    socket.on('data', chunk => {
      if (chunk.toString().includes('QUIT')) {
        socket.end('221 Bye\r\n')
      }
    })
  })
  await new Promise<void>(resolve => multilineServer.listen(0, '127.0.0.1', resolve))
  const multilinePort = (multilineServer.address() as AddressInfo).port
  try {
    const res = await probeSmtpPort({ host: '127.0.0.1', ip: '127.0.0.1', port: multilinePort, timeoutMs: 2000 })
    assert.equal(res.reachable, true)
    assert.ok(res.banner?.includes('220 Ready for mail'))
  } finally {
    await new Promise<void>(resolve => multilineServer.close(() => resolve()))
  }

  // 3. Non-SMTP HTTP-like server
  const nonSmtpServer = net.createServer(socket => {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n')
  })
  await new Promise<void>(resolve => nonSmtpServer.listen(0, '127.0.0.1', resolve))
  const nonSmtpPort = (nonSmtpServer.address() as AddressInfo).port
  try {
    const res = await probeSmtpPort({ host: '127.0.0.1', ip: '127.0.0.1', port: nonSmtpPort, timeoutMs: 2000 })
    assert.equal(res.reachable, false)
    assert.equal(res.errorCode, 'NOT_SMTP')
  } finally {
    await new Promise<void>(resolve => nonSmtpServer.close(() => resolve()))
  }
})

test('runMailDiagnostics integrates all 5 checks across success, foreign banner, outbound-blocked inbound-warn, and localhost cases', async () => {
  // 1. All 5 pass (real local HostID SMTP server + mocked public DNS/port-25 routing into same HostID SMTP server)
  const smtpServer = createSMTPServer()
  await new Promise<void>(resolve => smtpServer.listen(0, '127.0.0.1', resolve))
  const liveLocalPort = (smtpServer.server.address() as AddressInfo).port

  try {
    const publicDns = makeDns({
      resolveMx: async host => {
        if (host === 'example.com') return [{ priority: 10, exchange: 'mail.example.com' }]
        if (host === 'gmail.com') return [{ priority: 5, exchange: 'gmail-smtp-in.l.google.com' }]
        return []
      },
      resolve4: async host => {
        if (host === 'mail.example.com') return ['93.184.216.34']
        if (host === 'gmail-smtp-in.l.google.com') return ['142.250.1.26']
        return []
      },
      resolveTxt: async host => {
        if (host === 'example.com') return [['v=spf1 mx -all']]
        if (host === '_dmarc.example.com') return [['v=DMARC1; p=quarantine; rua=mailto:dmarc@example.com']]
        return []
      }
    })

    // Redirect port-25 probes in test to our live local SMTP server to exercise real EHLO nonce matching
    const fullPassReport = await runMailDiagnostics({}, {
      dns: publicDns,
      getSettings: () => makeSettings({ mailDomain: 'example.com' }),
      getSmtpPort: () => liveLocalPort,
      outboundProbeDomains: ['gmail.com'],
      probeSmtp: async (input: SmtpProbeInput): Promise<PortCheckTargetResult> => {
        const res = await probeSmtpPort({ ...input, host: '127.0.0.1', ip: '127.0.0.1', port: liveLocalPort })
        return { ...res, host: input.host, ip: input.ip, port: input.port }
      }
    })

    assert.equal(fullPassReport.overallStatus, 'pass')
    assert.equal(fullPassReport.checks.outbound25.status, 'pass')
    assert.equal(fullPassReport.checks.outbound25.details.targets.some(t => t.errorCode === 'ABORTED'), false)
    assert.equal(fullPassReport.checks.inbound25.status, 'pass')
    assert.equal(fullPassReport.checks.inbound25.details.localMatchedInstance, true)
    assert.equal(fullPassReport.checks.inbound25.details.matchedPublicTarget?.matchedInstance, true)
    assert.equal(fullPassReport.checks.mx.status, 'pass')
    assert.equal(fullPassReport.checks.spf.status, 'pass')
    assert.equal(fullPassReport.checks.dmarc.status, 'pass')

    // 2. Outbound blocked (with SMTP relay configured) + inbound self-probe timeout -> inbound warns cleanly
    const blockedOutboundReport = await runMailDiagnostics({}, {
      dns: publicDns,
      getSettings: () => makeSettings({
        mailDomain: 'example.com',
        smtpRelayHost: 'smtp.resend.com',
        smtpRelayPort: 465,
        smtpRelayUser: 'resend',
        smtpRelayPass: 'secret'
      }),
      getSmtpPort: () => liveLocalPort,
      outboundProbeDomains: ['gmail.com'],
      probeSmtp: async (input: SmtpProbeInput): Promise<PortCheckTargetResult> => {
        if (input.ip === '127.0.0.1' && input.port === liveLocalPort) {
          return probeSmtpPort(input)
        }
        return { host: input.host, ip: input.ip, port: input.port, reachable: false, errorCode: 'ETIMEDOUT', errorMessage: 'Timed out' }
      }
    })

    assert.equal(blockedOutboundReport.checks.outbound25.status, 'fail')
    assert.equal(blockedOutboundReport.checks.outbound25.details.smtpRelayConfigured, true)
    assert.ok(blockedOutboundReport.checks.outbound25.issues.some(i => i.code === 'OUTBOUND25_RELAY_FALLBACK'))
    assert.equal(blockedOutboundReport.checks.inbound25.status, 'warn')
    assert.equal(blockedOutboundReport.checks.inbound25.summary.code, 'INBOUND25_UNVERIFIABLE_OUTBOUND_BLOCKED')

    // 3. Foreign SMTP server answering on MX:25 -> inbound warns INBOUND25_FOREIGN_BANNER
    const foreignBannerReport = await runMailDiagnostics({}, {
      dns: publicDns,
      getSettings: () => makeSettings({ mailDomain: 'example.com' }),
      getSmtpPort: () => liveLocalPort,
      outboundProbeDomains: ['gmail.com'],
      probeSmtp: async (input: SmtpProbeInput): Promise<PortCheckTargetResult> => {
        if (input.ip === '127.0.0.1' && input.port === liveLocalPort) {
          return probeSmtpPort(input)
        }
        return { host: input.host, ip: input.ip, port: input.port, reachable: true, banner: '220 mx.other-provider.test ESMTP' }
      }
    })
    assert.equal(foreignBannerReport.checks.inbound25.status, 'warn')
    assert.equal(foreignBannerReport.checks.inbound25.summary.code, 'INBOUND25_FOREIGN_BANNER')
  } finally {
    await new Promise<void>(resolve => smtpServer.close(() => resolve()))
  }

  // 4. Default localhost domain fails domain-dependent checks cleanly without outbound network calls
  const localhostReport = await runMailDiagnostics({}, {
    dns: makeDns(),
    getSettings: () => makeSettings({ mailDomain: 'localhost' }),
    getSmtpPort: () => 2525,
    outboundProbeDomains: ['gmail.com'],
    probeSmtp: async (input: SmtpProbeInput) => ({
      host: input.host,
      ip: input.ip,
      port: input.port,
      reachable: false,
      errorCode: 'ECONNREFUSED'
    })
  })
  assert.equal(localhostReport.domain, 'localhost')
  assert.equal(localhostReport.domainValid, false)
  assert.equal(localhostReport.overallStatus, 'fail')
  assert.equal(localhostReport.checks.mx.summary.code, 'MX_INVALID_DOMAIN')
  assert.equal(localhostReport.checks.spf.summary.code, 'SPF_INVALID_DOMAIN')
  assert.equal(localhostReport.checks.dmarc.summary.code, 'DMARC_INVALID_DOMAIN')
  assert.equal(localhostReport.checks.inbound25.summary.code, 'INBOUND25_LOCAL_DOWN')
})

test('POST /api/admin/mail-check enforces adminGuard, validates optional domain, and returns report', async () => {
  const unauth = await dispatch(app, { method: 'POST', url: '/api/admin/mail-check' })
  assert.equal(unauth.status, 401)

  const forbidden = await dispatch(app, {
    method: 'POST',
    url: '/api/admin/mail-check',
    headers: { authorization: `Bearer ${memberToken}` }
  })
  assert.equal(forbidden.status, 403)

  const badDomain = await dispatch(app, {
    method: 'POST',
    url: '/api/admin/mail-check',
    headers: { authorization: `Bearer ${adminToken}` },
    body: { domain: 'bad domain/path' }
  })
  assert.equal(badDomain.status, 400)

  await updateSettings({ mailDomain: 'localhost' })
  const ok = await dispatch(app, {
    method: 'POST',
    url: '/api/admin/mail-check',
    headers: { authorization: `Bearer ${adminToken}` },
    body: { domain: 'localhost' }
  })
  assert.equal(ok.status, 200)
  assert.equal(ok.headers['cache-control'], 'no-store')
  assert.equal(ok.body.domain, 'localhost')
  assert.equal(ok.body.domainValid, false)
  assert.ok(ok.body.checks.outbound25)
  assert.ok(ok.body.checks.inbound25)
  assert.ok(ok.body.checks.mx)
  assert.ok(ok.body.checks.spf)
  assert.ok(ok.body.checks.dmarc)
})
