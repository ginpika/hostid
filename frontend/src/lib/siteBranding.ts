/**
 * 站点品牌配置解析与网页标题同步工具
 * 优先从 window.__ENV__（/config.js）读取，并与后端 /api/auth/site 返回结果保持一致
 */

export const DEFAULT_SITE_NAME = 'HostID'
export const DEFAULT_SITE_SLOGAN = 'MAIL WORKSPACE'

export interface SiteBranding {
  siteName: string
  siteSlogan: string
}

export interface RawSiteBranding {
  siteName?: string | null
  siteSlogan?: string | null
}

export interface RuntimeBrandingEnv {
  SITE_NAME?: string
  SITE_SLOGAN?: string
}

/** 解析站点名称与 Slogan；siteName 留空时回退到默认值，siteSlogan 显式为空字符串时保持隐藏 */
export function resolveSiteBranding(raw?: RawSiteBranding | null): SiteBranding {
  const siteName = typeof raw?.siteName === 'string' ? raw.siteName.trim() : ''
  const hasSlogan = typeof raw?.siteSlogan === 'string'
  return {
    siteName: siteName || DEFAULT_SITE_NAME,
    siteSlogan: hasSlogan ? raw!.siteSlogan!.trim() : DEFAULT_SITE_SLOGAN
  }
}

/** 从 /config.js 注入的运行环境读取初始站点品牌配置 */
export function readInitialSiteBranding(env?: RuntimeBrandingEnv | null): SiteBranding {
  if (!env) {
    return { siteName: DEFAULT_SITE_NAME, siteSlogan: DEFAULT_SITE_SLOGAN }
  }
  return resolveSiteBranding({
    siteName: env.SITE_NAME,
    siteSlogan: env.SITE_SLOGAN
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
