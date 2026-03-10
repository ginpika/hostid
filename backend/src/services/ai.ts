export async function generateSummary(content: string): Promise<string> {
  const sentences = content.replace(/<[^>]*>/g, '').split(/[.!?]+/).filter(s => s.trim())
  
  if (sentences.length === 0) return content.slice(0, 100)
  
  const firstSentence = sentences[0].trim()
  
  if (firstSentence.length <= 80) {
    return firstSentence + (content.length > firstSentence.length + 10 ? '...' : '')
  }
  
  return firstSentence.slice(0, 77) + '...'
}
