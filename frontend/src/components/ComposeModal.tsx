import { useCompose } from '../contexts/ComposeContext'
import ComposeEmail from './ComposeEmail'

export default function ComposeModal() {
  const { isOpen, replyTo, closeCompose } = useCompose()

  if (!isOpen) return null

  return (
    <ComposeEmail
      onClose={closeCompose}
      onSent={closeCompose}
      replyData={replyTo}
    />
  )
}
