# 嵌入宿主的外观同步

HostID 在主题应用后提供公开的外观快照，不依赖 Tauri，也不改变浏览器中的布局。

```ts
window.__HOSTID_APPEARANCE__ = {
  version: 1,
  backgroundColor: '#f4f6fa'
}
```

`backgroundColor` 是当前主题的 `colors.bg.primary`，使用不透明的 `#RRGGBB` 格式，
对应邮件工作区的背景。当前协议只同步纯色，不包含背景图片或渐变。

每次应用主题（包括系统明暗变化）后，HostID 在 `window` 上派发
`hostid:appearance` 自定义事件，`event.detail` 为同一份只读快照。
宿主应先注册事件监听，再读取 `window.__HOSTID_APPEARANCE__`，
以同时支持宿主先就绪和 HostID 先就绪的情况。隐藏后重新显示时应重新读取快照。

Slime 桌面客户端在邮件 WebView 内注入监听器，通过客户端拦截的
`/__minis_mail_appearance?version=1&backgroundColor=%23f4f6fa` 哨兵导航回传颜色。
该导航由原生壳取消，不会请求 HostID 服务端；HostID 自身不发起导航或原生调用。
客户端只在邮件视图使用该颜色，离开邮件视图后恢复原有背景。
旧客户端会忽略外观事件；旧版 HostID 没有快照时，客户端保留默认背景。
