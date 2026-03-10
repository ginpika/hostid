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
