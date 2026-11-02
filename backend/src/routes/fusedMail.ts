/**
 * 融合邮件路由
 * - 融合账号管理：列出可用 provider、发起 OAuth2 授权、回调、移除、手动同步
 * - 融合收件箱：聚合所有融合账号的邮件，接口形状与 /api/emails 保持一致
 * 回调路由与登录回调（/api/oauth/:provider/callback）完全分开，不影响主账号登录
 */
import { Router, Response, Request } from 'express'
import crypto from 'crypto'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { auth, AuthRequest } from '../middleware/auth'
import { AppError, asyncHandler } from '../middleware/error'
import { memoryStore } from '../store'
import { decrypt } from '../services/encryption'
import { getEmailPagination } from '../lib/mail-list-query'
import { buildFusedListWhere, parseFusedListQuery } from '../lib/fused-mail-query'
import { PLATFORMS, buildAuthorizationUrl, emailFromIdToken, isMailPlatform } from '../services/fusedMail/platforms'
import { FusedMailAuthError, getFusedMailCallbackUrl, postTokenRequest, saveAuthorizedAccount } from '../services/fusedMail/tokenStore'
import { AUTO_SYNC_COOLDOWN_MS, syncAccountOnce, syncAccounts } from '../services/fusedMail/sync'
import { sendViaFusedAccount } from '../services/fusedMail/smtp'
import { getSettings, getSiteUrl } from '../services/settings'

const router = Router()

const STATE_TTL = 10 * 60 * 1000
const STATE_COOKIE = 'fused_mail_oauth'
const stateKey = (state: string) => `fusedmail:state:${state}`
const frontendUrl = () => getSiteUrl()

interface FusedOAuthState {
  userId: string
  providerId: string
  accountId?: string
  codeVerifier: string
  browserNonce: string
  createdAt: number
}

export async function getFusedMailProviders() {
  return prisma.oAuthProvider.findMany({
    where: { isActive: true, useForFusedMail: true, mailPlatform: { in: ['gmail', 'outlook'] } },
    orderBy: { createdAt: 'asc' }
  })
}

function redirectResult(res: Response, params: Record<string, string>) {
  res.redirect(`${frontendUrl()}/fused-mail?${new URLSearchParams(params)}`)
}

// ---------- OAuth 回调（无 Bearer，靠 state + 浏览器 cookie 绑定用户） ----------
router.get('/oauth/callback', async (req: Request, res: Response) => {
  const { code, state, error } = req.query as Record<string, string | undefined>
  if (!state) return redirectResult(res, { result: 'error', reason: 'invalid_state' })
  const raw = await memoryStore.get(stateKey(state))
  await memoryStore.delete(stateKey(state))
  if (!raw) return redirectResult(res, { result: 'error', reason: 'invalid_state' })
  const data = JSON.parse(raw) as FusedOAuthState
  res.clearCookie(STATE_COOKIE, { path: '/api/fused-mail/oauth' })
  // CSRF：state 必须由同一个浏览器发起
  const cookieNonce = (req as Request & { cookies?: Record<string, string> }).cookies?.[STATE_COOKIE]
  if (!cookieNonce || cookieNonce.length !== data.browserNonce.length || !crypto.timingSafeEqual(Buffer.from(cookieNonce), Buffer.from(data.browserNonce))) {
    return redirectResult(res, { result: 'error', reason: 'invalid_state' })
  }
  if (error || !code) return redirectResult(res, { result: 'error', reason: error === 'access_denied' ? 'access_denied' : 'oauth_error' })
  try {
    const provider = await prisma.oAuthProvider.findUnique({ where: { id: data.providerId } })
    if (!provider || !provider.isActive || !provider.useForFusedMail || !isMailPlatform(provider.mailPlatform)) {
      return redirectResult(res, { result: 'error', reason: 'provider_unavailable' })
    }
    const platform = provider.mailPlatform
    const tokenResult = await postTokenRequest(provider.tokenUrl || PLATFORMS[platform].defaultTokenUrl, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: getFusedMailCallbackUrl(provider.fusedMailCallbackUrl),
      client_id: provider.clientId,
      client_secret: decrypt(provider.clientSecret),
      code_verifier: data.codeVerifier
    })
    if (!tokenResult.ok) {
      console.error('[FusedMail] token exchange failed:', tokenResult.data.error, tokenResult.data.error_description)
      return redirectResult(res, { result: 'error', reason: 'token_exchange_failed' })
    }
    const email = emailFromIdToken(tokenResult.data.id_token)
    if (!email) return redirectResult(res, { result: 'error', reason: 'email_unavailable' })
    if (data.accountId) {
      const expected = await prisma.fusedMailAccount.findFirst({ where: { id: data.accountId, userId: data.userId } })
      if (expected && (expected.email !== email || expected.platform !== platform)) {
        return redirectResult(res, { result: 'error', reason: 'account_mismatch', expected: expected.email, got: email })
      }
    }
    const { account, created } = await saveAuthorizedAccount({
      userId: data.userId, providerId: provider.id, platform, email, tokens: tokenResult.data
    })
    // 授权成功后在后台拉一次邮件，不阻塞跳转
    void syncAccountOnce(account.id)
    return redirectResult(res, { result: created ? 'added' : 'reauthorized', email })
  } catch (err) {
    console.error('[FusedMail] callback failed:', err)
    const reason = err instanceof FusedMailAuthError && /refresh token/i.test(err.message) ? 'no_refresh_token' : 'oauth_error'
    return redirectResult(res, { result: 'error', reason })
  }
})

router.use(auth)

// ---------- 账号管理 ----------
router.get('/providers', asyncHandler(async (_req: AuthRequest, res: Response) => {
  const providers = await getFusedMailProviders()
  res.json({ providers: providers.map(p => ({ id: p.id, provider: p.provider, displayName: p.displayName, platform: p.mailPlatform })) })
}))

const serializeAccount = (account: { id: string; platform: string; email: string; displayName: string | null; status: string; lastError: string | null; lastSyncedAt: Date | null; createdAt: Date; providerId: string | null }, unread = 0) => ({
  id: account.id,
  platform: account.platform,
  email: account.email,
  displayName: account.displayName,
  status: account.status,
  lastError: account.lastError,
  lastSyncedAt: account.lastSyncedAt,
  createdAt: account.createdAt,
  providerId: account.providerId,
  unread
})

router.get('/accounts', asyncHandler(async (req: AuthRequest, res: Response) => {
  const accounts = await prisma.fusedMailAccount.findMany({ where: { userId: req.userId! }, orderBy: { createdAt: 'asc' } })
  const unread = await prisma.fusedEmail.groupBy({
    by: ['accountId'],
    where: { account: { userId: req.userId! }, isRead: false, folder: 'INBOX' },
    _count: { _all: true }
  })
  const unreadMap = new Map(unread.map(row => [row.accountId, row._count._all]))
  res.json({ accounts: accounts.map(account => serializeAccount(account, unreadMap.get(account.id) || 0)) })
}))

const startSchema = z.object({ providerId: z.string().min(1), accountId: z.string().min(1).optional() })

router.post('/oauth/start', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { providerId, accountId } = startSchema.parse(req.body)
  const provider = await prisma.oAuthProvider.findUnique({ where: { id: providerId } })
  if (!provider || !provider.isActive || !provider.useForFusedMail || !isMailPlatform(provider.mailPlatform)) {
    throw new AppError('This provider is not enabled for fused mail', 400)
  }
  let loginHint: string | undefined
  if (accountId) {
    const account = await prisma.fusedMailAccount.findFirst({ where: { id: accountId, userId: req.userId! } })
    if (!account) throw new AppError('Account not found', 404)
    loginHint = account.email
  }
  const state = crypto.randomBytes(24).toString('hex')
  const codeVerifier = crypto.randomBytes(48).toString('base64url')
  const browserNonce = crypto.randomBytes(24).toString('hex')
  const payload: FusedOAuthState = { userId: req.userId!, providerId, accountId, codeVerifier, browserNonce, createdAt: Date.now() }
  await memoryStore.set(stateKey(state), JSON.stringify(payload), STATE_TTL)
  res.cookie(STATE_COOKIE, browserNonce, {
    httpOnly: true, sameSite: 'lax', secure: getSettings().ssoCookieSecure, path: '/api/fused-mail/oauth', maxAge: STATE_TTL
  })
  const url = buildAuthorizationUrl({
    platform: provider.mailPlatform,
    authorizationUrl: provider.authorizationUrl,
    clientId: provider.clientId,
    redirectUri: getFusedMailCallbackUrl(provider.fusedMailCallbackUrl),
    state,
    codeChallenge: crypto.createHash('sha256').update(codeVerifier).digest('base64url'),
    loginHint
  })
  res.json({ url })
}))

router.delete('/accounts/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const result = await prisma.fusedMailAccount.deleteMany({ where: { id: req.params.id, userId: req.userId! } })
  if (!result.count) throw new AppError('Account not found', 404)
  res.json({ success: true })
}))

router.post('/accounts/:id/sync', asyncHandler(async (req: AuthRequest, res: Response) => {
  const account = await prisma.fusedMailAccount.findFirst({ where: { id: req.params.id, userId: req.userId! } })
  if (!account) throw new AppError('Account not found', 404)
  const result = await syncAccountOnce(account.id)
  const fresh = await prisma.fusedMailAccount.findUniqueOrThrow({ where: { id: account.id } })
  res.json({ result, account: serializeAccount(fresh) })
}))

router.post('/sync', asyncHandler(async (req: AuthRequest, res: Response) => {
  // body.auto=true：进入融合收件箱时的自动同步，带冷却；手动同步不带冷却。同一账号正在同步时复用同一任务
  const auto = req.body?.auto === true
  res.json({ results: await syncAccounts({ userId: req.userId! }, auto ? { cooldownMs: AUTO_SYNC_COOLDOWN_MS } : {}) })
}))

const sendSchema = z.object({ to: z.array(z.string().email()).min(1), cc: z.array(z.string().email()).optional(), subject: z.string(), html: z.string() })

// 实验性：通过融合账号 SMTP 发信（前端暂未接入）
router.post('/accounts/:id/send', asyncHandler(async (req: AuthRequest, res: Response) => {
  const input = sendSchema.parse(req.body)
  try {
    const info = await sendViaFusedAccount(req.userId!, req.params.id, input)
    res.json({ success: true, messageId: info.messageId })
  } catch (error) {
    throw new AppError(error instanceof Error ? error.message : 'Send failed', 502)
  }
}))

// ---------- 融合收件箱 ----------
const accountSummary = { select: { id: true, email: true, platform: true } }

const toClientEmail = <T extends { account: { id: string; email: string; platform: string } }>(email: T) => ({ ...email, attachments: [] })

router.get('/emails', asyncHandler(async (req: AuthRequest, res: Response) => {
  const query = parseFusedListQuery(req.query)
  const where = buildFusedListWhere(req.userId!, query)
  const { emails, pagination } = await prisma.$transaction(async tx => {
    const total = await tx.fusedEmail.count({ where })
    const pagination = getEmailPagination(query.page, query.limit, total)
    const emails = await tx.fusedEmail.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: { account: accountSummary },
      skip: (pagination.page - 1) * pagination.limit,
      take: pagination.limit
    })
    return { emails, pagination }
  })
  res.json({ emails: emails.map(toClientEmail), pagination })
}))

async function findOwnedEmail(userId: string, id: string) {
  const email = await prisma.fusedEmail.findFirst({ where: { id, account: { userId } }, include: { account: accountSummary } })
  if (!email) throw new AppError('Email not found', 404)
  return email
}

router.get('/emails/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const email = await findOwnedEmail(req.userId!, req.params.id)
  if (!email.isRead) await prisma.fusedEmail.update({ where: { id: email.id }, data: { isRead: true } })
  res.json(toClientEmail({ ...email, isRead: true }))
}))

router.get('/emails/:id/export', asyncHandler(async (req: AuthRequest, res: Response) => {
  const email = await findOwnedEmail(req.userId!, req.params.id)
  let toList: string[] = []
  try { toList = JSON.parse(email.toList) } catch { toList = [] }
  const headers = [
    email.fromName ? `From: "${email.fromName}" <${email.from}>` : `From: <${email.from}>`,
    `To: ${toList.length ? toList.join(', ') : email.to}`,
    `Date: ${new Date(email.createdAt).toUTCString()}`,
    `Subject: ${email.subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8'
  ].join('\r\n')
  const filename = `${email.subject.replace(/[\\/:*?"<>|]/g, '_') || 'no-subject'}.eml`
  res.setHeader('Content-Type', 'message/rfc822')
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`)
  res.send(`${headers}\r\n\r\n${email.body}`)
}))

router.patch('/emails/:id/read', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { isRead } = z.object({ isRead: z.boolean() }).parse(req.body)
  const email = await findOwnedEmail(req.userId!, req.params.id)
  await prisma.fusedEmail.update({ where: { id: email.id }, data: { isRead } })
  res.json({ success: true })
}))

router.patch('/emails/:id/star', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { isStarred } = z.object({ isStarred: z.boolean() }).parse(req.body)
  const email = await findOwnedEmail(req.userId!, req.params.id)
  await prisma.fusedEmail.update({ where: { id: email.id }, data: { isStarred } })
  res.json({ success: true })
}))

router.post('/emails/:id/archive', asyncHandler(async (req: AuthRequest, res: Response) => {
  const email = await findOwnedEmail(req.userId!, req.params.id)
  await prisma.fusedEmail.update({ where: { id: email.id }, data: { folder: 'ARCHIVED' } })
  res.json({ success: true })
}))

router.post('/emails/:id/restore', asyncHandler(async (req: AuthRequest, res: Response) => {
  const email = await findOwnedEmail(req.userId!, req.params.id)
  await prisma.fusedEmail.update({ where: { id: email.id }, data: { folder: 'INBOX' } })
  res.json({ success: true })
}))

// 删除只影响本地副本，不会删除远端邮箱里的邮件；本地永久删除后不会被增量同步重新拉回（UID 已越过）
router.delete('/emails/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const email = await findOwnedEmail(req.userId!, req.params.id)
  if (req.query.permanent === 'true') {
    if (email.folder !== 'TRASH') throw new AppError('Only messages in trash can be permanently deleted', 409)
    await prisma.fusedEmail.delete({ where: { id: email.id } })
  } else {
    await prisma.fusedEmail.update({ where: { id: email.id }, data: { folder: 'TRASH' } })
  }
  res.json({ success: true })
}))

export default router
