/**
 * 后端服务入口文件
 * 初始化 Express 服务器、SMTP 服务器和各种路由
 * 包含管理员初始化、RSA 密钥生成和 OAuth 配置迁移
 */
import express from 'express'
import dotenv from 'dotenv'
import cookieParser from 'cookie-parser'
import authRoutes from './routes/auth'
import emailRoutes from './routes/email'
import attachmentRoutes from './routes/attachment'
import adminRoutes from './routes/admin'
import ssoRoutes from './routes/sso'
import oauthClientRoutes from './routes/oauthClient'
import oauthConfigRoutes from './routes/oauthConfig'
import oauthServerRoutes from './routes/oauthServer'
import oauthAppsRoutes from './routes/oauthApps'
import fusedMailRoutes from './routes/fusedMail'
import { errorHandler } from './middleware/error'
import { startSMTPServer } from './smtp'
import setupRoutes from './routes/setup'
import { initRSAKeys } from './utils/rsa'
import { mountWebFrontend, serveConfigScript } from './web'
import { initSettings, getSettings, getSsoLoginPageUrl } from './services/settings'
import { assertSecurityConfig } from './config/secrets'
import { createCorsMiddleware, createHelmetMiddleware } from './middleware/security'

dotenv.config()

const app = express()
const PORT = process.env.PORT || 3001
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '2525')

app.disable('x-powered-by')
app.use(createHelmetMiddleware())
app.use(createCorsMiddleware())
app.use(express.json())
app.use(express.urlencoded({ extended: false }))
app.use(cookieParser())

app.use('/api/setup', setupRoutes)
app.use('/api/auth', authRoutes)
app.use('/api/emails', emailRoutes)
app.use('/api/attachments', attachmentRoutes)
app.use('/api/admin', adminRoutes)
app.use('/api/sso', ssoRoutes)
app.use('/api/oauth', oauthClientRoutes)
app.use('/api/admin/oauth', oauthConfigRoutes)
app.use('/api/oauth2', oauthServerRoutes)
app.use('/api/admin/oauth-apps', oauthAppsRoutes)
app.use('/api/fused-mail', fusedMailRoutes)

app.get('/sso/login', (req, res) => {
  const redirect = req.query.redirect as string || ''
  const frontendLoginUrl = `${getSsoLoginPageUrl()}${redirect ? `?redirect=${encodeURIComponent(redirect)}` : ''}`
  res.redirect(frontendLoginUrl)
})

app.get('/health', (req, res) => {
  res.json({ status: 'ok' })
})

// 前端运行时配置（Turnstile site key 来自系统设置）；分离部署时由 nginx 反代到这里
serveConfigScript(app, () => getSettings().turnstileSiteKey)

if (process.env.HOSTID_WEB_ROOT) {
  mountWebFrontend(app, process.env.HOSTID_WEB_ROOT, '', { serveConfig: false })
}

app.use(errorHandler)

const startServer = async () => {
  try {
    assertSecurityConfig()
  } catch (error) {
    console.error('[Security]', error instanceof Error ? error.message : error)
    process.exit(1)
  }
  initRSAKeys()
  await initSettings()

  app.listen(PORT, () => {
    console.log(`[API] Server running on port ${PORT}`)
  })

  startSMTPServer(SMTP_PORT)
}

startServer()
