/** Public appearance snapshot for embedding hosts; independent of any desktop runtime. */
export interface HostAppearance {
  readonly version: 1
  readonly backgroundColor: string
}

declare global {
  interface Window {
    __HOSTID_APPEARANCE__?: Readonly<HostAppearance>
  }
}

export function publishHostAppearance(backgroundColor: string): void {
  if (typeof window === 'undefined') return
  const appearance: Readonly<HostAppearance> = Object.freeze({ version: 1, backgroundColor })
  window.__HOSTID_APPEARANCE__ = appearance
  window.dispatchEvent(new CustomEvent<HostAppearance>('hostid:appearance', { detail: appearance }))
}
