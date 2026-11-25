const ALLOWED_TAGS = new Set([
  'B',
  'STRONG',
  'I',
  'EM',
  'U',
  'S',
  'STRIKE',
  'CODE',
  'MARK',
  'A',
  'BR',
]);

const URL_PROTOCOL_RE = /^(https?:|mailto:|#)/i;

let scratchDiv: HTMLDivElement | null = null;

function getScratchDiv(): HTMLDivElement {
  if (!scratchDiv) {
    scratchDiv = document.createElement('div');
  }
  return scratchDiv;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function sanitizeInlineHtml(rawHtml: string): string {
  if (!rawHtml) return '';
  const container = getScratchDiv();
  container.innerHTML = rawHtml;
  const cleaned = cleanNodeChildren(container);
  container.innerHTML = '';
  return cleaned;
}

function cleanNodeChildren(parent: Node): string {
  let out = '';
  for (let i = 0; i < parent.childNodes.length; i++) {
    const node = parent.childNodes[i];
    if (node.nodeType === Node.TEXT_NODE) {
      out += escapeHtml(node.textContent ?? '');
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      const tag = el.tagName.toUpperCase();
      if (tag === 'BR') {
        out += '<br>';
        continue;
      }
      if (tag === 'SPAN') {
        const inner = cleanNodeChildren(el);
        const style = el.style;
        let wrapped = inner;
        if (style.fontWeight === 'bold' || Number(style.fontWeight) >= 600) {
          wrapped = `<strong>${wrapped}</strong>`;
        }
        if (style.fontStyle === 'italic') {
          wrapped = `<em>${wrapped}</em>`;
        }
        if (style.textDecoration.includes('underline')) {
          wrapped = `<u>${wrapped}</u>`;
        }
        if (style.backgroundColor && style.backgroundColor !== 'transparent') {
          wrapped = `<mark>${wrapped}</mark>`;
        }
        out += wrapped;
        continue;
      }
      if (!ALLOWED_TAGS.has(tag)) {
        out += cleanNodeChildren(el);
        continue;
      }
      const normalizedTag = normalizeTag(tag);
      if (normalizedTag === 'a') {
        const href = el.getAttribute('href')?.trim() ?? '';
        const safeHref = URL_PROTOCOL_RE.test(href) ? escapeHtml(href) : '#';
        out += `<a href="${safeHref}" target="_blank" rel="noopener noreferrer">${cleanNodeChildren(el)}</a>`;
      } else {
        out += `<${normalizedTag}>${cleanNodeChildren(el)}</${normalizedTag}>`;
      }
    }
  }
  return out;
}

function normalizeTag(tag: string): string {
  switch (tag) {
    case 'B':
    case 'STRONG':
      return 'strong';
    case 'I':
    case 'EM':
      return 'em';
    case 'STRIKE':
    case 'S':
      return 's';
    default:
      return tag.toLowerCase();
  }
}

export function extractPlainText(html: string): string {
  if (!html) return '';
  if (!html.includes('<') && !html.includes('&')) {
    return html;
  }
  const container = getScratchDiv();
  container.innerHTML = html;
  const text = container.textContent ?? '';
  container.innerHTML = '';
  return text;
}

export function countWords(text: string): number {
  let count = 0;
  let inWord = false;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const isSpace =
      code === 32 ||
      code === 9 ||
      code === 10 ||
      code === 13 ||
      code === 160;
    if (isSpace) {
      inWord = false;
    } else if (!inWord) {
      inWord = true;
      count++;
    }
  }
  return count;
}

export function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `b_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
