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

test('resolveSiteBranding trims values, preserves intentional empty slogan, and falls back for empty siteName', () => {
  const api = loadModule()

  assert.deepEqual(api.resolveSiteBranding(), {
    siteName: 'HostID',
    siteSlogan: 'MAIL WORKSPACE'
  })

  assert.deepEqual(api.resolveSiteBranding({ siteName: '  Acme Mail  ', siteSlogan: '  TEAM INBOX  ' }), {
    siteName: 'Acme Mail',
    siteSlogan: 'TEAM INBOX'
  })

  assert.deepEqual(api.resolveSiteBranding({ siteName: 'Acme Mail', siteSlogan: '' }), {
    siteName: 'Acme Mail',
    siteSlogan: ''
  })

  assert.deepEqual(api.resolveSiteBranding({ siteName: '   ', siteSlogan: null }), {
    siteName: 'HostID',
    siteSlogan: 'MAIL WORKSPACE'
  })
})

test('readInitialSiteBranding reads runtime window.__ENV__ values accurately', () => {
  const api = loadModule()

  assert.deepEqual(api.readInitialSiteBranding(undefined), {
    siteName: 'HostID',
    siteSlogan: 'MAIL WORKSPACE'
  })

  assert.deepEqual(api.readInitialSiteBranding({ CF_TURNSTILE_SITE_KEY: 'key' }), {
    siteName: 'HostID',
    siteSlogan: 'MAIL WORKSPACE'
  })

  assert.deepEqual(api.readInitialSiteBranding({ SITE_NAME: 'MyMail', SITE_SLOGAN: '' }), {
    siteName: 'MyMail',
    siteSlogan: ''
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
