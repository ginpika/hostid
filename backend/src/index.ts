import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import path from 'path'
import cookieParser from 'cookie-parser'
import authRoutes from './routes/auth'
import emailRoutes from './routes/email'
import attachmentRoutes from './routes/attachment'
import adminRoutes from './routes/admin'
import ssoRoutes from './routes/sso'
import { errorHandler } from './middleware/error'
import { startSMTPServer } from './smtp'
import { initAdminUsers } from './utils/initAdmin'
import { initRSAKeys } from './utils/rsa'

dotenv.config()

const app = express()
const PORT = process.env.PORT || 3001
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '2525')
const SSO_LOGIN_PAGE_URL = process.env.SSO_LOGIN_PAGE_URL || ''

app.use(cors({
  origin: true,
  credentials: true
}))
app.use(express.json())
app.use(cookieParser())

app.use('/api/auth', authRoutes)
app.use('/api/emails', emailRoutes)
app.use('/api/attachments', attachmentRoutes)
app.use('/api/admin', adminRoutes)
app.use('/api/sso', ssoRoutes)

app.get('/sso/login', (req, res) => {
  const redirect = req.query.redirect as string || ''
  const frontendLoginUrl = SSO_LOGIN_PAGE_URL 
    ? `${SSO_LOGIN_PAGE_URL}${redirect ? `?redirect=${encodeURIComponent(redirect)}` : ''}`
    : `/login${redirect ? `?redirect=${encodeURIComponent(redirect)}` : ''}`
  res.redirect(frontendLoginUrl)
})

app.get('/health', (req, res) => {
  res.json({ status: 'ok' })
})

app.use(errorHandler)

const startServer = async () => {
  initRSAKeys()
  await initAdminUsers()
  
  app.listen(PORT, () => {
    console.log(`[API] Server running on port ${PORT}`)
  })
  
  startSMTPServer(SMTP_PORT)
}

startServer()
