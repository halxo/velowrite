import { DocumentStore } from '../model/documentStore';
import { escapeHtml } from '../model/sanitize';

export interface SearchMatch {
  blockId: string;
  blockIndex: number;
  start: number;
  end: number;
}

export interface FindReplaceCallbacks {
  onJumpToBlock: (blockIndex: number) => void;
  onRefreshHighlights: (query: string, caseSensitive: boolean, useRegex: boolean) => void;
}

export class FindReplaceBar {
  private el: HTMLDivElement;
  private findInput: HTMLInputElement;
  private replaceInput: HTMLInputElement;
  private replaceRow: HTMLDivElement;
  private countEl: HTMLSpanElement;
  private caseBtn: HTMLButtonElement;
  private regexBtn: HTMLButtonElement;

  private store: DocumentStore;
  private callbacks: FindReplaceCallbacks;

  private isOpen = false;
  private caseSensitive = false;
  private useRegex = false;
  private matches: SearchMatch[] = [];
  private activeMatchIndex = -1;

  constructor(store: DocumentStore, callbacks: FindReplaceCallbacks) {
    this.store = store;
    this.callbacks = callbacks;

    this.el = document.createElement('div');
    this.el.id = 'vw-find-bar';
    this.el.className = 'vw-find-bar';
    this.el.setAttribute('role', 'search');
    this.el.setAttribute('aria-label', 'Find and Replace');

    this.el.innerHTML = `
      <div class="vw-find-row">
        <input type="text" id="vw-find-input" class="vw-find-input" placeholder="Find in document…" spellcheck="false" />
        <span id="vw-find-count" class="vw-find-count">0 / 0</span>
        <button type="button" id="vw-find-case" class="vw-find-toggle" title="Match Case">Aa</button>
        <button type="button" id="vw-find-regex" class="vw-find-toggle" title="Regular Expression">.*</button>
        <button type="button" id="vw-find-prev" class="vw-find-nav" title="Previous Match (Shift+Enter)">↑</button>
        <button type="button" id="vw-find-next" class="vw-find-nav" title="Next Match (Enter)">↓</button>
        <button type="button" id="vw-find-toggle-replace" class="vw-find-toggle" title="Toggle Replace">⇄</button>
        <button type="button" id="vw-find-close" class="vw-find-nav" title="Close (Escape)">×</button>
      </div>
      <div id="vw-replace-row" class="vw-find-row vw-replace-row" hidden>
        <input type="text" id="vw-replace-input" class="vw-find-input" placeholder="Replace with…" spellcheck="false" />
        <button type="button" id="vw-replace-one" class="vw-find-action">Replace</button>
        <button type="button" id="vw-replace-all" class="vw-find-action">All</button>
      </div>
    `;

    this.findInput = this.el.querySelector('#vw-find-input') as HTMLInputElement;
    this.replaceInput = this.el.querySelector('#vw-replace-input') as HTMLInputElement;
    this.replaceRow = this.el.querySelector('#vw-replace-row') as HTMLDivElement;
    this.countEl = this.el.querySelector('#vw-find-count') as HTMLSpanElement;
    this.caseBtn = this.el.querySelector('#vw-find-case') as HTMLButtonElement;
    this.regexBtn = this.el.querySelector('#vw-find-regex') as HTMLButtonElement;

    this.bindEvents();
    document.body.appendChild(this.el);
  }

  private bindEvents(): void {
    this.findInput.addEventListener('input', () => this.recomputeMatches(true));
    this.findInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) {
          this.prevMatch();
        } else {
          this.nextMatch();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      }
    });

    this.replaceInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.replaceCurrent();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      }
    });

    this.caseBtn.addEventListener('click', () => {
      this.caseSensitive = !this.caseSensitive;
      this.caseBtn.classList.toggle('is-active', this.caseSensitive);
      this.recomputeMatches(true);
    });

    this.regexBtn.addEventListener('click', () => {
      this.useRegex = !this.useRegex;
      this.regexBtn.classList.toggle('is-active', this.useRegex);
      this.recomputeMatches(true);
    });

    this.el.querySelector('#vw-find-prev')?.addEventListener('click', () => this.prevMatch());
    this.el.querySelector('#vw-find-next')?.addEventListener('click', () => this.nextMatch());
    this.el.querySelector('#vw-find-close')?.addEventListener('click', () => this.close());
    this.el.querySelector('#vw-find-toggle-replace')?.addEventListener('click', () => {
      this.replaceRow.hidden = !this.replaceRow.hidden;
    });
    this.el.querySelector('#vw-replace-one')?.addEventListener('click', () => this.replaceCurrent());
    this.el.querySelector('#vw-replace-all')?.addEventListener('click', () => this.replaceAll());
  }

  open(withReplace = false): void {
    this.isOpen = true;
    this.replaceRow.hidden = !withReplace;
    this.el.classList.add('is-visible');
    const sel = window.getSelection()?.toString().trim();
    if (sel && sel.length < 120 && !sel.includes('\n')) {
      this.findInput.value = sel;
    }
    this.recomputeMatches(false);
    requestAnimationFrame(() => {
      this.findInput.focus();
      this.findInput.select();
    });
  }

  close(): void {
    this.isOpen = false;
    this.el.classList.remove('is-visible');
    this.matches = [];
    this.activeMatchIndex = -1;
    this.callbacks.onRefreshHighlights('', false, false);
  }

  getQueryState(): { query: string; caseSensitive: boolean; useRegex: boolean } {
    if (!this.isOpen) return { query: '', caseSensitive: false, useRegex: false };
    return {
      query: this.findInput.value,
      caseSensitive: this.caseSensitive,
      useRegex: this.useRegex,
    };
  }

  private buildRegex(query: string): RegExp | null {
    if (!query) return null;
    try {
      const pattern = this.useRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(pattern, this.caseSensitive ? 'g' : 'gi');
    } catch {
      return null;
    }
  }

  private recomputeMatches(jumpToFirst: boolean): void {
    const query = this.findInput.value;
    const regex = this.buildRegex(query);
    this.matches = [];
    this.activeMatchIndex = -1;

    if (!regex) {
      this.countEl.textContent = '0 / 0';
      this.callbacks.onRefreshHighlights('', false, false);
      return;
    }

    const blocks = this.store.getBlocks();
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (!b.text) continue;
      regex.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = regex.exec(b.text)) !== null) {
        if (m[0].length === 0) {
          regex.lastIndex++;
          continue;
        }
        this.matches.push({
          blockId: b.id,
          blockIndex: i,
          start: m.index,
          end: m.index + m[0].length,
        });
      }
    }

    if (this.matches.length > 0) {
      this.activeMatchIndex = 0;
      if (jumpToFirst) {
        this.callbacks.onJumpToBlock(this.matches[0].blockIndex);
      }
    }
    this.updateCountDisplay();
    this.callbacks.onRefreshHighlights(query, this.caseSensitive, this.useRegex);
  }

  private updateCountDisplay(): void {
    if (this.matches.length === 0) {
      this.countEl.textContent = '0 / 0';
    } else {
      this.countEl.textContent = `${this.activeMatchIndex + 1} / ${this.matches.length}`;
    }
  }

  nextMatch(): void {
    if (this.matches.length === 0) return;
    this.activeMatchIndex = (this.activeMatchIndex + 1) % this.matches.length;
    this.updateCountDisplay();
    this.callbacks.onJumpToBlock(this.matches[this.activeMatchIndex].blockIndex);
  }

  prevMatch(): void {
    if (this.matches.length === 0) return;
    this.activeMatchIndex =
      (this.activeMatchIndex - 1 + this.matches.length) % this.matches.length;
    this.updateCountDisplay();
    this.callbacks.onJumpToBlock(this.matches[this.activeMatchIndex].blockIndex);
  }

  private replaceCurrent(): void {
    if (this.matches.length === 0 || this.activeMatchIndex < 0) return;
    const match = this.matches[this.activeMatchIndex];
    const block = this.store.getBlockById(match.blockId);
    if (!block) return;

    const replacement = this.replaceInput.value;
    const updatedText =
      block.text.slice(0, match.start) + replacement + block.text.slice(match.end);
    const updatedHtml =
      block.type === 'code-block' ? updatedText : escapeHtml(updatedText);

    this.store.replaceAllTextInBlock(block.id, updatedHtml, updatedText);
    this.recomputeMatches(false);
  }

  private replaceAll(): void {
    const regex = this.buildRegex(this.findInput.value);
    if (!regex) return;
    const replacement = this.replaceInput.value;
    const blocks = this.store.getBlocks();

    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (!b.text) continue;
      regex.lastIndex = 0;
      if (!regex.test(b.text)) continue;
      regex.lastIndex = 0;
      const updatedText = b.text.replace(regex, replacement);
      const updatedHtml = b.type === 'code-block' ? updatedText : escapeHtml(updatedText);
      this.store.replaceAllTextInBlock(b.id, updatedHtml, updatedText);
    }
    this.recomputeMatches(false);
  }
}
