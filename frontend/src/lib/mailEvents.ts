export type NoticeType = 'success' | 'error'
export function notify(message: string, type: NoticeType = 'success') {
  window.dispatchEvent(new CustomEvent('hostid:notice', { detail: { message, type } }))
}
export function refreshMail() {
  window.dispatchEvent(new CustomEvent('hostid:mail-updated'))
}
