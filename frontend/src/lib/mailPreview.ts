/** Extract an inert, readable preview without rendering any message resources. */
interface PreviewNode {
  nodeType: number
  nodeName: string
  nodeValue: string | null
  childNodes: ArrayLike<PreviewNode>
  getAttribute?: (name: string) => string | null
}

const nonContentTags = new Set(['HEAD', 'TITLE', 'STYLE', 'SCRIPT', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'CANVAS', 'IFRAME', 'OBJECT'])
const blockTags = new Set(['ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'BR', 'CAPTION', 'DD', 'DIV', 'DL', 'DT', 'FIGCAPTION', 'FIGURE', 'FOOTER', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HR', 'LI', 'MAIN', 'OL', 'P', 'PRE', 'SECTION', 'TABLE', 'TD', 'TH', 'TR', 'UL'])
const hiddenStyle = /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*(?:hidden|collapse)|opacity\s*:\s*0(?:\.0+)?|mso-hide\s*:\s*all)\s*(?:!important\s*)?(?:;|$)/i

/** The tree interface also permits small resource-free regression fixtures. */
export function visiblePreviewText(node: PreviewNode): string {
  if (node.nodeType === 3) return node.nodeValue || ''
  if (node.nodeType !== 1 && node.nodeType !== 11) return ''
  const tag = node.nodeName.toUpperCase()
  if (nonContentTags.has(tag)) return ''
  if (node.getAttribute) {
    if (node.getAttribute('hidden') !== null || node.getAttribute('aria-hidden')?.toLowerCase() === 'true' || hiddenStyle.test(node.getAttribute('style') || '')) return ''
  }
  const text = Array.from(node.childNodes).map(visiblePreviewText).join('')
  return blockTags.has(tag) ? `\n${text}\n` : text
}

/** Keep mail metadata and commonly used Markdown markers out of the list. */
export function normalizePreviewText(value: string, limit = 180): string {
  let text = value.replace(/\r\n?/g, '\n').replace(/[\u200B\u200E\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, '')
    // Trim email preheader fillers without breaking meaningful emoji joiners.
    .replace(/(^|\s)[\u200C\u200D]+|[\u200C\u200D]+(?=\s|$)/g, '$1')
  text = text.replace(/^\s*(---|\+\+\+)\s*\n([\s\S]*?)\n\1\s*(?:\n|$)/, (match, _delimiter: string, metadata: string) => /^\s*[\w-]+\s*[:=]/m.test(metadata) ? '' : match)
    .replace(/^\s*(?:`{3,}|~{3,})[^\n]*$/gm, '')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}(?:>\s*)+/gm, '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, '')
    .replace(/^\s*(?:={3,}|-{3,}|\*{3,}|_{3,})\s*$/gm, '')
    .replace(/^\s*\[[^\]]+\]:\s+\S.*$/gm, '')
    .replace(/!?\[([^\]]*)\]\([^\n)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')
    .replace(/`{1,2}([^`\n]+)`{1,2}/g, '$1')
    .replace(/(\*\*|__|~~)(.*?)\1/g, '$2')
    .replace(/(^|[\s(])([*_])(?=\S)(.+?)\2(?=$|[\s.,!?;:)])/g, '$1$3')
    .replace(/\s+/g, ' ').trim()
  const characters = Array.from(text)
  const maximum = Math.max(1, limit)
  return characters.length > maximum ? `${characters.slice(0, maximum - 1).join('').trimEnd()}…` : text
}

export function mailPreview(content: string, limit = 180): string {
  if (!content) return ''
  // A template's document fragment is never inserted into the live document:
  // scripts stay inert, images/iframes are never loaded, and textContent decodes
  // every named and numeric HTML character reference using the browser parser.
  const template = document.createElement('template')
  const html = /<!doctype\s|<\/?[a-z][a-z\d-]*(?:\s[^<>]*?)?\/?>/i.test(content)
  template.innerHTML = html
    ? content.replace(/<head\b[^>]*>[\s\S]*?<\/head\s*>/gi, '')
    : content.replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return normalizePreviewText(visiblePreviewText(template.content), limit)
}
