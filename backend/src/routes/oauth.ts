import { Router, Request, Response, NextFunction } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { AppError } from '../middleware/error'
import { memoryStore } from '../store'

const router = Router()

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || ''
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || ''
const GITHUB_CALLBACK_URL = process.env.GITHUB_CALLBACK_URL || ''
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173'
const JWT_SECRET = process.env.JWT_SECRET || 'secret'
const SESSION_TTL = parseInt(process.env.SESSION_TTL || '604800', 10) * 1000
const SSO_COOKIE_NAME = process.env.SSO_COOKIE_NAME || 'sso_token'
const SSO_COOKIE_DOMAIN = process.env.SSO_COOKIE_DOMAIN || ''
const SSO_COOKIE_PATH = process.env.SSO_COOKIE_PATH || '/'
const SSO_COOKIE_SECURE = process.env.SSO_COOKIE_SECURE === 'true'
const SSO_COOKIE_SAMESITE = (process.env.SSO_COOKIE_SAMESITE || 'lax') as 'strict' | 'lax' | 'none'
const MAIL_DOMAIN = process.env.MAIL_DOMAIN || 'localhost'

interface SSOSession {
  id: string
  userId: string
  username: string
  email: string
  role: string
  createdAt: number
  expiresAt: number
}

interface GitHubUser {
  id: number
  login: string
  email: string | null
  name: string | null
  avatar_url: string
}

interface GitHubEmail {
  email: string
  primary: boolean
  verified: boolean
}

interface OAuthState {
  redirect: string
  createdAt: number
}

interface PendingOAuthUser {
  githubId: number
  githubLogin: string
  email: string | null
  name: string | null
  avatarUrl: string
  createdAt: number
}

function generateSessionId(): string {
  return crypto.randomBytes(32).toString('hex')
}

function generateState(): string {
  return crypto.randomBytes(16).toString('hex')
}

function generateOAuthToken(): string {
  return crypto.randomBytes(32).toString('hex')
}

function getSessionKey(sessionId: string): string {
  return `sso:session:${sessionId}`
}

function getStateKey(state: string): string {
  return `oauth:state:${state}`
}

function getPendingOAuthKey(token: string): string {
  return `oauth:pending:${token}`
}

async function createSSOSession(user: { id: string; username: string; email: string; role: string }): Promise<string> {
  const sessionId = generateSessionId()
  const session: SSOSession = {
    id: sessionId,
    userId: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    createdAt: Date.now(),
    expiresAt: Date.now() + SESSION_TTL
  }
  
  await memoryStore.set(getSessionKey(sessionId), JSON.stringify(session), SESSION_TTL)
  return sessionId
}

function setSSOCookie(res: Response, token: string): void {
  const cookieOptions: any = {
    httpOnly: true,
    secure: SSO_COOKIE_SECURE,
    sameSite: SSO_COOKIE_SAMESITE,
    path: SSO_COOKIE_PATH,
    maxAge: SESSION_TTL
  }
  
  if (SSO_COOKIE_DOMAIN) {
    cookieOptions.domain = SSO_COOKIE_DOMAIN
  }
  
  res.cookie(SSO_COOKIE_NAME, token, cookieOptions)
}

const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next)
  }
}

router.get('/github', asyncHandler(async (req: Request, res: Response) => {
  if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET || !GITHUB_CALLBACK_URL) {
    throw new AppError('GitHub OAuth is not configured', 500)
  }

  const redirect = req.query.redirect as string || '/'
  const state = generateState()
  
  await memoryStore.set(getStateKey(state), JSON.stringify({ redirect, createdAt: Date.now() }), 5 * 60 * 1000)

  const githubAuthUrl = new URL('https://github.com/login/oauth/authorize')
  githubAuthUrl.searchParams.set('client_id', GITHUB_CLIENT_ID)
  githubAuthUrl.searchParams.set('redirect_uri', GITHUB_CALLBACK_URL)
  githubAuthUrl.searchParams.set('scope', 'user:email')
  githubAuthUrl.searchParams.set('state', state)

  res.redirect(githubAuthUrl.toString())
}))

router.get('/github/callback', asyncHandler(async (req: Request, res: Response) => {
  const { code, state } = req.query

  if (!code || !state) {
    throw new AppError('Invalid OAuth callback', 400)
  }

  const stateDataStr = await memoryStore.get(getStateKey(state as string))
  if (!stateDataStr) {
    throw new AppError('Invalid or expired OAuth state', 400)
  }
  
  await memoryStore.delete(getStateKey(state as string))
  
  const stateData: OAuthState = JSON.parse(stateDataStr)

  const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify({
      client_id: GITHUB_CLIENT_ID,
      client_secret: GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: GITHUB_CALLBACK_URL,
      state
    })
  })

  const tokenData = await tokenResponse.json() as { access_token?: string; error?: string; error_description?: string }
  
  if (tokenData.error || !tokenData.access_token) {
    console.error('GitHub token error:', tokenData)
    throw new AppError(`GitHub OAuth error: ${tokenData.error_description || tokenData.error}`, 400)
  }

  const userResponse = await fetch('https://api.github.com/user', {
    headers: {
      'Authorization': `Bearer ${tokenData.access_token}`,
      'Accept': 'application/vnd.github.v3+json'
    }
  })

  if (!userResponse.ok) {
    throw new AppError('Failed to fetch GitHub user', 400)
  }

  const githubUser = await userResponse.json() as GitHubUser

  let primaryEmail = githubUser.email
  
  if (!primaryEmail) {
    const emailsResponse = await fetch('https://api.github.com/user/emails', {
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    })

    if (emailsResponse.ok) {
      const emails = await emailsResponse.json() as GitHubEmail[]
      const primary = emails.find(e => e.primary && e.verified)
      if (primary) {
        primaryEmail = primary.email
      } else {
        const verified = emails.find(e => e.verified)
        if (verified) {
          primaryEmail = verified.email
        }
      }
    }
  }

  const existingUser = await prisma.user.findFirst({
    where: {
      OR: [
        { githubId: githubUser.id }
      ]
    }
  })

  if (existingUser) {
    if (githubUser.avatar_url && existingUser.avatar !== githubUser.avatar_url) {
      await prisma.user.update({
        where: { id: existingUser.id },
        data: {
          avatar: githubUser.avatar_url,
          nickname: githubUser.name || existingUser.nickname
        }
      })
    }

    const token = jwt.sign({ userId: existingUser.id }, JWT_SECRET, { expiresIn: '7d' })
    
    const sessionId = await createSSOSession({
      id: existingUser.id,
      username: existingUser.username,
      email: existingUser.email,
      role: existingUser.role
    })
    const ssoToken = jwt.sign({ sessionId }, JWT_SECRET, { expiresIn: '7d' })
    setSSOCookie(res, ssoToken)

    const frontendCallback = `${FRONTEND_URL}/oauth/callback?token=${token}&user=${encodeURIComponent(JSON.stringify({
      id: existingUser.id,
      email: existingUser.email,
      username: existingUser.username,
      nickname: existingUser.nickname,
      avatar: existingUser.avatar,
      language: existingUser.language,
      role: existingUser.role
    }))}&redirect=${encodeURIComponent(stateData.redirect)}`

    res.redirect(frontendCallback)
    return
  }

  const oauthToken = generateOAuthToken()
  const pendingUser: PendingOAuthUser = {
    githubId: githubUser.id,
    githubLogin: githubUser.login,
    email: primaryEmail,
    name: githubUser.name,
    avatarUrl: githubUser.avatar_url,
    createdAt: Date.now()
  }
  
  await memoryStore.set(getPendingOAuthKey(oauthToken), JSON.stringify(pendingUser), 10 * 60 * 1000)

  const registerUrl = `${FRONTEND_URL}/oauth/register?token=${oauthToken}&redirect=${encodeURIComponent(stateData.redirect)}&githubLogin=${githubUser.login}&name=${encodeURIComponent(githubUser.name || '')}&avatar=${encodeURIComponent(githubUser.avatar_url)}`

  res.redirect(registerUrl)
}))

const completeRegisterSchema = z.object({
  token: z.string(),
  username: z.string().min(3).max(30).regex(/^[a-zA-Z0-9._]+$/, 'Username can only contain letters, numbers, dots and underscores')
})

router.post('/register', asyncHandler(async (req: Request, res: Response) => {
  const { token, username } = completeRegisterSchema.parse(req.body)

  const pendingUserStr = await memoryStore.get(getPendingOAuthKey(token))
  if (!pendingUserStr) {
    throw new AppError('Invalid or expired OAuth token', 400)
  }

  await memoryStore.delete(getPendingOAuthKey(token))
  
  const pendingUser: PendingOAuthUser = JSON.parse(pendingUserStr)

  const existingUser = await prisma.user.findUnique({
    where: { username }
  })

  if (existingUser) {
    throw new AppError('Username already taken', 400)
  }

  const email = `${username}@${MAIL_DOMAIN}`
  
  const user = await prisma.user.create({
    data: {
      username,
      email,
      password: '',
      nickname: pendingUser.name || pendingUser.githubLogin,
      avatar: pendingUser.avatarUrl,
      githubId: pendingUser.githubId
    }
  })

  const jwtToken = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' })
  
  const sessionId = await createSSOSession({
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role
  })
  const ssoToken = jwt.sign({ sessionId }, JWT_SECRET, { expiresIn: '7d' })
  setSSOCookie(res, ssoToken)

  res.json({
    token: jwtToken,
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      nickname: user.nickname,
      avatar: user.avatar,
      language: user.language,
      role: user.role
    }
  })
}))

router.get('/pending/:token', asyncHandler(async (req: Request, res: Response) => {
  const { token } = req.params
  
  const pendingUserStr = await memoryStore.get(getPendingOAuthKey(token))
  if (!pendingUserStr) {
    throw new AppError('Invalid or expired OAuth token', 400)
  }
  
  const pendingUser: PendingOAuthUser = JSON.parse(pendingUserStr)
  
  res.json({
    githubLogin: pendingUser.githubLogin,
    name: pendingUser.name,
    avatarUrl: pendingUser.avatarUrl,
    email: pendingUser.email
  })
}))

router.get('/status', (req: Request, res: Response) => {
  res.json({
    github: !!(GITHUB_CLIENT_ID && GITHUB_CLIENT_SECRET && GITHUB_CALLBACK_URL)
  })
})

export default router
