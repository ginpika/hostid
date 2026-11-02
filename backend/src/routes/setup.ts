/**
 * 首次运行初始化向导
 * 仅在系统中没有任何用户时允许创建第一个管理员，并写入站点地址和邮件域名
 */
import { Router, Request, Response } from 'express'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { asyncHandler } from '../middleware/error'
import { updateSettings, getSettings } from '../services/settings'

const router = Router()
const prisma = new PrismaClient()

const USERNAME_RE = /^[a-zA-Z0-9._]{3,32}$/
const MIN_PASSWORD_LENGTH = 12
const MAX_PASSWORD_LENGTH = 256

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
  const { username, password, siteUrl, mailDomain } = req.body ?? {}

  if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
    return res.status(400).json({ error: 'Username must be 3-32 characters: letters, digits, dot or underscore' })
  }
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` })
  }
  if (typeof mailDomain !== 'string' || !mailDomain.trim()) {
    return res.status(400).json({ error: 'Mail domain is required' })
  }
  if (siteUrl !== undefined && typeof siteUrl !== 'string') {
    return res.status(400).json({ error: 'Invalid site URL' })
  }

  if (setupInFlight) return res.status(409).json({ error: 'Setup already in progress' })
  setupInFlight = true
  try {
    if (!(await needsSetup())) return res.status(409).json({ error: 'Setup has already been completed' })

    try {
      await updateSettings({ mailDomain: mailDomain.trim().toLowerCase(), ...(siteUrl ? { siteUrl: siteUrl.trim().replace(/\/+$/, '') } : {}) })
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid settings' })
    }

    const hashedPassword = await bcrypt.hash(password, 12)
    const email = `${username.toLowerCase()}@${getSettings().mailDomain}`

    const created = await prisma.$transaction(async tx => {
      if ((await tx.user.count()) !== 0) return null
      return tx.user.create({
        data: { username, email, password: hashedPassword, role: 'admin' },
        select: { id: true, username: true, email: true }
      })
    })
    if (!created) return res.status(409).json({ error: 'Setup has already been completed' })

    console.log(`[Setup] Created initial admin user: ${created.username}`)
    res.status(201).json({ user: created })
  } finally {
    setupInFlight = false
  }
}))

export default router
