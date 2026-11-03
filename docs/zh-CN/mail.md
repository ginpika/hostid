# 邮件与 DNS

[文档首页](./README.md) · [English](../mail.md) · **简体中文**

HostID 提供 Web 邮箱、入站 SMTP，以及通过中继或收件域 MX 对外投递的能力。建议先验证本地账号收发，再把域名接入互联网。

## 修改 DNS 前

1. 在[初始化](./docker.md#quick-start)时填写计划使用的邮件域名，例如 `example.com`。
2. 创建需要收信的账号。在该域名下创建的 `alex` 用户，其邮箱为 `alex@example.com`。
3. 在 Web 界面向另一个已存在的本地用户发信，并确认收件箱中收到邮件。
4. 确认服务器可以通过公网 **TCP 25** 接收连接。默认容器映射为宿主机 `25` → 容器 `2525`。

SMTP 只接受用户数据库中存在的邮箱地址，不提供 catch-all 收件。修改邮件域名不会自动重命名已有用户的邮箱地址。

<a id="dns"></a>

## 接收互联网邮件

以 `mail.example.com` 为邮件主机为例：

| 名称 | 类型 | 值 |
| --- | --- | --- |
| `example.com` | `MX` | 优先级 `10`，指向 `mail.example.com` |
| `mail.example.com` | `A` | 服务器可达的公网 IPv4 地址 |
| `mail.example.com` | `AAAA` | 仅在公网 IPv6 链路也能接收 SMTP 时添加 |

在路由、主机防火墙和服务商防火墙中放行入站 TCP 25。HTTPS 反向代理负责网站，SMTP 需要单独可达的 TCP 监听。如果 DNS 服务商提供 HTTP 代理，SMTP 主机名应使用仅 DNS 解析，除非另外配置了 TCP 代理服务。

在其他机器上检查，使用自己的域名替换示例：

```sh
dig +short MX example.com
dig +short A mail.example.com
nc -vz mail.example.com 25
```

`dig` 和 `nc` 是可选诊断工具。TCP 连通只证明网络可达，还需从自己控制的外部邮箱向已有 HostID 用户实际发信，检查收件箱与 SMTP 日志。

<a id="sending"></a>

## 向其他域名发信

首次公开部署时，建议先配置「设置 → 系统设置 → SMTP 中继」：

| 字段 | 填写内容 |
| --- | --- |
| 中继主机 | 服务商的 SMTP 主机名 |
| 中继端口 | 服务商支持的端口；当前实现对 `465` 使用隐式 TLS |
| 中继用户名 | 服务商提供的凭据 |
| 中继密码 | 密码或应用专用密码 |

**主机、用户名、密码**三项都已配置时才会启用中继，当前配置不支持匿名中继。需要选择允许使用自己发信域名的服务商，并按其要求验证域名。

中继配置不完整时，对外投递会解析收件域的 MX，并尝试通过 TCP 25 连接优先 MX。效果受出站 25 端口、IP 信誉、反向 DNS 和收件方策略影响。当前没有邮件传输队列和自动重试机制，需要这些能力时应配合合适的中继或网关。

发给已存在本地账号的邮件会直接写入其数据库收件箱。测试外部投递时，使用自己控制的实例外邮箱并确认实际收到；**已发送**文件夹中有副本，不代表外部服务器已接受邮件。投递错误需查看 `[MAIL]` 日志。

## SPF、DKIM 与 DMARC

根据实际发信系统设置记录。中继服务的 SPF include、DKIM selector 与服务器通过自身 IP 直投时不同，HostID 本身不会生成 DKIM 签名。

只有在准确描述发信主机时才使用 `v=spf1 mx -all` 等模板。确认 SPF、DKIM 对齐后，再根据自己的发信来源与报告配置制定 DMARC 策略。

## 排查投递问题

全量单容器部署：

```sh
docker compose -f docker-compose.full.yaml logs --tail=100 hostid-full
```

前后端分离部署使用 `docker compose logs --tail=100 backend`。

| 现象 | 优先检查 |
| --- | --- |
| 没有入站连接 | MX 目标、DNS 地址、公网 TCP 25、主机与服务商防火墙 |
| `User not found` | 收件地址是否与已有用户的完整邮箱地址一致 |
| 对外发信失败 | 中继主机/用户名/密码、允许的发信域名、出站连通性及 `[MAIL]` 错误 |
| 邮件进入垃圾箱 | 发件人认证、中继/IP 信誉与收件方策略 |
| 改了域名后老用户收不到新地址的信 | 修改设置不会自动改写已有邮箱地址 |

寻求帮助时只提供相关错误片段，日志可能包含地址、主题及其他邮件元数据。

## 协议与数据边界

- SMTP 监听器用于接收本地账号的邮件，不是桌面客户端的认证投稿服务，当前不提供 STARTTLS。
- 尚未实现 IMAP、POP3、内置反垃圾、病毒扫描或 DKIM 签名。需要时配合适当的邮件网关。
- `.eml` 导入读取 MIME 正文及内嵌 CID 图片，但不保存普通附件；导出包含邮件头与正文，不包含附件 MIME 部分。完整保存数据请使用[实例备份](./docker.md#backup-and-restore)。
- 草稿保存在当前浏览器，正文使用本地存储，附件恢复使用 IndexedDB。服务端数据卷备份不包含这些未发送的本地草稿。

HTML 与 MIME 兼容性见[邮件渲染](./email-rendering.md)。实现参考：[SMTP 收件](../../backend/src/smtp/index.ts)、[发信服务](../../backend/src/services/mailer.ts)、[邮件路由](../../backend/src/routes/email.ts)。
