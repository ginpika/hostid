/**
 * 桌面壳（Tauri）桥接工具：窗口控制、主题同步与启动台哨兵导航。
 *
 * 浏览器部署下全部静默降级为 no-op，Web 与桌面共用同一份前端产物。
 */

type TauriInvoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>

interface TauriGlobal {
  __TAURI__?: {
    core?: { invoke?: TauriInvoke }
    invoke?: TauriInvoke
  }
}

export const TAURI_FLAG = '__TAURI_INTERNALS__'
export const DESKTOP_HOME_PATH = '/__hostid_desktop_home'
export const DESKTOP_LOGOUT_PATH = '/__hostid_desktop_logout'
export const DESKTOP_PASSKEY_BRIDGE_PATH = '/passkey-bridge'
export const DESKTOP_PASSKEY_CANCELLED = 'PASSKEY_CANCELLED'

export function isDesktopShell(): boolean {
  return typeof window !== 'undefined' && TAURI_FLAG in window
}

export function isMacDesktop(): boolean {
  return (
    isDesktopShell() &&
    typeof navigator !== 'undefined' &&
    /Mac/i.test(navigator.platform)
  )
}

function getTauriInvoke(): TauriInvoke | undefined {
  if (!isDesktopShell()) return undefined
  const tauri = (window as unknown as TauriGlobal).__TAURI__
  return tauri?.core?.invoke ?? tauri?.invoke
}

function windowCmd(cmd: string, args?: Record<string, unknown>): Promise<unknown> | undefined {
  return getTauriInvoke()?.(`plugin:window|${cmd}`, args)
}

export function minimizeWindow(): void {
  windowCmd('minimize')?.catch(() => {})
}

export function closeWindow(): void {
  windowCmd('close')?.catch(() => {})
}

export async function toggleMaximizeWindow(): Promise<boolean> {
  const toggled = windowCmd('toggle_maximize')
  if (!toggled) return false
  await toggled.catch(() => {})
  return isWindowMaximized()
}

export async function isWindowMaximized(): Promise<boolean> {
  const query = windowCmd('is_maximized')
  if (!query) return false
  try {
    return Boolean(await query)
  } catch {
    return false
  }
}

export async function isWindowFullscreen(): Promise<boolean> {
  const query = windowCmd('is_fullscreen')
  if (!query) return false
  try {
    return Boolean(await query)
  } catch {
    return false
  }
}

export function setWindowTheme(theme: 'light' | 'dark' | null): void {
  windowCmd('set_theme', { value: theme })?.catch(() => {})
}

export function setWindowBackgroundColor(color: string | null): void {
  windowCmd('set_background_color', { value: color })?.catch(() => {})
}

export function resizeWindow(dir: string): void {
  windowCmd('start_resize_dragging', { value: dir })?.catch(() => {})
}

export function openDesktopHome(): void {
  if (!isDesktopShell()) return
  window.location.href = DESKTOP_HOME_PATH
}

export function backToLauncher(): void {
  if (!isDesktopShell()) return
  window.location.href = DESKTOP_LOGOUT_PATH
}

export function encodeBase64UrlJson(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export function decodeBase64UrlJson<T = unknown>(encoded: string): T {
  const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/')
  const padLength = (4 - (normalized.length % 4)) % 4
  const binary = atob(normalized + '='.repeat(padLength))
  const bytes = Uint8Array.from(binary, ch => ch.charCodeAt(0))
  return JSON.parse(new TextDecoder().decode(bytes)) as T
}

export function isAllowedPasskeyBridgeCallback(rawCallback: string): boolean {
  try {
    const parsed = new URL(rawCallback)
    if (parsed.protocol === 'hostid-desktop:' && parsed.hostname === 'passkey') {
      return !parsed.pathname || parsed.pathname === '/'
    }
    if (
      parsed.protocol === 'http:' &&
      parsed.hostname === '127.0.0.1' &&
      parsed.pathname === '/passkey-callback'
    ) {
      return Boolean(parsed.port)
    }
    return false
  } catch {
    return false
  }
}

export function buildPasskeyBridgeUrl(
  origin: string,
  params: { kind: 'login' | 'register'; state: string; options: unknown }
): string {
  const fragment = new URLSearchParams({
    kind: params.kind,
    state: params.state,
    options: encodeBase64UrlJson(params.options)
  })
  return `${origin.replace(/\/+$/g, '')}${DESKTOP_PASSKEY_BRIDGE_PATH}#${fragment.toString()}`
}

export function buildPasskeyBridgeCallbackUrl(
  callbackBase: string,
  params: { state: string; payload?: unknown; error?: string }
): string {
  if (!isAllowedPasskeyBridgeCallback(callbackBase)) {
    throw new Error('Disallowed Passkey bridge callback URL')
  }
  const url = new URL(callbackBase)
  url.searchParams.set('state', params.state)
  if (params.error) {
    url.searchParams.set('error', params.error)
  } else if (params.payload !== undefined) {
    url.searchParams.set('payload', encodeBase64UrlJson(params.payload))
  }
  return url.toString()
}

function createPasskeyBridgeState(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

/**
 * 调用桌面端原生系统认证会话（macOS 为 `ASWebAuthenticationSession`）完成 Passkey 交互，
 * 并将签发/断言结果 JSON 回传给主 WebView 继续完成 `/verify` 请求。
 */
export async function runDesktopPasskeyCeremony<TResponse>(params: {
  kind: 'login' | 'register'
  options: unknown
}): Promise<TResponse> {
  const invoke = getTauriInvoke()
  if (!invoke) {
    throw new DOMException('Desktop Tauri invoke API is unavailable', 'NotSupportedError')
  }
  const expectedState = createPasskeyBridgeState()
  const url = buildPasskeyBridgeUrl(window.location.origin, {
    kind: params.kind,
    state: expectedState,
    options: params.options
  })

  try {
    const rawJson = await invoke('desktop_passkey_ceremony', {
      url,
      expectedState
    })
    if (typeof rawJson !== 'string' || !rawJson) {
      throw new Error('Desktop Passkey ceremony returned empty response')
    }
    return JSON.parse(rawJson) as TResponse
  } catch (err) {
    const message =
      typeof err === 'string'
        ? err
        : err && typeof err === 'object' && 'message' in err && typeof (err as { message?: unknown }).message === 'string'
          ? (err as { message: string }).message
          : ''
    if (message === DESKTOP_PASSKEY_CANCELLED || message.includes(DESKTOP_PASSKEY_CANCELLED)) {
      throw new DOMException('The operation was aborted.', 'AbortError')
    }
    throw err instanceof Error ? err : new Error(message || 'Passkey ceremony failed')
  }
}
