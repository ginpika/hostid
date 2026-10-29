import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import { AppError } from '../middleware/error'

const positiveInteger = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER)

const emailListQuerySchema = z.object({
  folder: z.enum(['INBOX', 'SENT', 'TRASH', 'ARCHIVED', 'STARRED']).default('INBOX'),
  q: z.string().trim().max(200).default(''),
  read: z.enum(['unread']).optional(),
  page: positiveInteger.default(1),
  limit: positiveInteger.default(20).transform(value => Math.min(value, 100))
})

export function parseEmailListQuery(query: Record<string, unknown>) {
  const parsed = emailListQuerySchema.safeParse(query)
  if (!parsed.success) {
    throw new AppError('Invalid email filters or pagination. Search is limited to 200 characters.', 400)
  }
  return parsed.data
}

export function buildEmailListWhere(
  userId: string,
  query: ReturnType<typeof parseEmailListQuery>
): Prisma.EmailWhereInput {
  return {
    userId,
    ...(query.folder === 'STARRED' ? { isStarred: true } : { folder: query.folder }),
    ...(query.read === 'unread' ? { isRead: false } : {}),
    ...(query.q ? {
      // SQLite's contains operator supports case-insensitive ASCII matching.
      // Keep the OR inside the user's folder scope so search cannot broaden access.
      OR: [
        { subject: { contains: query.q } },
        { from: { contains: query.q } },
        { fromName: { contains: query.q } },
        { to: { contains: query.q } },
        { toList: { contains: query.q } },
        { ccList: { contains: query.q } },
        { body: { contains: query.q } },
        { summary: { contains: query.q } }
      ]
    } : {})
  }
}

export function getEmailPagination(requestedPage: number, limit: number, total: number) {
  const totalPages = Math.ceil(total / limit)
  const page = Math.min(requestedPage, Math.max(1, totalPages))
  return { page, limit, total, totalPages }
}
