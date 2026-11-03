# Mail and DNS

[Documentation](./README.md) · **English** · [简体中文](./zh-CN/mail.md)

HostID provides a web mailbox, an inbound SMTP receiver and outbound delivery through a relay or recipient MX. Start with an existing local account, then connect your domain to the internet.

## Before changing DNS

1. Complete [setup](./docker.md#quick-start) with the intended mail domain, for example `example.com`.
2. Create the accounts that should receive mail. A user named `alex` is assigned `alex@example.com` when that domain is configured.
3. Send a message between two existing local users through the web interface and verify that it arrives.
4. Confirm your host can receive public TCP connections on port **25**. The default container mapping is host `25` → container `2525`.

The receiver accepts addresses found in the user database; it is not a catch-all mailbox. Changing the configured domain does not rename existing users' addresses.

<a id="dns"></a>

## Receiving internet mail

Example records for a server named `mail.example.com`:

| Name | Type | Value |
| --- | --- | --- |
| `example.com` | `MX` | Priority `10`, target `mail.example.com` |
| `mail.example.com` | `A` | Your server's reachable public IPv4 address |
| `mail.example.com` | `AAAA` | Add only if your public IPv6 path can also receive SMTP |

Configure routing, host firewalls and provider firewalls to allow inbound TCP 25. An HTTPS reverse proxy handles the website; SMTP needs its own reachable TCP listener. If your DNS provider offers an HTTP proxy, use a DNS-only record for the SMTP hostname unless a separate TCP service is explicitly configured.

Test from another machine, replacing the example hostname:

```sh
dig +short MX example.com
dig +short A mail.example.com
nc -vz mail.example.com 25
```

`dig` and `nc` are optional diagnostic tools. A successful TCP check only proves reachability. Send a real message from an external mailbox you control to an existing HostID account, then check the inbox and SMTP logs.

<a id="sending"></a>

## Sending to other domains

For a first public deployment, configure **Settings → System Settings → SMTP relay**:

| Field | What to enter |
| --- | --- |
| Relay host | The provider's SMTP hostname |
| Relay port | The provider's supported port; this implementation selects implicit TLS for `465` |
| Relay username | Provider credentials |
| Relay password | Provider password or app password |

All three of **host, username and password** must be set to enable the relay. The current relay configuration does not support an anonymous relay. Use a provider that permits your sending domain and verify that domain with the provider.

Without a complete relay configuration, external delivery resolves the recipient domain's MX records and attempts the preferred MX on TCP 25. This depends on outbound port 25, the sender IP's reputation, reverse DNS and the receiver's policies. It is not a queued, retrying mail-transfer service; use an appropriate relay or gateway when you need that behavior.

HostID delivers messages for existing local accounts directly to their database inboxes. To test external delivery, use a controlled mailbox outside the instance and confirm receipt; a copy in **Sent** is not proof that the external server accepted it. Inspect `[MAIL]` logs for delivery errors.

## SPF, DKIM and DMARC

Follow the records required by the system that actually sends your mail. A relay's SPF include and DKIM selector differ from a server sending directly from its own IP. HostID does not generate DKIM signatures itself.

Avoid copying a generic `v=spf1 mx -all` policy unless it accurately describes your sending hosts. Introduce a DMARC policy appropriate to your authenticated senders and reporting setup after checking SPF and DKIM alignment.

## Find a delivery problem

For the all-in-one deployment:

```sh
docker compose -f docker-compose.full.yaml logs --tail=100 hostid-full
```

For separate containers, use `docker compose logs --tail=100 backend` instead.

| Symptom | Check first |
| --- | --- |
| No inbound connection | MX target, DNS addresses, public TCP 25, host/provider firewall |
| `User not found` | Recipient matches an existing user's full email address |
| External sending fails | Relay host/user/password, allowed sender domain, outbound connectivity and `[MAIL]` errors |
| A sent message lands in spam | Sender authentication, relay/IP reputation and the recipient's policies |
| New domain does not receive old users' mail | Existing addresses were not rewritten when the setting changed |

Share only the relevant error lines when seeking help; logs can include addresses, subjects and other mail metadata.

## Protocol and data boundaries

- The SMTP listener receives mail for local accounts. It is not an authenticated desktop-client submission service, and currently does not advertise STARTTLS.
- IMAP, POP3, built-in spam filtering, antivirus and DKIM signing are not implemented. Add a suitable gateway where these are required.
- `.eml` import reads MIME bodies and inline CID images, but does not save ordinary attachments. Export includes headers and body, without attachment MIME parts. Use [instance backups](./docker.md#backup-and-restore) for complete data preservation.
- Drafts live in the current browser: text in local storage and attachment recovery in IndexedDB. Server-volume backups do not include those unsent local drafts.

For HTML and MIME compatibility, see [email rendering](./email-rendering.md). Implementation references: [SMTP receiver](../backend/src/smtp/index.ts), [delivery service](../backend/src/services/mailer.ts), [mail routes](../backend/src/routes/email.ts).
