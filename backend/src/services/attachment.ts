/**
 * 附件生命周期服务
 * 附件文件可能被多封邮件共享（发件箱副本、收件箱副本、回复引用），
 * 只有在不再被任何邮件引用时才删除数据库记录与磁盘文件。
 */
import fs from 'node:fs/promises'
import { prisma } from '../lib/prisma'
import { getAttachmentPath } from '../config/paths'

/** 删除磁盘文件；文件不存在视为成功，其它错误只记录日志不影响主流程 */
export async function removeStoredFile(filePath: string): Promise<void> {
  try {
    await fs.rm(filePath, { force: true })
  } catch (error) {
    console.error('[Attachment] Failed to remove file:', filePath, error instanceof Error ? error.message : error)
  }
}

/** 批量清理刚上传但最终未入库的文件（如校验失败的请求） */
export async function removeUploadedFiles(files: Pick<Express.Multer.File, 'path'>[] | undefined): Promise<void> {
  await Promise.all((files ?? []).map(file => removeStoredFile(file.path)))
}

/** 附件不再被任何邮件引用时，删除记录与文件；仍被引用则什么也不做。返回是否已清理 */
export async function deleteAttachmentIfUnreferenced(attachmentId: string): Promise<boolean> {
  const references = await prisma.emailAttachment.count({ where: { attachmentId } })
  if (references > 0) return false

  const attachment = await prisma.attachment.findUnique({ where: { id: attachmentId } })
  if (!attachment) return false

  await prisma.attachment.delete({ where: { id: attachment.id } })
  await removeStoredFile(getAttachmentPath(attachment.filename))
  return true
}
