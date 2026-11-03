# 实例配置

[文档首页](./README.md) · [English](../configuration.md) · **简体中文**

在「设置 → 系统设置」（`/admin/settings`）中配置实例，仅管理员可访问。设置保存在 SQLite 中，环境文件主要用于基础设施覆盖项。

## 首次运行

新数据库会进入 `/setup`，填写站点对外地址、邮件域名并创建第一个管理员，密码至少 12 位。已有用户的实例保留原账号，不会重新进入初始化向导。

站点地址应填写最终使用的 HTTPS 地址，例如 `https://mail.example.com`。跳转和 OAuth 元数据会使用该地址；修改后也需检查应用回调地址和反向代理配置。

## 到哪里配置

| 设置位置 | 配置内容 | 对应指南 |
| --- | --- | --- |
| **系统设置 → 站点** | 对外地址、额外允许的 CORS 来源、可选 SSO 登录页地址 | [共享会话 SSO](./sso.md) |
| **系统设置 → 邮件** | 创建邮箱地址时使用的域名 | [邮件与 DNS](./mail.md) |
| **系统设置 → SMTP 中继** | 中继主机、端口、用户名和密码 | [对外发信](./mail.md#sending) |
| **系统设置 → 人机验证** | 可选 Cloudflare Turnstile 的 site key 与 secret | 见下文 |
| **系统设置 → SSO / 会话** | Cookie 范围、会话时长及接口限流 | [共享会话 SSO](./sso.md) |
| **登录服务** | 用于登录 HostID 的外部服务商 | [第三方登录](./oauth.md#third-party-login) |
| **应用授权** | 把 HostID 作为提供方的 OAuth 客户端应用 | [OAuth 2.0](./oauth.md) |
| **数据库** | 管理员查看存储记录 | 修改时优先使用对应的设置与应用表单 |

大多数设置保存后立即生效。SMTP 欢迎横幅使用启动时的邮件域名，修改横幅需重启服务。修改邮件域名不会自动改写已有用户的邮箱地址。

敏感字段只返回打码值。留空表示保留原值，移除密钥应使用明确的清除操作。[备份](./docker.md#backup-and-restore)时必须同时保存数据库和加密密钥。

## 可选 Turnstile

在「人机验证」中同时填写 site key 和 secret，并在 Turnstile 账号中配置允许的主机名。前端通过 `/config.js` 获取公开 site key，secret 留在后端。容器部署修改密钥后无需重新构建前端。

Vite 开发环境另有从 `frontend/.env` 生成 `/config.js` 的中间件，见[开发指南](./development.md#local-configuration)。

## 基础设施覆盖项

Compose 已提供 Docker 默认值。全量单容器可使用可选的 `hostid.env`，预构建双容器方案使用 `backend.env`，源码 Compose 使用可选的 `backend/.env`。

| 变量 | 用途 |
| --- | --- |
| `DATABASE_URL` | Prisma SQLite 地址；容器使用 `file:/app/data/prod.db` 等绝对路径 |
| `HOSTID_DATA_DIR` | `secrets.json` 目录，默认从数据库路径推导 |
| `JWT_SECRET` | 可选签名密钥覆盖，至少 32 字符 |
| `DATA_ENCRYPTION_KEY` | 可选数据加密密钥覆盖，至少 32 字符 |
| `PORT` / `SMTP_PORT` | 应用监听端口，随附 Compose 会显式设置内部值 |
| `HOSTID_WEB_ROOT` | 由全量后端提供静态服务的前端构建目录 |

宿主机端口映射和镜像选择属于 **Compose 变量**，从 shell 或部署目录 `.env` 读取：`FRONTEND_PORT`、`BACKEND_PORT`、`BACKEND_BIND_ADDRESS`、`SMTP_PORT`、`IMAGE_TAG`。应用的 `env_file` 不会参与 Compose 端口插值，见[端口配置](./docker.md#ports)。

本地开发需显式设置 `DATABASE_URL`，示例文件中该变量默认被注释。可选覆盖项见 [`backend/.env.example`](../../backend/.env.example)。修改密钥覆盖值前需考虑已有密文和会话，备份时保存实际使用的覆盖值。

## 已有部署

数据库缺少某项设置时，会导入旧环境中的站点、邮件、中继、Turnstile 与 SSO 配置。保存入库后，以「系统设置」为准，修改环境文件不会覆盖数据库中已有的配置。

外部 OAuth 服务商通过「登录服务」管理，旧的 GitHub 专用 OAuth 环境变量已不再读取。修改已有部署前，先阅读[升级说明](./docker.md#upgrading)。

实现参考：[设置定义与校验](../../backend/src/services/settings.ts)、[密钥存储](../../backend/src/config/secrets.ts)、[设置界面](../../frontend/src/pages/SystemSettingsPage.tsx)。
