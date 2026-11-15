import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import express, { type Express } from 'express'
import cookieParser from 'cookie-parser'
import jwt from 'jsonwebtoken'

const tempDir = await mkdtemp(join(tmpdir(), 'hostid-admin-roles-test-'))
const dbPath = join(tempDir, 'test.db')
process.env.DATABASE_URL = `file:${dbPath}`
process.env.HOSTID_DATA_DIR = tempDir
process.env.JWT_SECRET = 'hostid-test-jwt-secret-key-32-chars-min'
process.env.DATA_ENCRYPTION_KEY = 'hostid-test-data-encryption-key-32c'

const { prisma } = await import('../src/lib/prisma')
const { memoryStore } = await import('../src/store')
const { initSettings } = await import('../src/services/settings')
const { createSSOSession } = await import('../src/services/session')
const { getJwtSecret } = await import('../src/config/secrets')
const { default: adminRoutes } = await import('../src/routes/admin')
const { default: ssoRoutes } = await import('../src/routes/sso')
const { errorHandler } = await import('../src/middleware/error')

let app: Express
let primaryAdminId: string
let primaryAdminToken: string
let memberId: string
let memberToken: string

async function dispatch(
  targetApp: Express,
  opts: {
    method: string
    url: string
    headers?: Record<string, string>
    cookies?: Record<string, string>
    body?: unknown
  }
) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
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
    req.cookies = opts.cookies || {}
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
    res.clearCookie = () => res
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
      const raw = Buffer.concat(chunks).toString('utf8')
      let parsed: any = raw
      try {
        parsed = raw ? JSON.parse(raw) : null
      } catch {
        // leave raw
      }
      res.headersSent = true
      res.emit('finish')
      resolve({ status: res.statusCode, body: parsed })
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
      else if (!finished) resolve({ status: res.statusCode, body: null })
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
      email: 'postmaster@example.com',
      username: 'postmaster',
      password: 'hashed-password',
      nickname: 'Postmaster',
      role: 'admin'
    }
  })
  const member = await prisma.user.create({
    data: {
      email: 'bob@example.com',
      username: 'bob',
      password: 'hashed-password',
      nickname: 'Bob',
      role: 'user'
    }
  })

  primaryAdminId = admin.id
  memberId = member.id
  primaryAdminToken = jwt.sign({ userId: admin.id }, getJwtSecret(), { expiresIn: '1h' })
  memberToken = jwt.sign({ userId: member.id }, getJwtSecret(), { expiresIn: '1h' })

  app = express()
  app.use(express.json())
  app.use(cookieParser())
  app.use('/api/admin', adminRoutes)
  app.use('/api/sso', ssoRoutes)
  app.use(errorHandler)
})

after(async () => {
  memoryStore.destroy()
  await prisma.$disconnect()
  await rm(tempDir, { recursive: true, force: true })
})

test('admin accounts listing, user lookup by ID, promotion/demotion, and safety guards', async () => {
  // Non-admin access is rejected
  const deniedList = await dispatch(app, {
    method: 'GET',
    url: '/api/admin/admins',
    headers: { authorization: `Bearer ${memberToken}` }
  })
  assert.equal(deniedList.status, 403)

  const deniedPatch = await dispatch(app, {
    method: 'PATCH',
    url: `/api/admin/users/${memberId}/role`,
    headers: { authorization: `Bearer ${memberToken}` },
    body: { role: 'admin' }
  })
  assert.equal(deniedPatch.status, 403)

  // Initial admin list returns current admin without password
  const initialAdmins = await dispatch(app, {
    method: 'GET',
    url: '/api/admin/admins',
    headers: { authorization: `Bearer ${primaryAdminToken}` }
  })
  assert.equal(initialAdmins.status, 200)
  assert.equal(initialAdmins.body.total, 1)
  assert.equal(initialAdmins.body.admins[0].id, primaryAdminId)
  assert.equal(initialAdmins.body.admins[0].email, 'postmaster@example.com')
  assert.equal(initialAdmins.body.admins[0].password, undefined)

  // Cannot demote self / last remaining admin
  const selfDemote = await dispatch(app, {
    method: 'PATCH',
    url: `/api/admin/users/${primaryAdminId}/role`,
    headers: { authorization: `Bearer ${primaryAdminToken}` },
    body: { role: 'user' }
  })
  assert.equal(selfDemote.status, 400)

  // Lookup user by ID (missing and existing)
  const notFound = await dispatch(app, {
    method: 'GET',
    url: '/api/admin/users/nonexistent-id-123',
    headers: { authorization: `Bearer ${primaryAdminToken}` }
  })
  assert.equal(notFound.status, 404)

  const lookupMember = await dispatch(app, {
    method: 'GET',
    url: `/api/admin/users/${memberId}`,
    headers: { authorization: `Bearer ${primaryAdminToken}` }
  })
  assert.equal(lookupMember.status, 200)
  assert.equal(lookupMember.body.user.id, memberId)
  assert.equal(lookupMember.body.user.role, 'user')

  // Reject invalid role value
  const invalidRole = await dispatch(app, {
    method: 'PATCH',
    url: `/api/admin/users/${memberId}/role`,
    headers: { authorization: `Bearer ${primaryAdminToken}` },
    body: { role: 'superadmin' }
  })
  assert.equal(invalidRole.status, 400)

  // Create an active SSO session for member while role is still 'user'
  const sessionId = await createSSOSession({
    id: memberId,
    username: 'bob',
    email: 'bob@example.com',
    role: 'user'
  })
  const ssoCookieToken = jwt.sign({ sessionId }, getJwtSecret(), { expiresIn: '1h' })

  // Promote member to admin by ID
  const promoteRes = await dispatch(app, {
    method: 'PATCH',
    url: `/api/admin/users/${memberId}/role`,
    headers: { authorization: `Bearer ${primaryAdminToken}` },
    body: { role: 'admin' }
  })
  assert.equal(promoteRes.status, 200)
  assert.equal(promoteRes.body.changed, true)
  assert.equal(promoteRes.body.user.role, 'admin')

  // SSO session immediately reflects updated role from DB
  const ssoAfterPromote = await dispatch(app, {
    method: 'GET',
    url: '/api/sso/session',
    cookies: { sso_token: ssoCookieToken }
  })
  assert.equal(ssoAfterPromote.status, 200)
  assert.equal(ssoAfterPromote.body.authenticated, true)
  assert.equal(ssoAfterPromote.body.user.role, 'admin')

  // Promoted user appears in /api/admin/admins and gains admin access
  const listAfterPromote = await dispatch(app, {
    method: 'GET',
    url: '/api/admin/admins',
    headers: { authorization: `Bearer ${memberToken}` }
  })
  assert.equal(listAfterPromote.status, 200)
  assert.equal(listAfterPromote.body.total, 2)
  assert.deepEqual(
    listAfterPromote.body.admins.map((u: any) => u.id),
    [primaryAdminId, memberId]
  )

  // Even when 2 admins exist, self-demotion is still blocked
  const selfDemoteMulti = await dispatch(app, {
    method: 'PATCH',
    url: `/api/admin/users/${memberId}/role`,
    headers: { authorization: `Bearer ${memberToken}` },
    body: { role: 'user' }
  })
  assert.equal(selfDemoteMulti.status, 400)

  // Primary admin demotes member back to 'user'
  const demoteRes = await dispatch(app, {
    method: 'PATCH',
    url: `/api/admin/users/${memberId}/role`,
    headers: { authorization: `Bearer ${primaryAdminToken}` },
    body: { role: 'user' }
  })
  assert.equal(demoteRes.status, 200)
  assert.equal(demoteRes.body.changed, true)
  assert.equal(demoteRes.body.user.role, 'user')

  // Demoted user immediately loses admin access and SSO reflects 'user'
  const deniedAgain = await dispatch(app, {
    method: 'GET',
    url: '/api/admin/admins',
    headers: { authorization: `Bearer ${memberToken}` }
  })
  assert.equal(deniedAgain.status, 403)

  const ssoAfterDemote = await dispatch(app, {
    method: 'GET',
    url: '/api/sso/session',
    cookies: { sso_token: ssoCookieToken }
  })
  assert.equal(ssoAfterDemote.status, 200)
  assert.equal(ssoAfterDemote.body.user.role, 'user')
})
