# HostID 桌面客户端

基于 **Tauri 2** 构建的 HostID 桌面客户端，采用「实例启动台 + 同源 WebView 实例」单窗口架构：

- **多实例管理与连接**：支持连接任意自托管域名（`https://mail.example.com`）或本地开发实例（`http://localhost:3000`），自动探测 `/api/auth/site` 品牌信息与当前实例会话状态。
- **原生与无边框窗口适配**：
  - macOS 使用 `TitleBarStyle::Transparent` 透明原生标题栏（红绿灯位于 WebView 独立顶部栏中，不遮挡或挤压页面布局），并通过 `window.__HOSTID_APPEARANCE__` 随 HostID 10 套主题自动同步标题栏背景色与窗口明暗。
  - Windows / Linux 使用圆角无边框透明窗口、8 方位缩放热区与主题自适应窗口按钮。
- **回归 HostID 本身的用户体系**：账号登录、注册、Passkey、OAuth、个人资料与退出均由所连 HostID 实例直接提供，避免桌面壳重复造轮子；应用内顶栏提供「返回实例启动台」入口方便多实例切换。
- **外链安全打开**：邮件正文中的外部链接自动交由系统默认浏览器打开。

## 依赖要求

- Node.js 22+
- Rust / Cargo（稳定版）
- 当前平台的 Tauri 2 系统构建依赖

## 本地开发与构建

在仓库根目录或 `desktop/` 目录运行：

```bash
# 运行桌面端 Rust 与启动台测试
cargo test --manifest-path desktop/Cargo.toml
npm test --workspace=desktop

# 安装 @tauri-apps/cli 后启动开发模式 / 打包
npm install
npm run dev:desktop
npm run build:desktop
```

连接本地源码开发服务器时，请先启动 `backend` 与 `frontend`（默认 `http://localhost:3000`），再在桌面启动台点击「本地开发 (localhost:3000)」即可直接接入。
