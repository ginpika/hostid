/**
 * 数据库零配置初始化与迁移检查
 * - 未设置 DATABASE_URL 时，自动回落到数据目录下的 dev.db（生产环境为 prod.db）
 * - 启动时检测 SQLite 迁移状态；若库未初始化或存在未应用的迁移，自动执行 prisma migrate deploy
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PrismaClient } from '@prisma/client'
import { resolveDataDir } from './secrets'

export function getBackendRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
}

export function resolveSqliteFilePath(url: string, backendRoot = getBackendRoot()): string | null {
  if (!url.startsWith('file:')) return null
  const rawPath = url.slice('file:'.length).split('?')[0]
  if (!rawPath || rawPath === ':memory:' || /[?&]mode=memory(?:&|$)/.test(url)) {
    return null
  }
  return path.isAbsolute(rawPath) ? rawPath : path.resolve(backendRoot, 'prisma', rawPath)
}

export function ensureDatabaseUrl(options: { backendRoot?: string } = {}): string {
  const backendRoot = options.backendRoot ?? getBackendRoot()
  const existing = process.env.DATABASE_URL?.trim()
  if (existing) {
    const sqlitePath = resolveSqliteFilePath(existing, backendRoot)
    if (sqlitePath) {
      fs.mkdirSync(path.dirname(sqlitePath), { recursive: true })
    }
    return existing
  }

  const dbFilename = process.env.NODE_ENV === 'production' ? 'prod.db' : 'dev.db'
  const dbPath = path.join(resolveDataDir(), dbFilename)
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })

  const url = `file:${dbPath}`
  process.env.DATABASE_URL = url
  console.log(`[DB] DATABASE_URL not set; using ${url}`)
  return url
}

function listLocalMigrations(backendRoot: string): string[] {
  const migrationsDir = path.join(backendRoot, 'prisma', 'migrations')
  if (!fs.existsSync(migrationsDir)) return []
  return fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && fs.existsSync(path.join(migrationsDir, entry.name, 'migration.sql')))
    .map(entry => entry.name)
    .sort()
}

function runPrismaMigrateDeploy(backendRoot: string): void {
  const prismaCli = path.join(backendRoot, 'node_modules', 'prisma', 'build', 'index.js')
  const env = { ...process.env, PRISMA_HIDE_UPDATE_MESSAGE: '1' }

  if (fs.existsSync(prismaCli)) {
    execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
      cwd: backendRoot,
      env,
      stdio: 'inherit'
    })
    return
  }

  const binName = process.platform === 'win32' ? 'prisma.cmd' : 'prisma'
  const localBin = path.join(backendRoot, 'node_modules', '.bin', binName)
  execFileSync(fs.existsSync(localBin) ? localBin : binName, ['migrate', 'deploy'], {
    cwd: backendRoot,
    env,
    stdio: 'inherit'
  })
}

async function hasPendingMigrations(localMigrations: string[]): Promise<boolean> {
  const client = new PrismaClient()
  try {
    const tables = await client.$queryRawUnsafe<Array<{ name: string }>>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('_prisma_migrations', 'system_settings')"
    )
    const hasMigrationsTable = tables.some(t => t.name === '_prisma_migrations')
    const hasSettingsTable = tables.some(t => t.name === 'system_settings')

    if (!hasMigrationsTable) {
      // 空库需要初始化迁移；若已存在通过 `prisma db push` 创建的表结构，则跳过以避免 P3005
      return !hasSettingsTable
    }

    const appliedRows = await client.$queryRawUnsafe<Array<{ migration_name: string }>>(
      'SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL'
    )
    const applied = new Set(appliedRows.map(row => row.migration_name))
    return localMigrations.some(name => !applied.has(name))
  } finally {
    await client.$disconnect()
  }
}

export async function ensureDatabaseReady(options: { backendRoot?: string; runMigrate?: () => void } = {}): Promise<boolean> {
  const backendRoot = options.backendRoot ?? getBackendRoot()
  const url = ensureDatabaseUrl({ backendRoot })
  const sqlitePath = resolveSqliteFilePath(url, backendRoot)
  if (!sqlitePath) return false

  const localMigrations = listLocalMigrations(backendRoot)
  if (localMigrations.length === 0) return false

  const executeMigrate = options.runMigrate ?? (() => runPrismaMigrateDeploy(backendRoot))

  if (!fs.existsSync(sqlitePath) || fs.statSync(sqlitePath).size === 0) {
    console.log('[DB] Initializing database migrations...')
    executeMigrate()
    return true
  }

  if (!(await hasPendingMigrations(localMigrations))) {
    return false
  }

  console.log('[DB] Applying pending database migrations...')
  executeMigrate()
  return true
}
