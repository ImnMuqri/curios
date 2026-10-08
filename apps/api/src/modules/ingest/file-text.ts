import mammoth from 'mammoth';
import { extractText, getDocumentProxy } from 'unpdf';
import { PASTED_TEXT_MAX } from '@curios/core';

/**
 * A file the owner uploads as a source -- a resume, a menu, a price list --
 * read into plain text, which then goes through exactly the path pasted text
 * does. The file itself is never stored: the text is what the page learns
 * from, and keeping a resume nobody asked us to keep is a liability.
 */

/** 5 MB: a long resume or a menu with pictures is far under it; a book is not a source. */
export const SOURCE_FILE_MAX_BYTES = 5 * 1024 * 1024;

export type SourceFileKind = 'pdf' | 'docx' | 'text';

export class UnreadableFileError extends Error {
  readonly statusCode = 400;
  readonly code = 'UNREADABLE_FILE';
  constructor(message: string) {
    super(message);
    this.name = 'UnreadableFileError';
  }
}

/**
 * What the bytes actually are, from their first bytes rather than the name or
 * the content type a browser reports: both are the uploader's to set.
 */
export function sniffSourceFile(bytes: Uint8Array): SourceFileKind | null {
  const starts = (...head: number[]) => head.every((byte, i) => bytes[i] === byte);
  if (starts(0x25, 0x50, 0x44, 0x46, 0x2d)) return 'pdf'; // %PDF-
  // A zip. Every .docx is one; whether this one is Word is mammoth's to find out.
  if (starts(0x50, 0x4b, 0x03, 0x04)) return 'docx';
  if (bytes.includes(0)) return null;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return 'text';
  } catch {
    return null;
  }
}

/** Line endings unified, each line trimmed, runs of blank lines collapsed to one. */
function tidy(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[\t ]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function readRaw(kind: SourceFileKind, bytes: Uint8Array): Promise<string> {
  if (kind === 'pdf') {
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractText(pdf, { mergePages: true });
    return text;
  }
  if (kind === 'docx') {
    const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    return value;
  }
  return new TextDecoder('utf-8').decode(bytes);
}

/**
 * The file's text, tidied, and at most PASTED_TEXT_MAX characters of it.
 * `truncated` says when the end was dropped, so the owner is told rather than
 * left wondering why page nine of a catalogue never made it into Review.
 */
export async function readSourceFile(bytes: Uint8Array): Promise<{ text: string; kind: SourceFileKind; truncated: boolean }> {
  if (bytes.byteLength === 0) throw new UnreadableFileError('That file is empty.');
  if (bytes.byteLength > SOURCE_FILE_MAX_BYTES) {
    throw new UnreadableFileError('That file is over 5 MB. Try a smaller one, or paste the text instead.');
  }

  const kind = sniffSourceFile(bytes);
  if (!kind) {
    throw new UnreadableFileError('Use a PDF, a Word document (.docx) or a text file.');
  }

  let raw: string;
  try {
    raw = await readRaw(kind, bytes);
  } catch {
    throw new UnreadableFileError(
      kind === 'docx'
        ? 'That file could not be read. Save it as a .docx or a PDF and try again.'
        : 'That file could not be read. Try saving it again, or paste the text instead.',
    );
  }

  const text = tidy(raw);
  if (text === '') {
    // The usual reason: a scanned page or a photo, which is pictures, not text.
    throw new UnreadableFileError("We couldn't find any text in that file. If it's a scan or a photo, paste the text instead.");
  }

  const chars = [...text];
  const truncated = chars.length > PASTED_TEXT_MAX;
  return { text: truncated ? chars.slice(0, PASTED_TEXT_MAX).join('').trimEnd() : text, kind, truncated };
}
