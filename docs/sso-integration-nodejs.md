[Documentation](./README.md) · **English** · [简体中文](./zh-CN/sso-integration-nodejs.md)

# Node.js SSO integration

Start with [shared-session SSO](./sso.md) for cookie configuration, login, logout and session limits. This example protects `GET /api/me` by validating the incoming SSO cookie on the backend for every request.

## Run

Use Node.js 20 or newer. Save the following as `server.mjs`, replace the HostID domain and match `cookieName` to your instance. No additional packages are needed.

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

A request without a session returns 401. Place this server behind HTTPS at a trusted sibling domain such as `app.example.com`. Configure the shared cookie domain in HostID, then send the browser to `https://mail.example.com/login?redirect=https%3A%2F%2Fapp.example.com%2Fapi%2Fme`.

After login, the browser sends the shared cookie to the application, which forwards only that cookie to HostID. A validated response returns user data. Upstream failures return 503 without granting access. Map the returned ID to your own application permissions before performing protected operations.

For logout and optional local sessions, follow the [common guide](./sso.md#browser-requests-and-logout). Keep upstream URLs in trusted server configuration and add your own CSRF protection for state-changing routes.

Contract: [SSO routes](../backend/src/routes/sso.ts).
