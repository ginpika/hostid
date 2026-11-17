/**
 * 管理后台“数据库表浏览”注册表
 * 每张可浏览/可删除的表只在此声明一次：展示列同时用于 select 与响应的 columns，
 * 避免“列定义”和“实际查询”漂移，也不再需要在多个路由里重复 switch。
 */
import { prisma } from '../lib/prisma'
import { AppError } from '../middleware/error'

/** 各 Prisma delegate 的最小公共能力 */
interface TableDelegate {
  count(): Promise<number>
  findMany(args: {
    skip: number
    take: number
    orderBy: Record<string, 'asc' | 'desc'>
    select: Record<string, true>
  }): Promise<unknown[]>
  delete(args: { where: { id: string } }): Promise<unknown>
}

interface TableDefinition {
  /** 展示名称 */
  label: string
  delegate: TableDelegate
  /** 展示列（敏感列如密码哈希、clientSecret 不要出现在这里） */
  columns: readonly string[]
  orderBy: Record<string, 'asc' | 'desc'>
}

const asDelegate = (delegate: unknown) => delegate as TableDelegate

const TABLES: Record<string, TableDefinition> = {
  user: {
    label: 'User',
    delegate: asDelegate(prisma.user),
    columns: ['id', 'email', 'username', 'nickname', 'phone', 'birthday', 'avatar', 'role', 'language', 'githubId', 'createdAt', 'updatedAt'],
    orderBy: { createdAt: 'desc' }
  },
  email: {
    label: 'Email',
    delegate: asDelegate(prisma.email),
    columns: ['id', 'from', 'fromName', 'to', 'toList', 'ccList', 'bccList', 'subject', 'summary', 'folder', 'isRead', 'isStarred', 'createdAt', 'updatedAt', 'userId'],
    orderBy: { createdAt: 'desc' }
  },
  attachment: {
    label: 'Attachment',
    delegate: asDelegate(prisma.attachment),
    columns: ['id', 'filename', 'originalName', 'mimeType', 'size', 'path', 'createdAt'],
    orderBy: { createdAt: 'desc' }
  },
  emailattachment: {
    label: 'EmailAttachment',
    delegate: asDelegate(prisma.emailAttachment),
    columns: ['id', 'emailId', 'attachmentId'],
    orderBy: { emailId: 'asc' }
  },
  oauthprovider: {
    label: 'OAuthProvider',
    delegate: asDelegate(prisma.oAuthProvider),
    columns: ['id', 'provider', 'displayName', 'clientId', 'callbackUrl', 'isActive', 'createdAt', 'updatedAt'],
    orderBy: { createdAt: 'desc' }
  },
  passkey: {
    label: 'Passkey',
    delegate: asDelegate(prisma.passkey),
    columns: ['id', 'userId', 'name', 'credentialId', 'deviceType', 'backedUp', 'counter', 'lastUsedAt', 'createdAt'],
    orderBy: { createdAt: 'desc' }
  }
}

function getTable(tableName: string): TableDefinition {
  const table = TABLES[tableName.toLowerCase()]
  if (!table) throw new AppError('Unknown table', 400)
  return table
}

export async function listTableCounts() {
  return Promise.all(
    Object.values(TABLES).map(async table => ({ name: table.label, count: await table.delegate.count() }))
  )
}

export async function browseTable(tableName: string, page: number, pageSize: number) {
  const table = getTable(tableName)
  const select = Object.fromEntries(table.columns.map(column => [column, true as const]))

  const [total, data] = await Promise.all([
    table.delegate.count(),
    table.delegate.findMany({
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: table.orderBy,
      select
    })
  ])

  return {
    columns: table.columns,
    data,
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) }
  }
}

export async function deleteTableRow(tableName: string, id: string): Promise<void> {
  await getTable(tableName).delegate.delete({ where: { id } })
}
