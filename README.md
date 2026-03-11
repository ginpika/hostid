![Hostid](poster.png)

[English](./README.md) [中文](./README-zh.md)

A lightweight, self-hosted mail server and sso provider in one, designed as the minimalist identity foundation for someone who want a lite email with them own domain.

Live Demo: https://mail.ginpika.cc (Username: `test`, Password: `VFObHC#e5nZ7Fxi&`)

The demo server has outgoing mail disabled, only supports internal mail between users, for demonstration purposes only.

## Deployed with docker-compose

```shell
mkdir ./hostid
cd hostid
wget -O https://raw.githubusercontent.com/ginpika/hostid/refs/heads/main/docs/docker-compose.yaml
touch frontend.env
wget -O backend.env https://raw.githubusercontent.com/ginpika/hostid/refs/heads/main/backend/.env.example
# please modify backend.env & frontend.env
docker-compose up -d
```

## Built with

### Backend
- **Runtime**: Node.js + TypeScript
- **Framework**: Express.js
- **Database**: SQLite (via Prisma ORM)
- **Authentication**: JWT + bcryptjs
- **Mail**: 
  - SMTP Server (smtp-server)
  - Mail Parser (mailparser)
  - Mail Sender (nodemailer)

### Frontend
- **Framework**: React 18 + TypeScript
- **Build Tool**: Vite
- **Styling**: Tailwind CSS
- **Rich Text Editor**: TipTap
- **Routing**: React Router DOM
- **Animation**: Framer Motion

### Desktop App
- **Framework**: Tauri (Rust)

### Deployment
- **Containerization**: Docker + Docker Compose
- **Web Server**: Nginx (for frontend)

## Features

### Mail Server
- **SMTP Server**: Built-in SMTP server for receiving emails on port 25
- **Mail Sending**: Support direct delivery via MX records or relay through external SMTP
- **Mailbox Management**: Inbox, Archive, Starred emails
- **Rich Text Compose**: TipTap-based rich text editor with math support (KaTeX)
- **Attachments**: Full attachment support for sending and receiving
- **Email Summary**: AI-powered email summarization (not integrated yet, I really don`t know how to design it better)

### SSO Provider
- **Single Sign-On**: Act as an identity provider for multiple applications
- **Cross-domain Auth**: Share authentication across subdomains
- **Session Management**: Secure session handling with configurable TTL
- **Easy Integration**: Simple API for integrating with any web application

### User Management
- **User Registration**: With Cloudflare Turnstile bot protection
- **User Profiles**: Nickname, phone, birthday, avatar, language preferences
- **Role System**: Admin and regular user roles
- **Admin Panel**: User management and SSO app configuration

### UI/UX
- **Multi-language**: Internationalization support (i18n)
- **Theme Support**: Multiple theme options
- **Responsive Design**: Works on desktop and mobile
- **Desktop App**: Native desktop application via Tauri

## Develop & Compile 

### Prerequisites
- Node.js 20+
- Docker and Docker Compose installed
- Check the .env of backend and frontend

#### Backend Setup

```bash
cd backend

# Install dependencies
npm install

# Generate Prisma client
npm run db:generate

# Run database migrations
npm run db:migrate

# Start development server
npm run dev
```

#### Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Start development server
npm run dev
```

## SSO Integration

HostID can serve as an SSO provider for your other applications. See the integration guides:

- [Node.js Integration](docs/sso-integration-nodejs.md)
- [Go Integration](docs/sso-integration-go.md)
- [Java Integration](docs/sso-integration-java.md)
- [Rust Integration](docs/sso-integration-rust.md)

### Quick SSO Integration

1. **Check session** from your client app:
   ```javascript
   const res = await fetch('https://mail.yourdomain.com/api/sso/session', {
     credentials: 'include'
   })
   const { authenticated, user } = await res.json()
   ```

2. **Redirect to login** if not authenticated:
   ```javascript
   window.location.href = `https://mail.yourdomain.com/sso/login?redirect=${encodeURIComponent(currentUrl)}`
   ```

## DNS Configuration

For your mail server to work properly, configure these DNS records:

```
# MX Record
yourdomain.com.    IN    MX    10    mail.yourdomain.com.

# A Record (pointing to your server IP)
mail.yourdomain.com.    IN    A    your.server.ip

# SPF Record
yourdomain.com.    IN    TXT    "v=spf1 mx -all"

# DKIM Record (if configured)
default._domainkey.yourdomain.com.    IN    TXT    "v=DKIM1; k=rsa; p=your-public-key"

# DMARC Record
_dmarc.yourdomain.com.    IN    TXT    "v=DMARC1; p=quarantine; rua=mailto:postmaster@yourdomain.com"
```
