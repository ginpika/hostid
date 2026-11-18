/**
 * 桌面端系统浏览器 / `ASWebAuthenticationSession` Passkey 桥接页。
 *
 * 本页面仅在系统浏览上下文中执行标准 WebAuthn `startAuthentication` / `startRegistration`，
 * 不在 Safari 会话内提交 `/verify`、也不写入令牌；校验结果仅编码后回传给受白名单校验的
 * `hostid-desktop://passkey` 或 `127.0.0.1` 本地回环回调。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, Fingerprint, Loader2, X } from 'lucide-react'
import { browserSupportsWebAuthn, startAuthentication, startRegistration } from '@simplewebauthn/browser'
import AuthPage, { AuthHeader } from '../components/AuthPage'
import { useConfig } from '../contexts/ConfigContext'
import { useI18n } from '../i18n/I18nContext'
import {
  buildPasskeyBridgeCallbackUrl,
  decodeBase64UrlJson,
  isAllowedPasskeyBridgeCallback
} from '../lib/desktop'
import { formatWebAuthnError } from '../utils/passkey'

type AuthenticationOptionsJSON = Parameters<typeof startAuthentication>[0]['optionsJSON']
type RegistrationOptionsJSON = Parameters<typeof startRegistration>[0]['optionsJSON']

type BridgePayload =
  | {
      kind: 'login'
      state: string
      callback: string
      options: AuthenticationOptionsJSON
    }
  | {
      kind: 'register'
      state: string
      callback: string
      options: RegistrationOptionsJSON
    }

function parseBridgeHash(hash: string): { data: BridgePayload | null; invalidReason: string } {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  if (!raw) {
    return { data: null, invalidReason: 'missing-params' }
  }
  const params = new URLSearchParams(raw)
  const kind = params.get('kind')
  const state = params.get('state')?.trim() || ''
  const callback = params.get('callback')?.trim() || ''
  const encodedOptions = params.get('options')?.trim() || ''

  if ((kind !== 'login' && kind !== 'register') || !state || !callback || !encodedOptions) {
    return { data: null, invalidReason: 'missing-params' }
  }
  if (!isAllowedPasskeyBridgeCallback(callback)) {
    return { data: null, invalidReason: 'disallowed-callback' }
  }

  try {
    const options = decodeBase64UrlJson(encodedOptions)
    if (!options || typeof options !== 'object') {
      return { data: null, invalidReason: 'invalid-options' }
    }
    if (kind === 'login') {
      return {
        data: { kind: 'login', state, callback, options: options as AuthenticationOptionsJSON },
        invalidReason: ''
      }
    }
    return {
      data: { kind: 'register', state, callback, options: options as RegistrationOptionsJSON },
      invalidReason: ''
    }
  } catch {
    return { data: null, invalidReason: 'invalid-options' }
  }
}

function isAbortLikeError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  return err.name === 'NotAllowedError' || err.name === 'AbortError'
}

export default function PasskeyBridgePage() {
  const { siteName } = useConfig()
  const { t, language } = useI18n()
  const zh = language === 'zh-CN'

  const parsed = useMemo(() => {
    const hash = typeof window !== 'undefined' ? window.location.hash : ''
    return parseBridgeHash(hash)
  }, [])

  const [status, setStatus] = useState<'running' | 'awaiting-gesture' | 'error'>('running')
  const [errorMessage, setErrorMessage] = useState('')
  const autoTriggeredRef = useRef(false)
  const runningRef = useRef(false)

  const redirectCancel = useCallback(
    (reason?: string) => {
      if (!parsed.data) return
      const nextUrl = buildPasskeyBridgeCallbackUrl(parsed.data.callback, {
        state: parsed.data.state,
        error: reason || 'cancelled'
      })
      window.location.replace(nextUrl)
    },
    [parsed.data]
  )

  const executeCeremony = useCallback(
    async (isManualGesture: boolean) => {
      if (!parsed.data || runningRef.current) return
      if (!browserSupportsWebAuthn()) {
        setStatus('error')
        setErrorMessage(t('passkeyUnsupported'))
        return
      }

      runningRef.current = true
      setStatus('running')
      setErrorMessage('')

      try {
        const result =
          parsed.data.kind === 'login'
            ? await startAuthentication({ optionsJSON: parsed.data.options })
            : await startRegistration({ optionsJSON: parsed.data.options })

        const nextUrl = buildPasskeyBridgeCallbackUrl(parsed.data.callback, {
          state: parsed.data.state,
          payload: result
        })
        window.location.replace(nextUrl)
      } catch (err) {
        runningRef.current = false
        if (isAbortLikeError(err)) {
          if (isManualGesture) {
            redirectCancel('cancelled')
            return
          }
          // 部分 Safari / ASWebAuthenticationSession 环境禁止无手势自动唤起 WebAuthn，
          // 此时降级为显示明确操作按钮由用户点击触发。
          setStatus('awaiting-gesture')
          return
        }

        const fallbackKey =
          parsed.data.kind === 'login' ? 'passkeyLoginFailed' : 'passkeyUnsupported'
        setErrorMessage(formatWebAuthnError(err, t, zh, fallbackKey))
        setStatus('error')
      }
    },
    [parsed.data, redirectCancel, t, zh]
  )

  useEffect(() => {
    if (!parsed.data || autoTriggeredRef.current) return
    autoTriggeredRef.current = true
    void executeCeremony(false)
  }, [parsed.data, executeCeremony])

  const isRegister = parsed.data?.kind === 'register'
  const headerDescription = !parsed.data
    ? zh
      ? '无法验证桌面端 Passkey 请求参数。'
      : 'Unable to verify desktop Passkey request parameters.'
    : isRegister
      ? zh
        ? '通过 macOS 系统 Touch ID 或密码 App 完成 Passkey 创建，完成后将自动返回桌面端。'
        : 'Use Touch ID or Apple Passwords to create your passkey and return to HostID Desktop.'
      : zh
        ? '通过 macOS 系统 Touch ID 或密码 App 完成 Passkey 登录验证，完成后将自动返回桌面端。'
        : 'Use Touch ID or Apple Passwords to sign in with your passkey and return to HostID Desktop.'

  return (
    <AuthPage footer={null} toolbarStyle={{ display: 'none' }}>
      <AuthHeader title={siteName || 'HostID'} description={headerDescription} />

      {!parsed.data ? (
        <div
          className="rounded-xl p-4 flex items-start gap-3 text-sm"
          style={{
            backgroundColor: 'var(--color-danger-bg)',
            border: '1px solid var(--color-danger-border)',
            color: 'var(--color-danger-text)'
          }}
        >
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            {parsed.invalidReason === 'disallowed-callback'
              ? zh
                ? '回调地址不在桌面端允许列表中，已拒绝继续操作。'
                : 'Blocked: disallowed desktop callback URL.'
              : zh
                ? '缺少或损坏的 Passkey 请求参数，请返回 HostID 桌面端重试。'
                : 'Missing or corrupted Passkey parameters. Please return to HostID Desktop and retry.'}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {status === 'running' && (
            <div
              role="status"
              className="flex flex-col items-center gap-3 py-4 text-center"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              <Loader2
                className="w-8 h-8 animate-spin"
                style={{ color: 'var(--color-accent-primary)' }}
                aria-hidden="true"
              />
              <p className="text-sm">
                {zh
                  ? '正在等待系统 Touch ID / Passkey 验证…'
                  : 'Waiting for system Touch ID / Passkey prompt…'}
              </p>
            </div>
          )}

          {status === 'error' && errorMessage && (
            <div
              role="alert"
              className="rounded-xl p-4 flex items-start gap-3 text-sm"
              style={{
                backgroundColor: 'var(--color-danger-bg)',
                border: '1px solid var(--color-danger-border)',
                color: 'var(--color-danger-text)'
              }}
            >
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{errorMessage}</span>
            </div>
          )}

          {(status === 'awaiting-gesture' || status === 'error') && (
            <div className="space-y-2.5 pt-1">
              <button
                type="button"
                onClick={() => void executeCeremony(true)}
                className="w-full py-3 px-4 rounded-xl font-medium transition-colors flex items-center justify-center gap-2"
                style={{
                  backgroundColor: 'var(--color-accent-primary)',
                  color: '#ffffff'
                }}
              >
                <Fingerprint className="w-5 h-5" aria-hidden="true" />
                <span>
                  {status === 'error'
                    ? zh
                      ? '重试 Touch ID / Passkey 验证'
                      : 'Retry Touch ID / Passkey'
                    : isRegister
                      ? zh
                        ? '继续创建 Passkey'
                        : 'Continue Passkey Setup'
                      : zh
                        ? '继续 Touch ID / Passkey 验证'
                        : 'Continue Touch ID / Passkey'}
                </span>
              </button>

              <button
                type="button"
                onClick={() => redirectCancel(status === 'error' && errorMessage ? errorMessage : 'cancelled')}
                className="w-full py-2.5 px-4 rounded-xl font-medium transition-colors flex items-center justify-center gap-1.5 hover:bg-[var(--color-bg-tertiary)]"
                style={{
                  backgroundColor: 'var(--color-bg-secondary)',
                  border: '1px solid var(--color-border-primary)',
                  color: 'var(--color-text-secondary)'
                }}
              >
                <X className="w-4 h-4" aria-hidden="true" />
                <span>{zh ? '取消并返回桌面端' : 'Cancel & Return'}</span>
              </button>
            </div>
          )}
        </div>
      )}
    </AuthPage>
  )
}
