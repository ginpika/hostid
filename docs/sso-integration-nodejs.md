# SelfHostMail SSO 集成指南

本文档指导如何将 SelfHostMail 作为 SSO 服务端，接入第三方客户端应用。

## 架构概述

```
┌─────────────────────┐                         ┌─────────────────────┐
│     SSO Server      │                         │     SSO Client      │
│     mail.a.com      │                         │     app.a.com       │
├─────────────────────┤                         ├─────────────────────┤
│ /api/sso/session    │◄──── Cookie ───────────►│   Check Session     │
│ /api/sso/login      │◄──── POST Form ────────►│   Submit Login      │
│ /api/sso/logout     │◄──── Cookie ───────────►│   User Logout       │
│ /login              │◄──── Browser Redirect ─►│   Login Page (GET)  │
└─────────────────────┘                         └─────────────────────┘
```

**重要说明：**
- `/login?redirect=xxx` 是前端页面路由，客户端应重定向浏览器到此页面
- `/api/sso/login` 是后端 API，仅用于前端页面提交登录表单（POST 请求）
- 客户端集成时只需使用 `/login?redirect=xxx` 和 `/api/sso/session`

## 登录流程

```
┌─────────────────┐                              ┌─────────────────┐
│  SSO Client     │                              │  SSO Server     │
│  app.a.com      │                              │  mail.a.com     │
└────────┬────────┘                              └────────┬────────┘
         │                                                │
         │  1. Check Session (Cookie)                     │
         │ ──────────────────────────────────────────────►│
         │                                                │
         │  2. Return: authenticated = false              │
         │ ◄──────────────────────────────────────────────│
         │                                                │
         │  3. Redirect to /sso/login?redirect=xxx        │
         │ ──────────────────────────────────────────────►│
         │                                                │
         │  4. User Login                                 │
         │                     (User enters credentials)  │
         │                                                │
         │  5. Set Cookie & Redirect back                 │
         │ ◄──────────────────────────────────────────────│
         │                                                │
         │  6. Check Session (Cookie)                     │
         │ ──────────────────────────────────────────────►│
         │                                                │
         │  7. Return: authenticated = true + user info   │
         │ ◄──────────────────────────────────────────────│
         │                                                │
```

## 前置条件

1. 所有应用必须在同一主域名下（如 `*.a.com`）
2. SSO 服务端已部署并可访问
3. 客户端应用支持 Cookie 跨域共享

## 环境配置

### SSO 服务端配置

```env
# .env
SSO_COOKIE_DOMAIN=.a.com          # 共享 Cookie 域名（注意前面的点）
SSO_COOKIE_NAME=sso_token         # Cookie 名称
SSO_COOKIE_PATH=/                 # Cookie 路径
SSO_COOKIE_SECURE=true            # 生产环境必须为 true
SSO_COOKIE_SAMESITE=lax           # 跨站点请求策略
SESSION_TTL=604800                # 会话有效期（秒）
```

### SSO 客户端配置

客户端无需特殊环境变量，只需确保：
- 能访问 SSO 服务端的 API
- 能处理 Cookie 共享

## API 接口

### 1. 验证登录态

**请求：**
```http
GET /api/sso/session HTTP/1.1
Host: mail.a.com
Cookie: sso_token=<token>
```

**响应（已登录）：**
```json
{
  "authenticated": true,
  "user": {
    "id": "clxxxx",
    "username": "user",
    "email": "user@a.com",
    "role": "user"
  }
}
```

**响应（未登录）：**
```json
{
  "authenticated": false
}
```

### 2. 登录

**请求：**
```http
POST /api/sso/login HTTP/1.1
Host: mail.a.com
Content-Type: application/json

{
  "username": "user",
  "password": "password"
}
```

**响应：**
```json
{
  "success": true,
  "user": {
    "id": "clxxxx",
    "username": "user",
    "email": "user@a.com",
    "role": "user"
  }
}
```

**注意：** 登录成功后会自动设置 `sso_token` Cookie。

### 3. 登出

**请求：**
```http
POST /api/sso/logout HTTP/1.1
Host: mail.a.com
Cookie: sso_token=<token>
```

**响应：**
```json
{
  "success": true
}
```

## 客户端集成步骤

### 步骤 1：检查登录态

在客户端应用启动时，检查 SSO 会话状态：

```javascript
async function checkSSOSession() {
  try {
    const response = await fetch('https://mail.a.com/api/sso/session', {
      credentials: 'include'  // 重要：携带跨域 Cookie
    })
    const data = await response.json()
    return data.authenticated ? data.user : null
  } catch (error) {
    console.error('SSO session check failed:', error)
    return null
  }
}
```

### 步骤 2：处理未登录状态

如果用户未登录，重定向到 SSO 登录页：

```javascript
function redirectToLogin() {
  const currentUrl = window.location.href
  const loginUrl = `https://mail.a.com/sso/login?redirect=${encodeURIComponent(currentUrl)}`
  window.location.href = loginUrl
}
```

### 步骤 3：处理登录回调

用户在 SSO 服务端登录后，会自动重定向回客户端应用。客户端需要：

1. 再次检查 SSO 会话状态
2. 获取用户信息
3. 创建本地会话（可选）

```javascript
async function handleLoginCallback() {
  const user = await checkSSOSession()
  if (user) {
    // 创建本地会话或存储用户信息
    localStorage.setItem('user', JSON.stringify(user))
    return true
  }
  return false
}
```

### 步骤 4：实现登出

```javascript
async function logout() {
  try {
    await fetch('https://mail.a.com/api/sso/logout', {
      method: 'POST',
      credentials: 'include'
    })
  } catch (error) {
    console.error('Logout failed:', error)
  }
  // 清除本地状态
  localStorage.removeItem('user')
  // 重定向到登录页
  redirectToLogin()
}
```

## 完整示例

### React 示例

```jsx
import { createContext, useContext, useState, useEffect } from 'react'

const SSOContext = createContext(null)

export function SSOProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    checkSession()
  }, [])

  const checkSession = async () => {
    try {
      const res = await fetch('https://mail.a.com/api/sso/session', {
        credentials: 'include'
      })
      const data = await res.json()
      if (data.authenticated) {
        setUser(data.user)
      } else {
        // 未登录，重定向到 SSO 登录页
        const currentUrl = window.location.href
        window.location.href = `https://mail.a.com/sso/login?redirect=${encodeURIComponent(currentUrl)}`
      }
    } catch (error) {
      console.error('SSO check failed:', error)
    } finally {
      setLoading(false)
    }
  }

  const logout = async () => {
    await fetch('https://mail.a.com/api/sso/logout', {
      method: 'POST',
      credentials: 'include'
    })
    setUser(null)
    window.location.href = 'https://mail.a.com/sso/login'
  }

  return (
    <SSOContext.Provider value={{ user, loading, logout }}>
      {children}
    </SSOContext.Provider>
  )
}

export const useSSO = () => useContext(SSOContext)
```

### Vue 示例

```javascript
// sso.js
export const sso = {
  async checkSession() {
    const res = await fetch('https://mail.a.com/api/sso/session', {
      credentials: 'include'
    })
    return res.json()
  },

  async logout() {
    await fetch('https://mail.a.com/api/sso/logout', {
      method: 'POST',
      credentials: 'include'
    })
  },

  redirectToLogin() {
    const currentUrl = window.location.href
    window.location.href = `https://mail.a.com/sso/login?redirect=${encodeURIComponent(currentUrl)}`
  }
}
```

## 路由守卫示例

### React Router

```jsx
import { Navigate, useLocation } from 'react-router-dom'
import { useSSO } from './SSOContext'

export function PrivateRoute({ children }) {
  const { user, loading } = useSSO()
  const location = useLocation()

  if (loading) {
    return <div>Loading...</div>
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  return children
}
```

### Vue Router

```javascript
router.beforeEach(async (to, from, next) => {
  if (to.meta.requiresAuth) {
    const { authenticated } = await sso.checkSession()
    if (!authenticated) {
      sso.redirectToLogin()
      return
    }
  }
  next()
})
```

## 注意事项

### 1. Cookie 跨域

确保所有应用在同一主域名下，Cookie 的 `domain` 属性设置为 `.a.com`（注意前面的点）。

### 2. HTTPS 要求

生产环境必须使用 HTTPS，否则 Cookie 的 `Secure` 属性会导致 Cookie 无法设置。

### 3. CORS 配置

SSO 服务端已配置 CORS 支持：

```javascript
app.use(cors({
  origin: true,
  credentials: true
}))
```

### 4. 会话同步

客户端应用应定期检查 SSO 会话状态，确保与服务端同步：

```javascript
// 每 5 分钟检查一次
setInterval(async () => {
  const { authenticated } = await checkSSOSession()
  if (!authenticated) {
    redirectToLogin()
  }
}, 5 * 60 * 1000)
```

### 5. 路由变化检查

在单页应用中，路由变化时也应检查会话状态：

```javascript
// React Router
useEffect(() => {
  const unsubscribe = history.listen(() => {
    checkSSOSession()
  })
  return unsubscribe
}, [])
```

## 故障排查

### Cookie 未设置

1. 检查 `SSO_COOKIE_DOMAIN` 配置
2. 确认使用 HTTPS
3. 检查浏览器 Cookie 设置

### 跨域请求失败

1. 确认 `credentials: 'include'` 已设置
2. 检查 CORS 配置
3. 确认 Cookie 的 `SameSite` 属性

### 会话丢失

1. 检查会话是否过期
2. 确认 Cookie 未被清除
3. 检查服务端日志

## 安全建议

1. **生产环境必须使用 HTTPS**
2. **设置合理的会话过期时间**
3. **敏感操作需要二次验证**
4. **记录登录日志用于审计**
5. **支持强制登出所有会话**
