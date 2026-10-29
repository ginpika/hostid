import type { ParsedMail } from 'mailparser'

/** Preserve MIME text/plain literally using the parser's escaped HTML fallback. */
export function getParsedEmailBody(parsed: Pick<ParsedMail, 'html' | 'textAsHtml' | 'text'>): string {
  return parsed.html || parsed.textAsHtml || parsed.text || ''
}
