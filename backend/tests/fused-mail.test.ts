import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, after, before } from 'node:test'

const directory = await mkdtemp(join(tmpdir(), 'hostid-fused-mail-'))
const previousUrl = process.env.DATABASE_URL
const previousSecret = process.env.JWT_SECRET
process.env.DATABASE_URL = `file:${join(directory, 'test.db')}`
process.env.JWT_SECRET = 'fused-mail-test-secret'

const { prisma } = await import('../src/lib/prisma')
const migrationsDir = new URL('../prisma/migrations/', import.meta.url)
const FUSED_MIGRATION = '20261102150000_fused_mail'

async function applyMigration(name: string) {
  const sql = await readFile(new URL(`${name}/migration.sql`, migrationsDir), 'utf8')
  for (const statement of sql.split(/;\s*\n/)) {
    const body = statement.split('\n').filter(line => !line.trim().startsWith('--')).join('\n').trim()
    if (body) await prisma.$executeRawUnsafe(body)
  }
}

const realFetch = globalThis.fetch

before(async () => {
  const names = (await readdir(migrationsDir, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name).sort()
  for (const name of names.filter(name => name < FUSED_MIGRATION)) await applyMigration(name)
  // 迁移前已存在的 provider：迁移后应默认只勾「登录」
  await prisma.$executeRawUnsafe(`INSERT INTO oauth_providers (id, provider, displayName, clientId, clientSecret, callbackUrl, isActive, updatedAt)
    VALUES ('legacy', 'github', 'GitHub', 'gh-id', 'gh-secret', 'https://example.com/api/oauth/github/callback', 1, CURRENT_TIMESTAMP)`)
  for (const name of names.filter(name => name >= FUSED_MIGRATION)) await applyMigration(name)
  await prisma.user.create({ data: { id: 'u1', email: 'u1@example.com', username: 'u1', password: '' } })
  await prisma.user.create({ data: { id: 'u2', email: 'u2@example.com', username: 'u2', password: '' } })
  const { encrypt } = await import('../src/services/encryption')
  await prisma.oAuthProvider.create({ data: {
    id: 'ms', provider: 'microsoft', displayName: 'Microsoft', clientId: 'ms-id', clientSecret: encrypt('ms-secret'),
    callbackUrl: 'https://example.com/api/oauth/microsoft/callback', isActive: true, useForLogin: false, useForFusedMail: true,
    mailPlatform: 'outlook', tokenUrl: 'https://login.example.test/token'
  } })
  await prisma.oAuthProvider.create({ data: {
    id: 'google', provider: 'google', displayName: 'Google', clientId: 'g-id', clientSecret: encrypt('g-secret'),
    callbackUrl: 'https://example.com/api/oauth/google/callback', isActive: true, useForLogin: true, useForFusedMail: true,
    mailPlatform: 'gmail', tokenUrl: 'https://google.example.test/token'
  } })
})

after(async () => {
  globalThis.fetch = realFetch
  // 路由模块会初始化内存 store 的清理定时器，测试结束时关掉
  const { memoryStore } = await import('../src/store')
  memoryStore.destroy()
  await prisma.$disconnect()
  if (previousUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousUrl
  if (previousSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previousSecret
  await rm(directory, { recursive: true, force: true })
})

const tokens = (access: string, refresh?: string) => ({ access_token: access, refresh_token: refresh, expires_in: 3600 })

test('migration keeps existing providers login-only', async () => {
  const legacy = await prisma.oAuthProvider.findUniqueOrThrow({ where: { id: 'legacy' } })
  assert.equal(legacy.useForLogin, true)
  assert.equal(legacy.useForFusedMail, false)
  assert.equal(legacy.mailPlatform, null)
})

test('provider usage filters keep login and fused mail separate', async () => {
  const { loginProviderWhere } = await import('../src/routes/oauthClient')
  const { getFusedMailProviders } = await import('../src/routes/fusedMail')
  const { validateProviderUsage } = await import('../src/routes/oauthConfig')
  const login = await prisma.oAuthProvider.findMany({ where: loginProviderWhere, orderBy: { provider: 'asc' } })
  assert.deepEqual(login.map(p => p.provider), ['github', 'google'])
  const fused = await getFusedMailProviders()
  assert.deepEqual(fused.map(p => p.provider).sort(), ['google', 'microsoft'])
  assert.match(validateProviderUsage({ useForLogin: false, useForFusedMail: false }) || '', /at least one/)
  assert.match(validateProviderUsage({ useForLogin: false, useForFusedMail: true, mailPlatform: null }) || '', /platform/)
  assert.equal(validateProviderUsage({ useForLogin: true, useForFusedMail: true, mailPlatform: 'gmail' }), null)
})

test('tokens are stored per user + platform + email and encrypted', async () => {
  const { saveAuthorizedAccount } = await import('../src/services/fusedMail/tokenStore')
  const { decrypt } = await import('../src/services/encryption')
  const a = await saveAuthorizedAccount({ userId: 'u1', providerId: 'ms', platform: 'outlook', email: 'A@Outlook.com', tokens: tokens('access-a', 'refresh-a') })
  const b = await saveAuthorizedAccount({ userId: 'u1', providerId: 'ms', platform: 'outlook', email: 'b@hotmail.com', tokens: tokens('access-b', 'refresh-b') })
  assert.equal(a.created, true)
  assert.equal(b.created, true)
  assert.notEqual(a.account.id, b.account.id)
  assert.equal(a.account.email, 'a@outlook.com')
  assert.ok(a.account.refreshToken.startsWith('enc:'))
  assert.ok(!a.account.accessToken.includes('access-a'))

  // 同一邮箱再次授权 = 重新授权，只更新自己，不覆盖同平台另一个账号
  const again = await saveAuthorizedAccount({ userId: 'u1', providerId: 'ms', platform: 'outlook', email: 'a@outlook.com', tokens: tokens('access-a2', 'refresh-a2') })
  assert.equal(again.created, false)
  assert.equal(again.account.id, a.account.id)
  assert.equal(await prisma.fusedMailAccount.count({ where: { userId: 'u1', platform: 'outlook' } }), 2)
  const storedB = await prisma.fusedMailAccount.findUniqueOrThrow({ where: { id: b.account.id } })
  assert.equal(decrypt(storedB.refreshToken), 'refresh-b')
  assert.equal(decrypt(storedB.accessToken), 'access-b')

  // Google 重新授权有时不再下发 refresh token：保留旧的
  const g1 = await saveAuthorizedAccount({ userId: 'u1', providerId: 'google', platform: 'gmail', email: 'x@gmail.com', tokens: tokens('g-access', 'g-refresh') })
  await saveAuthorizedAccount({ userId: 'u1', providerId: 'google', platform: 'gmail', email: 'x@gmail.com', tokens: tokens('g-access-2') })
  assert.equal(decrypt((await prisma.fusedMailAccount.findUniqueOrThrow({ where: { id: g1.account.id } })).refreshToken), 'g-refresh')
  // 新账号没有 refresh token 则拒绝
  await assert.rejects(saveAuthorizedAccount({ userId: 'u1', providerId: 'google', platform: 'gmail', email: 'y@gmail.com', tokens: tokens('only-access') }), /refresh token/)

  // 另一个用户可以绑定同一个邮箱，互不影响
  const other = await saveAuthorizedAccount({ userId: 'u2', providerId: 'ms', platform: 'outlook', email: 'a@outlook.com', tokens: tokens('u2-access', 'u2-refresh') })
  assert.equal(other.created, true)
  assert.notEqual(other.account.id, a.account.id)
})

test('refresh rotates the refresh token, writes it back and is locked per account', async () => {
  const { getValidAccessToken } = await import('../src/services/fusedMail/tokenStore')
  const { decrypt } = await import('../src/services/encryption')
  const account = await prisma.fusedMailAccount.findUniqueOrThrow({ where: { userId_platform_email: { userId: 'u1', platform: 'outlook', email: 'a@outlook.com' } } })
  await prisma.fusedMailAccount.update({ where: { id: account.id }, data: { accessTokenExpiresAt: new Date(Date.now() - 1000) } })
  const calls: URLSearchParams[] = []
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    calls.push(new URLSearchParams(String(init.body)))
    await new Promise(resolve => setTimeout(resolve, 20))
    return new Response(JSON.stringify({ access_token: 'rotated-access', refresh_token: 'rotated-refresh', expires_in: 3600 }), { status: 200 })
  }) as typeof fetch
  try {
    const [first, second] = await Promise.all([getValidAccessToken(account.id), getValidAccessToken(account.id)])
    assert.equal(first, 'rotated-access')
    assert.equal(second, 'rotated-access')
    assert.equal(calls.length, 1, 'concurrent refreshes of one account must be serialized')
    assert.equal(calls[0].get('grant_type'), 'refresh_token')
    assert.equal(calls[0].get('refresh_token'), 'refresh-a2')
    assert.equal(calls[0].get('client_secret'), 'ms-secret')
    const stored = await prisma.fusedMailAccount.findUniqueOrThrow({ where: { id: account.id } })
    assert.equal(decrypt(stored.refreshToken), 'rotated-refresh')
    assert.equal(stored.status, 'active')
  } finally {
    globalThis.fetch = realFetch
  }
})

test('a failed refresh only marks that account for re-authorization', async () => {
  const { getValidAccessToken, FusedMailAuthError } = await import('../src/services/fusedMail/tokenStore')
  const a = await prisma.fusedMailAccount.findUniqueOrThrow({ where: { userId_platform_email: { userId: 'u1', platform: 'outlook', email: 'a@outlook.com' } } })
  const b = await prisma.fusedMailAccount.findUniqueOrThrow({ where: { userId_platform_email: { userId: 'u1', platform: 'outlook', email: 'b@hotmail.com' } } })
  await prisma.fusedMailAccount.updateMany({ where: { id: { in: [a.id, b.id] } }, data: { accessTokenExpiresAt: new Date(Date.now() - 1000) } })
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    const refresh = new URLSearchParams(String(init.body)).get('refresh_token')
    if (refresh === 'rotated-refresh') return new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'revoked' }), { status: 400 })
    return new Response(JSON.stringify({ access_token: 'b-new', expires_in: 3600 }), { status: 200 })
  }) as typeof fetch
  try {
    await assert.rejects(getValidAccessToken(a.id), (error: unknown) => error instanceof FusedMailAuthError && error.reauth)
    assert.equal(await getValidAccessToken(b.id), 'b-new')
    assert.equal((await prisma.fusedMailAccount.findUniqueOrThrow({ where: { id: a.id } })).status, 'reauth_required')
    const storedB = await prisma.fusedMailAccount.findUniqueOrThrow({ where: { id: b.id } })
    assert.equal(storedB.status, 'active')
    // 未轮换时保留原 refresh token
    const { decrypt } = await import('../src/services/encryption')
    assert.equal(decrypt(storedB.refreshToken), 'refresh-b')
  } finally {
    globalThis.fetch = realFetch
  }
})

test('fused inbox only lists the current user mail and filters by account', async () => {
  const { buildFusedListWhere, parseFusedListQuery } = await import('../src/lib/fused-mail-query')
  const accounts = await prisma.fusedMailAccount.findMany({ where: { platform: 'outlook' } })
  const base = { uidValidity: '1', from: 's@example.com', to: 'x', subject: 'hi', body: '<p>hi</p>' }
  let uid = 1
  for (const account of accounts) await prisma.fusedEmail.create({ data: { ...base, uid: uid++, accountId: account.id } })
  const u1Accounts = accounts.filter(account => account.userId === 'u1')
  assert.equal(await prisma.fusedEmail.count({ where: buildFusedListWhere('u1', parseFusedListQuery({})) }), u1Accounts.length)
  assert.equal(await prisma.fusedEmail.count({ where: buildFusedListWhere('u1', parseFusedListQuery({ accountId: u1Accounts[0].id })) }), 1)
  const u2Account = accounts.find(account => account.userId === 'u2')!
  assert.equal(await prisma.fusedEmail.count({ where: buildFusedListWhere('u1', parseFusedListQuery({ accountId: u2Account.id })) }), 0)
  // 同一账号同一 UIDVALIDITY 下 UID 唯一
  await assert.rejects(prisma.fusedEmail.create({ data: { ...base, uid: 1, accountId: accounts[0].id } }))
})

test('authorization URLs request offline access and account selection', async () => {
  const { buildAuthorizationUrl, emailFromIdToken } = await import('../src/services/fusedMail/platforms')
  const { computeFetchRange } = await import('../src/services/fusedMail/sync')
  const google = new URL(buildAuthorizationUrl({ platform: 'gmail', authorizationUrl: '', clientId: 'c', redirectUri: 'https://h/cb', state: 's', codeChallenge: 'cc' }))
  assert.equal(google.searchParams.get('access_type'), 'offline')
  assert.equal(google.searchParams.get('prompt'), 'select_account consent')
  assert.equal(google.searchParams.get('scope'), 'https://mail.google.com/ openid email')
  const ms = new URL(buildAuthorizationUrl({ platform: 'outlook', authorizationUrl: '', clientId: 'c', redirectUri: 'https://h/cb', state: 's', codeChallenge: 'cc', loginHint: 'a@outlook.com' }))
  assert.equal(ms.searchParams.get('prompt'), 'select_account')
  assert.equal(ms.searchParams.get('scope'), 'https://outlook.office.com/IMAP.AccessAsUser.All offline_access openid email')
  assert.equal(ms.searchParams.get('login_hint'), 'a@outlook.com')
  const idToken = `x.${Buffer.from(JSON.stringify({ email: 'Me@Gmail.com' })).toString('base64url')}.y`
  assert.equal(emailFromIdToken(idToken), 'me@gmail.com')
  assert.equal(emailFromIdToken('garbage'), null)
  assert.equal(computeFetchRange(0, 1000, 200), '800:*')
  assert.equal(computeFetchRange(0, 50, 200), '1:*')
  assert.equal(computeFetchRange(41, 50), '42:*')
  assert.equal(computeFetchRange(49, 50), null)
})

test('auto sync skips re-auth accounts and accounts synced within the cooldown, without touching IMAP', async () => {
  const { syncAccounts, AUTO_SYNC_COOLDOWN_MS } = await import('../src/services/fusedMail/sync')
  const now = new Date()
  await prisma.fusedMailAccount.updateMany({ where: { userId: 'u1' }, data: { lastSyncedAt: new Date(now.getTime() - 30_000) } })
  const active = await prisma.fusedMailAccount.findMany({ where: { userId: 'u1', status: { not: 'reauth_required' } }, select: { id: true } })
  assert.ok(active.length > 0)
  const results = await syncAccounts({ userId: 'u1' }, { cooldownMs: AUTO_SYNC_COOLDOWN_MS, now })
  assert.deepEqual(results.map(r => r.accountId).sort(), active.map(a => a.id).sort())
  assert.ok(results.every(r => r.skipped && r.ok && r.added === 0))
})
