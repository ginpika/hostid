# HostID Desktop

Tauri-based desktop client for HostID.

## Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev
```

## Build

```bash
# Build for current platform
npm run build
```

## Configuration

The desktop client supports two connection modes:

### Local Mode
Connects to a local backend server (default: `localhost:3001`). Suitable for users running the backend locally with frp for external email access.

### Remote Mode
Connects to a remote server. Enter the server URL (e.g., `https://mail.example.com`).

## Embedding in a Desktop WebView

The frontend keeps `html`, `body`, and `#root` backgrounds transparent. Theme backgrounds are painted by page components, so cards, dialogs, and other content retain their appearance. The theme's `color-scheme` is applied to `body` rather than `html` to avoid an opaque browser canvas.

The host must also enable native window/WebView transparency and set the WebView background to fully transparent RGBA `(0, 0, 0, 0)`. CSS alone cannot clear the native WebView background. The host is responsible for clipping the WebView to its window's rounded corners.

This Tauri client enables [`transparent`](https://v2.tauri.app/reference/config/#transparent) and sets [`backgroundColor`](https://v2.tauri.app/reference/config/#backgroundcolor) to `[0, 0, 0, 0]`. It also enables [`macOSPrivateApi`](https://v2.tauri.app/reference/config/#macosprivateapi) for the currently locked Tauri 2.10.2; this flag is unnecessary in Tauri 2.12.1 and later.

## Project Structure

```
desktop/
├── src-tauri/
│   ├── src/
│   │   └── main.rs      # Rust backend
│   ├── Cargo.toml       # Rust dependencies
│   └── tauri.conf.json  # Tauri configuration
└── package.json         # Node.js dependencies
```

## Requirements

- Rust 1.70+
- Node.js 18+
- Platform-specific build tools:
  - macOS: Xcode Command Line Tools
  - Windows: Visual Studio Build Tools
  - Linux: build-essential, libgtk-3-dev, libwebkit2gtk-4.0-dev
