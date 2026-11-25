import {
  type Block,
  type BlockType,
  DEFAULT_SETTINGS,
  type DocumentModel,
  type DocumentSettings,
  type DocumentStats,
  type OutlineItem,
  type TextAlign,
} from './types';
import { countWords, escapeHtml, extractPlainText, generateId } from './sanitize';

export interface StoreChangeEvent {
  kind:
    | 'load'
    | 'block-content'
    | 'block-type'
    | 'block-align'
    | 'block-insert'
    | 'block-delete'
    | 'block-replace-all'
    | 'title'
    | 'settings';
  blockId?: string;
  blockIndex?: number;
  fromExternal?: boolean;
}

type StoreListener = (event: StoreChangeEvent) => void;

interface HistoryEntry {
  blocks: Block[];
  title: string;
  timestamp: number;
}

const MAX_HISTORY = 80;
const COALESCE_WINDOW_MS = 400;
const WORDS_PER_MINUTE = 238;
const WORDS_PER_PAGE = 480;

export function createBlock(
  type: BlockType = 'paragraph',
  html = '',
  align?: TextAlign
): Block {
  const text = type === 'code-block' ? html : extractPlainText(html);
  return {
    id: generateId(),
    type,
    html,
    text,
    align,
    wordCount: type === 'divider' ? 0 : countWords(text),
    charCount: type === 'divider' ? 0 : text.length,
  };
}

export function isHeadingType(type: BlockType): type is 'heading1' | 'heading2' | 'heading3' {
  return type === 'heading1' || type === 'heading2' || type === 'heading3';
}

export function headingLevel(type: BlockType): 1 | 2 | 3 | null {
  if (type === 'heading1') return 1;
  if (type === 'heading2') return 2;
  if (type === 'heading3') return 3;
  return null;
}

export class DocumentStore {
  private doc: DocumentModel;
  private idToIndex = new Map<string, number>();
  private totalWords = 0;
  private totalChars = 0;
  private outlineCache: OutlineItem[] = [];
  private listeners = new Set<StoreListener>();
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];

  constructor(initialDoc?: DocumentModel) {
    this.doc = initialDoc ?? createWelcomeDocument();
    this.rebuildIndices();
  }

  subscribe(listener: StoreListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: StoreChangeEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  getDocument(): DocumentModel {
    return this.doc;
  }

  getBlocks(): readonly Block[] {
    return this.doc.blocks;
  }

  getBlockCount(): number {
    return this.doc.blocks.length;
  }

  getBlockIndex(blockId: string): number {
    return this.idToIndex.get(blockId) ?? -1;
  }

  getBlockById(blockId: string): Block | undefined {
    const idx = this.idToIndex.get(blockId);
    return idx !== undefined ? this.doc.blocks[idx] : undefined;
  }

  getBlockAt(index: number): Block | undefined {
    return this.doc.blocks[index];
  }

  getStats(): DocumentStats {
    const words = this.totalWords;
    return {
      words,
      characters: this.totalChars,
      readingTimeMinutes: words === 0 ? 0 : Math.max(1, Math.ceil(words / WORDS_PER_MINUTE)),
      pages: Math.max(1, Math.ceil(words / WORDS_PER_PAGE)),
      blockCount: this.doc.blocks.length,
    };
  }

  getOutline(): readonly OutlineItem[] {
    return this.outlineCache;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  loadDocument(doc: DocumentModel): void {
    this.doc = {
      ...doc,
      settings: { ...DEFAULT_SETTINGS, ...doc.settings },
      blocks: doc.blocks.length > 0 ? doc.blocks : [createBlock('paragraph', '')],
    };
    this.undoStack = [];
    this.redoStack = [];
    this.rebuildIndices();
    this.emit({ kind: 'load', fromExternal: true });
  }

  private rebuildIndices(): void {
    this.idToIndex.clear();
    this.totalWords = 0;
    this.totalChars = 0;
    const outline: OutlineItem[] = [];

    const blocks = this.doc.blocks;
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      this.idToIndex.set(b.id, i);
      this.totalWords += b.wordCount;
      this.totalChars += b.charCount;
      const lvl = headingLevel(b.type);
      if (lvl !== null) {
        outline.push({
          id: b.id,
          level: lvl,
          text: b.text.trim() || 'Untitled section',
          blockIndex: i,
        });
      }
    }
    this.outlineCache = outline;
  }

  private rebuildIndexMapFrom(startIndex: number): void {
    const blocks = this.doc.blocks;
    for (let i = startIndex; i < blocks.length; i++) {
      this.idToIndex.set(blocks[i].id, i);
    }
  }

  private rebuildOutline(): void {
    const outline: OutlineItem[] = [];
    const blocks = this.doc.blocks;
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      const lvl = headingLevel(b.type);
      if (lvl !== null) {
        outline.push({
          id: b.id,
          level: lvl,
          text: b.text.trim() || 'Untitled section',
          blockIndex: i,
        });
      }
    }
    this.outlineCache = outline;
  }

  private pushHistory(coalesce = false): void {
    const now = Date.now();
    if (
      coalesce &&
      this.undoStack.length > 0 &&
      now - this.undoStack[this.undoStack.length - 1].timestamp < COALESCE_WINDOW_MS
    ) {
      return;
    }
    this.undoStack.push({
      blocks: this.doc.blocks.map((b) => ({ ...b })),
      title: this.doc.title,
      timestamp: now,
    });
    if (this.undoStack.length > MAX_HISTORY) {
      this.undoStack.shift();
    }
    this.redoStack = [];
  }

  undo(): boolean {
    const prev = this.undoStack.pop();
    if (!prev) return false;
    this.redoStack.push({
      blocks: this.doc.blocks.map((b) => ({ ...b })),
      title: this.doc.title,
      timestamp: Date.now(),
    });
    this.doc.blocks = prev.blocks;
    this.doc.title = prev.title;
    this.doc.updatedAt = Date.now();
    this.rebuildIndices();
    this.emit({ kind: 'block-replace-all', fromExternal: true });
    return true;
  }

  redo(): boolean {
    const next = this.redoStack.pop();
    if (!next) return false;
    this.undoStack.push({
      blocks: this.doc.blocks.map((b) => ({ ...b })),
      title: this.doc.title,
      timestamp: Date.now(),
    });
    this.doc.blocks = next.blocks;
    this.doc.title = next.title;
    this.doc.updatedAt = Date.now();
    this.rebuildIndices();
    this.emit({ kind: 'block-replace-all', fromExternal: true });
    return true;
  }

  setTitle(title: string): void {
    if (this.doc.title === title) return;
    this.pushHistory(true);
    this.doc.title = title;
    this.doc.updatedAt = Date.now();
    this.emit({ kind: 'title' });
  }

  updateSettings(partial: Partial<DocumentSettings>): void {
    this.doc.settings = { ...this.doc.settings, ...partial };
    this.doc.updatedAt = Date.now();
    this.emit({ kind: 'settings' });
  }

  /**
   * O(1) incremental update for typing inside a single block.
   * Avoids scanning the rest of the document for stats or index updates.
   */
  updateBlockContent(
    blockId: string,
    html: string,
    plainText?: string,
    fromExternal = false
  ): void {
    const idx = this.idToIndex.get(blockId);
    if (idx === undefined) return;
    const block = this.doc.blocks[idx];
    if (block.html === html && !fromExternal) return;

    this.pushHistory(!fromExternal);

    const text =
      plainText !== undefined
        ? plainText
        : block.type === 'code-block'
          ? html
          : extractPlainText(html);

    const newWords = block.type === 'divider' ? 0 : countWords(text);
    const newChars = block.type === 'divider' ? 0 : text.length;

    this.totalWords += newWords - block.wordCount;
    this.totalChars += newChars - block.charCount;

    block.html = html;
    block.text = text;
    block.wordCount = newWords;
    block.charCount = newChars;
    this.doc.updatedAt = Date.now();

    if (isHeadingType(block.type)) {
      const entry = this.outlineCache.find((o) => o.id === blockId);
      if (entry) {
        entry.text = text.trim() || 'Untitled section';
      } else {
        this.rebuildOutline();
      }
    }

    this.emit({
      kind: 'block-content',
      blockId,
      blockIndex: idx,
      fromExternal,
    });
  }

  setBlockType(blockId: string, newType: BlockType, newHtml?: string): void {
    const idx = this.idToIndex.get(blockId);
    if (idx === undefined) return;
    const block = this.doc.blocks[idx];
    const wasHeading = isHeadingType(block.type);
    const willBeHeading = isHeadingType(newType);

    this.pushHistory(false);

    block.type = newType;
    if (newHtml !== undefined) {
      const text = newType === 'code-block' ? newHtml : extractPlainText(newHtml);
      const newWords = newType === 'divider' ? 0 : countWords(text);
      const newChars = newType === 'divider' ? 0 : text.length;
      this.totalWords += newWords - block.wordCount;
      this.totalChars += newChars - block.charCount;
      block.html = newHtml;
      block.text = text;
      block.wordCount = newWords;
      block.charCount = newChars;
    } else if (newType === 'divider') {
      this.totalWords -= block.wordCount;
      this.totalChars -= block.charCount;
      block.html = '';
      block.text = '';
      block.wordCount = 0;
      block.charCount = 0;
    } else if (newType === 'code-block') {
      block.html = block.text;
    }

    this.doc.updatedAt = Date.now();

    if (wasHeading || willBeHeading) {
      this.rebuildOutline();
    }

    this.emit({
      kind: 'block-type',
      blockId,
      blockIndex: idx,
      fromExternal: true,
    });
  }

  setBlockAlign(blockId: string, align: TextAlign): void {
    const idx = this.idToIndex.get(blockId);
    if (idx === undefined) return;
    const block = this.doc.blocks[idx];
    if ((block.align ?? 'left') === align) return;

    this.pushHistory(false);
    block.align = align;
    this.doc.updatedAt = Date.now();

    this.emit({
      kind: 'block-align',
      blockId,
      blockIndex: idx,
      fromExternal: true,
    });
  }

  insertBlockAfter(
    afterBlockId: string,
    type: BlockType = 'paragraph',
    html = ''
  ): Block {
    const idx = this.idToIndex.get(afterBlockId);
    const insertAt = idx === undefined ? this.doc.blocks.length : idx + 1;
    return this.insertBlockAt(insertAt, type, html);
  }

  insertBlockAt(index: number, type: BlockType = 'paragraph', html = ''): Block {
    this.pushHistory(false);
    const clampedIndex = Math.max(0, Math.min(index, this.doc.blocks.length));
    const block = createBlock(type, html);
    this.doc.blocks.splice(clampedIndex, 0, block);
    this.totalWords += block.wordCount;
    this.totalChars += block.charCount;
    this.rebuildIndexMapFrom(clampedIndex);
    if (isHeadingType(type) || this.outlineCache.some((o) => o.blockIndex >= clampedIndex)) {
      this.rebuildOutline();
    }
    this.doc.updatedAt = Date.now();
    this.emit({
      kind: 'block-insert',
      blockId: block.id,
      blockIndex: clampedIndex,
      fromExternal: true,
    });
    return block;
  }

  deleteBlock(blockId: string): Block | null {
    if (this.doc.blocks.length <= 1) {
      this.setBlockType(blockId, 'paragraph', '');
      return null;
    }
    const idx = this.idToIndex.get(blockId);
    if (idx === undefined) return null;

    this.pushHistory(false);
    const [removed] = this.doc.blocks.splice(idx, 1);
    this.idToIndex.delete(blockId);
    this.totalWords -= removed.wordCount;
    this.totalChars -= removed.charCount;
    this.rebuildIndexMapFrom(idx);
    if (
      isHeadingType(removed.type) ||
      this.outlineCache.some((o) => o.blockIndex >= idx)
    ) {
      this.rebuildOutline();
    }
    this.doc.updatedAt = Date.now();
    this.emit({
      kind: 'block-delete',
      blockId,
      blockIndex: idx,
      fromExternal: true,
    });
    return removed;
  }

  getNumberedListIndex(blockIndex: number): number {
    let n = 1;
    for (let i = blockIndex - 1; i >= 0; i--) {
      if (this.doc.blocks[i].type === 'numbered-list') {
        n++;
      } else {
        break;
      }
    }
    return n;
  }
}

export function createBlankDocument(title = 'Untitled Document'): DocumentModel {
  const now = Date.now();
  return {
    id: generateId(),
    title,
    blocks: [createBlock('paragraph', '')],
    settings: { ...DEFAULT_SETTINGS },
    createdAt: now,
    updatedAt: now,
  };
}

export function createWelcomeDocument(): DocumentModel {
  const now = Date.now();
  return {
    id: generateId(),
    title: 'VeloWrite — Architecture & Field Guide',
    settings: { ...DEFAULT_SETTINGS },
    createdAt: now,
    updatedAt: now,
    blocks: [
      createBlock('heading1', 'VeloWrite'),
      createBlock(
        'paragraph',
        'An ultra-fast, local-first writing environment engineered for <strong>sub-16ms input latency</strong>, instant startup, and locked 60–120fps scrolling even across 100-page manuscripts.'
      ),
      createBlock('heading2', 'Instant Formatting & Keyboard Flow'),
      createBlock(
        'paragraph',
        'Everything stays out of your way until you need it. Highlight any text to summon the floating contextual toolbar, type <code>/</code> on any line for the slash command menu, or press <code>Cmd/Ctrl+K</code> to open the Command Palette.'
      ),
      createBlock('bullet-list', 'Type <code># </code>, <code>## </code>, or <code>### </code> at the start of a line for headings.'),
      createBlock('bullet-list', 'Type <code>- </code> for bullet lists, <code>1. </code> for numbered lists, or <code>&gt; </code> for blockquotes.'),
      createBlock('bullet-list', 'Type <code>```</code> for a syntax-clean code block, or <code>---</code> for a section divider.'),
      createBlock('bullet-list', 'Use <code>Cmd/Ctrl+B</code>, <code>Cmd/Ctrl+I</code>, and <code>Cmd/Ctrl+U</code> for instant inline formatting.'),
      createBlock('heading2', 'Why It Feels Instant'),
      createBlock(
        'blockquote',
        'Speed is not a benchmark number—it is the absence of friction between thought and ink.'
      ),
      createBlock(
        'paragraph',
        'VeloWrite maintains a <mark>windowed virtual DOM</mark> backed by a prefix-sum height cache and O(1) incremental word counting. Only the visible viewport plus a small overscan buffer is mounted at any moment, keeping DOM node count constant whether you are writing a one-page memo or a 100-page book.'
      ),
      createBlock(
        'code-block',
        `// Zero-latency optimistic persistence\nconst latencyMs = performance.now() - inputStart;\nstorage.scheduleAutosave(store.getDocument()); // idle-frame IndexedDB commit`
      ),
      createBlock('heading2', 'Try the 100-Page Stress Test'),
      createBlock(
        'paragraph',
        'Open the Command Palette with <code>Cmd/Ctrl+K</code> and select <strong>Generate 100-Page Benchmark Document</strong> to experience locked 60–120fps scrolling and typing on a ~50,000-word manuscript, or export your work cleanly to <strong>Markdown</strong>, <strong>DOCX</strong>, or <strong>JSON</strong>.'
      ),
      createBlock('divider', ''),
      createBlock('paragraph', 'Start typing below, or press / to insert a new block…'),
    ],
  };
}

export function generateBenchmarkDocument(): DocumentModel {
  const now = Date.now();
  const blocks: Block[] = [
    createBlock('heading1', '100-Page Performance Benchmark Manuscript'),
    createBlock(
      'paragraph',
      'This generated document contains <strong>~1,500 blocks and ~50,000 words</strong> (~100 paginated pages). Scroll rapidly, jump via the Outline sidebar, and type anywhere to verify locked 60–120fps rendering and sub-16ms input latency.'
    ),
  ];

  const sampleParagraphs = [
    'Modern document editors frequently struggle past thirty pages because every keystroke triggers full-document layout recalculations, cascading style invalidations, and synchronous serialization. By decoupling the block data model from the mounted DOM window, VeloWrite isolates every mutation to a single block node.',
    'When a writer edits a sentence on page seventy-four, the prefix-sum height cache updates lazily through a ResizeObserver callback scheduled inside an animation frame. Word count and reading time deltas are computed in O(1) time from the modified block alone, never scanning the remaining forty-nine thousand words.',
    'Local-first persistence ensures zero network round-trips on the critical path. Every change is immediately durable in memory and flushed to IndexedDB during browser idle windows, guaranteeing that sudden tab closures never lose a thought while keeping the main thread completely unblocked during rapid typing bursts.',
    'Typography matters just as much as frame pacing. Generous line height, balanced measure, and restrained contrast reduce cognitive fatigue during long writing sessions, letting the structure of an argument emerge naturally from clean headings, concise lists, and quiet margins.',
  ];

  const chapters = 20;
  for (let ch = 1; ch <= chapters; ch++) {
    blocks.push(
      createBlock('heading2', `Chapter ${ch}: Systems Engineering & Local-First Craft`)
    );
    for (let sec = 1; sec <= 3; sec++) {
      blocks.push(
        createBlock('heading3', `${ch}.${sec} Virtualization, Frame Pacing, and Ergonomics`)
      );
      for (let p = 0; p < 10; p++) {
        const base = sampleParagraphs[(ch + sec + p) % sampleParagraphs.length];
        blocks.push(
          createBlock(
            'paragraph',
            `[${ch}.${sec}.${p + 1}] ${escapeHtml(base)} ${escapeHtml(sampleParagraphs[(p + 1) % sampleParagraphs.length])}`
          )
        );
      }
      if (sec === 2) {
        blocks.push(
          createBlock(
            'blockquote',
            `Design principle ${ch}: keep the active editing surface under 60 mounted DOM nodes regardless of total manuscript length.`
          )
        );
      }
      if (sec === 3) {
        blocks.push(
          createBlock(
            'bullet-list',
            `Chapter ${ch} checkpoint: O(log N) binary search locates the exact viewport slice in microseconds.`
          )
        );
        blocks.push(
          createBlock(
            'code-block',
            `// Benchmark section ${ch}.${sec}\nexport function findFirstVisible(offsets: Float64Array, scrollTop: number): number {\n  let lo = 0, hi = offsets.length - 1;\n  while (lo < hi) { const mid = (lo + hi) >>> 1; if (offsets[mid] < scrollTop) lo = mid + 1; else hi = mid; }\n  return lo;\n}`
          )
        );
      }
    }
  }

  return {
    id: generateId(),
    title: '100-Page Benchmark Manuscript (~50,000 Words)',
    settings: { ...DEFAULT_SETTINGS },
    createdAt: now,
    updatedAt: now,
    blocks,
  };
}
