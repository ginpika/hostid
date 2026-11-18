import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..', '..')
const DESKTOP_DIR = path.join(ROOT, 'desktop')
const UI_HTML = path.join(DESKTOP_DIR, 'ui', 'index.html')

function makeClassList(initial = []) {
  const set = new Set(initial)
  return {
    add(...names) { for (const n of names) if (n) set.add(n) },
    remove(...names) { for (const n of names) set.delete(n) },
    toggle(name, force) {
      if (force === undefined) {
        if (set.has(name)) { set.delete(name); return false }
        set.add(name); return true
      }
      if (force) set.add(name); else set.delete(name)
      return Boolean(force)
    },
    contains(name) { return set.has(name) },
  }
}

function makeEl(tag = 'div', id = '') {
  const attrs = new Map()
  const listeners = new Map()
  let text = ''
  const el = {
    tagName: tag.toUpperCase(),
    id,
    value: '',
    disabled: false,
    hidden: false,
    focused: false,
    title: '',
    type: '',
    src: '',
    href: '',
    dataset: {},
    style: {},
    className: '',
    children: [],
    parentNode: null,
    classList: makeClassList(),
    set textContent(v) {
      text = v === null || v === undefined ? '' : String(v)
      if (text === '') el.children = []
    },
    get textContent() {
      if (text) return text
      return el.children.map((c) => c.textContent).join('')
    },
    set innerHTML(v) {
      el._innerHTML = String(v)
      el.children = []
      text = ''
    },
    get innerHTML() {
      return el._innerHTML || ''
    },
    setAttribute(k, v) {
      attrs.set(k, String(v))
      if (k === 'class') el.className = String(v)
    },
    getAttribute(k) {
      return attrs.has(k) ? attrs.get(k) : null
    },
    appendChild(child) {
      child.parentNode = el
      el.children.push(child)
      return child
    },
    append(...nodes) {
      for (const n of nodes) {
        if (typeof n === 'string') text += n
        else el.appendChild(n)
      }
    },
    remove() {
      if (!el.parentNode) return
      el.parentNode.children = el.parentNode.children.filter((c) => c !== el)
      el.parentNode = null
    },
    contains(target) {
      if (!target) return false
      if (target === el) return true
      return el.children.some((c) => c.contains(target))
    },
    focus() { el.focused = true },
    click() { return el.dispatchEvent('click', { target: el }) },
    querySelector(sel) {
      if (sel === 'use') {
        if (!el._use) { el._use = makeEl('use'); el.appendChild(el._use) }
        return el._use
      }
      return null
    },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, [])
      listeners.get(type).push(fn)
    },
    dispatchEvent(type, extra = {}) {
      const event = {
        type,
        target: extra.target || el,
        preventDefault() {},
        stopPropagation() {},
        ...extra,
      }
      return Promise.all((listeners.get(type) || []).map((fn) => fn(event)))
    },
  }
  return el
}

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0))

function runLauncherSandbox({
  initialScheme = 'system',
  prefersDark = false,
  platform = 'MacIntel',
  invokeHandler,
} = {}) {
  const html = fs.readFileSync(UI_HTML, 'utf8')
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1])
  assert.ok(scripts.length >= 2)

  const elements = new Map()
  const ids = [
    'veil', 'lang-btn', 'lang-label', 'appearance-btn', 'appearance-icon',
    'win-min', 'win-max', 'win-max-icon', 'win-close',
    'brand-slogan', 'brand-desc', 'detail', 'main-title', 'main-sub',
    'resume-card', 'resume-label', 'resume-url', 'resume-btn',
    'connect-form', 'instance-url', 'connect-btn', 'quick-local', 'quick-local-label',
    'saved-section', 'saved-label', 'instance-list',
    'toasts',
  ]
  for (const id of ids) {
    const el = makeEl('div', id)
    if (['resume-card', 'saved-section'].includes(id)) {
      el.hidden = true
    }
    elements.set(id, el)
  }

  const storage = new Map()
  if (initialScheme) storage.set('hostid.shell.scheme', initialScheme)

  const documentMock = {
    title: 'HostID',
    documentElement: { lang: 'zh-CN', dataset: {}, style: {} },
    body: { dataset: { phase: 'idle' }, classList: makeClassList() },
    getElementById: (id) => elements.get(id) || null,
    createElement: (tag) => makeEl(tag),
    querySelectorAll: () => [],
    addEventListener() {},
  }

  const invokes = []
  const tauriListeners = new Map()
  const windowMock = {
    navigator: { platform, language: 'zh-CN' },
    document: documentMock,
    addEventListener() {},
    removeEventListener() {},
    localStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
    },
    matchMedia: () => ({ matches: prefersDark, addEventListener: () => {} }),
    requestAnimationFrame: (fn) => fn(),
    __TAURI__: {
      core: {
        invoke: async (cmd, args = {}) => {
          invokes.push({ cmd, args })
          return invokeHandler ? invokeHandler(cmd, args) : null
        },
      },
      event: {
        listen: async (name, cb) => {
          tauriListeners.set(name, cb)
          return () => tauriListeners.delete(name)
        },
      },
    },
  }

  const ctx = vm.createContext({ ...windowMock, window: null, console, setTimeout, clearTimeout })
  ctx.window = ctx
  for (const script of scripts) {
    new vm.Script(script).runInContext(ctx)
  }

  return { el: (id) => elements.get(id), doc: documentMock, storage, invokes }
}

test('HostID desktop launcher uses HostID palette, icons, and omits redundant account dock', () => {
  const html = fs.readFileSync(UI_HTML, 'utf8')
  for (const marker of [
    '--bg-canvas: #f4f6fa',
    '--accent-primary: #286cde',
    '--accent-primary: #00d98a',
    'logo-128x128.png',
    'id="connect-form"',
    'id="instance-list"',
    'id="rz"',
  ]) {
    assert.ok(html.includes(marker), `index.html missing ${marker}`)
  }

  assert.equal(html.includes('id="account-dock"'), false, 'launcher should not duplicate user management')
  assert.equal(html.includes('id="session-banner"'), false)
  assert.equal(html.includes('padding: 0 16px 0 92px'), false, 'macOS titlebar sits above WebView without shifting layout')

  const mainRs = fs.readFileSync(path.join(DESKTOP_DIR, 'src', 'main.rs'), 'utf8')
  assert.ok(mainRs.includes('TitleBarStyle::Transparent'))
  assert.equal(mainRs.includes('TitleBarStyle::Overlay'), false)

  const sprite = fs.readFileSync(path.join(DESKTOP_DIR, 'ui', 'lucide.svg'), 'utf8')
  for (const iconId of ['server', 'refresh', 'appearance-system', 'appearance-light', 'appearance-dark', 'minimize', 'maximize', 'restore', 'close']) {
    assert.ok(sprite.includes(`id="${iconId}"`), `lucide.svg missing ${iconId}`)
  }

  assert.equal(fs.existsSync(path.join(DESKTOP_DIR, 'ui', 'logo-128x128.png')), true)
  assert.equal(fs.existsSync(path.join(DESKTOP_DIR, 'icons', 'icon.icns')), true)
  assert.equal(fs.existsSync(path.join(DESKTOP_DIR, 'icons', 'icon.ico')), true)
})

test('HostID launcher connects, resumes, switches language/theme, and manages saved instances', async () => {
  const state = {
    lastUrl: 'https://mail.example.com',
    phase: 'idle',
    detail: '',
    instance: { url: 'https://mail.example.com/sent', baseUrl: 'https://mail.example.com' },
    instances: [
      {
        url: 'https://mail.example.com',
        siteName: 'Example Mail',
        siteSlogan: 'PRIVATE WORKSPACE',
        userName: 'Alice',
        userEmail: 'alice@example.com',
        userAvatar: '',
        lastConnectedAt: 1700000000,
      },
    ],
  }

  const sandbox = runLauncherSandbox({
    platform: 'MacIntel',
    invokeHandler: async (cmd) => {
      if (cmd === 'desktop_state') return state
      return state
    },
  })

  await flushMicrotasks()

  assert.equal(sandbox.el('resume-card').hidden, false)
  assert.equal(sandbox.el('saved-section').hidden, false)
  assert.equal(sandbox.el('instance-list').children.length, 1)

  // Resume active instance
  await sandbox.el('resume-btn').click()
  assert.ok(sandbox.invokes.some((c) => c.cmd === 'desktop_resume_instance'))

  // Connect via form
  sandbox.el('instance-url').value = 'id.example.org'
  await sandbox.el('connect-form').dispatchEvent('submit')
  assert.ok(sandbox.invokes.some((c) => c.cmd === 'desktop_connect' && c.args.url === 'id.example.org'))

  // Quick localhost chip
  await sandbox.el('quick-local').click()
  assert.ok(sandbox.invokes.some((c) => c.cmd === 'desktop_connect' && c.args.url === 'http://localhost:3000'))

  // Language toggle zh-CN -> en-US
  await sandbox.el('lang-btn').click()
  assert.equal(sandbox.el('lang-label').textContent, 'EN')
  assert.equal(sandbox.el('main-title').textContent, 'Connect to HostID')

  // Theme cycle system -> light -> dark
  await sandbox.el('appearance-btn').click()
  assert.equal(sandbox.doc.documentElement.dataset.schemeMode, 'light')
  assert.ok(sandbox.invokes.some((c) => c.cmd === 'plugin:window|set_theme' && c.args.value === 'light'))
  assert.ok(sandbox.invokes.some((c) => c.cmd === 'plugin:window|set_background_color' && c.args.value === '#f4f6fa'))
  await sandbox.el('appearance-btn').click()
  assert.equal(sandbox.doc.documentElement.dataset.schemeMode, 'dark')
  assert.ok(sandbox.invokes.some((c) => c.cmd === 'plugin:window|set_background_color' && c.args.value === '#0a0a0a'))
})

test('non-macOS launcher queries maximized state on startup', async () => {
  const sandbox = runLauncherSandbox({
    platform: 'Win32',
    invokeHandler: async (cmd) => {
      if (cmd === 'desktop_state') {
        return {
          lastUrl: 'https://mail.example.com',
          phase: 'idle',
          detail: '',
          instance: null,
          instances: [],
        }
      }
      return null
    },
  })

  await flushMicrotasks()

  assert.equal(sandbox.doc.body.classList.contains('is-mac'), false)
  assert.ok(sandbox.invokes.some((c) => c.cmd === 'plugin:window|is_maximized'))
})
