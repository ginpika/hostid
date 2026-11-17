import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import bcrypt from 'bcryptjs'
import cookieParser from 'cookie-parser'
import express from 'express'
import jwt from 'jsonwebtoken'

test('refactored contracts: admin tables, unified adminGuard, Zod 400 mapping, OAuth provider cache invalidation, and SSO session lifecycle', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'hostid-refactor-contracts-')))
  const previous = {
    url: process.env.DATABASE_URL,
    dataDir: process.env.HOSTID_DATA_DIR,
    secret: process.env.JWT_SECRET,
    dataKey: process.env.DATA_ENCRYPTION_KEY
  }
  process.env.DATABASE_URL = `file:${join(directory, 'test.db')}?connection_limit=1`
  process.env.HOSTID_DATA_DIR = directory
  process.env.JWT_SECRET = 'refactor-contracts-jwt-secret-32-chars-min'
  process.env.DATA_ENCRYPTION_KEY = 'refactor-contracts-data-key-32-chars'

  const { prisma } = await import('../src/lib/prisma')
  const { memoryStore } = await import('../src/store')
  const { initSettings } = await import('../src/services/settings')
  const { getActiveProviderConfig } = await import('../src/services/oauth-provider-registry')
  const { default: adminRoutes } = await import('../src/routes/admin')
  const { default: authRoutes } = await import('../src/routes/auth')
  const { default: oauthAppsRoutes } = await import('../src/routes/oauthApps')
  const { default: oauthConfigRoutes } = await import('../src/routes/oauthConfig')
  const { default: ssoRoutes } = await import('../src/routes/sso')
  const { default: setupRoutes } = await import('../src/routes/setup')
  const { errorHandler } = await import('../src/middleware/error')

  let server: ReturnType<ReturnType<typeof express>['listen']> | undefined
  try {
    await prisma.$executeRawUnsafe(`CREATE TABLE User (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, username TEXT NOT NULL UNIQUE, password TEXT NOT NULL,
      nickname TEXT, phone TEXT, birthday TEXT, avatar TEXT, language TEXT NOT NULL DEFAULT 'zh-CN',
      role TEXT NOT NULL DEFAULT 'user', githubId INTEGER UNIQUE, createdAt DATETIME NOT NULL, updatedAt DATETIME NOT NULL
    )`)
    await prisma.$executeRawUnsafe(`CREATE TABLE Email (
      id TEXT PRIMARY KEY, "from" TEXT NOT NULL, fromName TEXT, "to" TEXT NOT NULL,
      toList TEXT NOT NULL DEFAULT '[]', ccList TEXT DEFAULT '[]', bccList TEXT DEFAULT '[]', subject TEXT NOT NULL,
      body TEXT NOT NULL, summary TEXT, folder TEXT NOT NULL DEFAULT 'INBOX', isRead BOOLEAN NOT NULL DEFAULT 0,
      isStarred BOOLEAN NOT NULL DEFAULT 0, createdAt DATETIME NOT NULL, updatedAt DATETIME NOT NULL, userId TEXT NOT NULL
    )`)
    await prisma.$executeRawUnsafe(`CREATE TABLE Attachment (
      id TEXT PRIMARY KEY, filename TEXT NOT NULL, originalName TEXT NOT NULL,
      mimeType TEXT NOT NULL, size INTEGER NOT NULL, path TEXT NOT NULL, createdAt DATETIME NOT NULL
    )`)
    await prisma.$executeRawUnsafe(`CREATE TABLE EmailAttachment (
      id TEXT PRIMARY KEY, emailId TEXT NOT NULL, attachmentId TEXT NOT NULL,
      FOREIGN KEY (emailId) REFERENCES Email(id) ON DELETE CASCADE,
      FOREIGN KEY (attachmentId) REFERENCES Attachment(id) ON DELETE CASCADE
    )`)
    await prisma.$executeRawUnsafe(`CREATE TABLE oauth_providers (
      id TEXT PRIMARY KEY, provider TEXT NOT NULL UNIQUE, displayName TEXT NOT NULL,
      clientId TEXT NOT NULL, clientSecret TEXT NOT NULL, callbackUrl TEXT NOT NULL,
      authorizationUrl TEXT NOT NULL DEFAULT 'https://github.com/login/oauth/authorize',
      tokenUrl TEXT NOT NULL DEFAULT 'https://github.com/login/oauth/access_token',
      userinfoUrl TEXT NOT NULL DEFAULT 'https://api.github.com/user',
      isActive BOOLEAN NOT NULL DEFAULT 0, createdAt DATETIME NOT NULL, updatedAt DATETIME NOT NULL
    )`)
    await prisma.$executeRawUnsafe(`CREATE TABLE oauth_apps (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, clientId TEXT NOT NULL UNIQUE, clientSecret TEXT NOT NULL,
      redirectUris TEXT NOT NULL, description TEXT, homepage TEXT,
      isConfidential BOOLEAN NOT NULL DEFAULT 1, isActive BOOLEAN NOT NULL DEFAULT 1,
      userId TEXT NOT NULL, createdAt DATETIME NOT NULL, updatedAt DATETIME NOT NULL
    )`)
    await prisma.$executeRawUnsafe(`CREATE TABLE passkeys (
      id TEXT PRIMARY KEY, userId TEXT NOT NULL, credentialId TEXT NOT NULL UNIQUE, publicKey BLOB NOT NULL,
      counter INTEGER NOT NULL DEFAULT 0, name TEXT NOT NULL, deviceType TEXT NOT NULL DEFAULT 'multiDevice',
      backedUp BOOLEAN NOT NULL DEFAULT 0, transports TEXT, aaguid TEXT, lastUsedAt DATETIME,
      createdAt DATETIME NOT NULL, updatedAt DATETIME NOT NULL
    )`)
    await prisma.$executeRawUnsafe(`CREATE TABLE system_settings (
      key TEXT PRIMARY KEY, value TEXT NOT NULL, isSecret BOOLEAN NOT NULL DEFAULT 0, updatedAt DATETIME NOT NULL
    )`)

    await initSettings()

    const app = express()
    app.use(express.json())
    app.use(cookieParser())
    app.use('/api/setup', setupRoutes)
    app.use('/api/auth', authRoutes)
    app.use('/api/admin', adminRoutes)
    app.use('/api/admin/oauth', oauthConfigRoutes)
    app.use('/api/admin/oauth-apps', oauthAppsRoutes)
    app.use('/api/sso', ssoRoutes)
    app.use(errorHandler)

    server = app.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

    const jsonReq = (path: string, opts: { method?: string; token?: string; cookie?: string; body?: unknown } = {}) =>
      fetch(`${base}${path}`, {
        method: opts.method ?? 'GET',
        headers: {
          ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
          ...(opts.cookie ? { Cookie: opts.cookie } : {})
        },
        ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {})
      })

    // 1. Setup 校验错误应为 400 而非 500，成功后创建首位管理员
    const badSetup = await jsonReq('/api/setup', { method: 'POST', body: { username: 'x', password: 'short' } })
    assert.equal(badSetup.status, 400)

    const setupPassword = 'StrongAdminPassword123!'
    const setupRes = await jsonReq('/api/setup', {
      method: 'POST',
      body: { username: 'rootadmin', password: setupPassword, mailDomain: 'example.test' }
    })
    assert.equal(setupRes.status, 201)
    const { user: adminUser } = await setupRes.json() as { user: { id: string } }

    const memberPasswordHash = await bcrypt.hash('member-pass-123', 10)
    const member = await prisma.user.create({
      data: { username: 'member', email: 'member@example.test', password: memberPasswordHash, role: 'user' }
    })

    const adminToken = jwt.sign({ userId: adminUser.id }, process.env.JWT_SECRET!)
    const memberToken = jwt.sign({ userId: member.id }, process.env.JWT_SECRET!)

    // 2. adminGuard 在各管理端路由响应格式统一
    for (const protectedPath of ['/api/admin/tables', '/api/admin/oauth/providers', '/api/admin/oauth-apps']) {
      const unauth = await jsonReq(protectedPath)
      assert.equal(unauth.status, 401)
      assert.deepEqual(await unauth.json(), { error: 'Authentication required' })

      const forbidden = await jsonReq(protectedPath, { token: memberToken })
      assert.equal(forbidden.status, 403)
      assert.deepEqual(await forbidden.json(), { error: 'Admin access required' })
    }

    // 3. Zod 校验在 auth / oauthApps / oauthConfig / sso 均返回 400 而非 500
    assert.equal((await jsonReq('/api/auth/register', { method: 'POST', body: { username: 'a', password: '1' } })).status, 400)
    assert.equal((await jsonReq('/api/admin/oauth-apps', { method: 'POST', token: adminToken, body: { name: '' } })).status, 400)
    assert.equal((await jsonReq('/api/admin/oauth/providers', { method: 'POST', token: adminToken, body: { provider: '' } })).status, 400)
    assert.equal((await jsonReq('/api/sso/login', { method: 'POST', body: { username: 'member' } })).status, 400)

    // 4. OAuth Provider 配置与缓存失效联动
    const createProviderRes = await jsonReq('/api/admin/oauth/providers', {
      method: 'POST',
      token: adminToken,
      body: {
        provider: 'custom',
        displayName: 'Custom IdP',
        clientId: 'cid-1',
        clientSecret: 'secret-value-1234',
        callbackUrl: 'https://host.test/cb',
        authorizationUrl: 'https://idp.test/auth',
        tokenUrl: 'https://idp.test/token',
        userinfoUrl: 'https://idp.test/userinfo'
      }
    })
    assert.equal(createProviderRes.status, 201)
    const createdProvider = await createProviderRes.json() as { id: string; clientSecret: string; isActive: boolean }
    assert.equal(createdProvider.isActive, false)
    assert.ok(createdProvider.clientSecret.includes('****'))
    assert.equal(await getActiveProviderConfig('custom'), null)

    // 启用后缓存立即可用；修改后再读能拿到最新解密值；删除后缓存清除
    const toggleRes = await jsonReq(`/api/admin/oauth/providers/${createdProvider.id}/toggle`, {
      method: 'PATCH',
      token: adminToken
    })
    assert.equal(toggleRes.status, 200)
    const activeCfg = await getActiveProviderConfig('custom')
    assert.equal(activeCfg?.clientSecret, 'secret-value-1234')

    const updateRes = await jsonReq(`/api/admin/oauth/providers/${createdProvider.id}`, {
      method: 'PUT',
      token: adminToken,
      body: { clientSecret: 'rotated-secret-5678' }
    })
    assert.equal(updateRes.status, 200)
    assert.equal((await getActiveProviderConfig('custom'))?.clientSecret, 'rotated-secret-5678')

    // 5. admin 表浏览器列定义无 scope 漂移，且未知表返回 400
    const tablesRes = await jsonReq('/api/admin/tables', { token: adminToken })
    assert.equal(tablesRes.status, 200)
    const tablesJson = await tablesRes.json() as { tables: { name: string; count: number }[] }
    assert.equal(tablesJson.tables.length, 6)

    const providerTableRes = await jsonReq('/api/admin/tables/oauthprovider', { token: adminToken })
    assert.equal(providerTableRes.status, 200)
    const providerTable = await providerTableRes.json() as { columns: string[]; data: Record<string, unknown>[] }
    assert.equal(providerTable.columns.includes('scope'), false)
    assert.equal(providerTable.data.length, 1)
    assert.deepEqual(Object.keys(providerTable.data[0]).sort(), [...providerTable.columns].sort())

    assert.equal((await jsonReq('/api/admin/tables/nonexistent', { token: adminToken })).status, 400)

    // 删除 Provider 清理缓存
    assert.equal((await jsonReq(`/api/admin/oauth/providers/${createdProvider.id}`, { method: 'DELETE', token: adminToken })).status, 200)
    assert.equal(await getActiveProviderConfig('custom'), null)

    // 6. OAuthApp 创建隐藏明文（列表与详情打码），404 统一错误格式
    const createAppRes = await jsonReq('/api/admin/oauth-apps', {
      method: 'POST',
      token: adminToken,
      body: {
        name: 'Test App',
        redirectUris: ['https://app.test/cb'],
        scope: 'deprecated-field'
      }
    })
    assert.equal(createAppRes.status, 201)
    const createdApp = await createAppRes.json() as { id: string; clientSecret: string }
    assert.ok(!createdApp.clientSecret.includes('****'))

    const getAppRes = await jsonReq(`/api/admin/oauth-apps/${createdApp.id}`, { token: adminToken })
    assert.equal(getAppRes.status, 200)
    const fetchedApp = await getAppRes.json() as { clientSecret: string }
    assert.ok(fetchedApp.clientSecret.includes('****'))
    assert.equal('scope' in fetchedApp, false)
    assert.equal((await jsonReq('/api/admin/oauth-apps/missing-id', { token: adminToken })).status, 404)

    // 7. SSO 登录 → 验证 → 登出吊销（全走 services/session 单一实现）
    const ssoLoginRes = await jsonReq('/api/sso/login', {
      method: 'POST',
      body: { username: 'member', password: 'member-pass-123' }
    })
    assert.equal(ssoLoginRes.status, 200)
    const setCookie = ssoLoginRes.headers.get('set-cookie')
    assert.ok(setCookie)
    const cookiePair = setCookie.split(';')[0]

    const verifyOk = await jsonReq('/api/sso/verify', { method: 'POST', cookie: cookiePair })
    assert.equal((await verifyOk.json() as { valid: boolean }).valid, true)

    const logoutRes = await jsonReq('/api/auth/logout', { method: 'POST', cookie: cookiePair })
    assert.equal(logoutRes.status, 200)

    const verifyAfterLogout = await jsonReq('/api/sso/verify', { method: 'POST', cookie: cookiePair })
    assert.equal((await verifyAfterLogout.json() as { valid: boolean }).valid, false)
  } finally {
    server?.close()
    memoryStore.destroy()
    await prisma.$disconnect()
    for (const [key, value] of Object.entries({
      DATABASE_URL: previous.url,
      HOSTID_DATA_DIR: previous.dataDir,
      JWT_SECRET: previous.secret,
      DATA_ENCRYPTION_KEY: previous.dataKey
    })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value
    }
    await rm(directory, { recursive: true, force: true })
  }
})
