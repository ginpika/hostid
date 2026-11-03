# 本地开发

[文档首页](./README.md) · [English](../development.md) · **简体中文**

使用 **Node.js 22+** 与 npm。Prisma 在本地使用 SQLite，仅构建容器和执行容器冒烟检查时需要 Docker。

## 启动后端

从仓库根目录打开一个终端：

```sh
cd backend
npm ci
export DATABASE_URL="file:./dev.db"
npm run db:generate
npm run db:migrate
npm run dev
```

`db:migrate` 执行 Prisma 开发迁移，修改 schema 后可能要求填写迁移名称。相对 SQLite 地址以 `backend/prisma` 为基准，示例对应 `backend/prisma/dev.db`。请使用开发数据库，不要指向已有生产数据卷。容器启动使用 `prisma migrate deploy` 应用已提交的迁移。

API 默认监听 `3001`，入站 SMTP 默认监听 `2525`。自动生成的密钥保存在数据库旁边，可通过 `HOSTID_DATA_DIR` 覆盖目录。

## 启动前端

另开一个终端，从仓库根目录执行：

```sh
npm ci --workspace=frontend
npm run dev
```

打开 **[http://localhost:3000](http://localhost:3000)**，在 `/setup` 填写本地站点地址和测试邮件域名，例如 `example.test`。Vite 将 `/api` 转发到 `http://localhost:3001`。

使用上述指定 frontend workspace 的安装命令。根清单仍有旧桌面工作区脚本，但当前仓库不包含桌面应用。

<a id="local-configuration"></a>

## 本地配置

- 站点、邮件和 SSO 等常规参数通过[系统设置](./configuration.md)修改。
- `backend/.env` 可选，[`backend/.env.example`](../../backend/.env.example)记录基础设施覆盖项，但 `DATABASE_URL` 默认被注释。上面的 export 会显式选择开发数据库。
- Vite API 代理目前固定连接后端 `3001` 端口。修改后端监听端口时，也需调整 [`frontend/vite.config.ts`](../../frontend/vite.config.ts)。
- Vite 的 `/config.js` 中间件从 `frontend/.env` 读取 `CF_TURNSTILE_SITE_KEY`。测试 Turnstile 时，在此填写相同的公开 site key，并通过系统设置配置后端 secret。修改 Vite 环境文件后需重启；生产容器的 `/config.js` 则由后端提供。
- 本地 URL、CORS 来源与 Cookie 设置需匹配使用的协议和主机。仅 HTTPS Cookie 不适用于普通 HTTP 测试地址。

## 检查与构建

安装前后端依赖后，在仓库根目录执行：

```sh
npm test
npm run typecheck
npm --prefix backend run typecheck
npm run build
npm --prefix backend run build
```

`npm test` 覆盖前后端。根目录 `typecheck` 和 `build` 仅检查或构建前端，因此后端命令需单独执行。本地使用上面的 `tsx` 开发命令运行，随附容器也通过 `tsx` 运行 TypeScript。后端构建用于检查编译，其输出含有无扩展名的 ESM 导入，不能直接通过普通的 `node dist/index.js` 运行。

浏览器布局检查：启动 Vite 后打开 `http://localhost:3000/tests/html-email.browser.html`。检查范围与限制见[邮件渲染](./email-rendering.md)。

Docker 可用时，可校验随附 Compose 定义：

```sh
node scripts/check-compose.mjs
```

镜像构建和隔离的容器冒烟检查见 [Docker 指南](./docker.md#maintainers)。

## 修改入口

| 范围 | 源码或指南 |
| --- | --- |
| 邮箱布局、主题、共享弹窗 | [设计系统](./design-system.md) |
| HTML、纯文本与 MIME 邮件解析 | [邮件渲染](./email-rendering.md) |
| SMTP 与对外投递 | [收件](../../backend/src/smtp/index.ts)、[发信](../../backend/src/services/mailer.ts) |
| 实例配置与密钥 | [设置](../../backend/src/services/settings.ts)、[密钥](../../backend/src/config/secrets.ts) |
| OAuth 与共享会话认证 | [OAuth 指南](./oauth.md)、[SSO 指南](./sso.md) |
| 嵌入外观契约 | [宿主集成](./embedding.md) |

修改文档描述的行为时，同步更新两种语言，并从[文档首页](./README.md)检查导航。
