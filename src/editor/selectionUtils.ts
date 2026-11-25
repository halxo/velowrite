export interface CaretPosition {
  offset: number;
  length: number;
  isAtStart: boolean;
  isAtEnd: boolean;
}

export function getCaretOffsetInElement(root: HTMLElement): CaretPosition {
  const sel = window.getSelection();
  const totalLen = (root.textContent ?? '').length;
  if (!sel || sel.rangeCount === 0) {
    return { offset: 0, length: totalLen, isAtStart: true, isAtEnd: totalLen === 0 };
  }
  const range = sel.getRangeAt(0);
  if (!root.contains(range.startContainer)) {
    return { offset: 0, length: totalLen, isAtStart: true, isAtEnd: totalLen === 0 };
  }

  const preRange = document.createRange();
  preRange.selectNodeContents(root);
  preRange.setEnd(range.startContainer, range.startOffset);
  const offset = preRange.toString().length;

  return {
    offset,
    length: totalLen,
    isAtStart: offset === 0 && range.collapsed,
    isAtEnd: offset >= totalLen && range.collapsed,
  };
}

export function setCaretOffsetInElement(
  root: HTMLElement,
  targetOffset: number
): void {
  const sel = window.getSelection();
  if (!sel) return;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let remaining = Math.max(0, targetOffset);
  let lastText: Text | null = null;
  let node = walker.nextNode() as Text | null;

  while (node) {
    lastText = node;
    const len = node.nodeValue?.length ?? 0;
    if (remaining <= len) {
      const range = document.createRange();
      range.setStart(node, remaining);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      return;
    }
    remaining -= len;
    node = walker.nextNode() as Text | null;
  }

  const range = document.createRange();
  if (lastText) {
    range.setStart(lastText, lastText.nodeValue?.length ?? 0);
  } else {
    range.selectNodeContents(root);
  }
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
}

export function splitHtmlAtCaret(root: HTMLElement): {
  beforeHtml: string;
  afterHtml: string;
} {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) {
    return { beforeHtml: root.innerHTML, afterHtml: '' };
  }
  const range = sel.getRangeAt(0);
  if (!root.contains(range.startContainer)) {
    return { beforeHtml: root.innerHTML, afterHtml: '' };
  }

  const beforeRange = document.createRange();
  beforeRange.selectNodeContents(root);
  beforeRange.setEnd(range.startContainer, range.startOffset);

  const afterRange = document.createRange();
  afterRange.selectNodeContents(root);
  afterRange.setStart(range.endContainer, range.endOffset);

  const beforeFrag = beforeRange.cloneContents();
  const afterFrag = afterRange.cloneContents();

  const bDiv = document.createElement('div');
  bDiv.appendChild(beforeFrag);
  const aDiv = document.createElement('div');
  aDiv.appendChild(afterFrag);

  return {
    beforeHtml: bDiv.innerHTML,
    afterHtml: aDiv.innerHTML,
  };
}

export function isCaretOnFirstVisualLine(root: HTMLElement): boolean {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return true;
  const range = sel.getRangeAt(0);
  const caretRect = range.getBoundingClientRect();
  const rootRect = root.getBoundingClientRect();
  if (caretRect.height === 0 && caretRect.top === 0) {
    return getCaretOffsetInElement(root).offset === 0;
  }
  return caretRect.top - rootRect.top < 24;
}

export function isCaretOnLastVisualLine(root: HTMLElement): boolean {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return true;
  const range = sel.getRangeAt(0);
  const caretRect = range.getBoundingClientRect();
  const rootRect = root.getBoundingClientRect();
  if (caretRect.height === 0 && caretRect.bottom === 0) {
    const pos = getCaretOffsetInElement(root);
    return pos.offset >= pos.length;
  }
  return rootRect.bottom - caretRect.bottom < 24;
}
