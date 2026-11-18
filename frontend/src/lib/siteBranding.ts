/**
 * 站点品牌配置解析与网页标题/图标同步工具
 * 优先从 window.__ENV__（/config.js）读取，并与后端 /api/auth/site 返回结果保持一致
 */

export const DEFAULT_SITE_NAME = 'HostID'
export const DEFAULT_SITE_SLOGAN = 'Ginpika`s Meil Service'
export const DEFAULT_SITE_ICON_URL = '/logo-stylized.png'
export const DEFAULT_FAVICON_URL = '/favicon-stylized.png'

export interface SiteBranding {
  siteName: string
  siteSlogan: string
  siteIconUrl: string
}

export interface RawSiteBranding {
  siteName?: string | null
  siteSlogan?: string | null
  siteIconUrl?: string | null
}

export interface RuntimeBrandingEnv {
  SITE_NAME?: string
  SITE_SLOGAN?: string
  SITE_ICON_URL?: string
}

function normalizeSiteIconUrl(raw?: string | null): string {
  if (typeof raw !== 'string') return ''
  const trimmed = raw.trim()
  if (!trimmed) return ''
  if (trimmed.startsWith('/') || trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed
  }
  return ''
}

/** 解析站点名称、Slogan 与图标；siteName 留空时回退到默认值，siteSlogan 显式为空字符串时保持隐藏 */
export function resolveSiteBranding(raw?: RawSiteBranding | null): SiteBranding {
  const siteName = typeof raw?.siteName === 'string' ? raw.siteName.trim() : ''
  const hasSlogan = typeof raw?.siteSlogan === 'string'
  return {
    siteName: siteName || DEFAULT_SITE_NAME,
    siteSlogan: hasSlogan ? raw!.siteSlogan!.trim() : DEFAULT_SITE_SLOGAN,
    siteIconUrl: normalizeSiteIconUrl(raw?.siteIconUrl)
  }
}

/** 从 /config.js 注入的运行环境读取初始站点品牌配置 */
export function readInitialSiteBranding(env?: RuntimeBrandingEnv | null): SiteBranding {
  if (!env) {
    return {
      siteName: DEFAULT_SITE_NAME,
      siteSlogan: DEFAULT_SITE_SLOGAN,
      siteIconUrl: ''
    }
  }
  return resolveSiteBranding({
    siteName: env.SITE_NAME,
    siteSlogan: env.SITE_SLOGAN,
    siteIconUrl: env.SITE_ICON_URL
  })
}

/** 将站点名称同步到浏览器标签页标题 */
export function applyDocumentTitle(
  siteName: string,
  doc: { title: string } | undefined = typeof document !== 'undefined' ? document : undefined
): void {
  if (!doc) return
  doc.title = siteName.trim() || DEFAULT_SITE_NAME
}

export interface FaviconLinkLike {
  rel: string
  href: string
  type?: string
  sizes?: unknown
  setAttribute?: (name: string, value: string) => void
  removeAttribute?: (name: string) => void
}

export interface FaviconDocumentLike {
  head?: { appendChild: (node: FaviconLinkLike) => unknown } | null
  querySelector?: (selector: string) => FaviconLinkLike | null
  createElement?: (tagName: string) => FaviconLinkLike
}

/** 将站点图标同步到浏览器标签页 Favicon；留空时恢复默认图标 */
export function applyDocumentIcon(
  siteIconUrl: string,
  doc: FaviconDocumentLike | undefined = typeof document !== 'undefined' ? (document as unknown as FaviconDocumentLike) : undefined
): void {
  if (!doc?.querySelector) return
  let link = doc.querySelector('link[rel="icon"]') || doc.querySelector('link[rel~="icon"]')
  if (!link && doc.createElement && doc.head) {
    link = doc.createElement('link')
    link.rel = 'icon'
    doc.head.appendChild(link)
  }
  if (!link) return

  const customUrl = normalizeSiteIconUrl(siteIconUrl)
  if (customUrl) {
    link.removeAttribute?.('type')
    link.removeAttribute?.('sizes')
    if (link.setAttribute) {
      link.setAttribute('href', customUrl)
    } else {
      link.href = customUrl
    }
    return
  }

  if (link.setAttribute) {
    link.setAttribute('type', 'image/png')
    link.setAttribute('sizes', '64x64')
    link.setAttribute('href', DEFAULT_FAVICON_URL)
  } else {
    link.type = 'image/png'
    link.href = DEFAULT_FAVICON_URL
  }
}
