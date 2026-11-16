import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
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
    siteSlogan: 'MAIL WORKSPACE'
  })

  const initialConfigJs = await dispatch(app, { method: 'GET', url: '/config.js' })
  assert.equal(initialConfigJs.status, 200)
  assert.equal(initialConfigJs.headers['cache-control'], 'no-store')
  assert.equal(
    initialConfigJs.text,
    'window.__ENV__ = {"CF_TURNSTILE_SITE_KEY":"","SITE_NAME":"HostID","SITE_SLOGAN":"MAIL WORKSPACE"};\n'
  )

  // 2. Admin settings view includes siteName & siteSlogan in site group
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
  assert.equal(siteNameItem.group, 'site')
  assert.equal(siteNameItem.value, 'HostID')
  assert.equal(siteSloganItem.group, 'site')
  assert.equal(siteSloganItem.value, 'MAIL WORKSPACE')

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
    siteSlogan: 'PRIVATE WORKSPACE'
  })

  const updatedConfigJs = await dispatch(app, { method: 'GET', url: '/config.js' })
  assert.equal(
    updatedConfigJs.text,
    'window.__ENV__ = {"CF_TURNSTILE_SITE_KEY":"","SITE_NAME":"Acme Mail","SITE_SLOGAN":"PRIVATE WORKSPACE"};\n'
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
    siteSlogan: ''
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
    siteSlogan: ''
  })

  // 6. Validation rejects line breaks and overly long strings
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
})
