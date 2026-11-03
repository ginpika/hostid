[Documentation](./README.md) · **English** · [简体中文](./zh-CN/sso.md)

# Shared-session SSO

Use HostID's shared session for applications on trusted sibling subdomains, such as `mail.example.com` and `app.example.com`. For applications on unrelated domains, or applications that need separate client credentials and grants, use [OAuth 2.0](./oauth.md).

## Configure the instance

In **Settings → System Settings**, set the following values. These settings are stored in the database and apply to new requests; environment variables with the old names are imported only when the corresponding database setting is missing.

| Setting key | Example | Purpose |
| --- | --- | --- |
| `siteUrl` | `https://mail.example.com` | Public HostID origin. |
| `ssoCookieDomain` | `example.com` | Share the cookie with trusted sibling subdomains. Empty means HostID's host only. |
| `ssoCookieName` | `sso_token` | Use the same name in your application. |
| `ssoCookiePath` | `/` | Make the cookie available to application routes. |
| `ssoCookieSecure` | `true` | Send the cookie over HTTPS. |
| `ssoCookieSameSite` | `lax` | Suitable for same-site HTTPS subdomains. |
| `sessionTtl` | `604800` | Session lifetime in seconds; default: seven days. |
| `ssoRateMax` / `ssoRateWindowMs` | `180` / `60000` | SSO requests allowed per IP and rate-limit window in milliseconds. |
| `corsAllowedOrigins` | `https://app.example.com` | Additional exact origins allowed to make credentialed browser requests; comma-separated. |
| `ssoLoginPageUrl` | Leave empty | Defaults to `siteUrl + /login`; override only for a custom login page. |

Use HTTPS on both sites. All subdomains that can receive the shared cookie must be trusted. A leading dot in `example.com` is unnecessary. `SameSite=None` requires `Secure`, but does not enable cookie sharing across unrelated domains or bypass browser third-party-cookie restrictions.

For local HTTP experiments, use one host and a host-only cookie, with `ssoCookieSecure=false`. For a realistic shared-subdomain test, use HTTPS names under a domain you control. Log out and back in after changing cookie attributes, and remove old cookies with conflicting domain/path values.

## Request flow

1. The application backend reads only the configured SSO cookie from the incoming browser request.
2. It forwards that cookie to the fixed, trusted HostID `/api/sso/session` endpoint over HTTPS.
3. It grants access only after a successful response with `authenticated: true` and a usable `user.id`.
4. A missing or invalid session returns the user to HostID's login page. Use a fixed or allowlisted application return URL.
5. After returning, validate the session again on the backend before serving protected data.

```text
Browser → app.example.com → mail.example.com/api/sso/session
                              ↓ authenticated: false
Browser ← redirect to mail.example.com/login?redirect=...
Browser → HostID login → app.example.com → validate again
```

A browser redirect is navigation, not proof of authentication. Browser state, decoded JWT contents and a user object sent by the browser cannot authorize requests. Do not ask users to copy tokens or put identity data in `localStorage` as an authorization mechanism.

## API contract

All paths below are relative to your HostID public origin.

| Method and path | Input | Response |
| --- | --- | --- |
| `GET /api/sso/session` | SSO cookie | `{"authenticated": false}` or `{"authenticated": true, "user": {...}}`. |
| `POST /api/sso/verify` | SSO cookie, or `Authorization: Bearer <SSO-cookie-token>` | `{"valid": false, "error": "..."}` or `{"valid": true, "user": {...}}`. The JSON body is not used to supply the token. |
| `GET /login?redirect=...` | URL-encoded return URL | Hosted login page, then browser navigation to the return URL. |
| `GET /sso/login?redirect=...` | URL-encoded return URL | Redirects to the configured login page. |
| `POST /api/sso/logout` | SSO cookie | Invalidates that session and clears the cookie; returns `{"success": true}`. |
| `POST /api/sso/login` | JSON `username`, `password` | Direct credentials endpoint; creates an SSO cookie and returns `success` and `user`. Prefer the hosted login page for integrations. |

The direct SSO login endpoint differs from `/api/auth/login`, which is used by HostID's own frontend and expects its RSA-encrypted password format. Integrations do not need either credentials API.

A successful session response has this shape; optional profile values can be absent or null:

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

An unauthenticated session normally returns HTTP 200 with a false flag. HTTP status alone is insufficient. Treat timeouts, non-success status codes (including rate limiting), invalid JSON and incomplete responses as denial of access. Forward only the SSO cookie, never the incoming `Cookie` header wholesale. Keep upstream URLs in server configuration, rather than deriving them from browser input.

## Browser requests and logout

A browser can query the session for display, provided its origin is in `corsAllowedOrigins` and the request includes credentials:

```javascript
const response = await fetch('https://mail.example.com/api/sso/session', {
  credentials: 'include',
})
if (!response.ok) throw new Error('Session service unavailable')
const session = await response.json()
// Display state only. Your own backend must still validate protected requests.
```

CORS allows the configured `siteUrl` and extra exact origins; it does not reflect arbitrary origins. Server-to-server calls do not require CORS configuration. CORS is not a replacement for authentication or your application's CSRF protection.

For shared logout, make a credentialed browser `POST` to `/api/sso/logout`, check success and clear your application's local session. A server-side proxy must forward only the SSO cookie and relay the upstream `Set-Cookie` header to the browser so it can remove the matching shared cookie. Preserve the configured domain/path attributes. Do not replace it with a host-only deletion cookie.

Shared logout invalidates the current SSO session. It does not automatically revoke OAuth tokens, the separate HostID API JWT, every device's session, or independently created application sessions. Applications that create local sessions must define their own expiration and revalidation policy.

## Lifetime and permissions

SSO sessions live in process memory. A backend restart removes them; multiple API replicas do not share sessions. The cookie and memory record use `sessionTtl`, while the signed SSO token currently expires after seven days. Effective lifetime cannot exceed that seven-day token lifetime, even if a larger setting is saved.

Session `username`, `email` and `role` are snapshots from login; `nickname` and avatar are looked up when the session is checked. Re-authenticate to refresh the snapshot after account changes. Map `user.id` to your application's account and apply its own permissions. A HostID `admin` role does not have to imply administrator access in your application.

## Server examples

- [Node.js](./sso-integration-nodejs.md) — built-in HTTP server and `fetch`.
- [Go](./sso-integration-go.md) — standard-library HTTP handler.
- [Java](./sso-integration-java.md) — JDK HTTP server and Jackson.
- [Rust](./sso-integration-rust.md) — Axum and Reqwest.

The examples validate each protected request and fail closed. Replace the example domains before using them. For deployment and reverse proxies, see [Docker deployment](./docker.md).

Source of truth: [SSO routes](../backend/src/routes/sso.ts), [system settings](../backend/src/services/settings.ts), [CORS policy](../backend/src/middleware/security.ts) and [session storage](../backend/src/store/MemoryStore.ts).
