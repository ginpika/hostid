/**
 * 错误处理中间件
 * 定义自定义错误类、统一的 asyncHandler 和全局错误处理器
 * 统一处理 API 错误响应格式：校验错误 / 上传错误 / 记录不存在都映射为语义明确的 4xx，而不是 500
 */
import { Request, Response, NextFunction } from 'express'
import { Prisma } from '@prisma/client'
import multer from 'multer'
import { ZodError } from 'zod'

export class AppError extends Error {
  statusCode: number

  constructor(message: string, statusCode: number) {
    super(message)
    this.statusCode = statusCode
  }
}

/** 全局唯一的异步路由包装器：Express 4 不会捕获 async 处理函数的 rejection */
export const asyncHandler = <Req extends Request = Request>(
  fn: (req: Req, res: Response, next: NextFunction) => Promise<unknown>
) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req as Req, res, next)).catch(next)
  }
}

const MULTER_STATUS: Record<string, number> = {
  LIMIT_FILE_SIZE: 413
}

export const errorHandler = (
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
) => {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({ error: err.message })
  }
  if (err instanceof ZodError) {
    return res.status(400).json({ error: err.issues[0]?.message || 'Invalid request payload' })
  }
  if (err instanceof multer.MulterError) {
    return res.status(MULTER_STATUS[err.code] ?? 400).json({ error: err.message })
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
    return res.status(404).json({ error: 'Record not found' })
  }
  console.error(err)
  res.status(500).json({ error: 'Internal server error' })
}
