[文档首页](./README.md) · [English](../embedding.md) · **简体中文**

# 嵌入：主题外观同步

HostID 发布一份简短的外观快照，供 WebView 宿主匹配应用背景。这是页面内的协议，不依赖 Tauri 或某个特定桌面客户端，也不提供认证、原生桥接或跨来源 iframe 嵌入权限。

## 公开协议

实现位于 [appearance.ts](../../frontend/src/lib/appearance.ts)，由 [ThemeContext.tsx](../../frontend/src/contexts/ThemeContext.tsx) 在应用主题后调用。

```ts
interface HostAppearance {
  readonly version: 1
  readonly backgroundColor: string
}

window.__HOSTID_APPEARANCE__ // Readonly<HostAppearance> | undefined
```

| 接口 | 行为 |
| --- | --- |
| `window.__HOSTID_APPEARANCE__` | 最近发布的快照；应用主题前可能不存在 |
| `window` 上的 `hostid:appearance` | `CustomEvent`，其 `detail` 与写入全局变量的是同一个快照 |
| `version` | 当前为 `1`；接收方应忽略不支持的版本 |
| `backgroundColor` | 解析后主题的 `colors.bg.primary`；当前内置预设均使用不透明的 `#RRGGBB` 颜色 |

每次发布都会创建新的 `Object.freeze` 快照，先写入全局变量，再派发事件。此前取得的快照不会变化。接收方应容忍颜色重复，避免将每个事件都视为新的视觉变化。

首次应用主题及后续更新都会发布快照，包括系统外观变化。发布器接受字符串但不校验颜色语法，宿主在传入原生 API 前应自行验证。协议只传递纯色，不包含背景图片、渐变或完整主题。

## 订阅并读取当前值

应**先注册监听，再读取全局变量**，兼容宿主先就绪或 HostID 已经发布过快照的情况。

```js
function attachHostIdAppearance(applyBackground) {
  const apply = snapshot => {
    if (
      snapshot?.version !== 1 ||
      typeof snapshot.backgroundColor !== 'string' ||
      !/^#[0-9a-f]{6}$/i.test(snapshot.backgroundColor)
    ) return

    applyBackground(snapshot.backgroundColor)
  }
  const onAppearance = event => apply(event.detail)

  window.addEventListener('hostid:appearance', onAppearance)
  apply(window.__HOSTID_APPEARANCE__)

  return {
    refresh: () => apply(window.__HOSTID_APPEARANCE__),
    dispose: () => window.removeEventListener('hostid:appearance', onAppearance),
  }
}
```

`applyBackground` 由宿主提供。快照不存在或版本不支持时，保留兜底颜色。视图隐藏后重新显示时，如果可能错过更新，应重新读取；与文档解除绑定时移除监听。导航到新文档后需要重新订阅。

监听器必须运行在 HostID 页面上下文，或有权限访问其 window 的上下文。自定义事件不会自动转发给父 frame 或原生进程。跨来源父页面无法通过普通 DOM API 读取该全局变量，需要桥接时由宿主提供获准的机制。

## 画布与控件

[index.css](../../frontend/src/index.css) 让 `html`、`body` 和 `#root` 保持背景透明，由各个应用面板绘制主题背景。body 通过 `--app-color-scheme` 设置原生控件外观，根元素保持 `color-scheme: normal`。

快照仅报告工作区主背景色，不要求宿主重新配色每一个区域。HTML 邮件正文保留自己的渲染样式，详见[设计系统](./design-system.md)和[邮件正文渲染](./email-rendering.md)。

## Slime 等外部客户端

Slime 等客户端可以注入监听器，再通过自身的 IPC 或导航拦截转发颜色。桥接机制、原生颜色转换、视图生命周期及背景恢复均由接收客户端负责。

HostID 自身不会为这个协议调用原生 API、发起哨兵导航或使用 `postMessage`，也没有 `/__minis_mail_appearance` 端点。本仓库不包含 Slime 客户端实现，因此不能在此验证其当前拦截行为或特定版本的支持情况。

此外，这个外观钩子不会改变 iframe 策略。API/全量镜像服务器通过 [security.ts](../../backend/src/middleware/security.ts) 设置 `frame-ancestors 'self'`；分离部署的前端可能有额外响应头。规划嵌入集成时，应检查实际提供页面的服务器配置。

## 验证

[appearance.test.mjs](../../frontend/tests/appearance.test.mjs) 检查首次读取、后续事件、快照对象身份及不可变性，以及无浏览器环境下的发布。在仓库根目录运行：

```bash
node --test frontend/tests/appearance.test.mjs
```

这些测试验证 HostID 发布器。接收客户端仍需单独检查首次加载、主题变化、隐藏/显示、文档导航及自身的原生桥接。
