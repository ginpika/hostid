/**
 * SMTP 接收服务器
 * 接收外部邮件并存储到本地用户邮箱
 * 使用 mailparser 解析邮件内容
 */
import { SMTPServer } from 'smtp-server'
import { simpleParser } from 'mailparser'
import { prisma } from '../lib/prisma'
import { generateSummary } from '../services/ai'
import fs from 'fs'
import path from 'path'

const MAIL_DOMAIN = process.env.MAIL_DOMAIN || 'localhost'
const UPLOAD_DIR = path.join(process.cwd(), 'uploads')

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true })
}

export function createSMTPServer() {
  const server = new SMTPServer({
    authOptional: true,
    disabledCommands: ['STARTTLS'],
    banner: `ESMTP ${MAIL_DOMAIN}`,
    
    onRcptTo: async (address, session, callback) => {
      const email = address.address.toLowerCase()
      console.log(`[SMTP] RCPT TO: ${email}`)
      
      const user = await prisma.user.findUnique({
        where: { email }
      })
      
      if (!user) {
        console.log(`[SMTP] User not found: ${email}`)
        return callback(new Error('User not found'))
      }
      
      callback()
    },
    
    onData: async (stream, session, callback) => {
      try {
        const parsed = await simpleParser(stream)
        
        const recipients = session.envelope.rcptTo
          .map(r => r.address.toLowerCase())
        
        console.log(`[SMTP] Received email from: ${parsed.from?.text}`)
        console.log(`[SMTP] To: ${recipients.join(', ')}`)
        console.log(`[SMTP] Subject: ${parsed.subject}`)
        console.log(`[SMTP] Attachments: ${parsed.attachments?.length || 0}`)
        
        const attachmentRecords = []
        
        if (parsed.attachments && parsed.attachments.length > 0) {
          for (const att of parsed.attachments) {
            const filename = `${Date.now()}-${Math.random().toString(36).substring(7)}-${att.filename || 'attachment'}`
            const filePath = path.join(UPLOAD_DIR, filename)
            
            fs.writeFileSync(filePath, att.content)
            
            const attachment = await prisma.attachment.create({
              data: {
                filename,
                originalName: att.filename || 'attachment',
                mimeType: att.contentType || 'application/octet-stream',
                size: att.size,
                path: filePath
              }
            })
            
            attachmentRecords.push(attachment)
            console.log(`[SMTP] Saved attachment: ${att.filename}`)
          }
        }
        
        const fromObj = parsed.from ? (Array.isArray(parsed.from) ? parsed.from[0] : parsed.from) : null
        const fromAddress = fromObj?.value?.[0]?.address || fromObj?.text || 'unknown@unknown'
        const fromName = fromObj?.value?.[0]?.name || null
        
        const headerToList = parsed.to ? (Array.isArray(parsed.to) ? parsed.to : [parsed.to]).flatMap((v: any) => v.value?.map((a: any) => a.address?.toLowerCase()) || []) : []
        const headerCcList = parsed.cc ? (Array.isArray(parsed.cc) ? parsed.cc : [parsed.cc]).flatMap((v: any) => v.value?.map((a: any) => a.address?.toLowerCase()) || []) : []
        const headerBccList = parsed.bcc ? (Array.isArray(parsed.bcc) ? parsed.bcc : [parsed.bcc]).flatMap((v: any) => v.value?.map((a: any) => a.address?.toLowerCase()) || []) : []
        
        for (const recipientEmail of recipients) {
          const user = await prisma.user.findUnique({
            where: { email: recipientEmail }
          })
          
          if (!user) continue
          
          let toList = headerToList
          let ccList = headerCcList
          let bccList = [...headerBccList]
          
          const isInTo = headerToList.includes(recipientEmail)
          const isInCc = headerCcList.includes(recipientEmail)
          const isInBcc = headerBccList.includes(recipientEmail)
          
          if (!isInTo && !isInCc && !isInBcc) {
            bccList.push(recipientEmail)
          }
          
          const displayTo = toList.length > 0 ? toList.join(', ') : (ccList.length > 0 ? ccList[0] : recipientEmail)
          
          const body = parsed.text || parsed.html || ''
          const summary = await generateSummary(body)
          
          await prisma.email.create({
            data: {
              from: fromAddress,
              fromName,
              to: displayTo,
              toList: JSON.stringify(toList),
              ccList: JSON.stringify(ccList),
              bccList: JSON.stringify(bccList),
              subject: parsed.subject || '(No Subject)',
              body: parsed.html || parsed.text || '',
              summary,
              folder: 'INBOX',
              isRead: false,
              userId: user.id,
              attachments: {
                create: attachmentRecords.map(att => ({
                  attachmentId: att.id
                }))
              }
            }
          })
          
          console.log(`[SMTP] Email saved for user: ${recipientEmail}`)
        }
        
        callback()
      } catch (error) {
        console.error('[SMTP] Error processing email:', error)
        callback(new Error('Error processing email'))
      }
    },
    
    onAuth: (auth, session, callback) => {
      callback(null, { user: auth.username })
    }
  })
  
  server.on('error', (err) => {
    console.error('[SMTP] Server error:', err)
  })
  
  return server
}

export function startSMTPServer(port = 25) {
  const server = createSMTPServer()
  
  server.listen(port, () => {
    console.log(`[SMTP] Server listening on port ${port}`)
  })
  
  return server
}
