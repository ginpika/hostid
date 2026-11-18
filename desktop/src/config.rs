use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

static CONFIG_LOCK: Mutex<()> = Mutex::new(());
const MAX_SAVED_INSTANCES: usize = 12;

/// 已保存的 HostID 实例记录（用于启动台快速连接与会话状态展示）
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SavedInstance {
    /// 归一化后的站点地址（如 https://mail.example.com，不带结尾斜杠）
    pub url: String,
    /// 实例站点名称（来自 /api/auth/site，默认 HostID）
    #[serde(default)]
    pub site_name: String,
    /// 实例 Slogan（来自 /api/auth/site）
    #[serde(default)]
    pub site_slogan: String,
    /// 最近一次登录该实例的用户名/昵称（空 = 未登录或未获取）
    #[serde(default)]
    pub user_name: String,
    /// 最近一次登录该实例的邮箱
    #[serde(default)]
    pub user_email: String,
    /// 最近一次登录该实例的头像（data URL 或空）
    #[serde(default)]
    pub user_avatar: String,
    /// 最近连接时间戳（Unix 秒）
    #[serde(default)]
    pub last_connected_at: u64,
}

/// 壳的持久化配置（{AppConfigDir}/config.json）
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    /// 最近一次连接的 HostID 实例地址
    #[serde(default)]
    pub last_url: String,
    /// 已保存的 HostID 实例列表（按最近使用倒序）
    #[serde(default)]
    pub instances: Vec<SavedInstance>,
}

pub fn now_unix_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

impl Config {
    pub fn upsert_instance(&mut self, mut entry: SavedInstance) {
        let normalized = entry.url.trim().trim_end_matches('/').to_string();
        if normalized.is_empty() {
            return;
        }
        entry.url = normalized.clone();
        if entry.last_connected_at == 0 {
            entry.last_connected_at = now_unix_secs();
        }
        if let Some(pos) = self.instances.iter().position(|item| item.url == normalized) {
            let previous = self.instances.remove(pos);
            let same_site = entry.site_name.is_empty() || entry.site_name == previous.site_name;
            if entry.site_name.is_empty() {
                entry.site_name = previous.site_name;
            }
            if entry.site_slogan.is_empty() && same_site {
                entry.site_slogan = previous.site_slogan;
            }
        }
        self.instances.insert(0, entry);
        self.instances.truncate(MAX_SAVED_INSTANCES);
    }

    pub fn update_instance_user(
        &mut self,
        url: &str,
        user_name: String,
        user_email: String,
        user_avatar: String,
    ) {
        let normalized = url.trim().trim_end_matches('/');
        if let Some(item) = self.instances.iter_mut().find(|item| item.url == normalized) {
            item.user_name = user_name;
            item.user_email = user_email;
            item.user_avatar = user_avatar;
        }
    }

    pub fn clear_instance_user(&mut self, url: &str) {
        self.update_instance_user(url, String::new(), String::new(), String::new());
    }

    pub fn remove_instance(&mut self, url: &str) -> bool {
        let normalized = url.trim().trim_end_matches('/');
        let before = self.instances.len();
        self.instances.retain(|item| item.url != normalized);
        if self.last_url.trim_end_matches('/') == normalized {
            self.last_url = self
                .instances
                .first()
                .map(|item| item.url.clone())
                .unwrap_or_default();
        }
        self.instances.len() != before
    }
}

fn path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("config.json"))
}

/// 读取配置；文件缺失或损坏时回落到默认空配置
pub fn load(app: &AppHandle) -> Config {
    let _lock = CONFIG_LOCK.lock().unwrap();
    read(app)
}

pub fn update(
    app: &AppHandle,
    change: impl FnOnce(&mut Config) -> Result<(), String>,
) -> Result<Config, String> {
    let _lock = CONFIG_LOCK.lock().unwrap();
    let previous = read(app);
    let mut cfg = previous.clone();
    change(&mut cfg)?;
    if cfg != previous {
        save(app, &cfg)?;
    }
    Ok(cfg)
}

fn read(app: &AppHandle) -> Config {
    let Ok(p) = path(app) else {
        return Config::default();
    };
    std::fs::read_to_string(p)
        .ok()
        .and_then(|s| serde_json::from_str::<Config>(&s).ok())
        .unwrap_or_default()
}

fn save(app: &AppHandle, cfg: &Config) -> Result<(), String> {
    let p = path(app)?;
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    std::fs::write(p, json).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn upserts_moves_instance_to_front_and_caps_list() {
        let mut cfg = Config::default();
        for i in 0..15 {
            cfg.upsert_instance(SavedInstance {
                url: format!("https://mail{i}.example.com/"),
                site_name: format!("Mail {i}"),
                last_connected_at: 100 + i as u64,
                ..Default::default()
            });
        }
        assert_eq!(cfg.instances.len(), MAX_SAVED_INSTANCES);
        assert_eq!(cfg.instances[0].url, "https://mail14.example.com");

        // Re-upserting existing item promotes it to the top.
        cfg.upsert_instance(SavedInstance {
            url: "https://mail10.example.com".into(),
            site_name: "Updated 10".into(),
            last_connected_at: 500,
            ..Default::default()
        });
        assert_eq!(cfg.instances[0].url, "https://mail10.example.com");
        assert_eq!(cfg.instances[0].site_name, "Updated 10");
        assert_eq!(cfg.instances.len(), MAX_SAVED_INSTANCES);
    }

    #[test]
    fn remove_instance_updates_last_url() {
        let mut cfg = Config {
            last_url: "https://a.example.com".into(),
            instances: vec![
                SavedInstance {
                    url: "https://a.example.com".into(),
                    ..Default::default()
                },
                SavedInstance {
                    url: "https://b.example.com".into(),
                    ..Default::default()
                },
            ],
        };
        assert!(cfg.remove_instance("https://a.example.com/"));
        assert_eq!(cfg.last_url, "https://b.example.com");
        assert_eq!(cfg.instances.len(), 1);
    }
}
