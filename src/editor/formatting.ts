import type { BlockType } from '../model/types';

export type InlineFormatAction =
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strike'
  | 'code'
  | 'highlight'
  | 'link';

export interface ActiveFormatState {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  code: boolean;
  highlight: boolean;
  link: boolean;
}

function findAncestorTag(node: Node | null, root: HTMLElement, tags: string[]): HTMLElement | null {
  let curr: Node | null = node;
  while (curr && curr !== root) {
    if (curr.nodeType === Node.ELEMENT_NODE) {
      const el = curr as HTMLElement;
      if (tags.includes(el.tagName.toUpperCase())) {
        return el;
      }
    }
    curr = curr.parentNode;
  }
  return null;
}

function unwrapElement(el: HTMLElement): void {
  const parent = el.parentNode;
  if (!parent) return;
  while (el.firstChild) {
    parent.insertBefore(el.firstChild, el);
  }
  parent.removeChild(el);
}

function toggleInlineWrapper(root: HTMLElement, tagName: 'CODE' | 'MARK'): boolean {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return false;
  const range = sel.getRangeAt(0);
  if (range.collapsed || !root.contains(range.commonAncestorContainer)) return false;

  const existing = findAncestorTag(range.commonAncestorContainer, root, [tagName]);
  if (existing) {
    unwrapElement(existing);
    return true;
  }

  const wrapper = document.createElement(tagName.toLowerCase());
  try {
    range.surroundContents(wrapper);
  } catch {
    const contents = range.extractContents();
    wrapper.appendChild(contents);
    range.insertNode(wrapper);
  }
  sel.removeAllRanges();
  const nextRange = document.createRange();
  nextRange.selectNodeContents(wrapper);
  sel.addRange(nextRange);
  return true;
}

export function applyInlineFormat(
  root: HTMLElement,
  action: InlineFormatAction,
  url?: string
): boolean {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return false;

  switch (action) {
    case 'bold':
      return document.execCommand('bold', false);
    case 'italic':
      return document.execCommand('italic', false);
    case 'underline':
      return document.execCommand('underline', false);
    case 'strike':
      return document.execCommand('strikeThrough', false);
    case 'code':
      return toggleInlineWrapper(root, 'CODE');
    case 'highlight':
      return toggleInlineWrapper(root, 'MARK');
    case 'link': {
      const range = sel.getRangeAt(0);
      const existingLink = findAncestorTag(range.commonAncestorContainer, root, ['A']);
      if (existingLink && !url) {
        unwrapElement(existingLink);
        return true;
      }
      if (!url) return false;
      const normalized = /^(https?:|mailto:|#)/i.test(url.trim())
        ? url.trim()
        : `https://${url.trim()}`;
      if (existingLink) {
        existingLink.setAttribute('href', normalized);
        return true;
      }
      const anchor = document.createElement('a');
      anchor.href = normalized;
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      try {
        range.surroundContents(anchor);
      } catch {
        const frag = range.extractContents();
        anchor.appendChild(frag);
        range.insertNode(anchor);
      }
      sel.removeAllRanges();
      const nextRange = document.createRange();
      nextRange.selectNodeContents(anchor);
      sel.addRange(nextRange);
      return true;
    }
  }
}

export function queryActiveFormats(root: HTMLElement): ActiveFormatState {
  const sel = window.getSelection();
  const anchor = sel?.anchorNode ?? null;
  return {
    bold:
      document.queryCommandState('bold') ||
      !!findAncestorTag(anchor, root, ['B', 'STRONG']),
    italic:
      document.queryCommandState('italic') ||
      !!findAncestorTag(anchor, root, ['I', 'EM']),
    underline:
      document.queryCommandState('underline') ||
      !!findAncestorTag(anchor, root, ['U']),
    strike:
      document.queryCommandState('strikeThrough') ||
      !!findAncestorTag(anchor, root, ['S', 'STRIKE']),
    code: !!findAncestorTag(anchor, root, ['CODE']),
    highlight: !!findAncestorTag(anchor, root, ['MARK']),
    link: !!findAncestorTag(anchor, root, ['A']),
  };
}

export interface MarkdownTriggerResult {
  newType: BlockType;
  remainderText: string;
}

const MD_BLOCK_TRIGGERS: Array<{ pattern: RegExp; type: BlockType }> = [
  { pattern: /^###\s(.*)$/, type: 'heading3' },
  { pattern: /^##\s(.*)$/, type: 'heading2' },
  { pattern: /^#\s(.*)$/, type: 'heading1' },
  { pattern: /^[-*]\s(.*)$/, type: 'bullet-list' },
  { pattern: /^1\.\s(.*)$/, type: 'numbered-list' },
  { pattern: /^>\s(.*)$/, type: 'blockquote' },
];

export function detectMarkdownBlockTrigger(
  currentType: BlockType,
  plainText: string
): MarkdownTriggerResult | null {
  if (currentType !== 'paragraph') return null;

  const normalized = plainText.replace(/\u00a0/g, ' ');
  if (normalized === '```' || normalized === '``` ') {
    return { newType: 'code-block', remainderText: '' };
  }
  if (normalized === '---' || normalized === '--- ') {
    return { newType: 'divider', remainderText: '' };
  }

  for (const rule of MD_BLOCK_TRIGGERS) {
    const match = rule.pattern.exec(normalized);
    if (match) {
      return { newType: rule.type, remainderText: match[1] ?? '' };
    }
  }
  return null;
}

/**
 * Converts trailing inline markdown patterns like **bold**, *italic*, or `code`
 * when the user types a closing delimiter.
 */
export function tryInlineMarkdownConversion(root: HTMLElement): boolean {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return false;
  const range = sel.getRangeAt(0);
  if (
    range.startContainer.nodeType !== Node.TEXT_NODE ||
    !root.contains(range.startContainer)
  ) {
    return false;
  }

  const textNode = range.startContainer as Text;
  const text = textNode.nodeValue ?? '';
  const caretPos = range.startOffset;
  const beforeCaret = text.slice(0, caretPos);

  const rules: Array<{ re: RegExp; tag: string }> = [
    { re: /\*\*([^*\n]+)\*\*$/, tag: 'strong' },
    { re: /(?<!\*)\*([^*\n]+)\*$/, tag: 'em' },
    { re: /`([^`\n]+)`$/, tag: 'code' },
    { re: /==([^=\n]+)==$/, tag: 'mark' },
  ];

  for (const rule of rules) {
    const match = rule.re.exec(beforeCaret);
    if (!match) continue;

    const innerText = match[1];
    const startIdx = match.index;
    const afterCaret = text.slice(caretPos);

    const beforeText = text.slice(0, startIdx);
    const parent = textNode.parentNode;
    if (!parent) return false;

    const formattedEl = document.createElement(rule.tag);
    formattedEl.textContent = innerText;

    const trailingSpace = document.createTextNode(afterCaret || '\u200B');

    textNode.nodeValue = beforeText;
    parent.insertBefore(formattedEl, textNode.nextSibling);
    parent.insertBefore(trailingSpace, formattedEl.nextSibling);

    const nextRange = document.createRange();
    nextRange.setStart(trailingSpace, afterCaret ? 0 : 1);
    nextRange.collapse(true);
    sel.removeAllRanges();
    sel.addRange(nextRange);
    return true;
  }

  return false;
}
