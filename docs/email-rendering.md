[Documentation](./README.md) · **English** · [简体中文](./zh-CN/email-rendering.md)

# Email rendering and compatibility

HostID aims to display common static HTML email in a modern browser while keeping sender styles separate from the application. Compatibility is defined by the parser, sanitizer, renderer, and regression fixtures below; it does not imply support for every email template or identical output in every browser engine.

## Rendering path

1. SMTP reception and EML import use MailParser. [getParsedEmailBody](../backend/src/lib/parsed-email-body.ts) prefers the HTML alternative, then the parser's escaped HTML representation of plain text, then plain text itself. [parseEmailFile](../backend/src/lib/parse-email-file.ts) reads EML as bytes so the parser can decode each part using its declared charset and transfer encoding.
2. Stored bodies do not have a separate MIME-type field. [mailContent.ts](../frontend/src/lib/mailContent.ts) infers HTML, Markdown, or plain text, including older messages. A complete HTML document or a fragment starting with a tag takes priority over Markdown examples inside it.
3. [EmailBody.tsx](../frontend/src/components/EmailBody.tsx) renders HTML in a `srcdoc` iframe, Markdown through Marked followed by DOMPurify, and plain text with preserved whitespace.
4. [htmlEmail.ts](../frontend/src/lib/htmlEmail.ts) sanitizes the complete HTML document, preserving allowed head and body styles. Its low-specificity defaults precede the sender's styles rather than replacing them.

New MIME `text/plain` messages use escaped HTML when available. Literal tags, Markdown headings, asterisks, and line breaks therefore remain text rather than becoming formatting. Historical stored bodies still depend on heuristic detection.

## Covered behavior

| Area | Current implementation and regression coverage |
| --- | --- |
| Sender styles | Head `<style>`, inline styles, media queries, `style[media]`, body classes and supported legacy body color attributes |
| Tables | Nested layouts, explicit dimensions, alignment, cell spacing, row/column spans, `col[span]`, and table header associations; no blanket cell-padding override |
| Content | Common semantic sections, figures/captions, quotations, ruby text, bidirectional text attributes, soft breaks, and hidden preheaders |
| Lists | Ordered-list start, reversal, and individual item values |
| Images | Remote images, `img[src]` data URIs, parsed MIME CID images, `picture/source`, ordinary URL `srcset/sizes`, and image maps |
| Image dimensions | Explicit heights are preserved for spacer/cropped images; images without a height receive a responsive fallback |
| Links | External links and image-map areas open outside the reader with `noopener noreferrer`; fragment links scroll within the message |
| Height | The iframe expands for content and body margins, shrinks after long messages, and remeasures after images, fonts, or disclosure widgets change |
| MIME fixtures | GB18030 and UTF-8; 8bit and quoted-printable parts; HTML alternatives and base64 CID images |

The HTML renderer uses `ResizeObserver` and explicit remeasurement for `<details>` toggles. It resets the iframe height before measuring to avoid retaining an earlier long message's height through percentage-height sender styles.

## Sanitization and boundaries

The HTML iframe enables `allow-same-origin`, `allow-popups`, and `allow-popups-to-escape-sandbox`; it does **not** enable scripts. DOMPurify removes elements and attributes outside the allowlist, including scripts, inline event handlers, forms, nested iframes, `<base>`, and refresh metadata.

- Inline SVG, audio/video, and external `<link>` stylesheets are not in the HTML allowlist. SVG loaded as an image is a separate case from inline SVG markup.
- Outlook-specific VML, AMP email, and script-dependent templates are outside the supported rendering path. A standard HTML fallback may still render.
- DOMPurify filters `data:` candidates in `srcset`; ordinary URL candidates and `img src="data:…"` are covered by fixtures.
- Relative resource URLs lack the sender website's original base context. Their resolution is not guaranteed.
- Sender layout and colors are preserved; HTML messages are not automatically recolored for dark mode.
- Remote images may be fetched by the browser. The renderer does not provide an image proxy or a remote-image approval control.
- Browser policy, deployed response headers, network availability, and the sender's CSS can still affect output. See [security.ts](../backend/src/middleware/security.ts) for the API/full-image response policy; separately served frontends also have their own server configuration.

### EML is not a complete backup format here

The current [EML import route](../backend/src/routes/email.ts) stores the body and message metadata but does **not** save ordinary attachments as attachment records. CID images embedded into the parsed HTML can still display.

The export route writes message headers and the stored body; it does not construct a multipart message containing attachment files. Do not use EML import/export as a promise of lossless migration or a replacement for backing up the application data volumes.

## Verification

Run unit tests from the repository root:

```bash
npm run test --workspace=frontend
npm --prefix backend test
```

Relevant tests are [mail-content.test.mjs](../frontend/tests/mail-content.test.mjs) for format inference and [parse-email-file.test.ts](../backend/tests/parse-email-file.test.ts) for MIME decoding, CID content, alternative selection, and plain-text fidelity.

The [browser harness](../frontend/tests/html-email.browser.mjs) currently contains **14 checks** using real layout and the production `EmailBody` component. It covers narrow tables, sender CSS, sanitization, responsive images, links, content switching, and height changes.

```bash
npm run dev --workspace=frontend
```

Open `/tests/html-email.browser.html` on the Vite server and inspect its PASS/FAIL output. The page ends with a summary and sets `document.body.dataset.testStatus` to `passed` or `failed`. These browser checks are separate from the Node test command and require no additional test framework.

When changing rendering, add a small fixture for the observed failure and rerun the browser harness in the target engine. A successful run in Chrome does not establish identical results in other engines.
