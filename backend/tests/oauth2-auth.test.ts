import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { once } from 'node:events'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import express from 'express'
import cookieParser from 'cookie-parser'

function rsaEncrypt(publicKeyPem: string, plaintext: string): string {
  return crypto.publicEncrypt(
    { key: publicKeyPem, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    Buffer.from(plaintext, 'utf8')
  ).toString('base64')
}

test('OAuth2 authorization server and local auth flows work end-to-end after service extraction', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'hostid-oauth2-auth-')))
  const previous = {
    url: process.env.DATABASE_URL,
    dataDir: process.env.HOSTID_DATA_DIR,
    secret: process.env.JWT_SECRET,
    dataKey: process.env.DATA_ENCRYPTION_KEY
  }
  process.env.DATABASE_URL = `file:${join(directory, 'test.db')}?connection_limit=1`
  process.env.HOSTID_DATA_DIR = directory
  process.env.JWT_SECRET = 'oauth2-auth-test-jwt-secret-32-chars-min'
  process.env.DATA_ENCRYPTION_KEY = 'oauth2-auth-test-data-key-32-chars'

  const { prisma } = await import('../src/lib/prisma')
  const { memoryStore } = await import('../src/store')
  const { initSettings, updateSettings } = await import('../src/services/settings')
  const { encryptClientSecret, generateClientId, generateClientSecret } = await import('../src/services/oauth2')
  const { default: authRoutes } = await import('../src/routes/auth')
  const { default: oauthServerRoutes, authorizationServerMetadata } = await import('../src/routes/oauthServer')
  const { errorHandler } = await import('../src/middleware/error')

  let server: ReturnType<ReturnType<typeof express>['listen']> | undefined
  try {
    await prisma.$executeRawUnsafe(`CREATE TABLE User (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, username TEXT NOT NULL UNIQUE, password TEXT NOT NULL,
      nickname TEXT, phone TEXT, birthday TEXT, avatar TEXT, language TEXT NOT NULL DEFAULT 'zh-CN',
      role TEXT NOT NULL DEFAULT 'user', githubId INTEGER UNIQUE, createdAt DATETIME NOT NULL, updatedAt DATETIME NOT NULL
    )`)
    await prisma.$executeRawUnsafe(`CREATE TABLE oauth_apps (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, clientId TEXT NOT NULL UNIQUE, clientSecret TEXT NOT NULL,
      redirectUris TEXT NOT NULL, description TEXT, homepage TEXT,
      isConfidential BOOLEAN NOT NULL DEFAULT 1, isActive BOOLEAN NOT NULL DEFAULT 1,
      userId TEXT NOT NULL, createdAt DATETIME NOT NULL, updatedAt DATETIME NOT NULL
    )`)
    await prisma.$executeRawUnsafe(`CREATE TABLE refresh_tokens (
      id TEXT PRIMARY KEY, token TEXT NOT NULL UNIQUE, clientId TEXT NOT NULL, userId TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT 'openid profile email', expiresAt DATETIME NOT NULL, createdAt DATETIME NOT NULL
    )`)
    await prisma.$executeRawUnsafe(`CREATE TABLE system_settings (
      key TEXT PRIMARY KEY, value TEXT NOT NULL, isSecret BOOLEAN NOT NULL DEFAULT 0, updatedAt DATETIME NOT NULL
    )`)

    await initSettings()
    await updateSettings({ mailDomain: 'id.test', siteUrl: 'https://id.test' })

    const app = express()
    app.use(express.json())
    app.use(express.urlencoded({ extended: false }))
    app.use(cookieParser())
    app.use('/api/auth', authRoutes)
    app.get('/.well-known/oauth-authorization-server', authorizationServerMetadata)
    app.use('/api/oauth2', oauthServerRoutes)
    app.use(errorHandler)

    server = app.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

    // 1. 注册 → 获取 RSA 公钥 → RSA 加密登录 → 修改密码 → 用新密码登录
    const registerRes = await fetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'alice', password: 'initial-password' })
    })
    assert.equal(registerRes.status, 201)
    const regData = await registerRes.json() as { token: string; user: { id: string; email: string } }
    assert.equal(regData.user.email, 'alice@id.test')

    const { publicKey } = await (await fetch(`${base}/api/auth/public-key`)).json() as { publicKey: string }
    const loginRes = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'alice', password: rsaEncrypt(publicKey, 'initial-password') })
    })
    assert.equal(loginRes.status, 200)
    const { token: userToken } = await loginRes.json() as { token: string }

    const changePwdRes = await fetch(`${base}/api/auth/password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userToken}` },
      body: JSON.stringify({
        oldPassword: rsaEncrypt(publicKey, 'initial-password'),
        newPassword: rsaEncrypt(publicKey, 'rotated-password-1')
      })
    })
    assert.equal(changePwdRes.status, 200)

    const loginAfterChange = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'alice', password: rsaEncrypt(publicKey, 'rotated-password-1') })
    })
    assert.equal(loginAfterChange.status, 200)

    // 2. OAuth2 元数据 + 浏览器跳转同意页
    const metadata = await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json() as {
      issuer: string
      code_challenge_methods_supported: string[]
    }
    assert.equal(metadata.issuer, 'https://id.test')
    assert.deepEqual(metadata.code_challenge_methods_supported, ['S256'])

    const browserRedirect = await fetch(`${base}/api/oauth2/authorize?client_id=x`, { redirect: 'manual' })
    assert.equal(browserRedirect.status, 302)
    assert.equal(browserRedirect.headers.get('location'), '/oauth2/authorize?client_id=x')

    // 3. 授权码 + PKCE S256 流程 + Basic 鉴权换 token + Refresh Token 轮换与防重放
    const clientId = generateClientId()
    const clientSecret = generateClientSecret()
    const redirectUri = 'https://client.test/callback'
    await prisma.oAuthApp.create({
      data: {
        name: 'Demo Client',
        clientId,
        clientSecret: encryptClientSecret(clientSecret),
        redirectUris: JSON.stringify([redirectUri]),
        isConfidential: true,
        isActive: true,
        userId: regData.user.id
      }
    })

    const codeVerifier = crypto.randomBytes(32).toString('base64url')
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url')

    const previewRes = await fetch(
      `${base}/api/oauth2/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=openid%20email&state=st-1&code_challenge=${codeChallenge}&code_challenge_method=S256`,
      { headers: { Authorization: `Bearer ${userToken}` } }
    )
    assert.equal(previewRes.status, 200)
    const preview = await previewRes.json() as { scope: string; codeChallengeMethod: string }
    assert.equal(preview.scope, 'openid email')
    assert.equal(preview.codeChallengeMethod, 'S256')

    const approveRes = await fetch(`${base}/api/oauth2/authorize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userToken}` },
      body: JSON.stringify({
        client_id: clientId,
        redirect_uri: redirectUri,
        scope: 'openid email',
        state: 'st-1',
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        approve: true
      })
    })
    assert.equal(approveRes.status, 200)
    const { redirectUrl } = await approveRes.json() as { redirectUrl: string }
    const code = new URL(redirectUrl).searchParams.get('code')
    assert.ok(code)

    const basicAuth = Buffer.from(`${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`).toString('base64')
    const tokenRes = await fetch(`${base}/api/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basicAuth}` },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code!,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier
      }).toString()
    })
    assert.equal(tokenRes.status, 200)
    const tokens = await tokenRes.json() as { access_token: string; refresh_token: string; scope: string }
    assert.equal(tokens.scope, 'openid email')

    // UserInfo 只返回被授予的 email scope，不泄露 profile 字段
    const userinfoRes = await fetch(`${base}/api/oauth2/userinfo`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` }
    })
    assert.equal(userinfoRes.status, 200)
    const claims = await userinfoRes.json() as Record<string, unknown>
    assert.equal(claims.sub, regData.user.id)
    assert.equal(claims.email, 'alice@id.test')
    assert.equal('username' in claims, false)

    // 刷新令牌轮换：首次成功，重放旧刷新令牌被拒绝
    const refreshRes = await fetch(`${base}/api/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basicAuth}` },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token }).toString()
    })
    assert.equal(refreshRes.status, 200)
    const rotated = await refreshRes.json() as { refresh_token: string }
    assert.notEqual(rotated.refresh_token, tokens.refresh_token)

    const replayRes = await fetch(`${base}/api/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basicAuth}` },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token }).toString()
    })
    assert.equal(replayRes.status, 400)
    assert.equal((await replayRes.json() as { error: string }).error, 'invalid_grant')

    // 无效 Bearer 返回 401 + WWW-Authenticate
    const badUserinfo = await fetch(`${base}/api/oauth2/userinfo`)
    assert.equal(badUserinfo.status, 401)
    assert.match(badUserinfo.headers.get('www-authenticate') || '', /^Bearer realm="hostid"/)
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
