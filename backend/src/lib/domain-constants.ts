/**
 * 领域常量：用户角色与邮件文件夹。
 * 过去这些字符串散落在路由与 schema 校验里，这里作为唯一来源。
 */
/** 用户名允许字符（账号注册、OAuth 注册、初始化共用） */
export const USERNAME_PATTERN = /^[a-zA-Z0-9._]+$/

export const USER_ROLES = ['admin', 'user'] as const
export type UserRole = (typeof USER_ROLES)[number]
export const ROLE_ADMIN: UserRole = 'admin'

/** 邮件实际所在的文件夹（持久化值） */
export const MAILBOX_FOLDERS = ['INBOX', 'SENT', 'TRASH', 'ARCHIVED'] as const
export type MailboxFolder = (typeof MAILBOX_FOLDERS)[number]

/** 列表可用的筛选：真实文件夹 + “星标”虚拟视图 */
export const EMAIL_LIST_FILTERS = [...MAILBOX_FOLDERS, 'STARRED'] as const

export const FOLDER_INBOX: MailboxFolder = 'INBOX'
export const FOLDER_SENT: MailboxFolder = 'SENT'
export const FOLDER_TRASH: MailboxFolder = 'TRASH'
export const FOLDER_ARCHIVED: MailboxFolder = 'ARCHIVED'
