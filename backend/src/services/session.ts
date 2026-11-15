import crypto from 'crypto'
import jwt from 'jsonwebtoken'
import { Response } from 'express'
import { memoryStore } from '../store'
import { getJwtSecret } from '../config/secrets'
import { getSettings, getSessionTtlMs } from './settings'
import { getAvatarUrl } from '../utils/avatar'

export interface SSOSession {
  id: string
  userId: string
  username: string
  email: string
  role: string
  createdAt: number
  expiresAt: number
}

export interface AuthUserRecord {
  id: string
  email: string
  username: string
  nickname: string | null
  avatar: string | null
  language: string
  role: string
}

export function getSessionKey(sessionId: string): string {
  return `sso:session:${sessionId}`
}

function generateSessionId(): string {
  return crypto.randomBytes(32).toString('hex')
}

export async function createSSOSession(user: { id: string; username: string; email: string; role: string }): Promise<string> {
  const sessionId = generateSessionId()
  const ttlMs = getSessionTtlMs()
  const session: SSOSession = {
    id: sessionId,
    userId: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    createdAt: Date.now(),
    expiresAt: Date.now() + ttlMs
  }

  await memoryStore.set(getSessionKey(sessionId), JSON.stringify(session), ttlMs)
  return sessionId
}

export function setSSOCookie(res: Response, token: string): void {
  const settings = getSettings()
  const cookieOptions: {
    httpOnly: boolean
    secure: boolean
    sameSite: 'strict' | 'lax' | 'none'
    path: string
    maxAge: number
    domain?: string
  } = {
    httpOnly: true,
    secure: settings.ssoCookieSecure,
    sameSite: settings.ssoCookieSameSite as 'strict' | 'lax' | 'none',
    path: settings.ssoCookiePath,
    maxAge: getSessionTtlMs()
  }

  if (settings.ssoCookieDomain) {
    cookieOptions.domain = settings.ssoCookieDomain
  }

  res.cookie(settings.ssoCookieName, token, cookieOptions)
}

export function formatAuthUser(user: AuthUserRecord) {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    nickname: user.nickname,
    avatar: user.avatar,
    avatarUrl: getAvatarUrl(user.avatar),
    language: user.language,
    role: user.role
  }
}

export async function issueAuthSession(res: Response, user: AuthUserRecord) {
  const secret = getJwtSecret()
  const token = jwt.sign({ userId: user.id }, secret, { expiresIn: '7d' })
  const sessionId = await createSSOSession({
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role
  })
  const ssoToken = jwt.sign({ sessionId }, secret, { expiresIn: '7d' })
  setSSOCookie(res, ssoToken)

  return {
    token,
    user: formatAuthUser(user)
  }
}
