import { DocumentStore, type StoreChangeEvent } from '../model/documentStore';
import { escapeHtml, sanitizeInlineHtml } from '../model/sanitize';
import type { Block, BlockType, TextAlign } from '../model/types';
import {
  applyInlineFormat,
  detectMarkdownBlockTrigger,
  type InlineFormatAction,
  queryActiveFormats,
  tryInlineMarkdownConversion,
  type ActiveFormatState,
} from './formatting';
import {
  getCaretOffsetInElement,
  isCaretOnFirstVisualLine,
  isCaretOnLastVisualLine,
  setCaretOffsetInElement,
  splitHtmlAtCaret,
} from './selectionUtils';

export interface SlashTriggerState {
  open: boolean;
  blockId: string;
  query: string;
  rect: DOMRect | null;
}

export interface SelectionToolbarState {
  visible: boolean;
  blockId: string;
  blockType: BlockType;
  blockAlign: TextAlign;
  formats: ActiveFormatState;
  rect: DOMRect | null;
}

export interface VirtualRendererCallbacks {
  onSlashStateChange: (state: SlashTriggerState) => void;
  onSlashKeyDown: (e: KeyboardEvent) => boolean;
  onSelectionToolbarChange: (state: SelectionToolbarState) => void;
  onLatencySample: (ms: number) => void;
  onActiveHeadingChange: (headingId: string | null) => void;
  onTypingActivity: () => void;
}

const OVERSCAN = 14;

function estimateBlockHeight(block: Block): number {
  switch (block.type) {
    case 'heading1':
      return 64;
    case 'heading2':
      return 48;
    case 'heading3':
      return 38;
    case 'divider':
      return 32;
    case 'code-block': {
      const lines = Math.max(1, block.text.split('\n').length);
      return 36 + lines * 22;
    }
    case 'blockquote':
      return Math.max(44, Math.ceil(Math.max(1, block.charCount) / 72) * 28 + 16);
    default: {
      const lines = Math.max(1, Math.ceil(Math.max(1, block.charCount) / 82));
      return lines * 28 + 12;
    }
  }
}

export class VirtualDocumentRenderer {
  private store: DocumentStore;
  private scrollContainer: HTMLElement;
  private pageSurface: HTMLElement;
  private spacerEl: HTMLElement;
  private viewportEl: HTMLElement;
  private callbacks: VirtualRendererCallbacks;

  private heights: Float64Array = new Float64Array(0);
  private offsets: Float64Array = new Float64Array(1);
  private capacity = 0;
  private count = 0;

  private mountedNodes = new Map<string, HTMLElement>();
  private renderedStart = 0;
  private renderedEnd = -1;
  private activeBlockId: string | null = null;
  private slashActiveBlockId: string | null = null;

  private rafRenderScheduled = false;
  private rafOffsetsScheduled = false;
  private resizeObserver: ResizeObserver;
  private unsubscribeStore: () => void;
  private selectionCheckTimer: number | null = null;

  constructor(
    store: DocumentStore,
    scrollContainer: HTMLElement,
    pageSurface: HTMLElement,
    callbacks: VirtualRendererCallbacks
  ) {
    this.store = store;
    this.scrollContainer = scrollContainer;
    this.pageSurface = pageSurface;
    this.callbacks = callbacks;

    this.spacerEl = document.createElement('div');
    this.spacerEl.className = 'vw-virtual-spacer';

    this.viewportEl = document.createElement('div');
    this.viewportEl.className = 'vw-virtual-viewport';

    this.spacerEl.appendChild(this.viewportEl);
    this.pageSurface.appendChild(this.spacerEl);

    this.resizeObserver = new ResizeObserver((entries) => {
      let changed = false;
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const el = entry.target as HTMLElement;
        const blockId = el.dataset.blockId;
        if (!blockId) continue;
        const idx = this.store.getBlockIndex(blockId);
        if (idx < 0 || idx >= this.count) continue;
        const measured =
          entry.borderBoxSize && entry.borderBoxSize.length > 0
            ? entry.borderBoxSize[0].blockSize
            : entry.contentRect.height;
        if (measured > 0 && Math.abs(this.heights[idx] - measured) > 0.5) {
          this.heights[idx] = measured;
          changed = true;
        }
      }
      if (changed) {
        this.scheduleOffsetRecompute();
      }
    });

    this.bindEvents();
    this.unsubscribeStore = this.store.subscribe((ev) => this.handleStoreEvent(ev));
    this.resetMetricsAndRender();
  }

  destroy(): void {
    this.unsubscribeStore();
    this.resizeObserver.disconnect();
    this.scrollContainer.removeEventListener('scroll', this.handleScroll);
    document.removeEventListener('selectionchange', this.handleSelectionChange);
  }

  private bindEvents(): void {
    this.scrollContainer.addEventListener('scroll', this.handleScroll, { passive: true });
    document.addEventListener('selectionchange', this.handleSelectionChange);

    this.pageSurface.addEventListener('click', (e) => {
      if (e.target === this.pageSurface || e.target === this.spacerEl) {
        const blocks = this.store.getBlocks();
        if (blocks.length > 0) {
          const last = blocks[blocks.length - 1];
          this.focusBlock(last.id, last.text.length);
        }
      }
    });
  }

  private handleScroll = (): void => {
    this.scheduleRenderWindow();
  };

  private handleSelectionChange = (): void => {
    if (this.selectionCheckTimer !== null) {
      window.clearTimeout(this.selectionCheckTimer);
    }
    this.selectionCheckTimer = window.setTimeout(() => {
      this.selectionCheckTimer = null;
      this.emitSelectionToolbarState();
    }, 30);
  };

  private emitSelectionToolbarState(): void {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      this.callbacks.onSelectionToolbarChange({
        visible: false,
        blockId: this.activeBlockId ?? '',
        blockType: 'paragraph',
        blockAlign: 'left',
        formats: {
          bold: false,
          italic: false,
          underline: false,
          strike: false,
          code: false,
          highlight: false,
          link: false,
        },
        rect: null,
      });
      return;
    }

    const range = sel.getRangeAt(0);
    if (!this.viewportEl.contains(range.commonAncestorContainer)) {
      this.callbacks.onSelectionToolbarChange({
        visible: false,
        blockId: '',
        blockType: 'paragraph',
        blockAlign: 'left',
        formats: {
          bold: false,
          italic: false,
          underline: false,
          strike: false,
          code: false,
          highlight: false,
          link: false,
        },
        rect: null,
      });
      return;
    }

    const blockEl = this.findBlockWrapper(range.startContainer);
    if (!blockEl) return;
    const blockId = blockEl.dataset.blockId ?? '';
    const block = this.store.getBlockById(blockId);
    if (!block || block.type === 'code-block' || block.type === 'divider') {
      return;
    }

    const editable = blockEl.querySelector<HTMLElement>('.vw-block-content');
    if (!editable) return;

    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;

    this.callbacks.onSelectionToolbarChange({
      visible: true,
      blockId,
      blockType: block.type,
      blockAlign: block.align ?? 'left',
      formats: queryActiveFormats(editable),
      rect,
    });
  }

  private findBlockWrapper(node: Node | null): HTMLElement | null {
    let curr: Node | null = node;
    while (curr && curr !== this.viewportEl) {
      if (
        curr.nodeType === Node.ELEMENT_NODE &&
        (curr as HTMLElement).classList.contains('vw-block')
      ) {
        return curr as HTMLElement;
      }
      curr = curr.parentNode;
    }
    return null;
  }

  private handleStoreEvent(ev: StoreChangeEvent): void {
    switch (ev.kind) {
      case 'load':
      case 'block-replace-all':
        this.resetMetricsAndRender();
        break;
      case 'settings':
        this.applyDocumentSettings();
        this.scheduleOffsetRecompute();
        break;
      case 'block-insert':
        this.insertHeightSlot(ev.blockIndex ?? this.count);
        this.recomputeOffsets();
        this.renderWindow(true);
        break;
      case 'block-delete':
        if (ev.blockId) {
          const el = this.mountedNodes.get(ev.blockId);
          if (el) {
            this.resizeObserver.unobserve(el);
            el.remove();
            this.mountedNodes.delete(ev.blockId);
          }
        }
        this.removeHeightSlot(ev.blockIndex ?? 0);
        this.recomputeOffsets();
        this.renderWindow(true);
        break;
      case 'block-type':
      case 'block-align':
        if (ev.blockId) {
          this.syncSingleBlockDom(ev.blockId, true);
          this.refreshOrderedListNumbers();
        }
        break;
      case 'block-content':
        if (ev.blockId && ev.fromExternal) {
          this.syncSingleBlockDom(ev.blockId, true);
        }
        break;
      default:
        break;
    }
  }

  applyDocumentSettings(): void {
    const { pageMode, margins, font } = this.store.getDocument().settings;
    this.pageSurface.dataset.pageMode = pageMode;
    this.pageSurface.dataset.margins = margins;
    this.pageSurface.dataset.font = font;
  }

  private ensureCapacity(n: number): void {
    if (n <= this.capacity) return;
    const nextCap = Math.max(64, n * 2);
    const nextHeights = new Float64Array(nextCap);
    const nextOffsets = new Float64Array(nextCap + 1);
    nextHeights.set(this.heights.subarray(0, this.count));
    this.heights = nextHeights;
    this.offsets = nextOffsets;
    this.capacity = nextCap;
  }

  private insertHeightSlot(index: number): void {
    const blocks = this.store.getBlocks();
    this.ensureCapacity(blocks.length);
    for (let i = this.count; i > index; i--) {
      this.heights[i] = this.heights[i - 1];
    }
    this.heights[index] = estimateBlockHeight(blocks[index]);
    this.count = blocks.length;
  }

  private removeHeightSlot(index: number): void {
    const blocks = this.store.getBlocks();
    for (let i = index; i < blocks.length; i++) {
      this.heights[i] = this.heights[i + 1];
    }
    this.count = blocks.length;
  }

  private resetMetricsAndRender(): void {
    for (const el of this.mountedNodes.values()) {
      this.resizeObserver.unobserve(el);
      el.remove();
    }
    this.mountedNodes.clear();
    this.renderedStart = 0;
    this.renderedEnd = -1;

    const blocks = this.store.getBlocks();
    this.count = blocks.length;
    this.ensureCapacity(this.count);
    for (let i = 0; i < this.count; i++) {
      this.heights[i] = estimateBlockHeight(blocks[i]);
    }
    this.applyDocumentSettings();
    this.recomputeOffsets();
    this.renderWindow(true);
  }

  private recomputeOffsets(): void {
    let acc = 0;
    this.offsets[0] = 0;
    for (let i = 0; i < this.count; i++) {
      acc += this.heights[i];
      this.offsets[i + 1] = acc;
    }
    const minHeight = Math.max(acc + 220, 960);
    this.spacerEl.style.height = `${minHeight}px`;
    if (this.renderedStart < this.count) {
      this.viewportEl.style.transform = `translate3d(0, ${this.offsets[this.renderedStart]}px, 0)`;
    }
  }

  private scheduleOffsetRecompute(): void {
    if (this.rafOffsetsScheduled) return;
    this.rafOffsetsScheduled = true;
    requestAnimationFrame(() => {
      this.rafOffsetsScheduled = false;
      this.recomputeOffsets();
      this.renderWindow(false);
    });
  }

  private scheduleRenderWindow(): void {
    if (this.rafRenderScheduled) return;
    this.rafRenderScheduled = true;
    requestAnimationFrame(() => {
      this.rafRenderScheduled = false;
      this.renderWindow(false);
    });
  }

  private findIndexAtOffset(y: number): number {
    if (this.count === 0) return 0;
    let lo = 0;
    let hi = this.count - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.offsets[mid + 1] <= y) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    return lo;
  }

  private renderWindow(forceSyncOrder: boolean): void {
    const blocks = this.store.getBlocks();
    if (blocks.length === 0) return;

    const surfaceTop = this.pageSurface.offsetTop;
    const rawScroll = Math.max(0, this.scrollContainer.scrollTop - surfaceTop);
    const viewportHeight = this.scrollContainer.clientHeight || 800;

    const firstVisible = this.findIndexAtOffset(rawScroll);
    const lastVisible = this.findIndexAtOffset(rawScroll + viewportHeight);

    const start = Math.max(0, firstVisible - OVERSCAN);
    const end = Math.min(blocks.length - 1, lastVisible + OVERSCAN);

    this.updateActiveHeading(firstVisible);

    if (!forceSyncOrder && start === this.renderedStart && end === this.renderedEnd) {
      return;
    }

    const activeSet = new Set<string>();
    for (let i = start; i <= end; i++) {
      activeSet.add(blocks[i].id);
    }

    // Never unmount the block currently holding keyboard focus while typing
    if (this.activeBlockId && !activeSet.has(this.activeBlockId)) {
      const activeIdx = this.store.getBlockIndex(this.activeBlockId);
      if (activeIdx >= 0 && Math.abs(activeIdx - firstVisible) < 40) {
        activeSet.add(this.activeBlockId);
      }
    }

    // Unmount out-of-window blocks
    for (const [id, el] of this.mountedNodes) {
      if (!activeSet.has(id)) {
        this.resizeObserver.unobserve(el);
        el.remove();
        this.mountedNodes.delete(id);
      }
    }

    // Mount & order blocks in [start..end] without touching unchanged existing nodes
    let cursorNode: ChildNode | null = this.viewportEl.firstChild;
    for (let i = start; i <= end; i++) {
      const block = blocks[i];
      let el = this.mountedNodes.get(block.id);
      if (!el) {
        el = this.createBlockElement(block, i);
        this.mountedNodes.set(block.id, el);
        this.resizeObserver.observe(el);
      } else if (block.type === 'numbered-list') {
        const marker = el.querySelector<HTMLElement>('.vw-list-marker');
        if (marker) {
          marker.textContent = `${this.store.getNumberedListIndex(i)}.`;
        }
      }

      if (el !== cursorNode) {
        this.viewportEl.insertBefore(el, cursorNode);
      } else {
        cursorNode = cursorNode.nextSibling;
      }
    }

    this.renderedStart = start;
    this.renderedEnd = end;
    this.viewportEl.style.transform = `translate3d(0, ${this.offsets[start]}px, 0)`;
  }

  private updateActiveHeading(firstVisibleIndex: number): void {
    const outline = this.store.getOutline();
    let activeId: string | null = null;
    for (let i = 0; i < outline.length; i++) {
      if (outline[i].blockIndex <= firstVisibleIndex + 1) {
        activeId = outline[i].id;
      } else {
        break;
      }
    }
    this.callbacks.onActiveHeadingChange(activeId);
  }

  private refreshOrderedListNumbers(): void {
    for (let i = this.renderedStart; i <= this.renderedEnd; i++) {
      const block = this.store.getBlockAt(i);
      if (!block || block.type !== 'numbered-list') continue;
      const el = this.mountedNodes.get(block.id);
      const marker = el?.querySelector<HTMLElement>('.vw-list-marker');
      if (marker) {
        marker.textContent = `${this.store.getNumberedListIndex(i)}.`;
      }
    }
  }

  private createBlockElement(block: Block, index: number): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = `vw-block vw-block--${block.type}`;
    wrapper.dataset.blockId = block.id;
    wrapper.dataset.blockType = block.type;
    if (block.align && block.align !== 'left') {
      wrapper.style.textAlign = block.align;
    }

    this.populateBlockInner(wrapper, block, index);
    return wrapper;
  }

  private populateBlockInner(wrapper: HTMLElement, block: Block, index: number): void {
    wrapper.innerHTML = '';
    wrapper.className = `vw-block vw-block--${block.type}`;
    wrapper.dataset.blockType = block.type;
    wrapper.style.textAlign = block.align && block.align !== 'left' ? block.align : '';

    if (block.type === 'divider') {
      const hr = document.createElement('hr');
      hr.className = 'vw-divider';
      wrapper.tabIndex = 0;
      wrapper.appendChild(hr);
      wrapper.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' || e.key === 'Delete') {
          e.preventDefault();
          const idx = this.store.getBlockIndex(block.id);
          this.store.deleteBlock(block.id);
          const prev = this.store.getBlockAt(Math.max(0, idx - 1));
          if (prev) this.focusBlock(prev.id, prev.text.length);
        } else if (e.key === 'Enter') {
          e.preventDefault();
          const inserted = this.store.insertBlockAfter(block.id, 'paragraph', '');
          this.focusBlock(inserted.id, 0);
        }
      });
      return;
    }

    if (block.type === 'bullet-list') {
      const marker = document.createElement('span');
      marker.className = 'vw-list-marker vw-list-marker--bullet';
      marker.contentEditable = 'false';
      marker.textContent = '•';
      wrapper.appendChild(marker);
    } else if (block.type === 'numbered-list') {
      const marker = document.createElement('span');
      marker.className = 'vw-list-marker vw-list-marker--number';
      marker.contentEditable = 'false';
      marker.textContent = `${this.store.getNumberedListIndex(index)}.`;
      wrapper.appendChild(marker);
    }

    const editable = document.createElement('div');
    editable.className = 'vw-block-content';
    editable.contentEditable = 'true';
    editable.spellcheck = block.type !== 'code-block';
    editable.dataset.placeholder = this.placeholderForType(block.type);

    if (block.type === 'code-block') {
      editable.textContent = block.text;
    } else {
      editable.innerHTML = block.html;
    }

    editable.addEventListener('focus', () => {
      this.activeBlockId = block.id;
      wrapper.classList.add('is-focused');
    });

    editable.addEventListener('blur', () => {
      wrapper.classList.remove('is-focused');
    });

    editable.addEventListener('input', () => {
      this.handleBlockInput(block.id, editable);
    });

    editable.addEventListener('keydown', (e) => {
      this.handleBlockKeyDown(e, block.id, editable);
    });

    editable.addEventListener('paste', (e) => {
      this.handleBlockPaste(e, block.id, editable);
    });

    wrapper.appendChild(editable);
  }

  private placeholderForType(type: BlockType): string {
    switch (type) {
      case 'heading1':
        return 'Heading 1';
      case 'heading2':
        return 'Heading 2';
      case 'heading3':
        return 'Heading 3';
      case 'blockquote':
        return 'Write a quote…';
      case 'code-block':
        return 'Write code… (Cmd/Ctrl+Enter to exit)';
      case 'bullet-list':
      case 'numbered-list':
        return 'List item';
      default:
        return 'Type / for commands…';
    }
  }

  private syncSingleBlockDom(blockId: string, restoreFocus = false): void {
    const idx = this.store.getBlockIndex(blockId);
    if (idx < 0) return;
    const block = this.store.getBlockAt(idx);
    const wrapper = this.mountedNodes.get(blockId);
    if (!block || !wrapper) return;

    const wasFocused = restoreFocus && this.activeBlockId === blockId;
    const prevEditable = wrapper.querySelector<HTMLElement>('.vw-block-content');
    const savedOffset = prevEditable ? getCaretOffsetInElement(prevEditable).offset : 0;

    this.populateBlockInner(wrapper, block, idx);

    if (wasFocused && block.type !== 'divider') {
      const nextEditable = wrapper.querySelector<HTMLElement>('.vw-block-content');
      if (nextEditable) {
        nextEditable.focus({ preventScroll: true });
        setCaretOffsetInElement(nextEditable, Math.min(savedOffset, block.text.length));
      }
    }
  }

  private handleBlockInput(blockId: string, editable: HTMLElement): void {
    const t0 = performance.now();
    this.callbacks.onTypingActivity();

    const block = this.store.getBlockById(blockId);
    if (!block) return;

    const plainText = editable.textContent ?? '';

    // 1. Check Markdown block triggers (e.g., "# ", "- ", "```", "---")
    const mdTrigger = detectMarkdownBlockTrigger(block.type, plainText);
    if (mdTrigger) {
      if (mdTrigger.newType === 'divider') {
        this.store.setBlockType(blockId, 'divider', '');
        const next = this.store.insertBlockAfter(blockId, 'paragraph', '');
        this.focusBlock(next.id, 0);
      } else {
        this.store.setBlockType(
          blockId,
          mdTrigger.newType,
          mdTrigger.newType === 'code-block'
            ? mdTrigger.remainderText
            : escapeHtml(mdTrigger.remainderText)
        );
        this.focusBlock(blockId, mdTrigger.remainderText.length);
      }
      this.closeSlashMenu();
      this.callbacks.onLatencySample(performance.now() - t0);
      return;
    }

    // 2. Check inline Markdown shortcuts (**bold**, *italic*, `code`, ==highlight==)
    if (block.type !== 'code-block') {
      tryInlineMarkdownConversion(editable);
    }

    // 3. Persist block content to store in O(1)
    const content = block.type === 'code-block' ? editable.textContent ?? '' : editable.innerHTML;
    const updatedText = editable.textContent ?? '';
    this.store.updateBlockContent(blockId, content, updatedText, false);

    // 4. Slash command detection
    if (block.type !== 'code-block') {
      this.evaluateSlashTrigger(blockId, editable);
    }

    this.callbacks.onLatencySample(performance.now() - t0);
  }

  private evaluateSlashTrigger(blockId: string, editable: HTMLElement): void {
    const caret = getCaretOffsetInElement(editable);
    const textBeforeCaret = (editable.textContent ?? '').slice(0, caret.offset);
    const match = /(?:^|\s)\/([a-z0-9-]*)$/i.exec(textBeforeCaret);

    if (match) {
      const sel = window.getSelection();
      let rect: DOMRect | null = null;
      if (sel && sel.rangeCount > 0) {
        rect = sel.getRangeAt(0).getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) {
          rect = editable.getBoundingClientRect();
        }
      }
      this.slashActiveBlockId = blockId;
      this.callbacks.onSlashStateChange({
        open: true,
        blockId,
        query: match[1] ?? '',
        rect,
      });
    } else if (this.slashActiveBlockId === blockId) {
      this.closeSlashMenu();
    }
  }

  closeSlashMenu(): void {
    if (this.slashActiveBlockId !== null) {
      this.slashActiveBlockId = null;
      this.callbacks.onSlashStateChange({
        open: false,
        blockId: '',
        query: '',
        rect: null,
      });
    }
  }

  applySlashCommand(blockId: string, targetType: BlockType): void {
    const block = this.store.getBlockById(blockId);
    const wrapper = this.mountedNodes.get(blockId);
    if (!block || !wrapper) return;

    const editable = wrapper.querySelector<HTMLElement>('.vw-block-content');
    let cleanedText = block.text;
    if (editable) {
      const caret = getCaretOffsetInElement(editable);
      const raw = editable.textContent ?? '';
      const before = raw.slice(0, caret.offset).replace(/(?:^|\s)\/[a-z0-9-]*$/i, (m) =>
        m.startsWith(' ') ? ' ' : ''
      );
      const after = raw.slice(caret.offset);
      cleanedText = (before + after).trim();
    }

    this.closeSlashMenu();

    if (targetType === 'divider') {
      if (cleanedText.length > 0) {
        this.store.updateBlockContent(blockId, escapeHtml(cleanedText), cleanedText, true);
        const divBlock = this.store.insertBlockAfter(blockId, 'divider', '');
        const afterBlock = this.store.insertBlockAfter(divBlock.id, 'paragraph', '');
        this.focusBlock(afterBlock.id, 0);
      } else {
        this.store.setBlockType(blockId, 'divider', '');
        const afterBlock = this.store.insertBlockAfter(blockId, 'paragraph', '');
        this.focusBlock(afterBlock.id, 0);
      }
      return;
    }

    this.store.setBlockType(
      blockId,
      targetType,
      targetType === 'code-block' ? cleanedText : escapeHtml(cleanedText)
    );
    this.focusBlock(blockId, cleanedText.length);
  }

  private handleBlockKeyDown(
    e: KeyboardEvent,
    blockId: string,
    editable: HTMLElement
  ): void {
    const t0 = performance.now();

    if (this.slashActiveBlockId === blockId) {
      if (this.callbacks.onSlashKeyDown(e)) {
        return;
      }
    }

    const block = this.store.getBlockById(blockId);
    if (!block) return;
    const mod = e.metaKey || e.ctrlKey;

    // Inline formatting shortcuts
    if (mod && !e.altKey) {
      const key = e.key.toLowerCase();
      if (key === 'b') {
        e.preventDefault();
        this.formatSelection('bold');
        this.callbacks.onLatencySample(performance.now() - t0);
        return;
      }
      if (key === 'i') {
        e.preventDefault();
        this.formatSelection('italic');
        this.callbacks.onLatencySample(performance.now() - t0);
        return;
      }
      if (key === 'u') {
        e.preventDefault();
        this.formatSelection('underline');
        this.callbacks.onLatencySample(performance.now() - t0);
        return;
      }
      if (key === 'e') {
        e.preventDefault();
        this.formatSelection('code');
        this.callbacks.onLatencySample(performance.now() - t0);
        return;
      }
      if (key === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          this.store.redo();
        } else {
          this.store.undo();
        }
        return;
      }
    }

    // Tab inside code block inserts 2 spaces
    if (e.key === 'Tab' && block.type === 'code-block') {
      e.preventDefault();
      document.execCommand('insertText', false, '  ');
      return;
    }

    // Enter handling
    if (e.key === 'Enter') {
      if (block.type === 'code-block') {
        if (mod || e.shiftKey) {
          e.preventDefault();
          const next = this.store.insertBlockAfter(blockId, 'paragraph', '');
          this.focusBlock(next.id, 0);
        }
        return;
      }

      if (e.shiftKey) {
        return;
      }

      e.preventDefault();
      this.closeSlashMenu();

      if (
        (block.type === 'bullet-list' || block.type === 'numbered-list' || block.type === 'blockquote') &&
        (editable.textContent ?? '').trim() === ''
      ) {
        this.store.setBlockType(blockId, 'paragraph', '');
        this.focusBlock(blockId, 0);
        return;
      }

      const { beforeHtml, afterHtml } = splitHtmlAtCaret(editable);
      const cleanBefore = sanitizeInlineHtml(beforeHtml);
      const cleanAfter = sanitizeInlineHtml(afterHtml);

      editable.innerHTML = cleanBefore;
      this.store.updateBlockContent(blockId, cleanBefore, editable.textContent ?? '', false);

      const nextType: BlockType =
        block.type === 'bullet-list' || block.type === 'numbered-list'
          ? block.type
          : 'paragraph';

      const newBlock = this.store.insertBlockAfter(blockId, nextType, cleanAfter);
      this.focusBlock(newBlock.id, 0);
      this.callbacks.onLatencySample(performance.now() - t0);
      return;
    }

    // Backspace at start of block
    if (e.key === 'Backspace') {
      const caret = getCaretOffsetInElement(editable);
      if (caret.isAtStart) {
        if (block.type !== 'paragraph') {
          e.preventDefault();
          this.store.setBlockType(blockId, 'paragraph', block.type === 'code-block' ? escapeHtml(block.text) : block.html);
          this.focusBlock(blockId, 0);
          return;
        }
        const idx = this.store.getBlockIndex(blockId);
        if (idx > 0) {
          e.preventDefault();
          const prev = this.store.getBlockAt(idx - 1);
          if (!prev) return;
          if (prev.type === 'divider') {
            this.store.deleteBlock(prev.id);
            this.focusBlock(blockId, 0);
            return;
          }
          const mergeOffset = prev.text.length;
          const mergedHtml =
            prev.type === 'code-block'
              ? prev.text + block.text
              : prev.html + block.html;
          this.store.updateBlockContent(prev.id, mergedHtml, undefined, true);
          this.store.deleteBlock(blockId);
          this.focusBlock(prev.id, mergeOffset);
        }
      }
      return;
    }

    // Cross-block vertical arrow navigation
    if (e.key === 'ArrowUp' && !e.shiftKey) {
      if (isCaretOnFirstVisualLine(editable)) {
        const idx = this.store.getBlockIndex(blockId);
        if (idx > 0) {
          e.preventDefault();
          let targetIdx = idx - 1;
          while (targetIdx > 0 && this.store.getBlockAt(targetIdx)?.type === 'divider') {
            targetIdx--;
          }
          const prev = this.store.getBlockAt(targetIdx);
          if (prev && prev.type !== 'divider') {
            this.focusBlock(prev.id, prev.text.length);
          }
        }
      }
    } else if (e.key === 'ArrowDown' && !e.shiftKey) {
      if (isCaretOnLastVisualLine(editable)) {
        const idx = this.store.getBlockIndex(blockId);
        if (idx < this.store.getBlockCount() - 1) {
          e.preventDefault();
          let targetIdx = idx + 1;
          while (
            targetIdx < this.store.getBlockCount() - 1 &&
            this.store.getBlockAt(targetIdx)?.type === 'divider'
          ) {
            targetIdx++;
          }
          const next = this.store.getBlockAt(targetIdx);
          if (next && next.type !== 'divider') {
            this.focusBlock(next.id, 0);
          }
        }
      }
    }
  }

  private handleBlockPaste(
    e: ClipboardEvent,
    blockId: string,
    editable: HTMLElement
  ): void {
    e.preventDefault();
    const block = this.store.getBlockById(blockId);
    if (!block) return;

    const plain = e.clipboardData?.getData('text/plain') ?? '';
    if (block.type === 'code-block') {
      document.execCommand('insertText', false, plain);
      this.handleBlockInput(blockId, editable);
      return;
    }

    const lines = plain.split(/\r?\n/).filter((l, i, arr) => l.length > 0 || (i > 0 && i < arr.length - 1));
    if (lines.length <= 1) {
      const html = e.clipboardData?.getData('text/html');
      const clean = html ? sanitizeInlineHtml(html) : escapeHtml(plain);
      document.execCommand('insertHTML', false, clean);
      this.handleBlockInput(blockId, editable);
      return;
    }

    // Multi-paragraph paste: split into clean blocks
    document.execCommand('insertText', false, lines[0]);
    this.handleBlockInput(blockId, editable);

    let lastId = blockId;
    for (let i = 1; i < lines.length; i++) {
      const created = this.store.insertBlockAfter(lastId, 'paragraph', escapeHtml(lines[i]));
      lastId = created.id;
    }
    this.focusBlock(lastId, lines[lines.length - 1].length);
  }

  formatSelection(action: InlineFormatAction, url?: string): void {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const wrapper = this.findBlockWrapper(sel.getRangeAt(0).commonAncestorContainer);
    if (!wrapper) return;
    const blockId = wrapper.dataset.blockId;
    if (!blockId) return;
    const editable = wrapper.querySelector<HTMLElement>('.vw-block-content');
    if (!editable) return;

    applyInlineFormat(editable, action, url);
    const clean = sanitizeInlineHtml(editable.innerHTML);
    this.store.updateBlockContent(blockId, clean, editable.textContent ?? '', false);
    this.emitSelectionToolbarState();
  }

  setBlockTypeFromToolbar(blockId: string, type: BlockType): void {
    this.store.setBlockType(blockId, type);
    this.emitSelectionToolbarState();
  }

  setBlockAlignFromToolbar(blockId: string, align: TextAlign): void {
    this.store.setBlockAlign(blockId, align);
    this.emitSelectionToolbarState();
  }

  scrollToBlockIndex(index: number, shouldFocus = false): void {
    const clamped = Math.max(0, Math.min(index, this.count - 1));
    const targetTop = Math.max(0, this.pageSurface.offsetTop + this.offsets[clamped] - 72);
    this.scrollContainer.scrollTo({ top: targetTop, behavior: 'smooth' });

    if (shouldFocus) {
      const block = this.store.getBlockAt(clamped);
      if (block) {
        window.setTimeout(() => this.focusBlock(block.id, 0), 180);
      }
    }
  }

  focusBlock(blockId: string, offset = 0): void {
    const idx = this.store.getBlockIndex(blockId);
    if (idx < 0) return;

    // Ensure target block is inside the virtualized viewport
    let wrapper = this.mountedNodes.get(blockId);
    if (!wrapper) {
      const targetTop = Math.max(0, this.pageSurface.offsetTop + this.offsets[idx] - 140);
      this.scrollContainer.scrollTop = targetTop;
      this.renderWindow(true);
      wrapper = this.mountedNodes.get(blockId);
    }

    if (!wrapper) return;
    const editable = wrapper.querySelector<HTMLElement>('.vw-block-content');
    if (editable) {
      editable.focus({ preventScroll: false });
      setCaretOffsetInElement(editable, offset);
      this.activeBlockId = blockId;
    } else {
      wrapper.focus();
    }
  }
}
