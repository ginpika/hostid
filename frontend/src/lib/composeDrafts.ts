import type { Recipient } from '../components/RecipientInput'
import type { AttachmentFile } from '../components/AttachmentUpload'

export interface DraftReference {
  id: string
  originalName: string
  mimeType: string
  size: number
}

export interface ComposeDraft {
  recipients: Recipient[]
  subject: string
  body: string
  referencedAttachments: DraftReference[]
  attachmentNames: string[]
}

interface DraftSource {
  id?: string
  mode: string
  from: string
  date: string
  subject: string
}

const textCache = new Map<string, ComposeDraft>()
const fileCache = new Map<string, AttachmentFile[]>()
const discardedText = new Set<string>()
const fileVersions = new Map<string, number>()
const fileReads = new Map<string, Promise<AttachmentFile[]>>()
let database: Promise<IDBDatabase> | undefined
// Serialize file writes and deletes so closing, reopening, or discarding cannot
// allow an earlier asynchronous save to resurrect a discarded draft.
let fileOperations: Promise<unknown> = Promise.resolve()

export function composeDraftKey(account: string, source?: DraftSource | null): string {
  const identity = source
    ? JSON.stringify([source.mode, source.id || [source.from, source.date, source.subject]])
    : 'new'
  return `hostid:compose:${encodeURIComponent(account)}:${encodeURIComponent(identity)}`
}

export function readComposeDraft(key: string, migrateLegacy = false): ComposeDraft | undefined {
  if (discardedText.has(key)) return undefined
  const cached = textCache.get(key)
  if (cached) return cached
  try {
    const stored = localStorage.getItem(key) || (migrateLegacy ? localStorage.getItem('compose_email_draft') : null)
    if (!stored) return undefined
    const data = JSON.parse(stored)
    if (!data || typeof data.subject !== 'string' || typeof data.body !== 'string' || !Array.isArray(data.recipients)) return undefined
    const draft: ComposeDraft = {
      recipients: data.recipients.filter((recipient: Recipient) => recipient && typeof recipient.email === 'string' && ['to', 'cc', 'bcc'].includes(recipient.type)),
      subject: data.subject,
      body: data.body,
      referencedAttachments: Array.isArray(data.referencedAttachments) ? data.referencedAttachments : [],
      attachmentNames: Array.isArray(data.attachmentNames) ? data.attachmentNames : []
    }
    textCache.set(key, draft)
    if (migrateLegacy && !localStorage.getItem(key) && saveComposeDraft(key, draft)) {
      localStorage.removeItem('compose_email_draft')
    }
    return draft
  } catch {
    return undefined
  }
}

export function saveComposeDraft(key: string, draft: ComposeDraft): boolean {
  discardedText.delete(key)
  textCache.set(key, draft)
  try {
    localStorage.setItem(key, JSON.stringify(draft))
    return true
  } catch {
    return false
  }
}

function openDatabase(): Promise<IDBDatabase> {
  if (!database) {
    database = new Promise((resolve, reject) => {
      const request = indexedDB.open('hostid-compose-drafts', 1)
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('attachments')) request.result.createObjectStore('attachments')
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
      request.onblocked = () => reject(new Error('Draft storage is blocked'))
    })
    database.catch(() => { database = undefined })
  }
  return database
}

function queueFiles<T>(operation: () => Promise<T>): Promise<T> {
  const next = fileOperations.then(operation, operation)
  fileOperations = next.catch(() => undefined)
  return next
}

export async function readComposeFiles(key: string): Promise<AttachmentFile[]> {
  const cached = fileCache.get(key)
  if (cached) return cached
  const existingRead = fileReads.get(key)
  if (existingRead) return existingRead
  const version = fileVersions.get(key) || 0
  const pending = queueFiles(async () => {
    try {
      // A queued read may become obsolete before its transaction even starts.
      if (fileVersions.get(key) !== undefined && fileVersions.get(key) !== version) return fileCache.get(key) || []
      const db = await openDatabase()
      const attachments = await new Promise<AttachmentFile[]>((resolve, reject) => {
        const transaction = db.transaction('attachments', 'readonly')
        const request = transaction.objectStore('attachments').get(key)
        request.onsuccess = () => {
          const records = Array.isArray(request.result) ? request.result : []
          // Store metadata separately and reconstruct File explicitly: some
          // structured-clone implementations restore file contents as a Blob.
          const files = records.flatMap((record: AttachmentFile & { name?: string; type?: string; lastModified?: number }) => {
            if (!(record.file instanceof Blob)) return []
            const name = record.name || record.file.name
            if (!name) return []
            return [{ ...record, uploading: false, file: new File([record.file], name, { type: record.type || record.file.type, lastModified: record.lastModified ?? record.file.lastModified }) }]
          })
          resolve(files)
        }
        request.onerror = () => reject(request.error)
        transaction.onabort = () => reject(transaction.error)
      })
      if ((fileVersions.get(key) || 0) !== version) return fileCache.get(key) || []
      fileCache.set(key, attachments)
      return attachments
    } catch {
      return fileCache.get(key) || []
    }
  })
  fileReads.set(key, pending)
  try { return await pending } finally { if (fileReads.get(key) === pending) fileReads.delete(key) }
}

export function saveComposeFiles(key: string, attachments: AttachmentFile[]): Promise<boolean> {
  fileVersions.set(key, (fileVersions.get(key) || 0) + 1)
  fileCache.set(key, attachments)
  return queueFiles(async () => {
    try {
      const db = await openDatabase()
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction('attachments', 'readwrite')
        const store = transaction.objectStore('attachments')
        if (attachments.length) store.put(attachments.map(attachment => ({ ...attachment, name: attachment.file.name, type: attachment.file.type, lastModified: attachment.file.lastModified })), key)
        else store.delete(key)
        transaction.oncomplete = () => resolve()
        transaction.onerror = () => reject(transaction.error)
        transaction.onabort = () => reject(transaction.error)
      })
      return true
    } catch {
      return attachments.length === 0
    }
  })
}

export function discardComposeDraft(key: string, expectedDraft?: ComposeDraft, expectedFiles?: AttachmentFile[]): boolean {
  // A send can complete after its editor unmounts (for example on logout).
  // Do not let that old response erase newer work in a reopened editor.
  if (expectedDraft && JSON.stringify(readComposeDraft(key)) !== JSON.stringify(expectedDraft)) return false
  if (expectedFiles && JSON.stringify((fileCache.get(key) || []).map(file => file.id)) !== JSON.stringify(expectedFiles.map(file => file.id))) return false
  discardedText.add(key)
  textCache.delete(key)
  fileCache.delete(key)
  try { localStorage.removeItem(key) } catch { /* The session cache is still cleared. */ }
  void saveComposeFiles(key, [])
  return true
}
