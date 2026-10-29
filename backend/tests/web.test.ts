import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { once } from 'node:events'
import express from 'express'
import { mountWebFrontend } from '../src/web'

test('full image serves the SPA, assets, and public runtime configuration without swallowing API errors', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'hostid-web-'))
  mkdirSync(path.join(root, 'assets'))
  writeFileSync(path.join(root, 'index.html'), '<div id="root"></div>')
  writeFileSync(path.join(root, 'assets', 'app-123.js'), 'console.log("app")')
  writeFileSync(path.join(root, 'config.js'), 'unexpanded template')
  writeFileSync(path.join(root, '.env'), 'secret')

  const app = express()
  app.get('/api/example', (_req, res) => res.json({ ok: true }))
  app.get('/sso/login', (_req, res) => res.redirect('/login'))
  mountWebFrontend(app, root, '1x00000000000000000000AA')
  const server = app.listen(0, '127.0.0.1')
  try {
    await once(server, 'listening')
    const address = server.address()
    assert.ok(address && typeof address !== 'string')
    const get = (url: string, init?: RequestInit) => fetch(`http://127.0.0.1:${address.port}${url}`, init)

    for (const route of ['/', '/login', '/admin/oauth', '/oauth/callback?code=example', '/index.html']) {
      const response = await get(route)
      assert.equal(response.status, 200, route)
      assert.equal(response.headers.get('cache-control'), 'no-cache')
      assert.match(await response.text(), /id="root"/)
    }
    assert.deepEqual(await (await get('/api/example')).json(), { ok: true })
    assert.equal((await get('/sso/login', { redirect: 'manual' })).status, 302)
    for (const route of ['/api', '/api/missing', '/api/auth/missing', '/attachments/missing']) {
      const response = await get(route)
      assert.equal(response.status, 404, route)
      assert.deepEqual(await response.json(), { error: 'Not found' })
    }
    for (const route of ['/assets/missing.js', '/assets/missing', '/missing.png', '/.env']) {
      assert.equal((await get(route)).status, 404, route)
    }
    assert.equal((await get('/login', { method: 'POST' })).status, 404)
    assert.equal((await get('/missing', { headers: { Accept: 'application/json' } })).status, 404)
    const asset = await get('/assets/app-123.js')
    assert.equal(asset.status, 200)
    assert.equal(asset.headers.get('cache-control'), 'public, max-age=31536000, immutable')
    const config = await get('/config.js')
    assert.equal(config.headers.get('cache-control'), 'no-store')
    assert.match(config.headers.get('content-type') || '', /javascript/)
    assert.equal(await config.text(), 'window.__ENV__ = {"CF_TURNSTILE_SITE_KEY":"1x00000000000000000000AA"};\n')
    assert.equal((await get('/login', { method: 'HEAD' })).status, 200)

    assert.throws(() => mountWebFrontend(express(), root, '\";alert(1)'), /Invalid Turnstile/)
    assert.throws(() => mountWebFrontend(express(), path.join(root, 'missing')), /ENOENT/)
  } finally {
    if (server.listening) {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    }
    rmSync(root, { recursive: true, force: true })
  }
})

test('full image disables Turnstile when no public site key is configured', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'hostid-web-empty-'))
  writeFileSync(path.join(root, 'index.html'), '<div id="root"></div>')
  const app = express()
  mountWebFrontend(app, root)
  const server = app.listen(0, '127.0.0.1')
  try {
    await once(server, 'listening')
    const address = server.address()
    assert.ok(address && typeof address !== 'string')
    const response = await fetch(`http://127.0.0.1:${address.port}/config.js`)
    assert.equal(await response.text(), 'window.__ENV__ = {"CF_TURNSTILE_SITE_KEY":""};\n')
  } finally {
    if (server.listening) {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    }
    rmSync(root, { recursive: true, force: true })
  }
})
