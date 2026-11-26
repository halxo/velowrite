# VeloWrite

An ultra-fast, local-first Google Docs alternative engineered for **sub-16ms input latency**, instant startup, and locked **60–120fps** scrolling across 100-page manuscripts — packaged as native **Windows (`.exe`), macOS (`.dmg`), and Linux (`.AppImage` / `.deb`)** desktop applications with a built-in **GitHub Releases auto-updater**.

## Download Desktop Installers (`v1.2.0`)

Download the latest installers from **[GitHub Releases](https://github.com/halxo/velowrite/releases/latest)**:

- **Windows (x64)**: `VeloWrite-Setup-1.2.0.exe` — NSIS installer with Desktop/Start Menu shortcuts, `.md` & `.velowrite` file associations, uninstaller, and automatic background updates.
- **macOS (Universal Apple Silicon + Intel)**: `VeloWrite-1.2.0-universal.dmg`
- **Linux (x64)**: `VeloWrite-1.2.0.AppImage` and `velowrite_1.2.0_amd64.deb`

## Key Capabilities

- **Virtualized 100-Page Canvas**: `Float64Array` prefix-sum height cache + `O(log N)` viewport binary search + `ResizeObserver` batching keeps ~40–55 DOM nodes mounted even on 50,000-word manuscripts.
- **Multi-Document Tabs & Split Reference View**: Open multiple local documents in tabs (`Ctrl+Tab`) or read a reference document / live preview side-by-side (`Ctrl/Cmd+Alt+\`).
- **Rich Blocks & Technical Writing**: Headings, bullet/numbered lists, interactive checklists (`[] `), callouts (`! `), collapsible toggles (`>> `), editable tables (`/table`), display LaTeX math equations (`$$` / `/math`), local IndexedDB images (`/image` or paste/drop), and zero-DOM-mutation syntax-highlighted code blocks.
- **Universal Export & Native Disk I/O**: Open & save `.md` / `.velowrite` / `.json` directly on disk (`Ctrl/Cmd+O`, `Ctrl/Cmd+S`) and export to **PDF**, **DOCX**, **EPUB 3.0**, **Standalone HTML**, **Markdown**, or **JSON**.
- **Version Snapshots, Visual Diff & Folder Sync**: Save local checkpoints in IndexedDB with word-level visual diffs, and mirror manuscripts atomically to iCloud, OneDrive, Dropbox, or Syncthing folders.

## Development & Automated Verification

```bash
npm install
npm test             # Run Vitest unit, exporter, and 50k-word latency benchmark suite
npm run dev          # Launch Vite web dev server
npm run build        # Type-check and build production bundle
```

Push a version tag (e.g. `git tag v1.2.1 && git push origin v1.2.1`) to run the test suite and publish Windows, macOS, and Linux installers automatically via GitHub Actions.
