/**
 * 撰写邮件上下文
 * 控制邮件撰写弹窗的显示状态
 * 支持回复、回复全部和转发模式数据传递
 */
import { createContext, useContext, useState, ReactNode } from 'react'

interface ComposeContextType {
  isOpen: boolean
  replyTo: any | null
  openCompose: (replyData?: any) => void
  closeCompose: () => void
}

const ComposeContext = createContext<ComposeContextType | undefined>(undefined)

export function ComposeProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)
  const [replyTo, setReplyTo] = useState<any | null>(null)

  const openCompose = (replyData?: any) => {
    setReplyTo(replyData || null)
    setIsOpen(true)
  }

  const closeCompose = () => {
    setIsOpen(false)
    setReplyTo(null)
  }

  return (
    <ComposeContext.Provider value={{ isOpen, replyTo, openCompose, closeCompose }}>
      {children}
    </ComposeContext.Provider>
  )
}

export function useCompose() {
  const context = useContext(ComposeContext)
  if (context === undefined) {
    throw new Error('useCompose must be used within a ComposeProvider')
  }
  return context
}
