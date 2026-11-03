[Documentation](./README.md) · **English** · [简体中文](./zh-CN/sso-integration-rust.md)

# Rust SSO integration

Configure [shared-session SSO](./sso.md) first. This example uses Axum and Reqwest to validate the incoming shared cookie on the backend for every `GET /api/me` request.

## Project

Create a Rust binary project and use this `Cargo.toml`:

```toml
[package]
name = "hostid-sso-example"
version = "0.1.0"
edition = "2021"

[dependencies]
axum = "0.8"
reqwest = { version = "0.12", default-features = false, features = ["json", "rustls-tls"] }
serde = { version = "1", features = ["derive"] }
tokio = { version = "1", features = ["macros", "rt-multi-thread", "net"] }
```

Save the following as `src/main.rs`, replacing `SESSION_URL` and matching `COOKIE_NAME` to your instance:

```rust
use axum::{
    extract::State,
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;

const SESSION_URL: &str = "https://mail.example.com/api/sso/session";
const COOKIE_NAME: &str = "sso_token";

#[derive(Deserialize, Serialize)]
struct User { id: String, username: String, email: String, role: String }
#[derive(Deserialize)]
struct Session { authenticated: bool, user: Option<User> }

fn deny(status: StatusCode) -> Response {
    (status, [(header::CACHE_CONTROL, "no-store")], "Access denied").into_response()
}

async fn me(State(client): State<Client>, headers: HeaderMap) -> Response {
    let prefix = format!("{COOKIE_NAME}=");
    let token = headers.get_all(header::COOKIE).iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|v| v.split(';'))
        .find_map(|v| v.trim().strip_prefix(prefix.as_str()))
        .map(str::to_owned);
    let Some(token) = token else { return deny(StatusCode::UNAUTHORIZED) };
    let valid = token.len() <= 4096 && token.split('.').count() == 3
        && token.split('.').all(|part| !part.is_empty()
            && part.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_'));
    if !valid { return deny(StatusCode::UNAUTHORIZED); }

    let result = client.get(SESSION_URL)
        .header("Cookie", format!("{COOKIE_NAME}={token}"))
        .header("Accept", "application/json").send().await;
    let Ok(upstream) = result else { return deny(StatusCode::SERVICE_UNAVAILABLE) };
    if upstream.status() != reqwest::StatusCode::OK {
        return deny(StatusCode::SERVICE_UNAVAILABLE);
    }
    let Ok(session) = upstream.json::<Session>().await else {
        return deny(StatusCode::SERVICE_UNAVAILABLE);
    };
    if !session.authenticated { return deny(StatusCode::UNAUTHORIZED); }
    let Some(user) = session.user else { return deny(StatusCode::SERVICE_UNAVAILABLE) };
    if user.id.is_empty() { return deny(StatusCode::SERVICE_UNAVAILABLE); }
    ([(header::CACHE_CONTROL, "no-store")], Json(user)).into_response()
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let client = Client::builder().timeout(Duration::from_secs(5))
        .redirect(reqwest::redirect::Policy::none()).build()?;
    let app = Router::new().route("/api/me", get(me)).with_state(client);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:8080").await?;
    axum::serve(listener, app).await?;
    Ok(())
}
```

```bash
cargo run
```

Expose the server through HTTPS at `app.example.com`, with HostID at `mail.example.com` and a shared cookie domain of `example.com`. Start login at `https://mail.example.com/login?redirect=https%3A%2F%2Fapp.example.com%2Fapi%2Fme`.

Only the chosen SSO cookie is forwarded. Missing/invalid sessions return 401; timeouts, redirects, upstream errors or malformed responses never grant access. Use the returned user ID for application-specific permission checks.

For [logout and local sessions](./sso.md#browser-requests-and-logout), follow the common guide. Add CSRF protection to state-changing routes and keep upstream URLs in trusted server configuration.

Contract: [SSO routes](../backend/src/routes/sso.ts).
