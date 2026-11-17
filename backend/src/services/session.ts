/**
 * SSO 会话服务（单一实现）
 * 会话创建 / 校验 / 吊销、Cookie 写入与清除、登录后的令牌签发都收口在这里。
 * 过去 routes/sso.ts、routes/oauthClient.ts、routes/auth.ts 各自维护了一份。
 */
import crypto from 'crypto'
import jwt from 'jsonwebtoken'
import { Response } from 'express'
import { memoryStore } from '../store'
import { getJwtSecret } from '../config/secrets'
import { getSessionTtlMs, getSsoCookieOptions, getSettings } from './settings'
import { getAvatarUrl } from '../utils/avatar'

export interface SSOSession {
  id: string
  userId: string
  username: string
  email: string
  role: string
  createdAt: number
  expiresAt: number
  userAgent?: string
  ip?: string
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

export interface SessionClientContext {
  userAgent?: string
  ip?: string
}

interface RequestClientLike {
  headers: Record<string, string | string[] | undefined>
  ip?: string
  socket?: { remoteAddress?: string }
}

export function extractSessionClientContext(req: RequestClientLike): SessionClientContext {
  const ua = req.headers['user-agent']
  return {
    userAgent: Array.isArray(ua) ? ua[0] : ua,
    ip: req.ip || req.socket?.remoteAddress
  }
}

const SESSION_JWT_EXPIRES_IN = '7d'

function getSessionKey(sessionId: string): string {
  return `sso:session:${sessionId}`
}

function generateSessionId(): string {
  return crypto.randomBytes(32).toString('hex')
}

export async function createSSOSession(
  user: { id: string; username: string; email: string; role: string },
  context: SessionClientContext = {}
): Promise<string> {
  const sessionId = generateSessionId()
  const ttlMs = getSessionTtlMs()
  const session: SSOSession = {
    id: sessionId,
    userId: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    createdAt: Date.now(),
    expiresAt: Date.now() + ttlMs,
    userAgent: context.userAgent,
    ip: context.ip
  }

  await memoryStore.set(getSessionKey(sessionId), JSON.stringify(session), ttlMs)
  return sessionId
}

/** 读取会话；已过期（即使存储层还没清理）会顺手删除并返回 null */
export async function getSSOSession(sessionId: string): Promise<SSOSession | null> {
  const data = await memoryStore.get(getSessionKey(sessionId))
  if (!data) return null

  let session: SSOSession
  try {
    session = JSON.parse(data) as SSOSession
  } catch {
    return null
  }
  if (session.expiresAt < Date.now()) {
    await revokeSSOSession(sessionId)
    return null
  }
  return session
}

async function revokeSSOSession(sessionId: string): Promise<void> {
  await memoryStore.delete(getSessionKey(sessionId))
}

export function signSessionToken(sessionId: string): string {
  return jwt.sign({ sessionId }, getJwtSecret(), { expiresIn: SESSION_JWT_EXPIRES_IN })
}

/** 校验 Cookie / Bearer 中的会话令牌；无效返回 null */
export function verifySessionToken(token: string): { sessionId: string } | null {
  try {
    const decoded = jwt.verify(token, getJwtSecret()) as { sessionId?: string }
    return decoded?.sessionId ? { sessionId: decoded.sessionId } : null
  } catch {
    return null
  }
}

/** 按令牌吊销会话（令牌无效时静默忽略） */
export async function revokeSessionByToken(token: string): Promise<void> {
  const decoded = verifySessionToken(token)
  if (decoded) await revokeSSOSession(decoded.sessionId)
}

export function setSSOCookie(res: Response, token: string): void {
  res.cookie(getSettings().ssoCookieName, token, {
    ...getSsoCookieOptions(),
    maxAge: getSessionTtlMs()
  })
}

export function clearSSOCookie(res: Response): void {
  res.clearCookie(getSettings().ssoCookieName, getSsoCookieOptions())
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

/** 登录成功后的统一出口：签发 API Token、创建 SSO 会话并写入 Cookie */
export async function issueAuthSession(res: Response, user: AuthUserRecord, context: SessionClientContext = {}) {
  const token = jwt.sign({ userId: user.id }, getJwtSecret(), { expiresIn: SESSION_JWT_EXPIRES_IN })
  const sessionId = await createSSOSession(user, context)
  setSSOCookie(res, signSessionToken(sessionId))

  return {
    token,
    user: formatAuthUser(user)
  }
}
