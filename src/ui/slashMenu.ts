import type { SlashTriggerState } from '../editor/virtualRenderer';
import type { BlockType } from '../model/types';
import { ICONS } from './icons';

interface SlashCommandItem {
  type: BlockType;
  label: string;
  description: string;
  shortcut: string;
  icon: string;
  keywords: string[];
}

const SLASH_ITEMS: SlashCommandItem[] = [
  {
    type: 'paragraph',
    label: 'Text',
    description: 'Plain body paragraph',
    shortcut: 'Text',
    icon: `<span class="vw-slash-glyph">¶</span>`,
    keywords: ['text', 'paragraph', 'p', 'body'],
  },
  {
    type: 'heading1',
    label: 'Heading 1',
    description: 'Large document title or chapter',
    shortcut: '#',
    icon: `<span class="vw-slash-glyph">H1</span>`,
    keywords: ['h1', 'heading', 'title', 'chapter'],
  },
  {
    type: 'heading2',
    label: 'Heading 2',
    description: 'Major section heading',
    shortcut: '##',
    icon: `<span class="vw-slash-glyph">H2</span>`,
    keywords: ['h2', 'heading', 'section', 'subtitle'],
  },
  {
    type: 'heading3',
    label: 'Heading 3',
    description: 'Subsection heading',
    shortcut: '###',
    icon: `<span class="vw-slash-glyph">H3</span>`,
    keywords: ['h3', 'heading', 'subsection'],
  },
  {
    type: 'bullet-list',
    label: 'Bulleted List',
    description: 'Unordered list item',
    shortcut: '-',
    icon: ICONS.bulletList,
    keywords: ['bullet', 'list', 'ul', 'unordered'],
  },
  {
    type: 'numbered-list',
    label: 'Numbered List',
    description: 'Ordered sequence item',
    shortcut: '1.',
    icon: ICONS.numberedList,
    keywords: ['number', 'ordered', 'list', 'ol'],
  },
  {
    type: 'todo',
    label: 'Checklist / To-Do',
    description: 'Interactive task checkbox',
    shortcut: '[]',
    icon: ICONS.todo,
    keywords: ['todo', 'checkbox', 'task', 'checklist'],
  },
  {
    type: 'blockquote',
    label: 'Quote',
    description: 'Editorial callout or citation',
    shortcut: '>',
    icon: ICONS.quote,
    keywords: ['quote', 'blockquote', 'citation'],
  },
  {
    type: 'callout',
    label: 'Callout Box',
    description: 'Highlighted note or key takeaway',
    shortcut: '!',
    icon: ICONS.callout,
    keywords: ['callout', 'note', 'alert', 'box'],
  },
  {
    type: 'toggle',
    label: 'Toggle Section',
    description: 'Collapsible details block',
    shortcut: '>>',
    icon: ICONS.toggle,
    keywords: ['toggle', 'collapse', 'accordion', 'details'],
  },
  {
    type: 'table',
    label: 'Table',
    description: 'Lightweight editable data grid',
    shortcut: '/table',
    icon: ICONS.table,
    keywords: ['table', 'grid', 'rows', 'columns'],
  },
  {
    type: 'image',
    label: 'Image',
    description: 'Insert local image from disk',
    shortcut: '/image',
    icon: ICONS.image,
    keywords: ['image', 'photo', 'picture', 'media'],
  },
  {
    type: 'math',
    label: 'Math Equation',
    description: 'Display LaTeX formula (e.g. \\frac, \\sum, \\alpha)',
    shortcut: '$$',
    icon: `<span class="vw-slash-glyph">∑</span>`,
    keywords: ['math', 'latex', 'equation', 'formula', 'katex'],
  },
  {
    type: 'code-block',
    label: 'Code Block',
    description: 'Syntax-highlighted monospace snippet',
    shortcut: '```',
    icon: ICONS.code,
    keywords: ['code', 'snippet', 'pre', 'monospace'],
  },
  {
    type: 'divider',
    label: 'Divider',
    description: 'Subtle horizontal section break',
    shortcut: '---',
    icon: ICONS.divider,
    keywords: ['divider', 'hr', 'line', 'separator', 'rule'],
  },
];

export class SlashCommandMenu {
  private el: HTMLDivElement;
  private listEl: HTMLDivElement;
  private filtered: SlashCommandItem[] = SLASH_ITEMS;
  private selectedIndex = 0;
  private activeBlockId = '';
  private isOpen = false;
  private onSelect: (blockId: string, type: BlockType) => void;
  private onClose: () => void;

  constructor(
    onSelect: (blockId: string, type: BlockType) => void,
    onClose: () => void
  ) {
    this.onSelect = onSelect;
    this.onClose = onClose;

    this.el = document.createElement('div');
    this.el.id = 'vw-slash-menu';
    this.el.className = 'vw-slash-menu';
    this.el.setAttribute('role', 'listbox');
    this.el.setAttribute('aria-label', 'Insert block');

    const header = document.createElement('div');
    header.className = 'vw-slash-header';
    header.textContent = 'Insert Block';

    this.listEl = document.createElement('div');
    this.listEl.className = 'vw-slash-list';

    this.el.appendChild(header);
    this.el.appendChild(this.listEl);
    document.body.appendChild(this.el);

    this.el.addEventListener('mousedown', (e) => e.preventDefault());
    document.addEventListener('mousedown', (e) => {
      if (this.isOpen && !this.el.contains(e.target as Node)) {
        this.onClose();
      }
    });
  }

  update(state: SlashTriggerState): void {
    if (!state.open || !state.rect) {
      this.isOpen = false;
      this.el.classList.remove('is-visible');
      return;
    }

    this.isOpen = true;
    this.activeBlockId = state.blockId;

    const q = state.query.trim().toLowerCase();
    this.filtered = q
      ? SLASH_ITEMS.filter(
          (item) =>
            item.label.toLowerCase().includes(q) ||
            item.description.toLowerCase().includes(q) ||
            item.keywords.some((k) => k.includes(q))
        )
      : SLASH_ITEMS;

    if (this.filtered.length === 0) {
      this.el.classList.remove('is-visible');
      return;
    }

    this.selectedIndex = Math.min(this.selectedIndex, this.filtered.length - 1);
    this.renderItems();
    this.el.classList.add('is-visible');

    const menuHeight = Math.min(340, this.filtered.length * 46 + 40);
    const left = Math.max(12, Math.min(state.rect.left, window.innerWidth - 280));
    const spaceBelow = window.innerHeight - state.rect.bottom;
    const top =
      spaceBelow > menuHeight + 16
        ? state.rect.bottom + 6
        : Math.max(56, state.rect.top - menuHeight - 6);

    this.el.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
  }

  handleKeyDown(e: KeyboardEvent): boolean {
    if (!this.isOpen || this.filtered.length === 0) return false;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.selectedIndex = (this.selectedIndex + 1) % this.filtered.length;
      this.updateActiveSelection();
      return true;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.selectedIndex =
        (this.selectedIndex - 1 + this.filtered.length) % this.filtered.length;
      this.updateActiveSelection();
      return true;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      const chosen = this.filtered[this.selectedIndex];
      if (chosen) {
        this.onSelect(this.activeBlockId, chosen.type);
      }
      return true;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      this.onClose();
      return true;
    }
    return false;
  }

  private renderItems(): void {
    this.listEl.innerHTML = '';
    this.filtered.forEach((item, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `vw-slash-item${idx === this.selectedIndex ? ' is-selected' : ''}`;
      btn.setAttribute('role', 'option');
      btn.innerHTML = `
        <span class="vw-slash-icon">${item.icon}</span>
        <span class="vw-slash-meta">
          <span class="vw-slash-label">${item.label}</span>
          <span class="vw-slash-desc">${item.description}</span>
        </span>
        <kbd class="vw-slash-kbd">${item.shortcut}</kbd>
      `;
      btn.addEventListener('mouseenter', () => {
        this.selectedIndex = idx;
        this.updateActiveSelection();
      });
      btn.addEventListener('click', () => {
        this.onSelect(this.activeBlockId, item.type);
      });
      this.listEl.appendChild(btn);
    });
  }

  private updateActiveSelection(): void {
    const items = this.listEl.querySelectorAll<HTMLButtonElement>('.vw-slash-item');
    items.forEach((el, idx) => {
      const active = idx === this.selectedIndex;
      el.classList.toggle('is-selected', active);
      if (active) {
        el.scrollIntoView({ block: 'nearest' });
      }
    });
  }
}
