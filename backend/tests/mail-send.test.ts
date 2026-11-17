import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, readdir, realpath, rm } from 'node:fs/promises'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import express from 'express'
import jwt from 'jsonwebtoken'

test('sending mail: transactional fan-out, DTO hides server paths, client-supplied attachment paths are ignored, attachments are reference-counted', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'hostid-mail-send-')))
  const originalDirectory = process.cwd()
  const previous = { url: process.env.DATABASE_URL, secret: process.env.JWT_SECRET, domain: process.env.MAIL_DOMAIN }
  process.env.DATABASE_URL = `file:${join(directory, 'test.db')}?connection_limit=1`
  process.env.JWT_SECRET = 'mail-send-test-secret-at-least-32-characters'
  process.env.MAIL_DOMAIN = 'test.local'
  process.chdir(directory)
  await mkdir(join(directory, 'uploads'), { recursive: true })

  const { prisma } = await import('../src/lib/prisma')
  let server: ReturnType<ReturnType<typeof express>['listen']> | undefined
  try {
    await prisma.$executeRawUnsafe(`CREATE TABLE User (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, username TEXT NOT NULL UNIQUE, password TEXT NOT NULL,
      nickname TEXT, phone TEXT, birthday TEXT, avatar TEXT, language TEXT NOT NULL DEFAULT 'zh-CN',
      role TEXT NOT NULL DEFAULT 'user', githubId INTEGER UNIQUE, createdAt DATETIME NOT NULL, updatedAt DATETIME NOT NULL
    )`)
    await prisma.$executeRawUnsafe(`CREATE TABLE Email (
      id TEXT PRIMARY KEY, "from" TEXT NOT NULL, fromName TEXT, "to" TEXT NOT NULL,
      toList TEXT NOT NULL DEFAULT '[]', ccList TEXT DEFAULT '[]', bccList TEXT DEFAULT '[]', subject TEXT NOT NULL,
      body TEXT NOT NULL, summary TEXT, folder TEXT NOT NULL DEFAULT 'INBOX', isRead BOOLEAN NOT NULL DEFAULT 0,
      isStarred BOOLEAN NOT NULL DEFAULT 0, createdAt DATETIME NOT NULL, updatedAt DATETIME NOT NULL, userId TEXT NOT NULL
    )`)
    await prisma.$executeRawUnsafe(`CREATE TABLE Attachment (
      id TEXT PRIMARY KEY, filename TEXT NOT NULL, originalName TEXT NOT NULL,
      mimeType TEXT NOT NULL, size INTEGER NOT NULL, path TEXT NOT NULL, createdAt DATETIME NOT NULL
    )`)
    await prisma.$executeRawUnsafe(`CREATE TABLE EmailAttachment (
      id TEXT PRIMARY KEY, emailId TEXT NOT NULL, attachmentId TEXT NOT NULL,
      FOREIGN KEY (emailId) REFERENCES Email(id) ON DELETE CASCADE,
      FOREIGN KEY (attachmentId) REFERENCES Attachment(id) ON DELETE CASCADE
    )`)
    await prisma.$executeRawUnsafe('CREATE UNIQUE INDEX EmailAttachment_unique ON EmailAttachment(emailId, attachmentId)')
    await prisma.user.createMany({ data: ['alice', 'bob', 'carol'].map(name => ({
      id: name, username: name, email: `${name}@test.local`, password: 'x'
    })) })

    const { default: emailRoutes } = await import('../src/routes/email')
    const { default: attachmentRoutes } = await import('../src/routes/attachment')
    const { errorHandler } = await import('../src/middleware/error')
    const app = express()
    app.use(express.json())
    app.use('/api/emails', emailRoutes)
    app.use('/api/attachments', attachmentRoutes)
    app.use(errorHandler)
    server = app.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    const tokenFor = (userId: string) => jwt.sign({ userId }, process.env.JWT_SECRET!)
    const call = (userId: string, path: string, init: RequestInit = {}) =>
      fetch(`${base}${path}`, { ...init, headers: { Authorization: `Bearer ${tokenFor(userId)}`, ...(init.headers ?? {}) } })

    // --- 发送：站内收件人 + 密送 + 重复地址 + 一个上传附件 + 恶意的客户端 attachments JSON ---
    const form = new FormData()
    form.append('to', 'bob, bob@test.local')
    form.append('bcc', 'carol')
    form.append('subject', 'Hello')
    form.append('body', '<p>Hi there. Second sentence.</p>')
    form.append('files', new Blob(['hello attachment'], { type: 'text/plain' }), 'hello.txt')
    form.append('attachments', JSON.stringify([{
      filename: '../../../etc/passwd', originalName: 'passwd', mimeType: 'text/plain', size: 1, path: '/etc/passwd'
    }]))
    const sent = await call('alice', '/api/emails', { method: 'POST', body: form })
    assert.equal(sent.status, 201)
    const sentBody = await sent.json() as { id: string; folder: string; attachments: Record<string, unknown>[] }
    assert.equal(sentBody.folder, 'SENT')
    assert.equal(sentBody.attachments.length, 1, 'client-supplied attachments JSON must be ignored')
    assert.equal(sentBody.attachments[0].originalName, 'hello.txt')
    assert.equal('path' in sentBody.attachments[0], false, 'server filesystem path must not leak')

    assert.equal(await prisma.attachment.count(), 1)
    const stored = await prisma.attachment.findFirstOrThrow()
    assert.ok(stored.path.startsWith(join(directory, 'uploads')))
    assert.notEqual(stored.path, '/etc/passwd')

    // 一份发件箱副本 + bob 一份（地址重复只投递一次）+ carol 一份
    const copies = await prisma.email.findMany({ orderBy: { userId: 'asc' } })
    assert.deepEqual(copies.map(c => `${c.userId}:${c.folder}`), ['alice:SENT', 'bob:INBOX', 'carol:INBOX'])
    const bob = copies.find(c => c.userId === 'bob')!
    const carol = copies.find(c => c.userId === 'carol')!
    assert.equal(bob.bccList, '[]', 'non-bcc recipients must not see the bcc list')
    assert.equal(carol.bccList, '["carol@test.local"]')
    assert.equal(await prisma.emailAttachment.count(), 3)

    // 列表接口同样不泄露 path
    const list = await (await call('bob', '/api/emails?folder=INBOX')).json() as { emails: { attachments: Record<string, unknown>[] }[] }
    assert.equal(list.emails.length, 1)
    assert.equal('path' in list.emails[0].attachments[0], false)

    // --- 校验错误是 400，不是 500 ---
    const noRecipient = new FormData()
    noRecipient.append('subject', 'x')
    assert.equal((await call('alice', '/api/emails', { method: 'POST', body: noRecipient })).status, 400)
    const badRead = await call('bob', `/api/emails/${bob.id}/read`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isRead: 'maybe' })
    })
    assert.equal(badRead.status, 400)
    const badFolder = await call('bob', `/api/emails/${bob.id}/folder`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folder: 'STARRED' })
    })
    assert.equal(badFolder.status, 400)

    // --- 不允许的文件类型：400，且不留下孤儿文件 ---
    const before = (await readdir(join(directory, 'uploads'))).length
    const bad = new FormData()
    bad.append('to', 'bob')
    bad.append('files', new Blob(['MZ'], { type: 'application/x-msdownload' }), 'evil.exe')
    assert.equal((await call('alice', '/api/emails', { method: 'POST', body: bad })).status, 400)
    // 校验在落库前失败（例如没有收件人）时，已上传的文件也要被清理
    const orphan = new FormData()
    orphan.append('files', new Blob(['data'], { type: 'text/plain' }), 'orphan.txt')
    assert.equal((await call('alice', '/api/emails', { method: 'POST', body: orphan })).status, 400)
    assert.equal((await readdir(join(directory, 'uploads'))).length, before)

    // --- 附件引用计数：一个用户删除只解除自己的引用 ---
    const bobAttachment = await call('bob', `/api/attachments/${stored.id}`, { method: 'DELETE' })
    assert.equal(bobAttachment.status, 200)
    assert.equal(await prisma.attachment.count({ where: { id: stored.id } }), 1)
    await access(join(directory, 'uploads', stored.filename))
    assert.equal(await prisma.emailAttachment.count({ where: { email: { userId: 'bob' } } }), 0)
    assert.equal((await call('bob', `/api/attachments/${stored.id}`, { method: 'DELETE' })).status, 403)

    await call('carol', `/api/attachments/${stored.id}`, { method: 'DELETE' })
    assert.equal(await prisma.attachment.count({ where: { id: stored.id } }), 1)
    await call('alice', `/api/attachments/${stored.id}`, { method: 'DELETE' })
    assert.equal(await prisma.attachment.count({ where: { id: stored.id } }), 0)
    await assert.rejects(access(join(directory, 'uploads', stored.filename)))
  } finally {
    server?.close()
    await prisma.$disconnect()
    process.chdir(originalDirectory)
    for (const [key, value] of Object.entries({ DATABASE_URL: previous.url, JWT_SECRET: previous.secret, MAIL_DOMAIN: previous.domain })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value
    }
    await rm(directory, { recursive: true, force: true })
  }
})
