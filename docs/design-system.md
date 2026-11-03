[Documentation](./README.md) · **English** · [简体中文](./zh-CN/design-system.md)

# Design system

HostID has two visual layouts built on one set of semantic theme tokens. This guide explains where to make changes and which behaviors to preserve. The linked source files define the current palettes, dimensions, and component behavior.

## Source map

| Concern | Source of truth |
| --- | --- |
| Theme types, presets, resolution, layout classes | [themes/index.ts](../frontend/src/themes/index.ts) |
| Applying CSS variables and persisting the choice | [ThemeContext.tsx](../frontend/src/contexts/ThemeContext.tsx) |
| Shared controls, modern shell, mailbox, responsive rules | [index.css](../frontend/src/index.css) |
| Classic layout overrides | [classic-shell.css](../frontend/src/styles/classic-shell.css), [classic-mailbox.css](../frontend/src/styles/classic-mailbox.css), [classic-reading.css](../frontend/src/styles/classic-reading.css) |
| Appearance picker | [ThemeSelector.tsx](../frontend/src/components/ThemeSelector.tsx), [theme-selector.css](../frontend/src/styles/theme-selector.css) |
| Profile and administration surfaces | [profile.css](../frontend/src/styles/profile.css), [admin-settings.css](../frontend/src/styles/admin-settings.css) |
| Host appearance publishing | [appearance.ts](../frontend/src/lib/appearance.ts) |

Use `useTheme()` from the theme context. [lib/theme.ts](../frontend/src/lib/theme.ts) is a deprecated helper and is not the theme application path.

## Semantic tokens

`ThemeContext` applies the selected theme to `document.documentElement`. Components consume CSS variables rather than copying palette values into each screen.

| Token family | Role |
| --- | --- |
| `--color-bg-primary` | Workspace and page background |
| `--color-bg-secondary` | Panels, cards, and dialogs |
| `--color-bg-tertiary`, `--color-bg-hover` | Subtle and interactive surfaces |
| `--color-text-primary`, `--color-text-secondary` | Main text and supporting content |
| `--color-text-tertiary`, `--color-text-quaternary`, `--color-text-muted` | Metadata and quieter content |
| `--color-border-primary`, `--color-border-secondary` | Surface boundaries and controls |
| `--color-accent-primary`, `--color-accent-secondary` | Primary actions and their alternate state |
| `--color-accent-muted`, `--color-accent-text` | Selection backgrounds and text on an accent |
| `--color-code-*`, `--color-pre-*` | Inline code and code blocks |

The `:root` values in `index.css` provide the initial light palette; `ThemeContext` applies the resolved preset. Keep these defaults aligned when changing that palette. Scrollbar colors are derived in CSS from the semantic tokens.

For a new surface, reuse the existing components or semantic classes:

```tsx
<section
  className="card p-6"
  style={{ color: 'var(--color-text-primary)' }}
>
  <h2 className="text-lg font-semibold">Account settings</h2>
  <p style={{ color: 'var(--color-text-secondary)' }}>
    Manage your profile and sign-in options.
  </p>
  <button type="button" className="btn-primary mt-4">
    Save changes
  </button>
</section>
```

Status and destructive-action colors can have their own semantics. Check them against every affected palette rather than assuming that an accent token is appropriate for errors.

## Theme selection and layout

There are currently **10 presets**, plus the **Match system** selection mode:

| Layout | Preset IDs |
| --- | --- |
| Modern workspace | `light`, `dark`, `sakura`, `starry-night`, `forest`, `ocean`, `sunset`, `lavender` |
| Classic | `classic`, `classic-dark` |

The `layout` field defaults to `workspace`; the two classic presets set it to `classic`. Each preset also declares `colorScheme`. A theme therefore controls both its palette and, where specified, its layout.

- The choice is stored locally under `theme_mode`.
- An unset choice defaults to `system`, which follows `prefers-color-scheme` and resolves to modern `light` or `dark`.
- An explicit preset stays selected when the operating system changes appearance.
- An unknown preset resolves to `getDefaultTheme()`.
- The provider replaces `theme-*`, `design-*`, and `system-*` classes when applying a theme; consumers should not add competing layout markers.

The appearance picker groups Modern and Classic choices, previews both layouts, and applies a choice immediately. It uses an anchored panel on larger screens and a modal sheet below 600 px. See its source for radio-group navigation, focus restoration, and viewport positioning.

The theme model also supports optional background metadata and custom CSS. Adding a preset is a source change; the picker does not provide a user theme-file import interface.

## Workspace behavior

[Layout.tsx](../frontend/src/components/Layout.tsx), [Sidebar.tsx](../frontend/src/components/Sidebar.tsx), and [Inbox.tsx](../frontend/src/pages/Inbox.tsx) coordinate the shell and reading area:

- Split view keeps the message list and reader side by side on wider screens. List view opens a selected message in a dialog.
- Below 768 px, the list uses the available width and message details open in a dialog, including when split view is selected.
- Below 1024 px, navigation becomes a drawer. Wider screens support pinned and compact sidebar states.
- The splitter supports pointer dragging, arrow keys, Home, and End. Its limits come from [mailLayout.ts](../frontend/src/lib/mailLayout.ts), including a 300 px minimum, a 600 px ceiling, and room reserved for the reader.
- List width, list/split choice, and sidebar preference are saved locally. Modern and classic list widths use separate storage keys.

Keep `min-width: 0` and `min-height: 0` on flexible containers where needed so that scrolling and truncation remain inside their intended panels. Test long subjects, recipient lists, and narrow readers before adjusting widths.

## Shared components and interaction

| Area | Reuse and preserve |
| --- | --- |
| Actions and forms | `.btn-primary`, `.btn-secondary`, `.input-field`, `.card`; use `type="button"` for actions that must not submit a form |
| Message rows | [EmailList.tsx](../frontend/src/components/EmailList.tsx): selection state, unread indicators, keyboard row navigation, compact and classic variants |
| Reading | [EmailDetail.tsx](../frontend/src/components/EmailDetail.tsx), [EmailEnvelope.tsx](../frontend/src/components/EmailEnvelope.tsx), [MailReadingActions.tsx](../frontend/src/components/MailReadingActions.tsx) |
| Writing | [ComposeEmail.tsx](../frontend/src/components/ComposeEmail.tsx), [RecipientInput.tsx](../frontend/src/components/RecipientInput.tsx), [RichTextEditor.tsx](../frontend/src/components/RichTextEditor.tsx) |
| Confirmation | [ConfirmDialog.tsx](../frontend/src/components/ConfirmDialog.tsx): cancel-first focus, pending/error state, explicit destructive action |
| Profile dialogs | [ProfileDialog.tsx](../frontend/src/components/ProfileDialog.tsx): named dialogs, focus containment, busy state, restoration |

Use the existing system-font stack and Lucide icons. Keep icon-only actions named with accessible labels; a decorative icon does not replace a button's name. Prefer the nearby component's spacing and typography over introducing a separate scale.

## Focus and accessibility

- Preserve visible keyboard focus, the shell's skip link, field labels, and dialog titles.
- [modalStack.ts](../frontend/src/lib/modalStack.ts) determines which visible modal owns focus and when its trigger can receive focus again. Reuse it when dialogs can overlap.
- Escape handling and focus containment belong to the active dialog. Do not let a background dialog consume its keyboard events.
- Keep failure messages actionable and use the existing `alert`, `status`, `aria-busy`, and selection semantics where appropriate.
- Respect `prefers-reduced-motion`; `index.css` reduces global transitions and animations, and the appearance picker has its own reduced-motion rule.

The theme tests cover specific classic foreground/background contrast pairs. They do not certify every screen or preset; inspect new text, controls, errors, and selected states in context.

## Document canvas and email content

The `html`, `body`, and `#root` backgrounds remain transparent for WebView hosts. Application surfaces paint their own backgrounds. Native control appearance is applied through `--app-color-scheme` on the body, while the root keeps `color-scheme: normal`.

After applying a theme, the provider publishes its primary background for embedding hosts. Use the [appearance contract](./embedding.md) instead of inferring it from DOM classes.

HTML email is a separate rendering surface. Sender styles are isolated from the application and are not recolored to match dark mode. See [email rendering](./email-rendering.md) before changing message-body CSS.

## Making and checking a change

1. Change palette values and theme metadata in `themes/index.ts`; keep the initial CSS defaults aligned if the light preset changes.
2. Extend the appropriate modern or classic stylesheet and reuse shared controls.
3. Check modern light/dark, both classic layouts, one colored preset, and Match system.
4. Check narrow screens, long content, keyboard-only use, overlapping dialogs, and reduced motion.
5. Run the relevant checks from the repository root:

```bash
npm --prefix frontend run typecheck
npm run test --workspace=frontend
```

Relevant regression files include [themes.test.mjs](../frontend/tests/themes.test.mjs), [mail-layout.test.mjs](../frontend/tests/mail-layout.test.mjs), [modal-stack.test.mjs](../frontend/tests/modal-stack.test.mjs), and [appearance.test.mjs](../frontend/tests/appearance.test.mjs). Browser layout changes also need visual inspection; Node tests do not exercise the complete interface.
