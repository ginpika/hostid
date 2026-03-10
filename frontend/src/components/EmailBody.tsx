import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { CSSProperties } from 'react'

interface EmailBodyProps {
  content: string
  className?: string
  style?: CSSProperties
}

export default function EmailBody({ content, className = '', style }: EmailBodyProps) {
  const isHtml = (str: string): boolean => {
    const htmlPattern = /<[a-zA-Z][^>]*>/
    return htmlPattern.test(str)
  }

  const isMarkdown = (str: string): boolean => {
    if (isHtml(str)) return false
    
    const markdownPatterns = [
      /^#{1,6}\s/m,
      /^\s*[-*+]\s/m,
      /^\s*\d+\.\s/m,
      /^\s*>/m,
      /\[.+\]\(.+\)/,
      /`[^`]+`/,
      /\*\*[^*]+\*\*/,
      /\*[^*]+\*/,
      /__[^_]+__/,
      /_[^_]+_/,
    ]
    
    return markdownPatterns.some(pattern => pattern.test(str))
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
        'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'mark',
        'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'ul', 'ol', 'li',
        'blockquote', 'pre', 'code',
        'a', 'img',
        'table', 'thead', 'tbody', 'tr', 'th', 'td',
        'div', 'span',
        'hr', 'sup', 'sub'
      ],
      ALLOWED_ATTR: [
        'href', 'src', 'alt', 'title', 'width', 'height',
        'style', 'class',
        'target', 'rel'
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

  const renderContent = () => {
    if (!content) {
      return ''
    }

    if (isHtml(content)) {
      return sanitizeHtml(content)
    }

    if (isMarkdown(content)) {
      const html = parseMarkdown(content)
      return sanitizeHtmlForMarkdown(html)
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

    return textToHtml(content)
  }

  const contentIsHtml = isHtml(content)

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
