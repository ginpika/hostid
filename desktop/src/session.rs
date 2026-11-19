use base64::Engine;
use reqwest::blocking::{Client, Response};
use reqwest::header::{ACCEPT, CACHE_CONTROL, CONTENT_TYPE, COOKIE, LOCATION};
use reqwest::{redirect, StatusCode};
use serde::{Deserialize, Serialize};
use std::io::Read;
use std::net::IpAddr;
use std::time::{Duration, SystemTime};
use tauri::webview::Cookie;
use tauri::{Url, Webview};

pub(super) const DEFAULT_COOKIE: &str = "sso_token";
const MAX_AVATAR_BYTES: usize = 256 * 1024;
const MAX_SITE_ICON_BYTES: usize = 2 * 1024 * 1024;

#[derive(Clone)]
pub(super) struct Site(Url);

impl Site {
    pub(super) fn parse(raw: &str) -> Result<Self, String> {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            return Err("请输入 HostID 实例地址".into());
        }
        let candidate = if trimmed.contains("://") {
            trimmed.to_string()
        } else {
            let host_part = trimmed.split('/').next().unwrap_or(trimmed);
            let bare_host = host_part
                .strip_prefix('[')
                .and_then(|s| s.split(']').next())
                .unwrap_or_else(|| host_part.split(':').next().unwrap_or(host_part));
            let scheme = if is_loopback_host(&normalize_host(bare_host)) {
                "http"
            } else {
                "https"
            };
            format!("{scheme}://{trimmed}")
        };

        let mut url = Url::parse(&candidate).map_err(|err| format!("地址无效：{err}"))?;
        if !matches!(url.scheme(), "http" | "https")
            || url.host_str().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
        {
            return Err("请输入无凭据、查询参数和片段的 HTTP 或 HTTPS 实例地址".into());
        }
        if !url.path().ends_with('/') {
            url.set_path(&format!("{}/", url.path()));
        }
        Ok(Self(url))
    }

    pub(super) fn base(&self) -> &str {
        self.0.as_str().trim_end_matches('/')
    }

    pub(super) fn url(&self, path: &str) -> Url {
        self.0.join(path).expect("固定的相对 API 路径")
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SiteInfo {
    pub(super) site_name: String,
    pub(super) site_slogan: String,
    /// Some("") = 明确使用默认站点图标；Some(icon) = 自定义站点图标；None = 降级探测未知
    pub(super) site_icon: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct User {
    pub(super) id: String,
    pub(super) username: String,
    pub(super) nickname: Option<String>,
    pub(super) email: Option<String>,
    pub(super) role: Option<String>,
    pub(super) avatar_url: Option<String>,
    #[serde(default)]
    pub(super) avatar: Option<String>,
}

impl User {
    fn validate(self) -> Result<Self, String> {
        if self.id.trim().is_empty() || self.username.trim().is_empty() {
            return Err("会话响应缺少用户 ID 或用户名".into());
        }
        Ok(self)
    }

    pub(super) fn display_name(&self) -> &str {
        self.nickname
            .as_deref()
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .unwrap_or_else(|| self.username.trim())
    }
}

#[derive(Deserialize)]
struct SessionResponse {
    authenticated: bool,
    user: Option<User>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawSiteResponse {
    site_name: Option<String>,
    site_slogan: Option<String>,
    site_icon_url: Option<String>,
}

#[derive(Deserialize)]
struct HealthResponse {
    status: Option<String>,
}

pub(super) struct SessionClient {
    http: Client,
    local_http: Client,
    webview: Webview,
}

impl SessionClient {
    pub(super) fn new(webview: Webview) -> Result<Self, String> {
        let http = build_http_client(false)?;
        let local_http = build_http_client(true)?;
        Ok(Self {
            http,
            local_http,
            webview,
        })
    }

    /// 探测实例可达性并拉取站点品牌信息（兼容生产单镜像与 Vite 本地开发服务）。
    pub(super) fn probe_site(&self, site: &Site) -> Result<SiteInfo, String> {
        probe_site_with(|target| self.http_for(target), site)
    }

    pub(super) fn site_cookies(&self, site: &Site) -> Result<Vec<Cookie<'static>>, String> {
        self.site_cookies_on(&self.webview, site)
    }

    pub(super) fn site_cookies_on(
        &self,
        webview: &Webview,
        site: &Site,
    ) -> Result<Vec<Cookie<'static>>, String> {
        self.cookies_on(webview, &site.url("api/sso/session"), DEFAULT_COOKIE)
    }

    pub(super) fn current_user(&self, site: &Site) -> Result<Option<User>, String> {
        let cookies = self.site_cookies(site)?;
        for cookie in cookies {
            if let Some(user) = self.session(site, &cookie)? {
                return Ok(Some(user));
            }
        }
        Ok(None)
    }

    pub(super) fn session(
        &self,
        site: &Site,
        cookie: &Cookie<'_>,
    ) -> Result<Option<User>, String> {
        let mut user = fetch_session(self.http_for(&site.0), site, cookie)?;
        if let Some(ref mut profile) = user {
            let resolved = resolve_avatar_url(
                site,
                profile.avatar_url.as_deref(),
                profile.avatar.as_deref(),
            );
            profile.avatar_url = resolved.map(|url| {
                Url::parse(&url)
                    .ok()
                    .and_then(|parsed| {
                        fetch_image_data_url(
                            |target| self.http_for(target),
                            site,
                            &parsed,
                            Some(cookie),
                            MAX_AVATAR_BYTES,
                            false,
                        )
                    })
                    .unwrap_or(url)
            });
        }
        Ok(user)
    }

    pub(super) fn clear_cookies(&self, site: &Site) -> Result<(), String> {
        let cookies = self.site_cookies(site)?;
        for cookie in cookies {
            self.delete_webview_cookie(cookie)?;
        }
        Ok(())
    }

    fn delete_webview_cookie(&self, cookie: Cookie<'static>) -> Result<(), String> {
        #[cfg(target_os = "macos")]
        {
            super::wk_cookie::delete_cookie(&self.webview, &cookie)
        }
        #[cfg(not(target_os = "macos"))]
        {
            self.webview
                .delete_cookie(cookie)
                .map_err(|err| format!("无法清除本地 HostID Cookie：{err}"))
        }
    }

    fn cookies_on(
        &self,
        webview: &Webview,
        url: &Url,
        name: &str,
    ) -> Result<Vec<Cookie<'static>>, String> {
        #[cfg(target_os = "macos")]
        let cookies = super::wk_cookie::read_cookies(webview)?
            .into_iter()
            .filter(|cookie| matches_wk_cookie(cookie, url))
            .collect::<Vec<_>>();
        #[cfg(not(target_os = "macos"))]
        let cookies = webview
            .cookies_for_url(url.clone())
            .map_err(|err| format!("读取 WebView Cookie 失败：{err}"))?;

        Ok(select_cookies(cookies, url, name, SystemTime::now()))
    }

    fn http_for(&self, url: &Url) -> &Client {
        if is_loopback_url(url) {
            &self.local_http
        } else {
            &self.http
        }
    }
}

fn probe_site_with<'a>(
    client_for: impl Fn(&Url) -> &'a Client,
    site: &Site,
) -> Result<SiteInfo, String> {
    let site_url = site.url("api/auth/site");
    let site_res = get_with(client_for(&site_url), site_url, None)?;
    let site_status = site_res.status();
    let site_body = read_body_bytes(site_res)?;
    if site_status.is_success() {
        if let Ok(parsed) = serde_json::from_slice::<RawSiteResponse>(&site_body) {
            let site_name = parsed
                .site_name
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| "HostID".to_string());
            let site_slogan = parsed
                .site_slogan
                .map(|s| s.trim().to_string())
                .unwrap_or_default();
            let site_icon = match resolve_site_icon_url(site, parsed.site_icon_url.as_deref()) {
                Some(url) if is_safe_raster_data_url(&url) => Some(url),
                Some(url) => {
                    let cached = Url::parse(&url)
                        .ok()
                        .and_then(|parsed_url| {
                            fetch_image_data_url(
                                &client_for,
                                site,
                                &parsed_url,
                                None,
                                MAX_SITE_ICON_BYTES,
                                true,
                            )
                        })
                        .unwrap_or(url);
                    Some(cached)
                }
                None => Some(String::new()),
            };
            return Ok(SiteInfo {
                site_name,
                site_slogan,
                site_icon,
            });
        }
    }

    let health_url = site.url("health");
    let health_res = get_with(client_for(&health_url), health_url, None)?;
    let health_status = health_res.status();
    let health_body = read_body_bytes(health_res)?;
    if health_status.is_success() {
        if let Ok(health) = serde_json::from_slice::<HealthResponse>(&health_body) {
            if health.status.as_deref() == Some("ok") {
                return Ok(SiteInfo {
                    site_name: "HostID".to_string(),
                    site_slogan: String::new(),
                    site_icon: None,
                });
            }
        }
    }

    if !site_status.is_success() {
        return Err(format!("无法连接到 HostID 实例（HTTP {site_status}）"));
    }
    Err("目标地址未返回有效的 HostID 服务响应，请确认地址是否正确".into())
}

fn build_http_client(no_proxy: bool) -> Result<Client, String> {
    let mut builder = Client::builder()
        .redirect(redirect::Policy::none())
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(12));
    if no_proxy {
        builder = builder.no_proxy();
    }
    builder
        .build()
        .map_err(|err| format!("无法初始化会话客户端：{err}"))
}

fn resolve_site_icon_url(site: &Site, site_icon_url: Option<&str>) -> Option<String> {
    let raw = site_icon_url.map(str::trim).filter(|s| !s.is_empty())?;
    if is_safe_raster_data_url(raw) {
        return Some(raw.to_string());
    }
    if raw.starts_with("http://") || raw.starts_with("https://") {
        return Url::parse(raw)
            .ok()
            .filter(|url| matches!(url.scheme(), "http" | "https"))
            .map(|url| url.to_string());
    }
    if raw.starts_with('/') && !raw.starts_with("//") {
        return Some(site.url(raw.trim_start_matches('/')).to_string());
    }
    None
}

fn resolve_avatar_url(
    site: &Site,
    avatar_url: Option<&str>,
    avatar: Option<&str>,
) -> Option<String> {
    if let Some(raw) = avatar_url.map(str::trim).filter(|s| !s.is_empty()) {
        return normalize_avatar_ref(site, raw, false);
    }
    let raw = avatar.map(str::trim).filter(|s| !s.is_empty())?;
    normalize_avatar_ref(site, raw, true)
}

fn normalize_avatar_ref(site: &Site, raw: &str, bare_is_hostid_filename: bool) -> Option<String> {
    if is_safe_raster_data_url(raw) {
        return Some(raw.to_string());
    }
    if raw.starts_with("http://") || raw.starts_with("https://") {
        return Url::parse(raw).ok().map(|url| url.to_string());
    }
    if raw.starts_with('/') {
        return Some(site.url(raw.trim_start_matches('/')).to_string());
    }
    if bare_is_hostid_filename {
        return Some(site.url(&format!("api/auth/avatar/{raw}")).to_string());
    }
    Some(site.url(raw).to_string())
}

fn is_safe_raster_data_url(raw: &str) -> bool {
    let lower = raw.to_ascii_lowercase();
    [
        "data:image/png;",
        "data:image/jpeg;",
        "data:image/jpg;",
        "data:image/gif;",
        "data:image/webp;",
        "data:image/avif;",
    ]
    .iter()
    .any(|prefix| lower.starts_with(prefix))
}

fn fetch_image_data_url<'a>(
    client_for: impl Fn(&Url) -> &'a Client,
    site: &Site,
    initial: &Url,
    cookie: Option<&Cookie<'_>>,
    max_bytes: usize,
    allow_svg: bool,
) -> Option<String> {
    let mut current = initial.clone();
    for _ in 0..=3 {
        if !matches!(current.scheme(), "http" | "https") {
            return None;
        }
        let mut request = client_for(&current)
            .get(current.clone())
            .header(ACCEPT, "image/*")
            .header(CACHE_CONTROL, "no-cache")
            .timeout(Duration::from_secs(4));
        if let Some(c) = cookie {
            if should_send_avatar_cookie(site, &current) {
                request = request.header(COOKIE, cookie_pair(c));
            }
        }
        let response = request.send().ok()?;
        let status = response.status();
        if status.is_redirection() {
            let location = response.headers().get(LOCATION)?.to_str().ok()?;
            current = current.join(location).ok()?;
            continue;
        }
        if !status.is_success() {
            return None;
        }
        let content_type = response
            .headers()
            .get(CONTENT_TYPE)
            .and_then(|val| val.to_str().ok())
            .map(|val| val.to_string());
        let mut buf = Vec::new();
        response
            .take((max_bytes + 1) as u64)
            .read_to_end(&mut buf)
            .ok()?;
        if buf.is_empty() || buf.len() > max_bytes {
            return None;
        }
        let mime = detect_image_mime(content_type.as_deref(), &buf, allow_svg)?;
        let encoded = base64::engine::general_purpose::STANDARD.encode(&buf);
        return Some(format!("data:{mime};base64,{encoded}"));
    }
    None
}

fn should_send_avatar_cookie(site: &Site, target: &Url) -> bool {
    let (Some(site_host), Some(target_host)) = (site.0.host_str(), target.host_str()) else {
        return false;
    };
    let scheme_ok = target.scheme() == site.0.scheme() || target.scheme() == "https";
    scheme_ok && domain_matches_host(&normalize_host(site_host), &normalize_host(target_host))
}

fn is_valid_svg_bytes(bytes: &[u8]) -> bool {
    if bytes.is_empty() || bytes.contains(&0) {
        return false;
    }
    let Ok(text) = std::str::from_utf8(bytes) else {
        return false;
    };
    let trimmed = text.trim_start_matches('\u{feff}').trim();
    if trimmed.is_empty() {
        return false;
    }
    let lower = trimmed.to_ascii_lowercase();
    let starts_like_svg =
        lower.starts_with("<svg") || lower.starts_with("<?xml") || lower.starts_with("<!--");
    if !starts_like_svg || !lower.contains("<svg") || !lower.contains("</svg") {
        return false;
    }
    const FORBIDDEN: &[&str] = &[
        "<script",
        "<foreignobject",
        "<!entity",
        "javascript:",
        "vbscript:",
        "data:text/html",
    ];
    !FORBIDDEN.iter().any(|bad| lower.contains(bad))
}

fn detect_image_mime(header: Option<&str>, bytes: &[u8], allow_svg: bool) -> Option<&'static str> {
    if let Some(raw) = header {
        let mime = raw
            .split(';')
            .next()
            .unwrap_or("")
            .trim()
            .to_ascii_lowercase();
        match mime.as_str() {
            "image/png" => return Some("image/png"),
            "image/jpeg" | "image/jpg" => return Some("image/jpeg"),
            "image/gif" => return Some("image/gif"),
            "image/webp" => return Some("image/webp"),
            "image/avif" => return Some("image/avif"),
            "image/x-icon" | "image/vnd.microsoft.icon" => return Some("image/x-icon"),
            "image/svg+xml" if allow_svg => {
                return is_valid_svg_bytes(bytes).then_some("image/svg+xml");
            }
            "" | "application/octet-stream" => {}
            _ => return None,
        }
    }
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("image/jpeg")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("image/gif")
    } else if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("image/webp")
    } else if bytes.len() >= 22
        && bytes[0..4] == [0x00, 0x00, 0x01, 0x00]
        && u16::from_le_bytes([bytes[4], bytes[5]]) > 0
    {
        Some("image/x-icon")
    } else if allow_svg && is_valid_svg_bytes(bytes) {
        Some("image/svg+xml")
    } else {
        None
    }
}

fn read_body_bytes(response: Response) -> Result<Vec<u8>, String> {
    response
        .bytes()
        .map(|bytes| bytes.to_vec())
        .map_err(|err| format!("读取响应失败：{err}"))
}

fn fetch_session(
    http: &Client,
    site: &Site,
    cookie: &Cookie<'_>,
) -> Result<Option<User>, String> {
    let response = get_with(http, site.url("api/sso/session"), Some(cookie))?;
    let status = response.status();
    parse_session_response(status, || read_json(response, "HostID 会话"))
}

fn parse_session_response(
    status: StatusCode,
    read: impl FnOnce() -> Result<SessionResponse, String>,
) -> Result<Option<User>, String> {
    if !status.is_success() {
        return Err(format!("HostID 无法校验会话（HTTP {status}）"));
    }
    let session = read()?;
    if !session.authenticated {
        return Ok(None);
    }
    let user = session.user.ok_or("HostID 会话响应缺少用户资料")?;
    Ok(Some(user.validate()?))
}

fn get_with(http: &Client, url: Url, cookie: Option<&Cookie<'_>>) -> Result<Response, String> {
    let mut request = http
        .get(url)
        .header(ACCEPT, "application/json")
        .header(CACHE_CONTROL, "no-cache");
    if let Some(cookie) = cookie {
        request = request.header(COOKIE, cookie_pair(cookie));
    }
    request.send().map_err(|err| {
        if err.is_timeout() {
            "请求超时，请检查实例是否可达".to_string()
        } else {
            format!("无法连接到实例：{err}")
        }
    })
}

fn select_cookies(
    mut cookies: Vec<Cookie<'static>>,
    url: &Url,
    name: &str,
    now: SystemTime,
) -> Vec<Cookie<'static>> {
    cookies.retain(|cookie| {
        cookie.name() == name
            && !cookie.value().trim().is_empty()
            && cookie
                .expires_datetime()
                .is_none_or(|expires| expires > now)
            && cookie
                .max_age()
                .is_none_or(|age| !age.is_negative() && !age.is_zero())
    });
    cookies.sort_by_key(|cookie| {
        (
            std::cmp::Reverse(normalized_cookie_path(cookie).len()),
            !is_exact_host_cookie(cookie, url),
        )
    });
    cookies
}

fn read_json<T: serde::de::DeserializeOwned>(
    response: Response,
    context: &str,
) -> Result<T, String> {
    response
        .json()
        .map_err(|_| format!("{context}响应格式无效"))
}

fn cookie_pair(cookie: &Cookie<'_>) -> String {
    format!("{}={}", cookie.name(), cookie.value())
}

fn normalize_host(raw: &str) -> String {
    raw.trim_start_matches('[')
        .trim_end_matches(']')
        .trim_end_matches('.')
        .to_ascii_lowercase()
}

fn normalize_domain(raw: &str) -> String {
    normalize_host(raw.trim_start_matches('.'))
}

fn normalized_cookie_path<'a>(cookie: &'a Cookie<'_>) -> &'a str {
    cookie
        .path()
        .filter(|path| path.starts_with('/'))
        .unwrap_or("/")
}

fn is_exact_host_cookie(cookie: &Cookie<'_>, url: &Url) -> bool {
    let (Some(raw_domain), Some(raw_host)) = (cookie.domain(), url.host_str()) else {
        return false;
    };
    let domain = normalize_domain(raw_domain);
    let host = normalize_host(raw_host);
    !domain.is_empty() && domain == host
}

fn domain_matches_host(domain: &str, host: &str) -> bool {
    if domain.is_empty() || host.is_empty() {
        return false;
    }
    if host.parse::<IpAddr>().is_ok() {
        host == domain
    } else {
        host == domain
            || host
                .strip_suffix(domain)
                .is_some_and(|prefix| prefix.ends_with('.'))
    }
}

fn is_loopback_host(host: &str) -> bool {
    host == "localhost"
        || host.ends_with(".localhost")
        || host.parse::<IpAddr>().is_ok_and(|ip| ip.is_loopback())
}

fn is_loopback_url(url: &Url) -> bool {
    url.host_str()
        .is_some_and(|raw| is_loopback_host(&normalize_host(raw)))
}

#[cfg(any(target_os = "macos", test))]
fn matches_wk_cookie(cookie: &Cookie<'_>, url: &Url) -> bool {
    let (Some(raw_domain), Some(raw_host)) = (cookie.domain(), url.host_str()) else {
        return false;
    };
    let domain = normalize_domain(raw_domain);
    let host = normalize_host(raw_host);
    let domain_matches = domain_matches_host(&domain, &host);
    let path = normalized_cookie_path(cookie);
    let path_matches = url.path() == path
        || url
            .path()
            .strip_prefix(path)
            .is_some_and(|rest| path.ends_with('/') || rest.starts_with('/'));
    let scheme_matches =
        !cookie.secure().unwrap_or(false) || url.scheme() == "https" || is_loopback_host(&host);
    domain_matches && path_matches && scheme_matches
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_bare_hosts_and_explicit_urls() {
        assert_eq!(
            Site::parse("mail.example.com").unwrap().base(),
            "https://mail.example.com"
        );
        assert_eq!(
            Site::parse("localhost:3000/").unwrap().base(),
            "http://localhost:3000"
        );
        assert_eq!(
            Site::parse("127.0.0.1:3000").unwrap().base(),
            "http://127.0.0.1:3000"
        );
        assert_eq!(
            Site::parse("https://mail.example.com/").unwrap().base(),
            "https://mail.example.com"
        );
        assert!(Site::parse("https://mail.example.com/?foo=bar").is_err());
        assert!(Site::parse("ftp://mail.example.com").is_err());
        assert!(Site::parse("").is_err());
    }

    #[test]
    fn wk_cookie_matches_shared_domain() {
        let cookie = Cookie::build(("sso_token", "jwt-token"))
            .domain(".example.com")
            .path("/")
            .secure(true)
            .http_only(true)
            .build();
        assert!(matches_wk_cookie(
            &cookie,
            &Url::parse("https://mail.example.com/api/sso/session").unwrap()
        ));
        assert!(!matches_wk_cookie(
            &cookie,
            &Url::parse("http://mail.example.com/api/sso/session").unwrap()
        ));
        assert!(!matches_wk_cookie(
            &cookie,
            &Url::parse("https://evilexample.com/api/sso/session").unwrap()
        ));
    }

    #[test]
    fn resolves_and_validates_site_icon_urls() {
        let site = Site::parse("https://mail.example.com").unwrap();
        assert_eq!(resolve_site_icon_url(&site, None), None);
        assert_eq!(resolve_site_icon_url(&site, Some("   ")), None);
        assert_eq!(
            resolve_site_icon_url(&site, Some("  /api/auth/site-icon/site-icon-1.png  ")),
            Some("https://mail.example.com/api/auth/site-icon/site-icon-1.png".to_string())
        );
        assert_eq!(
            resolve_site_icon_url(&site, Some("https://cdn.example.com/logo.svg")),
            Some("https://cdn.example.com/logo.svg".to_string())
        );
        assert_eq!(
            resolve_site_icon_url(&site, Some("//evil.example.com/logo.png")),
            None
        );
        assert_eq!(
            resolve_site_icon_url(&site, Some("javascript:alert(1)")),
            None
        );
    }

    #[test]
    fn detects_site_icon_mime_including_svg_and_ico() {
        let svg = br#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/></svg>"#;
        assert_eq!(
            detect_image_mime(Some("image/svg+xml; charset=utf-8"), svg, true),
            Some("image/svg+xml")
        );
        assert_eq!(
            detect_image_mime(Some("image/svg+xml"), svg, false),
            None
        );
        let bad_svg = br#"<svg><script>alert(1)</script></svg>"#;
        assert_eq!(
            detect_image_mime(Some("image/svg+xml"), bad_svg, true),
            None
        );

        let mut ico = vec![0u8; 22];
        ico[2] = 1;
        ico[4] = 1;
        assert_eq!(detect_image_mime(None, &ico, true), Some("image/x-icon"));
    }

    #[test]
    fn probe_site_fetches_custom_site_icon_and_handles_default_or_health_fallback() {
        use std::io::{Read as _, Write as _};
        use std::net::TcpListener;

        fn serve_once(
            routes: Vec<(&'static str, &'static str, &'static [u8])>,
        ) -> (String, std::thread::JoinHandle<()>) {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let addr = listener.local_addr().unwrap();
            let count = routes.len();
            let handle = std::thread::spawn(move || {
                for _ in 0..count {
                    let (mut stream, _) = listener.accept().unwrap();
                    let mut buf = [0u8; 2048];
                    let n = stream.read(&mut buf).unwrap_or(0);
                    let req = String::from_utf8_lossy(&buf[..n]);
                    let path = req
                        .lines()
                        .next()
                        .and_then(|line| line.split_whitespace().nth(1))
                        .unwrap_or("/");
                    if let Some((_, content_type, body)) =
                        routes.iter().find(|(p, _, _)| *p == path)
                    {
                        let header = format!(
                            "HTTP/1.1 200 OK\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                            body.len()
                        );
                        let _ = stream.write_all(header.as_bytes());
                        let _ = stream.write_all(body);
                    } else {
                        let _ = stream.write_all(
                            b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                        );
                    }
                }
            });
            (format!("http://{addr}"), handle)
        }

        let client = build_http_client(true).unwrap();

        // 1. Custom SVG icon returned by /api/auth/site
        let svg_body = br#"<svg xmlns="http://www.w3.org/2000/svg"><rect width="16" height="16"/></svg>"#;
        let (base1, h1) = serve_once(vec![
            (
                "/api/auth/site",
                "application/json",
                br#"{"siteName":"Acme Mail","siteSlogan":"Team","siteIconUrl":"/api/auth/site-icon/site-icon-1.svg"}"#,
            ),
            ("/api/auth/site-icon/site-icon-1.svg", "image/svg+xml", svg_body),
        ]);
        let info1 = probe_site_with(|_| &client, &Site::parse(&base1).unwrap()).unwrap();
        h1.join().unwrap();
        assert_eq!(info1.site_name, "Acme Mail");
        assert_eq!(info1.site_slogan, "Team");
        assert!(info1
            .site_icon
            .as_deref()
            .is_some_and(|icon| icon.starts_with("data:image/svg+xml;base64,")));

        // 2. Empty siteIconUrl -> explicit Some("") to use default logo
        let (base2, h2) = serve_once(vec![(
            "/api/auth/site",
            "application/json",
            br#"{"siteName":"HostID","siteSlogan":"","siteIconUrl":""}"#,
        )]);
        let info2 = probe_site_with(|_| &client, &Site::parse(&base2).unwrap()).unwrap();
        h2.join().unwrap();
        assert_eq!(info2.site_icon, Some(String::new()));

        // 3. Fallback to /health -> site_icon is None (preserve cached)
        let (base3, h3) = serve_once(vec![
            ("/api/auth/site", "text/plain", b"not found"),
            ("/health", "application/json", br#"{"status":"ok"}"#),
        ]);
        let info3 = probe_site_with(|_| &client, &Site::parse(&base3).unwrap()).unwrap();
        h3.join().unwrap();
        assert_eq!(info3.site_name, "HostID");
        assert_eq!(info3.site_icon, None);
    }
}
