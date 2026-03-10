# SelfHostMail

[English](#english) | [中文](#中文)

A modern self-hosted email solution for personal and small teams, featuring a beautiful web interface and optional desktop client.

一套现代化的自托管邮件解决方案，适用于个人和小型团队，提供精美的 Web 界面和可选的桌面客户端。

---

<a name="english"></a>

## English

### Features

- 📧 **Full Email Functionality** - Send and receive emails within your domain
- ✉️ **Rich Text Editor** - Compose emails with formatting, supports source code mode
- 📎 **Attachments** - File attachments support with efficient storage
- ⭐ **Email Management** - Star, archive, and organize emails with folders
- 🗂️ **Folders** - Inbox, Sent, Archived, Trash with batch operations
- � **Multiple Themes** - 7 beautiful themes including dark mode
- �🌐 **Multi-language** - Chinese and English support
- 👤 **User Profiles** - Customizable user information and preferences
- 🔐 **Admin Panel** - User management and database administration
- 🤖 **AI Summary** - Automatic email summarization (optional)
- 💻 **Desktop Client** - Cross-platform desktop app with Tauri

### Tech Stack

| Layer | Technologies |
|-------|-------------|
| **Frontend** | React 18, TypeScript, Tailwind CSS, Framer Motion, TipTap |
| **Backend** | Node.js, Express, Prisma, SQLite |
| **Email** | Nodemailer, SMTP Server |
| **Desktop** | Tauri 2.0, Rust |

### Project Structure

```
selfhostmail/
├── frontend/          # React web application
│   ├── src/
│   │   ├── components/   # Reusable UI components
│   │   ├── pages/        # Page components
│   │   ├── contexts/     # React contexts (Auth, Theme, i18n, etc.)
│   │   ├── themes/       # Theme definitions
│   │   └── i18n/         # Translations
│   └── ...
├── backend/           # Node.js API server
│   ├── src/
│   │   ├── routes/       # API endpoints
│   │   ├── middleware/   # Auth, error handling
│   │   ├── services/     # Mailer, AI services
│   │   └── smtp/         # SMTP server
│   └── prisma/           # Database schema
├── desktop/           # Tauri desktop client
│   └── src-tauri/        # Rust backend
└── docker-compose.yaml   # Docker deployment
```

### Quick Start

#### Development

```bash
# Clone the repository
git clone https://github.com/yourusername/selfhostmail.git
cd selfhostmail

# Install dependencies
npm install
cd backend && npm install
cd ../frontend && npm install

# Configure environment
cp ../.env.example ../.env
# Edit .env with your settings

# Initialize database
cd backend && npx prisma migrate dev

# Start backend (terminal 1)
cd backend && npm run dev

# Start frontend (terminal 2)
cd frontend && npm run dev
```

#### Desktop Client

```bash
# Development
cd desktop
npm install
npm run tauri dev

# Build
npm run tauri build
```

### Configuration

#### Environment Variables

```env
# Database
DATABASE_URL="file:./dev.db"

# Security
JWT_SECRET="your-secret-key"

# Server
PORT=3001
MAIL_DOMAIN="yourdomain.com"

# SMTP Server (receiving emails)
SMTP_PORT=25

# SMTP Relay (sending emails - optional)
SMTP_HOST=smtp.example.com
SMTP_OUT_PORT=587
SMTP_USER=your@email.com
SMTP_PASS=your-password

# AI Summary (optional)
AI_API_KEY="your-api-key"
AI_API_URL="https://api.openai.com/v1"
AI_MODEL="gpt-4o-mini"
```

#### Application Config

Edit `frontend/src/config/app.config.json` to customize:

```json
{
  "name": "SelfHostMail",
  "displayName": {
    "zh-CN": "SelfHostMail",
    "en-US": "SelfHostMail"
  },
  "version": "1.0.0"
}
```

### Docker Deployment

```bash
# Copy and edit environment
cp .env.example .env

# Build and start
docker-compose up -d --build

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

**Ports:**
- `80` - Web interface
- `25` - SMTP server

### Themes

Available themes:
- Light (default)
- Dark - TRAE style with cyan accent
- Ocean Blue
- Rose Pink
- Forest Green
- Sunset Orange
- Lavender

---

<a name="中文"></a>

## 中文

### 功能特性

- 📧 **完整邮件功能** - 域名内邮件收发
- ✉️ **富文本编辑器** - 支持格式化编辑和源代码模式
- 📎 **附件支持** - 文件附件，高效存储
- ⭐ **邮件管理** - 星标、归档、文件夹管理
- 🗂️ **文件夹** - 收件箱、已发送、已归档、垃圾箱，支持批量操作
- 🎨 **多主题** - 7 种精美主题，包含深色模式
- 🌐 **多语言** - 中英文界面支持
- 👤 **用户资料** - 可自定义用户信息和偏好
- 🔐 **管理面板** - 用户管理和数据库管理
- 🤖 **AI 摘要** - 自动邮件摘要（可选）
- 💻 **桌面客户端** - 基于 Tauri 的跨平台桌面应用

### 技术栈

| 层级 | 技术 |
|------|------|
| **前端** | React 18, TypeScript, Tailwind CSS, Framer Motion, TipTap |
| **后端** | Node.js, Express, Prisma, SQLite |
| **邮件** | Nodemailer, SMTP 服务器 |
| **桌面** | Tauri 2.0, Rust |

### 项目结构

```
selfhostmail/
├── frontend/          # React Web 应用
│   ├── src/
│   │   ├── components/   # 可复用 UI 组件
│   │   ├── pages/        # 页面组件
│   │   ├── contexts/     # React 上下文（认证、主题、国际化等）
│   │   ├── themes/       # 主题定义
│   │   └── i18n/         # 翻译文件
│   └── ...
├── backend/           # Node.js API 服务器
│   ├── src/
│   │   ├── routes/       # API 端点
│   │   ├── middleware/   # 认证、错误处理
│   │   ├── services/     # 邮件、AI 服务
│   │   └── smtp/         # SMTP 服务器
│   └── prisma/           # 数据库模型
├── desktop/           # Tauri 桌面客户端
│   └── src-tauri/        # Rust 后端
└── docker-compose.yaml   # Docker 部署配置
```

### 快速开始

#### 开发环境

```bash
# 克隆仓库
git clone https://github.com/yourusername/selfhostmail.git
cd selfhostmail

# 安装依赖
npm install
cd backend && npm install
cd ../frontend && npm install

# 配置环境变量
cp ../.env.example ../.env
# 编辑 .env 填入你的配置

# 初始化数据库
cd backend && npx prisma migrate dev

# 启动后端（终端 1）
cd backend && npm run dev

# 启动前端（终端 2）
cd frontend && npm run dev
```

#### 桌面客户端

```bash
# 开发模式
cd desktop
npm install
npm run tauri dev

# 构建
npm run tauri build
```

### 配置

#### 环境变量

```env
# 数据库
DATABASE_URL="file:./dev.db"

# 安全
JWT_SECRET="你的密钥"

# 服务器
PORT=3001
MAIL_DOMAIN="yourdomain.com"

# SMTP 服务器（接收邮件）
SMTP_PORT=25

# SMTP 中继（发送邮件 - 可选）
SMTP_HOST=smtp.example.com
SMTP_OUT_PORT=587
SMTP_USER=your@email.com
SMTP_PASS=your-password

# AI 摘要（可选）
AI_API_KEY="your-api-key"
AI_API_URL="https://api.openai.com/v1"
AI_MODEL="gpt-4o-mini"
```

#### 应用配置

编辑 `frontend/src/config/app.config.json` 自定义：

```json
{
  "name": "SelfHostMail",
  "displayName": {
    "zh-CN": "SelfHostMail",
    "en-US": "SelfHostMail"
  },
  "version": "1.0.0"
}
```

### Docker 部署

```bash
# 复制并编辑环境变量
cp .env.example .env

# 构建并启动
docker-compose up -d --build

# 查看日志
docker-compose logs -f

# 停止服务
docker-compose down
```

**端口：**
- `80` - Web 界面
- `25` - SMTP 服务器

### 主题

可用主题：
- 浅色（默认）
- 深色 - TRAE 风格荧光青绿
- 海洋蓝
- 玫瑰粉
- 森林绿
- 日落橙
- 薰衣草

---

## SPF / DKIM / DMARC Configuration

To ensure email delivery, configure these DNS records:

### SPF Record

| Type | Name | Content |
|------|------|---------|
| TXT | `@` | `v=spf1 ip4:YOUR_SERVER_IP ~all` |

### DKIM Record

Generate keys and add:

| Type | Name | Content |
|------|------|---------|
| TXT | `mail._domainkey` | `v=DKIM1; k=rsa; p=YOUR_PUBLIC_KEY` |

### DMARC Record

| Type | Name | Content |
|------|------|---------|
| TXT | `_dmarc` | `v=DMARC1; p=quarantine; rua=mailto:dmarc@yourdomain.com` |

### MX & A Records

| Type | Name | Value |
|------|------|-------|
| MX | `@` | `mail.yourdomain.com` (priority: 10) |
| A | `mail` | `YOUR_SERVER_IP` |

---

## License

MIT License
