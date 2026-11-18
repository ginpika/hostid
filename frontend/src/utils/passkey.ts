import {
  WebAuthnError,
  browserSupportsWebAuthn,
  platformAuthenticatorIsAvailable,
  sendSignal,
  startAuthentication,
  startRegistration
} from '@simplewebauthn/browser'
import type { translations } from '../i18n/translations'
import { isDesktopShell, isMacDesktop, runDesktopPasskeyCeremony } from '../lib/desktop'

type TranslationKey = keyof typeof translations['zh-CN']
type AuthenticationOptionsJSON = Parameters<typeof startAuthentication>[0]['optionsJSON']
type AuthenticationResponse = Awaited<ReturnType<typeof startAuthentication>>
type RegistrationOptionsJSON = Parameters<typeof startRegistration>[0]['optionsJSON']
type RegistrationResponse = Awaited<ReturnType<typeof startRegistration>>

/**
 * macOS `WKWebView` 第三方桌面端未公开原生 WebAuthn UI 委托，统一经由
 * `ASWebAuthenticationSession` 桥接完成；Windows/Linux 仅在 WebView 不支持时走回退桥接。
 */
export function shouldUseDesktopPasskeyBridge(): boolean {
  if (!isDesktopShell()) return false
  if (isMacDesktop()) return true
  return !browserSupportsWebAuthn()
}

export function isPasskeySupported(): boolean {
  return shouldUseDesktopPasskeyBridge() || browserSupportsWebAuthn()
}

export async function isPlatformPasskeyAvailable(): Promise<boolean> {
  if (isMacDesktop()) return true
  if (shouldUseDesktopPasskeyBridge()) return false
  if (!browserSupportsWebAuthn()) return false
  return platformAuthenticatorIsAvailable()
}

export async function authenticateWithPasskey(
  optionsJSON: AuthenticationOptionsJSON
): Promise<AuthenticationResponse> {
  if (shouldUseDesktopPasskeyBridge()) {
    return runDesktopPasskeyCeremony<AuthenticationResponse>({
      kind: 'login',
      options: optionsJSON
    })
  }
  return startAuthentication({ optionsJSON })
}

export async function registerWithPasskey(
  optionsJSON: RegistrationOptionsJSON
): Promise<RegistrationResponse> {
  if (shouldUseDesktopPasskeyBridge()) {
    return runDesktopPasskeyCeremony<RegistrationResponse>({
      kind: 'register',
      options: optionsJSON
    })
  }
  return startRegistration({ optionsJSON })
}

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
