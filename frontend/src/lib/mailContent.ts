export type MailContentFormat = 'html' | 'markdown' | 'text'

// Require actual HTML tag syntax; Markdown autolinks such as <https://…> and
// <reader@example.com> are not tags.
const htmlTag = /<\/?[a-z][a-z\d-]*(?:\s[^<>]*?)?\/?>/i

/** Infer the format of stored bodies, including older Markdown-in-email messages. */
export function getMailContentFormat(content: string): MailContentFormat {
  const start = content.trimStart().replace(/^(?:(?:<!--[\s\S]*?-->|<\?xml[\s\S]*?\?>)\s*)+/, '')
  // HTML documents/fragments can contain headings and fenced examples in pre/code.
  // Their contents must not switch the entire message to Markdown rendering.
  if (/^<!doctype\s+html\b/i.test(start) || /^<\/?[a-z][a-z\d-]*(?:\s[^<>]*?)?\/?>/i.test(start)) {
    return 'html'
  }

  const strongMarkdown = [
    /^(---|\+\+\+)\s*\n[\s\S]*?\n\1\s*(?:\n|$)/,
    /^#{1,6}\s/m,
    /^```/m,
    /^~~~/m,
    /\[\^[^\]]+\]:/,
    /^[-:]+\|[-:]+/m,
  ]
  if (strongMarkdown.some(pattern => pattern.test(content))) return 'markdown'
  if (htmlTag.test(content)) return 'html'

  const markdown = [
    /^\s*[-*+]\s/m,
    /^\s*\d+\.\s/m,
    /^\s*>/m,
    /\[.+\]\(.+\)/,
    /`[^`]+`/,
    /\*\*[^*]+\*\*/,
    /\*[^*]+\*/,
    /__[^_]+__/,
    /_[^_]+_/,
    /~~[^~]+~~/,
    /^---\s*$/m,
    /^\|?\s*\w+.*\|.*/m,
    /^!\[.+\]\(.+\)/,
    /\$\w+\$/,
    /\$\$[^$]+\$\$/,
    /\[\^[^\]]+\]/,
    /<(?:https?:\/\/|mailto:)[^<>\s]+>/i,
    /<[^<>\s@]+@[^<>\s@]+\.[^<>\s@]+>/,
  ]
  return markdown.some(pattern => pattern.test(content)) ? 'markdown' : 'text'
}
