import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Prisma } from '@prisma/client'
import multer from 'multer'
import { z } from 'zod'
import type { Request, Response } from 'express'
import { AppError, errorHandler } from '../src/middleware/error'
import { toSafeStoredFilename } from '../src/config/paths'

function run(error: unknown) {
  const captured: { status?: number; body?: unknown } = {}
  const res = {
    status(code: number) { captured.status = code; return this },
    json(body: unknown) { captured.body = body; return this }
  } as unknown as Response
  const originalConsoleError = console.error
  console.error = () => {}
  try {
    errorHandler(error, {} as Request, res, () => {})
  } finally {
    console.error = originalConsoleError
  }
  return captured
}

test('errorHandler maps validation, upload and missing-record errors to 4xx instead of 500', () => {
  assert.deepEqual(run(new AppError('nope', 418)), { status: 418, body: { error: 'nope' } })

  const zodError = (() => { try { z.object({ name: z.string() }).parse({}) } catch (e) { return e } })()
  const zod = run(zodError)
  assert.equal(zod.status, 400)
  assert.equal(typeof (zod.body as { error: string }).error, 'string')

  assert.equal(run(new multer.MulterError('LIMIT_FILE_SIZE')).status, 413)
  assert.equal(run(new multer.MulterError('LIMIT_UNEXPECTED_FILE')).status, 400)

  const missing = new Prisma.PrismaClientKnownRequestError('not found', { code: 'P2025', clientVersion: 'test' })
  assert.deepEqual(run(missing), { status: 404, body: { error: 'Record not found' } })

  // 真正未知的错误仍然是 500，且不泄露内部信息
  assert.deepEqual(run(new Error('db password is hunter2')), { status: 500, body: { error: 'Internal server error' } })
})

test('toSafeStoredFilename strips directories and control characters from sender-controlled names', () => {
  assert.equal(toSafeStoredFilename('../../etc/passwd'), 'passwd')
  assert.equal(toSafeStoredFilename('..\\..\\windows\\system.ini'), 'system.ini')
  assert.equal(toSafeStoredFilename('report 2026.pdf'), 'report 2026.pdf')
  assert.equal(toSafeStoredFilename('合同.docx'), '合同.docx')
  assert.equal(toSafeStoredFilename('a\u0000b\nc.txt'), 'a_b_c.txt')
  assert.equal(toSafeStoredFilename(''), 'attachment')
  assert.equal(toSafeStoredFilename('..'), 'attachment')
  assert.equal(toSafeStoredFilename(undefined), 'attachment')
  assert.ok(toSafeStoredFilename('x'.repeat(500)).length <= 200)
})
