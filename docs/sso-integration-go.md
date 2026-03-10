# HostID SSO 集成指南 (Go)

本文档指导如何将 HostID 作为 SSO 服务端，接入 Go 客户端应用。

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

## 前置条件

1. 所有应用必须在同一主域名下（如 `*.a.com`）
2. SSO 服务端已部署并可访问
3. Go 1.21+ 环境

## 环境配置

### SSO 服务端配置

```env
# .env
SSO_COOKIE_DOMAIN=.a.com
SSO_COOKIE_NAME=sso_token
SSO_COOKIE_PATH=/
SSO_COOKIE_SECURE=true
SSO_COOKIE_SAMESITE=lax
SESSION_TTL=604800
```

## API 接口

### 1. 验证登录态

```http
GET /api/sso/session HTTP/1.1
Host: mail.a.com
Cookie: sso_token=<token>
```

**响应：**
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

### 2. 登录

```http
POST /api/sso/login HTTP/1.1
Host: mail.a.com
Content-Type: application/json

{
  "username": "user",
  "password": "password"
}
```

### 3. 登出

```http
POST /api/sso/logout HTTP/1.1
Host: mail.a.com
Cookie: sso_token=<token>
```

## Go 集成示例

### 1. 项目结构

```
.
├── main.go
├── config/
│   └── config.go
├── sso/
│   ├── client.go
│   ├── middleware.go
│   └── types.go
└── handlers/
    └── handlers.go
```

### 2. 配置

```go
// config/config.go
package config

type Config struct {
    SSOServerURL string `env:"SSO_SERVER_URL" envDefault:"https://mail.a.com"`
    ServerPort   string `env:"SERVER_PORT" envDefault:":8080"`
}

func Load() (*Config, error) {
    cfg := &Config{}
    if err := env.Parse(cfg); err != nil {
        return nil, err
    }
    return cfg, nil
}
```

### 3. SSO 类型定义

```go
// sso/types.go
package sso

type User struct {
    ID       string `json:"id"`
    Username string `json:"username"`
    Email    string `json:"email"`
    Role     string `json:"role"`
}

type SessionResponse struct {
    Authenticated bool  `json:"authenticated"`
    User          *User `json:"user,omitempty"`
}

type LoginRequest struct {
    Username string `json:"username"`
    Password string `json:"password"`
}

type LoginResponse struct {
    Success bool  `json:"success"`
    User    *User `json:"user,omitempty"`
}
```

### 4. SSO 客户端

```go
// sso/client.go
package sso

import (
    "bytes"
    "encoding/json"
    "fmt"
    "io"
    "net/http"
    "net/url"
    "time"
)

type Client struct {
    serverURL string
    httpClient *http.Client
}

func NewClient(serverURL string) *Client {
    return &Client{
        serverURL: serverURL,
        httpClient: &http.Client{
            Timeout: 10 * time.Second,
        },
    }
}

func (c *Client) CheckSession(token string) (*SessionResponse, error) {
    req, err := http.NewRequest("GET", c.serverURL+"/api/sso/session", nil)
    if err != nil {
        return nil, err
    }
    
    req.AddCookie(&http.Cookie{
        Name:  "sso_token",
        Value: token,
    })
    
    resp, err := c.httpClient.Do(req)
    if err != nil {
        return nil, err
    }
    defer resp.Body.Close()
    
    var session SessionResponse
    if err := json.NewDecoder(resp.Body).Decode(&session); err != nil {
        return nil, err
    }
    
    return &session, nil
}

func (c *Client) Login(username, password string) (*LoginResponse, error) {
    body, _ := json.Marshal(LoginRequest{
        Username: username,
        Password: password,
    })
    
    req, err := http.NewRequest("POST", c.serverURL+"/api/sso/login", bytes.NewReader(body))
    if err != nil {
        return nil, err
    }
    req.Header.Set("Content-Type", "application/json")
    
    resp, err := c.httpClient.Do(req)
    if err != nil {
        return nil, err
    }
    defer resp.Body.Close()
    
    var loginResp LoginResponse
    if err := json.NewDecoder(resp.Body).Decode(&loginResp); err != nil {
        return nil, err
    }
    
    return &loginResp, nil
}

func (c *Client) Logout(token string) error {
    req, err := http.NewRequest("POST", c.serverURL+"/api/sso/logout", nil)
    if err != nil {
        return err
    }
    
    req.AddCookie(&http.Cookie{
        Name:  "sso_token",
        Value: token,
    })
    
    _, err = c.httpClient.Do(req)
    return err
}

func (c *Client) GetLoginURL(redirectURL string) string {
    return fmt.Sprintf("%s/sso/login?redirect=%s", c.serverURL, url.QueryEscape(redirectURL))
}
```

### 5. 中间件

```go
// sso/middleware.go
package sso

import (
    "net/http"
)

type contextKey string

const UserKey contextKey = "user"

func AuthMiddleware(client *Client) func(http.Handler) http.Handler {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            cookie, err := r.Cookie("sso_token")
            if err != nil {
                redirectLogin(client, w, r)
                return
            }
            
            session, err := client.CheckSession(cookie.Value)
            if err != nil || !session.Authenticated {
                redirectLogin(client, w, r)
                return
            }
            
            ctx := context.WithValue(r.Context(), UserKey, session.User)
            next.ServeHTTP(w, r.WithContext(ctx))
        })
    }
}

func redirectLogin(client *Client, w http.ResponseWriter, r *http.Request) {
    currentURL := r.URL.String()
    if r.URL.IsAbs() {
        currentURL = r.URL.String()
    } else {
        currentURL = r.Host + r.URL.String()
    }
    
    loginURL := client.GetLoginURL(currentURL)
    http.Redirect(w, r, loginURL, http.StatusTemporaryRedirect)
}

func GetUserFromContext(ctx context.Context) *User {
    user, _ := ctx.Value(UserKey).(*User)
    return user
}
```

### 6. 处理器

```go
// handlers/handlers.go
package handlers

import (
    "encoding/json"
    "net/http"
    
    "your-app/sso"
)

type Handlers struct {
    ssoClient *sso.Client
}

func NewHandlers(ssoClient *sso.Client) *Handlers {
    return &Handlers{ssoClient: ssoClient}
}

func (h *Handlers) GetCurrentUser(w http.ResponseWriter, r *http.Request) {
    user := sso.GetUserFromContext(r.Context())
    if user == nil {
        http.Error(w, "Unauthorized", http.StatusUnauthorized)
        return
    }
    
    json.NewEncoder(w).Encode(user)
}

func (h *Handlers) Logout(w http.ResponseWriter, r *http.Request) {
    cookie, err := r.Cookie("sso_token")
    if err == nil {
        h.ssoClient.Logout(cookie.Value)
    }
    
    http.SetCookie(w, &http.Cookie{
        Name:     "sso_token",
        Value:    "",
        Path:     "/",
        MaxAge:   -1,
        HttpOnly: true,
    })
    
    loginURL := h.ssoClient.GetLoginURL("/")
    http.Redirect(w, r, loginURL, http.StatusTemporaryRedirect)
}
```

### 7. 主程序

```go
// main.go
package main

import (
    "log"
    "net/http"
    
    "github.com/gorilla/mux"
    "github.com/joho/godotenv"
    
    "your-app/config"
    "your-app/handlers"
    "your-app/sso"
)

func main() {
    godotenv.Load()
    
    cfg, err := config.Load()
    if err != nil {
        log.Fatal(err)
    }
    
    ssoClient := sso.NewClient(cfg.SSOServerURL)
    h := handlers.NewHandlers(ssoClient)
    
    r := mux.NewRouter()
    
    api := r.PathPrefix("/api").Subrouter()
    api.Use(sso.AuthMiddleware(ssoClient))
    api.HandleFunc("/me", h.GetCurrentUser).Methods("GET")
    api.HandleFunc("/logout", h.Logout).Methods("POST")
    
    r.PathPrefix("/").Handler(http.FileServer(http.Dir("./static")))
    
    log.Printf("Server starting on %s", cfg.ServerPort)
    log.Fatal(http.ListenAndServe(cfg.ServerPort, r))
}
```

## Gin 框架示例

```go
// main.go (Gin version)
package main

import (
    "github.com/gin-gonic/gin"
    
    "your-app/sso"
)

func main() {
    cfg, _ := config.Load()
    ssoClient := sso.NewClient(cfg.SSOServerURL)
    
    r := gin.Default()
    
    auth := r.Group("/")
    auth.Use(AuthMiddleware(ssoClient))
    {
        auth.GET("/api/me", func(c *gin.Context) {
            user := sso.GetUserFromContext(c.Request.Context())
            c.JSON(200, user)
        })
        
        auth.POST("/api/logout", func(c *gin.Context) {
            cookie, err := c.Cookie("sso_token")
            if err == nil {
                ssoClient.Logout(cookie)
            }
            
            c.SetCookie("sso_token", "", -1, "/", "", true, true)
            c.Redirect(307, ssoClient.GetLoginURL("/"))
        })
    }
    
    r.Run(":8080")
}

func AuthMiddleware(client *sso.Client) gin.HandlerFunc {
    return func(c *gin.Context) {
        token, err := c.Cookie("sso_token")
        if err != nil {
            c.Redirect(307, client.GetLoginURL(c.Request.URL.String()))
            c.Abort()
            return
        }
        
        session, err := client.CheckSession(token)
        if err != nil || !session.Authenticated {
            c.Redirect(307, client.GetLoginURL(c.Request.URL.String()))
            c.Abort()
            return
        }
        
        c.Set("user", session.User)
        c.Next()
    }
}
```

## 注意事项

### 1. Cookie 跨域

确保所有应用在同一主域名下，Cookie 的 `domain` 属性设置为 `.a.com`。

### 2. HTTPS 要求

生产环境必须使用 HTTPS。

### 3. 会话同步

```go
// 定期检查会话状态
func StartSessionSync(client *sso.Client, tokenStore *TokenStore) {
    ticker := time.NewTicker(5 * time.Minute)
    go func() {
        for range ticker.C {
            tokens := tokenStore.GetAll()
            for _, token := range tokens {
                session, err := client.CheckSession(token)
                if err != nil || !session.Authenticated {
                    tokenStore.Remove(token)
                }
            }
        }
    }()
}
```

## 故障排查

| 问题 | 解决方案 |
|------|----------|
| Cookie 未设置 | 检查 `SSO_COOKIE_DOMAIN` 配置 |
| 跨域请求失败 | 确认 CORS 配置正确 |
| 会话丢失 | 检查会话是否过期 |

## 安全建议

1. 生产环境必须使用 HTTPS
2. 设置合理的会话过期时间
3. 敏感操作需要二次验证
4. 记录登录日志用于审计
