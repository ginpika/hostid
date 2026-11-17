/**
 * 用户权限治理
 * 管理员提权 / 降级的领域规则集中在此：
 * - 不能降级自己
 * - 不能降级系统中最后一位管理员
 * 在同一事务内完成检查与写入，避免并发降级把系统变成“零管理员”。
 */
import { prisma } from '../lib/prisma'
import { AppError } from '../middleware/error'
import { ROLE_ADMIN, type UserRole } from '../lib/domain-constants'

export const USER_SUMMARY_SELECT = {
  id: true,
  email: true,
  username: true,
  nickname: true,
  avatar: true,
  role: true,
  createdAt: true
} as const

export async function changeUserRole(actorId: string | undefined, targetId: string, role: UserRole) {
  return prisma.$transaction(async tx => {
    const target = await tx.user.findUnique({
      where: { id: targetId },
      select: USER_SUMMARY_SELECT
    })

    if (!target) {
      throw new AppError('User not found', 404)
    }

    if (role !== ROLE_ADMIN) {
      if (target.id === actorId) {
        throw new AppError('Cannot demote your own account', 400)
      }
      if (target.role === ROLE_ADMIN) {
        const adminCount = await tx.user.count({ where: { role: ROLE_ADMIN } })
        if (adminCount <= 1) {
          throw new AppError('Cannot demote the last remaining administrator', 400)
        }
      }
    }

    if (target.role === role) {
      return { user: target, changed: false }
    }

    const updated = await tx.user.update({
      where: { id: target.id },
      data: { role },
      select: USER_SUMMARY_SELECT
    })

    return { user: updated, changed: true }
  })
}
