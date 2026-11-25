import './styles/main.css';
import {
  createBlankDocument,
  createWelcomeDocument,
  DocumentStore,
  generateBenchmarkDocument,
} from './model/documentStore';
import {
  DEFAULT_PREFERENCES,
  type DocumentSummary,
  type FontPreset,
  type MarginPreset,
  type ThemeMode,
  type UserPreferences,
} from './model/types';
import { VeloStorage } from './storage/indexedDB';
import {
  exportToDocx,
  exportToJson,
  exportToMarkdown,
  parseImportedJson,
} from './storage/exporters';
import { VirtualDocumentRenderer } from './editor/virtualRenderer';
import { FloatingSelectionToolbar } from './ui/selectionToolbar';
import { SlashCommandMenu } from './ui/slashMenu';
import { OutlineSidebar } from './ui/outlineSidebar';
import { CommandPalette, type PaletteCommand } from './ui/commandPalette';
import { StatusFooter } from './ui/statusFooter';
import { UpdateBanner } from './ui/updateBanner';
import { ICONS } from './ui/icons';

class VeloWriteApp {
  private storage = new VeloStorage();
  private store = new DocumentStore(createWelcomeDocument());
  private prefs: UserPreferences = { ...DEFAULT_PREFERENCES };
  private recentDocs: DocumentSummary[] = [];

  private renderer!: VirtualDocumentRenderer;
  private selectionToolbar!: FloatingSelectionToolbar;
  private slashMenu!: SlashCommandMenu;
  private sidebar!: OutlineSidebar;
  private palette!: CommandPalette;
  private footer!: StatusFooter;
  private updateBanner?: UpdateBanner;
  private manualUpdateCheck = false;
  private desktopVersion: string | null = null;

  private topbarEl!: HTMLElement;
  private titleInput!: HTMLInputElement;
  private saveStatusEl!: HTMLElement;
  private saveLabelEl!: HTMLElement;
  private pageModeBtn!: HTMLButtonElement;
  private importInput!: HTMLInputElement;
  private dimTimer: number | null = null;

  async init(): Promise<void> {
    this.topbarEl = document.getElementById('vw-topbar') as HTMLElement;
    this.titleInput = document.getElementById('vw-doc-title') as HTMLInputElement;
    this.saveStatusEl = document.getElementById('vw-save-status') as HTMLElement;
    this.saveLabelEl = this.saveStatusEl.querySelector('.vw-save-label') as HTMLElement;
    this.pageModeBtn = document.getElementById('vw-btn-page-mode') as HTMLButtonElement;
    this.importInput = document.getElementById('vw-import-json-input') as HTMLInputElement;

    const sidebarToggleBtn = document.getElementById('vw-btn-toggle-sidebar') as HTMLButtonElement;
    sidebarToggleBtn.innerHTML = ICONS.sidebar;

    // Load preferences and persisted document from IndexedDB
    try {
      this.prefs = await this.storage.getPreferences();
      this.applyTheme(this.prefs.theme, false);

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
      this.recentDocs = await this.storage.listDocumentSummaries();
    } catch {
      this.applyTheme('light', false);
    }

    this.initComponents();
    this.bindGlobalEvents(sidebarToggleBtn);
    this.syncChromeFromStore();
  }

  private initComponents(): void {
    const scrollContainer = document.getElementById('vw-scroll-container') as HTMLElement;
    const pageSurface = document.getElementById('vw-page-surface') as HTMLElement;
    const sidebarEl = document.getElementById('vw-sidebar') as HTMLElement;
    const footerEl = document.getElementById('vw-footer') as HTMLElement;

    this.footer = new StatusFooter(footerEl);

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

    this.renderer = new VirtualDocumentRenderer(this.store, scrollContainer, pageSurface, {
      onSlashStateChange: (state) => this.slashMenu.update(state),
      onSlashKeyDown: (e) => this.slashMenu.handleKeyDown(e),
      onSelectionToolbarChange: (state) => this.selectionToolbar.update(state),
      onLatencySample: (ms) => this.footer.updateLatency(ms),
      onActiveHeadingChange: (id) => this.sidebar.setActiveHeading(id),
      onTypingActivity: () => this.handleTypingActivity(),
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
      }
    });

    this.store.subscribe((ev) => {
      this.footer.updateStats(this.store.getStats());

      if (
        ev.kind === 'load' ||
        ev.kind === 'block-type' ||
        ev.kind === 'block-insert' ||
        ev.kind === 'block-delete' ||
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

      if (ev.kind !== 'load') {
        this.storage.scheduleAutosave(this.store.getDocument());
      }
    });
  }

  private bindGlobalEvents(sidebarToggleBtn: HTMLButtonElement): void {
    sidebarToggleBtn.addEventListener('click', () => this.toggleSidebar());

    this.pageModeBtn.addEventListener('click', () => this.togglePageMode());

    document
      .getElementById('vw-btn-palette')
      ?.addEventListener('click', () => this.palette.open());

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
      const imported = parseImportedJson(text);
      if (imported) {
        await this.storage.flushPendingSave();
        this.store.loadDocument(imported);
        await this.storage.saveDocumentImmediate(imported);
        await this.saveLastDocPref(imported.id);
        await this.refreshRecentDocs();
      }
    });

    // Global keyboard shortcuts
    window.addEventListener('keydown', (e) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        this.palette.toggle();
      } else if (mod && e.key === '\\') {
        e.preventDefault();
        this.toggleSidebar();
      }
    });

    // Restore topbar opacity on mouse movement
    window.addEventListener(
      'mousemove',
      () => {
        if (this.topbarEl.classList.contains('is-dimmed')) {
          this.topbarEl.classList.remove('is-dimmed');
        }
      },
      { passive: true }
    );

    // Flush any pending IndexedDB autosave before tab closes
    window.addEventListener('beforeunload', () => {
      void this.storage.flushPendingSave();
    });
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

  private applyTheme(theme: ThemeMode, persist = true): void {
    this.prefs.theme = theme;
    document.documentElement.dataset.theme = theme;
    if (persist) {
      void this.storage.savePreferences(this.prefs);
    }
  }

  private async saveLastDocPref(docId: string): Promise<void> {
    this.prefs.lastDocumentId = docId;
    await this.storage.savePreferences(this.prefs);
  }

  private async refreshRecentDocs(): Promise<void> {
    this.recentDocs = await this.storage.listDocumentSummaries();
    this.sidebar.renderDocuments(this.recentDocs, this.store.getDocument().id);
  }

  private async createNewDocument(): Promise<void> {
    await this.storage.flushPendingSave();
    const doc = createBlankDocument('Untitled Document');
    this.store.loadDocument(doc);
    await this.storage.saveDocumentImmediate(doc);
    await this.saveLastDocPref(doc.id);
    await this.refreshRecentDocs();
    this.syncChromeFromStore();
    const first = doc.blocks[0];
    if (first) this.renderer.focusBlock(first.id, 0);
  }

  private async openDocument(docId: string): Promise<void> {
    if (docId === this.store.getDocument().id) return;
    await this.storage.flushPendingSave();
    const doc = await this.storage.getDocument(docId);
    if (!doc) return;
    this.store.loadDocument(doc);
    await this.saveLastDocPref(doc.id);
    this.syncChromeFromStore();
  }

  private async deleteDocument(docId: string): Promise<void> {
    await this.storage.deleteDocument(docId);
    const remaining = await this.storage.listDocumentSummaries();
    if (remaining.length === 0) {
      await this.createNewDocument();
      return;
    }
    if (docId === this.store.getDocument().id) {
      const next = await this.storage.getDocument(remaining[0].id);
      if (next) {
        this.store.loadDocument(next);
        await this.saveLastDocPref(next.id);
      }
    }
    this.recentDocs = remaining;
    this.syncChromeFromStore();
  }

  private async loadBenchmarkDocument(): Promise<void> {
    await this.storage.flushPendingSave();
    const bench = generateBenchmarkDocument();
    this.store.loadDocument(bench);
    await this.storage.saveDocumentImmediate(bench);
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
        subtitle: 'Create a fresh local-first document in IndexedDB',
        icon: ICONS.plus,
        keywords: ['create', 'file', 'blank'],
        run: () => void this.createNewDocument(),
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
      {
        id: 'import-json',
        section: 'Actions',
        label: 'Import VeloWrite JSON',
        subtitle: 'Load a previously exported .json document into IndexedDB',
        icon: ICONS.download,
        keywords: ['open', 'upload', 'json'],
        run: () => this.importInput.click(),
      },
      ...(window.velowriteDesktop
        ? [
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
        id: 'export-md',
        section: 'Export',
        label: 'Export as Markdown (.md)',
        subtitle: 'Clean CommonMark with headings, lists, quotes, and code blocks',
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
        keywords: ['margins', 'narrow', 'wide text'],
        run: () => this.setMargins('narrow'),
      },
      {
        id: 'margin-normal',
        section: 'Appearance',
        label: 'Margins: Normal',
        subtitle: 'Balanced editorial margins (default)',
        icon: ICONS.paginated,
        keywords: ['margins', 'normal', 'default'],
        run: () => this.setMargins('normal'),
      },
      {
        id: 'margin-wide',
        section: 'Appearance',
        label: 'Margins: Wide',
        subtitle: 'Focused book-style column width',
        icon: ICONS.paginated,
        keywords: ['margins', 'wide', 'focused'],
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
