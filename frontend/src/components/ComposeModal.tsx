/**
 * 撰写邮件弹窗组件
 * 全局邮件撰写弹窗，通过 ComposeContext 控制显示
 * 支持回复、回复全部和转发模式
 */
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
