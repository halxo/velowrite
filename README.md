# VeloWrite

An ultra-fast, local-first Google Docs alternative engineered for **sub-16ms input latency**, instant startup, and locked **60–120fps** scrolling across 100-page manuscripts — packaged as a native **Windows desktop `.exe` app** with a built-in **GitHub Releases auto-updater**.

## Download Desktop App (Windows `.exe`)

Download the latest installer from **[GitHub Releases](https://github.com/halxo/velowrite/releases/latest)**:

- **Windows Installer**: `VeloWrite-Setup-1.0.0.exe` (includes desktop & Start Menu shortcuts, uninstaller, and automatic background updates from `halxo/velowrite`)

## Built-in Auto-Updater

VeloWrite checks `https://github.com/halxo/velowrite/releases` automatically on startup (and every 4 hours) using `electron-updater`. When a new release is published:

1. The update downloads quietly in the background with a live progress pill.
2. Once ready, click **Restart & Update** (or restart VeloWrite later to install automatically).
3. You can also trigger a manual check anytime from the Command Palette (`Ctrl+K` → **Check for Updates (GitHub)**).

## Architecture

- **Document Data Model (`src/model/`)**: Block-oriented schema with `O(1)` ID-to-index lookup, `O(1)` incremental word/character/reading-time counters, cached heading outline, and coalesced undo/redo history.
- **Virtualized Rendering Engine (`src/editor/`)**: Windowed virtual DOM backed by a `Float64Array` prefix-sum height cache, `O(log N)` binary search viewport slicing, `ResizeObserver` height tracking, and `requestAnimationFrame`-batched transforms.
- **IndexedDB Storage & Exporters (`src/storage/`)**: Zero-latency optimistic autosave flushed during `requestIdleCallback`, plus zero-dependency **Markdown (`.md`)**, **Word (`.docx`)**, and **JSON (`.json`)** exporters.
- **Desktop Shell & Auto-Updater (`electron/`)**: Context-isolated Electron main/preload architecture with single-instance locking and `electron-updater` GitHub Releases integration.

## Development & Release

```bash
npm install
npm run dev          # Run web dev server
npm run dist:win     # Build Windows NSIS .exe installer locally
```

Push a version tag (e.g. `git tag v1.0.1 && git push origin v1.0.1`) to automatically build and publish a new Windows `.exe` release via GitHub Actions.
