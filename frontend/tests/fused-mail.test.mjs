import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from '../node_modules/typescript/lib/typescript.js'

const source = readFileSync(new URL('../src/lib/fusedMail.ts', import.meta.url), 'utf8')
const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
const api = {}
new Function('exports', javascript)(api)

test('callback results are parsed and unknown values ignored', () => {
  assert.equal(api.parseFusedResult(''), null)
  assert.equal(api.parseFusedResult('?result=hacked'), null)
  assert.deepEqual(api.parseFusedResult('?result=added'), { kind: 'added' })
  assert.deepEqual(api.parseFusedResult('?result=error&reason=account_mismatch&expected=a%40x.com&got=b%40x.com'),
    { kind: 'error', reason: 'account_mismatch', expected: 'a@x.com', got: 'b@x.com' })
})

test('error descriptions fall back safely and mention mismatched accounts', () => {
  assert.match(api.describeFusedError({ kind: 'error', reason: 'nope' }, true), /授权/)
  assert.match(api.describeFusedError({ kind: 'error', reason: 'account_mismatch', expected: 'a@x.com', got: 'b@x.com' }, false), /expected a@x.com, got b@x.com/)
})

test('platform labels and status helpers', () => {
  assert.equal(api.platformLabel('gmail'), 'Gmail')
  assert.equal(api.platformLabel('outlook'), 'Outlook / Hotmail')
  assert.equal(api.needsReauth('reauth_required'), true)
  assert.equal(api.needsReauth('active'), false)
})

test('auto sync is claimed once per login session', () => {
  const data = new Map()
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) }
  assert.equal(api.claimAutoSync(storage, null), false)
  assert.equal(api.claimAutoSync(storage, 'token-a'), true)
  assert.equal(api.claimAutoSync(storage, 'token-a'), false)
  assert.equal(api.claimAutoSync(storage, 'token-b'), true)
})
