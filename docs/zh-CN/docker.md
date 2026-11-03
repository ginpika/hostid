# Docker 部署

[文档首页](./README.md) · [English](../docker.md) · **简体中文**

[快速开始](#quick-start) · [端口](#ports) · [备份](#backup-and-restore) · [升级](#upgrading) · [维护者说明](#maintainers)

<a id="quick-start"></a>
<a id="single-container"></a>
<a id="全量单镜像-hostid-full"></a>

## 从一个容器开始

需要 **Docker Compose 2.24+**，配置文件使用了可选的 `env_file`。推荐镜像 `ghcr.io/ginpika/hostid-full` 通过一个 Node.js 服务提供前端、API、SSO/OAuth 路由和 SMTP，支持 `linux/amd64`、`linux/arm64`。

在新的部署目录执行：

~~~sh
mkdir hostid
cd hostid
curl -fsSL https://raw.githubusercontent.com/ginpika/hostid/refs/heads/main/docs/docker-compose.full.yaml -o docker-compose.full.yaml
docker compose -f docker-compose.full.yaml up -d --wait
docker compose -f docker-compose.full.yaml ps
~~~

打开 [http://localhost:3000](http://localhost:3000)，远程部署时将 `localhost` 替换为服务器地址。`/setup` 向导会要求填写公网地址、邮件域名并创建第一个管理员，密码至少 12 位。系统没有默认管理员密码。

公开部署时，为 HTTP 配置 HTTPS 反向代理。邮件域名的 MX 应指向有服务器 A/AAAA 记录的主机，并开放入站 TCP 25；HTTP 反向代理不会转发 SMTP。收件地址必须对应已存在的 HostID 用户。对外发信可使用 SMTP 中继，并按实际发信服务配置 SPF、DKIM、DMARC。当前入站 SMTP 不支持 STARTTLS，应用没有内置 DKIM 签名。

<a id="configuration"></a>

## 配置运行中的实例

在「设置 → 系统设置」中配置站点地址、邮件域名、SMTP 中继、Turnstile 和 SSO Cookie。设置保存在数据库中，大多数修改保存后立即生效；邮件域名改变后，SMTP 欢迎横幅需重启才更新。第三方 OAuth 服务商和客户端应用在各自的管理页面配置。

无需预先创建环境文件。可选的基础设施与密钥覆盖项见 [`backend/.env.example`](../../backend/.env.example)：

| 部署方案 | 可选的应用环境文件 |
| --- | --- |
| 预构建单镜像 | Compose 同目录的 `hostid.env` |
| 预构建独立镜像 | Compose 同目录的 `backend.env` |
| 两种源码构建 | 源码目录中的 `backend/.env` |

Compose 显式设置容器内部端口、数据库地址和生产模式，会覆盖应用环境文件中的同名值。宿主机端口和镜像标签通过下文所述的 Compose `.env` 设置。

浏览器通过 `/config.js` 只获取公开的 Turnstile site key，无需前端环境文件、构建密钥或重新构建镜像。站点地址与 OAuth 回调应统一使用公网地址。前后端分离部署时，如客户端使用授权服务器发现，需要将 `/.well-known/oauth-authorization-server` 转发到后端。

启动失败时，查看 `docker compose -f docker-compose.full.yaml logs --tail=100 hostid-full`。入口脚本会自动运行 Prisma 数据库迁移。单镜像健康检查请求 `/health` 和 `/login`，不检查外部邮件投递。

<a id="ports"></a>

## 端口与镜像版本

在部署目录的 `.env` 或 shell 中设置，然后执行 `up -d --wait` 重建容器：

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `FRONTEND_PORT` | `3000` | 两种方案对外提供的 HTTP 端口 |
| `SMTP_PORT` | `25` | 入站 SMTP 宿主机端口 |
| `BACKEND_PORT` | `3001` | 仅独立容器方案的 API 宿主机端口 |
| `BACKEND_BIND_ADDRESS` | `127.0.0.1` | 仅独立容器方案的 API 绑定地址 |
| `IMAGE_TAG` | `latest` | 预构建镜像标签 |

单镜像内部 HTTP 使用 `3000`，独立后端 API 使用 `3001`，SMTP 均使用 `2525`。自行执行 `docker run` 时应映射 `-p 25:2525`。互联网邮件服务器仍连接接收端的 TCP 25。旧的 Compose `PORT` 不再决定宿主机端口；不需要远程直连时，保持 API 仅绑定本机。

<a id="separate-containers"></a>

## 独立容器或源码构建

使用**预构建独立镜像**时，在空的部署目录执行：

~~~sh
curl -fsSL https://raw.githubusercontent.com/ginpika/hostid/refs/heads/main/docs/docker-compose.yaml -o docker-compose.yaml
docker compose up -d --wait
docker compose ps
~~~

这会启动 `hostid-frontend` 和 `hostid-backend`。Nginx 通过 Compose 网络代理 API 和运行时配置，后端健康检查通过后前端才启动。后端诊断命令为 `docker compose logs --tail=100 backend`。

**从源码构建**时，在仓库根目录选择一种方案：

~~~sh
# 单容器
docker compose -f docker-compose.full.yaml up -d --build --wait
~~~

~~~sh
# 前后端独立容器
docker compose up -d --build --wait
~~~

[预构建单镜像 Compose](../docker-compose.full.yaml) 和 [预构建独立镜像 Compose](../docker-compose.yaml) 从 GHCR 拉取镜像。仓库根目录的 [单镜像](../../docker-compose.full.yaml) 与 [独立镜像](../../docker-compose.yaml) 配置构建本地源码；`IMAGE_TAG` 不会选择源码版本。

<a id="backup-and-restore"></a>

## 备份与恢复

`backend_data` 保存 SQLite 数据库和自动生成的 `/app/data/secrets.json`（权限 `0600`）。**数据库与对应密钥必须一起恢复。** 必需密钥丢失后，加密设置和 OAuth 密钥将无法解密。显式设置的 `JWT_SECRET` / `DATA_ENCRYPTION_KEY` 也必须保留：环境变量优先，其值可能与已有 `secrets.json` 不同。新设置的显式密钥应至少 32 字符。

1. 记录正在运行的镜像标签或摘要、源码构建所用的提交版本，以及 Compose 项目名。执行 `docker compose -f docker-compose.full.yaml stop` 停止实例；独立容器方案使用 `docker compose stop`。
2. 在服务停止期间，归档四个项目数据卷并保留所有者和权限：`backend_data`、`backend_uploads`（附件）、`backend_avatars`、`backend_logs`。Docker 卷名通常包含项目名前缀。同时复制 Compose 文件、Compose `.env`、可选应用环境文件和单独提供的密钥。
3. 使用原来的 `up -d --wait` 命令重新启动实例。

恢复时先还原部署文件和密钥，保留原项目名，包括 `-p` 或 `COMPOSE_PROJECT_NAME` 设置，并使用记录下来的镜像版本；源码构建则恢复对应提交，再先执行 `docker compose -f docker-compose.full.yaml build`。执行 `docker compose -f docker-compose.full.yaml create` 创建未运行的容器和数据卷，将归档恢复到这些卷中，再执行 `up -d --wait`。独立容器方案省略 `-f docker-compose.full.yaml`。应恢复到空的恢复环境，不要覆盖正在运行的实例。

后端文件使用 UID/GID `1001`；保留其所有者以及 `secrets.json` 权限。SSO 会话保存在内存中，服务器重启后用户需要重新登录。

<a id="upgrading"></a>

## 升级与固定版本

先备份，再在原部署目录执行：

~~~sh
docker compose -f docker-compose.full.yaml pull
docker compose -f docker-compose.full.yaml up -d --wait
~~~

预构建独立镜像省略 `-f docker-compose.full.yaml`。源码构建先将源码更新到目标版本，再使用 `up -d --build --wait`。保持项目名和卷名不变。**不要用 `down -v` 升级，它会删除数据卷。** 跨版本回退需要确认数据库迁移兼容性；备份是恢复依据。

在 Compose `.env` 中设置 `IMAGE_TAG=sha-<完整提交 SHA>`，使用成功发布的提交 SHA，即可为各镜像选择对应版本。需要严格不可变的部署时，在 Compose 中使用发布的 `image@sha256:...` 摘要。

`latest` 和默认分支标签跟随默认分支；`v*` 标签发布版本标签，合法语义版本还发布版本号与主次版本别名。给旧版本打标签不会移动 `latest`。不要部署 `build-...` 候选标签，其完整发布尚未完成。

<a id="legacy-configuration"></a>

### 旧配置迁移

- 已有用户保留原账号，不会进入 `/setup`。若存在旧的 `logs/admin-credentials.log`，先修改对应管理员密码，再删除这个明文文件。
- 旧环境变量中的站点、邮件、SMTP、Turnstile、SSO 参数，会在启动时初始化数据库中缺失的设置；此后在「系统设置」中修改，并可删除过时的环境项。
- 首次迁移时会保留环境中的 JWT 密钥以兼容旧密文；过短的旧 JWT 密钥仅保留作旧数据解密，同时生成强签名密钥，旧会话需要重新登录。缺少数据加密密钥时自动生成。显式密钥覆盖项及迁移后修改过的密钥都应备份。
- 旧 `GITHUB_CLIENT_ID` 等 OAuth 环境变量不再读取。请在 OAuth 配置页管理服务商，已迁移到数据库的配置会保留。
- 独立部署不再使用 `frontend.env`，其中的 Turnstile site key 不会自动导入。请在系统设置中填写，或在首次迁移前将其放入后端环境文件。

<a id="switching-layouts"></a>

## 切换容器方案

在**同一部署目录、同一项目**中使用上文对应的预构建或源码 Compose。先备份，保留四个数据卷名称，并准备目标方案的可选环境文件，将显式密钥覆盖项一起迁移。同一套数据只能由一套后端运行。

从独立容器切换到预构建单镜像：

~~~sh
docker compose stop frontend backend
docker compose -f docker-compose.full.yaml pull
docker compose -f docker-compose.full.yaml up -d --wait
~~~

源码构建时，用 `docker compose -f docker-compose.full.yaml up -d --build --wait` 替换 `pull` 和最后的启动命令。全过程保留自定义 `-p` / `COMPOSE_PROJECT_NAME`。应用版本相同时，停止 `hostid-full` 后即可用原独立容器 Compose 切回；跨版本切回前先检查数据库迁移兼容性。

<a id="admin-password"></a>

## 重置管理员密码

将 `your_username` 替换为已有管理员用户名：

~~~sh
docker compose -f docker-compose.full.yaml exec hostid-full node reset-admin.cjs your_username
~~~

独立容器方案使用 `docker compose exec backend node reset-admin.cjs your_username`。新密码只在终端显示一次，不写入日志。使用服务名执行命令，不要依赖固定的容器名。

<a id="maintainers"></a>

## 构建与发布说明

- 构建上下文：前端使用仓库根目录和 `.dockerignore`，后端使用 `backend/` 和 `backend/.dockerignore`，单镜像使用 `Dockerfile.full` 与 `Dockerfile.full.dockerignore`。对应规则会排除本地依赖、环境文件、数据库和上传数据。
- 依赖通过锁文件安装，包含前端的平台专用包。后端构建生成 Prisma 客户端、检查类型后移除开发依赖；运行阶段保留锁定版本的 Prisma 与 `tsx`，执行 TypeScript 源码。
- 所有镜像以非 root 用户运行；入口脚本使用 LF，构建时清理 CRLF。基础镜像固定多架构摘要，Actions 固定提交。Dependabot 每周检查基础镜像与 Actions。
- 单镜像无需 Nginx：HTML 使用 `no-cache`，带哈希的资源使用长期不可变缓存，`/config.js` 使用 `no-store`。TLS 和 HTTP 压缩交由入口反向代理处理。独立前端健康检查还会验证 API 代理。

[Docker 工作流](../../.github/workflows/docker-build.yml) 先检查工作流、shell、Compose、类型和测试，再为 AMD64、ARM64 构建三种镜像，验证迁移、HTTP/API/SMTP、代理、SPA、运行时配置以及重启后的持久化。单镜像还检查缓存与缺失资源/API 的响应。PR 到此结束，不登录或推送镜像仓库。

其他工作流事件推送带运行编号的候选镜像。两种架构通过后，串行发布任务先为三个镜像生成共同的 `sha-<commit>`，再更新发布别名；落后分支的构建不能更新分支标签或 `latest`。跨镜像的别名更新不是原子操作，应固定成功发布的共同提交标签。候选镜像可单独配置保留策略。

本地使用 POSIX shell 和 Docker 运行同一套容器检查：

~~~sh
docker build --platform linux/amd64 -f frontend/Dockerfile -t hostid-frontend:smoke .
docker build --platform linux/amd64 -f backend/Dockerfile -t hostid-backend:smoke backend
sh scripts/smoke-containers.sh hostid-frontend:smoke hostid-backend:smoke linux/amd64
docker build --platform linux/amd64 -f Dockerfile.full -t hostid-full:smoke .
sh scripts/smoke-full.sh hostid-full:smoke linux/amd64
~~~

ARM64 检查将各处 `linux/amd64` 替换为 `linux/arm64`。检查仅创建并清理隔离的 `hostid-smoke-` 容器与网络，不读取部署配置、不挂载已有数据卷，也不发布宿主机端口。
