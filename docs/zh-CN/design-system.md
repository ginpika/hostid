[文档首页](./README.md) · [English](../design-system.md) · **简体中文**

# 设计系统

HostID 的两套界面布局共用一组语义化主题变量。本文说明修改入口及需要保留的行为；具体配色、尺寸和组件交互以链接的源码为准。

## 源码入口

| 内容 | 维护位置 |
| --- | --- |
| 主题类型、预设、解析和布局类名 | [themes/index.ts](../../frontend/src/themes/index.ts) |
| 应用 CSS 变量和保存主题选择 | [ThemeContext.tsx](../../frontend/src/contexts/ThemeContext.tsx) |
| 公共控件、现代界面、邮箱和响应式规则 | [index.css](../../frontend/src/index.css) |
| 经典布局覆盖样式 | [classic-shell.css](../../frontend/src/styles/classic-shell.css)、[classic-mailbox.css](../../frontend/src/styles/classic-mailbox.css)、[classic-reading.css](../../frontend/src/styles/classic-reading.css) |
| 外观选择器 | [ThemeSelector.tsx](../../frontend/src/components/ThemeSelector.tsx)、[theme-selector.css](../../frontend/src/styles/theme-selector.css) |
| 个人资料和管理界面 | [profile.css](../../frontend/src/styles/profile.css)、[admin-settings.css](../../frontend/src/styles/admin-settings.css) |
| 宿主外观发布 | [appearance.ts](../../frontend/src/lib/appearance.ts) |

通过主题上下文的 `useTheme()` 获取主题。[lib/theme.ts](../../frontend/src/lib/theme.ts) 是已弃用的辅助工具，不负责应用当前主题。

## 语义化变量

`ThemeContext` 将解析后的主题应用到 `document.documentElement`。组件使用 CSS 变量，避免在各个页面重复抄写配色。

| 变量组 | 用途 |
| --- | --- |
| `--color-bg-primary` | 工作区及页面背景 |
| `--color-bg-secondary` | 面板、卡片和弹窗 |
| `--color-bg-tertiary`、`--color-bg-hover` | 次级背景及交互状态 |
| `--color-text-primary`、`--color-text-secondary` | 主要文字及辅助内容 |
| `--color-text-tertiary`、`--color-text-quaternary`、`--color-text-muted` | 元信息和弱化内容 |
| `--color-border-primary`、`--color-border-secondary` | 面板边界及控件边框 |
| `--color-accent-primary`、`--color-accent-secondary` | 主要操作及其变化状态 |
| `--color-accent-muted`、`--color-accent-text` | 选中背景及强调色上的文字 |
| `--color-code-*`、`--color-pre-*` | 行内代码及代码块 |

`index.css` 的 `:root` 提供初始浅色配色，再由 `ThemeContext` 应用解析出的预设。修改浅色预设时，同步检查初始变量。滚动条配色由 CSS 基于语义变量派生。

新增界面时，优先复用现有组件或语义样式类：

```tsx
<section
  className="card p-6"
  style={{ color: 'var(--color-text-primary)' }}
>
  <h2 className="text-lg font-semibold">账户设置</h2>
  <p style={{ color: 'var(--color-text-secondary)' }}>
    管理个人资料和登录方式。
  </p>
  <button type="button" className="btn-primary mt-4">
    保存修改
  </button>
</section>
```

状态及危险操作可以有独立的语义颜色。应在所有受影响的配色中检查效果，避免直接用主题强调色代替错误提示色。

## 主题选择与布局

当前有 **10 个预设**，另有 **跟随系统** 选择模式：

| 布局 | 预设 ID |
| --- | --- |
| 现代工作区 | `light`、`dark`、`sakura`、`starry-night`、`forest`、`ocean`、`sunset`、`lavender` |
| 经典 | `classic`、`classic-dark` |

`layout` 字段默认为 `workspace`，两个经典预设明确指定为 `classic`。每个预设还声明 `colorScheme`，因此主题同时决定配色，以及明确指定时的布局。

- 选择保存在本机的 `theme_mode` 中。
- 未保存选择时使用 `system`，根据 `prefers-color-scheme` 解析为现代 `light` 或 `dark`。
- 明确选择的预设不会随操作系统明暗变化而切换。
- 无法识别的预设回退到 `getDefaultTheme()`。
- 应用主题时，提供者会替换 `theme-*`、`design-*` 和 `system-*` 类；组件不应额外添加冲突的布局标记。

外观选择器分组展示现代和经典预设，预览两种布局，选择后立即应用。较大屏幕使用锚定浮层，600 px 以下使用模态面板。单选组键盘导航、焦点恢复及视口定位逻辑见源码。

主题模型还支持可选背景元数据和自定义 CSS。增加预设需要修改源码；当前选择器没有供用户导入主题文件的界面。

## 工作区行为

[Layout.tsx](../../frontend/src/components/Layout.tsx)、[Sidebar.tsx](../../frontend/src/components/Sidebar.tsx) 和 [Inbox.tsx](../../frontend/src/pages/Inbox.tsx) 共同控制应用框架和阅读区域：

- 宽屏分栏模式并排显示列表和正文；列表模式通过弹窗打开选中的邮件。
- 768 px 以下，列表使用可用宽度，邮件详情通过弹窗打开，即使当前选择的是分栏模式。
- 1024 px 以下，导航改为抽屉；宽屏支持固定侧栏和紧凑侧栏。
- 分隔条支持拖动、方向键、Home 和 End。限制由 [mailLayout.ts](../../frontend/src/lib/mailLayout.ts) 计算，包括 300 px 最小宽度、600 px 上限及阅读区预留空间。
- 列表宽度、列表/分栏选择及侧栏偏好保存在本机；现代和经典列表宽度使用不同的存储键。

弹性容器应按需保留 `min-width: 0` 和 `min-height: 0`，使滚动和截断发生在正确的面板内。调整宽度前，检查长主题、多收件人和窄阅读区。

## 公共组件与交互

| 区域 | 复用及保留的内容 |
| --- | --- |
| 操作和表单 | `.btn-primary`、`.btn-secondary`、`.input-field`、`.card`；无需提交表单的按钮应使用 `type="button"` |
| 邮件列表 | [EmailList.tsx](../../frontend/src/components/EmailList.tsx)：选中状态、未读标记、键盘行导航、紧凑及经典变体 |
| 阅读 | [EmailDetail.tsx](../../frontend/src/components/EmailDetail.tsx)、[EmailEnvelope.tsx](../../frontend/src/components/EmailEnvelope.tsx)、[MailReadingActions.tsx](../../frontend/src/components/MailReadingActions.tsx) |
| 写信 | [ComposeEmail.tsx](../../frontend/src/components/ComposeEmail.tsx)、[RecipientInput.tsx](../../frontend/src/components/RecipientInput.tsx)、[RichTextEditor.tsx](../../frontend/src/components/RichTextEditor.tsx) |
| 操作确认 | [ConfirmDialog.tsx](../../frontend/src/components/ConfirmDialog.tsx)：初始聚焦取消、等待/错误状态、明确的危险操作 |
| 资料弹窗 | [ProfileDialog.tsx](../../frontend/src/components/ProfileDialog.tsx)：可识别的弹窗标题、焦点限制、忙碌状态及焦点恢复 |

沿用现有系统字体栈及 Lucide 图标。只有图标的按钮需要可访问名称；装饰图标不能代替按钮名称。优先沿用相邻组件的间距和字号，避免另起一套规范。

## 焦点与可访问性

- 保留可见的键盘焦点、应用跳转链接、字段标签和弹窗标题。
- [modalStack.ts](../../frontend/src/lib/modalStack.ts) 判断当前可见弹窗中谁拥有焦点，以及何时可以恢复到触发按钮。弹窗可能叠加时应复用它。
- Escape 和焦点限制应由当前弹窗处理，避免背景弹窗抢走键盘事件。
- 错误信息应说明如何恢复，并按需沿用 `alert`、`status`、`aria-busy` 和选择状态语义。
- 遵循 `prefers-reduced-motion`；`index.css` 缩短全局过渡和动画，外观选择器另有减少动画规则。

主题测试覆盖部分经典主题前景与背景的对比度组合，并不代表所有页面或预设均经过认证。新增文字、控件、错误及选中状态仍需在实际界面检查。

## 文档画布与邮件正文

`html`、`body` 和 `#root` 保持背景透明，供 WebView 宿主使用；应用面板自行绘制背景。原生控件通过 body 的 `--app-color-scheme` 应用外观，根元素保持 `color-scheme: normal`。

应用主题后，提供者会向嵌入宿主发布主背景色。应使用[外观协议](./embedding.md)，避免从 DOM 类名猜测主题。

HTML 邮件使用独立的渲染区域。发送者样式与应用隔离，也不会为深色模式自动重新配色。修改正文 CSS 前请先读[邮件正文渲染](./email-rendering.md)。

## 修改与验证

1. 在 `themes/index.ts` 修改配色和主题元数据；修改浅色预设时同步检查初始 CSS 默认值。
2. 在对应的现代或经典样式文件中扩展布局，复用公共控件。
3. 检查现代浅色/深色、两套经典布局、至少一个彩色主题及跟随系统。
4. 检查窄屏、长内容、纯键盘操作、叠加弹窗及减少动画模式。
5. 在仓库根目录运行相关检查：

```bash
npm --prefix frontend run typecheck
npm run test --workspace=frontend
```

相关回归文件包括 [themes.test.mjs](../../frontend/tests/themes.test.mjs)、[mail-layout.test.mjs](../../frontend/tests/mail-layout.test.mjs)、[modal-stack.test.mjs](../../frontend/tests/modal-stack.test.mjs) 和 [appearance.test.mjs](../../frontend/tests/appearance.test.mjs)。浏览器布局变更还需要视觉检查；Node 测试不会执行完整界面。
