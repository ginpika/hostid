/**
 * 融合邮件前端纯函数：平台名称、账号状态与 OAuth 回调结果解析
 */
export type FusedPlatform = 'gmail' | 'outlook'
export type FusedResult = { kind: 'added' | 'reauthorized' | 'error'; reason?: string; expected?: string; got?: string }

export const platformLabel = (platform?: string | null) =>
  platform === 'gmail' ? 'Gmail' : platform === 'outlook' ? 'Outlook / Hotmail' : platform || '—'

export const needsReauth = (status?: string | null) => status === 'reauth_required'

/** 解析 /fused-mail?result=...&reason=... 回调参数，没有结果时返回 null */
export function parseFusedResult(search: string): FusedResult | null {
  const params = new URLSearchParams(search)
  const result = params.get('result')
  if (result !== 'added' && result !== 'reauthorized' && result !== 'error') return null
  const out: FusedResult = { kind: result }
  for (const key of ['reason', 'expected', 'got'] as const) {
    const value = params.get(key)
    if (value) out[key] = value.slice(0, 200)
  }
  return out
}

const reasonText: Record<string, [string, string]> = {
  invalid_state: ['授权会话已失效或不属于当前登录用户，请重新发起', 'The authorization session expired or belongs to another login; please try again'],
  access_denied: ['你取消了授权', 'You cancelled the authorization'],
  provider_unavailable: ['该提供商已停用或不再用于融合邮件', 'The provider is disabled or no longer used for fused mail'],
  token_exchange_failed: ['换取令牌失败，请检查 Client ID / Secret 与回调地址', 'Token exchange failed; check client id/secret and callback URL'],
  email_unavailable: ['无法从提供商获取邮箱地址', 'The provider did not return an email address'],
  account_mismatch: ['重新授权时选择了另一个邮箱账号', 'A different mailbox was chosen during re-authorization'],
  no_refresh_token: ['提供商没有返回 refresh token，请移除应用授权后重试', 'No refresh token was returned; revoke the app access and try again'],
  oauth_error: ['授权过程出错', 'Authorization failed']
}

export function describeFusedError(result: FusedResult, zh: boolean): string {
  const [cn, en] = reasonText[result.reason || ''] || reasonText.oauth_error
  const base = zh ? cn : en
  if (result.reason === 'account_mismatch' && result.expected && result.got) {
    return zh ? `${base}（应为 ${result.expected}，实际为 ${result.got}）` : `${base} (expected ${result.expected}, got ${result.got})`
  }
  return base
}
