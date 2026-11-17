/**
 * 文件上传中间件
 * 使用 Multer 处理邮件附件与 EML 导入文件上传
 * 校验失败统一抛 AppError(400)，不再落入 500
 */
import multer from 'multer'
import path from 'path'
import { Request } from 'express'
import { AppError } from './error'
import { UPLOAD_DIR } from '../config/paths'

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR)
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1E9)}`
    const ext = path.extname(file.originalname)
    cb(null, `${uniqueSuffix}${ext}`)
  }
})

const ALLOWED_ATTACHMENT_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
  'application/zip',
  'application/x-rar-compressed',
  'application/x-7z-compressed',
  'audio/mpeg',
  'audio/wav',
  'video/mp4',
  'video/webm',
  'video/quicktime'
])

const fileFilter = (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  // multer 默认使用 latin1 编码解析文件名，需要转换为 utf8 以支持中文
  // 无条件转换，因为 latin1 -> utf8 对纯英文文件名无影响
  file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8')

  if (ALLOWED_ATTACHMENT_MIME_TYPES.has(file.mimetype)) {
    cb(null, true)
  } else {
    cb(new AppError(`File type ${file.mimetype} is not allowed`, 400))
  }
}

export const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 10
  }
})

/** EML 邮件导入：先落盘到上传目录，解析后由路由负责删除 */
export const emlUpload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'message/rfc822' || file.originalname.endsWith('.eml')) {
      cb(null, true)
    } else {
      cb(new AppError('Only .eml files are allowed', 400))
    }
  }
})
