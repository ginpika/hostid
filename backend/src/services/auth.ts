/**
 * 本地账号认证与资料服务
 * 将密码注册、登录校验（含 RSA 解密）、改密、头像更新等核心业务从 routes/auth 剥离，
 * 路由层只保留参数校验与会话 Cookie 输出。
 */
import bcrypt from 'bcryptjs'
import { prisma } from '../lib/prisma'
import { AppError } from '../middleware/error'
import { getAvatarPath } from '../middleware/avatarUpload'
import { decryptPassword } from '../utils/rsa'
import { getAvatarUrl } from '../utils/avatar'
import { getSettings } from './settings'
import { isTurnstileEnabled, verifyTurnstile } from './turnstile'
import { removeStoredFile } from './attachment'

const BCRYPT_ROUNDS = 12
const MIN_PASSWORD_LENGTH = 6

const AUTH_PROFILE_SELECT = {
  id: true,
  email: true,
  username: true,
  nickname: true,
  phone: true,
  birthday: true,
  avatar: true,
  language: true,
  role: true,
  githubId: true,
  createdAt: true
} as const

function decryptOrThrow(cipher: string, message: string, status: number): string {
  try {
    return decryptPassword(cipher)
  } catch {
    throw new AppError(message, status)
  }
}

export async function registerLocalUser(input: {
  username: string
  password: string
  turnstileToken?: string
  ip?: string
}) {
  if (isTurnstileEnabled()) {
    if (!input.turnstileToken) {
      throw new AppError('Turnstile verification required', 400)
    }
    const ok = await verifyTurnstile(input.turnstileToken, input.ip)
    if (!ok) {
      throw new AppError('Turnstile verification failed', 400)
    }
  }

  const existing = await prisma.user.findUnique({ where: { username: input.username } })
  if (existing) {
    throw new AppError('Username already taken', 400)
  }

  const email = `${input.username}@${getSettings().mailDomain}`
  const hashedPassword = await bcrypt.hash(input.password, BCRYPT_ROUNDS)
  return prisma.user.create({
    data: { email, username: input.username, password: hashedPassword }
  })
}

export async function authenticateWithPassword(username: string, encryptedPassword: string) {
  const user = await prisma.user.findUnique({ where: { username } })
  if (!user) {
    throw new AppError('Invalid credentials', 401)
  }

  const plainPassword = decryptOrThrow(encryptedPassword, 'Invalid credentials', 401)
  const isValid = await bcrypt.compare(plainPassword, user.password)
  if (!isValid) {
    throw new AppError('Invalid credentials', 401)
  }

  return user
}

export async function getCurrentUserProfile(userId: string) {
  const found = await prisma.user.findUnique({
    where: { id: userId },
    select: { ...AUTH_PROFILE_SELECT, password: true }
  })
  if (!found) {
    throw new AppError('User not found', 404)
  }

  // 密码哈希只用于计算 hasPassword，绝不出现在响应里
  const { password, ...user } = found
  return {
    ...user,
    hasPassword: !!password,
    avatarUrl: getAvatarUrl(user.avatar)
  }
}

export async function updateUserProfile(
  userId: string,
  data: { nickname?: string; phone?: string; birthday?: string }
) {
  const updated = await prisma.user.update({
    where: { id: userId },
    data,
    select: {
      id: true,
      email: true,
      username: true,
      nickname: true,
      phone: true,
      birthday: true,
      avatar: true,
      language: true,
      createdAt: true
    }
  })

  return {
    ...updated,
    avatarUrl: getAvatarUrl(updated.avatar)
  }
}

export async function updateUserLanguage(userId: string, language: 'zh-CN' | 'en-US') {
  return prisma.user.update({
    where: { id: userId },
    data: { language },
    select: { id: true, email: true, username: true, language: true }
  })
}

export async function updateUserAvatar(userId: string, filename: string) {
  const current = await prisma.user.findUnique({
    where: { id: userId },
    select: { avatar: true }
  })

  // 仅当旧文件名与新文件名不同时才删除旧文件：multer 按 ${userId}${ext} 命名，同后缀已就地覆盖
  if (current?.avatar && current.avatar !== filename) {
    const oldAvatarPath = getAvatarPath(current.avatar)
    if (oldAvatarPath) {
      await removeStoredFile(oldAvatarPath)
    }
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { avatar: filename },
    select: {
      id: true,
      email: true,
      username: true,
      nickname: true,
      avatar: true
    }
  })

  return {
    ...updated,
    avatarUrl: getAvatarUrl(updated.avatar)
  }
}

export async function changeUserPassword(userId: string, input: { oldPassword?: string; newPassword: string }) {
  const plainNew = decryptOrThrow(input.newPassword, 'Invalid password format', 400)
  if (plainNew.length < MIN_PASSWORD_LENGTH) {
    throw new AppError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`, 400)
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { password: true }
  })
  if (!user) {
    throw new AppError('User not found', 404)
  }

  // OAuth / Passkey 注册的无密码账号首次设置密码时不需要旧密码
  if (user.password) {
    if (!input.oldPassword) {
      throw new AppError('Current password is required', 400)
    }
    const plainOld = decryptOrThrow(input.oldPassword, 'Invalid password format', 400)
    const isValid = await bcrypt.compare(plainOld, user.password)
    if (!isValid) {
      throw new AppError('Current password is incorrect', 400)
    }
  }

  const hashedPassword = await bcrypt.hash(plainNew, BCRYPT_ROUNDS)
  await prisma.user.update({
    where: { id: userId },
    data: { password: hashedPassword }
  })
}
