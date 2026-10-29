import express, { type Express } from 'express'
import { statSync } from 'node:fs'
import path from 'node:path'

// Only the full image mounts the web frontend. The standalone API stays unchanged.
export function mountWebFrontend(app: Express, directory: string, turnstileSiteKey = '') {
  const root = path.resolve(directory)
  const index = path.join(root, 'index.html')
  if (!statSync(index).isFile()) throw new Error('Frontend index.html is missing')
  if (!/^[a-zA-Z0-9_-]*$/.test(turnstileSiteKey)) {
    throw new Error('Invalid Turnstile site key')
  }

  app.get('/config.js', (_req, res) => {
    res.set('Cache-Control', 'no-store')
    res.type('application/javascript').send(
      `window.__ENV__ = ${JSON.stringify({ CF_TURNSTILE_SITE_KEY: turnstileSiteKey })};\n`,
    )
  })

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
