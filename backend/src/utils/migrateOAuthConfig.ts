import { prisma } from '../lib/prisma'
import { encrypt } from '../services/encryption'

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
          scope: 'user:email',
          isActive: true
        }
      })

      console.log('GitHub OAuth configuration migrated successfully.')
    }

    // If exists but not active, check if we should activate
    if (existingGitHub && !existingGitHub.isActive && githubClientId && githubClientSecret && githubCallbackUrl) {
      console.log('Activating existing GitHub OAuth configuration...')
      await prisma.oAuthProvider.update({
        where: { provider: 'github' },
        data: { isActive: true }
      })
    }
  } catch (error) {
    console.error('Error migrating OAuth configuration:', error)
  }
}