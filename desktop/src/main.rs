//! HostID 桌面壳（Tauri 2）：单窗口单 WebView 架构，在本地「实例启动台」与自托管 HostID 实例间切换。
//!
//! - 启动台（ui/index.html）：管理多个自托管或本地开发 HostID 实例，探测站点品牌与当前会话状态。
//! - 实例视图：直接加载目标 HostID 地址（https://... 或 http://localhost:3000），
//!   账号登录、Passkey、个人资料与权限管理全部由 HostID 实例自身提供。

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod config;
mod passkey;
mod session;
#[cfg(target_os = "macos")]
mod wk_cookie;

use serde::Serialize;
use session::{SessionClient, Site};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::webview::{NewWindowResponse, PageLoadEvent};
use tauri::window::EffectsBuilder;
use tauri::{
    AppHandle, Emitter, Manager, Url, Webview, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_shell::ShellExt;

/// 启动台订阅的状态事件名
const STATUS_EVENT: &str = "hostid://status";
/// 主窗口标签（capabilities 里也按它授权）
const WINDOW_LABEL: &str = "main";
/// 首页哨兵路径：实例页点击「启动台 / 切换实例」时往这里导航，主窗口 on_navigation 拦下并带回启动台
const HOME_PATH: &str = "/__hostid_desktop_home";
/// 登出哨兵路径：带回启动台并清除当前实例会话 Cookie
const LOGOUT_PATH: &str = "/__hostid_desktop_logout";

/// 进入实例时的过渡遮罩：文档创建（PageLoadEvent::Started）时铺一层高斯模糊 + 转圈，
/// 页面就绪后渐出并移除，配色匹配 HostID 保留的浅色主题（默认深空灰 #f5f5f5 / #333333）。
const ENTER_VEIL_JS: &str = r#"(function () {
  var id = '__hostid_enter_veil__';
  if (document.getElementById(id)) return;

  var palettes = {
    business: { bg: 'rgba(245,245,245,.62)', ring: 'rgba(31,31,31,.14)', accent: '#333333' },
    light: { bg: 'rgba(244,246,250,.62)', ring: 'rgba(32,43,64,.14)', accent: '#286cde' },
    sakura: { bg: 'rgba(254,242,242,.62)', ring: 'rgba(131,24,67,.14)', accent: '#ec4899' },
    lavender: { bg: 'rgba(250,245,255,.62)', ring: 'rgba(88,28,135,.14)', accent: '#a855f7' },
    classic: { bg: 'rgba(249,250,251,.62)', ring: 'rgba(17,24,39,.14)', accent: '#0ea5e9' }
  };
  var mode = 'business';
  try {
    var stored = localStorage.getItem('theme_mode');
    if (stored && palettes[stored]) mode = stored;
  } catch (e) {}
  var palette = palettes[mode] || palettes.business;
  var mac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);

  var style = document.createElement('style');
  style.textContent = '@keyframes hostid-veil-spin{to{transform:rotate(360deg)}}';
  (document.head || document.documentElement).appendChild(style);

  var el = document.createElement('div');
  el.id = id;
  el.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:2147483645', 'overflow:hidden',
    'border-radius:' + (mac ? '0' : '20px'),
    'display:flex', 'align-items:center', 'justify-content:center',
    'background:' + palette.bg,
    'backdrop-filter:blur(14px)', '-webkit-backdrop-filter:blur(14px)',
    'opacity:1', 'transition:opacity .55s ease,backdrop-filter .55s ease'
  ].join(';');
  var spinner = document.createElement('span');
  spinner.style.cssText = [
    'width:28px', 'height:28px',
    'border:2.5px solid ' + palette.ring,
    'border-top-color:' + palette.accent,
    'border-radius:999px', 'animation:hostid-veil-spin .8s linear infinite'
  ].join(';');
  el.appendChild(spinner);
  (document.body || document.documentElement).appendChild(el);

  function fade() {
    el.style.opacity = '0';
    el.style.backdropFilter = 'blur(0px)';
    el.style.webkitBackdropFilter = 'blur(0px)';
    el.style.pointerEvents = 'none';
    setTimeout(function () { el.remove(); style.remove(); }, 650);
  }
  function arm() { setTimeout(fade, 350); }
  if (document.readyState === 'complete') arm();
  else window.addEventListener('load', arm, { once: true });
  setTimeout(fade, 5500);
})();"#;

/// 离开实例时的过渡遮罩：在当前实例页渐入高斯模糊，随后切回启动台
const EXIT_VEIL_JS: &str = r#"(function () {
  var id = '__hostid_exit_veil__';
  if (document.getElementById(id)) return;
  var palettes = {
    business: { bg: 'rgba(245,245,245,.62)', ring: 'rgba(31,31,31,.14)', accent: '#333333' },
    light: { bg: 'rgba(244,246,250,.62)', ring: 'rgba(32,43,64,.14)', accent: '#286cde' },
    sakura: { bg: 'rgba(254,242,242,.62)', ring: 'rgba(131,24,67,.14)', accent: '#ec4899' },
    lavender: { bg: 'rgba(250,245,255,.62)', ring: 'rgba(88,28,135,.14)', accent: '#a855f7' },
    classic: { bg: 'rgba(249,250,251,.62)', ring: 'rgba(17,24,39,.14)', accent: '#0ea5e9' }
  };
  var cl = document.documentElement.classList;
  var mode = 'business';
  ['light', 'sakura', 'lavender', 'classic'].some(function (k) {
    if (cl.contains('theme-' + k)) { mode = k; return true; }
    return false;
  });
  var palette = palettes[mode] || palettes.business;
  var mac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);

  var style = document.createElement('style');
  style.textContent = '@keyframes hostid-veil-spin{to{transform:rotate(360deg)}}';
  (document.head || document.documentElement).appendChild(style);

  var el = document.createElement('div');
  el.id = id;
  el.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:2147483645', 'overflow:hidden',
    'border-radius:' + (mac ? '0' : '20px'),
    'display:flex', 'align-items:center', 'justify-content:center',
    'background:' + palette.bg,
    'backdrop-filter:blur(0px)', '-webkit-backdrop-filter:blur(0px)',
    'opacity:0', 'transition:opacity .55s ease,backdrop-filter .55s ease'
  ].join(';');
  var spinner = document.createElement('span');
  spinner.style.cssText = [
    'width:28px', 'height:28px',
    'border:2.5px solid ' + palette.ring,
    'border-top-color:' + palette.accent,
    'border-radius:999px', 'animation:hostid-veil-spin .8s linear infinite'
  ].join(';');
  el.appendChild(spinner);
  (document.body || document.documentElement).appendChild(el);

  requestAnimationFrame(function () {
    el.style.opacity = '1';
    el.style.backdropFilter = 'blur(14px)';
    el.style.webkitBackdropFilter = 'blur(14px)';
  });
  setTimeout(function () {
    el.style.opacity = '0';
    el.style.backdropFilter = 'blur(0px)';
    el.style.webkitBackdropFilter = 'blur(0px)';
    setTimeout(function () { el.remove(); style.remove(); }, 650);
  }, 8000);
})();"#;

/// 当前后台存活的实例会话（从实例点击「启动台」返回时保存其精确页面地址）
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceSession {
    /// 实例当前精确地址（含路径 / 查询参数 / hash）
    url: String,
    /// 归一化后的实例基址（用于匹配 saved instances）
    base_url: String,
}

/// 壳的对外状态（启动台据此渲染）
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    last_url: String,
    /// idle | connecting | entering | returning | error
    phase: String,
    detail: String,
    instance: Option<InstanceSession>,
    instances: Vec<config::SavedInstance>,
}

/// 壳的进程内状态
pub struct Shell {
    status: Mutex<Status>,
    launcher_url: Mutex<String>,
    busy: AtomicBool,
    returning: AtomicBool,
    entering: AtomicBool,
}

struct BusyGuard<'a>(&'a AtomicBool);
impl Drop for BusyGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

fn emit_status(app: &AppHandle, phase: &str, detail: &str) {
    let shell = app.state::<Shell>();
    let snapshot = {
        let mut status = shell.status.lock().unwrap();
        status.phase = phase.to_string();
        status.detail = detail.to_string();
        status.clone()
    };
    let _ = app.emit(STATUS_EVENT, snapshot);
}

fn sync_config_to_status(app: &AppHandle, cfg: &config::Config) {
    let shell = app.state::<Shell>();
    let snapshot = {
        let mut status = shell.status.lock().unwrap();
        status.last_url = cfg.last_url.clone();
        status.instances = cfg.instances.clone();
        status.clone()
    };
    let _ = app.emit(STATUS_EVENT, snapshot);
}

fn set_instance_session(app: &AppHandle, session: Option<InstanceSession>) {
    let Some(shell) = app.try_state::<Shell>() else {
        return;
    };
    let snapshot = {
        let mut status = shell.status.lock().unwrap();
        status.instance = session;
        status.clone()
    };
    let _ = app.emit(STATUS_EVENT, snapshot);
}

fn current_instance_session(app: &AppHandle) -> Option<InstanceSession> {
    app.try_state::<Shell>()
        .and_then(|shell| shell.status.lock().unwrap().instance.clone())
}

/// 订阅 HostID 页面发布的外观快照（见 docs/zh-CN/embedding.md），
/// 将主背景色同步到 macOS 透明原生标题栏，使红绿灯栏与任意主题融为一体且不侵入 WebView 布局。
#[cfg(target_os = "macos")]
const APPEARANCE_SYNC_JS: &str = r#"(function () {
  if (window.top !== window) return;
  var apply = function (snapshot) {
    if (!snapshot || snapshot.version !== 1 || typeof snapshot.backgroundColor !== 'string') return;
    if (!/^#[0-9a-f]{6}$/i.test(snapshot.backgroundColor)) return;
    var tauri = window.__TAURI__;
    var invoke = tauri && ((tauri.core && tauri.core.invoke) || tauri.invoke);
    if (invoke) {
      invoke('plugin:window|set_background_color', { value: snapshot.backgroundColor }).catch(function () {});
    }
  };
  window.addEventListener('hostid:appearance', function (e) { apply(e && e.detail); });
  if (window.__HOSTID_APPEARANCE__) apply(window.__HOSTID_APPEARANCE__);
})();"#;

fn main_webview(app: &AppHandle) -> Option<Webview> {
    app.get_webview_window(WINDOW_LABEL)
        .map(|window| window.as_ref().clone())
}

fn client(app: &AppHandle) -> Result<SessionClient, String> {
    SessionClient::new(main_webview(app).ok_or("主窗口已关闭")?)
}

fn navigate(app: &AppHandle, url: &str) -> bool {
    let Some(webview) = main_webview(app) else {
        return false;
    };
    match url.parse::<Url>() {
        Ok(parsed) => match webview.navigate(parsed) {
            Ok(()) => true,
            Err(err) => {
                emit_status(app, "error", &format!("打开 {url} 失败：{err}"));
                false
            }
        },
        Err(err) => {
            emit_status(app, "error", &format!("地址无效（{url}）：{err}"));
            false
        }
    }
}

fn remember_launcher_if_first(app: &AppHandle, url: &Url) {
    if !matches!(url.scheme(), "http" | "https" | "tauri") {
        return;
    }
    let shell = app.state::<Shell>();
    let mut slot = shell.launcher_url.lock().unwrap();
    if slot.is_empty() {
        *slot = url.to_string();
    }
}

fn navigate_launcher(app: &AppHandle) -> bool {
    let url = app.state::<Shell>().launcher_url.lock().unwrap().clone();
    if url.is_empty() {
        eprintln!("[hostid-desktop] 未知启动台地址，无法返回");
        return false;
    }
    navigate(app, &url)
}

fn notify_main(app: &AppHandle, text: &str) {
    let Some(webview) = main_webview(app) else {
        return;
    };
    let text_lit = serde_json::to_string(text).unwrap_or_else(|_| "\"\"".to_string());
    let js = format!(
        r#"(function () {{
  var id = '__hostid_desktop_toast__';
  var el = document.getElementById(id);
  if (!el) {{
    el = document.createElement('div');
    el.id = id;
    el.style.cssText = [
      'position:fixed', 'left:50%', 'top:20px', 'transform:translateX(-50%)',
      'z-index:2147483647', 'max-width:72vw',
      'padding:9px 16px', 'border-radius:10px',
      'border:1px solid rgba(255,255,255,.12)',
      'background:rgba(20,24,33,.94)', 'color:#f4f6fa',
      'font:500 13px/1.5 -apple-system,BlinkMacSystemFont,"Inter","Segoe UI","PingFang SC","Microsoft YaHei",sans-serif',
      'box-shadow:0 10px 28px rgba(0,0,0,.22)', 'pointer-events:none',
      'opacity:0', 'transition:opacity .2s ease',
      'white-space:nowrap', 'overflow:hidden', 'text-overflow:ellipsis'
    ].join(';');
    (document.body || document.documentElement).appendChild(el);
  }}
  el.textContent = {text};
  requestAnimationFrame(function () {{ el.style.opacity = '1'; }});
  if (el.__hostidTimer) clearTimeout(el.__hostidTimer);
  el.__hostidTimer = setTimeout(function () {{ el.style.opacity = '0'; }}, 6000);
}})();"#,
        text = text_lit,
    );
    let _ = webview.eval(&js);
}

fn enter_instance(app: &AppHandle, target_url: &str, base_url: &str) {
    set_instance_session(
        app,
        Some(InstanceSession {
            url: target_url.to_string(),
            base_url: base_url.to_string(),
        }),
    );
    emit_status(app, "entering", "正在进入 HostID 实例…");
    let handle = app.clone();
    let url = target_url.to_string();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(650));
        handle
            .state::<Shell>()
            .entering
            .store(true, Ordering::SeqCst);
        if !navigate(&handle, &url) {
            handle
                .state::<Shell>()
                .entering
                .store(false, Ordering::SeqCst);
            set_instance_session(&handle, None);
        }
    });
}

fn open_launcher_home(app: &AppHandle) {
    let current = main_webview(app)
        .and_then(|webview| webview.url().ok())
        .filter(|url| url.path() != HOME_PATH && url.path() != LOGOUT_PATH)
        .map(|url| url.to_string());

    let shell = app.state::<Shell>();
    let snapshot = {
        let mut status = shell.status.lock().unwrap();
        if let Some(url) = current {
            let base_url = status
                .instance
                .as_ref()
                .map(|i| i.base_url.clone())
                .unwrap_or_else(|| status.last_url.clone());
            status.instance = Some(InstanceSession { url, base_url });
        }
        status.phase = "idle".to_string();
        status.detail.clear();
        status.clone()
    };
    let _ = app.emit(STATUS_EVENT, snapshot.clone());
    navigate_launcher(app);

    if let Some(active) = snapshot.instance {
        let handle = app.clone();
        std::thread::spawn(move || {
            let Ok(site) = Site::parse(&active.base_url) else {
                return;
            };
            let Ok(c) = client(&handle) else {
                return;
            };
            let Ok(info) = c.probe_site(&site) else {
                return;
            };
            let Ok(user) = c.current_user(&site) else {
                return;
            };
            let (user_name, user_email, user_avatar) = user_fields(user.as_ref());
            let before = handle
                .state::<Shell>()
                .status
                .lock()
                .unwrap()
                .instances
                .clone();
            if let Ok(cfg) = config::update(&handle, |cfg| {
                cfg.refresh_existing_instance(
                    site.base(),
                    info.site_name,
                    info.site_slogan,
                    info.site_icon,
                    user_name,
                    user_email,
                    user_avatar,
                );
                Ok(())
            }) {
                if cfg.instances != before {
                    sync_config_to_status(&handle, &cfg);
                }
            }
        });
    }
}

fn return_to_launcher(app: &AppHandle, notice: Option<&str>) {
    if app.state::<Shell>().returning.swap(true, Ordering::SeqCst) {
        return;
    }

    if let Some(webview) = main_webview(app) {
        let _ = webview.eval(EXIT_VEIL_JS);
    }
    if let Some(text) = notice {
        notify_main(app, text);
    }
    std::thread::sleep(Duration::from_millis(750));

    let shell = app.state::<Shell>();
    shell.entering.store(false, Ordering::SeqCst);
    let snapshot = {
        let mut status = shell.status.lock().unwrap();
        status.instance = None;
        status.phase = "returning".to_string();
        status.detail.clear();
        status.clone()
    };
    let _ = app.emit(STATUS_EVENT, snapshot);
    navigate_launcher(app);
    app.state::<Shell>()
        .returning
        .store(false, Ordering::SeqCst);
}

fn intercept_navigation(app: &AppHandle, nav: &Url) -> bool {
    if nav.path() == HOME_PATH {
        let handle = app.clone();
        std::thread::spawn(move || open_launcher_home(&handle));
        return false;
    }
    if nav.path() == LOGOUT_PATH {
        let handle = app.clone();
        std::thread::spawn(move || {
            if let Some(active) = current_instance_session(&handle) {
                if let Ok(site) = Site::parse(&active.base_url) {
                    if let Ok(c) = client(&handle) {
                        let _ = c.clear_cookies(&site);
                    }
                    if let Ok(cfg) = config::update(&handle, |cfg| {
                        cfg.clear_instance_user(site.base());
                        Ok(())
                    }) {
                        sync_config_to_status(&handle, &cfg);
                    }
                }
            }
            return_to_launcher(&handle, Some("已返回实例启动台"));
        });
        return false;
    }
    true
}

fn start_bg(
    app: AppHandle,
    work: impl FnOnce(&AppHandle) -> Result<(), String> + Send + 'static,
) -> Result<(), String> {
    if app.state::<Shell>().busy.swap(true, Ordering::AcqRel) {
        return Err("正在处理连接请求，请稍候".into());
    }
    std::thread::spawn(move || {
        let shell = app.state::<Shell>();
        let _guard = BusyGuard(&shell.busy);
        if let Err(err) = work(&app) {
            emit_status(&app, "error", &err);
            notify_main(&app, &err);
        }
    });
    Ok(())
}

fn user_fields(user: Option<&session::User>) -> (String, String, String) {
    (
        user.map(|u| u.display_name().to_string()).unwrap_or_default(),
        user.and_then(|u| u.email.clone()).unwrap_or_default(),
        user.and_then(|u| u.avatar_url.clone()).unwrap_or_default(),
    )
}

fn save_probed_instance(
    app: &AppHandle,
    site: &Site,
    info: &session::SiteInfo,
    user: Option<&session::User>,
    touch_last_url: bool,
) -> Result<config::Config, String> {
    let base = site.base().to_string();
    let (user_name, user_email, user_avatar) = user_fields(user);
    let cfg = config::update(app, |cfg| {
        if touch_last_url {
            cfg.last_url = base.clone();
        }
        let site_icon = match info.site_icon.as_ref() {
            Some(icon) => icon.clone(),
            None => cfg
                .instances
                .iter()
                .find(|item| item.url == base)
                .map(|item| item.site_icon.clone())
                .unwrap_or_default(),
        };
        cfg.upsert_instance(config::SavedInstance {
            url: base.clone(),
            site_name: info.site_name.clone(),
            site_slogan: info.site_slogan.clone(),
            site_icon,
            user_name,
            user_email,
            user_avatar,
            last_connected_at: config::now_unix_secs(),
        });
        Ok(())
    })?;
    sync_config_to_status(app, &cfg);
    Ok(cfg)
}

#[tauri::command]
fn desktop_state(shell: tauri::State<'_, Shell>) -> Status {
    shell.status.lock().unwrap().clone()
}

#[tauri::command]
fn desktop_connect(app: AppHandle, url: String) -> Result<(), String> {
    let site = Site::parse(&url)?;
    start_bg(app, move |app| {
        emit_status(app, "connecting", &format!("正在连接 {}…", site.base()));
        let client = client(app)?;
        let info = client.probe_site(&site)?;
        let user = client.current_user(&site).ok().flatten();
        save_probed_instance(app, &site, &info, user.as_ref(), true)?;

        // 如果当前后台已经有同一个实例的存活会话（例如点击「启动台」返回过），直接恢复到离开时的路由
        let target = current_instance_session(app)
            .filter(|s| s.base_url == site.base())
            .map(|s| s.url)
            .unwrap_or_else(|| site.url("").to_string());
        enter_instance(app, &target, site.base());
        Ok(())
    })
}

#[tauri::command]
fn desktop_resume_instance(app: AppHandle) -> Result<(), String> {
    let Some(session) = current_instance_session(&app) else {
        return Ok(());
    };
    let handle = app.clone();
    std::thread::spawn(move || {
        if !navigate(&handle, &session.url) {
            set_instance_session(&handle, None);
        }
    });
    Ok(())
}

#[tauri::command]
fn desktop_refresh_instance(app: AppHandle, url: String) -> Result<(), String> {
    let site = Site::parse(&url)?;
    start_bg(app, move |app| {
        emit_status(app, "connecting", &format!("正在检测 {}…", site.base()));
        let client = client(app)?;
        let info = client.probe_site(&site)?;
        let user = client.current_user(&site)?;
        save_probed_instance(app, &site, &info, user.as_ref(), false)?;
        emit_status(app, "idle", "");
        notify_main(
            app,
            &match user {
                Some(u) => format!("{} 已就绪（当前登录：{}）", info.site_name, u.display_name()),
                None => format!("{} 在线（当前未登录）", info.site_name),
            },
        );
        Ok(())
    })
}

#[tauri::command]
fn desktop_remove_instance(app: AppHandle, url: String) -> Result<Status, String> {
    let trimmed = url.trim().trim_end_matches('/').to_string();
    let cfg = config::update(&app, |cfg| {
        cfg.remove_instance(&trimmed);
        Ok(())
    })?;
    let shell = app.state::<Shell>();
    let snapshot = {
        let mut status = shell.status.lock().unwrap();
        if status
            .instance
            .as_ref()
            .is_some_and(|inst| inst.base_url == trimmed)
        {
            status.instance = None;
        }
        status.last_url = cfg.last_url.clone();
        status.instances = cfg.instances.clone();
        status.clone()
    };
    let _ = app.emit(STATUS_EVENT, snapshot.clone());
    Ok(snapshot)
}

#[tauri::command]
fn desktop_return_done(app: AppHandle) {
    let shell = app.state::<Shell>();
    let snapshot = {
        let mut status = shell.status.lock().unwrap();
        if status.phase != "returning" {
            return;
        }
        status.phase = "idle".to_string();
        status.detail.clear();
        status.clone()
    };
    let _ = app.emit(STATUS_EVENT, snapshot);
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            desktop_state,
            desktop_connect,
            desktop_resume_instance,
            desktop_refresh_instance,
            desktop_remove_instance,
            desktop_return_done,
            passkey::desktop_passkey_ceremony,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            let cfg = config::load(&handle);

            app.manage(Shell {
                status: Mutex::new(Status {
                    last_url: cfg.last_url.clone(),
                    phase: "idle".to_string(),
                    detail: String::new(),
                    instance: None,
                    instances: cfg.instances.clone(),
                }),
                launcher_url: Mutex::new(String::new()),
                busy: AtomicBool::new(false),
                returning: AtomicBool::new(false),
                entering: AtomicBool::new(false),
            });

            #[allow(unused_mut)]
            let mut builder =
                WebviewWindowBuilder::new(app, WINDOW_LABEL, WebviewUrl::App("index.html".into()))
                    .title("HostID")
                    .inner_size(1280.0, 760.0)
                    .min_inner_size(960.0, 620.0)
                    .decorations(cfg!(target_os = "macos"))
                    .transparent(!cfg!(target_os = "macos"))
                    .effects(EffectsBuilder::new().build())
                    .shadow(cfg!(target_os = "macos"))
                    .center()
                    .prevent_overflow()
                    .on_navigation({
                        let nav_handle = handle.clone();
                        move |nav| intercept_navigation(&nav_handle, nav)
                    })
                    .on_new_window({
                        let open_handle = handle.clone();
                        move |url, _features| {
                            if matches!(url.scheme(), "http" | "https") {
                                #[allow(deprecated)]
                                let _ = open_handle.shell().open(url.as_str(), None);
                            }
                            NewWindowResponse::Deny
                        }
                    })
                    .on_page_load({
                        let page_handle = handle.clone();
                        move |window, payload| {
                            if let PageLoadEvent::Started = payload.event() {
                                remember_launcher_if_first(&page_handle, payload.url());
                                if page_handle
                                    .state::<Shell>()
                                    .entering
                                    .swap(false, Ordering::SeqCst)
                                {
                                    let _ = window.eval(ENTER_VEIL_JS);
                                }
                            }
                        }
                    });

            #[cfg(target_os = "macos")]
            {
                // Transparent + 非 fullsize content view：原生标题栏与红绿灯位于 WebView 之上，
                // 不占用或遮挡应用内任何 UI 区域，同时跟随主题背景色透明融合。
                builder = builder
                    .title_bar_style(tauri::TitleBarStyle::Transparent)
                    .hidden_title(true)
                    .initialization_script(APPEARANCE_SYNC_JS);
            }
            let _main_window = builder.build()?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("HostID desktop 启动失败")
        .run(|_app, _event| {});
}
