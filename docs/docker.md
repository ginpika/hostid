# Docker deployment

[Documentation](./README.md) · **English** · [简体中文](./zh-CN/docker.md)

[Quick start](#quick-start) · [Ports](#ports) · [Backups](#backup-and-restore) · [Upgrading](#upgrading) · [Maintainer notes](#maintainers)

<a id="quick-start"></a>
<a id="single-container"></a>
<a id="全量单镜像-hostid-full"></a>

## Start with one container

Use **Docker Compose 2.24+**; the files use optional `env_file` entries. The recommended `ghcr.io/ginpika/hostid-full` image serves the frontend, API, SSO/OAuth routes and SMTP from one Node.js service. Images support `linux/amd64` and `linux/arm64`.

Run in a new deployment directory:

~~~sh
mkdir hostid
cd hostid
curl -fsSL https://raw.githubusercontent.com/ginpika/hostid/refs/heads/main/docs/docker-compose.full.yaml -o docker-compose.full.yaml
docker compose -f docker-compose.full.yaml up -d --wait
docker compose -f docker-compose.full.yaml ps
~~~

Open [http://localhost:3000](http://localhost:3000), replacing `localhost` with your server address if needed. The `/setup` wizard asks for the public site URL, mail domain and first administrator; the password must contain at least 12 characters. There is no default administrator password.

For public access, put HTTP behind an HTTPS reverse proxy. Point the mail domain's MX record at a hostname with an A/AAAA record for your server, and allow inbound TCP 25. An HTTP proxy does not forward SMTP. Incoming recipients must already exist as HostID users. External sending can use an SMTP relay; configure SPF, DKIM and DMARC for the actual sending service. The receiver currently lacks STARTTLS and the app does not sign DKIM.

<a id="configuration"></a>

## Configure the running instance

Use **Settings → System Settings** for the site URL, mail domain, SMTP relay, Turnstile and SSO cookies. Values live in the database; most changes apply immediately. Updating the SMTP greeting after changing the mail domain requires a restart. Manage external OAuth providers and client apps in their respective admin pages.

No environment file is required. Optional infrastructure and key overrides are described in [`backend/.env.example`](../backend/.env.example):

| Deployment | Optional application environment file |
| --- | --- |
| Published single image | `hostid.env` beside the Compose file |
| Published separate images | `backend.env` beside the Compose file |
| Either source build | `backend/.env` in the checkout |

Compose explicitly sets its internal ports, database URL and production mode, overriding conflicting application environment entries. Host port and image selection belong in the Compose `.env`, described below.

The browser receives only the public Turnstile site key through `/config.js`. No frontend environment file, build secret or rebuild is needed. Use the public site URL consistently for OAuth callbacks. In separate-container deployments, forward `/.well-known/oauth-authorization-server` to the backend if clients use authorization-server discovery.

Check `docker compose -f docker-compose.full.yaml logs --tail=100 hostid-full` when startup fails. Startup applies Prisma migrations automatically. The full image's health check requests `/health` and `/login`; it does not test external mail delivery.

<a id="ports"></a>

## Ports and image selection

Set these in the deployment directory's `.env` or shell, then recreate containers with `up -d --wait`:

| Variable | Default | Purpose |
| --- | --- | --- |
| `FRONTEND_PORT` | `3000` | Published HTTP port, both layouts |
| `SMTP_PORT` | `25` | Published incoming SMTP port |
| `BACKEND_PORT` | `3001` | Published API port, separate containers only |
| `BACKEND_BIND_ADDRESS` | `127.0.0.1` | API bind address, separate containers only |
| `IMAGE_TAG` | `latest` | Published image tag |

Internally, single-image HTTP uses `3000`; separate-container API uses `3001`. SMTP always uses `2525`. For a plain `docker run`, publish `-p 25:2525`. Internet mail senders still expect TCP 25 on the receiving server. The old Compose `PORT` variable no longer selects host ports. Keep API access local unless remote access is intended.

<a id="separate-containers"></a>

## Separate containers or a source build

For **published separate images**, run this in an empty deployment directory:

~~~sh
curl -fsSL https://raw.githubusercontent.com/ginpika/hostid/refs/heads/main/docs/docker-compose.yaml -o docker-compose.yaml
docker compose up -d --wait
docker compose ps
~~~

This starts `hostid-frontend` and `hostid-backend`. Nginx proxies API and runtime configuration requests over the Compose network; the frontend waits for backend health before starting. Use `docker compose logs --tail=100 backend` for backend diagnostics.

For a **source build**, choose one layout from the repository root:

~~~sh
# Single container
docker compose -f docker-compose.full.yaml up -d --build --wait
~~~

~~~sh
# Separate frontend and backend
docker compose up -d --build --wait
~~~

The [published single-image Compose](./docker-compose.full.yaml) and [published separate-image Compose](./docker-compose.yaml) pull GHCR images. The repository-root [single-image](../docker-compose.full.yaml) and [separate-image](../docker-compose.yaml) files build local source; `IMAGE_TAG` does not select a source revision.

<a id="backup-and-restore"></a>

## Back up and restore

`backend_data` holds SQLite and automatically generated `/app/data/secrets.json` (mode `0600`). **Restore the database and its keys together.** Losing a required key prevents encrypted settings and OAuth secrets from being decrypted. Preserve explicitly supplied `JWT_SECRET` / `DATA_ENCRYPTION_KEY` too: environment values take precedence and may differ from those already stored in `secrets.json`. New explicit keys should contain at least 32 characters.

1. Record the running image tag/digest (and checkout revision for source builds) and Compose project name. Stop the instance with `docker compose -f docker-compose.full.yaml stop`, or `docker compose stop` for separate containers.
2. With services stopped, archive all four project volumes, preserving ownership and permissions: `backend_data`, `backend_uploads` (attachments), `backend_avatars` and `backend_logs`. Their Docker names normally include the project prefix. Also copy the Compose file, Compose `.env`, optional application environment file and any separately supplied keys.
3. Restart the existing instance with the same `up -d --wait` command.

For recovery, restore deployment files and secrets first, retaining the original project name (including `-p` or `COMPOSE_PROJECT_NAME`). Use the recorded image version; for source builds, restore the recorded checkout revision and run `docker compose -f docker-compose.full.yaml build` first. Run `docker compose -f docker-compose.full.yaml create` to create stopped containers and volumes, restore the archives into those volumes, then run `up -d --wait`. For separate containers, omit `-f docker-compose.full.yaml`. Restore into an empty recovery deployment; do not overwrite a running instance.

The application uses UID/GID `1001` for backend files. Preserve their ownership and `secrets.json` permissions. SSO sessions are held in memory, so users sign in again after a server restart.

<a id="upgrading"></a>

## Upgrade and pin versions

Back up first, then run from the original deployment directory:

~~~sh
docker compose -f docker-compose.full.yaml pull
docker compose -f docker-compose.full.yaml up -d --wait
~~~

For published separate images, omit `-f docker-compose.full.yaml`. For source builds, update the checkout to the desired revision and use `up -d --build --wait`. Keep the same project and volume names. **Do not use `down -v` to upgrade: it removes the data volumes.** Cross-version rollback requires checking migration compatibility; a backup is the recovery point.

To select a published revision, put `IMAGE_TAG=sha-<full-commit-sha>` in the Compose `.env`, using a successful publication's commit SHA. This selects the matching release across images. For immutable deployment, use the published `image@sha256:...` references in Compose.

`latest` and the default-branch tag follow the default branch. `v*` tags publish version tags; valid semantic versions also publish version and major/minor aliases. Tagging an older release does not move `latest`. Avoid candidate `build-...` tags: publication has not completed for those tags.

<a id="legacy-configuration"></a>

### Upgrading an older configuration

- Existing users keep their accounts and skip `/setup`. If an old `logs/admin-credentials.log` exists, change that administrator password and delete the plaintext file.
- Previously configured site, mail, SMTP, Turnstile and SSO environment values initialize missing database settings on startup. Thereafter, edit them in System Settings and remove obsolete environment entries.
- On first migration, an environment JWT key is preserved for compatible decryption; a weak legacy JWT key is retained only to decrypt old data, while a strong signing key is generated and old sessions require login. A data encryption key is generated if absent. Keep explicit key overrides backed up, including any changed after initial migration.
- Legacy `GITHUB_CLIENT_ID` and related OAuth variables are no longer read. Manage providers in the OAuth configuration page; configurations already migrated to the database remain there.
- Separate deployments no longer use `frontend.env`. Its Turnstile site key is not imported automatically: enter it in System Settings, or put it in the backend environment before the first migration.

<a id="switching-layouts"></a>

## Switch container layouts

Use the matching published or source Compose files above in the **same deployment directory and project**. Back up first. Preserve all four volume names and prepare the target layout's optional environment file; move explicit key overrides with it. Only one backend may use the data at a time.

To switch separate containers to a published single image:

~~~sh
docker compose stop frontend backend
docker compose -f docker-compose.full.yaml pull
docker compose -f docker-compose.full.yaml up -d --wait
~~~

For a source build, replace `pull` and the final command with `docker compose -f docker-compose.full.yaml up -d --build --wait`. Preserve any custom `-p` / `COMPOSE_PROJECT_NAME` throughout. At the same application version, reverse the switch by stopping `hostid-full` and starting the original separate-container Compose. Across versions, check database migration compatibility before switching back.

<a id="admin-password"></a>

## Reset an administrator password

Replace `your_username` with an existing administrator username:

~~~sh
docker compose -f docker-compose.full.yaml exec hostid-full node reset-admin.cjs your_username
~~~

For separate containers: `docker compose exec backend node reset-admin.cjs your_username`. The generated password appears once in the terminal and is not written to a log. Use service names rather than assuming fixed container names.

<a id="maintainers"></a>

## Build and publication notes

- Build contexts: frontend uses the repository root and `.dockerignore`; backend uses `backend/` and `backend/.dockerignore`; the full image uses `Dockerfile.full` and `Dockerfile.full.dockerignore`. Dependencies, environment files, databases and uploaded data are excluded by the applicable rules.
- Dependencies install from lockfiles, including platform-specific frontend packages. Backend builds generate Prisma and check types before pruning development dependencies; runtime retains pinned Prisma and `tsx` to run TypeScript source.
- All images run as non-root users. Entrypoints use LF and strip CRLF during builds. Base images use multi-architecture digest pins; Actions use commit pins. Dependabot checks base images and Actions weekly.
- The full image needs no Nginx: HTML uses `no-cache`, hashed assets use long-lived immutable caching and `/config.js` uses `no-store`. Put TLS and HTTP compression at the deployment's reverse proxy. Separate frontend health checks also verify the API proxy.

The [Docker workflow](../.github/workflows/docker-build.yml) first checks workflows, shell scripts, Compose, types and tests. It builds all three images for AMD64 and ARM64, then tests migrations, HTTP/API/SMTP, proxying, SPA routes, runtime configuration and restart persistence. Full-image checks also cover caching and missing-resource/API responses. PRs stop here without registry login or publication.

Other workflow events push run-specific candidates. After both architectures pass, a serialized publication job assembles a shared `sha-<commit>` revision for all three images, then updates release aliases. Stale branch builds cannot move the branch tag or `latest`. Alias updates are not atomic across images; pin the shared commit tag from a successful publication. Candidate retention can be managed separately.

Run the same container checks locally with a POSIX shell and Docker:

~~~sh
docker build --platform linux/amd64 -f frontend/Dockerfile -t hostid-frontend:smoke .
docker build --platform linux/amd64 -f backend/Dockerfile -t hostid-backend:smoke backend
sh scripts/smoke-containers.sh hostid-frontend:smoke hostid-backend:smoke linux/amd64
docker build --platform linux/amd64 -f Dockerfile.full -t hostid-full:smoke .
sh scripts/smoke-full.sh hostid-full:smoke linux/amd64
~~~

For ARM64, replace `linux/amd64` throughout with `linux/arm64`. Checks create and remove isolated `hostid-smoke-` containers and networks; they do not read deployment configuration, mount existing volumes or publish host ports.
