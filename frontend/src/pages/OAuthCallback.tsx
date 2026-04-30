/**
 * OAuth 回调处理页面
 * 处理 OAuth 登录成功后的回调
 * 保存 Token 和用户信息，跳转到目标页面
 */
import { useEffect, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

interface OAuthUser {
  id: string
  email: string
  username: string
  nickname?: string | null
  avatar?: string | null
  language?: string | null
  role: string
}

export default function OAuthCallback() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { setUser } = useAuth()
  const [error, setError] = useState('')

  useEffect(() => {
    const token = searchParams.get('token')
    const userStr = searchParams.get('user')
    const redirect = searchParams.get('redirect') || '/'

    if (!token || !userStr) {
      setError('Invalid OAuth callback: missing parameters')
      return
    }

    try {
      const user = JSON.parse(decodeURIComponent(userStr)) as OAuthUser
      
      localStorage.setItem('token', token)
      
      setUser({
        id: user.id,
        email: user.email,
        username: user.username,
        nickname: user.nickname || null,
        avatar: user.avatar || null,
        language: (user.language as 'zh-CN' | 'en-US') || 'zh-CN',
        role: user.role
      })

      const loginUrl = `/login?redirect=${encodeURIComponent(redirect)}&oauth_success=true`
      navigate(loginUrl, { replace: true })
    } catch (e) {
      console.error('OAuth callback error:', e)
      setError('Failed to process OAuth login')
    }
  }, [searchParams, navigate, setUser])

  if (error) {
    return (
      <div 
        className="min-h-screen flex items-center justify-center"
        style={{ backgroundColor: 'var(--color-bg-primary)' }}
      >
        <div className="text-center">
          <div 
            className="mb-4 p-4 rounded-lg"
            style={{ 
              backgroundColor: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              color: '#ef4444'
            }}
          >
            {error}
          </div>
          <button
            onClick={() => navigate('/login')}
            className="px-4 py-2 rounded-lg font-medium transition-colors"
            style={{ 
              backgroundColor: 'var(--color-accent-primary)', 
              color: 'var(--color-accent-text)' 
            }}
          >
            Back to Login
          </button>
        </div>
      </div>
    )
  }

  return (
    <div 
      className="min-h-screen flex items-center justify-center"
      style={{ backgroundColor: 'var(--color-bg-primary)' }}
    >
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 mx-auto mb-4" style={{ borderColor: 'var(--color-accent-primary)' }}></div>
        <p style={{ color: 'var(--color-text-secondary)' }}>Processing login...</p>
      </div>
    </div>
  )
}
