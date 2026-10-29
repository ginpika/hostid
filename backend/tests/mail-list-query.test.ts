import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { PrismaClient } from '@prisma/client'
import {
  buildEmailListWhere,
  getEmailPagination,
  parseEmailListQuery
} from '../src/lib/mail-list-query'

test('query defaults, whitespace, numeric bounds and malformed input', () => {
  assert.deepEqual(parseEmailListQuery({}), { folder: 'INBOX', q: '', page: 1, limit: 20 })
  assert.equal(parseEmailListQuery({ q: '  发布计划  ', limit: '1000' }).q, '发布计划')
  assert.equal(parseEmailListQuery({ limit: '1000' }).limit, 100)
  for (const query of [
    { page: '-1' }, { page: '1.5' }, { page: '1x' }, { limit: '0' },
    { folder: ['INBOX', 'TRASH'] }, { q: 'x'.repeat(201) }, { q: ['a', 'b'] }
  ]) {
    assert.throws(() => parseEmailListQuery(query), { statusCode: 400 })
  }
})

test('pagination clamps removed pages and preserves the empty result contract', () => {
  assert.deepEqual(getEmailPagination(9, 20, 21), { page: 2, limit: 20, total: 21, totalPages: 2 })
  assert.deepEqual(getEmailPagination(9, 20, 0), { page: 1, limit: 20, total: 0, totalPages: 0 })
})

test('search and unread filtering apply before pagination and retain user/folder boundaries', async () => {
  // Never load DATABASE_URL or touch the application's actual mail database.
  const directory = await mkdtemp(join(tmpdir(), 'hostid-mail-query-'))
  const database = new PrismaClient({ datasources: { db: { url: `file:${join(directory, 'test.db')}` } } })
  try {
    await database.$executeRawUnsafe(`CREATE TABLE Email (
      id TEXT PRIMARY KEY, "from" TEXT NOT NULL, fromName TEXT, "to" TEXT NOT NULL,
      toList TEXT NOT NULL DEFAULT '[]', ccList TEXT, bccList TEXT, subject TEXT NOT NULL,
      body TEXT NOT NULL, summary TEXT, folder TEXT NOT NULL, isRead BOOLEAN NOT NULL,
      isStarred BOOLEAN NOT NULL, createdAt DATETIME NOT NULL, updatedAt DATETIME NOT NULL,
      userId TEXT NOT NULL
    )`)
    const base = {
      from: 'sender@example.com', to: 'reader@example.com', body: '<p>发布计划</p>',
      folder: 'INBOX', userId: 'reader', isRead: false, isStarred: false
    }
    await database.email.createMany({ data: [
      { ...base, id: '1', subject: 'Release one' },
      { ...base, id: '2', subject: 'Release two' },
      { ...base, id: '3', subject: 'Release three', isRead: true },
      { ...base, id: '4', subject: 'Release other user', userId: 'someone-else', isStarred: true },
      { ...base, id: '5', subject: 'Release archived', folder: 'ARCHIVED', isStarred: true },
      { ...base, id: '6', subject: 'Different subject', body: '<p>Other content</p>' }
    ] })

    const query = parseEmailListQuery({ q: '  RELEASE ', read: 'unread', limit: '1', page: '2' })
    const where = buildEmailListWhere('reader', query)
    const total = await database.email.count({ where })
    const pagination = getEmailPagination(query.page, query.limit, total)
    const page = await database.email.findMany({
      where, orderBy: { id: 'asc' }, skip: (pagination.page - 1) * pagination.limit, take: pagination.limit
    })
    assert.equal(total, 2)
    assert.deepEqual(page.map(email => email.id), ['2'])

    const chinese = await database.email.findMany({
      where: buildEmailListWhere('reader', parseEmailListQuery({ q: '发布计划' }))
    })
    assert.deepEqual(chinese.map(email => email.id).sort(), ['1', '2', '3'])

    const starred = await database.email.findMany({
      where: buildEmailListWhere('reader', parseEmailListQuery({ folder: 'STARRED', q: 'Release' }))
    })
    assert.deepEqual(starred.map(email => email.id), ['5'])
  } finally {
    await database.$disconnect()
    await rm(directory, { recursive: true, force: true })
  }
})
