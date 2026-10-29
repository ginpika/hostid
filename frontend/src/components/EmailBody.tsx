/**
 * 邮件正文渲染组件
 * 支持渲染 HTML、Markdown 和纯文本格式
 * 使用 DOMPurify 进行安全过滤，支持脚注和 front-matter
 */
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createEmailHtmlDocument } from '../lib/htmlEmail'
import { getMailContentFormat } from '../lib/mailContent'

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

  const contentFormat = getMailContentFormat(content)
  const contentIsHtml = contentFormat === 'html'
  const contentIsPlainText = contentFormat === 'text'

  // ---- iframe 渲染（仅用于 HTML 邮件，实现与主应用的样式隔离）----
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const roRef = useRef<ResizeObserver | null>(null)
  const [iframeHeight, setIframeHeight] = useState<number>(150)

  const iframeSrcDoc = useMemo(() => {
    if (!contentIsHtml) return ''
    return createEmailHtmlDocument(content)
  }, [content, contentIsHtml])

  const handleIframeLoad = useCallback(() => {
    const iframe = iframeRef.current
    if (!iframe) return
    const doc = iframe.contentDocument
    if (!doc) return

    // 清理上一次的观察者
    roRef.current?.disconnect()

    // 外链在新标签页打开；目录、脚注等片段链接留在当前邮件内。
    doc.querySelectorAll('a[href], area[href]').forEach(a => {
      const href = a.getAttribute('href') || ''
      if (href.startsWith('#')) {
        a.removeAttribute('target')
        a.addEventListener('click', event => {
          event.preventDefault()
          let id = href.slice(1)
          try { id = decodeURIComponent(id) } catch { /* Keep literal malformed escapes. */ }
          const target = id ? doc.getElementById(id) || doc.getElementsByName(id)[0] : doc.body
          target?.scrollIntoView({ block: 'start' })
        })
        return
      }
      a.setAttribute('target', '_blank')
      a.setAttribute('rel', 'noopener noreferrer')
    })

    // 根据内容高度自适应 iframe 高度
    // 先收起测量视口，避免 height/min-height:100% 继承上一封长邮件的高度。
    // 此时根元素的 scrollHeight 能包含正文外边距，也不会受旧视口高度影响。
    const adjustHeight = () => {
      const body = doc.body
      if (!body || iframe.contentDocument !== doc) return
      iframe.style.height = '0px'
      const h = Math.max(1, body.scrollHeight, body.offsetHeight, doc.documentElement.scrollHeight)
      iframe.style.height = `${h}px`
      setIframeHeight(h)
    }
    adjustHeight()
    // Fixed-height bodies need an explicit remeasure when native disclosure
    // widgets change only scrollHeight, leaving the observed border box intact.
    doc.addEventListener('toggle', adjustHeight, true)
    void doc.fonts.ready.then(adjustHeight)

    const ro = new ResizeObserver(adjustHeight)
    ro.observe(doc.body)
    roRef.current = ro

    // 同时监听已加载的图片，响应式 srcset 切换后仍可能再次触发 load。
    doc.querySelectorAll('img').forEach(img => {
      img.addEventListener('load', adjustHeight)
      img.addEventListener('error', adjustHeight)
    })
  }, [])

  // 组件卸载时清理 ResizeObserver
  useEffect(() => {
    return () => roRef.current?.disconnect()
  }, [])

  if (contentIsPlainText) {
    return <div className={`email-body ${className}`} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', ...style }}>{content}</div>
  }

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
      dangerouslySetInnerHTML={{ __html: sanitizeHtmlForMarkdown(parseMarkdown(preprocessMarkdown(content))) }}
    />
  )
}
