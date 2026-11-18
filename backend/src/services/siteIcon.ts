/**
 * 站点图标上传、校验与重置服务
 * - 校验文件大小（<= 2MB）与真实文件头（magic bytes / SVG 结构）
 * - 使用不可变唯一文件名落盘，替换或重置后清理旧文件
 */
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import multer from 'multer'
import { getSiteIconDir } from '../config/paths'
import { AppError } from '../middleware/error'
import { getSiteIconPath } from '../utils/siteIcon'
import { removeStoredFile } from './attachment'
import { getSettings, getSettingsView, getSiteBranding, setSiteIconSetting } from './settings'

export const MAX_SITE_ICON_BYTES = 2 * 1024 * 1024

interface DetectedIconFormat {
  ext: '.png' | '.jpg' | '.gif' | '.webp' | '.ico' | '.svg'
  mimeType: string
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function isValidSvg(buffer: Buffer): boolean {
  if (buffer.includes(0)) return false
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch {
    return false
  }
  const normalized = text.replace(/^\uFEFF/, '').trim()
  if (!normalized) return false
  if (!/^(?:<\?xml\b|<!--|<svg\b)/i.test(normalized)) return false
  if (!/<svg\b/i.test(normalized) || !/<\/svg\s*>/i.test(normalized)) return false
  if (/(?:<script\b|<foreignObject\b|<!ENTITY\b|(?:^|[\s/])on[a-z]+\s*=|javascript:|vbscript:|data:text\/html)/i.test(normalized)) {
    return false
  }
  return true
}

export function detectSiteIconFormat(buffer: Buffer): DetectedIconFormat {
  if (!buffer || buffer.length === 0) {
    throw new AppError('Icon file cannot be empty', 400)
  }
  if (buffer.length > MAX_SITE_ICON_BYTES) {
    throw new AppError('Icon file size cannot exceed 2 MB', 413)
  }

  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_SIG)) {
    return { ext: '.png', mimeType: 'image/png' }
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { ext: '.jpg', mimeType: 'image/jpeg' }
  }
  if (buffer.length >= 6) {
    const header6 = buffer.subarray(0, 6).toString('ascii')
    if (header6 === 'GIF87a' || header6 === 'GIF89a') {
      return { ext: '.gif', mimeType: 'image/gif' }
    }
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { ext: '.webp', mimeType: 'image/webp' }
  }
  if (
    buffer.length >= 22 &&
    buffer[0] === 0x00 &&
    buffer[1] === 0x00 &&
    buffer[2] === 0x01 &&
    buffer[3] === 0x00 &&
    (buffer[4] | (buffer[5] << 8)) > 0
  ) {
    return { ext: '.ico', mimeType: 'image/x-icon' }
  }
  if (isValidSvg(buffer)) {
    return { ext: '.svg', mimeType: 'image/svg+xml' }
  }

  throw new AppError('Unsupported or invalid icon image. Allowed formats: PNG, JPG, GIF, WebP, ICO, SVG.', 400)
}

export const siteIconUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_SITE_ICON_BYTES,
    files: 1
  }
})

export async function saveSiteIcon(buffer: Buffer) {
  const { ext } = detectSiteIconFormat(buffer)
  const dir = getSiteIconDir()
  await fs.mkdir(dir, { recursive: true })

  const filename = `site-icon-${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`
  const targetPath = getSiteIconPath(filename)
  if (!targetPath) {
    throw new AppError('Failed to resolve site icon path', 500)
  }

  const tmpPath = `${targetPath}.${process.pid}.tmp`
  await fs.writeFile(tmpPath, buffer)
  await fs.rename(tmpPath, targetPath)

  const previousFilename = getSettings().siteIcon
  try {
    await setSiteIconSetting(filename)
  } catch (error) {
    await removeStoredFile(targetPath)
    throw error
  }

  if (previousFilename && previousFilename !== filename) {
    const oldPath = getSiteIconPath(previousFilename)
    if (oldPath) await removeStoredFile(oldPath)
  }

  return {
    filename,
    branding: getSiteBranding(),
    settings: getSettingsView()
  }
}

export async function resetSiteIcon() {
  const previousFilename = getSettings().siteIcon
  await setSiteIconSetting('')

  if (previousFilename) {
    const oldPath = getSiteIconPath(previousFilename)
    if (oldPath) await removeStoredFile(oldPath)
  }

  return {
    branding: getSiteBranding(),
    settings: getSettingsView()
  }
}
