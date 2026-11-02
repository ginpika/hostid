/**
 * 融合邮件 IMAP 同步
 * 使用 imapflow + XOAUTH2 登录，只同步 INBOX
 * 增量：按 UIDVALIDITY + UID，UIDVALIDITY 变化时清空该账号本地缓存重新拉取
 * 单个账号失败不影响其他账号
 */
import { ImapFlow } from 'imapflow'
import { simpleParser, type AddressObject, type ParsedMail } from 'mailparser'
import { prisma } from '../../lib/prisma'
import { PLATFORMS, isMailPlatform } from './platforms'
import { ACCOUNT_STATUS, FusedMailAuthError, getValidAccessToken, markAccountReauthRequired, refreshAccountToken } from './tokenStore'

const INITIAL_SYNC_LIMIT = parseInt(process.env.FUSED_MAIL_INITIAL_SYNC_LIMIT || '200', 10)
const BATCH_LIMIT = 500

export interface SyncResult {
  accountId: string
  ok: boolean
  added: number
  error?: string
}

function addressList(value: AddressObject | AddressObject[] | undefined): string[] {
  if (!value) return []
  const objects = Array.isArray(value) ? value : [value]
  return objects.flatMap(object => object.value.map(entry => entry.address?.toLowerCase()).filter((address): address is string => !!address))
}

export function parsedMailToRecord(parsed: ParsedMail, fallbackDate?: Date) {
  const sender = parsed.from?.value[0]
  const toList = addressList(parsed.to)
  const body = parsed.html || parsed.textAsHtml || parsed.text || ''
  return {
    messageId: parsed.messageId || null,
    from: sender?.address?.toLowerCase() || 'unknown',
    fromName: sender?.name || null,
    to: toList[0] || '',
    toList: JSON.stringify(toList),
    ccList: JSON.stringify(addressList(parsed.cc)),
    subject: parsed.subject || '',
    body,
    summary: (parsed.text || '').replace(/\s+/g, ' ').trim().slice(0, 200) || null,
    createdAt: parsed.date || fallbackDate || new Date()
  }
}

/** 根据已同步的最后 UID 和邮箱的 uidNext 计算本次需要拉取的 UID 范围 */
export function computeFetchRange(lastUid: number, uidNext: number | undefined, initialLimit = INITIAL_SYNC_LIMIT): string | null {
  if (uidNext !== undefined && uidNext <= lastUid + 1) return null
  if (lastUid > 0) return `${lastUid + 1}:*`
  const start = uidNext ? Math.max(1, uidNext - initialLimit) : 1
  return `${start}:*`
}

function isAuthFailure(error: unknown): boolean {
  const record = error as { authenticationFailed?: boolean; responseText?: string; serverResponseCode?: string } | null
  return !!record && (record.authenticationFailed === true || record.serverResponseCode === 'AUTHENTICATIONFAILED' || /AUTHENTICATE|invalid credentials/i.test(record.responseText || ''))
}

async function openClient(account: { id: string; email: string; platform: string }, accessToken: string) {
  if (!isMailPlatform(account.platform)) throw new Error(`Unsupported platform ${account.platform}`)
  const { host, port } = PLATFORMS[account.platform].imap
  const client = new ImapFlow({ host, port, secure: true, auth: { user: account.email, accessToken }, logger: false })
  await client.connect()
  return client
}

export async function syncAccount(accountId: string): Promise<SyncResult> {
  const account = await prisma.fusedMailAccount.findUnique({ where: { id: accountId } })
  if (!account) return { accountId, ok: false, added: 0, error: 'not-found' }
  if (account.status === ACCOUNT_STATUS.REAUTH_REQUIRED) return { accountId, ok: false, added: 0, error: 'reauth_required' }
  let client: ImapFlow | null = null
  try {
    let accessToken = await getValidAccessToken(account.id)
    try {
      client = await openClient(account, accessToken)
    } catch (error) {
      if (!isAuthFailure(error)) throw error
      // access token 可能被提前吊销：强制刷新一次再试
      accessToken = await refreshAccountToken(account.id)
      client = await openClient(account, accessToken)
    }
    const lock = await client.getMailboxLock('INBOX')
    let added = 0
    try {
      const mailbox = client.mailbox
      if (!mailbox) throw new Error('INBOX is not available')
      const uidValidity = String(mailbox.uidValidity)
      let lastUid = account.lastUid
      if (account.uidValidity && account.uidValidity !== uidValidity) {
        // UIDVALIDITY 变化：旧 UID 全部失效
        await prisma.fusedEmail.deleteMany({ where: { accountId: account.id } })
        lastUid = 0
      }
      const range = computeFetchRange(lastUid, mailbox.uidNext)
      let maxUid = lastUid
      if (range) {
        for await (const message of client.fetch(range, { uid: true, flags: true, source: true, internalDate: true }, { uid: true })) {
          if (message.uid <= lastUid || !message.source) continue
          const parsed = await simpleParser(message.source)
          const internalDate = message.internalDate ? new Date(message.internalDate) : undefined
          const record = parsedMailToRecord(parsed, internalDate)
          try {
            await prisma.fusedEmail.create({
              data: {
                ...record,
                accountId: account.id,
                uidValidity,
                uid: message.uid,
                isRead: message.flags?.has('\\Seen') ?? false,
                isStarred: message.flags?.has('\\Flagged') ?? false
              }
            })
            added++
          } catch (error) {
            if ((error as { code?: string }).code !== 'P2002') throw error
          }
          maxUid = Math.max(maxUid, message.uid)
          if (added >= BATCH_LIMIT) break
        }
      }
      await prisma.fusedMailAccount.update({
        where: { id: account.id },
        data: { uidValidity, lastUid: maxUid, lastSyncedAt: new Date(), lastError: null, status: ACCOUNT_STATUS.ACTIVE }
      })
    } finally {
      lock.release()
    }
    return { accountId, ok: true, added }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (error instanceof FusedMailAuthError && error.reauth) {
      // tokenStore 已经标记过
    } else if (isAuthFailure(error)) {
      await markAccountReauthRequired(account.id, `IMAP authentication failed: ${message}`)
    } else {
      await prisma.fusedMailAccount.update({ where: { id: account.id }, data: { lastError: message.slice(0, 500) } }).catch(() => undefined)
    }
    return { accountId, ok: false, added: 0, error: message }
  } finally {
    if (client) await client.logout().catch(() => client?.close())
  }
}

const syncing = new Map<string, Promise<SyncResult>>()

/** 同一账号同一时间只跑一个同步 */
export function syncAccountOnce(accountId: string): Promise<SyncResult> {
  const running = syncing.get(accountId)
  if (running) return running
  const task = syncAccount(accountId).finally(() => syncing.delete(accountId))
  syncing.set(accountId, task)
  return task
}

export async function syncAccounts(where: { userId?: string } = {}): Promise<SyncResult[]> {
  const accounts = await prisma.fusedMailAccount.findMany({
    where: { ...where, status: { not: ACCOUNT_STATUS.REAUTH_REQUIRED } },
    select: { id: true }
  })
  const results: SyncResult[] = []
  for (const account of accounts) {
    // 串行执行，单个失败已在 syncAccount 内部捕获
    results.push(await syncAccountOnce(account.id))
  }
  return results
}

let timer: NodeJS.Timeout | null = null

export function startFusedMailScheduler() {
  const minutes = parseFloat(process.env.FUSED_MAIL_SYNC_INTERVAL_MINUTES || '5')
  if (!Number.isFinite(minutes) || minutes <= 0 || timer) return
  timer = setInterval(() => {
    syncAccounts().catch(error => console.error('[FusedMail] scheduled sync failed:', error))
  }, minutes * 60 * 1000)
  timer.unref()
  console.log(`[FusedMail] polling every ${minutes} minute(s)`)
}
