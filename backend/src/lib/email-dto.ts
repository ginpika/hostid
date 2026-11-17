/**
 * 邮件响应契约（DTO）与组装器
 * 持久化实体（Prisma Email / Attachment）不直接返回给客户端：
 * - 附件的服务器磁盘路径 `path` 属于内部细节，不能暴露
 * - 邮件与附件之间的关联表 EmailAttachment 对外展平为 attachments 数组
 */
import type { Attachment, Email, EmailAttachment } from '@prisma/client'

export interface AttachmentDto {
  id: string
  filename: string
  originalName: string
  mimeType: string
  size: number
  createdAt: Date
}

export function toAttachmentDto(attachment: Attachment): AttachmentDto {
  return {
    id: attachment.id,
    filename: attachment.filename,
    originalName: attachment.originalName,
    mimeType: attachment.mimeType,
    size: attachment.size,
    createdAt: attachment.createdAt
  }
}

export type EmailWithAttachments = Email & {
  attachments: (EmailAttachment & { attachment: Attachment })[]
}

/** 查询邮件并携带附件时统一使用的 include */
export const EMAIL_WITH_ATTACHMENTS_INCLUDE = {
  attachments: { include: { attachment: true } }
} as const

export function toEmailDto(email: EmailWithAttachments) {
  return {
    ...email,
    attachments: email.attachments.map(link => toAttachmentDto(link.attachment))
  }
}
