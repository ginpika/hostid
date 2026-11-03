[文档首页](./README.md) · [English](../email-rendering.md) · **简体中文**

# 邮件正文渲染与兼容性

HostID 以现代浏览器中常见的静态 HTML 邮件为目标，并将发送者样式与应用隔离。兼容范围由下述解析器、过滤器、渲染器和回归样例决定，不代表支持所有邮件模板，也不代表各浏览器引擎输出完全相同。

## 渲染流程

1. SMTP 收信和 EML 导入使用 MailParser。[getParsedEmailBody](../../backend/src/lib/parsed-email-body.ts) 优先使用 HTML alternative，再使用解析器对纯文本生成的转义 HTML，最后回退到纯文本。[parseEmailFile](../../backend/src/lib/parse-email-file.ts) 按字节读取 EML，让解析器根据每部分声明的字符集及传输编码解码。
2. 数据库正文没有独立的 MIME 类型字段。[mailContent.ts](../../frontend/src/lib/mailContent.ts) 推断 HTML、Markdown 或纯文本，并兼容历史正文。完整 HTML 文档或以标签开头的片段优先于其中的 Markdown 示例。
3. [EmailBody.tsx](../../frontend/src/components/EmailBody.tsx) 使用 `srcdoc` iframe 显示 HTML；Markdown 经 Marked 解析后由 DOMPurify 过滤；纯文本保留空白和换行。
4. [htmlEmail.ts](../../frontend/src/lib/htmlEmail.ts) 过滤完整 HTML 文档，保留允许的 head 和 body 样式。低优先级的默认样式放在发送者样式之前，避免覆盖原有设计。

新收取的 MIME `text/plain` 在可用时使用转义 HTML，因此其中的字面标签、Markdown 标题、星号及换行仍按文本显示。历史正文仍依赖启发式识别。

## 已覆盖行为

| 范围 | 当前实现与回归覆盖 |
| --- | --- |
| 发送者样式 | 头部 `<style>`、内联样式、媒体查询、`style[media]`、body 类及支持的旧式 body 颜色属性 |
| 表格 | 嵌套布局、显式尺寸、对齐、单元格间距、跨行跨列、`col[span]` 及表头关联；不统一覆盖单元格内边距 |
| 正文元素 | 常用语义区块、图注、引用、注音、双向文本属性、软换行及隐藏预览内容 |
| 列表 | 有序列表起始编号、倒序及单项编号 |
| 图片 | 远程图片、`img[src]` data URI、解析后的 MIME CID 图片、`picture/source`、普通 URL 的 `srcset/sizes` 及图片热区 |
| 图片尺寸 | 保留占位或裁剪图片的显式高度；未声明高度时提供响应式兜底 |
| 链接 | 外部链接及图片热区在阅读区外打开，并附带 `noopener noreferrer`；片段链接滚动到当前邮件内 |
| 高度 | 容纳正文及 body 外边距，从长邮件切换后回缩，并在图片、字体或折叠内容变化后重新测量 |
| MIME 样例 | GB18030、UTF-8、8bit、quoted-printable、HTML alternative 及 base64 CID 图片 |

HTML 渲染器使用 `ResizeObserver`，并在 `<details>` 切换时主动重新测量。测量前会重置 iframe 高度，避免发送者的百分比高度样式继承前一封长邮件的尺寸。

## 过滤与边界

HTML iframe 允许 `allow-same-origin`、`allow-popups` 和 `allow-popups-to-escape-sandbox`，**不允许脚本**。DOMPurify 移除白名单外的元素和属性，包括脚本、内联事件处理器、表单、嵌套 iframe、`<base>` 和刷新元数据。

- HTML 白名单不包含内联 SVG、音视频及外链 `<link>` 样式表。作为图片加载的 SVG 与内联 SVG 是不同情况。
- Outlook 专用 VML、AMP 邮件及依赖脚本的模板不在支持范围内；有标准 HTML 后备内容时仍可能显示。
- DOMPurify 会过滤 `srcset` 中的 `data:` 候选项；普通 URL 候选项及 `img src="data:…"` 已有样例覆盖。
- 相对资源 URL 缺少发送者网站原本的 base 上下文，不保证能够正确定位。
- 保留发送者布局和配色，HTML 邮件不会为深色模式自动重新配色。
- 浏览器可能直接请求远程图片；渲染器没有图片代理或加载前审批控件。
- 浏览器策略、部署时的响应头、网络可用性及发送者 CSS 仍可能影响结果。API/全量镜像的响应策略见 [security.ts](../../backend/src/middleware/security.ts)，分离部署的前端还有自身的服务器配置。

### EML 在此处并非完整备份格式

当前 [EML 导入路由](../../backend/src/routes/email.ts) 保存正文及邮件元信息，但**不会将普通附件保存为附件记录**。被解析器嵌入 HTML 的 CID 图片仍可以显示。

导出路由写入邮件头及数据库中的正文，不会构建包含附件文件的 multipart 邮件。因此，EML 导入/导出不能承诺无损迁移，也不能替代应用数据卷备份。

## 验证

在仓库根目录运行单元测试：

```bash
npm run test --workspace=frontend
npm --prefix backend test
```

相关测试包括格式推断的 [mail-content.test.mjs](../../frontend/tests/mail-content.test.mjs)，以及 MIME 解码、CID 内容、alternative 选择和纯文本保真的 [parse-email-file.test.ts](../../backend/tests/parse-email-file.test.ts)。

[浏览器测试页](../../frontend/tests/html-email.browser.mjs) 当前包含 **14 项检查**，使用真实布局及生产环境的 `EmailBody` 组件，覆盖窄表格、发送者 CSS、过滤、响应式图片、链接、内容切换及高度变化。

```bash
npm run dev --workspace=frontend
```

在 Vite 服务器打开 `/tests/html-email.browser.html`，检查 PASS/FAIL 输出。页面末尾显示汇总，并将 `document.body.dataset.testStatus` 设为 `passed` 或 `failed`。这些浏览器检查独立于 Node 测试命令，不需要额外测试框架。

修改渲染逻辑时，应针对实际问题补充小型样例，并在目标引擎重新运行浏览器测试。Chrome 中通过不代表其他引擎结果完全一致。
