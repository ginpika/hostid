/**
 * 邮件摘要提取
 * 去除 HTML 标签后截取首句，用于邮件列表预览（纯规则实现，不依赖任何 AI 服务）
 */
const MAX_EXCERPT_LENGTH = 80

export function extractEmailExcerpt(content: string): string {
  const sentences = content.replace(/<[^>]*>/g, '').split(/[.!?]+/).filter(s => s.trim())

  if (sentences.length === 0) return content.slice(0, 100)

  const firstSentence = sentences[0].trim()

  if (firstSentence.length <= MAX_EXCERPT_LENGTH) {
    return firstSentence + (content.length > firstSentence.length + 10 ? '...' : '')
  }

  return firstSentence.slice(0, MAX_EXCERPT_LENGTH - 3) + '...'
}
