import { escapeHtml } from '../model/sanitize';
import type { DocumentSnapshot } from '../model/types';

export interface SnapshotModalCallbacks {
  onCreateSnapshot: (label: string) => Promise<void>;
  onRestoreSnapshot: (snapshot: DocumentSnapshot) => Promise<void>;
  onDeleteSnapshot: (snapshotId: string) => Promise<void>;
}

function computeWordDiff(
  oldText: string,
  newText: string
): Array<{ type: 'same' | 'add' | 'del'; value: string }> {
  const a = oldText.split(/(\s+)/).filter((t) => t.length > 0).slice(0, 600);
  const b = newText.split(/(\s+)/).filter((t) => t.length > 0).slice(0, 600);
  const m = a.length;
  const n = b.length;

  const dp: Uint16Array[] = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (a[i] === b[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const out: Array<{ type: 'same' | 'add' | 'del'; value: string }> = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      out.push({ type: 'same', value: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: 'del', value: a[i] });
      i++;
    } else {
      out.push({ type: 'add', value: b[j] });
      j++;
    }
  }
  while (i < m) {
    out.push({ type: 'del', value: a[i++] });
  }
  while (j < n) {
    out.push({ type: 'add', value: b[j++] });
  }
  return out;
}

export class SnapshotModal {
  private overlay: HTMLDivElement;
  private listEl: HTMLDivElement;
  private diffEl: HTMLDivElement;
  private labelInput: HTMLInputElement;
  private callbacks: SnapshotModalCallbacks;
  private snapshots: DocumentSnapshot[] = [];
  private currentPlainText = '';
  private selectedId: string | null = null;

  constructor(callbacks: SnapshotModalCallbacks) {
    this.callbacks = callbacks;

    this.overlay = document.createElement('div');
    this.overlay.id = 'vw-snapshot-overlay';
    this.overlay.className = 'vw-modal-overlay';
    this.overlay.setAttribute('role', 'dialog');
    this.overlay.setAttribute('aria-modal', 'true');
    this.overlay.setAttribute('aria-label', 'Version History & Diff');

    this.overlay.innerHTML = `
      <div class="vw-snapshot-modal">
        <div class="vw-snapshot-header">
          <div>
            <h2 class="vw-snapshot-title">Version Snapshots &amp; Diff</h2>
            <p class="vw-snapshot-sub">Saved locally in IndexedDB · Compare against your current draft</p>
          </div>
          <button type="button" id="vw-snapshot-close" class="vw-icon-btn" aria-label="Close">×</button>
        </div>
        <div class="vw-snapshot-create">
          <input type="text" id="vw-snapshot-label" class="vw-snapshot-input" placeholder="Snapshot label (e.g. Before Chapter 3 rewrite)…" />
          <button type="button" id="vw-snapshot-save" class="vw-primary-btn">Save Snapshot</button>
        </div>
        <div class="vw-snapshot-body">
          <div id="vw-snapshot-list" class="vw-snapshot-list"></div>
          <div id="vw-snapshot-diff" class="vw-snapshot-diff"></div>
        </div>
      </div>
    `;

    this.listEl = this.overlay.querySelector('#vw-snapshot-list') as HTMLDivElement;
    this.diffEl = this.overlay.querySelector('#vw-snapshot-diff') as HTMLDivElement;
    this.labelInput = this.overlay.querySelector('#vw-snapshot-label') as HTMLInputElement;

    this.overlay.addEventListener('mousedown', (e) => {
      if (e.target === this.overlay) this.close();
    });
    this.overlay.querySelector('#vw-snapshot-close')?.addEventListener('click', () => this.close());
    this.overlay.querySelector('#vw-snapshot-save')?.addEventListener('click', () => {
      const label = this.labelInput.value.trim() || `Snapshot ${new Date().toLocaleTimeString()}`;
      this.labelInput.value = '';
      void this.callbacks.onCreateSnapshot(label);
    });

    document.body.appendChild(this.overlay);
  }

  open(snapshots: DocumentSnapshot[], currentPlainText: string): void {
    this.currentPlainText = currentPlainText;
    this.setSnapshots(snapshots);
    this.overlay.classList.add('is-open');
  }

  close(): void {
    this.overlay.classList.remove('is-open');
  }

  setSnapshots(snapshots: DocumentSnapshot[]): void {
    this.snapshots = snapshots;
    if (!this.selectedId || !snapshots.some((s) => s.id === this.selectedId)) {
      this.selectedId = snapshots[0]?.id ?? null;
    }
    this.renderList();
    this.renderDiff();
  }

  private renderList(): void {
    if (this.snapshots.length === 0) {
      this.listEl.innerHTML = `<div class="vw-snapshot-empty">No snapshots yet. Save one above to track revisions.</div>`;
      return;
    }

    const frag = document.createDocumentFragment();
    for (const snap of this.snapshots) {
      const row = document.createElement('div');
      row.className = `vw-snapshot-item${snap.id === this.selectedId ? ' is-selected' : ''}`;
      row.innerHTML = `
        <button type="button" class="vw-snapshot-item-btn">
          <span class="vw-snapshot-item-label">${escapeHtml(snap.label)}</span>
          <span class="vw-snapshot-item-meta">${snap.wordCount.toLocaleString()} words · ${new Date(snap.createdAt).toLocaleString()}</span>
        </button>
        <div class="vw-snapshot-item-actions">
          <button type="button" class="vw-snap-restore">Restore</button>
          <button type="button" class="vw-snap-del" title="Delete">×</button>
        </div>
      `;
      row.querySelector('.vw-snapshot-item-btn')?.addEventListener('click', () => {
        this.selectedId = snap.id;
        this.renderList();
        this.renderDiff();
      });
      row.querySelector('.vw-snap-restore')?.addEventListener('click', () => {
        void this.callbacks.onRestoreSnapshot(snap);
        this.close();
      });
      row.querySelector('.vw-snap-del')?.addEventListener('click', () => {
        void this.callbacks.onDeleteSnapshot(snap.id);
      });
      frag.appendChild(row);
    }

    this.listEl.innerHTML = '';
    this.listEl.appendChild(frag);
  }

  private renderDiff(): void {
    const snap = this.snapshots.find((s) => s.id === this.selectedId);
    if (!snap) {
      this.diffEl.innerHTML = `<div class="vw-snapshot-empty">Select a snapshot to view changes against your current draft.</div>`;
      return;
    }

    const snapText = snap.blocks.map((b) => b.text).filter(Boolean).join('\n');
    const ops = computeWordDiff(snapText, this.currentPlainText);

    const html = ops
      .map((op) => {
        const safe = escapeHtml(op.value).replace(/\n/g, '<br>');
        if (op.type === 'add') return `<ins class="vw-diff-add">${safe}</ins>`;
        if (op.type === 'del') return `<del class="vw-diff-del">${safe}</del>`;
        return `<span>${safe}</span>`;
      })
      .join('');

    this.diffEl.innerHTML = `
      <div class="vw-diff-legend">
        <span>Comparing <strong>${escapeHtml(snap.label)}</strong> → <strong>Current Draft</strong></span>
        <span><del class="vw-diff-del">Removed</del> <ins class="vw-diff-add">Added</ins></span>
      </div>
      <div class="vw-diff-content">${html || '<em>No text differences.</em>'}</div>
    `;
  }
}
