# HostID 文档

[项目介绍](../../README-zh-CN.md) · [English](../README.md) · **简体中文**

按要完成的任务选择指南。每篇顶部都有对应语言入口；默认英文页面位于 `docs/`，简体中文位于 `docs/zh-CN/`。

## 让实例上线

1. [通过 Docker 部署](./docker.md#quick-start)，打开站点并创建第一个管理员。
2. 通过管理界面[配置实例](./configuration.md)。
3. [接入邮件域名](./mail.md)：创建收件账号、设置 DNS 和对外发信方式。
4. 升级或迁移前，先[备份实例](./docker.md#backup-and-restore)。

<a id="deployment"></a>

## 部署与维护

| 指南 | 解决的问题 |
| --- | --- |
| [Docker 部署](./docker.md) | 单容器或前后端分离、端口、HTTPS、健康检查、升级、备份恢复及镜像发布 |
| [实例配置](./configuration.md) | 首次运行、当前管理页面、设置存储、可选环境覆盖与旧配置迁移 |
| [邮件与 DNS](./mail.md) | 入站 SMTP、收件账号、MX 记录、中继、发件认证、排查与协议边界 |

<a id="authentication"></a>

## 接入自己的应用

先选择接入方式，再选择语言示例：

| 目标 | 从这里开始 |
| --- | --- |
| 让应用通过 HostID 完成 OAuth 授权 | [OAuth 2.0 接入](./oauth.md)：注册客户端、授权码 + PKCE、令牌与 userinfo |
| 同一主域下的可信应用共享浏览器会话 | [共享会话 SSO](./sso.md)：Cookie、CORS、会话验证与登出 |
| 通过外部服务商登录 HostID | [第三方登录](./oauth.md#third-party-login)：在 HostID 中配置登录服务商 |

以下是**服务端共享会话 SSO 示例**，并非 OAuth 客户端 SDK：

[Node.js](./sso-integration-nodejs.md) · [Go](./sso-integration-go.md) · [Java](./sso-integration-java.md) · [Rust](./sso-integration-rust.md)

浏览器跳转负责引导用户登录，应用后端仍须验证身份后才能返回受保护的数据。每个 HostID 实例管理自己的账号；会话与进程重启行为见对应指南。

<a id="development"></a>

## 开发 HostID

| 指南 | 解决的问题 |
| --- | --- |
| [本地开发](./development.md) | 依赖、开发数据库、前端/API 启动、检查与构建 |
| [设计系统](./design-system.md) | 当前主题与布局模型、源码入口、共享组件和界面约定 |
| [邮件渲染](./email-rendering.md) | HTML 隔离、MIME 处理、兼容性边界与浏览器检查 |
| [嵌入外观同步](./embedding.md) | 公开外观快照与同窗口事件契约 |
| [品牌素材](../../design/brand/README-zh-CN.md) | 主 Logo 文件和保留的备用图形 |

## 使用示例前

- 将 `example.com`、示例应用名和凭据占位符替换为自己的值。
- 容器命令会标明使用的 Compose 方案，在对应部署目录执行；恢复数据时保留原项目名。
- 站点、邮件、Turnstile 与 SSO 通过管理页面配置；环境文件保留给基础设施覆盖项，旧的纯环境变量指南已经更新。
- 英文与中文描述同一套实现。保留已有指南文件名，让旧链接继续指向对应主题。
