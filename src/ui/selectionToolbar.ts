import type { InlineFormatAction } from '../editor/formatting';
import type { SelectionToolbarState } from '../editor/virtualRenderer';
import type { BlockType, TextAlign } from '../model/types';
import { ICONS } from './icons';

export interface SelectionToolbarCallbacks {
  onFormat: (action: InlineFormatAction, url?: string) => void;
  onBlockType: (blockId: string, type: BlockType) => void;
  onAlign: (blockId: string, align: TextAlign) => void;
}

export class FloatingSelectionToolbar {
  private el: HTMLDivElement;
  private linkBar: HTMLDivElement;
  private linkInput: HTMLInputElement;
  private callbacks: SelectionToolbarCallbacks;
  private currentState: SelectionToolbarState | null = null;
  private savedRange: Range | null = null;
  private isLinkMode = false;

  constructor(callbacks: SelectionToolbarCallbacks) {
    this.callbacks = callbacks;
    this.el = document.createElement('div');
    this.el.id = 'vw-selection-toolbar';
    this.el.className = 'vw-selection-toolbar';
    this.el.setAttribute('role', 'toolbar');
    this.el.setAttribute('aria-label', 'Text formatting');

    this.el.innerHTML = `
      <div class="vw-tb-row">
        <div class="vw-tb-group">
          <button type="button" class="vw-tb-btn vw-tb-text" data-block-type="paragraph" title="Paragraph">P</button>
          <button type="button" class="vw-tb-btn vw-tb-text" data-block-type="heading1" title="Heading 1">H1</button>
          <button type="button" class="vw-tb-btn vw-tb-text" data-block-type="heading2" title="Heading 2">H2</button>
          <button type="button" class="vw-tb-btn vw-tb-text" data-block-type="heading3" title="Heading 3">H3</button>
        </div>
        <span class="vw-tb-sep"></span>
        <div class="vw-tb-group">
          <button type="button" class="vw-tb-btn" data-format="bold" title="Bold (⌘B)">${ICONS.bold}</button>
          <button type="button" class="vw-tb-btn" data-format="italic" title="Italic (⌘I)">${ICONS.italic}</button>
          <button type="button" class="vw-tb-btn" data-format="underline" title="Underline (⌘U)">${ICONS.underline}</button>
          <button type="button" class="vw-tb-btn" data-format="highlight" title="Highlight">${ICONS.highlight}</button>
          <button type="button" class="vw-tb-btn" data-format="link" title="Link">${ICONS.link}</button>
        </div>
        <span class="vw-tb-sep"></span>
        <div class="vw-tb-group">
          <button type="button" class="vw-tb-btn" data-align="left" title="Align left">${ICONS.alignLeft}</button>
          <button type="button" class="vw-tb-btn" data-align="center" title="Align center">${ICONS.alignCenter}</button>
          <button type="button" class="vw-tb-btn" data-align="right" title="Align right">${ICONS.alignRight}</button>
        </div>
      </div>
      <div class="vw-tb-link-row" hidden>
        <input type="url" class="vw-tb-link-input" placeholder="Paste or type a URL…" aria-label="Link URL" />
        <button type="button" class="vw-tb-link-apply">Apply</button>
      </div>
    `;

    this.linkBar = this.el.querySelector('.vw-tb-link-row') as HTMLDivElement;
    this.linkInput = this.el.querySelector('.vw-tb-link-input') as HTMLInputElement;

    this.bindEvents();
    document.body.appendChild(this.el);
  }

  private bindEvents(): void {
    this.el.addEventListener('mousedown', (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('.vw-tb-link-input')) {
        return;
      }
      e.preventDefault();
    });

    this.el.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (!btn || !this.currentState) return;

      const fmt = btn.dataset.format as InlineFormatAction | undefined;
      if (fmt) {
        if (fmt === 'link') {
          if (this.currentState.formats.link) {
            this.callbacks.onFormat('link');
          } else {
            this.openLinkInput();
          }
        } else {
          this.callbacks.onFormat(fmt);
        }
        return;
      }

      const blockType = btn.dataset.blockType as BlockType | undefined;
      if (blockType) {
        this.callbacks.onBlockType(this.currentState.blockId, blockType);
        return;
      }

      const align = btn.dataset.align as TextAlign | undefined;
      if (align) {
        this.callbacks.onAlign(this.currentState.blockId, align);
        return;
      }

      if (btn.classList.contains('vw-tb-link-apply')) {
        this.commitLink();
      }
    });

    this.linkInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.commitLink();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.closeLinkInput();
      }
    });
  }

  private openLinkInput(): void {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      this.savedRange = sel.getRangeAt(0).cloneRange();
    }
    this.isLinkMode = true;
    this.linkBar.hidden = false;
    this.linkInput.value = '';
    this.linkInput.focus();
  }

  private closeLinkInput(): void {
    this.isLinkMode = false;
    this.linkBar.hidden = true;
    this.savedRange = null;
  }

  private commitLink(): void {
    const url = this.linkInput.value.trim();
    if (this.savedRange) {
      const sel = window.getSelection();
      if (sel) {
        sel.removeAllRanges();
        sel.addRange(this.savedRange);
      }
    }
    this.closeLinkInput();
    if (url) {
      this.callbacks.onFormat('link', url);
    }
  }

  update(state: SelectionToolbarState): void {
    if (this.isLinkMode) return;
    this.currentState = state;

    if (!state.visible || !state.rect) {
      this.el.classList.remove('is-visible');
      return;
    }

    // Update active button states
    this.el.querySelectorAll<HTMLButtonElement>('[data-block-type]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.blockType === state.blockType);
    });
    this.el.querySelectorAll<HTMLButtonElement>('[data-format]').forEach((btn) => {
      const key = btn.dataset.format as keyof SelectionToolbarState['formats'];
      btn.classList.toggle('is-active', !!state.formats[key]);
    });
    this.el.querySelectorAll<HTMLButtonElement>('[data-align]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.align === state.blockAlign);
    });

    this.el.classList.add('is-visible');

    const tbRect = this.el.getBoundingClientRect();
    const centerX = state.rect.left + state.rect.width / 2;
    const clampedLeft = Math.max(
      12,
      Math.min(centerX - tbRect.width / 2, window.innerWidth - tbRect.width - 12)
    );
    const preferredTop = state.rect.top - tbRect.height - 10;
    const finalTop =
      preferredTop < 56 ? state.rect.bottom + 10 : preferredTop;

    this.el.style.transform = `translate3d(${Math.round(clampedLeft)}px, ${Math.round(finalTop)}px, 0)`;
  }
}
