import type { DocumentSummary, OutlineItem } from '../model/types';
import { escapeHtml } from '../model/sanitize';
import { ICONS } from './icons';

export interface SidebarCallbacks {
  onSelectHeading: (blockIndex: number) => void;
  onSelectDocument: (docId: string) => void;
  onCreateDocument: () => void;
  onDeleteDocument: (docId: string) => void;
}

function formatRelativeTime(timestamp: number): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (diffSec < 45) return 'Just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

export class OutlineSidebar {
  private container: HTMLElement;
  private outlinePane: HTMLElement;
  private docsPane: HTMLElement;
  private tabOutlineBtn: HTMLButtonElement;
  private tabDocsBtn: HTMLButtonElement;
  private callbacks: SidebarCallbacks;
  private activeTab: 'outline' | 'documents' = 'outline';
  private activeHeadingId: string | null = null;
  private currentDocId = '';

  constructor(container: HTMLElement, callbacks: SidebarCallbacks) {
    this.container = container;
    this.callbacks = callbacks;

    this.container.innerHTML = `
      <div class="vw-sidebar-header">
        <div class="vw-sidebar-tabs" role="tablist">
          <button type="button" id="vw-tab-outline" class="vw-sidebar-tab is-active" role="tab" aria-selected="true">Outline</button>
          <button type="button" id="vw-tab-docs" class="vw-sidebar-tab" role="tab" aria-selected="false">Documents</button>
        </div>
        <button type="button" id="vw-btn-new-doc" class="vw-icon-btn" title="New Document">${ICONS.plus}</button>
      </div>
      <div class="vw-sidebar-body">
        <nav id="vw-outline-pane" class="vw-outline-list" aria-label="Document outline"></nav>
        <div id="vw-docs-pane" class="vw-docs-list" hidden></div>
      </div>
    `;

    this.outlinePane = this.container.querySelector('#vw-outline-pane') as HTMLElement;
    this.docsPane = this.container.querySelector('#vw-docs-pane') as HTMLElement;
    this.tabOutlineBtn = this.container.querySelector('#vw-tab-outline') as HTMLButtonElement;
    this.tabDocsBtn = this.container.querySelector('#vw-tab-docs') as HTMLButtonElement;

    this.tabOutlineBtn.addEventListener('click', () => this.switchTab('outline'));
    this.tabDocsBtn.addEventListener('click', () => this.switchTab('documents'));
    this.container
      .querySelector('#vw-btn-new-doc')
      ?.addEventListener('click', () => this.callbacks.onCreateDocument());
  }

  switchTab(tab: 'outline' | 'documents'): void {
    this.activeTab = tab;
    const isOutline = tab === 'outline';
    this.tabOutlineBtn.classList.toggle('is-active', isOutline);
    this.tabOutlineBtn.setAttribute('aria-selected', String(isOutline));
    this.tabDocsBtn.classList.toggle('is-active', !isOutline);
    this.tabDocsBtn.setAttribute('aria-selected', String(!isOutline));
    this.outlinePane.hidden = !isOutline;
    this.docsPane.hidden = isOutline;
  }

  setOpen(open: boolean): void {
    this.container.classList.toggle('is-collapsed', !open);
  }

  renderOutline(items: readonly OutlineItem[]): void {
    if (items.length === 0) {
      this.outlinePane.innerHTML = `
        <div class="vw-sidebar-empty">
          <p>No headings yet.</p>
          <span>Use <code>#</code>, <code>##</code>, or <code>/h1</code> to build your outline.</span>
        </div>
      `;
      return;
    }

    const frag = document.createDocumentFragment();
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `vw-outline-item vw-outline-h${item.level}${
        item.id === this.activeHeadingId ? ' is-active' : ''
      }`;
      btn.dataset.headingId = item.id;
      btn.textContent = item.text;
      btn.title = item.text;
      btn.addEventListener('click', () => {
        this.callbacks.onSelectHeading(item.blockIndex);
      });
      frag.appendChild(btn);
    }

    this.outlinePane.innerHTML = '';
    this.outlinePane.appendChild(frag);
  }

  setActiveHeading(headingId: string | null): void {
    if (this.activeHeadingId === headingId) return;
    this.activeHeadingId = headingId;
    if (this.activeTab !== 'outline') return;

    this.outlinePane
      .querySelectorAll<HTMLButtonElement>('.vw-outline-item')
      .forEach((el) => {
        el.classList.toggle('is-active', el.dataset.headingId === headingId);
      });
  }

  renderDocuments(docs: DocumentSummary[], currentDocId: string): void {
    this.currentDocId = currentDocId;
    if (docs.length === 0) {
      this.docsPane.innerHTML = `<div class="vw-sidebar-empty"><p>No local documents.</p></div>`;
      return;
    }

    const frag = document.createDocumentFragment();
    for (let i = 0; i < docs.length; i++) {
      const doc = docs[i];
      const card = document.createElement('div');
      card.className = `vw-doc-item${doc.id === this.currentDocId ? ' is-current' : ''}`;

      const mainBtn = document.createElement('button');
      mainBtn.type = 'button';
      mainBtn.className = 'vw-doc-item-btn';
      mainBtn.innerHTML = `
        <span class="vw-doc-item-title">${escapeHtml(doc.title)}</span>
        <span class="vw-doc-item-meta">${doc.wordCount.toLocaleString()} words · ${formatRelativeTime(doc.updatedAt)}</span>
      `;
      mainBtn.addEventListener('click', () => this.callbacks.onSelectDocument(doc.id));

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'vw-doc-delete-btn';
      delBtn.title = 'Delete document';
      delBtn.innerHTML = ICONS.trash;
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.callbacks.onDeleteDocument(doc.id);
      });

      card.appendChild(mainBtn);
      if (docs.length > 1) {
        card.appendChild(delBtn);
      }
      frag.appendChild(card);
    }

    this.docsPane.innerHTML = '';
    this.docsPane.appendChild(frag);
  }
}
