# Docker 构建与发布

## 从源码部署

在仓库根目录准备配置，再启动 Compose：

```sh
cp frontend/.env.example frontend/.env
cp backend/.env.example backend/.env
# 编辑配置，尤其是 JWT_SECRET 和 MAIL_DOMAIN。
docker compose up -d --build --wait
```

需要 Docker Compose v2.20 或更新版本。前端通过服务网络访问后端；后端健康检查通过后，前端才启动。数据库、附件、日志和头像继续保存在原有的四个命名卷中。升级时不要执行 `docker compose down -v`。

## 使用预构建镜像

下载本目录的 `docker-compose.yaml`，在同目录放置 `frontend.env` 和 `backend.env`。Turnstile 的 `CF_TURNSTILE_SITE_KEY` 在 `frontend.env` 中配置，只在容器启动时注入，不需要 GitHub Secret 或重新构建镜像。更改环境文件后执行 `docker compose up -d` 重建容器；仅执行 `restart` 不会读取新的环境文件。

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

这些变量来自 shell 或 Compose 同目录的 `.env`，与 `env_file` 中的应用配置不同。容器内部的 API 端口固定为 `3001`，SMTP 固定为 `2525`，Compose 会覆盖应用环境文件中的 `PORT` 和 `SMTP_PORT`。外部邮件服务器仍连接宿主机的 25 端口，容器无需 root 或绑定低端口的权限。自行执行 `docker run` 时应使用 `-p 25:2525`。

已有部署升级后保留卷名和项目名。若以前依赖固定容器名执行管理命令，改用 `docker compose exec backend node reset-admin.cjs` 等服务命令。

## 构建约束

- 前端构建上下文为仓库根目录，使用根目录 `.dockerignore`；后端使用 `backend/.dockerignore`。本地依赖、环境文件、数据库和上传目录均不进入对应构建上下文。
- 两个镜像均使用已验证的多架构基础镜像摘要；GitHub Actions 固定提交 SHA。Dependabot 每周检查基础镜像和 Actions 更新，需要通过 CI 后再合入。
- 前后端依赖都由锁文件安装。前端锁文件包含 Rollup/esbuild 的平台可选包，镜像内不再临时安装原生依赖。
- 后端构建阶段生成 Prisma 客户端并执行类型检查，然后移除开发依赖。运行阶段保留锁定版本的 Prisma 和 `tsx`，继续运行现有 TypeScript 源码。
- 两个容器均以非 root 用户运行。入口脚本使用 LF，镜像构建时也会清理 CRLF。运行时健康检查访问 `/health`；前端的检查同时验证后端代理可用。

## CI 发布顺序

1. 安装锁定依赖，检查前后端类型。
2. 分别构建 AMD64、ARM64 的前后端镜像。每种架构均启动独立的临时容器，检查迁移、API、SMTP、反向代理、SPA、Turnstile 配置和重启后的数据库状态。
3. PR 到此结束，不登录镜像仓库、不推送镜像。其他事件只推送带运行编号的候选标签。
4. 两种架构全部通过后，单独的发布任务合并多架构镜像，先生成前后端共同的 `sha-<commit>` 标签，再更新发布别名。发布任务串行执行，并拒绝用落后的分支构建更新分支标签和 `latest`。

镜像仓库对两个镜像的标签写入不支持跨镜像事务，网络失败仍可能中断别名更新。因此部署应使用成功发布摘要中的共同提交标签，而不要依赖同时拉取两个 `latest` 来保证版本一致。临时候选标签包含运行编号，不应作为部署入口，可按仓库保留策略定期清理。

本地复用同一套启动检查（需要 POSIX shell 和可访问的 Docker 引擎）：

```sh
docker build --platform linux/amd64 -f frontend/Dockerfile -t hostid-frontend:smoke .
docker build --platform linux/amd64 -f backend/Dockerfile -t hostid-backend:smoke backend
sh scripts/smoke-containers.sh hostid-frontend:smoke hostid-backend:smoke linux/amd64
```

ARM64 验证时将构建和检查命令中的平台改成 `linux/arm64`。检查只创建和删除带唯一 `hostid-smoke-` 前缀的临时容器与网络，不读取部署配置，不挂载现有数据卷，也不发布宿主机端口。

