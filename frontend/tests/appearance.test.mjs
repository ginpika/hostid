import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from '../node_modules/typescript/lib/typescript.js'

const source = readFileSync(new URL('../src/lib/appearance.ts', import.meta.url), 'utf8')
const javascript = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText

test('embedding hosts can read the initial appearance and receive later theme changes', () => {
  const events = []
  const window = { dispatchEvent: event => events.push(event) }
  const api = {}
  vm.runInNewContext(javascript, {
    exports: api, window,
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail } }
  })
  api.publishHostAppearance('#f4f6fa')
  assert.equal(window.__HOSTID_APPEARANCE__.version, 1)
  assert.equal(window.__HOSTID_APPEARANCE__.backgroundColor, '#f4f6fa')
  assert.ok(Object.isFrozen(window.__HOSTID_APPEARANCE__))
  assert.equal(events[0].type, 'hostid:appearance')
  assert.equal(events[0].detail, window.__HOSTID_APPEARANCE__)

  const initial = window.__HOSTID_APPEARANCE__
  api.publishHostAppearance('#10151e')
  assert.equal(window.__HOSTID_APPEARANCE__.backgroundColor, '#10151e')
  assert.equal(events[1].detail, window.__HOSTID_APPEARANCE__)
  assert.equal(initial.backgroundColor, '#f4f6fa')
})

test('appearance publishing also tolerates rendering without a browser', () => {
  const api = {}
  vm.runInNewContext(javascript, { exports: api })
  assert.doesNotThrow(() => api.publishHostAppearance('#f4f6fa'))
})
