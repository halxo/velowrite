# VeloWrite

An ultra-fast, local-first Google Docs alternative engineered for **sub-16ms input latency**, instant startup, and locked **60–120fps** scrolling across 100-page manuscripts.

## Architecture

- **Document Data Model (`src/model/`)**: Block-oriented schema with `O(1)` ID-to-index lookup, `O(1)` incremental word/character/reading-time counters, cached heading outline, and coalesced undo/redo history.
- **Virtualized Rendering Engine (`src/editor/`)**: Windowed virtual DOM backed by a `Float64Array` prefix-sum height cache, `O(log N)` binary search viewport slicing, `ResizeObserver` height tracking, and `requestAnimationFrame`-batched transforms.
- **IndexedDB Storage & Exporters (`src/storage/`)**: Zero-latency optimistic autosave flushed during `requestIdleCallback`, plus zero-dependency **Markdown (`.md`)**, **Word (`.docx`)**, and **JSON (`.json`)** exporters.

## Getting Started

```bash
npm install
npm run dev
```

Build for production:

```bash
npm run build
```

## Keyboard Shortcuts

- `Cmd/Ctrl + K` — Command Palette (actions, exports, themes, margins, typography, 100-page benchmark, recent docs)
- `Cmd/Ctrl + \` — Toggle Outline & Documents sidebar
- `/` — Slash Command menu for inserting headings, lists, quotes, code blocks, and dividers
- `Cmd/Ctrl + B / I / U / E` — Bold, Italic, Underline, Inline Code
- `Cmd/Ctrl + Z` / `Cmd/Ctrl + Shift + Z` — Undo / Redo
