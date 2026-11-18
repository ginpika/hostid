import express, { type Express } from 'express'
import { statSync } from 'node:fs'
import path from 'node:path'

// Only the full image mounts the web frontend. The standalone API stays unchanged.
const SITE_KEY_RE = /^[a-zA-Z0-9_-]*$/

export interface RuntimeSiteBranding {
  siteName: string
  siteSlogan: string
  siteIconUrl?: string
}

/** 前端运行时配置脚本；site key 与站点品牌可为固定值或每次请求读取的 getter（来自系统设置） */
export function serveConfigScript(
  app: Express,
  turnstileSiteKey: string | (() => string) = '',
  siteBranding?: () => RuntimeSiteBranding,
) {
  if (typeof turnstileSiteKey === 'string' && !SITE_KEY_RE.test(turnstileSiteKey)) {
    throw new Error('Invalid Turnstile site key')
  }
  app.get('/config.js', (_req, res) => {
    const raw = typeof turnstileSiteKey === 'function' ? turnstileSiteKey() : turnstileSiteKey
    const siteKey = SITE_KEY_RE.test(raw) ? raw : ''
    const env: Record<string, string> = { CF_TURNSTILE_SITE_KEY: siteKey }
    if (siteBranding) {
      const branding = siteBranding()
      env.SITE_NAME = branding.siteName
      env.SITE_SLOGAN = branding.siteSlogan
      env.SITE_ICON_URL = branding.siteIconUrl ?? ''
    }
    res.set('Cache-Control', 'no-store')
    res.type('application/javascript').send(
      `window.__ENV__ = ${JSON.stringify(env)};\n`,
    )
  })
}

export function mountWebFrontend(app: Express, directory: string, turnstileSiteKey: string | (() => string) = '', options: { serveConfig?: boolean } = {}) {
  const root = path.resolve(directory)
  const index = path.join(root, 'index.html')
  if (!statSync(index).isFile()) throw new Error('Frontend index.html is missing')
  if (options.serveConfig !== false) serveConfigScript(app, turnstileSiteKey)

  // Missing API endpoints must never become successful HTML responses.
  app.use(['/api', '/attachments'], (_req, res) => {
    res.status(404).json({ error: 'Not found' })
  })

  app.use(express.static(root, {
    index: false,
    redirect: false,
    dotfiles: 'ignore',
    setHeaders(res, filename) {
      res.setHeader('Cache-Control', filename.startsWith(`${root}${path.sep}assets${path.sep}`)
        ? 'public, max-age=31536000, immutable'
        : 'no-cache')
    },
  }))

  app.get('*', (req, res, next) => {
    // Only page navigation falls back to the SPA; missing files remain 404s.
    if (req.path === '/assets' || req.path.startsWith('/assets/') || /(^|\/)\./.test(req.path)
      || path.extname(req.path) || !req.accepts('html')) {
      next()
      return
    }
    res.set('Cache-Control', 'no-cache')
    res.sendFile(index)
  })
}
