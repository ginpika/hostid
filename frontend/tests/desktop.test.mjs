import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from '../node_modules/typescript/lib/typescript.js'

const source = readFileSync(new URL('../src/lib/desktop.ts', import.meta.url), 'utf8')
const javascript = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText

test('desktop bridge degrades cleanly in web browsers', async () => {
  const api = {}
  const window = { location: { href: 'https://mail.example.com/' } }
  vm.runInNewContext(javascript, { exports: api, window, navigator: { platform: 'MacIntel' } })

  assert.equal(api.isDesktopShell(), false)
  assert.equal(api.isMacDesktop(), false)
  assert.equal(await api.toggleMaximizeWindow(), false)
  assert.equal(await api.isWindowMaximized(), false)
  assert.equal(await api.isWindowFullscreen(), false)
  assert.doesNotThrow(() => api.minimizeWindow())
  assert.doesNotThrow(() => api.setWindowTheme('dark'))
  api.openDesktopHome()
  assert.equal(window.location.href, 'https://mail.example.com/')
})

test('desktop bridge dispatches Tauri window commands and sentinel navigation when active', async () => {
  const invokes = []
  const window = {
    __TAURI_INTERNALS__: {},
    __TAURI__: {
      core: {
        invoke: async (cmd, args) => {
          invokes.push({ cmd, args })
          if (cmd === 'plugin:window|is_maximized') return true
          if (cmd === 'plugin:window|is_fullscreen') return false
          return null
        }
      }
    },
    location: { href: 'https://mail.example.com/' }
  }
  const api = {}
  vm.runInNewContext(javascript, { exports: api, window, navigator: { platform: 'MacIntel' } })

  assert.equal(api.isDesktopShell(), true)
  assert.equal(api.isMacDesktop(), true)

  api.setWindowTheme('dark')
  api.setWindowBackgroundColor('#0a0a0a')
  api.minimizeWindow()
  assert.equal(await api.toggleMaximizeWindow(), true)
  assert.equal(await api.isWindowFullscreen(), false)
  assert.ok(invokes.some(c => c.cmd === 'plugin:window|set_theme' && c.args.value === 'dark'))
  assert.ok(invokes.some(c => c.cmd === 'plugin:window|set_background_color' && c.args.value === '#0a0a0a'))
  assert.ok(invokes.some(c => c.cmd === 'plugin:window|minimize'))
  assert.ok(invokes.some(c => c.cmd === 'plugin:window|toggle_maximize'))

  api.openDesktopHome()
  assert.equal(window.location.href, '/__hostid_desktop_home')

  api.backToLauncher()
  assert.equal(window.location.href, '/__hostid_desktop_logout')
})

test('passkey bridge helpers validate callbacks, encode UTF-8 payloads, and invoke desktop ceremony', async () => {
  const invokes = []
  let cancelledOnce = false
  const window = {
    __TAURI_INTERNALS__: {},
    __TAURI__: {
      core: {
        invoke: async (cmd, args) => {
          invokes.push({ cmd, args })
          if (cmd === 'desktop_passkey_ceremony') {
            if (!cancelledOnce) {
              cancelledOnce = true
              return JSON.stringify({ id: 'cred-1', type: 'public-key' })
            }
            throw new Error('PASSKEY_CANCELLED')
          }
          return null
        }
      }
    },
    location: { origin: 'https://id.example.com', href: 'https://id.example.com/login' }
  }
  const api = {}
  vm.runInNewContext(javascript, {
    exports: api,
    window,
    navigator: { platform: 'MacIntel' },
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    btoa,
    atob,
    DOMException,
    crypto: globalThis.crypto
  })

  const sample = { rpId: 'id.example.com', user: { displayName: '张三 / HostID' } }
  const encoded = api.encodeBase64UrlJson(sample)
  assert.deepEqual(JSON.parse(JSON.stringify(api.decodeBase64UrlJson(encoded))), sample)

  assert.equal(api.isAllowedPasskeyBridgeCallback('hostid-desktop://passkey'), true)
  assert.equal(api.isAllowedPasskeyBridgeCallback('http://127.0.0.1:43210/passkey-callback'), true)
  assert.equal(api.isAllowedPasskeyBridgeCallback('https://evil.example.com/passkey'), false)
  assert.equal(api.isAllowedPasskeyBridgeCallback('http://127.0.0.1/passkey-callback'), false)
  assert.equal(api.isAllowedPasskeyBridgeCallback('javascript:alert(1)'), false)

  const bridgeUrl = api.buildPasskeyBridgeUrl('https://id.example.com/', {
    kind: 'login',
    state: 'state-1',
    options: { challenge: 'abc' }
  })
  assert.ok(bridgeUrl.startsWith('https://id.example.com/passkey-bridge#'))

  const callbackUrl = api.buildPasskeyBridgeCallbackUrl('hostid-desktop://passkey', {
    state: 'state-1',
    payload: { id: 'cred-1' }
  })
  const parsedCallback = new URL(callbackUrl)
  assert.equal(parsedCallback.protocol, 'hostid-desktop:')
  assert.equal(parsedCallback.searchParams.get('state'), 'state-1')
  assert.deepEqual(
    JSON.parse(JSON.stringify(api.decodeBase64UrlJson(parsedCallback.searchParams.get('payload')))),
    { id: 'cred-1' }
  )

  const ceremonyResult = await api.runDesktopPasskeyCeremony({
    kind: 'login',
    options: { challenge: 'xyz' }
  })
  assert.deepEqual(JSON.parse(JSON.stringify(ceremonyResult)), { id: 'cred-1', type: 'public-key' })
  assert.equal(invokes[0].cmd, 'desktop_passkey_ceremony')
  assert.ok(invokes[0].args.url.startsWith('https://id.example.com/passkey-bridge#'))
  assert.ok(typeof invokes[0].args.expectedState === 'string' && invokes[0].args.expectedState.length > 0)

  await assert.rejects(
    () => api.runDesktopPasskeyCeremony({ kind: 'register', options: { challenge: 'xyz' } }),
    err => err instanceof DOMException && err.name === 'AbortError'
  )
})
