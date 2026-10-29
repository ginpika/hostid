import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from '../node_modules/typescript/lib/typescript.js'

const source = readFileSync(new URL('../src/lib/modalStack.ts', import.meta.url), 'utf8')
const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText

function modalEnvironment() {
  const elements = []
  const document = { querySelectorAll: () => elements }
  const getComputedStyle = element => ({ zIndex: element.zIndex ?? 'auto', visibility: element.visibility ?? 'visible' })
  const exports = {}
  new Function('exports', 'document', 'getComputedStyle', 'Node', javascript)(exports, document, getComputedStyle, { DOCUMENT_POSITION_FOLLOWING: 4 })
  const modal = (zIndex, parentElement = null) => {
    const element = { zIndex, parentElement, visible: true, getClientRects() { return this.visible ? [{}] : [] }, compareDocumentPosition(other) { return elements.indexOf(other) > elements.indexOf(this) ? 4 : 2 } }
    elements.push(element)
    return element
  }
  return { ...exports, modal, elements }
}

test('a compose dialog above a reading dialog exclusively owns Escape and focus', () => {
  const env = modalEnvironment()
  const reader = env.modal('50')
  const compose = env.modal('50')
  assert.equal(env.isTopModal(reader), false)
  assert.equal(env.isTopModal(compose), true)
  compose.visible = false
  assert.equal(env.isTopModal(reader), true)
})

test('confirmation wins over later DOM siblings and nested z-index cannot escape its parent', () => {
  const env = modalEnvironment()
  const confirmation = env.modal('90')
  const readerOverlay = { zIndex: '50', parentElement: null }
  const nested = env.modal('9999', readerOverlay)
  assert.equal(env.isTopModal(confirmation), true)
  assert.equal(env.isTopModal(nested), false)
})

test('hidden dialogs cannot steal focus from the active dialog', () => {
  const env = modalEnvironment()
  const reader = env.modal('50')
  const hidden = env.modal('90')
  hidden.visibility = 'hidden'
  assert.equal(env.isTopModal(reader), true)
  assert.equal(env.isTopModal(hidden), false)
})

test('closing a lower dialog does not restore its trigger over an active compose dialog', () => {
  const env = modalEnvironment()
  const reader = env.modal('50')
  const compose = env.modal('50')
  let focused = 0
  const trigger = { isConnected: true, closest: () => reader, focus: () => focused++ }
  env.restoreModalFocus(trigger)
  assert.equal(focused, 0)
  compose.visible = false
  env.restoreModalFocus(trigger)
  assert.equal(focused, 1)
  reader.visible = false
  trigger.closest = () => null
  env.restoreModalFocus(trigger)
  assert.equal(focused, 2)
})
