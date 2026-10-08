import { describe, expect, it } from 'vitest';
import { PASTED_TEXT_MAX } from '@curios/core';
import { readSourceFile, SOURCE_FILE_MAX_BYTES, sniffSourceFile, UnreadableFileError } from './file-text.js';

const utf8 = (text: string) => new TextEncoder().encode(text);

/** A real, one-page PDF with one line of text, offsets and all -- the smallest honest fixture. */
function onePagePdf(line: string): Uint8Array {
  const stream = `BT /F1 18 Tf 72 720 Td (${line}) Tj ET`;
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
