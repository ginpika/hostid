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
