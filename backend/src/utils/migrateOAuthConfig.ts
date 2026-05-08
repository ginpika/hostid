/**
 * OAuth 配置迁移工具
 * 将环境变量中的 OAuth 配置迁移到数据库
 * 在服务器启动时自动执行
 */
import { prisma } from '../lib/prisma'
import { encrypt } from '../services/encryption'
import { clearProviderCache } from '../routes/oauthClient'

/**
 * Migrate OAuth configuration from environment variables to database
 * This runs automatically on server startup
 */
export async function migrateOAuthConfig(): Promise<void> {
  try {
    // Check if GitHub config already exists in database
    const existingGitHub = await prisma.oAuthProvider.findUnique({
      where: { provider: 'github' }
    })

    // Read from environment variables
    const githubClientId = process.env.GITHUB_CLIENT_ID || ''
    const githubClientSecret = process.env.GITHUB_CLIENT_SECRET || ''
    const githubCallbackUrl = process.env.GITHUB_CALLBACK_URL || ''
    const githubAuthorizationUrl = process.env.GITHUB_AUTHORIZATION_URL || 'https://github.com/login/oauth/authorize'
    const githubTokenUrl = process.env.GITHUB_TOKEN_URL || 'https://github.com/login/oauth/access_token'
    const githubUserinfoUrl = process.env.GITHUB_USERINFO_URL || 'https://api.github.com/user'

    // If env vars are set and database doesn't have config, migrate
    if (!existingGitHub && githubClientId && githubClientSecret && githubCallbackUrl) {
      console.log('Migrating GitHub OAuth configuration from environment variables to database...')

      await prisma.oAuthProvider.create({
        data: {
          provider: 'github',
          displayName: 'GitHub',
          clientId: githubClientId,
          clientSecret: encrypt(githubClientSecret),
          callbackUrl: githubCallbackUrl,
          authorizationUrl: githubAuthorizationUrl,
          tokenUrl: githubTokenUrl,
          userinfoUrl: githubUserinfoUrl,
          isActive: false
        }
      })

      clearProviderCache('github')
      console.log('GitHub OAuth configuration migrated successfully.')
    }

    // If exists but not active, check if we should activate
    if (existingGitHub && !existingGitHub.isActive && githubClientId && githubClientSecret && githubCallbackUrl) {
      console.log('Activating existing GitHub OAuth configuration...')
      await prisma.oAuthProvider.update({
        where: { provider: 'github' },
        data: { isActive: true }
      })
      clearProviderCache('github')
    }
  } catch (error) {
    console.error('Error migrating OAuth configuration:', error)
  }
}