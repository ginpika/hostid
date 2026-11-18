//! macOS `WKHTTPCookieStore` 异步桥接。
//!
//! `wry` 默认的 `cookies()` / `delete_cookie()` 会在 `tao` 主事件循环回调持有内部锁期间，
//! 调用 `NSRunLoop::acceptInputForMode` 同步泵循环等待；一旦新窗口或主窗口触发 `drawRect:`
//! 重绘，就会再次尝试获取同一把事件回调锁并造成主线程永久死锁。
//! 本模块仅在 `with_webview` 回调中发起异步请求后立即返回主线程，由调用方在后台线程等待通道结果。

use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2::{sel, MainThreadMarker};
use objc2_foundation::{
    ns_string, NSArray, NSDate, NSHTTPCookie, NSHTTPCookieDomain, NSHTTPCookieExpires,
    NSHTTPCookieMaximumAge, NSHTTPCookieName, NSHTTPCookiePath, NSHTTPCookiePropertyKey,
    NSHTTPCookieSecure, NSHTTPCookieValue, NSHTTPCookieVersion, NSMutableDictionary,
    NSObjectProtocol, NSString,
};
use objc2_web_kit::WKWebView;
use std::ptr::NonNull;
use std::sync::mpsc::{self, RecvTimeoutError};
use std::time::Duration;
use tauri::webview::cookie::{time::OffsetDateTime, Cookie, Expiration, SameSite};
use tauri::Webview;

const COOKIE_OP_TIMEOUT: Duration = Duration::from_secs(3);

/// 异步读取指定 `WKWebView` Cookie Store 中的全部 Cookie，不在主线程阻塞等待。
pub(super) fn read_cookies(webview: &Webview) -> Result<Vec<Cookie<'static>>, String> {
    if MainThreadMarker::new().is_some() {
        return Err("不能在主线程等待 WebView Cookie".into());
    }
    let (tx, rx) = mpsc::channel();
    webview
        .with_webview(move |platform| {
            let ptr = platform.inner();
            if ptr.is_null() {
                return;
            }
            unsafe {
                let wkwebview: &WKWebView = &*ptr.cast();
                let store = wkwebview
                    .configuration()
                    .websiteDataStore()
                    .httpCookieStore();
                let block = RcBlock::new(move |cookies: NonNull<NSArray<NSHTTPCookie>>| {
                    let converted = cookies
                        .as_ref()
                        .to_vec()
                        .into_iter()
                        .map(|cookie| ns_http_cookie_to_tauri(&cookie))
                        .collect();
                    let _ = tx.send(converted);
                });
                store.getAllCookies(&block);
            }
        })
        .map_err(|err| format!("读取 WebView Cookie 失败：{err}"))?;

    recv_cookie_reply(rx, "读取 WebView Cookie")
}

/// 异步删除指定 `WKWebView` Cookie Store 中的 Cookie，不在主线程阻塞等待。
pub(super) fn delete_cookie(webview: &Webview, cookie: &Cookie<'_>) -> Result<(), String> {
    if MainThreadMarker::new().is_some() {
        return Err("不能在主线程删除 WebView Cookie".into());
    }
    let owned = cookie.clone().into_owned();
    let (tx, rx) = mpsc::channel();
    webview
        .with_webview(move |platform| {
            let ptr = platform.inner();
            if ptr.is_null() {
                return;
            }
            unsafe {
                let Some(ns_cookie) = tauri_cookie_to_ns(&owned) else {
                    let _ = tx.send(Err("无法构造 WKWebView Cookie".to_string()));
                    return;
                };
                let wkwebview: &WKWebView = &*ptr.cast();
                let store = wkwebview
                    .configuration()
                    .websiteDataStore()
                    .httpCookieStore();
                let done = tx.clone();
                let block = RcBlock::new(move || {
                    let _ = done.send(Ok(()));
                });
                store.deleteCookie_completionHandler(&ns_cookie, Some(&block));
            }
        })
        .map_err(|err| format!("无法清除本地 HostID Cookie：{err}"))?;

    recv_cookie_reply(rx, "无法清除本地 HostID Cookie")?
}

fn recv_cookie_reply<T>(rx: mpsc::Receiver<T>, context: &str) -> Result<T, String> {
    rx.recv_timeout(COOKIE_OP_TIMEOUT).map_err(|err| match err {
        RecvTimeoutError::Timeout => format!("{context}：等待系统响应超时"),
        RecvTimeoutError::Disconnected => format!("{context}：WebView 已关闭"),
    })
}

unsafe fn ns_http_cookie_to_tauri(cookie: &NSHTTPCookie) -> Cookie<'static> {
    let mut builder = Cookie::build((cookie.name().to_string(), cookie.value().to_string()))
        .domain(cookie.domain().to_string())
        .path(cookie.path().to_string())
        .http_only(cookie.isHTTPOnly())
        .secure(cookie.isSecure());

    if cookie.respondsToSelector(sel!(sameSitePolicy)) {
        let same_site = match cookie.sameSitePolicy() {
            Some(policy) if policy.to_string() == "lax" => SameSite::Lax,
            Some(policy) if policy.to_string() == "strict" => SameSite::Strict,
            _ => SameSite::None,
        };
        builder = builder.same_site(same_site);
    }

    let expires = match cookie.expiresDate() {
        Some(datetime) => {
            OffsetDateTime::from_unix_timestamp(datetime.timeIntervalSince1970() as i64)
                .ok()
                .map(Expiration::DateTime)
        }
        None => Some(Expiration::Session),
    };
    if let Some(expires) = expires {
        builder = builder.expires(expires);
    }

    builder.build()
}

unsafe fn tauri_cookie_to_ns(cookie: &Cookie<'_>) -> Option<Retained<NSHTTPCookie>> {
    let nstring_true = ns_string!("TRUE");
    let nstring_false = ns_string!("FALSE");
    let nstring_0 = ns_string!("0");
    let nstring_1 = ns_string!("1");

    let name = NSString::from_str(cookie.name());
    let value = NSString::from_str(cookie.value());
    let path = cookie.path().map_or_else(NSString::new, NSString::from_str);
    let domain = cookie
        .domain()
        .map_or_else(NSString::new, NSString::from_str);

    let properties: Retained<NSMutableDictionary<NSHTTPCookiePropertyKey, AnyObject>> =
        NSMutableDictionary::from_slices(
            &[
                NSHTTPCookieName,
                NSHTTPCookieValue,
                NSHTTPCookiePath,
                NSHTTPCookieDomain,
            ],
            &[&name, &value, &path, &domain],
        );

    if let Some(max_age) = cookie.max_age() {
        let seconds = NSString::from_str(&max_age.whole_seconds().to_string());
        properties.insert(NSHTTPCookieMaximumAge, &*seconds);
        properties.insert(NSHTTPCookieVersion, nstring_1);
    } else if let Some(dt) = cookie.expires_datetime() {
        let expires = NSDate::dateWithTimeIntervalSince1970(dt.unix_timestamp() as f64);
        properties.insert(NSHTTPCookieExpires, &*expires);
        properties.insert(NSHTTPCookieVersion, nstring_0);
    }

    if let Some(secure) = cookie.secure() {
        properties.insert(
            NSHTTPCookieSecure,
            if secure { nstring_true } else { nstring_false },
        );
    }

    if let Some(http_only) = cookie.http_only() {
        properties.insert(
            ns_string!("HttpOnly"),
            if http_only {
                nstring_true
            } else {
                nstring_false
            },
        );
    }

    if let Some(same_site) = cookie.same_site() {
        let key = ns_string!("SameSite");
        match same_site {
            SameSite::Lax => properties.insert(key, ns_string!("lax")),
            SameSite::Strict => properties.insert(key, ns_string!("strict")),
            SameSite::None => {}
        }
    }

    NSHTTPCookie::cookieWithProperties(&properties)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::webview::cookie::time::Duration as CookieDuration;

    #[test]
    fn round_trips_shared_and_host_cookies_with_ns_http_cookie() {
        let expires = OffsetDateTime::now_utc() + CookieDuration::days(7);
        let original = Cookie::build(("sso_token", "jwt-token"))
            .domain(".example.com")
            .path("/")
            .secure(true)
            .http_only(true)
            .same_site(SameSite::Lax)
            .expires(expires)
            .build();

        unsafe {
            let ns = tauri_cookie_to_ns(&original).expect("valid NSHTTPCookie");
            let back = ns_http_cookie_to_tauri(&ns);
            assert_eq!(back.name(), "sso_token");
            assert_eq!(back.value(), "jwt-token");
            assert_eq!(back.domain(), Some("example.com"));
            assert_eq!(back.path(), Some("/"));
            assert_eq!(back.secure(), Some(true));
            assert_eq!(back.http_only(), Some(true));
            assert_eq!(back.same_site(), Some(SameSite::Lax));
            assert!(back.expires_datetime().is_some());
        }
    }
}
