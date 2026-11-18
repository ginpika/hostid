/**
 * 管理员路由
 * 提供数据库表浏览、系统设置和用户权限管理
 * 仅限管理员用户访问（统一由 adminGuard 守卫）；业务规则在 services 中
 */
import { Router, Response } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { adminGuard, AuthRequest } from '../middleware/auth'
import { AppError, asyncHandler } from '../middleware/error'
import { getSettings, getSettingsView, updateSettings } from '../services/settings'
import { resetSiteIcon, saveSiteIcon, siteIconUpload } from '../services/siteIcon'
import { browseTable, deleteTableRow, listTableCounts } from '../services/admin-tables'
import { USER_SUMMARY_SELECT, changeUserRole } from '../services/user-governance'
import { getAvatarUrl } from '../utils/avatar'
import { ROLE_ADMIN, USER_ROLES } from '../lib/domain-constants'

const router = Router()

const MAX_PAGE_SIZE = 200

function toUserSummaryDto(user: {
  id: string
  email: string
  username: string
  nickname: string | null
  avatar: string | null
  role: string
  createdAt: Date
}) {
  return {
    ...user,
    avatarUrl: getAvatarUrl(user.avatar)
  }
}

const tableQuerySchema = z.object({
  page: z.coerce.number().int().min(1).catch(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).catch(20)
})

const updateUserRoleSchema = z.object({
  role: z.enum(USER_ROLES)
})

router.get('/tables', ...adminGuard, asyncHandler(async (_req: AuthRequest, res: Response) => {
  res.json({ tables: await listTableCounts() })
}))

router.get('/tables/:tableName', ...adminGuard, asyncHandler(async (req: AuthRequest, res: Response) => {
  const { page, pageSize } = tableQuerySchema.parse(req.query)
  res.json(await browseTable(req.params.tableName, page, pageSize))
}))

router.delete('/tables/:tableName/:id', ...adminGuard, asyncHandler(async (req: AuthRequest, res: Response) => {
  await deleteTableRow(req.params.tableName, req.params.id)
  res.json({ success: true })
}))

/**
 * 系统设置：读取（敏感值打码）
 */
router.get('/settings', ...adminGuard, asyncHandler(async (_req: AuthRequest, res: Response) => {
  res.set('Cache-Control', 'no-store')
  res.json({ settings: getSettingsView() })
}))

/**
 * 系统设置：更新。敏感值只写；空字符串/未提供表示保持不变，null 表示清空
 */
router.put('/settings', ...adminGuard, asyncHandler(async (req: AuthRequest, res: Response) => {
  const body = req.body?.settings ?? req.body
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new AppError('Invalid settings payload', 400)
  }
  try {
    await updateSettings(body)
  } catch (error) {
    throw new AppError(error instanceof Error ? error.message : 'Invalid settings', 400)
  }
  res.set('Cache-Control', 'no-store')
  res.json({ settings: getSettingsView() })
}))

/**
 * 站点图标：上传自定义图标或重置为默认图标
 */
router.post('/site-icon', ...adminGuard, siteIconUpload.single('icon'), asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.file) {
    throw new AppError('No icon file uploaded', 400)
  }
  const result = await saveSiteIcon(req.file.buffer)
  res.set('Cache-Control', 'no-store')
  res.json({ branding: result.branding, settings: result.settings })
}))

router.delete('/site-icon', ...adminGuard, asyncHandler(async (_req: AuthRequest, res: Response) => {
  const result = await resetSiteIcon()
  res.set('Cache-Control', 'no-store')
  res.json({ branding: result.branding, settings: result.settings })
}))

/**
 * 管理员登录服务：Passkey 开关读取与更新
 */
router.get('/passkey', ...adminGuard, asyncHandler(async (_req: AuthRequest, res: Response) => {
  res.set('Cache-Control', 'no-store')
  res.json({ enabled: getSettings().passkeyEnabled })
}))

router.put('/passkey', ...adminGuard, asyncHandler(async (req: AuthRequest, res: Response) => {
  const { enabled } = req.body ?? {}
  if (typeof enabled !== 'boolean') {
    throw new AppError('enabled must be a boolean', 400)
  }
  await updateSettings({ passkeyEnabled: enabled })
  res.set('Cache-Control', 'no-store')
  res.json({ enabled: getSettings().passkeyEnabled })
}))

/**
 * 管理员列表与用户权限调整（按指定用户 ID 提权为管理员 / 降级为普通用户）
 */
router.get('/admins', ...adminGuard, asyncHandler(async (_req: AuthRequest, res: Response) => {
  const admins = await prisma.user.findMany({
    where: { role: ROLE_ADMIN },
    orderBy: [{ createdAt: 'asc' }],
    select: USER_SUMMARY_SELECT
  })

  res.set('Cache-Control', 'no-store')
  res.json({
    admins: admins.map(toUserSummaryDto),
    total: admins.length
  })
}))

router.get('/users/:id', ...adminGuard, asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.params.id.trim()
  if (!userId) {
    throw new AppError('User ID is required', 400)
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: USER_SUMMARY_SELECT
  })
  if (!user) {
    throw new AppError('User not found', 404)
  }

  res.set('Cache-Control', 'no-store')
  res.json({ user: toUserSummaryDto(user) })
}))

router.patch('/users/:id/role', ...adminGuard, asyncHandler(async (req: AuthRequest, res: Response) => {
  const targetId = req.params.id.trim()
  if (!targetId) {
    throw new AppError('User ID is required', 400)
  }

  const parsed = updateUserRoleSchema.safeParse(req.body)
  if (!parsed.success) {
    throw new AppError('Role must be "admin" or "user"', 400)
  }

  const { user, changed } = await changeUserRole(req.userId, targetId, parsed.data.role)

  res.set('Cache-Control', 'no-store')
  res.json({ user: toUserSummaryDto(user), changed })
}))

export default router
