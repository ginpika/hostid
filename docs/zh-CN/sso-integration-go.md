[文档首页](./README.md) · [English](../sso-integration-go.md) · **简体中文**

# Go SSO 集成

先按[共享会话 SSO](./sso.md)完成配置。下面的服务对每个受保护请求验证指定共享 Cookie，设置超时、禁止上游重定向，并限制读取的 JSON 大小。

## 运行

使用 Go 1.21 或更新版本。将代码保存为 `main.go`，替换 `sessionURL`，使 `cookieName` 与实例配置一致。示例只使用标准库。

```go
package main

import (
    "encoding/json"
    "io"
    "log"
    "net/http"
    "regexp"
    "time"
)

const sessionURL = "https://mail.example.com/api/sso/session"
const cookieName = "sso_token"

var tokenPattern = regexp.MustCompile(`^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$`)
var client = &http.Client{
    Timeout: 5 * time.Second,
    CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
        return http.ErrUseLastResponse
    },
}

type User struct {
    ID       string `json:"id"`
    Username string `json:"username"`
    Email    string `json:"email"`
    Role     string `json:"role"`
}

type Session struct {
    Authenticated bool  `json:"authenticated"`
    User          *User `json:"user"`
}

func me(w http.ResponseWriter, r *http.Request) {
    w.Header().Set("Cache-Control", "no-store")
    if r.Method != http.MethodGet || r.URL.Path != "/api/me" {
        http.NotFound(w, r)
        return
    }
    cookie, err := r.Cookie(cookieName)
    if err != nil || len(cookie.Value) > 4096 || !tokenPattern.MatchString(cookie.Value) {
        http.Error(w, "Sign in required", http.StatusUnauthorized)
        return
    }
    req, err := http.NewRequestWithContext(r.Context(), "GET", sessionURL, nil)
    if err != nil {
        http.Error(w, "Invalid server configuration", http.StatusServiceUnavailable)
        return
    }
    req.AddCookie(&http.Cookie{Name: cookieName, Value: cookie.Value})
    req.Header.Set("Accept", "application/json")
    res, err := client.Do(req)
    if err != nil {
        http.Error(w, "Session service unavailable", http.StatusServiceUnavailable)
        return
    }
    defer res.Body.Close()
    var session Session
    if res.StatusCode != http.StatusOK || json.NewDecoder(io.LimitReader(res.Body, 65536)).Decode(&session) != nil {
        http.Error(w, "Invalid session response", http.StatusServiceUnavailable)
        return
    }
    if !session.Authenticated {
        http.Error(w, "Sign in required", http.StatusUnauthorized)
        return
    }
    if session.User == nil || session.User.ID == "" {
        http.Error(w, "Invalid session response", http.StatusServiceUnavailable)
        return
    }
    w.Header().Set("Content-Type", "application/json")
    _ = json.NewEncoder(w).Encode(session.User)
}

func main() {
    mux := http.NewServeMux()
    mux.HandleFunc("/api/me", me)
    server := &http.Server{
        Addr: "127.0.0.1:8080", Handler: mux,
        ReadHeaderTimeout: 5 * time.Second,
    }
    log.Fatal(server.ListenAndServe())
}
```

```bash
go run main.go
```

通过 HTTPS 将应用部署至 `app.example.com`，HostID 位于 `mail.example.com`，Cookie 域设为 `example.com`。将浏览器导航至 `https://mail.example.com/login?redirect=https%3A%2F%2Fapp.example.com%2Fapi%2Fme`。此处返回地址固定；若使用动态地址，必须通过允许列表校验。

缺少或无效会话返回 401，上游异常返回 503。处理器只转发选中的 SSO Cookie。使用验证后的 `User.ID` 执行应用自己的账户和权限规则。

[登出与本地会话处理](./sso.md#浏览器请求与登出)见公共指南。开放修改状态的处理器前，应添加应用自己的 CSRF 防护。

接口依据：[SSO 路由](../../backend/src/routes/sso.ts)。
