/**
 * Cloudflare Turnstile 人机校验网关
 * 未配置 secret key 时视为关闭（直接通过）
 */
import { getSettings } from './settings'

interface TurnstileVerifyResponse {
  success: boolean
  'error-codes'?: string[]
}

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

export function isTurnstileEnabled(): boolean {
  return !!getSettings().turnstileSecretKey
}

export async function verifyTurnstile(token: string, ip?: string): Promise<boolean> {
  const secret = getSettings().turnstileSecretKey
  if (!secret) return true

  const form = new URLSearchParams({ secret, response: token })
  if (ip) form.append('remoteip', ip)

  const res = await fetch(TURNSTILE_VERIFY_URL, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(10_000)
  })

  const data = await res.json() as TurnstileVerifyResponse
  return data.success === true
}
