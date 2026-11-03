<div align="center">

<img src="./frontend/public/logo-stylized.png" alt="HostID" width="96" height="96">

# HostID

**自托管的邮箱与统一登录，运行在自己的域名下。**

自托管 Web 邮箱，同时可作为应用的 SSO / OAuth 2.0 登录入口。

[![构建与验证](https://github.com/ginpika/hostid/actions/workflows/docker-build.yml/badge.svg)](https://github.com/ginpika/hostid/actions/workflows/docker-build.yml)
[![Docker: AMD64 / ARM64](https://img.shields.io/badge/Docker-AMD64%20%2F%20ARM64-2496ED?logo=docker&logoColor=white)](./docs/zh-CN/docker.md)
[![SSO + OAuth 2.0](https://img.shields.io/badge/Auth-SSO%20%2B%20OAuth%202.0-6366F1)](#identity)

[English](./README.md) · **简体中文**

[界面截图](#preview) · [架构说明](#decentralization) · [快速开始](#quick-start) · [接入应用](#identity) · [文档](./docs/zh-CN/README.md)

</div>

<a id="preview"></a>

![HostID 收件箱：自托管实例的界面](./docs/screenshots/inbox.png)

<details>
<summary>更多截图。</summary>

**撰写邮件。**

![在 HostID 中撰写邮件](./docs/screenshots/compose.png)

</details>

## HostID 适合什么场景

HostID 面向有自己的域名和服务器的人。它最初来自两个需求：一个自己愿意长期使用的自托管邮箱，以及一个让自建服务用同一账号登录的简单方式。现在这两件事都在一个项目里：`you@yourdomain.com` 的邮件服务，以及让自建应用复用同一个账号。

<a id="decentralization"></a>

## 独立实例与本地账号

HostID 不依赖官方账号中心。每个实例部署在自己的域名下，对自身的账号创建与登录负责。

- **地址归属。** 邮箱地址与登录入口位于自己控制的域名下。
- **数据自持。** 邮件、账号、附件与实例密钥保存在自己的部署里，存储与备份由运营者决定。
- **本地账号。** 在实例内创建账号，通过 SSO 或 OAuth 2.0 接入自建应用。
- **标准协议。** 邮件走 SMTP，应用走 OAuth 2.0；中继与第三方登录服务商自行选择。

这里的「去中心化」指独立部署与运营自主权：每个实例独立管理自己的账号与认证。个人服务器与社区实例使用同一模型。

## 邮箱功能

| 功能 | 说明 |
| --- | --- |
| **阅读** | 分栏阅读、列表视图、可拖动调整的阅读面板；HTML 邮件在隔离框架内保留原有排版。 |
| **搜索与筛选** | 当前文件夹搜索、未读筛选、星标、归档和批量操作。 |
| **撰写** | 富文本、Markdown、HTML 编辑；回复、回复全部、转发、抄送、密送和附件。 |
| **草稿** | 草稿自动保存在当前设备，支持恢复附件。 |
| **主题与语言** | 10 种主题（含 light、dark、classic、classic-dark），支持跟随系统、中英文切换。 |
| **初始化与管理** | 首次启动向导，以及集中管理系统设置、用户、OAuth 服务商和客户端应用的后台。 |

收信由内置 SMTP 服务处理；发信可走配置的 SMTP 中继，也可直接投递到收件域的 MX。支持 `.eml` 导入与导出，导出文件包含邮件头和正文，不包含附件。

<a id="quick-start"></a>

## 快速开始

准备好 **Docker 和 Compose 2.24+**。全量单镜像包含前端、API 和 SMTP 服务，支持 **AMD64 / ARM64**。

```sh
mkdir hostid
cd hostid
curl -fsSL https://raw.githubusercontent.com/ginpika/hostid/refs/heads/main/docs/docker-compose.full.yaml -o docker-compose.full.yaml
docker compose -f docker-compose.full.yaml up -d --wait
```

打开 **[http://localhost:3000](http://localhost:3000)**；远程部署时，把 `localhost` 换成服务器地址。首次访问会进入 `/setup`：

1. 填写站点对外地址和邮件域名。
2. 创建第一个管理员，密码至少 12 位。
3. 按需前往「设置 → 系统设置」配置 SMTP 中继、Turnstile 和 SSO。

不需要准备环境文件，也没有需要查找的默认管理员密码；大多数设置保存后立即生效。

默认宿主机端口为 **HTTP `3000`**、**入站 SMTP `25`**。需要修改时，在 Compose 同目录的 `.env` 中设置 `FRONTEND_PORT` 或 `SMTP_PORT`。公开部署时，为 HTTP 配置 HTTPS 反向代理，并在初始化时填写对应的公网地址。

想把前后端分开部署，或从源码构建？参阅 [Docker 部署文档](./docs/zh-CN/docker.md) 和 [双容器 Compose](./docs/docker-compose.yaml)。

### DNS 与收信

应用启动后即可使用 Web 界面。要接收来自互联网的邮件，还需配置 DNS 并开放 SMTP 端口：

| 记录 | 示例 |
| --- | --- |
| `example.com` 的 `MX` | 优先级 `10`，指向 `mail.example.com` |
| `mail.example.com` 的 `A` / `AAAA` | 邮件服务器的公网 IP 地址 |

确保公网 **TCP 25** 可达；HTTP 反向代理不会转发 SMTP。收件地址需要对应已存在的 HostID 用户。

对外发信建议先配置 **SMTP 中继**，再按实际发信路径和服务商要求设置 SPF、DKIM、DMARC。直接投递到对方 MX 时，效果取决于出站 25 端口、服务器 IP 信誉及收件方策略。配置步骤和投递排查见[邮件与 DNS](./docs/zh-CN/mail.md)。

<a id="identity"></a>

## SSO 与 OAuth 2.0

同一个账号可以同时用于邮箱和自建应用。

| 接入方式 | 可以做什么 |
| --- | --- |
| **共享会话 SSO** | 让同一主域下的应用检查 HostID 登录状态，并跳转到统一登录页。 |
| **作为 OAuth 2.0 服务端** | 注册客户端应用，使用授权码、PKCE S256、刷新令牌及 userinfo 接口。 |
| **第三方 OAuth 登录** | 使用已配置的服务商登录 HostID，可自定义授权、令牌和用户信息端点。 |

使用共享会话 SSO 前，先在「设置 → 系统设置」中配置 Cookie 域和允许的跨域来源。然后，应用就可以检查浏览器会话：

```js
const response = await fetch('https://mail.example.com/api/sso/session', {
  credentials: 'include',
})
const session = await response.json()

if (!session.authenticated) {
  const redirect = encodeURIComponent(window.location.href)
  window.location.assign(`https://mail.example.com/sso/login?redirect=${redirect}`)
}
```

生产环境应使用 HTTPS 和安全 Cookie。上面的会话检查用于浏览器跳转；应用后端仍需验证身份，才能返回受保护的数据。

OAuth 客户端可在管理后台创建应用并登记回调地址。全量单镜像通过 `/.well-known/oauth-authorization-server` 提供授权服务器元数据；前后端分离部署时，需要将该路径转发到后端。当前实现 OAuth 2.0，不签发 OpenID Connect ID Token。

客户端应用从 [OAuth 2.0 指南](./docs/zh-CN/oauth.md)开始，同一主域下的可信服务可使用[共享会话 SSO](./docs/zh-CN/sso.md)。服务端 SSO 示例：[Node.js](./docs/zh-CN/sso-integration-nodejs.md) · [Go](./docs/zh-CN/sso-integration-go.md) · [Java](./docs/zh-CN/sso-integration-java.md) · [Rust](./docs/zh-CN/sso-integration-rust.md)。

## 备份与升级

**备份数据时，一并备份 `secrets.json`。** `backend_data` 卷包含 SQLite 数据库和自动生成的 `secrets.json`，两者必须**一起备份、一起恢复**。密钥丢失后，加密设置将无法解密，已有会话也会失效。完整备份还应包含 `backend_uploads`、`backend_avatars` 和 `backend_logs`，并保留 Compose 和环境文件。如果显式设置了 `JWT_SECRET` 或 `DATA_ENCRYPTION_KEY`，还需安全备份实际使用的密钥值。

升级前先备份，然后在部署目录执行：

```sh
docker compose -f docker-compose.full.yaml pull
docker compose -f docker-compose.full.yaml up -d --wait
```

保留原有 Compose 项目名和卷名。**不要用 `docker compose down -v` 升级**，它会删除数据卷。需要固定到已发布的提交版本时，在 Compose `.env` 中设置 `IMAGE_TAG=sha-<完整提交 SHA>`。

<details>
<summary>忘记管理员密码了？</summary>

将 `your_username` 替换为管理员用户名：

```sh
docker compose -f docker-compose.full.yaml exec hostid-full node reset-admin.cjs your_username
```

新密码只在终端输出一次。

</details>

<details>
<summary>可以连接桌面邮件客户端吗？</summary>

HostID 当前提供 Web 邮箱和 SMTP 收信服务，不提供 IMAP / POP3。入站 SMTP 暂不提供 STARTTLS，也没有内置 DKIM 签名；部署需要这些能力时，应配合合适的邮件网关或中继服务。

</details>

## 技术栈

前端使用 **React + TypeScript + Vite**，后端使用 **Express + Prisma + SQLite**。Nodemailer 负责发信，`smtp-server` 负责收信，Tiptap 用于富文本编辑。

<details>
<summary>从源码运行与本地开发</summary>

使用 **Node.js 22+**。完整本地配置与检查说明见[开发指南](./docs/zh-CN/development.md)。在源码目录中，先启动后端：

```sh
cd backend
npm ci
npm run db:generate
export DATABASE_URL="file:./dev.db"
npm run db:migrate
npm run dev
```

另开终端，在仓库根目录启动前端：

```sh
npm ci --workspace=frontend
npm run dev
```

打开 `http://localhost:3000` 完成初始化。API 端口为 `3001`，本地 SMTP 默认端口为 `2525`。上述数据库地址用于本地开发；其他基础设施覆盖项见 [`backend/.env.example`](./backend/.env.example)。

在仓库根目录执行检查：

```sh
npm test
npm run typecheck
npm --prefix backend run typecheck
```

</details>

<a id="documentation"></a>

## 文档

[打开文档首页](./docs/zh-CN/README.md)，按部署、接入与开发任务查找指南。所有文档均提供 English 与简体中文版本。

| 你想做的事 | 对应文档 |
| --- | --- |
| 部署、升级或恢复实例 | [Docker 部署](./docs/zh-CN/docker.md) |
| 配置运行中的实例 | [系统设置](./docs/zh-CN/configuration.md) |
| 接入邮件域名与排查投递 | [邮件与 DNS](./docs/zh-CN/mail.md) |
| 接入应用或外部登录服务商 | [OAuth 2.0](./docs/zh-CN/oauth.md) · [共享会话 SSO](./docs/zh-CN/sso.md) |
| 运行源码与执行检查 | [本地开发](./docs/zh-CN/development.md) |
| 了解邮件正文如何显示 | [邮件渲染](./docs/zh-CN/email-rendering.md) |
| 修改界面与设计 | [设计系统](./docs/zh-CN/design-system.md) |
| 与嵌入宿主同步外观 | [外观同步](./docs/zh-CN/embedding.md) |
