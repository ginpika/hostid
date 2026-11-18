/**
 * 站点图标文件名、MIME 类型与路径解析工具
 */
import path from 'node:path'
import { getSiteIconDir } from '../config/paths'

export const SITE_ICON_FILENAME_RE = /^site-icon-[a-z0-9-]{1,80}\.(png|jpg|gif|webp|ico|svg)$/i

const EXT_TO_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml'
}

export function isValidSiteIconFilename(filename: string): boolean {
  return typeof filename === 'string' && path.basename(filename) === filename && SITE_ICON_FILENAME_RE.test(filename)
}

export function getSiteIconPath(filename: string): string | null {
  if (!isValidSiteIconFilename(filename)) return null
  const root = path.resolve(getSiteIconDir())
  const resolved = path.resolve(root, filename)
  if (!resolved.startsWith(root + path.sep)) return null
  return resolved
}

export function getSiteIconMimeType(filename: string): string | null {
  if (!isValidSiteIconFilename(filename)) return null
  const ext = path.extname(filename).toLowerCase()
  return EXT_TO_MIME[ext] ?? null
}

export function getSiteIconUrl(filename: string | null | undefined): string {
  if (!filename || !isValidSiteIconFilename(filename)) return ''
  return `/api/auth/site-icon/${filename}`
}
