import assert from 'node:assert/strict'
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import express from 'express'
import jwt from 'jsonwebtoken'

test('soft deletion is retry-safe and only explicit trash deletion removes mail and orphaned attachments', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hostid-mail-delete-'))
  const originalDirectory = process.cwd()
  const previousUrl = process.env.DATABASE_URL
  const previousSecret = process.env.JWT_SECRET
  process.env.DATABASE_URL = `file:${join(directory, 'test.db')}`
  process.env.JWT_SECRET = 'mail-deletion-test-secret'
  // The upload middleware initializes a directory at import; isolate that too.
  process.chdir(directory)
  const { prisma } = await import('../src/lib/prisma')
  try {
    await prisma.$executeRawUnsafe(`CREATE TABLE Email (
      id TEXT PRIMARY KEY, "from" TEXT NOT NULL, fromName TEXT, "to" TEXT NOT NULL,
      toList TEXT NOT NULL DEFAULT '[]', ccList TEXT, bccList TEXT, subject TEXT NOT NULL,
      body TEXT NOT NULL, summary TEXT, folder TEXT NOT NULL, isRead BOOLEAN NOT NULL,
      isStarred BOOLEAN NOT NULL, createdAt DATETIME NOT NULL, updatedAt DATETIME NOT NULL,
      userId TEXT NOT NULL
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
    const base = {
      from: 'sender@example.com', to: 'reader@example.com', body: '<p>Test</p>', subject: 'Test',
      folder: 'INBOX', userId: 'reader', isRead: false, isStarred: false
    }
    await prisma.email.createMany({ data: [
      { ...base, id: 'delete-me' },
      { ...base, id: 'keep-me' },
      { ...base, id: 'someone-elses-mail', folder: 'TRASH', userId: 'someone-else' }
    ] })
    const unusedFile = join(directory, 'unused.txt')
    const sharedFile = join(directory, 'shared.txt')
    await writeFile(unusedFile, 'unused after delete')
    await writeFile(sharedFile, 'still in use')
    const attachmentBase = { filename: 'test.txt', originalName: 'test.txt', mimeType: 'text/plain', size: 12 }
    await prisma.attachment.createMany({ data: [
      { ...attachmentBase, id: 'unused', path: unusedFile },
      { ...attachmentBase, id: 'shared', path: sharedFile }
    ] })
    await prisma.emailAttachment.createMany({ data: [
      { id: 'link-1', emailId: 'delete-me', attachmentId: 'unused' },
      { id: 'link-2', emailId: 'delete-me', attachmentId: 'shared' },
      { id: 'link-3', emailId: 'keep-me', attachmentId: 'shared' }
    ] })

    const { default: mailRouter } = await import('../src/routes/email')
    const { errorHandler } = await import('../src/middleware/error')
    const app = express()
    app.use('/api/emails', mailRouter)
    app.use(errorHandler)
    const token = jwt.sign({ userId: 'reader' }, process.env.JWT_SECRET)
    const remove = (path: string) => {
      // Exercise the real Express auth/router/error chain without opening a port.
      const request = new IncomingMessage(new Socket())
      request.method = 'DELETE'
      request.url = `/api/emails/${path}`
      request.headers.authorization = `Bearer ${token}`
      const response = new ServerResponse(request)
      return new Promise<number>(resolve => {
        response.end = (() => {
          resolve(response.statusCode)
          return response
        }) as typeof response.end
        app(request, response)
      })
    }

    assert.equal(await remove('delete-me'), 200)
    assert.equal((await prisma.email.findUniqueOrThrow({ where: { id: 'delete-me' } })).folder, 'TRASH')
    // Simulate the user retrying after the first successful response was lost.
    assert.equal(await remove('delete-me'), 200)
    assert.equal(await prisma.email.count({ where: { id: 'delete-me' } }), 1)
    assert.equal(await prisma.attachment.count(), 2)
    await access(unusedFile)

    assert.equal(await remove('keep-me?permanent=true'), 409)
    assert.equal(await remove('someone-elses-mail?permanent=true'), 404)
    assert.equal(await remove('delete-me?permanent=typo'), 400)

    assert.equal(await remove('delete-me?permanent=true'), 200)
    assert.equal(await prisma.email.findUnique({ where: { id: 'delete-me' } }), null)
    assert.equal(await prisma.attachment.findUnique({ where: { id: 'unused' } }), null)
    await assert.rejects(access(unusedFile))
    assert.equal(await prisma.attachment.count({ where: { id: 'shared' } }), 1)
    assert.equal(await prisma.emailAttachment.count({ where: { emailId: 'keep-me', attachmentId: 'shared' } }), 1)
    await access(sharedFile)
  } finally {
    await prisma.$disconnect()
    process.chdir(originalDirectory)
    if (previousUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousUrl
    if (previousSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previousSecret
    await rm(directory, { recursive: true, force: true })
  }
})
