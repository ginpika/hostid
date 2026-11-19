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

test('formatDiagnosticMessage translates every backend diagnostic code in zh-CN and preserves English fallback', () => {
  const i18n = loadTsModule('../src/lib/mailDiagnosticsI18n.ts')
  const backendSource = readFileSync(new URL('../../backend/src/services/mail-diagnostics.ts', import.meta.url), 'utf8')

  const codes = [...new Set([...backendSource.matchAll(/code:\s*'([A-Z0-9_]+)'/g)].map(m => m[1]))]
  assert.ok(codes.length > 30, 'Expected backend diagnostic codes to be present')

  for (const code of codes) {
    const sample = {
      code,
      params: {
        domain: 'example.com',
        lookupDomain: '_dmarc.example.com',
        host: 'mail.example.com',
        ip: '93.184.216.34',
        localPort: 2525,
        port: 25,
        count: 2,
        primary: 'mail.example.com',
        lookups: 3,
        max: 10,
        policy: 'reject',
        latencyMs: 42
      },
      fallback: `Fallback for ${code}`
    }

    const zhText = i18n.formatDiagnosticMessage(sample, 'zh-CN')
    assert.notEqual(zhText, sample.fallback, `Missing zh-CN translation for diagnostic code ${code}`)
    assert.equal(i18n.formatDiagnosticMessage(sample, 'en-US'), sample.fallback)
  }

  assert.equal(
    i18n.formatDiagnosticMessage({ code: 'UNKNOWN_FUTURE_CODE', fallback: 'Future fallback' }, 'zh-CN'),
    'Future fallback'
  )
})

test('AdminSettingsPage registers the mail-check tab and translations include all new keys in zh-CN and en-US', () => {
  const adminSettingsSource = readFileSync(new URL('../src/pages/AdminSettingsPage.tsx', import.meta.url), 'utf8')
  assert.match(adminSettingsSource, /id:\s*'mail-check'/)
  assert.match(adminSettingsSource, /MailDiagnosticsPage/)

  const translationsApi = loadTsModule('../src/i18n/translations.ts')
  const zhKeys = Object.keys(translationsApi.translations['zh-CN'])
  const enKeys = new Set(Object.keys(translationsApi.translations['en-US']))

  for (const key of zhKeys) {
    assert.ok(enKeys.has(key), `Missing en-US translation key for "${key}"`)
  }
})
