# HostID documentation

[Project overview](../README.md) · **English** · [简体中文](./zh-CN/README.md)

Start with the task you want to finish. Every guide has a matching language link at the top; English pages live in this directory, and Simplified Chinese pages in `zh-CN/`.

## Get an instance online

1. [Deploy with Docker](./docker.md#quick-start), open the site and create the first administrator.
2. [Configure the instance](./configuration.md) through the admin interface.
3. [Connect your mail domain](./mail.md): create recipient accounts, set DNS and configure outbound delivery.
4. [Back up the instance](./docker.md#backup-and-restore) before upgrading or moving it.

<a id="deployment"></a>

## Run and maintain

| Guide | What it covers |
| --- | --- |
| [Docker deployment](./docker.md) | All-in-one or separate containers, ports, HTTPS, health checks, updates, backups, recovery and image publishing |
| [Instance configuration](./configuration.md) | First run, current admin pages, settings storage, optional environment overrides and legacy configuration |
| [Mail and DNS](./mail.md) | Inbound SMTP, recipient accounts, MX records, relays, sender authentication, diagnostics and protocol limits |

<a id="authentication"></a>

## Connect an application

Choose the connection before choosing a language example:

| Goal | Start here |
| --- | --- |
| Let an app use HostID as an OAuth provider | [OAuth 2.0 integration](./oauth.md) — client registration, authorization code + PKCE, tokens and userinfo |
| Share a browser session among trusted apps under the same parent domain | [Shared-session SSO](./sso.md) — cookies, CORS, session validation and logout |
| Sign in to HostID through an external provider | [Third-party login](./oauth.md#third-party-login) — configure a sign-in provider in HostID |

The following are **server-side shared-session SSO examples**, not OAuth client SDKs:

[Node.js](./sso-integration-nodejs.md) · [Go](./sso-integration-go.md) · [Java](./sso-integration-java.md) · [Rust](./sso-integration-rust.md)

Browser redirects guide the user through login. Your app's backend must still validate authentication before returning protected data. Each HostID instance manages its own accounts; see the guides for session and process-restart behavior.

<a id="development"></a>

## Work on HostID

| Guide | What it covers |
| --- | --- |
| [Local development](./development.md) | Dependencies, development database, frontend/API startup, checks and builds |
| [Design system](./design-system.md) | Current theme and layout model, source files, shared components and interface conventions |
| [Email rendering](./email-rendering.md) | HTML isolation, MIME handling, compatibility boundaries and browser checks |
| [Embedded appearance](./embedding.md) | Public appearance snapshot and same-window event contract |
| [Brand assets](../design/brand/README.md) | Canonical logo files and preserved alternate artwork |

## How to read examples

- Replace `example.com`, example application names and placeholder credentials with your own values.
- Container commands specify their Compose layout. Run them from that deployment's directory and keep its project name when recovering data.
- Site, mail, Turnstile and SSO settings belong in the admin interface. Environment files remain available for infrastructure overrides; old environment-only guides have been updated.
- English and Chinese pages describe the same implementation. Existing guide filenames are kept so earlier links continue to reach the relevant topic.
