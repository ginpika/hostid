import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { Request } from 'express'

const AVATAR_DIR = path.join(process.cwd(), 'avatars')

if (!fs.existsSync(AVATAR_DIR)) {
  fs.mkdirSync(AVATAR_DIR, { recursive: true })
}

const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, AVATAR_DIR)
  },
  filename: (req, file, cb) => {
    const userId = (req as any).userId
    const ext = path.extname(file.originalname)
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

export const getAvatarPath = (filename: string): string => {
  return path.join(AVATAR_DIR, filename)
}

export const getAvatarDir = (): string => {
  return AVATAR_DIR
}
