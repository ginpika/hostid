# Docker 构建与发布

## 从源码部署

无需任何配置，直接在仓库根目录启动 Compose：

```sh
docker compose up -d --build --wait
```

打开站点后按 `/setup` 向导创建第一个管理员，其余配置在「管理 → 系统设置」中修改（保存在数据库，立即生效）。`backend/.env` 是可选的，只用于覆盖数据库路径、端口或自定义密钥，参见 `backend/.env.example`。

`JWT_SECRET` / `DATA_ENCRYPTION_KEY` 首次启动时自动生成到数据卷中的 `/app/data/secrets.json`（0600）。**备份 `backend_data` 卷即同时备份了数据库和 secrets.json，两者必须一起备份和恢复。** 如通过环境变量显式提供密钥（至少 32 字符），环境变量优先。

需要 Docker Compose v2.24 或更新版本（`env_file` 的 `required: false`）。前端通过服务网络访问后端；后端健康检查通过后，前端才启动。数据库、附件、日志和头像继续保存在原有的四个命名卷中。升级时不要执行 `docker compose down -v`。

## 使用预构建镜像

下载本目录的 `docker-compose.yaml` 即可启动；同目录的 `backend.env` 是可选的覆盖文件。Turnstile 的 site key / secret key 在「系统设置 → 人机验证」中配置，前端 nginx 会把 `/config.js` 代理到后端，不需要 `frontend.env`、GitHub Secret 或重新构建镜像。

推荐在 Compose 同目录的 `.env` 文件中固定同一套镜像版本：

```dotenv
# 用成功发布的工作流摘要中的完整提交 SHA 替换占位符。
IMAGE_TAG=sha-<full-commit-sha>
FRONTEND_PORT=3000
BACKEND_PORT=3001
BACKEND_BIND_ADDRESS=127.0.0.1
SMTP_PORT=25
```

```sh
docker compose pull
docker compose up -d --wait
docker compose ps
```

未指定 `IMAGE_TAG` 时仍使用 `latest`。`latest` 和默认分支标签跟随默认分支；`v*` 标签发布版本标签，合法语义版本还会发布对应的版本号和主次版本标签，不会把旧版本重新标记成 `latest`。需要严格不可变的部署时，可在 Compose 中分别使用工作流发布的镜像摘要 `image@sha256:...`。

## 端口变更

| 配置 | 默认值 | 用途 |
| --- | --- | --- |
| `FRONTEND_PORT` | `3000` | 前端宿主机端口，替代旧的 Compose `PORT` |
| `BACKEND_PORT` | `3001` | 后端宿主机端口，替代旧的 Compose `PORT` |
| `BACKEND_BIND_ADDRESS` | `127.0.0.1` | 后端 HTTP 默认仅允许本机访问；需要远程直连时显式改成 `0.0.0.0` |
| `SMTP_PORT` | `25` | SMTP 宿主机端口 |

这些变量来自 shell 或 Compose 同目录的 `.env`，与 `env_file` 中的应用配置不同。容器内部的 API 端口固定为 `3001`，SMTP 固定为 `2525`，Compose 会覆盖应用环境文件中的 `PORT` 和 `SMTP_PORT`。端口属于基础设施配置，仍通过环境变量设置，修改后需重建容器。外部邮件服务器仍连接宿主机的 25 端口，容器无需 root 或绑定低端口的权限。自行执行 `docker run` 时应使用 `-p 25:2525`。

已有部署升级后保留卷名和项目名。若以前依赖固定容器名执行管理命令，改用 `docker compose exec backend node reset-admin.cjs <用户名>` 等服务命令。

### 从环境变量配置升级

- 已有用户的部署不会进入 `/setup`；原有 `root` 等账号保持不变。旧版本写入的 `logs/admin-credentials.log` 含明文密码，确认已更换密码后请删除该文件。
- 升级后首次启动时，环境变量中已设置的站点 / 邮件 / SMTP / Turnstile / SSO 配置会一次性导入数据库，此后以「系统设置」为准，可从环境文件中删除。
- 环境变量中的 `JWT_SECRET` 会被记录到 `secrets.json`，之后即使从环境中移除，旧会话和用旧密钥加密的数据仍可解密。若未设置 `DATA_ENCRYPTION_KEY`，会自动生成新的数据密钥；旧密文继续可读，新写入的数据使用新密钥。
- 旧的 `GITHUB_CLIENT_ID` 等 GitHub OAuth 环境变量已不再读取，请在「OAuth 配置」页面管理服务商（之前已自动迁移到数据库的配置不受影响）。
- 双容器部署不再需要 `frontend.env`；其中的 `CF_TURNSTILE_SITE_KEY` 不会被自动导入，请在「系统设置 → 人机验证」中重新填写（或升级前把它加到后端环境文件以便自动导入）。

## 全量单镜像 hostid-full

除了原有的 `hostid-frontend` / `hostid-backend`，还发布 `ghcr.io/ginpika/hostid-full`，支持 `linux/amd64` 和 `linux/arm64`，沿用 `latest`、分支、版本及 `sha-<完整提交 SHA>` 标签规则。三个镜像通过同一工作流验证和发布。

全量镜像由一个 Node.js 服务提供前端静态页面、API、SSO/OAuth 路由和 SMTP，无需容器内 Nginx。HTTP 内部端口为 `3000`，SMTP 为 `2525`；宿主机端口仍使用 `FRONTEND_PORT`（默认 `3000`）和 `SMTP_PORT`（默认 `25`），不再单独映射 `BACKEND_PORT`。页面入口使用 `no-cache`，带哈希的 `/assets/` 资源使用长期缓存，`/config.js` 使用 `no-store`。TLS 和 HTTP 压缩可由部署入口的反向代理处理。

从源码构建：

```sh
docker compose -f docker-compose.full.yaml up -d --build --wait
docker compose -f docker-compose.full.yaml logs hostid-full
```

使用预构建镜像，在一个新的部署目录执行：

```sh
wget https://raw.githubusercontent.com/ginpika/hostid/refs/heads/main/docs/docker-compose.full.yaml
# 可选：hostid.env 只用于覆盖（见 backend/.env.example），不需要创建。
# 可选：在同目录的 .env 设置 IMAGE_TAG=sha-<完整提交 SHA>。
docker compose -f docker-compose.full.yaml pull
docker compose -f docker-compose.full.yaml up -d --wait
```

Turnstile、站点地址等均在「系统设置」中配置；浏览器只通过 `/config.js` 接收公开 site key。站点地址和 OAuth 回调地址应指向对外访问的统一域名。

现有双容器部署切换时，在原部署目录保留原 Compose 项目名（包括原来的 `-p` 或 `COMPOSE_PROJECT_NAME` 设置），四个命名卷仍使用 `backend_data`、`backend_uploads`、`backend_logs`、`backend_avatars`。先备份数据，并准备单镜像对应的环境文件，再停止旧服务后启动全量版本：

```sh
docker compose stop frontend backend
docker compose -f docker-compose.full.yaml up -d --wait
```

源码部署启动全量版本时加上 `--build`；预构建部署先执行 `pull`。同一套数据应只由一套服务运行。不要使用 `down -v` 或删除原有卷。仅切换打包方式且应用版本相同时，可停止 `hostid-full` 后用原 Compose 启动双容器版本；跨版本回退还需核对数据库迁移兼容性。管理命令对应改为：

```sh
docker compose -f docker-compose.full.yaml exec hostid-full node reset-admin.cjs <用户名>
```

## 构建约束

- 前端构建上下文为仓库根目录，使用根目录 `.dockerignore`；后端使用 `backend/.dockerignore`。本地依赖、环境文件、数据库和上传目录均不进入对应构建上下文。
- 全量镜像使用根目录的 `Dockerfile.full` 和独立的 `Dockerfile.full.dockerignore`，允许复制前后端源码，同时排除环境文件和本地数据；原有两个 Dockerfile 和忽略规则继续保留。
- 三个镜像均使用固定的多架构基础镜像摘要；GitHub Actions 固定提交 SHA。Dependabot 每周检查基础镜像和 Actions 更新，需要通过 CI 后再合入。
- 前后端依赖都由锁文件安装。前端锁文件包含 Rollup/esbuild 的平台可选包，镜像内不再临时安装原生依赖。
- 后端构建阶段生成 Prisma 客户端并执行类型检查，然后移除开发依赖。运行阶段保留锁定版本的 Prisma 和 `tsx`，继续运行现有 TypeScript 源码。
- 三种镜像均以非 root 用户运行。入口脚本使用 LF，镜像构建时也会清理 CRLF。运行时健康检查访问 `/health`；前端的检查同时验证后端代理可用，全量镜像还检查前端页面。

## CI 发布顺序

1. 安装锁定依赖，检查前后端类型并运行测试，校验双容器与单容器的 Compose 配置。
2. 分别构建 AMD64、ARM64 的前后端镜像和全量镜像。每种架构均启动独立的临时容器，检查迁移、API、SMTP、反向代理、SPA、Turnstile 配置和重启后的数据库状态；全量镜像还检查静态资源缓存及 API / 资源的 404 行为。
3. PR 到此结束，不登录镜像仓库、不推送镜像。其他事件只推送带运行编号的候选标签。
4. 两种架构全部通过后，单独的发布任务合并多架构镜像，先生成三个镜像共同的 `sha-<commit>` 标签，再更新发布别名。发布任务串行执行，并拒绝用落后的分支构建更新分支标签和 `latest`。

镜像仓库对两个镜像的标签写入不支持跨镜像事务，网络失败仍可能中断别名更新。因此部署应使用成功发布摘要中的共同提交标签，而不要依赖同时拉取两个 `latest` 来保证版本一致。临时候选标签包含运行编号，不应作为部署入口，可按仓库保留策略定期清理。

本地复用同一套启动检查（需要 POSIX shell 和可访问的 Docker 引擎）：

```sh
docker build --platform linux/amd64 -f frontend/Dockerfile -t hostid-frontend:smoke .
docker build --platform linux/amd64 -f backend/Dockerfile -t hostid-backend:smoke backend
sh scripts/smoke-containers.sh hostid-frontend:smoke hostid-backend:smoke linux/amd64
docker build --platform linux/amd64 -f Dockerfile.full -t hostid-full:smoke .
sh scripts/smoke-full.sh hostid-full:smoke linux/amd64
```

ARM64 验证时将构建和检查命令中的平台改成 `linux/arm64`。检查只创建和删除带唯一 `hostid-smoke-` 前缀的临时容器与网络，不读取部署配置，不挂载现有数据卷，也不发布宿主机端口。

