/**
 * Prisma 客户端实例
 * 导出全局 Prisma 客户端用于数据库操作
 */
import { PrismaClient } from '@prisma/client'

export const prisma = new PrismaClient()
