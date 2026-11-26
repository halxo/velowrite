import type { Block, DocumentModel } from '../model/types';
import { createBlock } from '../model/documentStore';
import { escapeHtml, generateId } from '../model/sanitize';
import { renderLatexEquationHtml } from '../editor/mathRenderer';

function sanitizeFilename(title: string, ext: string): string {
  const clean = (title || 'velowrite-document')
    .replace(/[^a-z0-9\-_\s]/gi, '')
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase()
    .slice(0, 64);
  return `${clean || 'document'}.${ext}`;
}

export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ============================ JSON EXPORT & IMPORT ============================ */

export function exportToJson(doc: DocumentModel): void {
  const payload = JSON.stringify(doc, null, 2);
  const blob = new Blob([payload], { type: 'application/json;charset=utf-8' });
  triggerDownload(blob, sanitizeFilename(doc.title, 'json'));
}

export function parseImportedJson(raw: string): DocumentModel | null {
  try {
    const parsed = JSON.parse(raw) as Partial<DocumentModel>;
    if (!parsed || !Array.isArray(parsed.blocks)) return null;
    const now = Date.now();
    const blocks: Block[] = parsed.blocks.map((b) =>
      createBlock(
        b.type ?? 'paragraph',
        typeof b.html === 'string' ? b.html : b.text ?? '',
        b.align,
        {
          checked: b.checked,
          collapsed: b.collapsed,
          toggleBody: b.toggleBody,
          imageAssetId: b.imageAssetId,
          imageCaption: b.imageCaption,
          imageWidth: b.imageWidth,
          tableData: b.tableData,
          codeLang: b.codeLang,
        }
      )
    );
    return {
      id: typeof parsed.id === 'string' ? parsed.id : generateId(),
      title: typeof parsed.title === 'string' ? parsed.title : 'Imported Document',
      blocks: blocks.length > 0 ? blocks : [createBlock('paragraph', '')],
      settings: {
        pageMode: parsed.settings?.pageMode ?? 'paginated',
        margins: parsed.settings?.margins ?? 'normal',
        font: parsed.settings?.font ?? 'serif',
        lineSpacing: parsed.settings?.lineSpacing ?? 'normal',
        pageSize: parsed.settings?.pageSize ?? 'letter',
      },
      createdAt: parsed.createdAt ?? now,
      updatedAt: now,
    };
  } catch {
    return null;
  }
}

/* ========================== MARKDOWN IMPORT ========================== */

function inlineMarkdownToHtml(line: string): string {
  let out = escapeHtml(line);
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');
  out = out.replace(/==([^=]+)==/g, '<mark>$1</mark>');
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  return out;
}

export function markdownToDocument(raw: string, filenameTitle = 'Imported Markdown'): DocumentModel {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let inCode = false;
  let codeLang = 'typescript';
  let codeLines: string[] = [];
  let derivedTitle = filenameTitle.replace(/\.(md|markdown|txt)$/i, '');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.trim().startsWith('```')) {
      if (!inCode) {
        inCode = true;
        codeLang = line.trim().slice(3).trim() || 'typescript';
        codeLines = [];
      } else {
        inCode = false;
        blocks.push(createBlock('code-block', codeLines.join('\n'), undefined, { codeLang }));
      }
      continue;
    }

    if (inCode) {
      codeLines.push(line);
      continue;
    }

    if (line.trim().startsWith('$$') && line.trim().endsWith('$$') && line.trim().length > 4) {
      const expr = line.trim().slice(2, -2).trim();
      blocks.push(createBlock('math', expr));
      continue;
    }

    if (line.trim() === '$$') {
      const mathLines: string[] = [];
      i++;
      while (i < lines.length && lines[i].trim() !== '$$') {
        mathLines.push(lines[i]);
        i++;
      }
      blocks.push(createBlock('math', mathLines.join(' ').trim()));
      continue;
    }

    if (line.trim() === '') continue;

    if (/^---+$/.test(line.trim())) {
      blocks.push(createBlock('divider', ''));
      continue;
    }

    if (line.startsWith('# ')) {
      const text = line.slice(2).trim();
      if (blocks.length === 0 && text) derivedTitle = text;
      blocks.push(createBlock('heading1', inlineMarkdownToHtml(text)));
      continue;
    }
    if (line.startsWith('## ')) {
      blocks.push(createBlock('heading2', inlineMarkdownToHtml(line.slice(3).trim())));
      continue;
    }
    if (line.startsWith('### ')) {
      blocks.push(createBlock('heading3', inlineMarkdownToHtml(line.slice(4).trim())));
      continue;
    }

    const todoMatch = /^-\s\[([ xX])\]\s(.*)$/.exec(line);
    if (todoMatch) {
      blocks.push(
        createBlock('todo', inlineMarkdownToHtml(todoMatch[2]), undefined, {
          checked: todoMatch[1].toLowerCase() === 'x',
        })
      );
      continue;
    }

    if (/^[-*]\s/.test(line)) {
      blocks.push(createBlock('bullet-list', inlineMarkdownToHtml(line.slice(2))));
      continue;
    }
    if (/^\d+\.\s/.test(line)) {
      blocks.push(createBlock('numbered-list', inlineMarkdownToHtml(line.replace(/^\d+\.\s/, ''))));
      continue;
    }
    if (line.startsWith('> [!')) {
      blocks.push(createBlock('callout', inlineMarkdownToHtml(line.replace(/^>\s*\[![^\]]+\]\s*/, ''))));
      continue;
    }
    if (line.startsWith('> ')) {
      blocks.push(createBlock('blockquote', inlineMarkdownToHtml(line.slice(2))));
      continue;
    }

    if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
      const tableRows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        const rowLine = lines[i].trim();
        if (!/^\|[\s:-]+\|$/.test(rowLine.replace(/\|/g, (_m, idx, s) => (idx === 0 || idx === s.length - 1 ? '|' : '')))) {
          const cells = rowLine
            .slice(1, -1)
            .split('|')
            .map((c) => c.trim());
          if (!cells.every((c) => /^:?-+:?$/.test(c))) {
            tableRows.push(cells);
          }
        }
        i++;
      }
      i--;
      if (tableRows.length > 0) {
        blocks.push(createBlock('table', '', undefined, { tableData: tableRows }));
        continue;
      }
    }

    blocks.push(createBlock('paragraph', inlineMarkdownToHtml(line)));
  }

  const now = Date.now();
  return {
    id: generateId(),
    title: derivedTitle || 'Imported Document',
    blocks: blocks.length > 0 ? blocks : [createBlock('paragraph', '')],
    settings: {
      pageMode: 'paginated',
      margins: 'normal',
      font: 'serif',
      lineSpacing: 'normal',
      pageSize: 'letter',
    },
    createdAt: now,
    updatedAt: now,
  };
}

/* ========================== MARKDOWN EXPORT ========================== */

function inlineHtmlToMarkdown(html: string): string {
  if (!html) return '';
  const div = document.createElement('div');
  div.innerHTML = html;
  return serializeMdChildren(div);
}

function serializeMdChildren(parent: Node): string {
  let out = '';
  for (let i = 0; i < parent.childNodes.length; i++) {
    const node = parent.childNodes[i];
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent ?? '';
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      const tag = el.tagName.toUpperCase();
      const inner = serializeMdChildren(el);
      switch (tag) {
        case 'STRONG':
        case 'B':
          out += `**${inner}**`;
          break;
        case 'EM':
        case 'I':
          out += `*${inner}*`;
          break;
        case 'U':
          out += `<u>${inner}</u>`;
          break;
        case 'S':
        case 'STRIKE':
          out += `~~${inner}~~`;
          break;
        case 'CODE':
          out += `\`${inner}\``;
          break;
        case 'MARK':
          out += `==${inner}==`;
          break;
        case 'A': {
          const href = el.getAttribute('href') ?? '';
          out += `[${inner}](${href})`;
          break;
        }
        case 'BR':
          out += '  \n';
          break;
        default:
          out += inner;
      }
    }
  }
  return out;
}

export function documentToMarkdown(doc: DocumentModel): string {
  const lines: string[] = [];
  let orderedCounter = 0;

  for (let i = 0; i < doc.blocks.length; i++) {
    const b = doc.blocks[i];
    if (b.type !== 'numbered-list') {
      orderedCounter = 0;
    }

    switch (b.type) {
      case 'heading1':
        lines.push(`# ${inlineHtmlToMarkdown(b.html)}`, '');
        break;
      case 'heading2':
        lines.push(`## ${inlineHtmlToMarkdown(b.html)}`, '');
        break;
      case 'heading3':
        lines.push(`### ${inlineHtmlToMarkdown(b.html)}`, '');
        break;
      case 'bullet-list':
        lines.push(`- ${inlineHtmlToMarkdown(b.html)}`);
        if (doc.blocks[i + 1]?.type !== 'bullet-list') lines.push('');
        break;
      case 'numbered-list':
        orderedCounter++;
        lines.push(`${orderedCounter}. ${inlineHtmlToMarkdown(b.html)}`);
        if (doc.blocks[i + 1]?.type !== 'numbered-list') lines.push('');
        break;
      case 'todo':
        lines.push(`- [${b.checked ? 'x' : ' '}] ${inlineHtmlToMarkdown(b.html)}`);
        if (doc.blocks[i + 1]?.type !== 'todo') lines.push('');
        break;
      case 'blockquote':
        lines.push(`> ${inlineHtmlToMarkdown(b.html)}`, '');
        break;
      case 'callout':
        lines.push(`> [!NOTE] ${inlineHtmlToMarkdown(b.html)}`, '');
        break;
      case 'toggle':
        lines.push(`<details><summary>${inlineHtmlToMarkdown(b.html)}</summary>\n\n${b.toggleBody ?? ''}\n\n</details>`, '');
        break;
      case 'math':
        lines.push('$$', b.text, '$$', '');
        break;
      case 'code-block':
        lines.push(`\`\`\`${b.codeLang ?? ''}`, b.text, '```', '');
        break;
      case 'table':
        if (b.tableData && b.tableData.length > 0) {
          const header = b.tableData[0];
          lines.push(`| ${header.join(' | ')} |`);
          lines.push(`| ${header.map(() => '---').join(' | ')} |`);
          for (let r = 1; r < b.tableData.length; r++) {
            lines.push(`| ${b.tableData[r].join(' | ')} |`);
          }
          lines.push('');
        }
        break;
      case 'image':
        lines.push(`![${b.imageCaption ?? 'Image'}](velowrite-asset://${b.imageAssetId ?? ''})`, '');
        break;
      case 'divider':
        lines.push('---', '');
        break;
      default:
        lines.push(inlineHtmlToMarkdown(b.html), '');
        break;
    }
  }

  return lines.join('\n').trimEnd() + '\n';
}

export function exportToMarkdown(doc: DocumentModel): void {
  const md = documentToMarkdown(doc);
  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
  triggerDownload(blob, sanitizeFilename(doc.title, 'md'));
}

/* ==================== PURE-TS OOXML DOCX EXPORT ====================== */

interface TextRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  code?: boolean;
  highlight?: boolean;
  href?: string;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function parseRunsFromHtml(html: string): TextRun[] {
  const runs: TextRun[] = [];
  if (!html) return runs;
  const div = document.createElement('div');
  div.innerHTML = html;

  const walk = (node: Node, fmt: Omit<TextRun, 'text'>) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? '';
      if (text) runs.push({ text, ...fmt });
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    const tag = el.tagName.toUpperCase();
    if (tag === 'BR') {
      runs.push({ text: '\n', ...fmt });
      return;
    }
    const nextFmt: Omit<TextRun, 'text'> = { ...fmt };
    if (tag === 'STRONG' || tag === 'B') nextFmt.bold = true;
    if (tag === 'EM' || tag === 'I') nextFmt.italic = true;
    if (tag === 'U') nextFmt.underline = true;
    if (tag === 'S' || tag === 'STRIKE') nextFmt.strike = true;
    if (tag === 'CODE') nextFmt.code = true;
    if (tag === 'MARK') nextFmt.highlight = true;
    if (tag === 'A') nextFmt.href = el.getAttribute('href') ?? undefined;

    for (let i = 0; i < el.childNodes.length; i++) {
      walk(el.childNodes[i], nextFmt);
    }
  };

  for (let i = 0; i < div.childNodes.length; i++) {
    walk(div.childNodes[i], {});
  }
  return runs;
}

function buildDocxXml(doc: DocumentModel): {
  documentXml: string;
  relsXml: string;
} {
  const hyperlinks: Array<{ rId: string; target: string }> = [];
  let rIdCounter = 2;
  let orderedCounter = 0;

  const renderRun = (run: TextRun): string => {
    const rPrParts: string[] = [];
    if (run.bold) rPrParts.push('<w:b/>');
    if (run.italic) rPrParts.push('<w:i/>');
    if (run.underline || run.href) rPrParts.push('<w:u w:val="single"/>');
    if (run.strike) rPrParts.push('<w:strike/>');
    if (run.highlight) rPrParts.push('<w:highlight w:val="yellow"/>');
    if (run.code) {
      rPrParts.push('<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/>');
      rPrParts.push('<w:shd w:val="clear" w:color="auto" w:fill="F1F0EC"/>');
    }
    if (run.href) {
      rPrParts.push('<w:color w:val="1D4ED8"/>');
    }

    const rPr = rPrParts.length > 0 ? `<w:rPr>${rPrParts.join('')}</w:rPr>` : '';
    const textXml =
      run.text === '\n'
        ? '<w:br/>'
        : `<w:t xml:space="preserve">${escapeXml(run.text)}</w:t>`;
    const runXml = `<w:r>${rPr}${textXml}</w:r>`;

    if (run.href) {
      const rId = `rId${rIdCounter++}`;
      hyperlinks.push({ rId, target: run.href });
      return `<w:hyperlink r:id="${rId}">${runXml}</w:hyperlink>`;
    }
    return runXml;
  };

  const bodyElements: string[] = [];

  for (let i = 0; i < doc.blocks.length; i++) {
    const block = doc.blocks[i];
    if (block.type !== 'numbered-list') orderedCounter = 0;

    if (block.type === 'table' && block.tableData && block.tableData.length > 0) {
      const rowsXml = block.tableData
        .map(
          (row, rIdx) =>
            `<w:tr>${row
              .map(
                (cell) =>
                  `<w:tc><w:tcPr>${
                    rIdx === 0
                      ? '<w:shd w:val="clear" w:color="auto" w:fill="F1F0EC"/>'
                      : ''
                  }</w:tcPr><w:p><w:r>${
                    rIdx === 0 ? '<w:rPr><w:b/></w:rPr>' : ''
                  }<w:t xml:space="preserve">${escapeXml(cell)}</w:t></w:r></w:p></w:tc>`
              )
              .join('')}</w:tr>`
        )
        .join('');
      bodyElements.push(
        `<w:tbl><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:color="D6D3CD"/><w:left w:val="single" w:sz="4" w:color="D6D3CD"/><w:bottom w:val="single" w:sz="4" w:color="D6D3CD"/><w:right w:val="single" w:sz="4" w:color="D6D3CD"/><w:insideH w:val="single" w:sz="4" w:color="D6D3CD"/><w:insideV w:val="single" w:sz="4" w:color="D6D3CD"/></w:tblBorders></w:tblPr>${rowsXml}</w:tbl>`
      );
      continue;
    }

    if (block.type === 'image') {
      const cap = block.imageCaption ? `[Image: ${block.imageCaption}]` : '[Embedded Image]';
      bodyElements.push(`<w:p><w:r><w:rPr><w:i/><w:color w:val="78716C"/></w:rPr><w:t>${escapeXml(cap)}</w:t></w:r></w:p>`);
      continue;
    }

    const pPrParts: string[] = [];
    if (block.align && block.align !== 'left') {
      pPrParts.push(`<w:jc w:val="${block.align}"/>`);
    }

    if (block.type === 'heading1') {
      pPrParts.push('<w:pStyle w:val="Heading1"/>');
    } else if (block.type === 'heading2') {
      pPrParts.push('<w:pStyle w:val="Heading2"/>');
    } else if (block.type === 'heading3') {
      pPrParts.push('<w:pStyle w:val="Heading3"/>');
    } else if (block.type === 'blockquote' || block.type === 'callout') {
      pPrParts.push('<w:pStyle w:val="Quote"/>');
    } else if (block.type === 'code-block') {
      pPrParts.push('<w:pStyle w:val="CodeBlock"/>');
      const codeLines = block.text.split('\n');
      const codeRuns = codeLines
        .map((line, idx) => {
          const br = idx < codeLines.length - 1 ? '<w:br/>' : '';
          return `<w:r><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/><w:sz w:val="20"/></w:rPr><w:t xml:space="preserve">${escapeXml(line)}</w:t>${br}</w:r>`;
        })
        .join('');
      bodyElements.push(`<w:p><w:pPr>${pPrParts.join('')}</w:pPr>${codeRuns}</w:p>`);
      continue;
    } else if (block.type === 'divider') {
      bodyElements.push(
        '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="4" w:color="D6D3CD"/></w:pBdr></w:pPr></w:p>'
      );
      continue;
    } else if (block.type === 'bullet-list' || block.type === 'todo') {
      pPrParts.push('<w:ind w:left="540" w:hanging="260"/>');
    } else if (block.type === 'numbered-list') {
      orderedCounter++;
      pPrParts.push('<w:ind w:left="540" w:hanging="260"/>');
    }

    let prefixRun = '';
    if (block.type === 'bullet-list') {
      prefixRun = '<w:r><w:t xml:space="preserve">•  </w:t></w:r>';
    } else if (block.type === 'numbered-list') {
      prefixRun = `<w:r><w:t xml:space="preserve">${orderedCounter}.  </w:t></w:r>`;
    } else if (block.type === 'todo') {
      prefixRun = `<w:r><w:t xml:space="preserve">${block.checked ? '☑' : '☐'}  </w:t></w:r>`;
    }

    const runs = parseRunsFromHtml(block.html).map(renderRun).join('');
    const pPr = pPrParts.length > 0 ? `<w:pPr>${pPrParts.join('')}</w:pPr>` : '';
    bodyElements.push(`<w:p>${pPr}${prefixRun}${runs}</w:p>`);

    if (block.type === 'toggle' && block.toggleBody) {
      bodyElements.push(
        `<w:p><w:pPr><w:ind w:left="360"/></w:pPr><w:r><w:t xml:space="preserve">${escapeXml(block.toggleBody)}</w:t></w:r></w:p>`
      );
    }
  }

  const marginTwips =
    doc.settings.margins === 'narrow'
      ? 900
      : doc.settings.margins === 'wide'
        ? 1800
        : 1440;

  const pgSz =
    doc.settings.pageSize === 'a4'
      ? '<w:pgSz w:w="11906" w:h="16838"/>'
      : '<w:pgSz w:w="12240" w:h="15840"/>';

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    ${bodyElements.join('\n    ')}
    <w:sectPr>
      ${pgSz}
      <w:pgMar w:top="${marginTwips}" w:right="${marginTwips}" w:bottom="${marginTwips}" w:left="${marginTwips}" w:header="720" w:footer="720" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`;

  const linkRels = hyperlinks
    .map(
      (h) =>
        `  <Relationship Id="${h.rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${escapeXml(h.target)}" TargetMode="External"/>`
    )
    .join('\n');

  const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
${linkRels}
</Relationships>`;

  return { documentXml, relsXml };
}

const DOCX_STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        <w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/>
        <w:sz w:val="22"/>
        <w:color w:val="191918"/>
      </w:rPr>
    </w:rPrDefault>
    <w:pPrDefault>
      <w:pPr>
        <w:spacing w:after="140" w:line="312" w:lineRule="auto"/>
      </w:pPr>
    </w:pPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:pPr><w:spacing w:before="320" w:after="140"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="44"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:pPr><w:spacing w:before="260" w:after="100"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="32"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading3">
    <w:name w:val="heading 3"/>
    <w:pPr><w:spacing w:before="200" w:after="80"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="26"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Quote">
    <w:name w:val="Quote"/>
    <w:pPr>
      <w:ind w:left="540"/>
      <w:pBdr><w:left w:val="single" w:sz="18" w:space="12" w:color="A8A29E"/></w:pBdr>
    </w:pPr>
    <w:rPr><w:i/><w:color w:val="57534E"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="CodeBlock">
    <w:name w:val="Code Block"/>
    <w:pPr>
      <w:shd w:val="clear" w:color="auto" w:fill="F5F5F4"/>
      <w:ind w:left="240" w:right="240"/>
    </w:pPr>
    <w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/><w:sz w:val="20"/></w:rPr>
  </w:style>
</w:styles>`;

const DOCX_CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-officedocument.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

const DOCX_ROOT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildZipBlob(
  files: Array<{ name: string; content: string; asciiHeader?: boolean }>,
  mimeType: string
): Blob {
  const encoder = new TextEncoder();
  const localChunks: Uint8Array[] = [];
  const centralChunks: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const dataBytes = encoder.encode(file.content);
    const checksum = crc32(dataBytes);
    const gpFlag = file.asciiHeader ? 0x0000 : 0x0800;

    const localHeader = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(localHeader.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, gpFlag, true);
    lv.setUint16(8, 0, true);
    lv.setUint16(10, 0, true);
    lv.setUint16(12, 0, true);
    lv.setUint32(14, checksum, true);
    lv.setUint32(18, dataBytes.length, true);
    lv.setUint32(22, dataBytes.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    localHeader.set(nameBytes, 30);

    localChunks.push(localHeader, dataBytes);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(centralHeader.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, gpFlag, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0, true);
    cv.setUint32(16, checksum, true);
    cv.setUint32(20, dataBytes.length, true);
    cv.setUint32(24, dataBytes.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    centralHeader.set(nameBytes, 46);

    centralChunks.push(centralHeader);
    offset += localHeader.length + dataBytes.length;
  }

  let centralSize = 0;
  for (const c of centralChunks) centralSize += c.length;

  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  return new Blob([...localChunks, ...centralChunks, eocd] as BlobPart[], {
    type: mimeType,
  });
}

export function buildDocxBlob(doc: DocumentModel): Blob {
  const { documentXml, relsXml } = buildDocxXml(doc);
  return buildZipBlob(
    [
      { name: '[Content_Types].xml', content: DOCX_CONTENT_TYPES_XML },
      { name: '_rels/.rels', content: DOCX_ROOT_RELS_XML },
      { name: 'word/document.xml', content: documentXml },
      { name: 'word/styles.xml', content: DOCX_STYLES_XML },
      { name: 'word/_rels/document.xml.rels', content: relsXml },
    ],
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  );
}

export function exportToDocx(doc: DocumentModel): void {
  triggerDownload(buildDocxBlob(doc), sanitizeFilename(doc.title, 'docx'));
}

/* ==================== STANDALONE HTML EXPORT ==================== */

function renderBlocksBodyHtml(doc: DocumentModel, xhtmlStrict = false): string {
  const out: string[] = [];
  for (const b of doc.blocks) {
    const alignAttr = b.align && b.align !== 'left' ? ` style="text-align:${b.align}"` : '';
    const content = xhtmlStrict ? escapeXml(b.text) : b.html;
    switch (b.type) {
      case 'heading1':
        out.push(`<h1${alignAttr}>${content}</h1>`);
        break;
      case 'heading2':
        out.push(`<h2${alignAttr}>${content}</h2>`);
        break;
      case 'heading3':
        out.push(`<h3${alignAttr}>${content}</h3>`);
        break;
      case 'bullet-list':
        out.push(`<p class="li"${alignAttr}>• ${content}</p>`);
        break;
      case 'numbered-list':
        out.push(`<p class="li"${alignAttr}>1. ${content}</p>`);
        break;
      case 'todo':
        out.push(`<p class="li">${b.checked ? '☑' : '☐'} ${content}</p>`);
        break;
      case 'blockquote':
      case 'callout':
        out.push(`<blockquote>${content}</blockquote>`);
        break;
      case 'math':
        out.push(
          xhtmlStrict
            ? `<p class="math">${escapeXml(b.text)}</p>`
            : `<div class="math">${renderLatexEquationHtml(b.text)}</div>`
        );
        break;
      case 'code-block':
        out.push(`<pre><code>${escapeXml(b.text)}</code></pre>`);
        break;
      case 'divider':
        out.push(xhtmlStrict ? '<hr />' : '<hr>');
        break;
      case 'table':
        if (b.tableData && b.tableData.length > 0) {
          const rows = b.tableData
            .map(
              (r, rIdx) =>
                `<tr>${r
                  .map((c) =>
                    rIdx === 0
                      ? `<th>${escapeXml(c)}</th>`
                      : `<td>${escapeXml(c)}</td>`
                  )
                  .join('')}</tr>`
            )
            .join('');
          out.push(`<table>${rows}</table>`);
        }
        break;
      default:
        out.push(`<p${alignAttr}>${content}</p>`);
        break;
    }
  }
  return out.join('\n    ');
}

export function documentToStandaloneHtml(doc: DocumentModel): string {
  const title = escapeHtml(doc.title || 'Untitled Document');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    body { max-width: 720px; margin: 56px auto; padding: 0 24px; font-family: Georgia, 'Newsreader', serif; font-size: 18px; line-height: 1.74; color: #191918; background: #fcfbf9; }
    h1, h2, h3 { line-height: 1.28; letter-spacing: -0.02em; margin-top: 1.6em; }
    blockquote { margin: 1.2em 0; padding-left: 18px; border-left: 3px solid #c7c2b8; color: #57534e; font-style: italic; }
    pre { background: #f3f2ee; border: 1px solid #e4e2dc; border-radius: 6px; padding: 14px 18px; overflow-x: auto; font-size: 14px; line-height: 1.6; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.88em; }
    table { width: 100%; border-collapse: collapse; margin: 1.2em 0; font-family: system-ui, sans-serif; font-size: 14.5px; }
    th, td { border: 1px solid #d6d3cd; padding: 8px 10px; text-align: left; }
    th { background: #f3f2ee; }
    hr { border: none; border-top: 1px solid #d6d3cd; margin: 2em 0; }
    .math { text-align: center; font-style: italic; padding: 12px 0; font-size: 1.12em; }
    .vw-math-frac { display: inline-flex; flex-direction: column; vertical-align: middle; text-align: center; padding: 0 3px; }
    .vw-math-num { border-bottom: 1px solid currentColor; padding: 0 3px; }
    .li { margin: 0.25em 0 0.25em 1em; }
  </style>
</head>
<body>
  <article>
    ${renderBlocksBodyHtml(doc, false)}
  </article>
</body>
</html>`;
}

export function exportToHtml(doc: DocumentModel): void {
  const html = documentToStandaloneHtml(doc);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  triggerDownload(blob, sanitizeFilename(doc.title, 'html'));
}

/* ==================== EPUB 3.0 EBOOK EXPORT ==================== */

export function buildEpubBlob(doc: DocumentModel): Blob {
  const title = escapeXml(doc.title || 'Untitled Document');
  const bookId = `urn:uuid:${escapeXml(doc.id || generateId())}`;
  const modified = new Date(doc.updatedAt || Date.now()).toISOString().replace(/\.\d+Z$/, 'Z');

  const containerXml = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

  const contentOpf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">${bookId}</dc:identifier>
    <dc:title>${title}</dc:title>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">${modified}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="chapter1" href="document.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="chapter1"/>
  </spine>
</package>`;

  const navXhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>${title}</title></head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>Contents</h1>
    <ol><li><a href="document.xhtml">${title}</a></li></ol>
  </nav>
</body>
</html>`;

  const chapterXhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <title>${title}</title>
  <style>
    body { font-family: Georgia, serif; line-height: 1.68; margin: 1.2em; }
    blockquote { border-left: 2px solid #999; padding-left: 12px; font-style: italic; }
    pre { background: #f4f4f4; padding: 10px; font-family: monospace; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #ccc; padding: 6px; }
  </style>
</head>
<body>
  ${renderBlocksBodyHtml(doc, true)}
</body>
</html>`;

  return buildZipBlob(
    [
      { name: 'mimetype', content: 'application/epub+zip', asciiHeader: true },
      { name: 'META-INF/container.xml', content: containerXml },
      { name: 'OEBPS/content.opf', content: contentOpf },
      { name: 'OEBPS/nav.xhtml', content: navXhtml },
      { name: 'OEBPS/document.xhtml', content: chapterXhtml },
    ],
    'application/epub+zip'
  );
}

export function exportToEpub(doc: DocumentModel): void {
  triggerDownload(buildEpubBlob(doc), sanitizeFilename(doc.title, 'epub'));
}

