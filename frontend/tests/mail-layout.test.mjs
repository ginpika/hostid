import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from '../node_modules/typescript/lib/typescript.js'

const source = readFileSync(new URL('../src/lib/mailLayout.ts', import.meta.url), 'utf8')
const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
const api = {}
new Function('exports', javascript)(api)

test('classic resizing reserves a usable reader after accounting for the pinned sidebar', () => {
  // A 1024px window with the 256px sidebar leaves a 768px workspace.
  assert.deepEqual(api.getMailListWidthBounds(768, true), { min: 300, max: 408 })
  assert.equal(api.clampMailListWidth(600, 768, true), 408)
  assert.equal(api.clampMailListWidth(240, 768, true), 300)
  assert.equal(api.clampMailListWidth(340, 768, true), 340)
})

test('resizing accounts for the workspace gutter and caps excessively large lists', () => {
  assert.deepEqual(api.getMailListWidthBounds(768, false), { min: 300, max: 392 })
  assert.equal(api.clampMailListWidth(900, 1600, true), 600)
  assert.equal(api.clampMailListWidth(320.4, 1000, true), 320)
})

test('very narrow workspaces keep ordered separator bounds', () => {
  for (const classic of [true, false]) {
    const bounds = api.getMailListWidthBounds(500, classic)
    assert.equal(bounds.min, bounds.max)
    assert.equal(api.clampMailListWidth(200, 500, classic), bounds.min)
  }
})
