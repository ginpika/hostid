/**
 * 邓件正文渲染组件
 * 支持渲染 HTML、Markdown 和纯文本格式
 * 使用 DOMPurify 进行安全过滤，支持脚注和 front-matter
 */
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { CSSProperties } from 'react'

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

export default function EmailBody({ content, className = '', style }: EmailBodyProps) {
  // 检测 Markdown 代码块（```）
  const hasCodeBlocks = (str: string): boolean => {
    return /^```\s*\w*\s*$/m.test(str) || /```\s*\w*\s*$/.test(str)
  }

  // 检测 Markdown 特有的语法
  const hasMarkdownSyntax = (str: string): boolean => {
    const markdownPatterns = [
      /^#{1,6}\s/m,           // 标题
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
      /^```\s*\w*\s*$/m,      // 代码块开始
      /^---\s*$/m,            // 分隔线
      /^\|?\s*\w+.*\|.*/m,    // 表格行（包含 | 分隔符）
      /^[-:]+\|[-:]+/m,       // 表格分隔符行（如 ---|---）
      /^!\[.+\]\(.+\)/,       // 图片
      /\$\w+\$/,              // LaTeX 行内公式
      /\$\$[^$]+\$\$/,        // LaTeX 块公式
      /\[\^[^\]]+\]/,         // 脚注引用
      /^(---|\+\+\+)\s*\n/,   // front-matter 块开始
    ]
    return markdownPatterns.some(pattern => pattern.test(str))
  }

  // 移除 Markdown 代码块内容后检测 HTML
  const removeCodeBlocks = (str: string): string => {
    return str.replace(/```[\s\S]*?```/g, '')
  }

  // 检测是否为真正的 HTML（排除 Markdown 代码块中的 HTML）
  const isHtml = (str: string): boolean => {
    if (hasCodeBlocks(str)) {
      const contentWithoutCodeBlocks = removeCodeBlocks(str)
      const htmlPattern = /<[a-zA-Z][^>]*>/
      return htmlPattern.test(contentWithoutCodeBlocks)
    }
    const htmlPattern = /<[a-zA-Z][^>]*>/
    return htmlPattern.test(str)
  }

  // 检测是否为 Markdown
  const isMarkdown = (str: string): boolean => {
    return hasMarkdownSyntax(str)
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

    if (isMarkdown(content)) {
      const processedContent = preprocessMarkdown(content)
      const html = parseMarkdown(processedContent)
      return sanitizeHtmlForMarkdown(html)
    }

    if (isHtml(content)) {
      return sanitizeHtml(content)
    }

    return textToHtml(content)
  }

  const contentIsHtml = isHtml(content) && !isMarkdown(content)

  if (contentIsHtml) {
    return (
      <div
        className={`email-body-html ${className}`}
        style={style}
        dangerouslySetInnerHTML={{ __html: renderContent() }}
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