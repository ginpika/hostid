[Documentation](./README.md) · **English** · [简体中文](./zh-CN/sso-integration-go.md)

# Go SSO integration

Complete the setup in [shared-session SSO](./sso.md) first. The server below validates the configured shared cookie on each protected request, with a timeout, no upstream redirects and a bounded JSON response.

## Run

Use Go 1.21 or newer. Save this as `main.go`; replace `sessionURL` and match `cookieName` to your instance. The example uses only the standard library.

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

Serve the application behind HTTPS at `app.example.com`, with HostID at `mail.example.com` and its cookie domain set to `example.com`. Direct the browser to `https://mail.example.com/login?redirect=https%3A%2F%2Fapp.example.com%2Fapi%2Fme`. The return address is fixed here; validate any dynamic return URL against an allowlist.

The handler returns 401 for a missing or invalid session and 503 for an upstream failure. It forwards only the selected SSO cookie. Use the validated `User.ID` to enforce your own account and permission rules.

See the common guide for [logout and local-session handling](./sso.md#browser-requests-and-logout). Add application-specific CSRF protection before exposing state-changing handlers.

Contract: [SSO routes](../backend/src/routes/sso.ts).
