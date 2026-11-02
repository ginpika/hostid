# 融合邮件（Fused Mail）

融合邮件让每个 HostID 用户通过 OAuth2 关联多个外部邮箱（Gmail、Outlook / Hotmail），后台用 IMAP + XOAUTH2 增量收信，并在「融合收件箱」中统一阅读。

## 工作方式

- **收信**：`imapflow` 以 XOAUTH2 登录 IMAP，读取 `INBOX`，按 `UIDVALIDITY + UID` 增量同步，`mailparser` 解析后写入独立的 `fused_emails` 表（不影响默认收件箱）。UIDVALIDITY 变化时会清掉该账号本地副本并重新同步。首次同步最多拉取 `FUSED_MAIL_INITIAL_SYNC_LIMIT` 封（默认 200），之后每轮最多 500 封。
- **同步时机（无后台定时轮询，节省流量）**：① 登录后首次进入「融合收件箱」时自动在后台同步该用户所有正常账号一次（前端按登录会话去重，后端对 2 分钟内同步过的账号跳过、同一账号正在同步时复用同一任务），不阻塞页面，完成后刷新列表；② 融合收件箱的「立即同步」按钮与融合邮件卡片上的单账号「立即同步」（不受冷却限制）；③ 新账号授权 / 重新授权成功后自动同步一次。单个账号失败只记录在该账号上，不影响其他账号。
- **本地操作**：已读 / 星标 / 归档 / 删除只作用于本地副本，**不会**回写到原邮箱。
- **发信**：提供实验性的 `POST /api/fused-mail/accounts/:id/send`（nodemailer + OAuth2）。Gmail 的 `https://mail.google.com/` scope 已覆盖 SMTP；Outlook 需要额外申请 `https://outlook.office.com/SMTP.Send`（当前默认未申请），前端暂未接入。
- **令牌**：access / refresh token 使用现有 AES-256-GCM（密钥由 `JWT_SECRET` 派生）加密存储。**更换 `JWT_SECRET` 会让已保存令牌失效，所有账号都需要重新授权。** 刷新时对每个账号加进程内锁，轮换的新 refresh token 立即写回；刷新被拒（4xx）只把该账号标记为「需重新授权」。
- **多账号**：账号以 `用户 + 平台 + 邮箱` 唯一。回调根据 id_token 中的邮箱判断是新增还是重新授权；对指定账号重新授权时若选了别的邮箱会被拒绝。
- **安全**：OAuth `state` 绑定当前登录用户，同时下发 `fused_mail_oauth` HttpOnly cookie（浏览器 nonce）防 CSRF，并使用 PKCE；state 10 分钟过期且只能使用一次。

## 回调地址

融合邮件使用独立回调（与登录回调分开）：

```
https://<你的域名>/api/fused-mail/oauth/callback
```

优先级：提供商上的「融合邮件回调地址」 > 环境变量 `FUSED_MAIL_CALLBACK_URL` > `FRONTEND_URL + /api/fused-mail/oauth/callback`。

## Google Cloud（Gmail）

1. 打开 [Google Cloud Console](https://console.cloud.google.com/)，新建或选择项目，启用 **Gmail API**。
2. 「OAuth 同意屏幕」：用户类型选「外部」，添加 scope `https://mail.google.com/`、`openid`、`email`。
3. 「凭据 → 创建凭据 → OAuth 客户端 ID」，类型选 **Web 应用**，在「已获授权的重定向 URI」中加入上面的回调地址。
4. 记下 Client ID 与 Client Secret。
5. **发布应用**：处于「测试」状态的应用，refresh token 会在 **7 天后过期**，账号会周期性变成「需重新授权」。请在同意屏幕点击「发布应用」（Publish app）进入正式状态。`https://mail.google.com/` 属于受限 scope，面向公众发布需要通过 Google 验证；仅自用时可接受「未经验证」提示。

## Microsoft Azure（Outlook / Hotmail）

1. 打开 [Azure Portal → 应用注册](https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade)，新建注册。
2. 支持的账户类型：选「任何组织目录中的帐户和个人 Microsoft 帐户」（才能登录 Hotmail / Outlook.com）。
3. 重定向 URI：平台选 **Web**，填写上面的回调地址。
4. 「证书和密码」中新建客户端密码，记下值（只显示一次）。
5. 「API 权限」添加委托权限：`offline_access`、`openid`、`email`，以及 Office 365 Exchange Online（或 Microsoft Graph）中的 `IMAP.AccessAsUser.All`。如需发信再加 `SMTP.Send`。
6. 企业租户需确认邮箱已启用 IMAP 与 SMTP AUTH。

## 在 HostID 中配置

管理后台 → OAuth 配置 → 新增提供商：

| 字段 | Gmail | Outlook |
| --- | --- | --- |
| 授权地址 | `https://accounts.google.com/o/oauth2/v2/auth` | `https://login.microsoftonline.com/common/oauth2/v2.0/authorize` |
| 令牌地址 | `https://oauth2.googleapis.com/token` | `https://login.microsoftonline.com/common/oauth2/v2.0/token` |
| 用户信息地址 | `https://openidconnect.googleapis.com/v1/userinfo` | `https://graph.microsoft.com/oidc/userinfo` |
| 邮箱平台 | Gmail | Outlook / Hotmail |

勾选「用于融合邮件」（可取消「用于登录」）。已有的提供商在迁移后默认只用于登录。登录页只显示「用于登录」的提供商，融合邮件页只显示「用于融合邮件」的提供商。

## 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `FUSED_MAIL_CALLBACK_URL` | `FRONTEND_URL/api/fused-mail/oauth/callback` | 融合邮件 OAuth 回调 |
| `FUSED_MAIL_INITIAL_SYNC_LIMIT` | `200` | 首次同步拉取的最近邮件数 |

## 限制

- 账号锁是进程内锁，多实例部署时需改为分布式锁。
- 目前只同步 INBOX，不回写 IMAP 标记，不同步附件。
