#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_store::StoreExt;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalConfig {
    pub host: String,
    pub port: u16,
    pub auto_start: bool,
}

impl Default for LocalConfig {
    fn default() -> Self {
        Self {
            host: "localhost".to_string(),
            port: 3001,
            auto_start: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteConfig {
    pub url: String,
    pub last_connected: Option<String>,
}

impl Default for RemoteConfig {
    fn default() -> Self {
        Self {
            url: String::new(),
            last_connected: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ConnectionMode {
    #[serde(rename = "local")]
    Local,
    #[serde(rename = "remote")]
    Remote,
}

impl Default for ConnectionMode {
    fn default() -> Self {
        Self::Local
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub mode: ConnectionMode,
    pub local: LocalConfig,
    pub remote: RemoteConfig,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            mode: ConnectionMode::Local,
            local: LocalConfig::default(),
            remote: RemoteConfig::default(),
        }
    }
}

pub struct AppState {
    pub config: Mutex<AppConfig>,
}

#[tauri::command]
async fn get_config(app: tauri::AppHandle) -> Result<AppConfig, String> {
    let store = app.store("config.json").map_err(|e| e.to_string())?;
    
    let config = store
        .get("config")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();
    
    Ok(config)
}

#[tauri::command]
async fn set_config(app: tauri::AppHandle, config: AppConfig) -> Result<(), String> {
    let store = app.store("config.json").map_err(|e| e.to_string())?;
    
    store.set("config", serde_json::to_value(&config).map_err(|e| e.to_string())?);
    store.save().map_err(|e| e.to_string())?;
    
    let state = app.state::<AppState>();
    let mut current_config = state.config.lock().map_err(|e| e.to_string())?;
    *current_config = config;
    
    Ok(())
}

#[tauri::command]
async fn test_connection(mode: ConnectionMode, local: LocalConfig, remote: RemoteConfig) -> Result<bool, String> {
    let url = match mode {
        ConnectionMode::Local => format!("http://{}:{}/health", local.host, local.port),
        ConnectionMode::Remote => format!("{}/health", remote.url.trim_end_matches('/')),
    };
    
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| e.to_string())?;
    
    match client.get(&url).send().await {
        Ok(response) => Ok(response.status().is_success()),
        Err(_) => Ok(false),
    }
}

#[tauri::command]
async fn check_local_backend(local: LocalConfig) -> Result<bool, String> {
    let url = format!("http://{}:{}/health", local.host, local.port);
    
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(2))
        .build()
        .map_err(|e| e.to_string())?;
    
    match client.get(&url).send().await {
        Ok(response) => Ok(response.status().is_success()),
        Err(_) => Ok(false),
    }
}

#[tauri::command]
async fn get_system_info() -> Result<SystemInfo, String> {
    let sys = sysinfo::System::new_all();
    Ok(SystemInfo {
        os_name: sysinfo::System::name().unwrap_or_else(|| "Unknown".to_string()),
        os_version: sysinfo::System::os_version().unwrap_or_else(|| "Unknown".to_string()),
        total_memory: sys.total_memory(),
        available_memory: sys.available_memory(),
        cpu_count: sys.cpus().len() as u32,
    })
}

#[derive(Serialize)]
pub struct SystemInfo {
    pub os_name: String,
    pub os_version: String,
    pub total_memory: u64,
    pub available_memory: u64,
    pub cpu_count: u32,
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AppState {
            config: Mutex::new(AppConfig::default()),
        })
        .invoke_handler(tauri::generate_handler![
            get_config,
            set_config,
            test_connection,
            check_local_backend,
            get_system_info,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
