![Preview](./docs/preview2.png)

<details>
  <summary>Others preview</summary>
  <img src="./docs/preview3.png" alt="Preview3" width="600">
  <img src="./docs/preview1.png" alt="Preview4" width="600">
</details>

[English](./README-en.md)

一个轻量级的自托管邮件应用，提供极简的身份认证服务，基于 nodemailer + express.js。

## 我为什么写了 hostid

1. 我想要一个 UI/UX 更出色自托管的邮件服务器，市面上的邮件服务虽然免费，要么很卡，要么有广告
2. 我需要一个简单的 sso or oauth2 的认证服务来管理我自己写的各种 web 服务

Hostid 正是上述两个需求的实现。

## 部署

```shell
mkdir ./hostid
cd hostid
wget https://raw.githubusercontent.com/ginpika/hostid/refs/heads/main/docs/docker-compose.yaml
touch frontend.env
wget -O backend.env https://raw.githubusercontent.com/ginpika/hostid/refs/heads/main/backend/.env.example
# 请在正确配置 backend.env & frontend.env 后执行
docker-compose up -d
```

管理员账号 root 会自动初始化，并且密码写在日志里，请通过 docker-compose logs 查看，或查看 logs/admin-credentials.log

你也可以直接在容器内执行 reset-admin.cjs 来重置 root 账号的密码

## .env

详情请见 ./backend/.env.example & ./frontend/.env.example

## 开发

### 前置条件
- Node.js 20+
- Docker

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
```

#### 前端设置

```bash
cd frontend

# 安装依赖
npm install

# 启动开发服务器
npm run dev
```

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
