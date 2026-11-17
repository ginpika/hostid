/**
 * 本地文件存储路径（单一来源）
 * 附件与头像目录过去在 upload.ts / email.ts / smtp / avatarUpload.ts 中各自拼接，这里统一。
 */
import fs from 'node:fs'
import path from 'node:path'

export const UPLOAD_DIR = path.join(process.cwd(), 'uploads')
export const AVATAR_DIR = path.join(process.cwd(), 'avatars')

for (const dir of [UPLOAD_DIR, AVATAR_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

/**
 * 附件在磁盘上的绝对路径。只取文件名部分，防止数据库中残留的 `../` 之类的值逃出上传目录。
 */
export function getAttachmentPath(filename: string): string {
  return path.join(UPLOAD_DIR, path.basename(filename))
}

/**
 * 把外部提供的文件名（邮件附件名、上传文件名）转换为可安全落盘的文件名：
 * 去掉目录部分与控制/分隔字符，避免路径穿越。
 */
export function toSafeStoredFilename(raw: string | undefined | null, fallback = 'attachment'): string {
  const base = path.basename((raw ?? '').replace(/\\/g, '/'))
  const cleaned = base.replace(/[\u0000-\u001f\u007f/\\]/g, '_').trim()
  return cleaned && cleaned !== '.' && cleaned !== '..' ? cleaned.slice(0, 200) : fallback
}
