// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { countWords, sanitizeInlineHtml } from '../src/model/sanitize';
import {
  createBlankDocument,
  DocumentStore,
  generateBenchmarkDocument,
} from '../src/model/documentStore';
import {
  buildDocxBlob,
  buildEpubBlob,
  documentToMarkdown,
  documentToStandaloneHtml,
  markdownToDocument,
  parseImportedJson,
} from '../src/storage/exporters';
import { renderLatexEquationHtml } from '../src/editor/mathRenderer';

describe('VeloWrite Core Sanitizer & Word Counter', () => {
  it('counts words in O(n) across punctuation and whitespace accurately', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('   \n\t  ')).toBe(0);
    expect(countWords('Sub-16ms local-first editor')).toBe(3);
    expect(countWords('One   two\nthree\tfour')).toBe(4);
  });

  it('strips unsafe tags and javascript: links while preserving inline formatting', () => {
    const dirty =
      'Hello <b>world</b> <script>alert(1)</script><a href="javascript:evil()">bad</a> <a href="https://example.com">good</a>';
    const clean = sanitizeInlineHtml(dirty);
    expect(clean).toContain('<strong>world</strong>');
    expect(clean).not.toContain('<script>');
    expect(clean).toContain('href="#"');
    expect(clean).toContain('href="https://example.com"');
  });
});

describe('DocumentStore O(1) Stats, Outline, Undo/Redo, and 100-Page Latency', () => {
  it('tracks incremental word count, outline, block reordering, and undo/redo', () => {
    const store = new DocumentStore(createBlankDocument('Spec'));
    const firstId = store.getBlocks()[0].id;

    store.setBlockType(firstId, 'heading1', 'Architecture Overview');
    expect(store.getStats().words).toBe(2);
    expect(store.getOutline()).toHaveLength(1);
    expect(store.getOutline()[0].text).toBe('Architecture Overview');

    const second = store.insertBlockAfter(firstId, 'paragraph', 'Fast virtualized DOM rendering.');
    expect(store.getStats().words).toBe(6);

    const third = store.insertBlockAfter(second.id, 'todo', 'Ship to 500 desktops');
    store.toggleTodoChecked(third.id);
    expect(store.getBlockById(third.id)?.checked).toBe(true);

    store.moveBlock(2, 1);
    expect(store.getBlockAt(1)?.id).toBe(third.id);

    store.undo();
    expect(store.getBlockAt(2)?.id).toBe(third.id);

    store.redo();
    expect(store.getBlockAt(1)?.id).toBe(third.id);
  });

  it('maintains sub-5ms single-block keystroke updates on a 50,000-word (100-page) manuscript', () => {
    const benchDoc = generateBenchmarkDocument();
    const store = new DocumentStore(benchDoc);
    expect(store.getStats().words).toBeGreaterThan(45000);

    const middleBlock = store.getBlockAt(Math.floor(store.getBlockCount() / 2))!;
    const samples: number[] = [];

    for (let i = 0; i < 25; i++) {
      const nextText = `${middleBlock.text} word${i}`;
      const t0 = performance.now();
      store.updateBlockContent(middleBlock.id, nextText, nextText, false);
      samples.push(performance.now() - t0);
    }

    // Exclude initial undo-snapshot allocation; typing burst keystrokes coalesce in O(1)
    const steadyStateAvg =
      samples.slice(1).reduce((a, b) => a + b, 0) / (samples.length - 1);
    expect(steadyStateAvg).toBeLessThan(5);
  });
});

describe('Markdown, JSON, HTML, DOCX, and EPUB Exporters', () => {
  it('round-trips Markdown headings, checklists, math, code blocks, and tables', () => {
    const md = [
      '# Production Guide',
      '',
      'Intro with **bold** and `code`.',
      '',
      '- [x] Task completed',
      '- [ ] Pending item',
      '',
      '$$',
      '\\frac{a^2 + b^2}{c}',
      '$$',
      '',
      '```typescript',
      'const x = 42;',
      '```',
      '',
      '| Feature | Latency |',
      '| --- | --- |',
      '| Typing | <1ms |',
    ].join('\n');

    const doc = markdownToDocument(md, 'guide.md');
    expect(doc.title).toBe('Production Guide');
    expect(doc.blocks.some((b) => b.type === 'todo' && b.checked)).toBe(true);
    expect(doc.blocks.some((b) => b.type === 'math')).toBe(true);
    expect(doc.blocks.some((b) => b.type === 'code-block')).toBe(true);
    expect(doc.blocks.some((b) => b.type === 'table')).toBe(true);

    const exportedMd = documentToMarkdown(doc);
    expect(exportedMd).toContain('# Production Guide');
    expect(exportedMd).toContain('- [x] Task completed');
    expect(exportedMd).toContain('\\frac{a^2 + b^2}{c}');
    expect(exportedMd).toContain('| Feature | Latency |');

    const jsonRoundTrip = parseImportedJson(JSON.stringify(doc));
    expect(jsonRoundTrip?.blocks.length).toBe(doc.blocks.length);

    const standaloneHtml = documentToStandaloneHtml(doc);
    expect(standaloneHtml).toContain('<!doctype html>');
    expect(standaloneHtml).toContain('vw-math-frac');
  });

  it('builds valid ZIP archives for both OOXML .docx and OCF .epub exports', async () => {
    const readBlobBytes = (blob: Blob): Promise<Uint8Array> =>
      new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(blob);
      });

    const doc = markdownToDocument('# Chapter One\n\nHello desktop world.', 'book.md');

    const docxBlob = buildDocxBlob(doc);
    const docxBytes = await readBlobBytes(docxBlob);
    // PK\x03\x04 ZIP local file header signature
    expect(docxBytes[0]).toBe(0x50);
    expect(docxBytes[1]).toBe(0x4b);
    expect(docxBytes[2]).toBe(0x03);
    expect(docxBytes[3]).toBe(0x04);

    const epubBlob = buildEpubBlob(doc);
    const epubBytes = await readBlobBytes(epubBlob);
    expect(epubBytes[0]).toBe(0x50);
    expect(epubBytes[1]).toBe(0x4b);
    // EPUB OCF 3.0 requires 'mimetype' as the very first uncompressed entry at byte 30
    const firstEntryName = new TextDecoder().decode(epubBytes.slice(30, 38));
    expect(firstEntryName).toBe('mimetype');
    const firstEntryPayload = new TextDecoder().decode(epubBytes.slice(38, 58));
    expect(firstEntryPayload).toBe('application/epub+zip');
  });

  it('renders LaTeX fractions, roots, Greek symbols, and super/subscripts cleanly', () => {
    const html = renderLatexEquationHtml('\\alpha_1 + \\frac{x^2}{\\sqrt{y}} \\leq \\infty');
    expect(html).toContain('α');
    expect(html).toContain('<sub>1</sub>');
    expect(html).toContain('vw-math-frac');
    expect(html).toContain('≤');
    expect(html).toContain('∞');
  });
});
