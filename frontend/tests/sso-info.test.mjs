import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from '../node_modules/typescript/lib/typescript.js'

function loadTsModule(relPath) {
  const source = readFileSync(new URL(relPath, import.meta.url), 'utf8')
  const javascript = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  }).outputText
  const exports = {}
  new Function('exports', javascript)(exports)
  return exports
}

function encodeBase64Url(value) {
  return Buffer.from(JSON.stringify(value), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

test('parseSsoCookieAndToken returns nulls when sso_token is absent', () => {
  const api = loadTsModule('../src/lib/ssoInfo.ts')
  assert.deepEqual(api.parseSsoCookieAndToken('', { hostname: 'mail.example.com', protocol: 'https:' }), {
    cookieInfo: null,
    decodedToken: null
  })
  assert.deepEqual(api.parseSsoCookieAndToken('other=abc; theme=light', { hostname: 'localhost', protocol: 'http:' }), {
    cookieInfo: null,
    decodedToken: null
  })
})

test('parseSsoCookieAndToken decodes base64url JWT payloads and preserves cookie metadata', () => {
  const api = loadTsModule('../src/lib/ssoInfo.ts')
  const header = encodeBase64Url({ alg: 'HS256', typ: 'JWT' })
  // Include characters that produce '-' and '_' in base64url encoding.
  const payload = encodeBase64Url({
    sessionId: 'sess_~?_1234567890abcdef',
    iat: 1700000000,
    exp: 1700604800
  })
  const token = `${header}.${payload}.signature_part_with_extra_length_for_truncation`

  const result = api.parseSsoCookieAndToken(`foo=bar=baz; sso_token=${token}`, {
    hostname: 'sso.example.com',
    protocol: 'https:'
  })

  assert.ok(result.cookieInfo)
  assert.equal(result.cookieInfo.name, 'sso_token')
  assert.equal(result.cookieInfo.domain, 'sso.example.com')
  assert.equal(result.cookieInfo.secure, true)
  assert.equal(result.cookieInfo.httpOnly, true)
  assert.match(result.cookieInfo.value, /^.{20}\.\.\..{10}$/)

  assert.deepEqual(result.decodedToken, {
    sessionId: 'sess_~?_1234567890abcdef',
    iat: 1700000000,
    exp: 1700604800
  })
})

test('parseSsoCookieAndToken tolerates short or malformed tokens without throwing', () => {
  const api = loadTsModule('../src/lib/ssoInfo.ts')
  const result = api.parseSsoCookieAndToken('sso_token=short-opaque-token', {
    hostname: 'localhost',
    protocol: 'http:'
  })

  assert.equal(result.cookieInfo?.value, 'short-opaque-token')
  assert.equal(result.cookieInfo?.secure, false)
  assert.equal(result.decodedToken, null)
})

test('resolveSsoAvatarUrl and formatRemainingHours handle edge cases cleanly', () => {
  const api = loadTsModule('../src/lib/ssoInfo.ts')

  assert.equal(api.resolveSsoAvatarUrl(null), null)
  assert.equal(api.resolveSsoAvatarUrl({ avatar: 'pic.png', avatarUrl: 'https://cdn.example.com/a.png' }), 'https://cdn.example.com/a.png')
  assert.equal(api.resolveSsoAvatarUrl({ avatar: 'https://avatars.example.com/1.png' }), 'https://avatars.example.com/1.png')
  assert.equal(api.resolveSsoAvatarUrl({ avatar: 'avatar-1.webp' }), '/api/auth/avatar/avatar-1.webp')

  assert.equal(api.formatRemainingHours(1000, 1000 * 1000 + 3600 * 1000), 0)
  assert.equal(api.formatRemainingHours(1000 + 5 * 3600, 1000 * 1000), 5)
})

test('SSOInfoPage and sso-info.css implement responsive portrait and landscape personal center layouts', () => {
  const pageSource = readFileSync(new URL('../src/pages/SSOInfoPage.tsx', import.meta.url), 'utf8')
  const cssSource = readFileSync(new URL('../src/styles/sso-info.css', import.meta.url), 'utf8')

  assert.match(pageSource, /import '\.\.\/styles\/sso-info\.css'/)
  assert.match(pageSource, /shellClassName="sso-auth-shell"/)
  assert.match(pageSource, /<AuthPage[\s\S]*split[\s\S]*aside=/)

  assert.match(cssSource, /@media \(min-width: 1100px\),\s*\(min-width: 768px\) and \(orientation: landscape\) and \(min-height: 480px\)/)
  assert.match(cssSource, /\.sso-auth-card\.auth-card--split/)
  assert.match(cssSource, /\.sso-kv-grid\s*\{\s*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/)
  assert.match(cssSource, /\.sso-mobile-header,\s*\.sso-mobile-identity,\s*\.sso-mobile-actions\s*\{\s*display:\s*none;/)
  assert.match(cssSource, /\.design-classic \.sso-panel-card/)
})
