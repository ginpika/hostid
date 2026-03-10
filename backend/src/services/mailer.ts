import nodemailer from 'nodemailer'
import fs from 'fs'
import path from 'path'

const MAIL_DOMAIN = process.env.MAIL_DOMAIN || 'localhost'
const SMTP_HOST = process.env.SMTP_HOST
const SMTP_PORT = parseInt(process.env.SMTP_OUT_PORT || '25')
const SMTP_USER = process.env.SMTP_USER
const SMTP_PASS = process.env.SMTP_PASS

interface SendEmailOptions {
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

interface SendResult {
  success: boolean
  messageId?: string
  error?: string
  recipient: string
}

async function resolveMxRecords(domain: string): Promise<string[]> {
  const dns = await import('dns').then(m => m.promises)
  
  try {
    const records = await dns.resolveMx(domain)
    return records
      .sort((a, b) => a.priority - b.priority)
      .map(r => r.exchange)
  } catch {
    return []
  }
}

export async function sendEmail(options: SendEmailOptions): Promise<SendResult[]> {
  const results: SendResult[] = []
  
  const fromAddress = options.fromName 
    ? `${options.fromName} <${options.from}>`
    : options.from

  const allRecipients = [
    ...options.to.map(email => ({ email, type: 'to' as const })),
    ...(options.cc || []).map(email => ({ email, type: 'cc' as const })),
    ...(options.bcc || []).map(email => ({ email, type: 'bcc' as const }))
  ]

  for (const recipient of allRecipients) {
    const domain = recipient.email.split('@')[1]?.toLowerCase()
    
    if (!domain) {
      results.push({
        success: false,
        error: 'Invalid email address',
        recipient: recipient.email
      })
      continue
    }

    const isLocalDomain = domain === MAIL_DOMAIN.toLowerCase()
    
    try {
      let transporter: nodemailer.Transporter
      
      if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
        transporter = nodemailer.createTransport({
          host: SMTP_HOST,
          port: SMTP_PORT,
          secure: SMTP_PORT === 465,
          auth: {
            user: SMTP_USER,
            pass: SMTP_PASS
          }
        })
      } else if (isLocalDomain) {
        transporter = nodemailer.createTransport({
          streamTransport: true,
          newline: 'unix'
        })
      } else {
        const mxRecords = await resolveMxRecords(domain)
        
        if (mxRecords.length === 0) {
          results.push({
            success: false,
            error: 'No MX records found for domain',
            recipient: recipient.email
          })
          continue
        }

        transporter = nodemailer.createTransport({
          host: mxRecords[0],
          port: 25,
          secure: false,
          tls: {
            rejectUnauthorized: false
          }
        })
      }

      const mailOptions: nodemailer.SendMailOptions = {
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
        }
      }

      if (options.attachments && options.attachments.length > 0) {
        mailOptions.attachments = options.attachments
          .filter(att => fs.existsSync(att.path))
          .map(att => ({
            filename: att.filename,
            path: att.path,
            contentType: att.contentType
          }))
      }

      const info = await transporter.sendMail(mailOptions)
      
      results.push({
        success: true,
        messageId: info.messageId,
        recipient: recipient.email
      })
      
      console.log(`[MAIL] Sent to ${recipient.email}: ${info.messageId}`)
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      results.push({
        success: false,
        error: errorMessage,
        recipient: recipient.email
      })
      console.error(`[MAIL] Failed to send to ${recipient.email}:`, errorMessage)
    }
  }

  return results
}

export async function verifySmtpConnection(): Promise<boolean> {
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    console.log('[MAIL] No SMTP relay configured, will use direct delivery')
    return false
  }

  try {
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASS
      }
    })

    await transporter.verify()
    console.log(`[MAIL] SMTP relay connected: ${SMTP_HOST}:${SMTP_PORT}`)
    return true
  } catch (error) {
    console.error('[MAIL] SMTP relay connection failed:', error)
    return false
  }
}
