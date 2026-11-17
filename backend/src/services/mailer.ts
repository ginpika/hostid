/**
 * 外部邮件发送服务
 * 使用 nodemailer 发送邮件到外部邮箱；传输方式由有序的“规划器”决定：
 *   1. SMTP 中继（配置了 relay host/user/pass）
 *   2. 本站域名（流式传输，不真正外发）
 *   3. 直连收件域名的 MX
 * 同一次发送内，相同的传输通道只创建一个 Transporter，不再每个收件人重建一次。
 */
import nodemailer from 'nodemailer'
import fs from 'node:fs/promises'
import dns from 'node:dns/promises'
import { getSettings, type Settings } from './settings'

export interface SendEmailOptions {
  from: string
  fromName?: string | null
  to: string[]
  cc?: string[]
  bcc?: string[]
  subject: string
  html: string
  text?: string
  attachments?: {
    filename: string
    path: string
    contentType?: string
  }[]
}

export interface SendResult {
  success: boolean
  messageId?: string
  error?: string
  recipient: string
}

/** 一种传输通道：key 相同的通道复用同一个 Transporter */
interface TransportPlan {
  key: string
  create: () => nodemailer.Transporter
}

/** 返回 null 表示本规划器不适用，交给下一个 */
type TransportPlanner = (domain: string, settings: Settings) => Promise<TransportPlan | null>

const planSmtpRelay: TransportPlanner = async (_domain, s) => {
  if (!s.smtpRelayHost || !s.smtpRelayUser || !s.smtpRelayPass) return null
  return {
    key: 'relay',
    create: () => nodemailer.createTransport({
      host: s.smtpRelayHost,
      port: s.smtpRelayPort,
      secure: s.smtpRelayPort === 465,
      auth: { user: s.smtpRelayUser, pass: s.smtpRelayPass }
    })
  }
}

const planLocalDomain: TransportPlanner = async (domain, s) => {
  if (domain !== s.mailDomain.toLowerCase()) return null
  return {
    key: 'local',
    create: () => nodemailer.createTransport({ streamTransport: true, newline: 'unix' })
  }
}

async function resolveMxHosts(domain: string): Promise<string[]> {
  try {
    const records = await dns.resolveMx(domain)
    return records.sort((a, b) => a.priority - b.priority).map(r => r.exchange)
  } catch {
    return []
  }
}

const planDirectMx: TransportPlanner = async domain => {
  const [host] = await resolveMxHosts(domain)
  if (!host) throw new Error('No MX records found for domain')
  return {
    key: `mx:${host}`,
    create: () => nodemailer.createTransport({
      host,
      port: 25,
      secure: false,
      // 许多自建/老旧 MX 使用自签名证书；这里为了可达性放宽校验，机会性加密（非强制 TLS）
      tls: { rejectUnauthorized: false }
    })
  }
}

const TRANSPORT_PLANNERS: TransportPlanner[] = [planSmtpRelay, planLocalDomain, planDirectMx]

async function planTransport(domain: string, settings: Settings): Promise<TransportPlan> {
  for (const planner of TRANSPORT_PLANNERS) {
    const plan = await planner(domain, settings)
    if (plan) return plan
  }
  throw new Error('No transport available')
}

export async function sendEmail(options: SendEmailOptions): Promise<SendResult[]> {
  const results: SendResult[] = []
  const settings = getSettings()

  const fromAddress = options.fromName
    ? `${options.fromName} <${options.from}>`
    : options.from

  const allRecipients = [
    ...options.to.map(email => ({ email, type: 'to' as const })),
    ...(options.cc || []).map(email => ({ email, type: 'cc' as const })),
    ...(options.bcc || []).map(email => ({ email, type: 'bcc' as const }))
  ]

  const attachments = (
    await Promise.all(
      (options.attachments ?? []).map(async att => {
        try {
          await fs.access(att.path)
          return { filename: att.filename, path: att.path, contentType: att.contentType }
        } catch {
          return null
        }
      })
    )
  ).filter((att): att is NonNullable<typeof att> => att !== null)

  const plansByDomain = new Map<string, TransportPlan>()
  const transporters = new Map<string, nodemailer.Transporter>()

  for (const recipient of allRecipients) {
    const domain = recipient.email.split('@')[1]?.toLowerCase()

    if (!domain) {
      results.push({ success: false, error: 'Invalid email address', recipient: recipient.email })
      continue
    }

    try {
      let plan = plansByDomain.get(domain)
      if (!plan) {
        plan = await planTransport(domain, settings)
        plansByDomain.set(domain, plan)
      }
      let transporter = transporters.get(plan.key)
      if (!transporter) {
        transporter = plan.create()
        transporters.set(plan.key, transporter)
      }

      const info = await transporter.sendMail({
        from: fromAddress,
        to: recipient.type === 'to' ? recipient.email : undefined,
        cc: recipient.type === 'cc' ? recipient.email : undefined,
        bcc: recipient.type === 'bcc' ? recipient.email : undefined,
        subject: options.subject,
        html: options.html,
        text: options.text,
        headers: {
          'X-Mailer': 'HostID',
          'X-Priority': '3'
        },
        ...(attachments.length > 0 ? { attachments } : {})
      })

      results.push({ success: true, messageId: info.messageId, recipient: recipient.email })
      console.log(`[MAIL] Sent to ${recipient.email}: ${info.messageId}`)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      results.push({ success: false, error: errorMessage, recipient: recipient.email })
      console.error(`[MAIL] Failed to send to ${recipient.email}:`, errorMessage)
    }
  }

  for (const transporter of transporters.values()) {
    transporter.close()
  }

  return results
}
