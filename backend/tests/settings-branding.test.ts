import assert from 'node:assert/strict'
import { EventEmitter, once } from 'node:events'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import express, { type Express } from 'express'
import jwt from 'jsonwebtoken'

const tempDir = await mkdtemp(join(tmpdir(), 'hostid-settings-branding-test-'))
const dbPath = join(tempDir, 'test.db')
process.env.DATABASE_URL = `file:${dbPath}`
process.env.HOSTID_DATA_DIR = tempDir
process.env.JWT_SECRET = 'hostid-test-jwt-secret-key-32-chars-min'
process.env.DATA_ENCRYPTION_KEY = 'hostid-test-data-encryption-key-32c'

const { prisma } = await import('../src/lib/prisma')
const { memoryStore } = await import('../src/store')
const { initSettings, getSettings, getSiteBranding, resetSettingsCache } = await import('../src/services/settings')
const { getJwtSecret } = await import('../src/config/secrets')
const { default: adminRoutes } = await import('../src/routes/admin')
const { default: authRoutes } = await import('../src/routes/auth')
const { serveConfigScript } = await import('../src/web')
const { errorHandler } = await import('../src/middleware/error')

let app: Express
let adminToken: string
let memberToken: string

async function dispatch(
  targetApp: Express,
  opts: {
    method: string
    url: string
    headers?: Record<string, string>
    body?: unknown
  }
) {
  return new Promise<{ status: number; headers: Record<string, string | string[]>; body: any; text: string }>((resolve, reject) => {
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
    res.type = (mime: string) => {
      resHeaders['content-type'] = mime === 'application/javascript' ? 'application/javascript; charset=utf-8' : mime
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
      resolve({ status: res.statusCode, headers: resHeaders, body: parsed, text })
      return res
    }
    res.json = (payload: unknown) => {
      res.setHeader('content-type', 'application/json')
      return res.end(JSON.stringify(payload))
    }
    res.send = (payload: unknown) => {
      if (typeof payload === 'object' && payload !== null && !Buffer.isBuffer(payload)) {
        return res.json(payload)
      }
      return res.end(payload as any)
    }

    ;(targetApp as any)(req, res, (err: unknown) => {
      if (err) reject(err)
      else if (!finished) resolve({ status: res.statusCode, headers: resHeaders, body: null, text: '' })
    })
  })
}

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
  app.use('/api/auth', authRoutes)
  serveConfigScript(app, () => getSettings().turnstileSiteKey, getSiteBranding)
  app.use(errorHandler)
})

after(async () => {
  memoryStore.destroy()
  await prisma.$disconnect()
  await rm(tempDir, { recursive: true, force: true })
})

test('siteName and siteSlogan settings defaults, updates, validation, persistence, and public endpoints', async () => {
  // 1. Default values
  const initialPublic = await dispatch(app, { method: 'GET', url: '/api/auth/site' })
  assert.equal(initialPublic.status, 200)
  assert.equal(initialPublic.headers['cache-control'], 'no-store')
  assert.deepEqual(initialPublic.body, {
    siteName: 'HostID',
    siteSlogan: 'Ginpika`s Meil Service',
    siteIconUrl: ''
  })

  const initialConfigJs = await dispatch(app, { method: 'GET', url: '/config.js' })
  assert.equal(initialConfigJs.status, 200)
  assert.equal(initialConfigJs.headers['cache-control'], 'no-store')
  assert.equal(
    initialConfigJs.text,
    'window.__ENV__ = {"CF_TURNSTILE_SITE_KEY":"","SITE_NAME":"HostID","SITE_SLOGAN":"Ginpika`s Meil Service","SITE_ICON_URL":""};\n'
  )

  // 2. Admin settings view includes siteName, siteSlogan & siteIcon in site group
  const deniedAdmin = await dispatch(app, {
    method: 'GET',
    url: '/api/admin/settings',
    headers: { authorization: `Bearer ${memberToken}` }
  })
  assert.equal(deniedAdmin.status, 403)

  const initialSettings = await dispatch(app, {
    method: 'GET',
    url: '/api/admin/settings',
    headers: { authorization: `Bearer ${adminToken}` }
  })
  assert.equal(initialSettings.status, 200)
  const siteNameItem = initialSettings.body.settings.find((s: any) => s.key === 'siteName')
  const siteSloganItem = initialSettings.body.settings.find((s: any) => s.key === 'siteSlogan')
  const siteIconItem = initialSettings.body.settings.find((s: any) => s.key === 'siteIcon')
  assert.equal(siteNameItem.group, 'site')
  assert.equal(siteNameItem.value, 'HostID')
  assert.equal(siteSloganItem.group, 'site')
  assert.equal(siteSloganItem.value, 'Ginpika`s Meil Service')
  assert.equal(siteIconItem.group, 'site')
  assert.equal(siteIconItem.value, '')

  // 3. Updating siteName and siteSlogan trims input and updates public endpoints immediately
  const updated = await dispatch(app, {
    method: 'PUT',
    url: '/api/admin/settings',
    headers: { authorization: `Bearer ${adminToken}` },
    body: {
      siteName: '  Acme Mail  ',
      siteSlogan: '  PRIVATE WORKSPACE  '
    }
  })
  assert.equal(updated.status, 200)
  assert.equal(updated.body.settings.find((s: any) => s.key === 'siteName').value, 'Acme Mail')
  assert.equal(updated.body.settings.find((s: any) => s.key === 'siteSlogan').value, 'PRIVATE WORKSPACE')

  const updatedPublic = await dispatch(app, { method: 'GET', url: '/api/auth/site' })
  assert.deepEqual(updatedPublic.body, {
    siteName: 'Acme Mail',
    siteSlogan: 'PRIVATE WORKSPACE',
    siteIconUrl: ''
  })

  const updatedConfigJs = await dispatch(app, { method: 'GET', url: '/config.js' })
  assert.equal(
    updatedConfigJs.text,
    'window.__ENV__ = {"CF_TURNSTILE_SITE_KEY":"","SITE_NAME":"Acme Mail","SITE_SLOGAN":"PRIVATE WORKSPACE","SITE_ICON_URL":""};\n'
  )

  // 4. Clearing siteSlogan hides slogan while clearing siteName safely falls back to HostID
  const cleared = await dispatch(app, {
    method: 'PUT',
    url: '/api/admin/settings',
    headers: { authorization: `Bearer ${adminToken}` },
    body: {
      siteName: '',
      siteSlogan: ''
    }
  })
  assert.equal(cleared.status, 200)
  assert.equal(cleared.body.settings.find((s: any) => s.key === 'siteSlogan').value, '')

  const afterClearPublic = await dispatch(app, { method: 'GET', url: '/api/auth/site' })
  assert.deepEqual(afterClearPublic.body, {
    siteName: 'HostID',
    siteSlogan: '',
    siteIconUrl: ''
  })

  // 5. Persisted values survive cache reset / restart (empty siteSlogan stays empty instead of reverting to default)
  await dispatch(app, {
    method: 'PUT',
    url: '/api/admin/settings',
    headers: { authorization: `Bearer ${adminToken}` },
    body: {
      siteName: 'Nihilx',
      siteSlogan: ''
    }
  })
  resetSettingsCache()
  await initSettings()

  const reloadedPublic = await dispatch(app, { method: 'GET', url: '/api/auth/site' })
  assert.deepEqual(reloadedPublic.body, {
    siteName: 'Nihilx',
    siteSlogan: '',
    siteIconUrl: ''
  })

  // 6. Validation rejects line breaks, overly long strings, and direct non-empty siteIcon writes
  const badNewline = await dispatch(app, {
    method: 'PUT',
    url: '/api/admin/settings',
    headers: { authorization: `Bearer ${adminToken}` },
    body: { siteName: 'Line1\nLine2' }
  })
  assert.equal(badNewline.status, 400)

  const badLengthName = await dispatch(app, {
    method: 'PUT',
    url: '/api/admin/settings',
    headers: { authorization: `Bearer ${adminToken}` },
    body: { siteName: 'a'.repeat(65) }
  })
  assert.equal(badLengthName.status, 400)

  const badLengthSlogan = await dispatch(app, {
    method: 'PUT',
    url: '/api/admin/settings',
    headers: { authorization: `Bearer ${adminToken}` },
    body: { siteSlogan: 'b'.repeat(121) }
  })
  assert.equal(badLengthSlogan.status, 400)

  const badSiteIcon = await dispatch(app, {
    method: 'PUT',
    url: '/api/admin/settings',
    headers: { authorization: `Bearer ${adminToken}` },
    body: { siteIcon: 'site-icon-fake.png' }
  })
  assert.equal(badSiteIcon.status, 400)
})

test('siteIcon upload, replacement, validation, serving, persistence, and reset to default', async () => {
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

  const pngBytes = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89,
    0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44,
    0xae, 0x42, 0x60, 0x82
  ])
  const svgBytes = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/></svg>')

  const uploadIcon = async (token: string, content: Buffer | null, filename = 'icon.png', mime = 'image/png') => {
    const form = new FormData()
    if (content !== null) {
      form.append('icon', new Blob([new Uint8Array(content)], { type: mime }), filename)
    }
    return fetch(`${base}/api/admin/site-icon`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form
    })
  }

  try {
    // 1. Non-admin cannot upload or reset site icon
    const memberUpload = await uploadIcon(memberToken, pngBytes)
    assert.equal(memberUpload.status, 403)
    const memberReset = await fetch(`${base}/api/admin/site-icon`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${memberToken}` }
    })
    assert.equal(memberReset.status, 403)

    // 2. Missing file, disguised text file, dangerous SVG, and oversized file are rejected
    const missingUpload = await uploadIcon(adminToken, null)
    assert.equal(missingUpload.status, 400)

    const fakePngUpload = await uploadIcon(adminToken, Buffer.from('not really a png'), 'fake.png', 'image/png')
    assert.equal(fakePngUpload.status, 400)

    const scriptSvgUpload = await uploadIcon(
      adminToken,
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
      'xss.svg',
      'image/svg+xml'
    )
    assert.equal(scriptSvgUpload.status, 400)

    const onloadSvgUpload = await uploadIcon(
      adminToken,
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><circle cx="4" cy="4" r="2"/></svg>'),
      'xss2.svg',
      'image/svg+xml'
    )
    assert.equal(onloadSvgUpload.status, 400)

    const oversizedUpload = await uploadIcon(adminToken, Buffer.alloc(2 * 1024 * 1024 + 1, 0x89), 'huge.png', 'image/png')
    assert.equal(oversizedUpload.status, 413)

    // 3. Valid PNG upload updates branding, config.js, and serves binary bytes with security headers
    const pngRes = await uploadIcon(adminToken, pngBytes, 'brand.png', 'image/png')
    assert.equal(pngRes.status, 200)
    const pngPayload = await pngRes.json() as any
    const firstIconUrl = pngPayload.branding.siteIconUrl as string
    assert.match(firstIconUrl, /^\/api\/auth\/site-icon\/site-icon-[a-z0-9-]+\.png$/)

    const siteRes1 = await (await fetch(`${base}/api/auth/site`)).json() as any
    assert.equal(siteRes1.siteIconUrl, firstIconUrl)
    const configText1 = await (await fetch(`${base}/config.js`)).text()
    assert.ok(configText1.includes(`"SITE_ICON_URL":"${firstIconUrl}"`))

    const servedPng = await fetch(`${base}${firstIconUrl}`)
    assert.equal(servedPng.status, 200)
    assert.equal(servedPng.headers.get('content-type'), 'image/png')
    assert.equal(servedPng.headers.get('cache-control'), 'public, max-age=31536000, immutable')
    assert.equal(servedPng.headers.get('x-content-type-options'), 'nosniff')
    assert.ok((servedPng.headers.get('content-security-policy') || '').includes('sandbox'))
    assert.deepEqual(Buffer.from(await servedPng.arrayBuffer()), pngBytes)

    // 4. Replacing with SVG removes old PNG file and serves SVG
    const svgRes = await uploadIcon(adminToken, svgBytes, 'brand.svg', 'image/svg+xml')
    assert.equal(svgRes.status, 200)
    const svgPayload = await svgRes.json() as any
    const secondIconUrl = svgPayload.branding.siteIconUrl as string
    assert.match(secondIconUrl, /^\/api\/auth\/site-icon\/site-icon-[a-z0-9-]+\.svg$/)
    assert.notEqual(secondIconUrl, firstIconUrl)

    assert.equal((await fetch(`${base}${firstIconUrl}`)).status, 404)
    const servedSvg = await fetch(`${base}${secondIconUrl}`)
    assert.equal(servedSvg.status, 200)
    assert.match(servedSvg.headers.get('content-type') || '', /^image\/svg\+xml/)
    assert.deepEqual(Buffer.from(await servedSvg.arrayBuffer()), svgBytes)

    const iconDir = join(tempDir, 'site-icons')
    assert.equal((await readdir(iconDir)).length, 1)

    // 5. Custom icon persists across cache reset / restart
    resetSettingsCache()
    await initSettings()
    const reloadedSite = await (await fetch(`${base}/api/auth/site`)).json() as any
    assert.equal(reloadedSite.siteIconUrl, secondIconUrl)

    // 6. Path traversal and invalid filenames return 404
    assert.equal((await fetch(`${base}/api/auth/site-icon/not-a-valid-icon.png`)).status, 404)
    assert.equal((await fetch(`${base}/api/auth/site-icon/..%2Fsecrets.json`)).status, 404)

    // 7. Resetting restores default empty siteIconUrl, deletes file, and persists
    const resetRes = await fetch(`${base}/api/admin/site-icon`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` }
    })
    assert.equal(resetRes.status, 200)
    const resetPayload = await resetRes.json() as any
    assert.equal(resetPayload.branding.siteIconUrl, '')
    assert.equal(resetPayload.settings.find((s: any) => s.key === 'siteIcon').value, '')

    const afterResetSite = await (await fetch(`${base}/api/auth/site`)).json() as any
    assert.equal(afterResetSite.siteIconUrl, '')
    const afterResetConfig = await (await fetch(`${base}/config.js`)).text()
    assert.ok(afterResetConfig.includes('"SITE_ICON_URL":""'))
    assert.equal((await fetch(`${base}${secondIconUrl}`)).status, 404)
    assert.equal((await readdir(iconDir)).length, 0)

    resetSettingsCache()
    await initSettings()
    const reloadedAfterReset = await (await fetch(`${base}/api/auth/site`)).json() as any
    assert.equal(reloadedAfterReset.siteIconUrl, '')
  } finally {
    if (server.listening) {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    }
  }
})
