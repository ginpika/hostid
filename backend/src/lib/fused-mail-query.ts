/** 融合收件箱列表筛选，复用默认收件箱的查询参数并增加 accountId */
import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import { AppError } from '../middleware/error'

const positiveInteger = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER)

const fusedListQuerySchema = z.object({
  folder: z.enum(['INBOX', 'TRASH', 'ARCHIVED', 'STARRED']).default('INBOX'),
  accountId: z.string().trim().min(1).max(64).optional(),
  q: z.string().trim().max(200).default(''),
  read: z.enum(['unread']).optional(),
  page: positiveInteger.default(1),
  limit: positiveInteger.default(20).transform(value => Math.min(value, 100))
})

export type FusedListQuery = z.infer<typeof fusedListQuerySchema>

export function parseFusedListQuery(query: Record<string, unknown>): FusedListQuery {
  const parsed = fusedListQuerySchema.safeParse(query)
  if (!parsed.success) throw new AppError('Invalid fused mail filters or pagination.', 400)
  return parsed.data
}

export function buildFusedListWhere(userId: string, query: FusedListQuery): Prisma.FusedEmailWhereInput {
  return {
    // 只能看到自己的账号下的邮件
    account: { userId },
    ...(query.accountId ? { accountId: query.accountId } : {}),
    ...(query.folder === 'STARRED' ? { isStarred: true, folder: { not: 'TRASH' } } : { folder: query.folder }),
    ...(query.read === 'unread' ? { isRead: false } : {}),
    ...(query.q ? {
      OR: [
        { subject: { contains: query.q } },
        { from: { contains: query.q } },
        { fromName: { contains: query.q } },
        { toList: { contains: query.q } },
        { summary: { contains: query.q } }
      ]
    } : {})
  }
}
