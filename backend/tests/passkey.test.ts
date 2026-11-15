import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import express, { type Express } from 'express'
import cookieParser from 'cookie-parser'
import jwt from 'jsonwebtoken'
import { isoBase64URL, isoCBOR } from '@simplewebauthn/server/helpers'

const tempDir = await mkdtemp(join(tmpdir(), 'hostid-passkey-test-'))
const dbPath = join(tempDir, 'test.db')
process.env.DATABASE_URL = `file:${dbPath}`
process.env.HOSTID_DATA_DIR = tempDir
process.env.JWT_SECRET = 'hostid-test-jwt-secret-key-32-chars-min'
process.env.DATA_ENCRYPTION_KEY = 'hostid-test-data-encryption-key-32c'

const { prisma } = await import('../src/lib/prisma')
const { memoryStore } = await import('../src/store')
const { initSettings, updateSettings, getSettings } = await import('../src/services/settings')
const { resolveWebAuthnContext } = await import('../src/services/passkey')
const { default: passkeyRoutes } = await import('../src/routes/passkey')
const { default: oauthClientRoutes } = await import('../src/routes/oauthClient')
const { default: adminRoutes } = await import('../src/routes/admin')
const { errorHandler } = await import('../src/middleware/error')

let app: Express
let adminToken: string
let memberToken: string
let memberUserId: string

interface DispatchResult {
  status: number
  headers: Record<string, string | string[]>
  body: any
}

/**
 * 在内存中直接分发 Express 请求，无需绑定本地 TCP 端口即可测试完整路由链
 */
async function dispatch(
  targetApp: Express,
  opts: {
    method: string
    url: string
    headers?: Record<string, string>
    body?: unknown
  }
): Promise<DispatchResult> {
  return new Promise((resolve, reject) => {
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
    res.cookie = (name: string, value: string, _options?: unknown) => {
      const existing = resHeaders['set-cookie']
      const headerVal = `${name}=${encodeURIComponent(value)}`
      if (!existing) {
        resHeaders['set-cookie'] = [headerVal]
      } else if (Array.isArray(existing)) {
        existing.push(headerVal)
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
      const raw = Buffer.concat(chunks).toString('utf8')
      let parsed: any = raw
      try {
        parsed = raw ? JSON.parse(raw) : null
      } catch {
        // leave as string
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
    res.send = (payload: unknown) => {
      if (typeof payload === 'object' && payload !== null && !Buffer.isBuffer(payload)) {
        return res.json(payload)
      }
      return res.end(payload as any)
    }

    ;(targetApp as any)(req, res, (err: unknown) => {
      if (err) reject(err)
      else if (!finished) {
        resolve({ status: res.statusCode, headers: resHeaders, body: null })
      }
    })
  })
}

function sha256(data: Buffer | string): Buffer {
  return crypto.createHash('sha256').update(data).digest()
}

function createSyntheticES256Authenticator(aaguidHex = 'fbfc3007154e4ecc8c0b6e020557d7bd') {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const jwk = publicKey.export({ format: 'jwk' })
  const x = Buffer.from(jwk.x!, 'base64url')
  const y = Buffer.from(jwk.y!, 'base64url')
  const cosePublicKey = isoCBOR.encode(
    new Map<number, number | Uint8Array>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, new Uint8Array(x)],
      [-3, new Uint8Array(y)]
    ])
  )
  const credentialIdBytes = crypto.randomBytes(32)
  const credentialId = isoBase64URL.fromBuffer(new Uint8Array(credentialIdBytes))

  return {
    credentialId,
    buildRegistrationResponse(options: any, origin: string, counter = 0) {
      const rpId = options.rp.id
      const clientDataJSON = Buffer.from(
        JSON.stringify({
          type: 'webauthn.create',
          challenge: options.challenge,
          origin,
          crossOrigin: false
        })
      )
      const rpIdHash = sha256(rpId)
      // Flags: UP(0x01) + UV(0x04) + BE(0x08) + BS(0x10) + AT(0x40) = 0x5d (Cloud-synced Apple Passkey)
      const flags = Buffer.from([0x5d])
      const signCount = Buffer.alloc(4)
      signCount.writeUInt32BE(counter, 0)
      const aaguid = Buffer.from(aaguidHex, 'hex')
      const credIdLen = Buffer.alloc(2)
      credIdLen.writeUInt16BE(credentialIdBytes.length, 0)

      const authData = Buffer.concat([
        rpIdHash,
        flags,
        signCount,
        aaguid,
        credIdLen,
        credentialIdBytes,
        Buffer.from(cosePublicKey)
      ])
      const attestationObject = isoCBOR.encode(
        new Map<string, any>([
          ['fmt', 'none'],
          ['attStmt', new Map()],
          ['authData', new Uint8Array(authData)]
        ])
      )

      return {
        id: credentialId,
        rawId: credentialId,
        type: 'public-key' as const,
        authenticatorAttachment: 'platform' as const,
        clientExtensionResults: { credProps: { rk: true } },
        response: {
          clientDataJSON: isoBase64URL.fromBuffer(new Uint8Array(clientDataJSON)),
          attestationObject: isoBase64URL.fromBuffer(new Uint8Array(attestationObject)),
          transports: ['internal', 'hybrid']
        }
      }
    },
    buildAuthenticationResponse(options: any, origin: string, counter = 1) {
      const rpId = options.rpId
      const clientDataJSON = Buffer.from(
        JSON.stringify({
          type: 'webauthn.get',
          challenge: options.challenge,
          origin,
          crossOrigin: false
        })
      )
      const rpIdHash = sha256(rpId)
      const flags = Buffer.from([0x1d]) // UP + UV + BE + BS
      const signCount = Buffer.alloc(4)
      signCount.writeUInt32BE(counter, 0)
      const authData = Buffer.concat([rpIdHash, flags, signCount])

      const signedData = Buffer.concat([authData, sha256(clientDataJSON)])
      const signature = crypto.sign('sha256', signedData, privateKey)

      return {
        id: credentialId,
        rawId: credentialId,
        type: 'public-key' as const,
        authenticatorAttachment: 'platform' as const,
        clientExtensionResults: {},
        response: {
          clientDataJSON: isoBase64URL.fromBuffer(new Uint8Array(clientDataJSON)),
          authenticatorData: isoBase64URL.fromBuffer(new Uint8Array(authData)),
          signature: isoBase64URL.fromBuffer(new Uint8Array(signature)),
          userHandle: isoBase64URL.fromBuffer(new TextEncoder().encode(memberUserId))
        }
      }
    }
  }
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
    "role" TEXT NOT NULL DEFAULT 'USER',
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
  await prisma.$executeRawUnsafe(`CREATE TABLE "oauth_providers" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL UNIQUE,
    "displayName" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "clientSecret" TEXT NOT NULL,
    "callbackUrl" TEXT NOT NULL,
    "scope" TEXT,
    "authorizationUrl" TEXT,
    "tokenUrl" TEXT,
    "userinfoUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`)
  await prisma.$executeRawUnsafe(`CREATE TABLE "passkeys" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL UNIQUE,
    "publicKey" BLOB NOT NULL,
    "counter" INTEGER NOT NULL DEFAULT 0,
    "name" TEXT NOT NULL,
    "deviceType" TEXT NOT NULL DEFAULT 'multiDevice',
    "backedUp" BOOLEAN NOT NULL DEFAULT false,
    "transports" TEXT,
    "aaguid" TEXT,
    "lastUsedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "passkeys_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
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
      email: 'alice@example.com',
      username: 'alice',
      password: 'hashed-password',
      nickname: 'Alice',
      role: 'user'
    }
  })

  memberUserId = member.id
  adminToken = jwt.sign({ userId: admin.id }, process.env.JWT_SECRET!, { expiresIn: '1h' })
  memberToken = jwt.sign({ userId: member.id }, process.env.JWT_SECRET!, { expiresIn: '1h' })

  app = express()
  app.use(express.json())
  app.use(cookieParser())
  app.use('/api/auth/passkeys', passkeyRoutes)
  app.use('/api/oauth', oauthClientRoutes)
  app.use('/api/admin', adminRoutes)
  app.use(errorHandler)
})

after(async () => {
  memoryStore.destroy()
  await prisma.$disconnect()
  await rm(tempDir, { recursive: true, force: true })
})

test('resolveWebAuthnContext handles Vite proxy, reverse proxy, and rejects untrusted/insecure origins', async () => {
  const viteReq: any = {
    headers: { origin: 'http://localhost:3000', host: 'localhost:3001' },
    protocol: 'http',
    get: (k: string) => (k.toLowerCase() === 'host' ? 'localhost:3001' : undefined)
  }
  assert.deepEqual(resolveWebAuthnContext(viteReq), {
    rpID: 'localhost',
    rpName: 'HostID',
    expectedOrigin: 'http://localhost:3000'
  })

  await updateSettings({ siteUrl: 'https://id.example.com' })
  const httpsReq: any = {
    headers: {
      origin: 'https://id.example.com',
      'x-forwarded-host': 'id.example.com',
      'x-forwarded-proto': 'https'
    },
    protocol: 'http',
    get: () => '127.0.0.1:3001'
  }
  assert.deepEqual(resolveWebAuthnContext(httpsReq), {
    rpID: 'id.example.com',
    rpName: 'HostID',
    expectedOrigin: 'https://id.example.com'
  })

  const untrustedReq: any = {
    headers: { origin: 'https://evil.example.org', host: 'id.example.com' },
    protocol: 'https',
    get: () => 'id.example.com'
  }
  assert.throws(() => resolveWebAuthnContext(untrustedReq), { statusCode: 403 })

  const insecureHttpReq: any = {
    headers: { origin: 'http://id.example.com', host: 'id.example.com' },
    protocol: 'http',
    get: () => 'id.example.com'
  }
  assert.throws(() => resolveWebAuthnContext(insecureHttpReq), { statusCode: 400 })

  await updateSettings({ siteUrl: '' })
})

test('Passkey registration, management, admin toggle, passwordless login, and replay protection', async () => {
  assert.equal(getSettings().passkeyEnabled, false)

  // 1. Default status checks
  const oauthStatusOff = await dispatch(app, { method: 'GET', url: '/api/oauth/status' })
  assert.equal(oauthStatusOff.status, 200)
  assert.equal(oauthStatusOff.body.passkeyEnabled, false)

  const pkStatusOff = await dispatch(app, { method: 'GET', url: '/api/auth/passkeys/status' })
  assert.equal(pkStatusOff.status, 200)
  assert.equal(pkStatusOff.body.enabled, false)

  // Login blocked when passkeyEnabled is false
  const blockedLogin = await dispatch(app, {
    method: 'POST',
    url: '/api/auth/passkeys/login/options',
    headers: { origin: 'http://localhost:3000', host: 'localhost:3001' }
  })
  assert.equal(blockedLogin.status, 403)

  // 2. Profile Passkey registration (MacBook Pro / Apple Passwords platform mode)
  const regOptsRes = await dispatch(app, {
    method: 'POST',
    url: '/api/auth/passkeys/register/options',
    headers: {
      authorization: `Bearer ${memberToken}`,
      origin: 'http://localhost:3000',
      host: 'localhost:3001'
    },
    body: { authenticatorMode: 'platform' }
  })
  assert.equal(regOptsRes.status, 200)
  const { challengeId: regChallengeId, options: regOptions } = regOptsRes.body
  assert.equal(regOptions.rp.id, 'localhost')
  assert.equal(regOptions.authenticatorSelection.authenticatorAttachment, 'platform')
  assert.equal(regOptions.authenticatorSelection.residentKey, 'required')
  assert.equal(regOptions.authenticatorSelection.requireResidentKey, true)
  assert.deepEqual(regOptions.hints, ['client-device'])
  assert.equal(regOptions.pubKeyCredParams[0].alg, -7)

  const authenticator = createSyntheticES256Authenticator()
  const regResponse = authenticator.buildRegistrationResponse(regOptions, 'http://localhost:3000', 0)

  const regVerifyRes = await dispatch(app, {
    method: 'POST',
    url: '/api/auth/passkeys/register/verify',
    headers: {
      authorization: `Bearer ${memberToken}`,
      origin: 'http://localhost:3000',
      host: 'localhost:3001'
    },
    body: {
      challengeId: regChallengeId,
      response: regResponse
    }
  })
  assert.equal(regVerifyRes.status, 201)
  const createdPasskey = regVerifyRes.body.passkey
  assert.equal(createdPasskey.credentialId, authenticator.credentialId)
  assert.equal(createdPasskey.name, 'Apple 密码 / iCloud 钥匙串')
  assert.equal(createdPasskey.backedUp, true)
  assert.deepEqual(createdPasskey.transports, ['internal', 'hybrid'])

  // Registration challenge must be single-use
  const regReplay = await dispatch(app, {
    method: 'POST',
    url: '/api/auth/passkeys/register/verify',
    headers: { authorization: `Bearer ${memberToken}` },
    body: { challengeId: regChallengeId, response: regResponse }
  })
  assert.equal(regReplay.status, 400)

  // Next registration options ('all' mode) should exclude existing credential and omit authenticatorAttachment
  const regOptsAllRes = await dispatch(app, {
    method: 'POST',
    url: '/api/auth/passkeys/register/options',
    headers: {
      authorization: `Bearer ${memberToken}`,
      origin: 'http://localhost:3000',
      host: 'localhost:3001'
    },
    body: { authenticatorMode: 'all' }
  })
  assert.equal(regOptsAllRes.status, 200)
  assert.equal(regOptsAllRes.body.options.authenticatorSelection.authenticatorAttachment, undefined)
  assert.deepEqual(regOptsAllRes.body.options.hints, ['client-device', 'hybrid', 'security-key'])
  assert.equal(regOptsAllRes.body.options.excludeCredentials[0].id, authenticator.credentialId)

  // Rename passkey and enforce ownership
  const forbiddenRename = await dispatch(app, {
    method: 'PATCH',
    url: `/api/auth/passkeys/${createdPasskey.id}`,
    headers: { authorization: `Bearer ${adminToken}` },
    body: { name: 'Stolen' }
  })
  assert.equal(forbiddenRename.status, 404)

  const renameRes = await dispatch(app, {
    method: 'PATCH',
    url: `/api/auth/passkeys/${createdPasskey.id}`,
    headers: { authorization: `Bearer ${memberToken}` },
    body: { name: 'My MacBook Pro' }
  })
  assert.equal(renameRes.status, 200)
  assert.equal(renameRes.body.passkey.name, 'My MacBook Pro')

  // 3. Admin toggle & database table inspection
  const memberAdminDeny = await dispatch(app, {
    method: 'PUT',
    url: '/api/admin/passkey',
    headers: { authorization: `Bearer ${memberToken}` },
    body: { enabled: true }
  })
  assert.equal(memberAdminDeny.status, 403)

  const enableRes = await dispatch(app, {
    method: 'PUT',
    url: '/api/admin/passkey',
    headers: { authorization: `Bearer ${adminToken}` },
    body: { enabled: true }
  })
  assert.equal(enableRes.status, 200)
  assert.equal(enableRes.body.enabled, true)

  const oauthStatusOn = await dispatch(app, { method: 'GET', url: '/api/oauth/status' })
  assert.equal(oauthStatusOn.status, 200)
  assert.equal(oauthStatusOn.body.passkeyEnabled, true)

  const adminPasskeyTable = await dispatch(app, {
    method: 'GET',
    url: '/api/admin/tables/Passkey',
    headers: { authorization: `Bearer ${adminToken}` }
  })
  assert.equal(adminPasskeyTable.status, 200)
  assert.equal(adminPasskeyTable.body.data.length, 1)
  assert.equal(adminPasskeyTable.body.data[0].name, 'My MacBook Pro')
  assert.equal(adminPasskeyTable.body.data[0].publicKey, undefined)

  // 4. Passwordless Passkey login flow
  const authOptsRes = await dispatch(app, {
    method: 'POST',
    url: '/api/auth/passkeys/login/options',
    headers: { origin: 'http://localhost:3000', host: 'localhost:3001' }
  })
  assert.equal(authOptsRes.status, 200)
  const { challengeId: authChallengeId, options: authOptions } = authOptsRes.body
  assert.equal(authOptions.rpId, 'localhost')
  assert.equal(authOptions.allowCredentials, undefined)
  assert.deepEqual(authOptions.hints, ['client-device', 'hybrid', 'security-key'])

  const assertion = authenticator.buildAuthenticationResponse(authOptions, 'http://localhost:3000', 5)
  const authVerifyRes = await dispatch(app, {
    method: 'POST',
    url: '/api/auth/passkeys/login/verify',
    headers: { origin: 'http://localhost:3000', host: 'localhost:3001' },
    body: { challengeId: authChallengeId, response: assertion }
  })
  assert.equal(authVerifyRes.status, 200)
  assert.ok(typeof authVerifyRes.body.token === 'string' && authVerifyRes.body.token.length > 20)
  assert.equal(authVerifyRes.body.user.username, 'alice')
  assert.ok(Array.isArray(authVerifyRes.headers['set-cookie']))

  const dbRowAfterLogin = await prisma.passkey.findUnique({ where: { id: createdPasskey.id } })
  assert.equal(dbRowAfterLogin?.counter, 5)
  assert.ok(dbRowAfterLogin?.lastUsedAt instanceof Date)

  // Challenge replay must fail
  const authReplay = await dispatch(app, {
    method: 'POST',
    url: '/api/auth/passkeys/login/verify',
    headers: { origin: 'http://localhost:3000', host: 'localhost:3001' },
    body: { challengeId: authChallengeId, response: assertion }
  })
  assert.equal(authReplay.status, 400)

  // Counter rollback attack detection
  const rollbackOptsRes = await dispatch(app, {
    method: 'POST',
    url: '/api/auth/passkeys/login/options',
    headers: { origin: 'http://localhost:3000', host: 'localhost:3001' }
  })
  const rollbackAssertion = authenticator.buildAuthenticationResponse(rollbackOptsRes.body.options, 'http://localhost:3000', 3)
  const rollbackVerifyRes = await dispatch(app, {
    method: 'POST',
    url: '/api/auth/passkeys/login/verify',
    headers: { origin: 'http://localhost:3000', host: 'localhost:3001' },
    body: { challengeId: rollbackOptsRes.body.challengeId, response: rollbackAssertion }
  })
  assert.equal(rollbackVerifyRes.status, 401)

  // 5. Delete passkey & disable setting
  const deleteRes = await dispatch(app, {
    method: 'DELETE',
    url: `/api/auth/passkeys/${createdPasskey.id}`,
    headers: { authorization: `Bearer ${memberToken}` }
  })
  assert.equal(deleteRes.status, 200)
  assert.equal(deleteRes.body.credentialId, authenticator.credentialId)

  const disableRes = await dispatch(app, {
    method: 'PUT',
    url: '/api/admin/passkey',
    headers: { authorization: `Bearer ${adminToken}` },
    body: { enabled: false }
  })
  assert.equal(disableRes.status, 200)
  assert.equal(disableRes.body.enabled, false)
})
