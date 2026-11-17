/**
 * 首次运行初始化向导
 * 仅在系统中没有任何用户时允许创建第一个管理员，并写入站点地址和邮件域名
 */
import { Router, Request, Response } from 'express'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { AppError, asyncHandler } from '../middleware/error'
import { updateSettings, getSettings } from '../services/settings'
import { ROLE_ADMIN } from '../lib/domain-constants'

const router = Router()

const MIN_PASSWORD_LENGTH = 12
const MAX_PASSWORD_LENGTH = 256

const setupSchema = z.object({
  username: z.string().regex(/^[a-zA-Z0-9._]{3,32}$/, 'Username must be 3-32 characters: letters, digits, dot or underscore'),
  password: z.string()
    .min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
    .max(MAX_PASSWORD_LENGTH, `Password must be at most ${MAX_PASSWORD_LENGTH} characters`),
  mailDomain: z.string().trim().min(1, 'Mail domain is required'),
  siteUrl: z.string().optional()
})

/** 进程内互斥，配合事务内的用户数检查，防止并发初始化 */
let setupInFlight = false

async function needsSetup(): Promise<boolean> {
  return (await prisma.user.count()) === 0
}

router.get('/status', asyncHandler(async (_req: Request, res: Response) => {
  res.set('Cache-Control', 'no-store')
  res.json({ needsSetup: await needsSetup() })
}))

router.post('/', asyncHandler(async (req: Request, res: Response) => {
  const { username, password, siteUrl, mailDomain } = setupSchema.parse(req.body ?? {})

  if (setupInFlight) throw new AppError('Setup already in progress', 409)
  setupInFlight = true
  try {
    if (!(await needsSetup())) throw new AppError('Setup has already been completed', 409)

    try {
      await updateSettings({
        mailDomain: mailDomain.toLowerCase(),
        ...(siteUrl ? { siteUrl: siteUrl.trim().replace(/\/+$/, '') } : {})
      })
    } catch (error) {
      throw new AppError(error instanceof Error ? error.message : 'Invalid settings', 400)
    }

    const hashedPassword = await bcrypt.hash(password, 12)
    const email = `${username.toLowerCase()}@${getSettings().mailDomain}`

    const created = await prisma.$transaction(async tx => {
      if ((await tx.user.count()) !== 0) return null
      return tx.user.create({
        data: { username, email, password: hashedPassword, role: ROLE_ADMIN },
        select: { id: true, username: true, email: true }
      })
    })
    if (!created) throw new AppError('Setup has already been completed', 409)

    console.log(`[Setup] Created initial admin user: ${created.username}`)
    res.status(201).json({ user: created })
  } finally {
    setupInFlight = false
  }
}))

export default router
