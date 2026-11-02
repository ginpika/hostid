/**
 * 头像上传中间件
 * 使用 Multer 处理用户头像上传
 * 配置头像目录和文件命名规则
 */
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { Request } from 'express'

const AVATAR_DIR = path.join(process.cwd(), 'avatars')

if (!fs.existsSync(AVATAR_DIR)) {
  fs.mkdirSync(AVATAR_DIR, { recursive: true })
}

const MIME_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp'
}

const AVATAR_FILENAME_RE = /^[A-Za-z0-9_-]{1,128}\.(png|jpe?g|gif|webp)$/i

const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, AVATAR_DIR)
  },
  filename: (req, file, cb) => {
    const userId = (req as any).userId
    // 扩展名由 MIME 类型决定，不信任客户端文件名
    const ext = MIME_EXT[file.mimetype] || ''
    cb(null, `${userId}${ext}`)
  }
})

const avatarFileFilter = (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8')
  
  const allowedMimeTypes = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp'
  ]
  
  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true)
  } else {
    cb(new Error(`File type ${file.mimetype} is not allowed. Only images are permitted.`))
  }
}

export const avatarUpload = multer({
  storage: avatarStorage,
  fileFilter: avatarFileFilter,
  limits: {
    fileSize: 2 * 1024 * 1024
  }
})

/**
 * 安全地解析头像文件路径；文件名非法或越出头像目录时返回 null（防路径穿越）
 */
export const getAvatarPath = (filename: string): string | null => {
  if (typeof filename !== 'string') return null
  const base = path.basename(filename)
  if (base !== filename || !AVATAR_FILENAME_RE.test(base)) return null
  const root = path.resolve(AVATAR_DIR)
  const resolved = path.resolve(root, base)
  if (!resolved.startsWith(root + path.sep)) return null
  return resolved
}

export const getAvatarDir = (): string => {
  return AVATAR_DIR
}
