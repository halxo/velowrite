import { escapeHtml } from '../model/sanitize';
import { ICONS } from './icons';

export interface PaletteCommand {
  id: string;
  section: 'Actions' | 'Export' | 'Appearance' | 'Recent Documents';
  label: string;
  subtitle?: string;
  shortcut?: string;
  icon: string;
  keywords?: string[];
  run: () => void;
}

export class CommandPalette {
  private overlay: HTMLDivElement;
  private input: HTMLInputElement;
  private listEl: HTMLDivElement;
  private commandsProvider: () => PaletteCommand[];
  private allCommands: PaletteCommand[] = [];
  private filtered: PaletteCommand[] = [];
  private selectedIndex = 0;
  private isOpen = false;

  constructor(commandsProvider: () => PaletteCommand[]) {
    this.commandsProvider = commandsProvider;

    this.overlay = document.createElement('div');
    this.overlay.id = 'vw-command-palette-overlay';
    this.overlay.className = 'vw-palette-overlay';
    this.overlay.setAttribute('role', 'dialog');
    this.overlay.setAttribute('aria-modal', 'true');
    this.overlay.setAttribute('aria-label', 'Command Palette');

    this.overlay.innerHTML = `
      <div class="vw-palette-modal">
        <div class="vw-palette-search">
          <span class="vw-palette-search-icon">${ICONS.search}</span>
          <input
            type="text"
            id="vw-palette-input"
            class="vw-palette-input"
            placeholder="Search actions, exports, themes, or recent documents…"
            autocomplete="off"
            spellcheck="false"
          />
          <kbd class="vw-palette-esc">ESC</kbd>
        </div>
        <div class="vw-palette-results" role="listbox"></div>
      </div>
    `;

    this.input = this.overlay.querySelector('#vw-palette-input') as HTMLInputElement;
    this.listEl = this.overlay.querySelector('.vw-palette-results') as HTMLDivElement;

    this.bindEvents();
    document.body.appendChild(this.overlay);
  }

  private bindEvents(): void {
    this.overlay.addEventListener('mousedown', (e) => {
      if (e.target === this.overlay) {
        this.close();
      }
    });

    this.input.addEventListener('input', () => {
      this.selectedIndex = 0;
      this.filterAndRender();
    });

    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (this.filtered.length > 0) {
          this.selectedIndex = (this.selectedIndex + 1) % this.filtered.length;
          this.updateSelectionHighlight();
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (this.filtered.length > 0) {
          this.selectedIndex =
            (this.selectedIndex - 1 + this.filtered.length) % this.filtered.length;
          this.updateSelectionHighlight();
        }
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const cmd = this.filtered[this.selectedIndex];
        if (cmd) {
          this.close();
          cmd.run();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      }
    });
  }

  open(): void {
    this.allCommands = this.commandsProvider();
    this.input.value = '';
    this.selectedIndex = 0;
    this.isOpen = true;
    this.filterAndRender();
    this.overlay.classList.add('is-open');
    requestAnimationFrame(() => this.input.focus());
  }

  close(): void {
    this.isOpen = false;
    this.overlay.classList.remove('is-open');
  }

  toggle(): void {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  private filterAndRender(): void {
    const q = this.input.value.trim().toLowerCase();
    if (!q) {
      this.filtered = this.allCommands;
    } else {
      const terms = q.split(/\s+/);
      this.filtered = this.allCommands.filter((cmd) => {
        const haystack = `${cmd.label} ${cmd.subtitle ?? ''} ${cmd.section} ${(cmd.keywords ?? []).join(' ')}`.toLowerCase();
        return terms.every((t) => haystack.includes(t));
      });
    }

    this.listEl.innerHTML = '';

    if (this.filtered.length === 0) {
      this.listEl.innerHTML = `<div class="vw-palette-empty">No matching commands found.</div>`;
      return;
    }

    const frag = document.createDocumentFragment();
    let lastSection = '';

    this.filtered.forEach((cmd, idx) => {
      if (cmd.section !== lastSection) {
        lastSection = cmd.section;
        const secEl = document.createElement('div');
        secEl.className = 'vw-palette-section';
        secEl.textContent = cmd.section;
        frag.appendChild(secEl);
      }

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `vw-palette-item${idx === this.selectedIndex ? ' is-selected' : ''}`;
      btn.dataset.index = String(idx);
      btn.setAttribute('role', 'option');
      btn.innerHTML = `
        <span class="vw-palette-item-icon">${cmd.icon}</span>
        <span class="vw-palette-item-text">
          <span class="vw-palette-item-label">${escapeHtml(cmd.label)}</span>
          ${cmd.subtitle ? `<span class="vw-palette-item-sub">${escapeHtml(cmd.subtitle)}</span>` : ''}
        </span>
        ${cmd.shortcut ? `<kbd class="vw-palette-kbd">${escapeHtml(cmd.shortcut)}</kbd>` : ''}
      `;

      btn.addEventListener('mouseenter', () => {
        this.selectedIndex = idx;
        this.updateSelectionHighlight();
      });

      btn.addEventListener('click', () => {
        this.close();
        cmd.run();
      });

      frag.appendChild(btn);
    });

    this.listEl.appendChild(frag);
  }

  private updateSelectionHighlight(): void {
    const buttons = this.listEl.querySelectorAll<HTMLButtonElement>('.vw-palette-item');
    buttons.forEach((btn) => {
      const idx = Number(btn.dataset.index);
      const selected = idx === this.selectedIndex;
      btn.classList.toggle('is-selected', selected);
      if (selected) {
        btn.scrollIntoView({ block: 'nearest' });
      }
    });
  }
}
