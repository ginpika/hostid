import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from '../node_modules/typescript/lib/typescript.js'

const source = readFileSync(new URL('../src/lib/siteBranding.ts', import.meta.url), 'utf8')
const javascript = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText

function loadModule() {
  const api = {}
  new Function('exports', javascript)(api)
  return api
}

test('resolveSiteBranding trims values, preserves intentional empty slogan, and validates siteIconUrl', () => {
  const api = loadModule()

  assert.deepEqual(api.resolveSiteBranding(), {
    siteName: 'HostID',
    siteSlogan: 'Ginpika`s Meil Service',
    siteIconUrl: ''
  })

  assert.deepEqual(api.resolveSiteBranding({
    siteName: '  Acme Mail  ',
    siteSlogan: '  TEAM INBOX  ',
    siteIconUrl: '  /api/auth/site-icon/site-icon-123.png  '
  }), {
    siteName: 'Acme Mail',
    siteSlogan: 'TEAM INBOX',
    siteIconUrl: '/api/auth/site-icon/site-icon-123.png'
  })

  assert.deepEqual(api.resolveSiteBranding({ siteName: 'Acme Mail', siteSlogan: '', siteIconUrl: '' }), {
    siteName: 'Acme Mail',
    siteSlogan: '',
    siteIconUrl: ''
  })

  assert.deepEqual(api.resolveSiteBranding({ siteName: '   ', siteSlogan: null, siteIconUrl: 'javascript:alert(1)' }), {
    siteName: 'HostID',
    siteSlogan: 'Ginpika`s Meil Service',
    siteIconUrl: ''
  })
})

test('readInitialSiteBranding reads runtime window.__ENV__ values accurately', () => {
  const api = loadModule()

  assert.deepEqual(api.readInitialSiteBranding(undefined), {
    siteName: 'HostID',
    siteSlogan: 'Ginpika`s Meil Service',
    siteIconUrl: ''
  })

  assert.deepEqual(api.readInitialSiteBranding({ CF_TURNSTILE_SITE_KEY: 'key' }), {
    siteName: 'HostID',
    siteSlogan: 'Ginpika`s Meil Service',
    siteIconUrl: ''
  })

  assert.deepEqual(api.readInitialSiteBranding({
    SITE_NAME: 'MyMail',
    SITE_SLOGAN: '',
    SITE_ICON_URL: '/api/auth/site-icon/site-icon-abc.png'
  }), {
    siteName: 'MyMail',
    siteSlogan: '',
    siteIconUrl: '/api/auth/site-icon/site-icon-abc.png'
  })
})

test('applyDocumentTitle updates document title with fallback and tolerates missing document', () => {
  const api = loadModule()
  const doc = { title: 'HostID' }

  api.applyDocumentTitle('  Custom Mail  ', doc)
  assert.equal(doc.title, 'Custom Mail')

  api.applyDocumentTitle('   ', doc)
  assert.equal(doc.title, 'HostID')

  assert.doesNotThrow(() => api.applyDocumentTitle('Custom Mail', undefined))
})

test('applyDocumentIcon switches between custom icon and default favicon and tolerates missing document', () => {
  const api = loadModule()

  const attrs = new Map([
    ['rel', 'icon'],
    ['type', 'image/png'],
    ['sizes', '64x64'],
    ['href', '/favicon-stylized.png']
  ])
  const link = {
    rel: 'icon',
    href: '/favicon-stylized.png',
    setAttribute(name, value) {
      attrs.set(name, value)
      if (name === 'href') this.href = value
    },
    removeAttribute(name) {
      attrs.delete(name)
    }
  }
  const existingDoc = {
    querySelector(selector) {
      return selector.includes('icon') ? link : null
    }
  }

  api.applyDocumentIcon('/api/auth/site-icon/site-icon-custom.svg', existingDoc)
  assert.equal(attrs.get('href'), '/api/auth/site-icon/site-icon-custom.svg')
  assert.equal(attrs.has('type'), false)
  assert.equal(attrs.has('sizes'), false)

  api.applyDocumentIcon('', existingDoc)
  assert.equal(attrs.get('href'), '/favicon-stylized.png')
  assert.equal(attrs.get('type'), 'image/png')
  assert.equal(attrs.get('sizes'), '64x64')

  const appended = []
  const emptyDoc = {
    head: { appendChild: node => appended.push(node) },
    querySelector: () => null,
    createElement: () => {
      const createdAttrs = new Map()
      return {
        rel: '',
        href: '',
        setAttribute(name, value) {
          createdAttrs.set(name, value)
          if (name === 'href') this.href = value
        },
        removeAttribute(name) {
          createdAttrs.delete(name)
        },
        _attrs: createdAttrs
      }
    }
  }

  api.applyDocumentIcon('/api/auth/site-icon/site-icon-new.png', emptyDoc)
  assert.equal(appended.length, 1)
  assert.equal(appended[0].rel, 'icon')
  assert.equal(appended[0].href, '/api/auth/site-icon/site-icon-new.png')

  assert.doesNotThrow(() => api.applyDocumentIcon('/api/auth/site-icon/site-icon-new.png', undefined))
})
