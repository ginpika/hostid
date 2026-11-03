[文档首页](./README.md) · [English](../oauth.md) · **简体中文**

# OAuth 2.0 集成

HostID 可以授权其他应用读取用户账户资料，也可以通过外部提供商让用户登录 HostID。这两种用途分别配置。

## 选择集成方式

| 需求 | 使用方式 |
| --- | --- |
| 自己的应用位于受信任的共同主域下，共享一次登录。 | [共享会话 SSO](./sso.md)。 |
| 应用需要独立客户端和用户授权，或位于不同主域。 | HostID 作为 OAuth 2.0 授权服务器，见下文。 |
| 使用外部账户登录 HostID。 | [外部提供商登录](#外部提供商登录)。 |

HostID 实现授权码、刷新令牌、S256 PKCE 和 Bearer 保护的 userinfo 接口。目前**不签发 `id_token`，也不提供 OpenID Connect discovery/JWKS**。虽然接受 `openid` scope，userinfo 也使用常见的字段名，接入时仍应选择通用 OAuth 2.0 客户端，而非仅支持 OIDC 的客户端。

## 注册应用

使用管理员登录，打开 **设置 → 应用授权**。创建应用，填写名称和至少一个绝对重定向 URI。回调的协议、主机、端口、路径和查询串均需与实际使用一致；HostID 对重定向 URI 进行精确匹配。

能够在后端保管密钥的应用选择**机密客户端**。公共客户端无法保密，必须使用 PKCE，且不能发送客户端密钥。创建接口默认创建机密客户端。应用管理仅限管理员，并非所有已登录用户都可操作。

保存客户端 ID，以及机密客户端在创建时显示的密钥。后续读取会隐藏密钥，重置时会显示一次新密钥。密钥只放在服务端配置中，不要写入前端代码。

## 端点

实例地址为 `https://mail.example.com` 时：

| 用途 | 方法与 URL |
| --- | --- |
| 授权 | `GET https://mail.example.com/api/oauth2/authorize` |
| 浏览器授权确认页 | `https://mail.example.com/oauth2/authorize` |
| 交换和刷新令牌 | `POST https://mail.example.com/api/oauth2/token` |
| 账户资料 | `GET` 或 `POST https://mail.example.com/api/oauth2/userinfo` |
| 授权服务器元数据 | `GET https://mail.example.com/.well-known/oauth-authorization-server` |

在系统设置中将 `siteUrl` 设为对外 HTTPS 地址。全量单镜像直接提供元数据路由；随附的分离镜像前端 Nginx 配置没有代理 `/.well-known/oauth-authorization-server`，会返回 SPA 页面。可直接填写上述端点；客户端需要 RFC 8414 元数据时，在反向代理增加精确路由，将该地址代理至后端。确认响应为 JSON，而非 HTML。这里提供的是 OAuth 授权服务器元数据，不是 OIDC discovery。

## 授权码与 PKCE

机密客户端也建议使用 S256 PKCE。每次登录生成新的随机 `state` 和 `code_verifier`，存入发起用户的服务端会话，并与这次尝试绑定，不能使用所有用户共享的全局值。

下面的 Node.js 片段在应用后端生成授权地址：

```javascript
import { createHash, randomBytes } from 'node:crypto'

const state = randomBytes(32).toString('base64url')
const verifier = randomBytes(32).toString('base64url')
const challenge = createHash('sha256').update(verifier).digest('base64url')
// 跳转前将 { state, verifier } 保存到该用户的服务端会话。
const params = new URLSearchParams({
  response_type: 'code',
  client_id: process.env.HOSTID_CLIENT_ID,
  redirect_uri: 'https://app.example.net/auth/callback',
  scope: 'profile email',
  state,
  code_challenge: challenge,
  code_challenge_method: 'S256',
})
const authorizationUrl = `https://mail.example.com/api/oauth2/authorize?${params}`
```

用户已登录 HostID 时，将浏览器导航至 `authorizationUrl`，请求会进入授权确认页，由用户允许或拒绝。

**当前登录衔接行为：** 未登录时直接访问授权确认路由，前端跳转到 `/login` 可能丢失授权查询参数。为保留参数，请从登录页开始，将完整授权确认路径编码到 `redirect`：

```javascript
const consentPath = `/oauth2/authorize?${params}`
const loginUrl = new URL('https://mail.example.com/login')
loginUrl.searchParams.set('redirect', consentPath)
// 将浏览器跳转至 loginUrl.href，登录后返回 consentPath。
```

若第三方登录中断了待处理授权，请在登录完成后重新发起授权流程。只有应用验证 state 并完成令牌交换，回调才算成功。

应用回调处理器应执行：

1. 要求存在未过期的登录尝试；成功和错误回调都先检查 `state`，缺失或不匹配则拒绝。
2. 一次性消费该尝试。存在 `error` 时停止；用户拒绝对应 `access_denied`。
3. 在后端使用相同 `redirect_uri` 和保存的 verifier 交换 `code`。授权码十分钟有效，只能使用一次。
4. 检查令牌响应成功，再携带访问令牌请求 userinfo。
5. 将返回的 `sub` 关联到应用账户，建立应用自己的安全会话；不能信任浏览器提交的资料对象作为登录凭据。

令牌请求使用 `application/x-www-form-urlencoded`：

```bash
curl --fail-with-body 'https://mail.example.com/api/oauth2/token' \
  --data-urlencode 'grant_type=authorization_code' \
  --data-urlencode "client_id=$HOSTID_CLIENT_ID" \
  --data-urlencode "client_secret=$HOSTID_CLIENT_SECRET" \
  --data-urlencode "code=$AUTHORIZATION_CODE" \
  --data-urlencode 'redirect_uri=https://app.example.net/auth/callback' \
  --data-urlencode "code_verifier=$CODE_VERIFIER"
```

示例使用 `client_secret_post`。机密客户端也可使用 `client_secret_basic`，即先对 ID 与密钥进行表单编码，再进行 Basic 编码；不要混用认证方式。公共客户端完全省略 `client_secret`，仍需提供 `client_id` 和 PKCE。

```json
{
  "access_token": "opaque-access-token",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "opaque-refresh-token",
  "scope": "profile email"
}
```

以响应中的实际授权 `scope` 为准。支持 `openid`、`profile`、`email`，省略时默认请求三者。不支持的 scope 会被移除；移除后没有有效 scope，则返回 `invalid_scope`。当前注册应用没有独立的 scope 允许列表来限制授权范围。

## 获取账户资料

```bash
curl --fail-with-body 'https://mail.example.com/api/oauth2/userinfo' \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

始终返回 `sub`。`profile` 增加 `name`、`preferred_username`、`username`、可选 `nickname`、`updated_at` 和可选 `picture`；`email` 增加 `email`，并为实例托管地址返回 `email_verified: true`。使用 `sub` 作为稳定标识。访问令牌是不透明字符串，不要按 JWT 解码，也不要传给 `/api/auth/me` 或 `/api/sso/verify`。

## 刷新与过期

```bash
curl --fail-with-body 'https://mail.example.com/api/oauth2/token' \
  --data-urlencode 'grant_type=refresh_token' \
  --data-urlencode "client_id=$HOSTID_CLIENT_ID" \
  --data-urlencode "client_secret=$HOSTID_CLIENT_SECRET" \
  --data-urlencode "refresh_token=$REFRESH_TOKEN"
```

公共客户端同样省略密钥。刷新令牌有效期为 30 天，每次成功刷新都会轮换。原子替换保存的访问令牌和刷新令牌，不要重用旧刷新令牌，也不要用同一令牌并发刷新。刷新时可以缩小 `scope`，不能扩大权限。

授权码与访问令牌存于进程内存，后端重启后失效；刷新令牌保存在数据库中，可以在重启后获取新访问令牌。多个 API 副本不共享内存授权记录。目前没有公开的撤销、令牌内省或 OAuth end-session 接口。[SSO 登出](./sso.md#浏览器请求与登出)不会撤销 OAuth 令牌，应用需独立清理自己的会话。

<a id="third-party-login"></a>

## 外部提供商登录

在 **设置 → 登录服务** 中配置提供商标识、显示名称、客户端 ID/密钥、授权 URL、令牌 URL、userinfo URL 与回调 URL。在外部提供商注册 `https://mail.example.com/api/oauth/<provider>/callback`，与填写的回调地址严格一致。新提供商默认停用，需要显式启用，最多同时启用三个。

HostID 使用授权码、S256 PKCE、绑定浏览器的 state、表单格式的 `client_secret_post` 令牌交换及 Bearer userinfo 请求。外部提供商需要兼容该流程，并返回 `sub` 或 `id` 作为主体标识。相关端点需明确填写，尚未实现提供商自动发现和 ID token 验证。

账户按「提供商 + 主体标识」关联，不会仅凭相同邮箱自动合并。首次使用者可选择本地用户名，也可先登录已有账户再绑定外部身份。添加外部提供商不会自动为其他服务创建 OAuth 应用。

实现依据：[OAuth 路由](../../backend/src/routes/oauthServer.ts)、[令牌有效期](../../backend/src/services/oauth2.ts)、[管理员应用管理](../../backend/src/routes/oauthApps.ts)、[外部登录](../../backend/src/routes/oauthClient.ts)和[前端授权确认](../../frontend/src/pages/OAuthAuthorizePage.tsx)。
