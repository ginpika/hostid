[Documentation](./README.md) · **English** · [简体中文](./zh-CN/embedding.md)

# Embedding: theme appearance

HostID publishes a small appearance snapshot so a WebView host can match the application's background. This is an in-page contract, independent of Tauri or any particular desktop client. It does not provide authentication, a native bridge, or permission to frame the site from another origin.

## Public contract

The implementation is [appearance.ts](../frontend/src/lib/appearance.ts), called by [ThemeContext.tsx](../frontend/src/contexts/ThemeContext.tsx) after a theme is applied.

```ts
interface HostAppearance {
  readonly version: 1
  readonly backgroundColor: string
}

window.__HOSTID_APPEARANCE__ // Readonly<HostAppearance> | undefined
```

| Surface | Behavior |
| --- | --- |
| `window.__HOSTID_APPEARANCE__` | Latest published snapshot; may be absent before the theme is applied |
| `hostid:appearance` on `window` | A `CustomEvent` whose `detail` is the same snapshot assigned to the global |
| `version` | Currently `1`; consumers should ignore unsupported versions |
| `backgroundColor` | The resolved theme's `colors.bg.primary`; current built-in presets use opaque `#RRGGBB` colors |

Each publication creates a new `Object.freeze` snapshot, assigns it to the global, then dispatches the event. Previous snapshots remain unchanged. Consumers should tolerate repeated colors rather than treating every event as a distinct visual change.

Publishing occurs on initial theme application and later theme updates, including system appearance changes. The publisher accepts a string without validating its color syntax; hosts should validate input before passing it to a native API. The contract carries a solid color only, not background images, gradients, or the entire theme.

## Subscribe and read the current value

Install the listener **before** reading the global. This handles both a host that attaches early and one that attaches after HostID has already published.

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

`applyBackground` is supplied by the host. Keep a fallback color when the snapshot is absent or unsupported. Re-read it when a hidden view becomes visible if the host may have missed updates; remove the listener when detaching from the document. Navigation to a new document requires a new subscription.

The listener must run in HostID's page context, or in a context permitted to access its window. Custom events are not automatically forwarded to a parent frame or a native process. Cross-origin parents cannot read this global through the normal DOM API; a host must supply its own approved bridge if it needs one.

## Canvas and controls

[index.css](../frontend/src/index.css) keeps `html`, `body`, and `#root` backgrounds transparent while individual application surfaces paint their theme backgrounds. The body uses `--app-color-scheme` for native controls; the root retains `color-scheme: normal`.

The snapshot reports the primary workspace color. It is not a request to recolor every surface, and HTML email content keeps its own rendering styles. See [design system](./design-system.md) and [email rendering](./email-rendering.md).

## External clients, including Slime

A client such as Slime may inject the listener and forward the color through its own IPC or navigation interception. Those mechanisms, native color conversion, view lifecycle, and background restoration belong to the consuming client.

HostID itself does not call a native API, emit sentinel navigation, or use `postMessage` for this contract. There is no HostID `/__minis_mail_appearance` endpoint. The Slime client implementation is not present in this repository, so its current interception behavior or support in particular releases cannot be verified here.

Likewise, this appearance hook does not change iframe policy. The API/full-image server sets `frame-ancestors 'self'` through [security.ts](../backend/src/middleware/security.ts); separately served frontends may have additional response headers. Check the actual serving configuration when planning an embedding integration.

## Verification

[appearance.test.mjs](../frontend/tests/appearance.test.mjs) checks initial reads, later events, snapshot identity and immutability, and publishing without a browser. Run it from the repository root:

```bash
node --test frontend/tests/appearance.test.mjs
```

Those tests validate HostID's publisher. A consuming client must separately test initial loading, theme changes, hide/show, document navigation, and its native bridge.
