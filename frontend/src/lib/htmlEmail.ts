import DOMPurify from 'dompurify'

// Keep defaults weaker than the sender's CSS. In particular, `anywhere` changes
// table min-content widths and makes narrow status/icon columns wrap each glyph.
const EMAIL_DEFAULT_STYLES = `
  html { color-scheme: light; }
  :where(body) {
    margin: 0;
    display: flow-root;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 15px;
    line-height: 1.8;
    overflow-wrap: break-word;
  }
  :where(body:not([text])) { color: #283348; }
  /* Explicit dimensions also describe spacer pixels and deliberately cropped images. */
  :where(img:not([height])) { max-width: 100%; height: auto; }
  :where(body:not([link]):not([vlink]):not([alink]) a) { color: #0ea5e9; }
`

/** Build an isolated email document without discarding its head CSS or body styles. */
export function createEmailHtmlDocument(html: string): string {
  const sanitized = DOMPurify.sanitize(html, {
    WHOLE_DOCUMENT: true,
    ALLOWED_TAGS: [
      'html', 'head', 'body', 'style',
      'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'mark',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'a', 'img',
      'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
      'div', 'span', 'hr', 'sup', 'sub', 'font', 'center', 'nobr',
      'article', 'section', 'main', 'header', 'footer', 'nav', 'aside', 'hgroup',
      'figure', 'figcaption', 'picture', 'source',
      'details', 'summary', 'ruby', 'rt', 'rp', 'bdi', 'bdo', 'wbr', 'q', 'time', 'data',
      'dd', 'dt', 'dl', 'ins', 'del', 'small', 'big',
      'abbr', 'acronym', 'address', 'cite', 'dfn', 'kbd', 'samp', 'var', 'tt',
      'map', 'area',
    ],
    ALLOWED_ATTR: [
      'href', 'src', 'alt', 'title', 'width', 'height',
      'style', 'class', 'id', 'target', 'rel',
      'name', 'align', 'valign', 'bgcolor', 'color', 'face', 'size',
      'border', 'cellpadding', 'cellspacing', 'colspan', 'rowspan',
      'background', 'type', 'media', 'nowrap', 'lang', 'dir', 'scope', 'role',
      'hidden', 'srcset', 'sizes', 'usemap', 'shape', 'coords', 'hspace', 'vspace',
      'start', 'reversed', 'value', 'span', 'headers', 'abbr', 'open', 'cite', 'datetime',
      'text', 'link', 'vlink', 'alink',
    ],
    ALLOW_DATA_ATTR: false,
  })
  const doc = new DOMParser().parseFromString(sanitized, 'text/html')
  const defaults = doc.createElement('style')
  defaults.textContent = EMAIL_DEFAULT_STYLES
  // Sender styles follow the defaults, so they also win when specificity ties.
  doc.head.prepend(defaults)
  const viewport = doc.createElement('meta')
  viewport.name = 'viewport'
  viewport.content = 'width=device-width, initial-scale=1'
  doc.head.prepend(viewport)
  const charset = doc.createElement('meta')
  charset.setAttribute('charset', 'utf-8')
  doc.head.prepend(charset)
  return `<!DOCTYPE html>${doc.documentElement.outerHTML}`
}
