import assert from 'node:assert/strict'
import fs from 'node:fs'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { PrismaClient } from '@prisma/client'
import { ensureDatabaseReady, ensureDatabaseUrl, getBackendRoot } from '../src/config/database'

async function withEnv(overrides: Record<string, string | undefined>, fn: () => Promise<void> | void) {
  const previous = new Map<string, string | undefined>()
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key])
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  try {
    await fn()
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

test('ensureDatabaseUrl defaults to dev.db/prod.db in data dir and preserves explicit DATABASE_URL', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hostid-db-url-'))
  try {
    await withEnv({ DATABASE_URL: undefined, HOSTID_DATA_DIR: dir, NODE_ENV: 'development' }, () => {
      const url = ensureDatabaseUrl()
      assert.equal(url, `file:${path.join(dir, 'dev.db')}`)
      assert.equal(process.env.DATABASE_URL, url)
    })

    await withEnv({ DATABASE_URL: '   ', HOSTID_DATA_DIR: dir, NODE_ENV: 'production' }, () => {
      const url = ensureDatabaseUrl()
      assert.equal(url, `file:${path.join(dir, 'prod.db')}`)
    })

    const nestedDb = path.join(dir, 'nested', 'custom.db')
    await withEnv({ DATABASE_URL: `file:${nestedDb}`, HOSTID_DATA_DIR: dir }, () => {
      const url = ensureDatabaseUrl()
      assert.equal(url, `file:${nestedDb}`)
      assert.equal(fs.existsSync(path.dirname(nestedDb)), true)
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('ensureDatabaseReady applies migrations once for fresh DB and skips up-to-date DB', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hostid-db-ready-'))
  try {
    await withEnv({ DATABASE_URL: undefined, HOSTID_DATA_DIR: dir, NODE_ENV: 'development' }, async () => {
      const firstRun = await ensureDatabaseReady()
      assert.equal(firstRun, true)
      assert.equal(fs.existsSync(path.join(dir, 'dev.db')), true)

      const secondRun = await ensureDatabaseReady()
      assert.equal(secondRun, false)

      const client = new PrismaClient()
      try {
        const count = await client.systemSetting.count()
        assert.equal(count, 0)
      } finally {
        await client.$disconnect()
      }
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('ensureDatabaseReady detects pending migrations and skips db-push schemas without _prisma_migrations', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hostid-db-mig-'))
  try {
    const fakeBackend = path.join(dir, 'backend')
    const migA = path.join(fakeBackend, 'prisma', 'migrations', '20260101000000_init')
    const migB = path.join(fakeBackend, 'prisma', 'migrations', '20260102000000_next')
    await mkdir(migA, { recursive: true })
    await writeFile(path.join(migA, 'migration.sql'), '-- init\n')

    const dbPath = path.join(dir, 'app.db')
    await withEnv({ DATABASE_URL: `file:${dbPath}`, HOSTID_DATA_DIR: dir }, async () => {
      // Simulate existing db with _prisma_migrations containing migA only
      const client = new PrismaClient()
      try {
        await client.$executeRawUnsafe(
          'CREATE TABLE _prisma_migrations (id TEXT PRIMARY KEY, migration_name TEXT NOT NULL, finished_at DATETIME, rolled_back_at DATETIME)'
        )
        await client.$executeRawUnsafe(
          "INSERT INTO _prisma_migrations (id, migration_name, finished_at) VALUES ('1', '20260101000000_init', CURRENT_TIMESTAMP)"
        )
      } finally {
        await client.$disconnect()
      }

      let migrateCalls = 0
      assert.equal(await ensureDatabaseReady({ backendRoot: fakeBackend, runMigrate: () => { migrateCalls += 1 } }), false)
      assert.equal(migrateCalls, 0)

      // Adding a new migration directory triggers migration
      await mkdir(migB, { recursive: true })
      await writeFile(path.join(migB, 'migration.sql'), '-- next\n')
      assert.equal(await ensureDatabaseReady({ backendRoot: fakeBackend, runMigrate: () => { migrateCalls += 1 } }), true)
      assert.equal(migrateCalls, 1)
    })

    // Simulate db-push schema (system_settings present, no _prisma_migrations)
    const pushedDbPath = path.join(dir, 'pushed.db')
    await withEnv({ DATABASE_URL: `file:${pushedDbPath}`, HOSTID_DATA_DIR: dir }, async () => {
      const client = new PrismaClient()
      try {
        await client.$executeRawUnsafe(
          'CREATE TABLE system_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, isSecret BOOLEAN NOT NULL DEFAULT 0, updatedAt DATETIME NOT NULL)'
        )
      } finally {
        await client.$disconnect()
      }

      let migrateCalls = 0
      assert.equal(
        await ensureDatabaseReady({ backendRoot: getBackendRoot(), runMigrate: () => { migrateCalls += 1 } }),
        false
      )
      assert.equal(migrateCalls, 0)
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
