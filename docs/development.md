# Local development

[Documentation](./README.md) · **English** · [简体中文](./zh-CN/development.md)

Use **Node.js 22+** and npm. SQLite runs locally through Prisma; Docker is only needed for container builds and smoke checks.

## Start the backend

From the repository root, open a terminal:

```sh
cd backend
npm ci
export DATABASE_URL="file:./dev.db"
npm run db:generate
npm run db:migrate
npm run dev
```

`db:migrate` runs Prisma's development migrations and may prompt for a name if you change the schema. The relative SQLite URL resolves from `backend/prisma`, so the example uses `backend/prisma/dev.db`. Use a development database, never an existing production volume. Container startup applies committed migrations with `prisma migrate deploy` instead.

The API listens on `3001` and inbound SMTP on `2525` by default. Generated secrets are stored next to the database unless `HOSTID_DATA_DIR` overrides that directory.

## Start the frontend

In a second terminal, from the repository root:

```sh
npm ci --workspace=frontend
npm run dev
```

Open **[http://localhost:3000](http://localhost:3000)** and complete `/setup` with a local site URL and a test mail domain, such as `example.test`. The Vite server forwards `/api` to `http://localhost:3001`.

Use the targeted frontend workspace install shown above. The root manifest contains legacy desktop workspace scripts, but this checkout does not include a desktop application.

<a id="local-configuration"></a>

## Local configuration

- Normal site, mail and SSO values are edited in [System Settings](./configuration.md).
- `backend/.env` is optional. [`backend/.env.example`](../backend/.env.example) documents infrastructure overrides, but leaves `DATABASE_URL` commented out. The exported value above selects the development database explicitly.
- The Vite API proxy target is currently fixed to backend port `3001`. Changing the backend listener also requires adjusting [`frontend/vite.config.ts`](../frontend/vite.config.ts).
- The Vite `/config.js` middleware reads `CF_TURNSTILE_SITE_KEY` from `frontend/.env`. If testing Turnstile, set the same public site key there and configure the backend secret through System Settings. Restart Vite after changing its environment file. Production containers get `/config.js` from the backend instead.
- Keep service URLs, CORS origins and cookie settings consistent with your local scheme and host. HTTPS-only cookies will not work on an ordinary HTTP test origin.

## Checks and builds

Run from the repository root after installing both sets of dependencies:

```sh
npm test
npm run typecheck
npm --prefix backend run typecheck
npm run build
npm --prefix backend run build
```

`npm test` covers the frontend and backend. The root `typecheck` and `build` scripts cover the frontend only, so the backend commands are separate. Use the `tsx` development command above for local execution; shipped containers also run TypeScript through `tsx`. The backend build checks compilation, but its extensionless ESM imports are not directly runnable with plain `node dist/index.js`.

For browser layout checks, start Vite and open `http://localhost:3000/tests/html-email.browser.html`. See [email rendering](./email-rendering.md) for the coverage and limits of those checks.

With Docker available, validate the shipped Compose definitions:

```sh
node scripts/check-compose.mjs
```

The [Docker guide](./docker.md#maintainers) describes image builds and isolated container smoke checks.

## Where changes belong

| Area | Source |
| --- | --- |
| Mailbox layouts, themes and shared dialogs | [Design system](./design-system.md) |
| Mail HTML, plain text and MIME parsing | [Email rendering](./email-rendering.md) |
| SMTP and external delivery | [Receiver](../backend/src/smtp/index.ts), [mailer](../backend/src/services/mailer.ts) |
| Instance settings and secrets | [Settings](../backend/src/services/settings.ts), [keys](../backend/src/config/secrets.ts) |
| OAuth and shared-session authentication | [OAuth guide](./oauth.md), [SSO guide](./sso.md) |
| Embedded appearance contract | [Host integration](./embedding.md) |

When changing documented behavior, update both language versions and check links from the [documentation index](./README.md).
