import { WebAuthnError, sendSignal } from '@simplewebauthn/browser'
import type { translations } from '../i18n/translations'

type TranslationKey = keyof typeof translations['zh-CN']

export function formatWebAuthnError(
  err: unknown,
  t: (key: TranslationKey) => string,
  zh: boolean,
  fallbackKey: TranslationKey = 'passkeyLoginFailed'
): string {
  if (err instanceof WebAuthnError) {
    if (err.code === 'ERROR_CEREMONY_ABORTED' || err.name === 'NotAllowedError' || err.name === 'AbortError') {
      return t('passkeyCancelled')
    }
    if (err.code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED' || err.name === 'InvalidStateError') {
      return zh
        ? '当前设备已为该账户保存过相同的 Passkey'
        : 'This authenticator already has a passkey registered for your account.'
    }
    if (err.name === 'SecurityError' || err.name === 'NotSupportedError') {
      return t('passkeyUnsupported')
    }
  }

  if (err instanceof Error) {
    if (err.name === 'NotAllowedError' || err.name === 'AbortError') {
      return t('passkeyCancelled')
    }
    if (err.name === 'InvalidStateError') {
      return zh
        ? '当前设备已为该账户保存过相同的 Passkey'
        : 'This authenticator already has a passkey registered for your account.'
    }
    if (err.name === 'SecurityError' || err.name === 'NotSupportedError') {
      return t('passkeyUnsupported')
    }
    if (err.message) {
      return err.message
    }
  }

  return t(fallbackKey)
}

export async function notifyUnknownCredential(credentialId: string): Promise<void> {
  if (!credentialId || typeof window === 'undefined') return
  try {
    await sendSignal({
      signalName: 'unknownCredential',
      rpID: window.location.hostname,
      credentialID: credentialId
    })
  } catch {
    // WebAuthn Signal API is optional and may not be supported in all browsers
  }
}
