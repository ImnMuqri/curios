import { describe, expect, it } from 'vitest';
import { PASTED_TEXT_MAX } from '@curios/core';
import { pageText, readSourceFile, SOURCE_FILE_MAX_BYTES, sniffSourceFile, UnreadableFileError } from './file-text.js';

const utf8 = (text: string) => new TextEncoder().encode(text);

/**
 * A real, one-page PDF, offsets and all -- the smallest honest fixture. Each
 * run is its own text object at its own spot on the page, the way a resume's
 * heading and the line under it usually are.
 */
function onePagePdf(...runs: (string | { text: string; x: number; y: number })[]): Uint8Array {
  const stream = runs
    .map((run) => (typeof run === 'string' ? { text: run, x: 72, y: 720 } : run))
    .map(({ text, x, y }) => `BT /F1 12 Tf ${x} ${y} Td (${text}) Tj ET`)
    .join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return utf8(body);
}

describe('sniffSourceFile', () => {
  it('knows a file by its first bytes, not its name', () => {
    expect(sniffSourceFile(utf8('%PDF-1.7 ...'))).toBe('pdf');
    expect(sniffSourceFile(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2]))).toBe('docx');
    expect(sniffSourceFile(utf8('Kek butter RM95\nKek coklat RM90'))).toBe('text');
  });

  it('refuses binary that is none of those: an image, an executable', () => {
    expect(sniffSourceFile(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0]))).toBeNull(); // PNG
    expect(sniffSourceFile(new Uint8Array([0xff, 0xfe, 0xfd]))).toBeNull(); // not UTF-8
  });
});

describe('readSourceFile', () => {
  it('reads the text out of a PDF', async () => {
    const { text, kind, truncated } = await readSourceFile(onePagePdf('Iman Muqri, software developer'));
    expect(kind).toBe('pdf');
    expect(text).toContain('Iman Muqri, software developer');
    expect(truncated).toBe(false);
  });

  it('keeps the breaks and spaces between separate runs of PDF text', async () => {
    const { text } = await readSourceFile(
      onePagePdf(
        { text: 'PERSONAL PROJECTS', x: 72, y: 720 },
        { text: 'Invokita is an invoicing platform.', x: 72, y: 700 },
        { text: 'Kek butter', x: 72, y: 680 },
        { text: 'RM95', x: 300, y: 680 },
      ),
    );
    expect(text).toBe('PERSONAL PROJECTS\nInvokita is an invoicing platform.\nKek butter RM95');
  });

  it('reads a text file, tidying line endings, spacing and runs of blank lines', async () => {
    const { text } = await readSourceFile(utf8('  Kek butter   RM95  \r\n\r\n\r\n\r\nKek coklat\tRM90\r\n'));
    expect(text).toBe('Kek butter RM95\n\nKek coklat RM90');
  });

  it('keeps the first PASTED_TEXT_MAX characters of a long file, and says it did', async () => {
    const { text, truncated } = await readSourceFile(utf8('a'.repeat(PASTED_TEXT_MAX + 50)));
    expect([...text]).toHaveLength(PASTED_TEXT_MAX);
    expect(truncated).toBe(true);
  });

  it('says why when a file cannot be used', async () => {
    await expect(readSourceFile(new Uint8Array())).rejects.toThrow(/empty/);
    await expect(readSourceFile(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0]))).rejects.toThrow(/PDF, a Word document/);
    await expect(readSourceFile(new Uint8Array(SOURCE_FILE_MAX_BYTES + 1).fill(97))).rejects.toThrow(/over 5 MB/);
    // A zip that is not a Word document.
    await expect(readSourceFile(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 9, 9, 9, 9]))).rejects.toThrow(/could not be read/);
    // Blank text: the shape a scan takes once its pictures are dropped.
    await expect(readSourceFile(utf8('   \n\n  '))).rejects.toThrow(/scan or a photo/);
  });

  it('throws UnreadableFileError, a 400 the API sends back as it is', async () => {
    const failure = await readSourceFile(new Uint8Array()).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(UnreadableFileError);
    expect(failure).toMatchObject({ statusCode: 400, code: 'UNREADABLE_FILE' });
  });
});

describe('pageText', () => {
  const run = (str: string, x: number, y: number, width: number, hasEOL = false) => ({ str, hasEOL, transform: [1, 0, 0, 1, x, y], width, height: str ? 10 : 0 });

  it('starts a new line where pdf.js left out the end-of-line, as a resume heading had it', () => {
    // From a real resume: no end-of-line between the heading and the line under it.
    const items = [run('PERSONAL PROJECTS', 38, 221, 146), run('Invokita is an invoicing platform', 49, 183, 491), run('', 49, 170, 0, true), run('payment collection.', 49, 170, 86)];
    expect(pageText(items)).toBe('PERSONAL PROJECTS\nInvokita is an invoicing platform\npayment collection.');
  });

  it('puts a space at a gap on the same line, and none where runs touch or already have one', () => {
    const items = [run('Developed', 66, 143, 48), run(' ', 114, 143, 3), run('Invokita.my', 117, 143, 55), run(', an AI platform', 172, 143, 100), run('RM95', 400, 143, 30)];
    expect(pageText(items)).toBe('Developed Invokita.my, an AI platform RM95');
  });
});
