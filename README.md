![HostID Logo](logo.png)

[English](./README.md) [中文](./README-zh.md)

A lightweight, self-hosted mail server and SSO provider in one, designed as the minimalist identity foundation for someone who want a lite email with them own domain.

## Tech Stack

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
- **Email Summary**: AI-powered email summarization (optional)

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

## Deployment

### Prerequisites
- Docker and Docker Compose installed
- A domain name with DNS configured
- (Optional) Cloudflare Turnstile keys for bot protection

### Quick Start with Docker

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/hostid.git
   cd hostid
   ```

2. **Create environment file**
   ```bash
   cp .env.example .env
   ```

3. **Edit `.env` with your configuration**
   ```env
   # Required
   JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
   MAIL_DOMAIN=yourdomain.com
   
   # Optional - SMTP Relay
   SMTP_HOST=
   SMTP_OUT_PORT=25
   SMTP_USER=
   SMTP_PASS=
   
   # Optional - Cloudflare Turnstile
   CF_TURNSTILE_SECRET_KEY=
   CF_TURNSTILE_SITE_KEY=
   
   # SSO Configuration
   SSO_COOKIE_DOMAIN=.yourdomain.com
   SSO_COOKIE_SECURE=true
   ```

4. **Start the services**
   ```bash
   docker-compose up -d
   ```

5. **Access the application**
   - Web Interface: `http://yourdomain.com` (or `https://` if configured)
   - SMTP Port: 25 (for receiving emails)

### Manual Deployment

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

# Or build and start production
npm run build
npm start
```

#### Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Start development server
npm run dev

# Or build for production
npm run build
npm run preview
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | SQLite database path | `file:/app/data/prod.db` |
| `JWT_SECRET` | Secret key for JWT tokens | *required* |
| `MAIL_DOMAIN` | Your mail domain | *required* |
| `PORT` | Web interface port | `80` |
| `SMTP_PORT` | SMTP server port | `25` |
| `SMTP_HOST` | External SMTP relay host | - |
| `SMTP_OUT_PORT` | External SMTP port | `25` |
| `SMTP_USER` | SMTP authentication user | - |
| `SMTP_PASS` | SMTP authentication password | - |
| `CF_TURNSTILE_SECRET_KEY` | Cloudflare Turnstile secret | - |
| `CF_TURNSTILE_SITE_KEY` | Cloudflare Turnstile site key | - |
| `SSO_COOKIE_DOMAIN` | Cookie domain for SSO | - |
| `SSO_COOKIE_SECURE` | Use secure cookies | `false` |
| `SESSION_TTL` | Session lifetime in seconds | `604800` |

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
