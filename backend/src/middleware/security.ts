/**
 * 安全中间件：CORS 白名单 + helmet 安全响应头（含 CSP）
 */
import cors from 'cors'
import helmet from 'helmet'

/** 允许的跨域来源：FRONTEND_URL 与 CORS_ALLOWED_ORIGINS，均可用逗号分隔 */
export function getAllowedOrigins(): string[] {
  return [process.env.FRONTEND_URL, process.env.CORS_ALLOWED_ORIGINS]
    .filter(Boolean)
    .flatMap(value => value!.split(','))
    .map(origin => origin.trim().replace(/\/$/, ''))
    .filter(Boolean)
}

export function createCorsMiddleware() {
  const allowed = new Set(getAllowedOrigins())
  if (allowed.size === 0) {
    console.warn('[Security] FRONTEND_URL is not set; cross-origin requests are rejected (same-origin only).')
  }
  return cors({
    credentials: true,
    origin(origin, callback) {
      // 无 Origin（同源导航、服务端到服务端调用，如 OAuth token 端点）直接放行
      if (!origin) return callback(null, true)
      callback(null, allowed.has(origin.replace(/\/$/, '')))
    }
  })
}

/**
 * CSP 需要兼容：
 * - SPA 自身脚本 + /config.js，Cloudflare Turnstile（脚本 + iframe）
 * - Google Fonts 样式/字体，富文本与邮件内联样式
 * - 邮件 iframe（srcdoc 继承本页 CSP）里的远程图片、外部头像（GitHub 等）
 */
export function createHelmetMiddleware() {
  return helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'", 'https://challenges.cloudflare.com'],
        scriptSrcAttr: ["'none'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'blob:', 'https:', 'http:'],
        mediaSrc: ["'self'", 'data:', 'blob:', 'https:'],
        connectSrc: ["'self'", 'https://challenges.cloudflare.com'],
        frameSrc: ["'self'", 'https://challenges.cloudflare.com'],
        frameAncestors: ["'self'"],
        formAction: ["'self'"],
        workerSrc: ["'self'", 'blob:']
      }
    },
    // 邮件 iframe 需要加载第三方图片，不能启用 COEP
    crossOriginEmbedderPolicy: false,
    // 头像/附件可能被其他子域（SSO 站点）引用
    crossOriginResourcePolicy: { policy: 'same-site' },
    // OAuth / Turnstile 弹窗需要 opener
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
  })
}
