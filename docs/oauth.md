[Documentation](./README.md) · **English** · [简体中文](./zh-CN/oauth.md)

# OAuth 2.0 integration

HostID can authorize other applications to retrieve a user's account information. It can also use an external provider to sign users into HostID. These are separate configurations.

## Choose an integration

| Need | Use |
| --- | --- |
| Your own applications share a trusted parent domain and one login session. | [Shared-session SSO](./sso.md). |
| Applications need individual clients and consent, or run on unrelated domains. | HostID as an OAuth 2.0 authorization server, described below. |
| Users should sign into HostID with an external account. | [External provider login](#external-provider-login). |

HostID implements authorization code and refresh token grants, S256 PKCE and a Bearer-protected userinfo endpoint. It does **not** issue an `id_token` or publish OpenID Connect discovery/JWKS. Although `openid` is an accepted scope and userinfo uses familiar claim names, configure a generic OAuth 2.0 client, rather than an OIDC-only client.

## Register an application

Sign in as an administrator and open **Settings → App access**. Create an application with a name and one or more absolute redirect URIs. Register the exact callback, including scheme, host, port, path and query. HostID compares redirect URIs exactly.

Choose a **confidential client** for an application with a backend that can keep a secret. Public clients cannot keep a secret and must use PKCE; they must not send a client secret. The creation API defaults to confidential clients. Client management is restricted to administrators, not every signed-in user.

Save the client ID and, for confidential clients, the secret displayed on creation. The secret is masked on later reads; resetting it displays a replacement once. Keep it in server configuration, never in frontend code.

## Endpoints

For an instance at `https://mail.example.com`:

| Purpose | Method and URL |
| --- | --- |
| Authorization | `GET https://mail.example.com/api/oauth2/authorize` |
| Browser consent page | `https://mail.example.com/oauth2/authorize` |
| Token exchange and refresh | `POST https://mail.example.com/api/oauth2/token` |
| Account information | `GET` or `POST https://mail.example.com/api/oauth2/userinfo` |
| Authorization-server metadata | `GET https://mail.example.com/.well-known/oauth-authorization-server` |

Set `siteUrl` to the public HTTPS origin in system settings. The full image serves the metadata route directly. The supplied split-image frontend Nginx configuration does not proxy `/.well-known/oauth-authorization-server`; it falls back to the SPA. Use the explicit endpoints above, or add an exact proxy route to the backend if your client needs RFC 8414 metadata. Verify that metadata returns JSON, not HTML. This is OAuth authorization-server metadata, not OIDC discovery.

## Authorization code with PKCE

Use S256 PKCE for confidential clients too. Keep a fresh random `state` and `code_verifier` in the initiating user's server-side session, associated with this login attempt. Never use a global value shared by all users.

This Node.js snippet constructs an authorization URL; it runs on your application's backend:

```javascript
import { createHash, randomBytes } from 'node:crypto'

const state = randomBytes(32).toString('base64url')
const verifier = randomBytes(32).toString('base64url')
const challenge = createHash('sha256').update(verifier).digest('base64url')
// Save { state, verifier } in this user's server-side session before redirecting.
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

Navigate the browser to `authorizationUrl` once the user is signed into HostID. It hands the request to the consent page; the user approves or denies the request.

**Current login handoff:** visiting the consent route while signed out can lose the authorization query when the frontend redirects to `/login`. To preserve it, begin at the login page with the entire consent path encoded as `redirect`:

```javascript
const consentPath = `/oauth2/authorize?${params}`
const loginUrl = new URL('https://mail.example.com/login')
loginUrl.searchParams.set('redirect', consentPath)
// Redirect the browser to loginUrl.href; login then returns to consentPath.
```

If third-party login interrupts the pending authorization, restart the authorization attempt after signing in. The callback is not successful until your application validates state and completes the token exchange.

On your application's callback:

1. Require a stored, unexpired login attempt; reject a missing or mismatched `state` before handling either success or error.
2. Consume the attempt once. If `error` is present, stop; user denial returns `access_denied`.
3. Exchange `code` on the backend, with the same `redirect_uri` and saved verifier. Codes expire after ten minutes and can be used once.
4. Require a successful token response, then request userinfo with its access token.
5. Map the returned `sub` to an application account and establish your own secure session. Do not accept a browser-supplied profile as proof of login.

Send token requests as `application/x-www-form-urlencoded`:

```bash
curl --fail-with-body 'https://mail.example.com/api/oauth2/token' \
  --data-urlencode 'grant_type=authorization_code' \
  --data-urlencode "client_id=$HOSTID_CLIENT_ID" \
  --data-urlencode "client_secret=$HOSTID_CLIENT_SECRET" \
  --data-urlencode "code=$AUTHORIZATION_CODE" \
  --data-urlencode 'redirect_uri=https://app.example.net/auth/callback' \
  --data-urlencode "code_verifier=$CODE_VERIFIER"
```

This example uses `client_secret_post`. Confidential clients can instead use `client_secret_basic` (form-encode the ID and secret before Basic encoding); do not combine authentication methods. For a public client omit `client_secret` entirely and include `client_id` and PKCE.

```json
{
  "access_token": "opaque-access-token",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "opaque-refresh-token",
  "scope": "profile email"
}
```

Use actual granted `scope` from the response. Supported scopes are `openid`, `profile` and `email`; an omitted scope defaults to all three. Unsupported scope names are removed; if none remain, the request fails with `invalid_scope`. Registered applications do not currently restrict grants with a per-app scope allowlist.

## Retrieve account information

```bash
curl --fail-with-body 'https://mail.example.com/api/oauth2/userinfo' \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

`sub` is always returned. `profile` adds `name`, `preferred_username`, `username`, optional `nickname`, `updated_at` and optional `picture`. `email` adds `email` and `email_verified: true` for the instance-hosted address. Use `sub` as the stable identifier. Access tokens are opaque; do not decode them as JWTs or pass them to `/api/auth/me` or `/api/sso/verify`.

## Refresh and expiration

```bash
curl --fail-with-body 'https://mail.example.com/api/oauth2/token' \
  --data-urlencode 'grant_type=refresh_token' \
  --data-urlencode "client_id=$HOSTID_CLIENT_ID" \
  --data-urlencode "client_secret=$HOSTID_CLIENT_SECRET" \
  --data-urlencode "refresh_token=$REFRESH_TOKEN"
```

Public clients again omit the secret. Refresh tokens expire after 30 days and rotate on every successful refresh. Atomically replace the stored access and refresh token pair; do not reuse the old refresh token or issue parallel refreshes with it. A refresh may narrow `scope`, but cannot add permissions.

Authorization codes and access tokens are held in process memory and disappear on backend restart. Refresh tokens are stored in the database and can obtain fresh access tokens after a restart. Multiple API replicas do not share the in-memory grants. There is currently no public revocation, introspection, or OAuth end-session endpoint. [SSO logout](./sso.md#browser-requests-and-logout) does not revoke OAuth tokens; clear your application's own session independently.

<a id="third-party-login"></a>

## External provider login

In **Settings → Sign-in providers**, configure the provider identifier, display name, client ID/secret, authorization URL, token URL, userinfo URL and callback URL. Register `https://mail.example.com/api/oauth/<provider>/callback` at the external provider, matching the configured callback exactly. New providers start disabled; enable them explicitly. Up to three providers can be active.

HostID uses authorization code, S256 PKCE, a browser-bound state value, form-encoded `client_secret_post` token exchange and a Bearer userinfo request. The external provider must support that flow and return `sub` or `id` as a subject identifier. These custom endpoints are configured explicitly; provider discovery and ID-token validation are not implemented.

Accounts are linked by provider plus subject, not automatically by matching email. A first-time user can select a local username or bind the external identity after signing into an existing account. Registering an external provider does not create an OAuth application for your other services.

Source of truth: [OAuth routes](../backend/src/routes/oauthServer.ts), [token lifetimes](../backend/src/services/oauth2.ts), [admin-only applications](../backend/src/routes/oauthApps.ts), [external login](../backend/src/routes/oauthClient.ts) and [frontend consent](../frontend/src/pages/OAuthAuthorizePage.tsx).
