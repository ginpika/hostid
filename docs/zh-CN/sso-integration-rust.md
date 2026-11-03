[文档首页](./README.md) · [English](../sso-integration-rust.md) · **简体中文**

# Rust SSO 集成

先配置[共享会话 SSO](./sso.md)。示例使用 Axum 和 Reqwest，对每个 `GET /api/me` 请求都在后端验证传入的共享 Cookie。

## 项目

创建 Rust 二进制项目，使用以下 `Cargo.toml`：

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

将以下代码保存为 `src/main.rs`，替换 `SESSION_URL`，使 `COOKIE_NAME` 与实例配置一致：

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

通过 HTTPS 将服务暴露为 `app.example.com`，HostID 位于 `mail.example.com`，共享 Cookie 域设为 `example.com`。从 `https://mail.example.com/login?redirect=https%3A%2F%2Fapp.example.com%2Fapi%2Fme` 发起登录。

只转发指定 SSO Cookie。缺少或无效会话返回 401；超时、重定向、上游错误或响应格式异常时均不授予访问权。使用返回的用户 ID 执行应用自己的权限检查。

[登出与本地会话](./sso.md#浏览器请求与登出)见公共指南。修改状态的路由需增加 CSRF 防护，上游地址只来自可信的服务端配置。

接口依据：[SSO 路由](../../backend/src/routes/sso.ts)。
