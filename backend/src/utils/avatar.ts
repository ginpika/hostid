/**
 * 头像 URL 转换工具
 * 统一处理本地存储头像和外部 URL 头像的转换
 */

const FRONTEND_URL = process.env.FRONTEND_URL || ''

/**
 * 获取完整的头像 URL
 * @param avatar - 头像字段值（可以是文件名或完整 URL）
 * @returns 完整的可访问的 URL
 */
export function getAvatarUrl(avatar: string | null | undefined): string | null {
  if (!avatar) {
    return null
  }

  // 如果已经是完整的 HTTP(S) URL，直接返回
  if (avatar.startsWith('http://') || avatar.startsWith('https://')) {
    return avatar
  }

  // 本地头像，使用 FRONTEND_URL 构建完整 URL
  if (FRONTEND_URL) {
    return `${FRONTEND_URL}/api/auth/avatar/${avatar}`
  }

  // 没有配置 FRONTEND_URL 时返回相对路径
  return `/api/auth/avatar/${avatar}`
}

/**
 * 用户信息接口（带 avatarUrl 字段）
 */
export interface UserWithAvatarUrl {
  id: string
  username: string
  email: string
  nickname?: string | null
  avatar?: string | null
  avatarUrl?: string | null
  role: string
  language?: string
  githubId?: number | null
  [key: string]: any
}

/**
 * 转换用户对象，添加 avatarUrl 字段
 * @param user - 用户对象
 * @returns 添加了 avatarUrl 字段的用户对象
 */
export function transformUserAvatar(user: UserWithAvatarUrl): UserWithAvatarUrl {
  if (!user) {
    return user
  }

  const avatarUrl = getAvatarUrl(user.avatar)
  return {
    ...user,
    avatarUrl
  }
}
