//! 桌面端 Passkey（WebAuthn）系统会话桥接。
//!
//! macOS 第三方应用的 `WKWebView` 未开放原生 WebAuthn / Passkey UI 委托，
//! 因此通过 Apple `AuthenticationServices` 的 `ASWebAuthenticationSession` 拉起系统安全验证页，
//! 在实例自身的 `/passkey-bridge` 页面完成 `startAuthentication` / `startRegistration` 后，
//! 通过 `hostid-desktop://passkey?state=...&payload=...` 将凭证 JSON 回传给主 WebView。
//! 非 macOS 平台或系统会话无法启动时，自动回退到本机 `127.0.0.1` 回环回调 + 系统浏览器。

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, Url};
use tauri_plugin_shell::ShellExt;

pub(crate) const PASSKEY_CANCELLED_ERR: &str = "PASSKEY_CANCELLED";
const CALLBACK_SCHEME: &str = "hostid-desktop";
const CALLBACK_HOST: &str = "passkey";
const LOOPBACK_PATH: &str = "/passkey-callback";
const BRIDGE_PATH: &str = "/passkey-bridge";
const CEREMONY_TIMEOUT: Duration = Duration::from_secs(180);

/// 构建附加了 `callback` 参数的桥接页 URL（保留原有 hash fragment 参数）。
pub(crate) fn with_callback_fragment(bridge_url: &Url, callback_url: &str) -> Url {
    let mut url = bridge_url.clone();
    let mut query_builder = Url::parse("https://placeholder.invalid").expect("valid placeholder");
    query_builder
        .query_pairs_mut()
        .append_pair("callback", callback_url);
    let encoded_pair = query_builder.query().unwrap_or_default().to_string();
    let base_fragment = url.fragment().unwrap_or("").trim_start_matches('#');
    let next_fragment = if base_fragment.is_empty() {
        encoded_pair
    } else {
        format!("{base_fragment}&{encoded_pair}")
    };
    url.set_fragment(Some(&next_fragment));
    url
}

/// 校验传入的桥接页地址与当前主窗口实例同源，防止任意外链借壳拉起系统会话。
fn validate_bridge_url(app: &AppHandle, raw_url: &str, expected_state: &str) -> Result<Url, String> {
    if expected_state.trim().is_empty() {
        return Err("Passkey 状态参数缺失".to_string());
    }
    let parsed = Url::parse(raw_url.trim()).map_err(|_| "无效的 Passkey 桥接地址".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("Passkey 桥接地址必须使用 http 或 https 协议".to_string());
    }
    if parsed.path() != BRIDGE_PATH {
        return Err("非法的 Passkey 桥接路径".to_string());
    }
    if let Some(window) = app.get_webview_window(crate::WINDOW_LABEL) {
        if let Ok(current_url) = window.url() {
            if matches!(current_url.scheme(), "http" | "https")
                && (current_url.scheme() != parsed.scheme()
                    || current_url.host_str() != parsed.host_str()
                    || current_url.port_or_known_default() != parsed.port_or_known_default())
            {
                return Err("Passkey 桥接地址与当前实例不同源".to_string());
            }
        }
    }
    Ok(parsed)
}

/// 解析并校验自定义 Scheme 或 loopback 回环回调 URL，返回解码后的 JSON 字符串。
pub(crate) fn parse_callback_result(
    callback_url: &str,
    expected_state: &str,
) -> Result<String, String> {
    let parsed =
        Url::parse(callback_url).map_err(|_| "Passkey 回调地址格式无效".to_string())?;

    let is_custom_scheme =
        parsed.scheme() == CALLBACK_SCHEME && parsed.host_str() == Some(CALLBACK_HOST);
    let is_loopback = parsed.scheme() == "http"
        && parsed.host_str() == Some("127.0.0.1")
        && parsed.path() == LOOPBACK_PATH;

    if !is_custom_scheme && !is_loopback {
        return Err("未知的 Passkey 回调来源".to_string());
    }

    let mut state: Option<String> = None;
    let mut payload: Option<String> = None;
    let mut error: Option<String> = None;

    for (key, value) in parsed.query_pairs() {
        match key.as_ref() {
            "state" => state = Some(value.into_owned()),
            "payload" => payload = Some(value.into_owned()),
            "error" => error = Some(value.into_owned()),
            _ => {}
        }
    }

    if state.as_deref() != Some(expected_state) {
        return Err("Passkey 状态校验失败，请重试".to_string());
    }

    if let Some(err_msg) = error.filter(|msg| !msg.trim().is_empty()) {
        if err_msg == "cancelled" {
            return Err(PASSKEY_CANCELLED_ERR.to_string());
        }
        return Err(err_msg);
    }

    let encoded = payload
        .filter(|val| !val.trim().is_empty())
        .ok_or_else(|| "Passkey 未返回验证凭证".to_string())?;
    let bytes = URL_SAFE_NO_PAD
        .decode(encoded.trim_end_matches('='))
        .map_err(|_| "Passkey 凭证编码无效".to_string())?;
    let json =
        String::from_utf8(bytes).map_err(|_| "Passkey 凭证不是有效的 UTF-8 JSON".to_string())?;
    if json.trim().is_empty() {
        return Err("Passkey 返回了空凭证".to_string());
    }
    Ok(json)
}

/// 当无法拉起系统内嵌认证页时，通过本地回环 HTTP + 系统默认浏览器完成 Passkey 验证。
async fn run_loopback_ceremony(
    app: AppHandle,
    bridge_url: Url,
    expected_state: String,
) -> Result<String, String> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|err| format!("启动 Passkey 本地回环监听失败：{err}"))?;
    let port = listener
        .local_addr()
        .map_err(|err| format!("读取本地回环端口失败：{err}"))?
        .port();
    listener
        .set_nonblocking(true)
        .map_err(|err| format!("配置回环监听失败：{err}"))?;

    let callback_base = format!("http://127.0.0.1:{port}{LOOPBACK_PATH}");
    let full_url = with_callback_fragment(&bridge_url, &callback_base);

    #[allow(deprecated)]
    app.shell()
        .open(full_url.as_str(), None)
        .map_err(|err| format!("打开系统浏览器进行 Passkey 验证失败：{err}"))?;

    tauri::async_runtime::spawn_blocking(move || {
        let deadline = Instant::now() + CEREMONY_TIMEOUT;
        loop {
            match listener.accept() {
                Ok((mut stream, _addr)) => {
                    let _ = stream.set_read_timeout(Some(Duration::from_secs(3)));
                    let mut reader = BufReader::new(&stream);
                    let mut request_line = String::new();
                    if reader.read_line(&mut request_line).is_err() {
                        continue;
                    }
                    let target = request_line
                        .split_whitespace()
                        .nth(1)
                        .unwrap_or("/");
                    if target == "/favicon.ico" {
                        let _ = stream.write_all(b"HTTP/1.1 204 No Content\r\nConnection: close\r\n\r\n");
                        let _ = stream.flush();
                        continue;
                    }

                    let html = "<!doctype html><html><head><meta charset=\"utf-8\"><title>HostID Passkey</title></head>\
<body style=\"font-family:-apple-system,BlinkMacSystemFont,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f8fafc;color:#0f172a;\">\
<div style=\"text-align:center;padding:24px;\"><h2 style=\"margin:0 0 8px;font-size:18px;\">Passkey 验证信息已回传</h2>\
<p style=\"margin:0;color:#64748b;font-size:14px;\">请返回 HostID 桌面客户端继续。</p></div>\
<script>setTimeout(function(){window.close()},300);</script></body></html>";
                    let response = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        html.len(),
                        html
                    );
                    let _ = stream.write_all(response.as_bytes());
                    let _ = stream.flush();

                    let callback_url = format!("http://127.0.0.1:{port}{target}");
                    return parse_callback_result(&callback_url, &expected_state);
                }
                Err(err) if err.kind() == std::io::ErrorKind::WouldBlock => {
                    if Instant::now() >= deadline {
                        return Err("Passkey 验证超时，请重试".to_string());
                    }
                    std::thread::sleep(Duration::from_millis(80));
                }
                Err(err) => {
                    return Err(format!("接收 Passkey 回环结果失败：{err}"));
                }
            }
        }
    })
    .await
    .map_err(|err| format!("Passkey 验证任务异常结束：{err}"))?
}

#[cfg(target_os = "macos")]
mod macos {
    use super::{parse_callback_result, with_callback_fragment, CALLBACK_SCHEME, CEREMONY_TIMEOUT, PASSKEY_CANCELLED_ERR};
    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::runtime::{AnyClass, AnyObject, Bool};
    use objc2::{define_class, msg_send, AnyThread, DefinedClass};
    use objc2_foundation::{NSError, NSObject, NSObjectProtocol, NSString, NSURL};
    use std::cell::RefCell;
    use std::collections::HashMap;
    use std::ptr::NonNull;
    use std::sync::atomic::{AtomicU64, Ordering};
    use tauri::{AppHandle, Manager, Url};

    #[link(name = "AuthenticationServices", kind = "framework")]
    extern "C" {}

    const AS_ERROR_CANCELED_LOGIN: isize = 1;

    struct ProviderIvars {
        anchor: NonNull<AnyObject>,
    }

    define_class!(
        // `PresentationProvider` 仅在主线程创建与使用，持有当前主窗口对应的 `NSWindow*` 指针。
        #[unsafe(super(NSObject))]
        #[ivars = ProviderIvars]
        struct PresentationProvider;

        unsafe impl NSObjectProtocol for PresentationProvider {}

        impl PresentationProvider {
            #[unsafe(method_id(presentationAnchorForWebAuthenticationSession:))]
            fn presentation_anchor(
                &self,
                _session: *const AnyObject,
            ) -> Option<Retained<AnyObject>> {
                unsafe { Retained::retain(self.ivars().anchor.as_ptr()) }
            }
        }
    );

    impl PresentationProvider {
        fn new(anchor: NonNull<AnyObject>) -> Retained<Self> {
            let this = Self::alloc().set_ivars(ProviderIvars { anchor });
            unsafe { msg_send![super(this), init] }
        }
    }

    struct RetainedSession {
        session: Retained<AnyObject>,
        _provider: Retained<PresentationProvider>,
    }

    static NEXT_SESSION_ID: AtomicU64 = AtomicU64::new(1);

    thread_local! {
        // 仅在 AppKit 主线程访问，保证 `ASWebAuthenticationSession` 与弱引用的
        // `presentationContextProvider` 在回调触发前始终存活。
        static ACTIVE_SESSIONS: RefCell<HashMap<u64, RetainedSession>> = RefCell::new(HashMap::new());
    }

    fn cleanup_session(id: u64) {
        ACTIVE_SESSIONS.with(|map| {
            map.borrow_mut().remove(&id);
        });
    }

    fn cancel_session(id: u64) {
        ACTIVE_SESSIONS.with(|map| {
            if let Some(entry) = map.borrow().get(&id) {
                let _: () = unsafe { msg_send![&*entry.session, cancel] };
            }
        });
    }

    enum LaunchAttempt {
        Started(u64),
        Unsupported,
    }

    /// 优先使用 Apple `ASWebAuthenticationSession` 执行 Passkey 认证/注册；
    /// 若系统上下文暂不支持内嵌拉起，返回 `Ok(None)` 以交由 loopback 回退方案处理。
    pub(super) async fn try_system_session(
        app: AppHandle,
        bridge_url: Url,
        expected_state: String,
    ) -> Result<Option<Result<String, String>>, String> {
        let Some(window) = app.get_webview_window(crate::WINDOW_LABEL) else {
            return Ok(None);
        };
        let Ok(ns_window_ptr) = window.ns_window() else {
            return Ok(None);
        };
        let Some(anchor) = NonNull::new(ns_window_ptr.cast::<AnyObject>()) else {
            return Ok(None);
        };
        let anchor_addr = anchor.as_ptr() as usize;

        let full_url = with_callback_fragment(
            &bridge_url,
            &format!("{CALLBACK_SCHEME}://passkey"),
        );

        let (launch_tx, launch_rx) = std::sync::mpsc::channel::<Result<LaunchAttempt, String>>();
        let (done_tx, done_rx) = std::sync::mpsc::channel::<Result<String, String>>();
        let done_tx_slot = std::sync::Mutex::new(Some(done_tx));

        let app_for_main = app.clone();
        let state_for_callback = expected_state.clone();
        let url_string = full_url.as_str().to_string();

        app.run_on_main_thread(move || {
            let Some(session_cls) = AnyClass::get(c"ASWebAuthenticationSession") else {
                let _ = launch_tx.send(Ok(LaunchAttempt::Unsupported));
                return;
            };

            let Some(anchor_ptr) = NonNull::new(anchor_addr as *mut AnyObject) else {
                let _ = launch_tx.send(Ok(LaunchAttempt::Unsupported));
                return;
            };

            let ns_url_str = NSString::from_str(&url_string);
            let Some(ns_url) = NSURL::URLWithString(&ns_url_str) else {
                let _ = launch_tx.send(Err("构造 Passkey 系统会话 URL 失败".to_string()));
                return;
            };
            let ns_scheme = NSString::from_str(CALLBACK_SCHEME);
            let session_id = NEXT_SESSION_ID.fetch_add(1, Ordering::Relaxed);
            let app_for_cleanup = app_for_main.clone();

            let completion = RcBlock::new(move |callback_url: *mut NSURL, error: *mut NSError| {
                let outcome = if !callback_url.is_null() {
                    let url_ref = unsafe { &*callback_url };
                    match url_ref.absoluteString() {
                        Some(abs) => parse_callback_result(&abs.to_string(), &state_for_callback),
                        None => Err("Passkey 回调 URL 缺少字符串内容".to_string()),
                    }
                } else if !error.is_null() {
                    let err_ref = unsafe { &*error };
                    let domain = err_ref.domain().to_string();
                    let code = err_ref.code();
                    if domain.contains("ASWebAuthenticationSessionErrorDomain")
                        && code == AS_ERROR_CANCELED_LOGIN
                    {
                        Err(PASSKEY_CANCELLED_ERR.to_string())
                    } else {
                        Err(err_ref.localizedDescription().to_string())
                    }
                } else {
                    Err(PASSKEY_CANCELLED_ERR.to_string())
                };

                if let Some(tx) = done_tx_slot
                    .lock()
                    .ok()
                    .and_then(|mut guard| guard.take())
                {
                    let _ = tx.send(outcome);
                }

                let _ = app_for_cleanup.run_on_main_thread(move || {
                    cleanup_session(session_id);
                });
            });

            unsafe {
                let alloc: *mut AnyObject = msg_send![session_cls, alloc];
                let session_ptr: *mut AnyObject = msg_send![
                    alloc,
                    initWithURL: &*ns_url,
                    callbackURLScheme: &*ns_scheme,
                    completionHandler: &*completion
                ];
                let Some(session) = Retained::from_raw(session_ptr) else {
                    let _ = launch_tx.send(Ok(LaunchAttempt::Unsupported));
                    return;
                };

                let provider = PresentationProvider::new(anchor_ptr);
                let _: () = msg_send![&*session, setPrefersEphemeralWebBrowserSession: Bool::NO];
                let _: () = msg_send![&*session, setPresentationContextProvider: &*provider];

                let can_start: Bool = msg_send![&*session, canStart];
                if !can_start.as_bool() {
                    let _ = launch_tx.send(Ok(LaunchAttempt::Unsupported));
                    return;
                }

                ACTIVE_SESSIONS.with(|map| {
                    map.borrow_mut().insert(
                        session_id,
                        RetainedSession {
                            session: session.clone(),
                            _provider: provider,
                        },
                    );
                });

                let started: Bool = msg_send![&*session, start];
                if !started.as_bool() {
                    cleanup_session(session_id);
                    let _ = launch_tx.send(Ok(LaunchAttempt::Unsupported));
                    return;
                }

                let _ = launch_tx.send(Ok(LaunchAttempt::Started(session_id)));
            }
        })
        .map_err(|err| format!("调度 macOS Passkey 会话失败：{err}"))?;

        let launch_result = launch_rx
            .recv()
            .map_err(|_| "macOS Passkey 会话初始化中断".to_string())??;

        let session_id = match launch_result {
            LaunchAttempt::Unsupported => return Ok(None),
            LaunchAttempt::Started(id) => id,
        };

        let waited = tauri::async_runtime::spawn_blocking(move || {
            done_rx.recv_timeout(CEREMONY_TIMEOUT)
        })
        .await
        .map_err(|err| format!("Passkey 系统会话等待异常：{err}"))?;

        match waited {
            Ok(outcome) => Ok(Some(outcome)),
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                Ok(Some(Err(PASSKEY_CANCELLED_ERR.to_string())))
            }
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                let _ = app.run_on_main_thread(move || {
                    cancel_session(session_id);
                    cleanup_session(session_id);
                });
                Ok(Some(Err("Passkey 验证超时，请重试".to_string())))
            }
        }
    }
}

/// 在桌面端通过系统 Passkey 认证会话（macOS 为 `ASWebAuthenticationSession`）执行 WebAuthn 流程。
#[tauri::command]
pub async fn desktop_passkey_ceremony(
    app: AppHandle,
    url: String,
    expected_state: String,
) -> Result<String, String> {
    let bridge_url = validate_bridge_url(&app, &url, &expected_state)?;

    #[cfg(target_os = "macos")]
    {
        if let Some(result) =
            macos::try_system_session(app.clone(), bridge_url.clone(), expected_state.clone())
                .await?
        {
            return result;
        }
    }

    run_loopback_ceremony(app, bridge_url, expected_state).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_custom_scheme_payload() {
        let json = r#"{"id":"cred-1","rawId":"cred-1","type":"public-key"}"#;
        let encoded = URL_SAFE_NO_PAD.encode(json.as_bytes());
        let url = format!("hostid-desktop://passkey?state=state-123&payload={encoded}");
        let parsed = parse_callback_result(&url, "state-123").expect("should parse valid payload");
        assert_eq!(parsed, json);
    }

    #[test]
    fn parses_loopback_cancelled_error() {
        let url = "http://127.0.0.1:41234/passkey-callback?state=s1&error=cancelled";
        let err = parse_callback_result(url, "s1").unwrap_err();
        assert_eq!(err, PASSKEY_CANCELLED_ERR);
    }

    #[test]
    fn rejects_mismatched_state_and_unknown_scheme() {
        let encoded = URL_SAFE_NO_PAD.encode(b"{}");
        let bad_state = format!("hostid-desktop://passkey?state=wrong&payload={encoded}");
        assert!(parse_callback_result(&bad_state, "expected").is_err());

        let bad_scheme = format!("https://evil.example/passkey?state=expected&payload={encoded}");
        assert!(parse_callback_result(&bad_scheme, "expected").is_err());
    }

    #[test]
    fn appends_callback_to_fragment_cleanly() {
        let base = Url::parse("https://id.example.com/passkey-bridge#kind=login&state=abc").unwrap();
        let updated = with_callback_fragment(&base, "hostid-desktop://passkey");
        assert_eq!(
            updated.fragment(),
            Some("kind=login&state=abc&callback=hostid-desktop%3A%2F%2Fpasskey")
        );
    }
}
