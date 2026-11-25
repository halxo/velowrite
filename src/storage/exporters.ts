import type { Block, DocumentModel } from '../model/types';
import { createBlock } from '../model/documentStore';
import { generateId } from '../model/sanitize';

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

/* ============================ JSON EXPORT ============================ */

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
      createBlock(b.type ?? 'paragraph', typeof b.html === 'string' ? b.html : b.text ?? '', b.align)
    );
    return {
      id: generateId(),
      title: typeof parsed.title === 'string' ? parsed.title : 'Imported Document',
      blocks: blocks.length > 0 ? blocks : [createBlock('paragraph', '')],
      settings: parsed.settings ?? { pageMode: 'paginated', margins: 'normal', font: 'serif' },
      createdAt: now,
      updatedAt: now,
    };
  } catch {
    return null;
  }
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
      case 'blockquote':
        lines.push(`> ${inlineHtmlToMarkdown(b.html)}`, '');
        break;
      case 'code-block':
        lines.push('```', b.text, '```', '');
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

  const paragraphs: string[] = [];

  for (let i = 0; i < doc.blocks.length; i++) {
    const block = doc.blocks[i];
    if (block.type !== 'numbered-list') orderedCounter = 0;

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
    } else if (block.type === 'blockquote') {
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
      paragraphs.push(`<w:p><w:pPr>${pPrParts.join('')}</w:pPr>${codeRuns}</w:p>`);
      continue;
    } else if (block.type === 'divider') {
      paragraphs.push(
        '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="4" w:color="D6D3CD"/></w:pBdr></w:pPr></w:p>'
      );
      continue;
    } else if (block.type === 'bullet-list') {
      pPrParts.push('<w:ind w:left="540" w:hanging="260"/>');
    } else if (block.type === 'numbered-list') {
      orderedCounter++;
      pPrParts.push('<w:ind w:left="540" w:hanging="260"/>');
    }

    const prefixRun =
      block.type === 'bullet-list'
        ? '<w:r><w:t xml:space="preserve">•  </w:t></w:r>'
        : block.type === 'numbered-list'
          ? `<w:r><w:t xml:space="preserve">${orderedCounter}.  </w:t></w:r>`
          : '';

    const runs = parseRunsFromHtml(block.html).map(renderRun).join('');
    const pPr = pPrParts.length > 0 ? `<w:pPr>${pPrParts.join('')}</w:pPr>` : '';
    paragraphs.push(`<w:p>${pPr}${prefixRun}${runs}</w:p>`);
  }

  const marginTwips =
    doc.settings.margins === 'narrow'
      ? 900
      : doc.settings.margins === 'wide'
        ? 1800
        : 1440;

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    ${paragraphs.join('\n    ')}
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
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
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
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

function buildZipBlob(files: Array<{ name: string; content: string }>): Blob {
  const encoder = new TextEncoder();
  const localChunks: Uint8Array[] = [];
  const centralChunks: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const dataBytes = encoder.encode(file.content);
    const checksum = crc32(dataBytes);

    const localHeader = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(localHeader.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true);
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
    cv.setUint16(8, 0x0800, true);
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
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
}

export function exportToDocx(doc: DocumentModel): void {
  const { documentXml, relsXml } = buildDocxXml(doc);
  const blob = buildZipBlob([
    { name: '[Content_Types].xml', content: DOCX_CONTENT_TYPES_XML },
    { name: '_rels/.rels', content: DOCX_ROOT_RELS_XML },
    { name: 'word/document.xml', content: documentXml },
    { name: 'word/styles.xml', content: DOCX_STYLES_XML },
    { name: 'word/_rels/document.xml.rels', content: relsXml },
  ]);
  triggerDownload(blob, sanitizeFilename(doc.title, 'docx'));
}
