/**
 * 邓件正文渲染组件
 * 支持渲染 HTML、Markdown 和纯文本格式
 * 使用 DOMPurify 进行安全过滤，支持脚注和 front-matter
 */
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react'

interface EmailBodyProps {
  content: string
  className?: string
  style?: CSSProperties
}

// 标记是否已注册扩展
let extensionsRegistered = false

// 注册 marked 扩展以支持脚注和 front-matter（只注册一次）
function registerExtensions() {
  if (extensionsRegistered) return

  // 脚注定义扩展 [^id]: text
  const footnoteExtension = {
    name: 'footnote',
    level: 'block' as const,
    start(src: string) {
      const match = src.match(/\[\^[^\]]+\]:/)
      return match ? match.index : -1
    },
    tokenizer(src: string) {
      const match = src.match(/^\[\^([^\]]+)\]:\s*(.+?)(?:\n|$)/)
      if (match) {
        return {
          type: 'footnote',
          raw: match[0],
          id: match[1],
          text: match[2]
        }
      }
      return undefined
    },
    renderer(token: any) {
      return `<p class="footnote" id="fn-${token.id}"><sup>[${token.id}]</sup> ${token.text}</p>`
    }
  }

  // 脚注引用扩展 [^id]
  const footnoteRefExtension = {
    name: 'footnoteRef',
    level: 'inline' as const,
    start(src: string) {
      const match = src.match(/\[\^[^\]]+\]/)
      return match ? match.index : -1
    },
    tokenizer(src: string) {
      const match = src.match(/^\[\^([^\]]+)\]/)
      if (match) {
        return {
          type: 'footnoteRef',
          raw: match[0],
          id: match[1]
        }
      }
      return undefined
    },
    renderer(token: any) {
      return `<sup><a href="#fn-${token.id}" class="footnote-ref">[${token.id}]</a></sup>`
    }
  }

  // Front-matter 扩展（--- 或 +++ 包裹的块）
  const frontMatterExtension = {
    name: 'frontMatter',
    level: 'block' as const,
    start(src: string) {
      const match = src.match(/^(---|\+\+\+)\s*\n/)
      return match ? match.index : -1
    },
    tokenizer(src: string) {
      const match = src.match(/^(---|\+\+\+)\s*\n([\s\S]*?)\n\1\s*(?:\n|$)/)
      if (match) {
        return {
          type: 'frontMatter',
          raw: match[0],
          delimiter: match[1],
          text: match[2].trim()
        }
      }
      return undefined
    },
    renderer(token: any) {
      const lines = token.text.split('\n')
      const items: string[] = []
      let i = 0

      while (i < lines.length) {
        const line = lines[i]

        // YAML 格式: key: value 或 key: (后跟列表)
        const yamlMatch = line.match(/^(\w+):\s*(.*)$/)
        if (yamlMatch) {
          const key = yamlMatch[1]
          const value = yamlMatch[2].trim()

          // 检查是否是 YAML 列表（下一行以 - 开头）
          if (!value) {
            const listValues: string[] = []
            let j = i + 1
            while (j < lines.length) {
              const nextLine = lines[j]
              const listMatch = nextLine.match(/^\s*-\s+(.+)$/)
              if (listMatch) {
                listValues.push(listMatch[1].trim())
                j++
              } else {
                break
              }
            }
            if (listValues.length > 0) {
              items.push(`<div class="frontmatter-item"><span class="frontmatter-key">${key}:</span> <span class="frontmatter-value">[${listValues.join(', ')}]</span></div>`)
              i = j
              continue
            }
          }

          items.push(`<div class="frontmatter-item"><span class="frontmatter-key">${key}:</span> <span class="frontmatter-value">${value}</span></div>`)
          i++
          continue
        }

        // TOML 格式: key = value 或 key = [...]
        const tomlMatch = line.match(/^(\w+)\s*=\s*(.+)$/)
        if (tomlMatch) {
          const key = tomlMatch[1]
          let value = tomlMatch[2].trim()

          // 检查是否是 TOML 数组 [...]
          if (value.startsWith('[')) {
            // 收集多行数组直到找到 ]
            const arrayLines: string[] = [value]
            while (!value.includes(']') && i + 1 < lines.length) {
              i++
              value = lines[i].trim()
              arrayLines.push(value)
            }
            // 解析数组内容
            const arrayContent = arrayLines.join(' ')
            const arrayMatch = arrayContent.match(/\[(.*)\]/s)
            if (arrayMatch) {
              const itemsStr = arrayMatch[1]
                .split(',')
                .map(s => s.trim().replace(/^["']|["']$/g, ''))
                .filter(s => s)
              items.push(`<div class="frontmatter-item"><span class="frontmatter-key">${key}:</span> <span class="frontmatter-value">[${itemsStr.join(', ')}]</span></div>`)
            }
          } else {
            // 单个值，移除引号
            value = value.replace(/^["']|["']$/g, '')
            items.push(`<div class="frontmatter-item"><span class="frontmatter-key">${key}:</span> <span class="frontmatter-value">${value}</span></div>`)
          }
          i++
          continue
        }

        i++
      }

      if (items.length > 0) {
        return `<div class="frontmatter"><div class="frontmatter-content">${items.join('')}</div></div>`
      }
      return ''
    }
  }

  marked.use({ extensions: [footnoteExtension, footnoteRefExtension, frontMatterExtension] })
  extensionsRegistered = true
}

// 在模块加载时注册扩展
registerExtensions()

// HTML 邮件在 iframe 内渲染时注入的隔离样式（从 index.css 的 .email-body-html 规则复制）
// iframe 是独立文档，无法继承主应用的 CSS，因此需要显式注入
// 注意：DOMPurify 默认会保留 <style> 标签及其 CSS 内容（style 在默认 allow-list 中），
// 因此邮件自带的样式（如 .pricing-table）在 iframe 内仍然生效。
// 这里提供基准默认样式作为兜底，确保无自带 CSS 的邮件也能正常显示。
const EMAIL_IFRAME_CSS = `
  a {
    color: #0ea5e9;
  }
  /* 表格默认样式 —— 邮件自带 CSS 会被 DOMPurify 去除，这里补回合理默认值 */
  th, td {
    padding: 8px 12px;
  }
  th {
    font-weight: 600;
  }
`

export default function EmailBody({ content, className = '', style }: EmailBodyProps) {
  // 检测强 Markdown 特征——这些在 HTML 邮件中几乎不会出现
  // 用于优先判断：如果有这些特征，内容几乎一定是 Markdown
  const hasStrongMarkdownSyntax = (str: string): boolean => {
    const strongPatterns = [
      /^(---|\+\+\+)\s*\n[\s\S]*?\n\1\s*(?:\n|$)/,  // front-matter 块（+++...+++ 或 ---...---）
      /^#{1,6}\s/m,           // ATX 标题（行首 # 后跟空格）
      /^```/m,                 // 三反引号代码块开始
      /^~~~/m,                 // 波浪线代码块开始
      /\[\^[^\]]+\]:/,         // 脚注定义 [^id]:
      /^[-:]+\|[-:]+/m,        // 表格分隔行 ---|---
    ]
    return strongPatterns.some(pattern => pattern.test(str))
  }

  // 检测弱 Markdown 特征——HTML 邮件中也可能偶然出现
  // 仅在无强特征且无 HTML 标签时使用
  const hasMarkdownSyntax = (str: string): boolean => {
    const markdownPatterns = [
      /^\s*[-*+]\s/m,         // 无序列表
      /^\s*\d+\.\s/m,         // 有序列表
      /^\s*>/m,               // 引用
      /\[.+\]\(.+\)/,         // 链接
      /`[^`]+`/,              // 行内代码
      /\*\*[^*]+\*\*/,        // 粗体 **
      /\*[^*]+\*/,            // 斜体 *
      /__[^_]+__/,            // 粗体 __
      /_[^_]+_/,              // 斜体 _
      /~~[^~]+~~/,            // 删除线 ~~
      /^---\s*$/m,            // 分隔线
      /^\|?\s*\w+.*\|.*/m,    // 表格行（包含 | 分隔符）
      /^!\[.+\]\(.+\)/,       // 图片
      /\$\w+\$/,              // LaTeX 行内公式
      /\$\$[^$]+\$\$/,        // LaTeX 块公式
      /\[\^[^\]]+\]/,         // 脚注引用
    ]
    return markdownPatterns.some(pattern => pattern.test(str))
  }

  // 检测是否包含 HTML 标签
  const isHtml = (str: string): boolean => {
    return /<[a-zA-Z][^>]*>/.test(str)
  }

  const sanitizeHtml = (html: string): string => {
    return DOMPurify.sanitize(html, {
      ALLOWED_TAGS: [
        'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'mark',
        'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'ul', 'ol', 'li',
        'blockquote', 'pre', 'code',
        'a', 'img',
        'table', 'thead', 'tbody', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
        'div', 'span',
        'hr', 'sup', 'sub',
        'font', 'center', 'nobr',
        'tbody', 'tfoot', 'thead',
        'dd', 'dt', 'dl',
        'ins', 'del',
        'small', 'big',
        'abbr', 'acronym', 'address', 'cite', 'dfn', 'kbd', 'samp', 'var',
        'tt',
        'map', 'area',
        'style'
      ],
      ALLOWED_ATTR: [
        'href', 'src', 'alt', 'title', 'width', 'height',
        'style', 'class', 'id',
        'target', 'rel',
        'name', 'align', 'valign', 'bgcolor', 'color', 'face', 'size',
        'border', 'cellpadding', 'cellspacing',
        'colspan', 'rowspan',
        'background',
        'type',
        'nowrap'
      ],
      ALLOW_DATA_ATTR: false,
      ADD_ATTR: ['target', 'rel'],
      FORCE_BODY: false,
      WHOLE_DOCUMENT: false,
    })
  }

  const sanitizeHtmlForMarkdown = (html: string): string => {
    return DOMPurify.sanitize(html, {
      ALLOWED_TAGS: [
        'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'del', 'mark',
        'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'ul', 'ol', 'li',
        'blockquote', 'pre', 'code',
        'a', 'img',
        'table', 'thead', 'tbody', 'tr', 'th', 'td',
        'div', 'span',
        'hr', 'sup', 'sub',
        'input',
        'cite'
      ],
      ALLOWED_ATTR: [
        'href', 'src', 'alt', 'title', 'width', 'height',
        'style', 'class', 'id',
        'target', 'rel',
        'type', 'disabled', 'checked'
      ],
      ALLOW_DATA_ATTR: false,
      ADD_ATTR: ['target', 'rel'],
      FORCE_BODY: true,
    })
  }

  const parseMarkdown = (text: string): string => {
    try {
      return marked.parse(text, {
        breaks: true,
        gfm: true,
      }) as string
    } catch {
      return text
    }
  }

  // 预处理：只对表格行移除行首空格，保留其他内容的缩进
  const preprocessMarkdown = (text: string): string => {
    const hasTableSeparator = /^[\s]*[-:]+\|[-:]+/m.test(text)

    if (hasTableSeparator) {
      const lines = text.split('\n')
      const result: string[] = []

      for (const line of lines) {
        if (line.includes('|')) {
          result.push(line.trimStart())
        } else {
          result.push(line)
        }
      }

      return result.join('\n')
    }

    return text
  }

  const textToHtml = (text: string): string => {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\r\n/g, '<br>')
      .replace(/\n/g, '<br>')
      .replace(/\r/g, '<br>')
  }

  const renderContent = () => {
    if (!content) {
      return ''
    }

    // 优先检测强 Markdown 特征（front-matter、ATX 标题、代码块等）
    // 这些特征在 HTML 邮件中几乎不会出现，可以可靠地区分 Markdown 内容
    if (hasStrongMarkdownSyntax(content)) {
      const processedContent = preprocessMarkdown(content)
      const html = parseMarkdown(processedContent)
      return sanitizeHtmlForMarkdown(html)
    }

    // 其次检测 HTML 标签
    if (isHtml(content)) {
      return sanitizeHtml(content)
    }

    // 最后检测弱 Markdown 特征（斜体、粗体等）
    if (hasMarkdownSyntax(content)) {
      const processedContent = preprocessMarkdown(content)
      const html = parseMarkdown(processedContent)
      return sanitizeHtmlForMarkdown(html)
    }

    return textToHtml(content)
  }

  // 判断渲染模式用于选择 CSS 类名
  const contentIsHtml = !hasStrongMarkdownSyntax(content) && (isHtml(content) || !hasMarkdownSyntax(content))

  // ---- iframe 渲染（仅用于 HTML 邮件，实现与主应用的样式隔离）----
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const roRef = useRef<ResizeObserver | null>(null)
  const [iframeHeight, setIframeHeight] = useState<number>(150)

  const iframeSrcDoc = useMemo(() => {
    if (!contentIsHtml) return ''
    const sanitized = renderContent()
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${EMAIL_IFRAME_CSS}</style></head><body class="email-body-html">${sanitized}</body></html>`
    // renderContent 仅依赖 content，此处无需重复声明
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, contentIsHtml])

  const handleIframeLoad = useCallback(() => {
    const iframe = iframeRef.current
    if (!iframe) return
    const doc = iframe.contentDocument
    if (!doc) return

    // 清理上一次的观察者
    roRef.current?.disconnect()

    // 链接统一在新标签页打开，避免在 iframe 内跳转导致死循环
    doc.querySelectorAll('a').forEach(a => {
      a.setAttribute('target', '_blank')
      a.setAttribute('rel', 'noopener noreferrer')
    })

    // 根据内容高度自适应 iframe 高度
    const adjustHeight = () => {
      const body = doc.body
      if (!body) return
      const h = Math.max(
        body.scrollHeight,
        body.offsetHeight,
        doc.documentElement.scrollHeight
      )
      if (h > 0) setIframeHeight(h)
    }
    adjustHeight()

    const ro = new ResizeObserver(adjustHeight)
    ro.observe(doc.body)
    roRef.current = ro

    // 图片加载完成后重新计算高度
    doc.querySelectorAll('img').forEach(img => {
      if (!img.complete) {
        img.addEventListener('load', adjustHeight)
        img.addEventListener('error', adjustHeight)
      }
    })
  }, [])

  // 组件卸载时清理 ResizeObserver
  useEffect(() => {
    return () => roRef.current?.disconnect()
  }, [])

  if (contentIsHtml) {
    return (
      <iframe
        ref={iframeRef}
        srcDoc={iframeSrcDoc}
        onLoad={handleIframeLoad}
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        title="email-content"
        style={{
          width: '100%',
          height: `${iframeHeight}px`,
          border: 'none',
          display: 'block',
          borderRadius: '8px',
          backgroundColor: '#ffffff',
          ...style,
        }}
      />
    )
  }

  return (
    <div
      className={`email-body prose prose-sm max-w-none ${className}`}
      style={style}
      dangerouslySetInnerHTML={{ __html: renderContent() }}
    />
  )
}