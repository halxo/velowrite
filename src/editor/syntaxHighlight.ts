const KEYWORDS_BY_LANG: Record<string, Set<string>> = {
  typescript: new Set([
    'import', 'export', 'from', 'const', 'let', 'var', 'function', 'return',
    'if', 'else', 'for', 'while', 'switch', 'case', 'break', 'continue',
    'class', 'interface', 'type', 'extends', 'implements', 'new', 'async',
    'await', 'try', 'catch', 'finally', 'throw', 'typeof', 'keyof', 'in',
    'of', 'true', 'false', 'null', 'undefined', 'void', 'private', 'public',
  ]),
  javascript: new Set([
    'import', 'export', 'from', 'const', 'let', 'var', 'function', 'return',
    'if', 'else', 'for', 'while', 'switch', 'case', 'break', 'continue',
    'class', 'extends', 'new', 'async', 'await', 'try', 'catch', 'finally',
    'throw', 'typeof', 'in', 'of', 'true', 'false', 'null', 'undefined',
  ]),
  python: new Set([
    'import', 'from', 'as', 'def', 'return', 'if', 'elif', 'else', 'for',
    'while', 'in', 'not', 'and', 'or', 'class', 'with', 'try', 'except',
    'finally', 'raise', 'async', 'await', 'pass', 'break', 'continue',
    'True', 'False', 'None', 'lambda', 'yield',
  ]),
  rust: new Set([
    'fn', 'let', 'mut', 'const', 'pub', 'struct', 'enum', 'impl', 'trait',
    'use', 'mod', 'match', 'if', 'else', 'for', 'while', 'loop', 'return',
    'async', 'await', 'move', 'where', 'true', 'false', 'Some', 'None',
    'Ok', 'Err', 'Self', 'self',
  ]),
  go: new Set([
    'package', 'import', 'func', 'return', 'var', 'const', 'type', 'struct',
    'interface', 'if', 'else', 'for', 'range', 'switch', 'case', 'default',
    'go', 'defer', 'chan', 'select', 'true', 'false', 'nil', 'make', 'len',
  ]),
  sql: new Set([
    'SELECT', 'FROM', 'WHERE', 'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET',
    'DELETE', 'CREATE', 'TABLE', 'INDEX', 'JOIN', 'LEFT', 'RIGHT', 'INNER',
    'ON', 'GROUP', 'BY', 'ORDER', 'LIMIT', 'AS', 'AND', 'OR', 'NOT', 'NULL',
    'select', 'from', 'where', 'insert', 'into', 'values', 'update', 'set',
    'delete', 'create', 'table', 'join', 'on', 'group', 'by', 'order', 'limit',
  ]),
  bash: new Set([
    'if', 'then', 'else', 'fi', 'for', 'do', 'done', 'while', 'case', 'esac',
    'export', 'local', 'echo', 'cd', 'git', 'npm', 'npx', 'true', 'false',
  ]),
  json: new Set(['true', 'false', 'null']),
};

export const SUPPORTED_CODE_LANGUAGES = [
  'typescript',
  'javascript',
  'python',
  'rust',
  'go',
  'sql',
  'bash',
  'json',
] as const;

type TokenKind = 'comment' | 'string' | 'keyword' | 'number';

const TOKEN_RE =
  /(\/\/[^\n]*|#[^\n]*|--[^\n]*|\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|\b(\d+(?:\.\d+)?)\b|\b([A-Za-z_][A-Za-z0-9_]*)\b/g;

export class CodeSyntaxHighlighter {
  private elements = new Map<HTMLElement, string>();
  private rafScheduled = false;

  register(editable: HTMLElement, lang: string): void {
    this.elements.set(editable, lang || 'typescript');
    this.schedule();
  }

  unregister(editable: HTMLElement): void {
    if (this.elements.delete(editable)) {
      this.schedule();
    }
  }

  schedule(): void {
    if (this.rafScheduled) return;
    this.rafScheduled = true;
    requestAnimationFrame(() => {
      this.rafScheduled = false;
      this.applyAll();
    });
  }

  private applyAll(): void {
    const cssHighlights = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
    const HighlightCtor = (window as unknown as { Highlight?: new (...ranges: Range[]) => unknown })
      .Highlight;
    if (!cssHighlights || !HighlightCtor) return;

    const buckets: Record<TokenKind, Range[]> = {
      comment: [],
      string: [],
      keyword: [],
      number: [],
    };

    for (const [el, lang] of this.elements) {
      if (!el.isConnected) continue;
      const textNode = el.firstChild;
      if (!textNode || textNode.nodeType !== Node.TEXT_NODE) continue;
      const text = textNode.nodeValue ?? '';
      if (!text || text.length > 16000) continue;

      const kwSet = KEYWORDS_BY_LANG[lang] ?? KEYWORDS_BY_LANG.typescript;
      TOKEN_RE.lastIndex = 0;

      let match: RegExpExecArray | null;
      while ((match = TOKEN_RE.exec(text)) !== null) {
        let kind: TokenKind | null = null;
        if (match[1]) {
          if (match[1].startsWith('#') && lang !== 'python' && lang !== 'bash') {
            continue;
          }
          if (match[1].startsWith('--') && lang !== 'sql') {
            continue;
          }
          kind = 'comment';
        } else if (match[2]) {
          kind = 'string';
        } else if (match[3]) {
          kind = 'number';
        } else if (match[4] && kwSet.has(match[4])) {
          kind = 'keyword';
        }

        if (kind) {
          const r = document.createRange();
          r.setStart(textNode, match.index);
          r.setEnd(textNode, match.index + match[0].length);
          buckets[kind].push(r);
        }
      }
    }

    (Object.keys(buckets) as TokenKind[]).forEach((kind) => {
      const key = `vw-code-${kind}`;
      if (buckets[kind].length > 0) {
        cssHighlights.set(key, new HighlightCtor(...buckets[kind]));
      } else {
        cssHighlights.delete(key);
      }
    });
  }
}
