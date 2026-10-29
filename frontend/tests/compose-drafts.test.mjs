import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from '../node_modules/typescript/lib/typescript.js'

const source = readFileSync(new URL('../src/lib/composeDrafts.ts', import.meta.url), 'utf8')
const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText

function storage() {
  const entries = new Map()
  return {
    getItem: key => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
    removeItem: key => entries.delete(key)
  }
}

function fileDatabase({ pauseReads = false } = {}) {
  const entries = new Map()
  const reads = []
  let readCount = 0
  return {
    get readCount() { return readCount },
    releaseReads() { reads.splice(0).forEach(read => read()) },
    open() {
      const request = {}
      request.result = {
        objectStoreNames: { contains: () => true },
        transaction() {
          const transaction = {
            objectStore() {
              return {
                get(key) {
                  const result = {}
                  readCount++
                  const finish = () => { result.result = entries.get(key); result.onsuccess?.() }
                  if (pauseReads) reads.push(finish)
                  else queueMicrotask(finish)
                  return result
                },
                put(value, key) {
                  queueMicrotask(() => { entries.set(key, structuredClone(value)); transaction.oncomplete?.() })
                },
                delete(key) {
                  queueMicrotask(() => { entries.delete(key); transaction.oncomplete?.() })
                }
              }
            }
          }
          return transaction
        }
      }
      queueMicrotask(() => request.onsuccess?.())
      return request
    }
  }
}

function createStore(localStorage = storage(), indexedDB = fileDatabase()) {
  const exports = {}
  new Function('exports', 'localStorage', 'indexedDB', javascript)(exports, localStorage, indexedDB)
  return exports
}

const draft = (subject = 'An unfinished message') => ({ recipients: [{ id: 'a', username: 'friend', email: 'friend@example.com', type: 'to' }], subject, body: '<p>Still writing…</p>', referencedAttachments: [], attachmentNames: [] })
const reply = { id: 'mail-123', mode: 'reply', from: 'friend@example.com', date: '2026-10-29', subject: 'Hello' }

test('new mail, individual replies, forwarding, and accounts keep independent drafts', () => {
  const browserStorage = storage()
  const store = createStore(browserStorage)
  const sources = [store.composeDraftKey('alice'), store.composeDraftKey('alice', reply), store.composeDraftKey('alice', { ...reply, id: 'mail-456' }), store.composeDraftKey('alice', { ...reply, mode: 'forward' }), store.composeDraftKey('bob', reply)]
  assert.equal(new Set(sources).size, sources.length)
  sources.forEach((key, index) => store.saveComposeDraft(key, draft(`Draft ${index}`)))
  const reopened = createStore(browserStorage)
  sources.forEach((key, index) => assert.equal(reopened.readComposeDraft(key).subject, `Draft ${index}`))
})

test('discarding a reply leaves the new-message draft intact', () => {
  const browserStorage = storage()
  const store = createStore(browserStorage)
  const newKey = store.composeDraftKey('alice')
  const replyKey = store.composeDraftKey('alice', reply)
  store.saveComposeDraft(newKey, draft('New message'))
  store.saveComposeDraft(replyKey, draft('Reply'))
  store.discardComposeDraft(replyKey)
  assert.equal(store.readComposeDraft(replyKey), undefined)
  assert.equal(createStore(browserStorage).readComposeDraft(replyKey), undefined)
  assert.equal(store.readComposeDraft(newKey).subject, 'New message')
})

test('attachments survive closing and a fresh session, and discard wins over queued saves', async () => {
  const indexedDB = fileDatabase()
  const store = createStore(storage(), indexedDB)
  const key = store.composeDraftKey('alice', reply)
  const attachments = [{ id: 'attachment', file: new File(['unfinished'], 'notes.txt', { type: 'text/plain', lastModified: 17 }), uploading: false }]
  assert.equal(await store.saveComposeFiles(key, attachments), true)
  const restored = await createStore(storage(), indexedDB).readComposeFiles(key)
  assert.equal(restored[0].file instanceof File, true)
  assert.equal(restored[0].file.name, 'notes.txt')
  assert.equal(restored[0].file.type, 'text/plain')
  assert.equal(restored[0].file.lastModified, 17)
  assert.equal(await restored[0].file.text(), 'unfinished')
  const pendingSave = store.saveComposeFiles(key, attachments)
  store.discardComposeDraft(key)
  await pendingSave
  assert.deepEqual(await createStore(storage(), indexedDB).readComposeFiles(key), [])
})

test('unavailable storage preserves drafts for the current session and reports fallback', async () => {
  const unavailable = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('quota') }, removeItem() { throw new Error('blocked') } }
  const store = createStore(unavailable, { open() { throw new Error('blocked') } })
  const key = store.composeDraftKey('alice')
  const files = [{ id: 'a', file: new File(['notes'], 'notes.txt'), uploading: false }]
  assert.equal(store.saveComposeDraft(key, draft()), false)
  assert.equal(store.readComposeDraft(key).body, draft().body)
  assert.equal(await store.saveComposeFiles(key, files), false)
  assert.deepEqual(await store.readComposeFiles(key), files)
  store.discardComposeDraft(key)
  assert.equal(store.readComposeDraft(key), undefined)
})

test('a slow restore cannot overwrite a newer file selection or resurrect discarded files', async () => {
  const indexedDB = fileDatabase({ pauseReads: true })
  const key = 'slow-draft'
  const oldFiles = [{ id: 'old', file: new File(['old'], 'old.txt'), uploading: false }]
  const newFiles = [{ id: 'new', file: new File(['new'], 'new.txt'), uploading: false }]
  await createStore(storage(), indexedDB).saveComposeFiles(key, oldFiles)
  const store = createStore(storage(), indexedDB)
  const restoring = store.readComposeFiles(key)
  await new Promise(resolve => setImmediate(resolve))
  const saving = store.saveComposeFiles(key, newFiles)
  indexedDB.releaseReads()
  assert.equal((await restoring)[0].file.name, 'new.txt')
  await saving
  assert.equal((await store.readComposeFiles(key))[0].file.name, 'new.txt')

  const reopened = createStore(storage(), indexedDB)
  const restoringAgain = reopened.readComposeFiles(key)
  await new Promise(resolve => setImmediate(resolve))
  reopened.discardComposeDraft(key)
  indexedDB.releaseReads()
  assert.deepEqual(await restoringAgain, [])
  assert.deepEqual(await reopened.readComposeFiles(key), [])
})

test('StrictMode-style duplicate restores share one read and duplicate saves are idempotent', async () => {
  const indexedDB = fileDatabase({ pauseReads: true })
  const key = 'replayed-effects'
  const files = [{ id: 'a', file: new File(['same bytes'], 'same.txt'), uploading: false }]
  const store = createStore(storage(), indexedDB)
  const firstRestore = store.readComposeFiles(key)
  const secondRestore = store.readComposeFiles(key)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(indexedDB.readCount, 1)
  indexedDB.releaseReads()
  assert.deepEqual(await firstRestore, [])
  assert.deepEqual(await secondRestore, [])
  await Promise.all([store.saveComposeFiles(key, files), store.saveComposeFiles(key, files)])
  assert.equal((await store.readComposeFiles(key)).length, 1)
})

test('discarded text stays hidden for this session when storage denies removal', () => {
  const browserStorage = storage()
  const key = 'read-only-draft'
  browserStorage.setItem(key, JSON.stringify(draft()))
  browserStorage.removeItem = () => { throw new Error('Read-only storage') }
  const store = createStore(browserStorage)
  assert.equal(store.readComposeDraft(key).subject, draft().subject)
  store.discardComposeDraft(key)
  assert.equal(store.readComposeDraft(key), undefined)
  store.saveComposeDraft(key, draft('A new draft'))
  assert.equal(store.readComposeDraft(key).subject, 'A new draft')
})

test('a late send response cannot delete newer text or attachments in a reopened editor', async () => {
  const store = createStore()
  const key = store.composeDraftKey('alice')
  const sentDraft = draft('Sent version')
  const sentFiles = [{ id: 'original', file: new File(['original'], 'notes.txt'), uploading: false }]
  store.saveComposeDraft(key, sentDraft)
  await store.saveComposeFiles(key, sentFiles)
  store.saveComposeDraft(key, draft('Newer unsent work'))
  assert.equal(store.discardComposeDraft(key, sentDraft, sentFiles), false)
  assert.equal(store.readComposeDraft(key).subject, 'Newer unsent work')

  store.saveComposeDraft(key, sentDraft)
  const newerFiles = [{ id: 'replaced', file: new File(['newer'], 'notes.txt'), uploading: false }]
  await store.saveComposeFiles(key, newerFiles)
  assert.equal(store.discardComposeDraft(key, sentDraft, sentFiles), false)
  assert.equal((await store.readComposeFiles(key))[0].id, 'replaced')
  assert.equal(store.discardComposeDraft(key, sentDraft, newerFiles), true)
  assert.equal(store.readComposeDraft(key), undefined)
})

test('legacy drafts migrate only into a new-message draft and malformed drafts are ignored', () => {
  const browserStorage = storage()
  browserStorage.setItem('compose_email_draft', JSON.stringify(draft('Legacy draft')))
  const store = createStore(browserStorage)
  const key = store.composeDraftKey('alice')
  assert.equal(store.readComposeDraft(store.composeDraftKey('alice', reply)), undefined)
  assert.equal(store.readComposeDraft(key, true).subject, 'Legacy draft')
  assert.equal(browserStorage.getItem('compose_email_draft'), null)
  assert.equal(createStore(browserStorage).readComposeDraft(key).subject, 'Legacy draft')
  browserStorage.setItem('bad', '{broken json')
  assert.equal(store.readComposeDraft('bad'), undefined)
})
