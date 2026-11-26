import { escapeHtml } from '../model/sanitize';
import type { DocumentSummary } from '../model/types';
import { ICONS } from './icons';

export interface TabBarCallbacks {
  onSelectTab: (docId: string) => void;
  onCloseTab: (docId: string) => void;
  onNewTab: () => void;
}

export class DocumentTabBar {
  private container: HTMLElement;
  private callbacks: TabBarCallbacks;

  constructor(container: HTMLElement, callbacks: TabBarCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
  }

  render(
    openTabIds: string[],
    summaries: DocumentSummary[],
    activeDocId: string
  ): void {
    const summaryMap = new Map(summaries.map((s) => [s.id, s]));
    const validIds = openTabIds.filter((id) => summaryMap.has(id));
    if (!validIds.includes(activeDocId) && summaryMap.has(activeDocId)) {
      validIds.push(activeDocId);
    }

    if (validIds.length <= 1) {
      this.container.hidden = true;
      this.container.innerHTML = '';
      return;
    }

    this.container.hidden = false;
    const frag = document.createDocumentFragment();

    for (const id of validIds) {
      const doc = summaryMap.get(id);
      if (!doc) continue;

      const tab = document.createElement('div');
      tab.className = `vw-tab${id === activeDocId ? ' is-active' : ''}`;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(id === activeDocId));

      const selectBtn = document.createElement('button');
      selectBtn.type = 'button';
      selectBtn.className = 'vw-tab-btn';
      selectBtn.title = doc.title;
      selectBtn.innerHTML = `<span class="vw-tab-title">${escapeHtml(doc.title || 'Untitled')}</span>`;
      selectBtn.addEventListener('click', () => this.callbacks.onSelectTab(id));
      selectBtn.addEventListener('auxclick', (e) => {
        if (e.button === 1) {
          e.preventDefault();
          this.callbacks.onCloseTab(id);
        }
      });

      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'vw-tab-close';
      closeBtn.title = 'Close tab';
      closeBtn.textContent = '×';
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.callbacks.onCloseTab(id);
      });

      tab.appendChild(selectBtn);
      tab.appendChild(closeBtn);
      frag.appendChild(tab);
    }

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'vw-tab-new';
    addBtn.title = 'New Document Tab';
    addBtn.innerHTML = ICONS.plus;
    addBtn.addEventListener('click', () => this.callbacks.onNewTab());
    frag.appendChild(addBtn);

    this.container.innerHTML = '';
    this.container.appendChild(frag);
  }
}
