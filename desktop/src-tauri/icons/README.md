# Icon Generation

The approved colored source is [`frontend/public/logo-stylized.png`](../../../frontend/public/logo-stylized.png). Regenerate the complete desktop, Windows, iOS, and Android icon suite from the repository root:

```sh
npm run tauri --workspace=desktop -- icon ../frontend/public/logo-stylized.png
```

npm runs the command from the `desktop` workspace, so the input path is relative to that directory. Generated `icon.png`, PNG sizes, `icon.icns`, and `icon.ico` are outputs, not source files.

The previous black source and app icon are preserved in [`design/brand`](../../../design/brand/README.md), including `banana-black-final.svg` and `banana-black-app-icon.svg`.
