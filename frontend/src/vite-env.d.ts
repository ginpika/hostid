/// <reference types="vite/client" />

declare module '*.css' {
  const content: string
  export default content
}

interface Window {
  __ENV__?: {
    CF_TURNSTILE_SITE_KEY?: string
    SITE_NAME?: string
    SITE_SLOGAN?: string
    SITE_ICON_URL?: string
  }
}
