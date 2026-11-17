/**
 * 认证与授权中间件
 * - auth：验证 JWT Token 并提取用户 ID，用于保护需要登录的 API 路由
 * - requireAdmin：在 auth 之后校验管理员角色（每次查库，角色变更即时生效）
 * - adminGuard：auth + requireAdmin 的组合，管理端路由统一使用
 */
import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { AppError, asyncHandler } from './error'
import { getJwtSecret } from '../config/secrets'
import { prisma } from '../lib/prisma'
import { ROLE_ADMIN } from '../lib/domain-constants'

export interface AuthRequest extends Request {
  userId?: string
}

export const auth = (req: AuthRequest, res: Response, next: NextFunction) => {
  const token = req.headers.authorization?.replace('Bearer ', '')

  if (!token) {
    throw new AppError('Authentication required', 401)
  }

  try {
    const decoded = jwt.verify(token, getJwtSecret()) as { userId: string }
    req.userId = decoded.userId
    next()
  } catch {
    throw new AppError('Invalid token', 401)
  }
}

export const requireAdmin = asyncHandler<AuthRequest>(async (req, _res, next) => {
  const user = await prisma.user.findUnique({
    where: { id: req.userId },
    select: { role: true }
  })

  if (!user || user.role !== ROLE_ADMIN) {
    throw new AppError('Admin access required', 403)
  }
  next()
})

/** 管理端路由守卫：`router.get(path, ...adminGuard, handler)` */
export const adminGuard = [auth, requireAdmin]
