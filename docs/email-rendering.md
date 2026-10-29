# 邮件正文兼容性

目标是在现代浏览器中完整显示常见的静态 HTML 邮件。以下结论基于实际 MIME 样例、原始 GitHub/DeepSeek 邮件及浏览器回归检查，不代表覆盖所有邮件客户端或全部 HTML 功能。

## 已覆盖

| 类型 | 支持情况 |
| --- | --- |
| 发送者样式 | 保留头部 `<style>`、内联样式、`@media` 和 `style[media]`；应用样式与正文通过 iframe 隔离 |
| 表格布局 | 保留嵌套表格、宽高、对齐、单元格间距、跨行跨列、`col[span]`、表头关联；不强加单元格 padding |
| 文本和容器 | 支持常用 HTML5 语义容器、图注、引用、注音、双向文本和软换行；保留隐藏预览内容的 `hidden` 属性 |
| 列表 | 保留有序列表起始编号、倒序和单项编号 |
| 图片 | 支持远程图片、单个 `img[src]` 的 data URI、常见 MIME CID 内嵌图片、`picture/source`、常规 URL 的 `srcset/sizes` 和图片热区 |
| 固定尺寸 | 保留显式图片高度，避免将邮件中的 1×20 等占位图片压成自然比例；未声明高度的图片提供响应式兜底 |
| 链接 | 外部链接及图片热区在新窗口打开；片段链接滚动到当前邮件的对应锚点 |
| 高度 | 自动容纳正文外边距；百分比高度的短邮件可从长邮件回缩；折叠内容和图片加载后重新测量 |
| 内容识别 | 完整 HTML 或以标签开始的 HTML 片段不会因内部代码示例而误判成 Markdown；保留历史 Markdown/front matter 支持 |
| MIME | HTML alternative 优先；新收取的 `text/plain` 保留字面内容；导入 EML 使用原始字节按声明字符集解码，验证了 GB18030、UTF-8、8bit、quoted-printable 和 base64 图片 |

## 仍有边界

- 当前白名单不显示脚本、表单、嵌套 iframe、内联 SVG、音视频和外链 `<link>` 样式表。远程图片中的 SVG 与内联 SVG 属于不同情况。
- Outlook 专用 VML、AMP 邮件和依赖脚本的交互模板不在支持范围内；有标准 HTML 后备内容的模板依靠后备内容显示。
- DOMPurify 的默认 URI 检查会过滤以 `data:` 开始的 `srcset`；常规 URL 的响应式图片和 `img src="data:…"` 已验证。相对资源 URL 没有发送者网页的 base 上下文，不保证能找到资源。
- 历史正文没有单独保存 MIME 类型，仍需启发式识别。新的 SMTP/EML 纯文本正文会先转义为 HTML，避免将其中的标签、标题或星号误作格式。
- 本次也确认了已有的 EML 导入流程未保存普通附件；CID 图片由 MIME 解析器内嵌到正文，能正常显示。普通附件导入属于独立的已有缺口。

## 验证方式

- `npm run test --workspace=frontend`：包括正文格式识别等单元测试。
- `npm --prefix backend test`：包括 MIME 编码、CID、alternative 和纯文本保真测试。
- `npm run dev --workspace=frontend` 后打开 `/tests/html-email.browser.html`：执行 14 项真实浏览器布局和组件回归检查，无额外测试依赖。
- 已在 Chrome 执行浏览器检查；未据此承诺其他浏览器引擎的完全一致性。

参考：[HTML 图片规范](https://html.spec.whatwg.org/multipage/images.html)、[HTML 列表与分组元素](https://html.spec.whatwg.org/multipage/grouping-content.html)、[hidden 属性](https://html.spec.whatwg.org/multipage/interaction.html#the-hidden-attribute)、[CID URL（RFC 2392）](https://www.rfc-editor.org/rfc/rfc2392.html)、[MailParser 行为](https://nodemailer.com/extras/mailparser)。
