/**
 * 认证上下文
 * 提供用户登录状态、登录/注销方法
 * 支持 SSO 会话验证和用户信息管理
 */
import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react'

interface User {
  id: string
  email: string
  username: string
  nickname?: string | null
  avatar?: string | null
  language?: string
  role?: string
}

interface AuthContextType {
  user: User | null
  loading: boolean
  login: (username: string, password: string) => Promise<void>
  register: (username: string, password: string, turnstileToken?: string) => Promise<void>
  logout: () => Promise<void>
  checkSSOSession: () => Promise<boolean>
  setUser: (user: User | null) => void
}

const AuthContext = createContext<AuthContextType | null>(null)

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return context
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  const checkSSOSession = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch('/api/sso/session', { credentials: 'include' })
      const data = await res.json()
      return data.authenticated === true
    } catch {
      return false
    }
  }, [])

  useEffect(() => {
    const initAuth = async () => {
      const token = localStorage.getItem('token')
      if (token) {
        const ssoValid = await checkSSOSession()
        
        if (!ssoValid) {
          localStorage.removeItem('token')
          setUser(null)
          setLoading(false)
          return
        }
        
        try {
          const res = await fetch('/api/auth/me', {
            headers: { Authorization: `Bearer ${token}` }
          })
          
          if (res.ok) {
            const data = await res.json()
            setUser(data)
          } else {
            localStorage.removeItem('token')
            setUser(null)
          }
        } catch {
          localStorage.removeItem('token')
          setUser(null)
        }
      }
      setLoading(false)
    }
    
    initAuth()
  }, [checkSSOSession])

  const login = async (username: string, password: string) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ username, password })
    })
    
    if (!res.ok) {
      const data = await res.json()
      throw new Error(data.error || 'Login failed')
    }
    
    const data = await res.json()
    localStorage.setItem('token', data.token)
    setUser(data.user)
  }

  const register = async (username: string, password: string, turnstileToken?: string) => {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ username, password, turnstileToken })
    })
    
    if (!res.ok) {
      const data = await res.json()
      throw new Error(data.error || 'Registration failed')
    }
    
    const data = await res.json()
    localStorage.setItem('token', data.token)
    setUser(data.user)
  }

  const logout = async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include'
      })
    } catch (e) {
      // Ignore
    }
    localStorage.removeItem('token')
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, checkSSOSession, setUser }}>
      {children}
    </AuthContext.Provider>
  )
}
