/**
 * AI 摘要生成服务
 * 从邮件内容生成简短摘要
 * 用于邮件列表预览显示
 */
export async function generateSummary(content: string): Promise<string> {
  const sentences = content.replace(/<[^>]*>/g, '').split(/[.!?]+/).filter(s => s.trim())
  
  if (sentences.length === 0) return content.slice(0, 100)
  
  const firstSentence = sentences[0].trim()
  
  if (firstSentence.length <= 80) {
    return firstSentence + (content.length > firstSentence.length + 10 ? '...' : '')
  }
  
  return firstSentence.slice(0, 77) + '...'
}
