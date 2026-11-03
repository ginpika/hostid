[文档首页](./README.md) · [English](../sso-integration-nodejs.md) · **简体中文**

# Node.js SSO 集成

先阅读[共享会话 SSO](./sso.md)，完成 Cookie 配置，并了解登录、登出及会话限制。此示例保护 `GET /api/me`，对每个请求都在后端验证传入的 SSO Cookie。

## 运行

使用 Node.js 20 或更新版本。将以下内容保存为 `server.mjs`，替换 HostID 域名，使 `cookieName` 与实例配置一致。无需额外依赖。

```javascript
import http from 'node:http'

const sessionUrl = 'https://mail.example.com/api/sso/session'
const cookieName = 'sso_token'
const tokenPattern = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/

http.createServer(async (request, response) => {
  response.setHeader('Cache-Control', 'no-store')
  const reply = (status, body) => {
    response.writeHead(status, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify(body))
  }
  if (request.method !== 'GET' || request.url !== '/api/me') {
    return reply(404, { error: 'Not found' })
  }
  const pair = (request.headers.cookie || '').split(';')
    .map(part => part.trim()).find(part => part.startsWith(`${cookieName}=`))
  const token = pair?.slice(cookieName.length + 1)
  if (!token || token.length > 4096 || !tokenPattern.test(token)) {
    return reply(401, { error: 'Sign in required' })
  }
  try {
    const upstream = await fetch(sessionUrl, {
      headers: { Cookie: `${cookieName}=${token}`, Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
    })
    if (!upstream.ok) throw new Error('Upstream error')
    const session = await upstream.json()
    if (session?.authenticated !== true) {
      return reply(401, { error: 'Sign in required' })
    }
    if (typeof session.user?.id !== 'string' || !session.user.id) {
      throw new Error('Invalid session response')
    }
    return reply(200, session.user)
  } catch {
    return reply(503, { error: 'Session service unavailable' })
  }
}).listen(8080, '127.0.0.1')
```

```bash
node server.mjs
curl -i http://127.0.0.1:8080/api/me
```

没有会话的请求返回 401。在受信任的同级子域（例如 `app.example.com`）通过 HTTPS 反向代理该服务。在 HostID 配置共享 Cookie 域，再将浏览器导航至 `https://mail.example.com/login?redirect=https%3A%2F%2Fapp.example.com%2Fapi%2Fme`。

登录后，浏览器把共享 Cookie 发给应用，应用只把这一项 Cookie 转发给 HostID。验证通过才返回用户资料；上游异常返回 503，不授予访问权。执行受保护操作前，将返回的 ID 关联到应用自己的权限规则。

登出和可选本地会话见[公共指南](./sso.md#浏览器请求与登出)。上游地址只来自可信的后端配置，修改状态的路由需添加应用自己的 CSRF 防护。

接口依据：[SSO 路由](../../backend/src/routes/sso.ts)。
