[文档首页](./README.md) · [English](../sso.md) · **简体中文**

# 共享会话 SSO

HostID 的共享会话适用于受信任的同级子域，例如 `mail.example.com` 和 `app.example.com`。应用位于不同主域，或需要独立客户端凭据和授权时，请使用 [OAuth 2.0](./oauth.md)。

## 配置实例

在 **设置 → 系统设置** 中填写以下项目。设置保存在数据库中，对后续请求生效；旧环境变量仅在对应数据库设置缺失时导入一次。

| 设置键 | 示例 | 用途 |
| --- | --- | --- |
| `siteUrl` | `https://mail.example.com` | HostID 对外站点地址。 |
| `ssoCookieDomain` | `example.com` | 让受信任的同级子域共享 Cookie；留空则仅限 HostID 所在主机。 |
| `ssoCookieName` | `sso_token` | 应用端必须使用相同名称。 |
| `ssoCookiePath` | `/` | 让应用路由能够收到 Cookie。 |
| `ssoCookieSecure` | `true` | 通过 HTTPS 发送 Cookie。 |
| `ssoCookieSameSite` | `lax` | 适用于同站点 HTTPS 子域。 |
| `sessionTtl` | `604800` | 会话有效期，单位秒；默认七天。 |
| `ssoRateMax` / `ssoRateWindowMs` | `180` / `60000` | 每个 IP 在限流窗口内允许的 SSO 请求数；窗口单位毫秒。 |
| `corsAllowedOrigins` | `https://app.example.com` | 允许浏览器携带凭据请求的额外精确来源，多个来源用逗号分隔。 |
| `ssoLoginPageUrl` | 留空 | 默认为 `siteUrl + /login`；只有自定义登录页才需覆盖。 |

两个站点均使用 HTTPS。能够收到共享 Cookie 的所有子域都必须可信。`example.com` 前无需加点。`SameSite=None` 要求同时启用 `Secure`，但不能让不同主域共享 Cookie，也不能绕过浏览器对第三方 Cookie 的限制。

本地 HTTP 实验可使用同一主机、仅限主机的 Cookie 和 `ssoCookieSecure=false`。测试子域共享时，请使用自己控制的域名和 HTTPS。修改 Cookie 属性后重新登录，并清理域或路径冲突的旧 Cookie。

## 请求流程

1. 应用后端从浏览器请求中只读取已配置的 SSO Cookie。
2. 通过 HTTPS 将该 Cookie 转发至固定、可信的 HostID `/api/sso/session` 地址。
3. 仅当响应成功、`authenticated: true` 且 `user.id` 有效时允许访问。
4. 没有有效会话时，将浏览器跳转到 HostID 登录页。返回地址必须固定或经过允许列表校验。
5. 浏览器返回应用后，后端再次验证会话，然后提供受保护数据。

```text
浏览器 → app.example.com → mail.example.com/api/sso/session
                             ↓ authenticated: false
浏览器 ← 跳转 mail.example.com/login?redirect=...
浏览器 → HostID 登录 → app.example.com → 再次验证
```

浏览器跳转只负责导航，不能证明用户身份。浏览器中的状态、解码后的 JWT 内容，以及浏览器提交的用户对象都不能作为后端授权依据。不要让用户复制令牌，也不要把存入 `localStorage` 的身份数据当成授权机制。

## API 契约

下表路径均相对于 HostID 对外站点地址。

| 方法和路径 | 输入 | 响应 |
| --- | --- | --- |
| `GET /api/sso/session` | SSO Cookie | `{"authenticated": false}` 或 `{"authenticated": true, "user": {...}}`。 |
| `POST /api/sso/verify` | SSO Cookie，或 `Authorization: Bearer <SSO Cookie 中的令牌>` | `{"valid": false, "error": "..."}` 或 `{"valid": true, "user": {...}}`；不能通过 JSON 请求体传入令牌。 |
| `GET /login?redirect=...` | URL 编码后的返回地址 | 托管登录页面，随后浏览器跳转至返回地址。 |
| `GET /sso/login?redirect=...` | URL 编码后的返回地址 | 跳转至配置的登录页面。 |
| `POST /api/sso/logout` | SSO Cookie | 删除该会话并清除 Cookie，返回 `{"success": true}`。 |
| `POST /api/sso/login` | JSON `username`、`password` | 直接验证凭据，创建 SSO Cookie 并返回 `success` 和 `user`；应用集成优先使用托管登录页。 |

直接 SSO 登录接口与 `/api/auth/login` 不同，后者供 HostID 自带前端使用，要求其 RSA 加密密码格式。应用集成无需调用这两个凭据接口。

成功的会话响应如下；可选资料字段可能缺失或为 null：

```json
{
  "authenticated": true,
  "user": {
    "id": "user-id",
    "username": "alice",
    "email": "alice@example.com",
    "role": "user",
    "nickname": null,
    "avatar": null,
    "avatarUrl": null
  }
}
```

未认证时通常也返回 HTTP 200，只是标志为 false，因此不能只检查状态码。超时、非成功状态（含限流）、JSON 无法解析或响应不完整时，必须拒绝访问。只转发 SSO Cookie，不要原样转发整个 `Cookie` 请求头。上游地址应来自后端配置，不能由浏览器输入决定。

## 浏览器请求与登出

浏览器可以查询会话以展示界面状态；其来源必须加入 `corsAllowedOrigins`，请求还需携带凭据：

```javascript
const response = await fetch('https://mail.example.com/api/sso/session', {
  credentials: 'include',
})
if (!response.ok) throw new Error('Session service unavailable')
const session = await response.json()
// 仅用于界面展示；受保护请求仍须由应用后端验证。
```

CORS 允许已配置的 `siteUrl` 和额外精确来源，不会回显任意来源。服务端之间调用无需配置 CORS。CORS 不能替代认证，也不能替代应用自己的 CSRF 防护。

共享登出时，浏览器携带凭据 `POST /api/sso/logout`，检查成功后清理应用本地会话。若通过后端代理，代理只转发 SSO Cookie，并将上游 `Set-Cookie` 响应头传给浏览器，以删除匹配的共享 Cookie。保留已配置的域和路径，不要用仅限应用主机的删除 Cookie 代替。

共享登出会使当前 SSO 会话失效，不会自动撤销 OAuth 令牌、独立的 HostID API JWT、所有设备会话或各应用自行创建的本地会话。建立本地会话的应用须自行制定有效期与重新验证策略。

## 有效期与权限

SSO 会话保存在进程内存中，后端重启后会消失，多个 API 副本之间也不共享会话。Cookie 和内存记录使用 `sessionTtl`，但签名 SSO 令牌目前固定七天过期。因此即使设置更长，有效期仍不会超过令牌的七天上限。

会话中的 `username`、`email`、`role` 是登录时的快照；`nickname` 和头像在查询时读取。账户变更后重新认证才能刷新快照。使用 `user.id` 关联应用账户，并执行应用自己的权限规则；HostID 的 `admin` 角色不必自动获得应用管理员权限。

## 服务端示例

- [Node.js](./sso-integration-nodejs.md)：内置 HTTP 服务与 `fetch`。
- [Go](./sso-integration-go.md)：标准库 HTTP 处理器。
- [Java](./sso-integration-java.md)：JDK HTTP 服务与 Jackson。
- [Rust](./sso-integration-rust.md)：Axum 与 Reqwest。

示例逐次验证受保护请求，异常时拒绝访问。使用前替换示例域名。部署与反向代理见 [Docker 部署](./docker.md)。

实现依据：[SSO 路由](../../backend/src/routes/sso.ts)、[系统设置](../../backend/src/services/settings.ts)、[CORS 策略](../../backend/src/middleware/security.ts)与[会话存储](../../backend/src/store/MemoryStore.ts)。
