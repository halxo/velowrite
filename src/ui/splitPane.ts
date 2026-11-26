import { escapeHtml } from '../model/sanitize';
import type { DocumentModel, DocumentSummary } from '../model/types';
import { renderLatexEquationHtml } from '../editor/mathRenderer';

export interface SplitPaneCallbacks {
  onSelectSecondaryDoc: (docId: string | null) => void;
  onClose: () => void;
}

export class SplitReferencePane {
  private container: HTMLElement;
  private selectEl: HTMLSelectElement;
  private bodyEl: HTMLElement;
  private callbacks: SplitPaneCallbacks;
  private isOpen = false;

  constructor(container: HTMLElement, callbacks: SplitPaneCallbacks) {
    this.container = container;
    this.callbacks = callbacks;

    this.container.innerHTML = `
      <div class="vw-split-header">
        <span class="vw-split-badge">Reference View</span>
        <select id="vw-split-doc-select" class="vw-split-select" aria-label="Reference document"></select>
        <button type="button" id="vw-split-close" class="vw-icon-btn" title="Close Split Pane">×</button>
      </div>
      <div id="vw-split-body" class="vw-split-body"></div>
    `;

    this.selectEl = this.container.querySelector('#vw-split-doc-select') as HTMLSelectElement;
    this.bodyEl = this.container.querySelector('#vw-split-body') as HTMLElement;

    this.selectEl.addEventListener('change', () => {
      const val = this.selectEl.value;
      this.callbacks.onSelectSecondaryDoc(val === '__current__' ? null : val);
    });

    this.container
      .querySelector('#vw-split-close')
      ?.addEventListener('click', () => this.callbacks.onClose());
  }

  setOpen(open: boolean): void {
    this.isOpen = open;
    this.container.hidden = !open;
  }

  render(
    doc: DocumentModel,
    summaries: DocumentSummary[],
    selectedSecondaryId: string | null
  ): void {
    if (!this.isOpen) return;

    this.selectEl.innerHTML = '';
    const liveOpt = document.createElement('option');
    liveOpt.value = '__current__';
    liveOpt.textContent = `Live Reader: ${doc.title || 'Current Document'}`;
    liveOpt.selected = selectedSecondaryId === null;
    this.selectEl.appendChild(liveOpt);

    for (const s of summaries) {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = s.title || 'Untitled Document';
      opt.selected = s.id === selectedSecondaryId;
      this.selectEl.appendChild(opt);
    }

    const parts: string[] = [`<h1 class="vw-split-doc-title">${escapeHtml(doc.title || 'Untitled')}</h1>`];
    for (const b of doc.blocks) {
      switch (b.type) {
        case 'heading1':
          parts.push(`<h2>${b.html}</h2>`);
          break;
        case 'heading2':
          parts.push(`<h3>${b.html}</h3>`);
          break;
        case 'heading3':
          parts.push(`<h4>${b.html}</h4>`);
          break;
        case 'bullet-list':
          parts.push(`<div class="vw-split-li">• ${b.html}</div>`);
          break;
        case 'numbered-list':
          parts.push(`<div class="vw-split-li">1. ${b.html}</div>`);
          break;
        case 'todo':
          parts.push(`<div class="vw-split-li">${b.checked ? '☑' : '☐'} ${b.html}</div>`);
          break;
        case 'blockquote':
        case 'callout':
          parts.push(`<blockquote>${b.html}</blockquote>`);
          break;
        case 'math':
          parts.push(`<div class="vw-split-math">${renderLatexEquationHtml(b.text)}</div>`);
          break;
        case 'code-block':
          parts.push(`<pre><code>${escapeHtml(b.text)}</code></pre>`);
          break;
        case 'divider':
          parts.push(`<hr />`);
          break;
        case 'table':
          if (b.tableData && b.tableData.length > 0) {
            const rows = b.tableData
              .map(
                (r, idx) =>
                  `<tr>${r
                    .map((c) => (idx === 0 ? `<th>${escapeHtml(c)}</th>` : `<td>${escapeHtml(c)}</td>`))
                    .join('')}</tr>`
              )
              .join('');
            parts.push(`<table class="vw-table">${rows}</table>`);
          }
          break;
        default:
          if (b.html.trim()) parts.push(`<p>${b.html}</p>`);
          break;
      }
    }

    this.bodyEl.innerHTML = parts.join('\n');
  }
}
