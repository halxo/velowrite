export class ShortcutsModal {
  private overlay: HTMLDivElement;

  constructor() {
    this.overlay = document.createElement('div');
    this.overlay.id = 'vw-shortcuts-overlay';
    this.overlay.className = 'vw-modal-overlay';
    this.overlay.setAttribute('role', 'dialog');
    this.overlay.setAttribute('aria-modal', 'true');
    this.overlay.setAttribute('aria-label', 'Keyboard Shortcuts & Markdown Guide');

    this.overlay.innerHTML = `
      <div class="vw-shortcuts-modal">
        <div class="vw-snapshot-header">
          <div>
            <h2 class="vw-snapshot-title">Keyboard Shortcuts &amp; Markdown Flow</h2>
            <p class="vw-snapshot-sub">Engineered for zero-mouse drafting</p>
          </div>
          <button type="button" id="vw-shortcuts-close" class="vw-icon-btn" aria-label="Close">×</button>
        </div>
        <div class="vw-shortcuts-grid">
          <div class="vw-shortcut-col">
            <h3>Navigation &amp; Desktop</h3>
            <div class="vw-sc-row"><span>Command Palette</span><kbd>Ctrl/⌘ + K</kbd></div>
            <div class="vw-sc-row"><span>Find &amp; Replace</span><kbd>Ctrl/⌘ + F / H</kbd></div>
            <div class="vw-sc-row"><span>Open File from Disk</span><kbd>Ctrl/⌘ + O</kbd></div>
            <div class="vw-sc-row"><span>Save File to Disk</span><kbd>Ctrl/⌘ + S</kbd></div>
            <div class="vw-sc-row"><span>Toggle Outline Sidebar</span><kbd>Ctrl/⌘ + \\</kbd></div>
            <div class="vw-sc-row"><span>Toggle Split Reference</span><kbd>Ctrl/⌘ + Alt + \\</kbd></div>
            <div class="vw-sc-row"><span>Cycle Open Tabs</span><kbd>Ctrl + Tab</kbd></div>
            <div class="vw-sc-row"><span>Move Block Up / Down</span><kbd>Ctrl/⌘ + ⇧ + ↑/↓</kbd></div>
          </div>
          <div class="vw-shortcut-col">
            <h3>Inline &amp; Markdown Triggers</h3>
            <div class="vw-sc-row"><span>Slash Block Menu</span><kbd>/</kbd></div>
            <div class="vw-sc-row"><span>Headings 1–3</span><kbd>#  ##  ###</kbd></div>
            <div class="vw-sc-row"><span>Checklist / Bullet / Number</span><kbd>[]  -  1.</kbd></div>
            <div class="vw-sc-row"><span>Quote / Callout / Toggle</span><kbd>&gt;  !  &gt;&gt;</kbd></div>
            <div class="vw-sc-row"><span>Code Block / Math Equation</span><kbd>\`\`\`  $$</kbd></div>
            <div class="vw-sc-row"><span>Bold / Italic / Underline</span><kbd>Ctrl/⌘ + B / I / U</kbd></div>
            <div class="vw-sc-row"><span>Inline Code</span><kbd>Ctrl/⌘ + E</kbd></div>
            <div class="vw-sc-row"><span>Undo / Redo</span><kbd>Ctrl/⌘ + Z / ⇧Z</kbd></div>
          </div>
        </div>
      </div>
    `;

    this.overlay.addEventListener('mousedown', (e) => {
      if (e.target === this.overlay) this.close();
    });
    this.overlay.querySelector('#vw-shortcuts-close')?.addEventListener('click', () => this.close());
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.overlay.classList.contains('is-open')) {
        this.close();
      }
    });

    document.body.appendChild(this.overlay);
  }

  open(): void {
    this.overlay.classList.add('is-open');
  }

  close(): void {
    this.overlay.classList.remove('is-open');
  }

  toggle(): void {
    this.overlay.classList.toggle('is-open');
  }
}
