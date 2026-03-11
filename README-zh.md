![HostID Logo](logo.png)

[English](./README.md) [中文](./README-zh.md)

一个轻量级的自托管邮件服务器和 SSO 提供商，专为想要拥有自己域名邮箱的用户设计，提供极简的身份认证基础。

在线演示：https://mail.ginpika.cc （账号：`test`，密码：`VFObHC#e5nZ7Fxi&`）

演示服务器禁止了发信出口，仅支持内部用户之间的邮件发送，仅用于展示。

**使用预编译的镜像部署**

```shell
mkdir ./hostid
cd hostid
wget -O https://raw.githubusercontent.com/ginpika/hostid/refs/heads/main/docs/docker-compose.yaml
touch frontend.env
wget -O backend.env https://raw.githubusercontent.com/ginpika/hostid/refs/heads/main/backend/.env.example
# 请在正确配置 backend.env & frontend.env 后执行
docker-compose up -d
```

## 技术栈

### 后端
- **运行时**: Node.js + TypeScript
- **框架**: Express.js
- **数据库**: SQLite (通过 Prisma ORM)
- **认证**: JWT + bcryptjs
- **邮件**: 
  - SMTP 服务器 (smtp-server)
  - 邮件解析器 (mailparser)
  - 邮件发送器 (nodemailer)

### 前端
- **框架**: React 18 + TypeScript
- **构建工具**: Vite
- **样式**: Tailwind CSS
- **富文本编辑器**: TipTap
- **路由**: React Router DOM
- **动画**: Framer Motion

### 桌面应用
- **框架**: Tauri (Rust)

### 部署
- **容器化**: Docker + Docker Compose
- **Web 服务器**: Nginx (用于前端)

## 功能特性

### 邮件服务器
- **SMTP 服务器**: 内置 SMTP 服务器，监听 25 端口接收邮件
- **邮件发送**: 支持通过 MX 记录直接投递或通过外部 SMTP 中继发送
- **邮箱管理**: 收件箱、归档、星标邮件
- **富文本撰写**: 基于 TipTap 的富文本编辑器，支持数学公式 (KaTeX)
- **附件支持**: 完整的附件发送和接收支持
- **邮件摘要**: AI 驱动的邮件摘要功能 (可选)

### SSO 单点登录
- **单点登录**: 作为多个应用的身份提供商
- **跨域认证**: 在子域名之间共享认证状态
- **会话管理**: 安全的会话处理，支持可配置的过期时间
- **简单集成**: 简单的 API 接口，易于集成到任何 Web 应用

### 用户管理
- **用户注册**: 支持 Cloudflare Turnstile 机器人防护
- **用户资料**: 昵称、电话、生日、头像、语言偏好
- **角色系统**: 管理员和普通用户角色
- **管理面板**: 用户管理和 SSO 应用配置

### 界面体验
- **多语言**: 国际化支持 (i18n)
- **主题支持**: 多种主题选项
- **响应式设计**: 支持桌面端和移动端
- **桌面应用**: 通过 Tauri 提供原生桌面应用

## 部署

### 前置条件
- 已安装 Docker 和 Docker Compose
- 已配置 DNS 的域名
- (可选) Cloudflare Turnstile 密钥用于机器人防护

### Docker 快速部署

1. **克隆仓库**
   ```bash
   git clone https://github.com/yourusername/hostid.git
   cd hostid
   ```

2. **创建环境配置文件**
   ```bash
   cp .env.example .env
   ```

3. **编辑 `.env` 配置**
   ```env
   # 必填项
   JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
   MAIL_DOMAIN=yourdomain.com
   
   # 可选 - SMTP 中继
   SMTP_HOST=
   SMTP_OUT_PORT=25
   SMTP_USER=
   SMTP_PASS=
   
   # 可选 - Cloudflare Turnstile
   CF_TURNSTILE_SECRET_KEY=
   CF_TURNSTILE_SITE_KEY=
   
   # SSO 配置
   SSO_COOKIE_DOMAIN=.yourdomain.com
   SSO_COOKIE_SECURE=true
   ```

4. **启动服务**
   ```bash
   docker-compose up -d
   ```

5. **访问应用**
   - Web 界面: `http://yourdomain.com` (如配置 HTTPS 则为 `https://`)
   - SMTP 端口: 25 (用于接收邮件)

### 手动部署

#### 后端设置

```bash
cd backend

# 安装依赖
npm install

# 生成 Prisma 客户端
npm run db:generate

# 运行数据库迁移
npm run db:migrate

# 启动开发服务器
npm run dev

# 或者构建并启动生产环境
npm run build
npm start
```

#### 前端设置

```bash
cd frontend

# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 或者构建生产版本
npm run build
npm run preview
```

### 环境变量

| 变量 | 描述 | 默认值 |
|------|------|--------|
| `DATABASE_URL` | SQLite 数据库路径 | `file:/app/data/prod.db` |
| `JWT_SECRET` | JWT 令牌密钥 | *必填* |
| `MAIL_DOMAIN` | 邮件域名 | *必填* |
| `PORT` | Web 界面端口 | `80` |
| `SMTP_PORT` | SMTP 服务器端口 | `25` |
| `SMTP_HOST` | 外部 SMTP 中继主机 | - |
| `SMTP_OUT_PORT` | 外部 SMTP 端口 | `25` |
| `SMTP_USER` | SMTP 认证用户名 | - |
| `SMTP_PASS` | SMTP 认证密码 | - |
| `CF_TURNSTILE_SECRET_KEY` | Cloudflare Turnstile 密钥 | - |
| `CF_TURNSTILE_SITE_KEY` | Cloudflare Turnstile 站点密钥 | - |
| `SSO_COOKIE_DOMAIN` | SSO Cookie 域名 | - |
| `SSO_COOKIE_SECURE` | 使用安全 Cookie | `false` |
| `SESSION_TTL` | 会话有效期（秒） | `604800` |

## SSO 集成

HostID 可以作为其他应用的 SSO 提供商。请参阅集成指南：

- [Node.js 集成](docs/sso-integration-nodejs.md)
- [Go 集成](docs/sso-integration-go.md)
- [Java 集成](docs/sso-integration-java.md)
- [Rust 集成](docs/sso-integration-rust.md)

### 快速 SSO 集成

1. **检查会话** 从客户端应用：
   ```javascript
   const res = await fetch('https://mail.yourdomain.com/api/sso/session', {
     credentials: 'include'
   })
   const { authenticated, user } = await res.json()
   ```

2. **重定向到登录页** 如果未认证：
   ```javascript
   window.location.href = `https://mail.yourdomain.com/sso/login?redirect=${encodeURIComponent(currentUrl)}`
   ```

## DNS 配置

为确保邮件服务器正常工作，请配置以下 DNS 记录：

```
# MX 记录
yourdomain.com.    IN    MX    10    mail.yourdomain.com.

# A 记录 (指向服务器 IP)
mail.yourdomain.com.    IN    A    your.server.ip

# SPF 记录
yourdomain.com.    IN    TXT    "v=spf1 mx -all"

# DKIM 记录 (如已配置)
default._domainkey.yourdomain.com.    IN    TXT    "v=DKIM1; k=rsa; p=your-public-key"

# DMARC 记录
_dmarc.yourdomain.com.    IN    TXT    "v=DMARC1; p=quarantine; rua=mailto:postmaster@yourdomain.com"
```
