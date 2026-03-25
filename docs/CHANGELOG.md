# 更新日志

本项目的所有重要变更都将记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/) 规范。

## [v0.5.0] - 2026-03-24

### 新增功能
- 支持 GitHub OAuth 登录提供商
- 用户资料页面显示 GitHub 绑定状态
- GitHub 账号绑定功能

### 修复
- 修复 GitHub 快速 OAuth 注册时邮箱地址错误的问题
- 修复头像 URL 冲突问题

---

## [v0.4.0] - 2026-03-16

### 新增功能
- 头像支持与 SSO 页面更新
- 密码传输使用 RSA 加密（安全增强）
- 应用标签显示用户信息标签

### 改进
- 优化登录动画与重定向动画
- 优化邮件撰写按钮交互

### 修复
- 修复登录卡片头像显示错误
- 修复注册页面 Turnstile 预加载位置错误

### 变更
- Node.js 版本从 20 升级到 22
- 更新 GitHub Actions 配置

### 其他
- 添加 favicon.ico
- 更新 Docker Compose 卷配置
- 修复生产目录权限问题
- 移除冗余环境变量

---

## [v0.3.0] - 2026-03-11

### 安全
- 移除冗余管理员账户

### 修复
- 修复 Vite 环境变量前缀检查与 Turnstile 不工作的问题
- 修复 Turnstile 站点密钥在生产环境不工作的问题

### 变更
- 整理 Prisma 迁移日志
- 更新 Dockerfile 镜像标签

### 文档
- 更新 README.md

---

## [v0.2.0] - 2026-03-10

### 新增功能
- 项目发布就绪

### 变更
- 更新 GitHub Actions 工作流
- 更新 Dockerfile 配置

### 修复
- 修复 Docker Compose 与 .env 配置错误

### 文档
- 移除 README.md 中的许可证
- 修改 Logo 尺寸
- 编辑项目名称

---

## [v0.1.0] - 2026-03-10

### 新增功能
- 初始化项目仓库结构
- 项目基础架构搭建

---

## 版本说明

### 版本号规则

- **主版本号 (MAJOR)**：不兼容的 API 更改
- **次版本号 (MINOR)**：向后兼容的功能新增
- **修订号 (PATCH)**：向后兼容的问题修复

### Commit 类型说明

| 类型 | 说明 |
|------|------|
| `feat` | 新功能 |
| `fix` | Bug 修复 |
| `security` | 安全相关更新 |
| `modify` | 功能修改/优化 |
| `update` | 更新操作 |
| `chore` | 构建/工具变更 |
| `deploy` | 部署相关 |
| `migration` | 数据库迁移 |
| `dockerfile` | Dockerfile 变更 |
| `workflow` | CI/CD 工作流变更 |
| `init` | 初始化操作 |


