import './styles/main.css';
import {
  createBlankDocument,
  createWelcomeDocument,
  DocumentStore,
  generateBenchmarkDocument,
} from './model/documentStore';
import { generateId } from './model/sanitize';
import {
  DEFAULT_PREFERENCES,
  type DocumentModel,
  type DocumentSnapshot,
  type DocumentSummary,
  type FontPreset,
  type LineSpacingPreset,
  type MarginPreset,
  type PageSizePreset,
  type ThemeMode,
  type UserPreferences,
} from './model/types';
import { VeloStorage } from './storage/indexedDB';
import {
  documentToMarkdown,
  exportToDocx,
  exportToEpub,
  exportToHtml,
  exportToJson,
  exportToMarkdown,
  markdownToDocument,
  parseImportedJson,
} from './storage/exporters';
import { VirtualDocumentRenderer } from './editor/virtualRenderer';
import { FloatingSelectionToolbar } from './ui/selectionToolbar';
import { SlashCommandMenu } from './ui/slashMenu';
import { OutlineSidebar } from './ui/outlineSidebar';
import { CommandPalette, type PaletteCommand } from './ui/commandPalette';
import { StatusFooter } from './ui/statusFooter';
import { FindReplaceBar } from './ui/findReplaceBar';
import { SnapshotModal } from './ui/snapshotModal';
import { DocumentTabBar } from './ui/tabBar';
import { SplitReferencePane } from './ui/splitPane';
import { ShortcutsModal } from './ui/shortcutsModal';
import { UpdateBanner } from './ui/updateBanner';
import { ICONS } from './ui/icons';

class VeloWriteApp {
  private storage = new VeloStorage();
  private store = new DocumentStore(createWelcomeDocument());
  private prefs: UserPreferences = { ...DEFAULT_PREFERENCES };
  private recentDocs: DocumentSummary[] = [];
  private secondaryDocCache: DocumentModel | null = null;

  private renderer!: VirtualDocumentRenderer;
  private selectionToolbar!: FloatingSelectionToolbar;
  private slashMenu!: SlashCommandMenu;
  private sidebar!: OutlineSidebar;
  private palette!: CommandPalette;
  private footer!: StatusFooter;
  private findBar!: FindReplaceBar;
  private snapshotModal!: SnapshotModal;
  private tabBar!: DocumentTabBar;
  private splitPane!: SplitReferencePane;
  private shortcutsModal!: ShortcutsModal;
  private updateBanner?: UpdateBanner;

  private manualUpdateCheck = false;
  private desktopVersion: string | null = null;
  private currentDiskFilePath: string | null = null;
  private pendingImageBlockId: string | null = null;

  private topbarEl!: HTMLElement;
  private titleInput!: HTMLInputElement;
  private saveStatusEl!: HTMLElement;
  private saveLabelEl!: HTMLElement;
  private pageModeBtn!: HTMLButtonElement;
  private splitBtn!: HTMLButtonElement;
  private importInput!: HTMLInputElement;
  private imageInput!: HTMLInputElement;
  private dimTimer: number | null = null;

  async init(): Promise<void> {
    this.topbarEl = document.getElementById('vw-topbar') as HTMLElement;
    this.titleInput = document.getElementById('vw-doc-title') as HTMLInputElement;
    this.saveStatusEl = document.getElementById('vw-save-status') as HTMLElement;
    this.saveLabelEl = this.saveStatusEl.querySelector('.vw-save-label') as HTMLElement;
    this.pageModeBtn = document.getElementById('vw-btn-page-mode') as HTMLButtonElement;
    this.splitBtn = document.getElementById('vw-btn-split') as HTMLButtonElement;
    this.importInput = document.getElementById('vw-import-json-input') as HTMLInputElement;
    this.imageInput = document.getElementById('vw-pick-image-input') as HTMLInputElement;

    const sidebarToggleBtn = document.getElementById('vw-btn-toggle-sidebar') as HTMLButtonElement;
    sidebarToggleBtn.innerHTML = ICONS.sidebar;

    try {
      this.prefs = await this.storage.getPreferences();
      this.applyTheme(this.prefs.theme, false);
      this.applyFocusMode(this.prefs.focusMode, false);

      const summaries = await this.storage.listDocumentSummaries();
      const targetId = this.prefs.lastDocumentId ?? summaries[0]?.id ?? null;
      const loadedDoc = targetId ? await this.storage.getDocument(targetId) : null;

      if (loadedDoc) {
        this.store.loadDocument(loadedDoc);
      } else {
        const welcome = createWelcomeDocument();
        this.store.loadDocument(welcome);
        await this.storage.saveDocumentImmediate(welcome);
      }
      this.ensureDocInTabs(this.store.getDocument().id, false);
      this.recentDocs = await this.storage.listDocumentSummaries();
    } catch {
      this.applyTheme('light', false);
    }

    this.initComponents();
    this.bindGlobalEvents(sidebarToggleBtn);
    await this.refreshSplitPane();
    this.syncChromeFromStore();

    if (window.velowriteDesktop) {
      void window.velowriteDesktop.notifyRendererReady();
      if (this.prefs.syncFolderPath) {
        void this.pullFromSyncFolder();
      }
    }
  }

  private initComponents(): void {
    const scrollContainer = document.getElementById('vw-scroll-container') as HTMLElement;
    const pageSurface = document.getElementById('vw-page-surface') as HTMLElement;
    const sidebarEl = document.getElementById('vw-sidebar') as HTMLElement;
    const footerEl = document.getElementById('vw-footer') as HTMLElement;
    const tabBarEl = document.getElementById('vw-tab-bar') as HTMLElement;
    const splitPaneEl = document.getElementById('vw-split-pane') as HTMLElement;

    this.footer = new StatusFooter(footerEl, () => this.promptWordGoal());
    this.footer.setWordGoal(this.prefs.dailyWordGoal);

    this.tabBar = new DocumentTabBar(tabBarEl, {
      onSelectTab: (docId) => void this.openDocument(docId),
      onCloseTab: (docId) => void this.closeTab(docId),
      onNewTab: () => void this.createNewDocument(),
    });

    this.splitPane = new SplitReferencePane(splitPaneEl, {
      onSelectSecondaryDoc: (docId) => {
        this.prefs.splitSecondaryDocId = docId;
        void this.storage.savePreferences(this.prefs);
        void this.refreshSplitPane();
      },
      onClose: () => this.toggleSplitPane(false),
    });
    this.splitPane.setOpen(this.prefs.splitPaneOpen);
    this.splitBtn.classList.toggle('is-active', this.prefs.splitPaneOpen);

    this.shortcutsModal = new ShortcutsModal();

    this.sidebar = new OutlineSidebar(sidebarEl, {
      onSelectHeading: (blockIndex) => {
        this.renderer.scrollToBlockIndex(blockIndex, true);
      },
      onSelectDocument: (docId) => {
        void this.openDocument(docId);
      },
      onCreateDocument: () => {
        void this.createNewDocument();
      },
      onDeleteDocument: (docId) => {
        void this.deleteDocument(docId);
      },
    });
    this.sidebar.setOpen(this.prefs.sidebarOpen);

    this.selectionToolbar = new FloatingSelectionToolbar({
      onFormat: (action, url) => this.renderer.formatSelection(action, url),
      onBlockType: (blockId, type) => this.renderer.setBlockTypeFromToolbar(blockId, type),
      onAlign: (blockId, align) => this.renderer.setBlockAlignFromToolbar(blockId, align),
    });

    this.slashMenu = new SlashCommandMenu(
      (blockId, type) => this.renderer.applySlashCommand(blockId, type),
      () => this.renderer.closeSlashMenu()
    );

    this.renderer = new VirtualDocumentRenderer(
      this.store,
      this.storage,
      scrollContainer,
      pageSurface,
      {
        onSlashStateChange: (state) => this.slashMenu.update(state),
        onSlashKeyDown: (e) => this.slashMenu.handleKeyDown(e),
        onSelectionToolbarChange: (state) => this.selectionToolbar.update(state),
        onLatencySample: (ms) => this.footer.updateLatency(ms),
        onActiveHeadingChange: (id) => this.sidebar.setActiveHeading(id),
        onTypingActivity: () => this.handleTypingActivity(),
        onRequestImagePick: (blockId) => {
          this.pendingImageBlockId = blockId;
          this.imageInput.click();
        },
      }
    );
    this.renderer.setTypewriterMode(this.prefs.typewriterMode);

    this.findBar = new FindReplaceBar(this.store, {
      onJumpToBlock: (blockIndex) => this.renderer.scrollToBlockIndex(blockIndex, false),
      onRefreshHighlights: (q, cs, rx) => this.renderer.setSearchHighlights(q, cs, rx),
    });

    this.snapshotModal = new SnapshotModal({
      onCreateSnapshot: async (label) => {
        await this.createSnapshot(label);
      },
      onRestoreSnapshot: async (snap) => {
        await this.restoreSnapshot(snap);
      },
      onDeleteSnapshot: async (id) => {
        await this.storage.deleteSnapshot(id);
        const list = await this.storage.listSnapshots(this.store.getDocument().id);
        this.snapshotModal.setSnapshots(list);
      },
    });

    this.palette = new CommandPalette(() => this.buildPaletteCommands());

    if (window.velowriteDesktop) {
      this.updateBanner = new UpdateBanner(() => {
        void window.velowriteDesktop?.installUpdate();
      });
      window.velowriteDesktop.onUpdateStatus((ev) => {
        this.updateBanner?.showStatus(ev, this.manualUpdateCheck);
        if (ev.status === 'up-to-date' || ev.status === 'error' || ev.status === 'downloaded') {
          this.manualUpdateCheck = false;
        }
      });
      window.velowriteDesktop.onExternalFileOpened((payload) => {
        this.currentDiskFilePath = payload.filePath;
        void this.loadImportedText(payload.fileName, payload.content);
      });
      void window.velowriteDesktop.getAppInfo().then((info) => {
        this.desktopVersion = info.version;
      });
    }

    this.storage.setSaveStateListener((state) => {
      this.saveStatusEl.classList.toggle('is-saving', state === 'saving');
      this.saveLabelEl.textContent =
        state === 'saving' ? 'Saving…' : state === 'error' ? 'Save error' : 'Saved';
      if (state === 'saved') {
        void this.refreshRecentDocs();
        if (this.prefs.syncFolderPath && window.velowriteDesktop) {
          const doc = this.store.getDocument();
          void window.velowriteDesktop.syncWriteDoc({
            folderPath: this.prefs.syncFolderPath,
            docId: doc.id,
            json: JSON.stringify(doc),
          });
        }
      }
    });

    this.store.subscribe((ev) => {
      this.footer.updateStats(this.store.getStats());

      if (
        ev.kind === 'load' ||
        ev.kind === 'block-type' ||
        ev.kind === 'block-insert' ||
        ev.kind === 'block-delete' ||
        ev.kind === 'block-move' ||
        ev.kind === 'block-replace-all' ||
        ev.kind === 'block-content'
      ) {
        this.sidebar.renderOutline(this.store.getOutline());
      }

      if (ev.kind === 'title' || ev.kind === 'load' || ev.kind === 'block-replace-all') {
        if (document.activeElement !== this.titleInput) {
          this.titleInput.value = this.store.getDocument().title;
        }
        document.title = `${this.store.getDocument().title || 'Untitled'} — VeloWrite`;
      }

      if (ev.kind === 'settings' || ev.kind === 'load') {
        this.updatePageModeButton();
      }

      if (this.prefs.splitPaneOpen && this.prefs.splitSecondaryDocId === null) {
        this.splitPane.render(this.store.getDocument(), this.recentDocs, null);
      }

      if (ev.kind !== 'load') {
        this.storage.scheduleAutosave(this.store.getDocument());
      }
    });
  }

  private bindGlobalEvents(sidebarToggleBtn: HTMLButtonElement): void {
    sidebarToggleBtn.addEventListener('click', () => this.toggleSidebar());
    this.pageModeBtn.addEventListener('click', () => this.togglePageMode());
    this.splitBtn.addEventListener('click', () => this.toggleSplitPane());

    document
      .getElementById('vw-btn-palette')
      ?.addEventListener('click', () => this.palette.open());

    document
      .getElementById('vw-btn-shortcuts')
      ?.addEventListener('click', () => this.shortcutsModal.open());

    this.titleInput.addEventListener('input', () => {
      this.store.setTitle(this.titleInput.value);
    });

    this.titleInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const first = this.store.getBlockAt(0);
        if (first) this.renderer.focusBlock(first.id, 0);
      }
    });

    this.importInput.addEventListener('change', async () => {
      const file = this.importInput.files?.[0];
      this.importInput.value = '';
      if (!file) return;
      const text = await file.text();
      await this.loadImportedText(file.name, text);
    });

    this.imageInput.addEventListener('change', async () => {
      const file = this.imageInput.files?.[0];
      const blockId = this.pendingImageBlockId;
      this.imageInput.value = '';
      this.pendingImageBlockId = null;
      if (!file || !blockId) return;
      await this.renderer.insertImageBlobAfter(blockId, file, true);
    });

    window.addEventListener('keydown', (e) => {
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (mod && key === 'k') {
        e.preventDefault();
        this.palette.toggle();
      } else if (mod && e.altKey && e.key === '\\') {
        e.preventDefault();
        this.toggleSplitPane();
      } else if (mod && e.key === '\\') {
        e.preventDefault();
        this.toggleSidebar();
      } else if (mod && e.key === '/') {
        e.preventDefault();
        this.shortcutsModal.toggle();
      } else if (e.ctrlKey && e.key === 'Tab') {
        e.preventDefault();
        this.cycleOpenTabs(e.shiftKey ? -1 : 1);
      } else if (mod && key === 'f') {
        e.preventDefault();
        this.findBar.open(false);
      } else if (mod && key === 'h') {
        e.preventDefault();
        this.findBar.open(true);
      } else if (mod && key === 'o') {
        e.preventDefault();
        void this.openFromDisk();
      } else if (mod && key === 's') {
        e.preventDefault();
        void this.saveToDisk(e.shiftKey);
      }
    });

    window.addEventListener(
      'mousemove',
      () => {
        if (this.topbarEl.classList.contains('is-dimmed')) {
          this.topbarEl.classList.remove('is-dimmed');
        }
      },
      { passive: true }
    );

    window.addEventListener('beforeunload', () => {
      void this.storage.flushPendingSave();
    });
  }

  private ensureDocInTabs(docId: string, persist = true): void {
    if (!Array.isArray(this.prefs.openTabIds)) {
      this.prefs.openTabIds = [];
    }
    if (!this.prefs.openTabIds.includes(docId)) {
      this.prefs.openTabIds.push(docId);
      if (this.prefs.openTabIds.length > 10) {
        this.prefs.openTabIds.shift();
      }
      if (persist) {
        void this.storage.savePreferences(this.prefs);
      }
    }
  }

  private async closeTab(docId: string): Promise<void> {
    this.prefs.openTabIds = (this.prefs.openTabIds ?? []).filter((id) => id !== docId);
    if (docId === this.store.getDocument().id && this.prefs.openTabIds.length > 0) {
      await this.openDocument(this.prefs.openTabIds[this.prefs.openTabIds.length - 1]);
    } else if (this.prefs.openTabIds.length === 0) {
      this.prefs.openTabIds = [this.store.getDocument().id];
    }
    await this.storage.savePreferences(this.prefs);
    this.syncChromeFromStore();
  }

  private cycleOpenTabs(direction: 1 | -1): void {
    const tabs = this.prefs.openTabIds ?? [];
    if (tabs.length <= 1) return;
    const currentIdx = tabs.indexOf(this.store.getDocument().id);
    const nextIdx = (currentIdx + direction + tabs.length) % tabs.length;
    void this.openDocument(tabs[nextIdx]);
  }

  private toggleSplitPane(force?: boolean): void {
    const next = force !== undefined ? force : !this.prefs.splitPaneOpen;
    this.prefs.splitPaneOpen = next;
    this.splitPane.setOpen(next);
    this.splitBtn.classList.toggle('is-active', next);
    void this.storage.savePreferences(this.prefs);
    void this.refreshSplitPane();
  }

  private async refreshSplitPane(): Promise<void> {
    if (!this.prefs.splitPaneOpen) return;
    const secId = this.prefs.splitSecondaryDocId;
    if (secId) {
      this.secondaryDocCache = await this.storage.getDocument(secId);
      if (this.secondaryDocCache) {
        this.splitPane.render(this.secondaryDocCache, this.recentDocs, secId);
        return;
      }
      this.prefs.splitSecondaryDocId = null;
    }
    this.splitPane.render(this.store.getDocument(), this.recentDocs, null);
  }

  private async loadImportedText(fileName: string, content: string): Promise<void> {
    const lower = fileName.toLowerCase();
    const doc =
      lower.endsWith('.json') || lower.endsWith('.velowrite')
        ? parseImportedJson(content)
        : markdownToDocument(content, fileName);
    if (!doc) return;
    await this.storage.flushPendingSave();
    this.store.loadDocument(doc);
    await this.storage.saveDocumentImmediate(doc);
    this.ensureDocInTabs(doc.id, false);
    await this.saveLastDocPref(doc.id);
    await this.refreshRecentDocs();
    this.syncChromeFromStore();
  }

  private async openFromDisk(): Promise<void> {
    if (window.velowriteDesktop) {
      const result = await window.velowriteDesktop.openFile();
      if (!result) return;
      this.currentDiskFilePath = result.filePath;
      await this.loadImportedText(result.fileName, result.content);
      return;
    }
    this.importInput.click();
  }

  private async saveToDisk(saveAs = false): Promise<void> {
    const doc = this.store.getDocument();
    if (window.velowriteDesktop) {
      const res = await window.velowriteDesktop.saveFile({
        filePath: saveAs ? null : this.currentDiskFilePath,
        defaultName: `${(doc.title || 'document').replace(/[^a-z0-9\-_\s]/gi, '').trim() || 'document'}.md`,
        markdownContent: documentToMarkdown(doc),
        jsonContent: JSON.stringify(doc, null, 2),
      });
      if (!res.canceled && res.filePath) {
        this.currentDiskFilePath = res.filePath;
      }
      return;
    }
    exportToMarkdown(doc);
  }

  private async exportPdf(): Promise<void> {
    const doc = this.store.getDocument();
    if (window.velowriteDesktop) {
      await window.velowriteDesktop.exportPdf({
        defaultName: `${(doc.title || 'document').replace(/[^a-z0-9\-_\s]/gi, '').trim() || 'document'}.pdf`,
        pageSize: doc.settings.pageSize ?? 'letter',
      });
      return;
    }
    window.print();
  }

  private async openSnapshotModal(): Promise<void> {
    const doc = this.store.getDocument();
    const list = await this.storage.listSnapshots(doc.id);
    const currentPlain = doc.blocks.map((b) => b.text).filter(Boolean).join('\n');
    this.snapshotModal.open(list, currentPlain);
  }

  private async createSnapshot(label: string): Promise<void> {
    const doc = this.store.getDocument();
    const snap: DocumentSnapshot = {
      id: generateId(),
      documentId: doc.id,
      label,
      title: doc.title,
      blocks: doc.blocks.map((b) => ({
        ...b,
        tableData: b.tableData ? b.tableData.map((r) => [...r]) : undefined,
      })),
      wordCount: this.store.getStats().words,
      createdAt: Date.now(),
    };
    await this.storage.saveSnapshot(snap);
    const list = await this.storage.listSnapshots(doc.id);
    this.snapshotModal.setSnapshots(list);
  }

  private async restoreSnapshot(snap: DocumentSnapshot): Promise<void> {
    const current = this.store.getDocument();
    await this.createSnapshot(`Auto-backup before restoring "${snap.label}"`);
    this.store.loadDocument({
      ...current,
      title: snap.title,
      blocks: snap.blocks.map((b) => ({ ...b })),
      updatedAt: Date.now(),
    });
    await this.storage.saveDocumentImmediate(this.store.getDocument());
  }

  private async configureSyncFolder(): Promise<void> {
    if (!window.velowriteDesktop) return;
    const folder = await window.velowriteDesktop.chooseSyncFolder();
    if (!folder) return;
    this.prefs.syncFolderPath = folder;
    await this.storage.savePreferences(this.prefs);
    const doc = this.store.getDocument();
    await window.velowriteDesktop.syncWriteDoc({
      folderPath: folder,
      docId: doc.id,
      json: JSON.stringify(doc),
    });
    await this.pullFromSyncFolder();
  }

  private async pullFromSyncFolder(): Promise<void> {
    if (!this.prefs.syncFolderPath || !window.velowriteDesktop) return;
    const rawDocs = await window.velowriteDesktop.syncReadAll({
      folderPath: this.prefs.syncFolderPath,
    });
    let changed = false;
    for (const raw of rawDocs) {
      const parsed = parseImportedJson(raw);
      if (!parsed) continue;
      const local = await this.storage.getDocument(parsed.id);
      if (!local || parsed.updatedAt > local.updatedAt) {
        await this.storage.saveDocumentImmediate(parsed);
        if (parsed.id === this.store.getDocument().id) {
          this.store.loadDocument(parsed);
        }
        changed = true;
      }
    }
    if (changed) {
      await this.refreshRecentDocs();
    }
  }

  private promptWordGoal(): void {
    const current = this.prefs.dailyWordGoal > 0 ? String(this.prefs.dailyWordGoal) : '1000';
    const input = window.prompt('Set session word goal (enter 0 to hide):', current);
    if (input === null) return;
    const parsed = Math.max(0, Math.floor(Number(input) || 0));
    this.prefs.dailyWordGoal = parsed;
    this.footer.setWordGoal(parsed);
    void this.storage.savePreferences(this.prefs);
  }

  private handleTypingActivity(): void {
    if (!this.topbarEl.classList.contains('is-dimmed')) {
      this.topbarEl.classList.add('is-dimmed');
    }
    if (this.dimTimer !== null) {
      window.clearTimeout(this.dimTimer);
    }
    this.dimTimer = window.setTimeout(() => {
      this.topbarEl.classList.remove('is-dimmed');
      this.dimTimer = null;
    }, 3500);
  }

  private syncChromeFromStore(): void {
    const doc = this.store.getDocument();
    this.titleInput.value = doc.title;
    document.title = `${doc.title || 'Untitled'} — VeloWrite`;
    this.updatePageModeButton();
    this.footer.updateStats(this.store.getStats());
    this.sidebar.renderOutline(this.store.getOutline());
    this.sidebar.renderDocuments(this.recentDocs, doc.id);
    this.tabBar.render(this.prefs.openTabIds ?? [doc.id], this.recentDocs, doc.id);
    void this.refreshSplitPane();
  }

  private updatePageModeButton(): void {
    const mode = this.store.getDocument().settings.pageMode;
    this.pageModeBtn.innerHTML =
      mode === 'paginated'
        ? `${ICONS.paginated}<span>Paginated</span>`
        : `${ICONS.continuous}<span>Continuous</span>`;
  }

  private toggleSidebar(): void {
    this.prefs.sidebarOpen = !this.prefs.sidebarOpen;
    this.sidebar.setOpen(this.prefs.sidebarOpen);
    void this.storage.savePreferences(this.prefs);
  }

  private togglePageMode(): void {
    const current = this.store.getDocument().settings.pageMode;
    this.store.updateSettings({
      pageMode: current === 'paginated' ? 'continuous' : 'paginated',
    });
  }

  private setMargins(margins: MarginPreset): void {
    this.store.updateSettings({ margins });
  }

  private setFont(font: FontPreset): void {
    this.store.updateSettings({ font });
  }

  private setLineSpacing(lineSpacing: LineSpacingPreset): void {
    this.store.updateSettings({ lineSpacing });
  }

  private setPageSize(pageSize: PageSizePreset): void {
    this.store.updateSettings({ pageSize });
  }

  private applyTheme(theme: ThemeMode, persist = true): void {
    this.prefs.theme = theme;
    document.documentElement.dataset.theme = theme;
    if (persist) {
      void this.storage.savePreferences(this.prefs);
    }
  }

  private applyFocusMode(enabled: boolean, persist = true): void {
    this.prefs.focusMode = enabled;
    document.body.classList.toggle('vw-focus-mode', enabled);
    if (persist) {
      void this.storage.savePreferences(this.prefs);
    }
  }

  private toggleTypewriterMode(): void {
    this.prefs.typewriterMode = !this.prefs.typewriterMode;
    this.renderer.setTypewriterMode(this.prefs.typewriterMode);
    void this.storage.savePreferences(this.prefs);
  }

  private async saveLastDocPref(docId: string): Promise<void> {
    this.prefs.lastDocumentId = docId;
    await this.storage.savePreferences(this.prefs);
  }

  private async refreshRecentDocs(): Promise<void> {
    this.recentDocs = await this.storage.listDocumentSummaries();
    const activeId = this.store.getDocument().id;
    this.sidebar.renderDocuments(this.recentDocs, activeId);
    this.tabBar.render(this.prefs.openTabIds ?? [activeId], this.recentDocs, activeId);
  }

  private async createNewDocument(): Promise<void> {
    await this.storage.flushPendingSave();
    this.currentDiskFilePath = null;
    const doc = createBlankDocument('Untitled Document');
    this.store.loadDocument(doc);
    await this.storage.saveDocumentImmediate(doc);
    this.ensureDocInTabs(doc.id, false);
    await this.saveLastDocPref(doc.id);
    await this.refreshRecentDocs();
    this.syncChromeFromStore();
    const first = doc.blocks[0];
    if (first) this.renderer.focusBlock(first.id, 0);
  }

  private async openDocument(docId: string): Promise<void> {
    if (docId === this.store.getDocument().id) return;
    await this.storage.flushPendingSave();
    this.currentDiskFilePath = null;
    const doc = await this.storage.getDocument(docId);
    if (!doc) return;
    this.store.loadDocument(doc);
    this.ensureDocInTabs(doc.id, false);
    await this.saveLastDocPref(doc.id);
    this.syncChromeFromStore();
  }

  private async deleteDocument(docId: string): Promise<void> {
    await this.storage.deleteDocument(docId);
    this.prefs.openTabIds = (this.prefs.openTabIds ?? []).filter((id) => id !== docId);
    const remaining = await this.storage.listDocumentSummaries();
    if (remaining.length === 0) {
      await this.createNewDocument();
      return;
    }
    if (docId === this.store.getDocument().id) {
      const next = await this.storage.getDocument(remaining[0].id);
      if (next) {
        this.store.loadDocument(next);
        this.ensureDocInTabs(next.id, false);
        await this.saveLastDocPref(next.id);
      }
    }
    this.recentDocs = remaining;
    this.syncChromeFromStore();
  }

  private async loadBenchmarkDocument(): Promise<void> {
    await this.storage.flushPendingSave();
    this.currentDiskFilePath = null;
    const bench = generateBenchmarkDocument();
    this.store.loadDocument(bench);
    await this.storage.saveDocumentImmediate(bench);
    this.ensureDocInTabs(bench.id, false);
    await this.saveLastDocPref(bench.id);
    await this.refreshRecentDocs();
    this.syncChromeFromStore();
    document.getElementById('vw-scroll-container')?.scrollTo({ top: 0 });
  }

  private buildPaletteCommands(): PaletteCommand[] {
    const doc = this.store.getDocument();
    const commands: PaletteCommand[] = [
      {
        id: 'new-doc',
        section: 'Actions',
        label: 'New Blank Document',
        subtitle: 'Create a fresh local-first document tab in IndexedDB',
        icon: ICONS.plus,
        keywords: ['create', 'file', 'blank', 'tab'],
        run: () => void this.createNewDocument(),
      },
      {
        id: 'open-disk',
        section: 'Actions',
        label: 'Open File from Disk (.md, .velowrite, .json)',
        subtitle: 'Load a local Markdown or VeloWrite file directly into a tab',
        shortcut: '⌘O',
        icon: ICONS.folder,
        keywords: ['open', 'import', 'disk', 'markdown'],
        run: () => void this.openFromDisk(),
      },
      {
        id: 'save-disk',
        section: 'Actions',
        label: 'Save File to Disk',
        subtitle: this.currentDiskFilePath
          ? `Save atomically to ${this.currentDiskFilePath}`
          : 'Save document to disk as Markdown or VeloWrite JSON',
        shortcut: '⌘S',
        icon: ICONS.download,
        keywords: ['save', 'disk', 'file'],
        run: () => void this.saveToDisk(false),
      },
      {
        id: 'find-replace',
        section: 'Actions',
        label: 'Find & Replace',
        subtitle: 'Search across the entire manuscript in milliseconds',
        shortcut: '⌘F',
        icon: ICONS.search,
        keywords: ['find', 'search', 'replace', 'regex'],
        run: () => this.findBar.open(true),
      },
      {
        id: 'split-pane',
        section: 'Actions',
        label: this.prefs.splitPaneOpen
          ? 'Close Split Reference Pane'
          : 'Open Split Reference Pane',
        subtitle: 'Read a second document or live formatted preview side by side',
        shortcut: '⌘⌥\\',
        icon: ICONS.sidebar,
        keywords: ['split', 'side by side', 'reference', 'preview'],
        run: () => this.toggleSplitPane(),
      },
      {
        id: 'snapshots',
        section: 'Actions',
        label: 'Version Snapshots & Visual Diff',
        subtitle: 'Save a local checkpoint or compare revisions word-by-word',
        icon: ICONS.history,
        keywords: ['history', 'snapshot', 'version', 'diff', 'restore'],
        run: () => void this.openSnapshotModal(),
      },
      {
        id: 'shortcuts-guide',
        section: 'Actions',
        label: 'Keyboard Shortcuts & Markdown Guide',
        subtitle: 'View all keyboard shortcuts and instant Markdown block triggers',
        shortcut: '⌘/',
        icon: ICONS.callout,
        keywords: ['help', 'shortcuts', 'keys', 'guide'],
        run: () => this.shortcutsModal.open(),
      },
      {
        id: 'toggle-sidebar',
        section: 'Actions',
        label: this.prefs.sidebarOpen ? 'Hide Outline Sidebar' : 'Show Outline Sidebar',
        subtitle: 'Toggle the document outline and files panel',
        shortcut: '⌘\\',
        icon: ICONS.sidebar,
        keywords: ['outline', 'panel', 'navigation'],
        run: () => this.toggleSidebar(),
      },
      {
        id: 'toggle-focus',
        section: 'Actions',
        label: this.prefs.focusMode ? 'Disable Focus Mode' : 'Enable Focus Mode',
        subtitle: 'Dim surrounding paragraphs to stay locked on the active block',
        icon: ICONS.bolt,
        keywords: ['focus', 'zen', 'distraction'],
        run: () => this.applyFocusMode(!this.prefs.focusMode),
      },
      {
        id: 'toggle-typewriter',
        section: 'Actions',
        label: this.prefs.typewriterMode ? 'Disable Typewriter Mode' : 'Enable Typewriter Mode',
        subtitle: 'Keep the active writing line vertically centered while typing',
        icon: ICONS.bolt,
        keywords: ['typewriter', 'center', 'scroll'],
        run: () => this.toggleTypewriterMode(),
      },
      {
        id: 'word-goal',
        section: 'Actions',
        label: 'Set Session Word Goal',
        subtitle:
          this.prefs.dailyWordGoal > 0
            ? `Current goal: ${this.prefs.dailyWordGoal.toLocaleString()} words`
            : 'Track writing progress in the footer',
        icon: ICONS.todo,
        keywords: ['goal', 'target', 'words', 'progress'],
        run: () => this.promptWordGoal(),
      },
      {
        id: 'toggle-page-mode',
        section: 'Actions',
        label:
          doc.settings.pageMode === 'paginated'
            ? 'Switch to Continuous View'
            : 'Switch to Paginated View',
        subtitle: 'Toggle between crisp page sheets and continuous manuscript flow',
        icon: doc.settings.pageMode === 'paginated' ? ICONS.continuous : ICONS.paginated,
        keywords: ['page', 'view', 'layout', 'paginated', 'continuous'],
        run: () => this.togglePageMode(),
      },
      {
        id: 'benchmark-100',
        section: 'Actions',
        label: 'Generate 100-Page Benchmark Document',
        subtitle: 'Stress-test virtualized 60–120fps scrolling & sub-16ms typing (~50,000 words)',
        icon: ICONS.bolt,
        keywords: ['100', 'page', 'stress', 'benchmark', 'performance', 'fps'],
        run: () => void this.loadBenchmarkDocument(),
      },
      ...(window.velowriteDesktop
        ? [
            {
              id: 'sync-folder',
              section: 'Actions' as const,
              label: 'Configure Folder Sync (iCloud / OneDrive / Dropbox)',
              subtitle: this.prefs.syncFolderPath
                ? `Syncing to: ${this.prefs.syncFolderPath}`
                : 'Mirror documents atomically to a local cloud-synced folder',
              icon: ICONS.folder,
              keywords: ['sync', 'folder', 'icloud', 'onedrive', 'dropbox', 'backup'],
              run: () => void this.configureSyncFolder(),
            },
            {
              id: 'check-updates',
              section: 'Actions' as const,
              label: 'Check for Updates (GitHub)',
              subtitle: this.desktopVersion
                ? `Current version v${this.desktopVersion} · Auto-updates from halxo/velowrite`
                : 'Check GitHub Releases for a newer version of VeloWrite',
              icon: ICONS.bolt,
              keywords: ['update', 'upgrade', 'version', 'github', 'release'],
              run: () => {
                this.manualUpdateCheck = true;
                void window.velowriteDesktop?.checkForUpdates();
              },
            },
          ]
        : []),

      // Export
      {
        id: 'export-pdf',
        section: 'Export',
        label: 'Export as PDF (.pdf)',
        subtitle: 'Clean paginated PDF preserving margins and typography',
        icon: ICONS.download,
        keywords: ['pdf', 'print', 'export'],
        run: () => void this.exportPdf(),
      },
      {
        id: 'export-md',
        section: 'Export',
        label: 'Export as Markdown (.md)',
        subtitle: 'Clean CommonMark with headings, checklists, math, tables, and code blocks',
        icon: ICONS.download,
        keywords: ['markdown', 'md', 'download', 'save'],
        run: () => exportToMarkdown(this.store.getDocument()),
      },
      {
        id: 'export-docx',
        section: 'Export',
        label: 'Export as Word Document (.docx)',
        subtitle: 'Standards-compliant OOXML compatible with Word and Google Docs',
        icon: ICONS.download,
        keywords: ['docx', 'word', 'google docs', 'download'],
        run: () => exportToDocx(this.store.getDocument()),
      },
      {
        id: 'export-epub',
        section: 'Export',
        label: 'Export as eBook (.epub)',
        subtitle: 'Standards-compliant EPUB 3.0 for Apple Books, Kindle, and Kobo',
        icon: ICONS.download,
        keywords: ['epub', 'ebook', 'book', 'kindle'],
        run: () => exportToEpub(this.store.getDocument()),
      },
      {
        id: 'export-html',
        section: 'Export',
        label: 'Export as Standalone Web Page (.html)',
        subtitle: 'Self-contained typographic HTML file with embedded editorial styles',
        icon: ICONS.download,
        keywords: ['html', 'web', 'page'],
        run: () => exportToHtml(this.store.getDocument()),
      },
      {
        id: 'export-json',
        section: 'Export',
        label: 'Export as JSON (.json)',
        subtitle: 'Lossless structured block model backup',
        icon: ICONS.download,
        keywords: ['json', 'backup', 'data'],
        run: () => exportToJson(this.store.getDocument()),
      },

      // Appearance
      {
        id: 'theme-light',
        section: 'Appearance',
        label: 'Theme: Light',
        subtitle: 'Crisp alabaster canvas & pure white paper',
        icon: ICONS.sun,
        keywords: ['theme', 'light', 'day'],
        run: () => this.applyTheme('light'),
      },
      {
        id: 'theme-dark',
        section: 'Appearance',
        label: 'Theme: Dark',
        subtitle: 'Deep charcoal studio palette for low-light writing',
        icon: ICONS.moon,
        keywords: ['theme', 'dark', 'night'],
        run: () => this.applyTheme('dark'),
      },
      {
        id: 'theme-sepia',
        section: 'Appearance',
        label: 'Theme: Sepia',
        subtitle: 'Warm parchment paper for extended reading & drafting',
        icon: ICONS.sepia,
        keywords: ['theme', 'sepia', 'warm', 'paper'],
        run: () => this.applyTheme('sepia'),
      },
      {
        id: 'margin-narrow',
        section: 'Appearance',
        label: 'Margins: Narrow',
        subtitle: 'Wider text measure for dense technical documents',
        icon: ICONS.paginated,
        keywords: ['margins', 'narrow'],
        run: () => this.setMargins('narrow'),
      },
      {
        id: 'margin-normal',
        section: 'Appearance',
        label: 'Margins: Normal',
        subtitle: 'Balanced editorial margins (default)',
        icon: ICONS.paginated,
        keywords: ['margins', 'normal'],
        run: () => this.setMargins('normal'),
      },
      {
        id: 'margin-wide',
        section: 'Appearance',
        label: 'Margins: Wide',
        subtitle: 'Focused book-style column width',
        icon: ICONS.paginated,
        keywords: ['margins', 'wide'],
        run: () => this.setMargins('wide'),
      },
      {
        id: 'font-serif',
        section: 'Appearance',
        label: 'Typography: Editorial Serif (Newsreader)',
        subtitle: 'Classic long-form manuscript typeface',
        icon: ICONS.quote,
        keywords: ['font', 'serif', 'typography'],
        run: () => this.setFont('serif'),
      },
      {
        id: 'font-sans',
        section: 'Appearance',
        label: 'Typography: Clean Sans (Inter)',
        subtitle: 'Modern product & technical spec typeface',
        icon: ICONS.quote,
        keywords: ['font', 'sans', 'inter', 'typography'],
        run: () => this.setFont('sans'),
      },
      {
        id: 'font-mono',
        section: 'Appearance',
        label: 'Typography: Monospace (JetBrains Mono)',
        subtitle: 'Fixed-width drafting mode',
        icon: ICONS.code,
        keywords: ['font', 'mono', 'code', 'typography'],
        run: () => this.setFont('mono'),
      },
      {
        id: 'spacing-compact',
        section: 'Appearance',
        label: 'Line Spacing: Compact (1.5)',
        icon: ICONS.continuous,
        keywords: ['spacing', 'line height', 'compact'],
        run: () => this.setLineSpacing('compact'),
      },
      {
        id: 'spacing-normal',
        section: 'Appearance',
        label: 'Line Spacing: Normal (1.72)',
        icon: ICONS.continuous,
        keywords: ['spacing', 'line height', 'normal'],
        run: () => this.setLineSpacing('normal'),
      },
      {
        id: 'spacing-relaxed',
        section: 'Appearance',
        label: 'Line Spacing: Relaxed (1.95)',
        icon: ICONS.continuous,
        keywords: ['spacing', 'line height', 'relaxed'],
        run: () => this.setLineSpacing('relaxed'),
      },
      {
        id: 'pagesize-letter',
        section: 'Appearance',
        label: 'Page Size: US Letter',
        icon: ICONS.paginated,
        keywords: ['page size', 'letter'],
        run: () => this.setPageSize('letter'),
      },
      {
        id: 'pagesize-a4',
        section: 'Appearance',
        label: 'Page Size: A4',
        icon: ICONS.paginated,
        keywords: ['page size', 'a4'],
        run: () => this.setPageSize('a4'),
      },
    ];

    for (const summary of this.recentDocs.slice(0, 8)) {
      commands.push({
        id: `doc-${summary.id}`,
        section: 'Recent Documents',
        label: summary.title,
        subtitle: `${summary.wordCount.toLocaleString()} words${
          summary.id === doc.id ? ' · Currently open' : ''
        }`,
        icon: ICONS.paginated,
        keywords: ['recent', 'document', 'open', summary.title],
        run: () => void this.openDocument(summary.id),
      });
    }

    return commands;
  }
}

const app = new VeloWriteApp();
void app.init();
