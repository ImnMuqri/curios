import { apiFetch } from '../../../lib/api.js';
import { loginWalledSite } from '../../../lib/social-links.js';

/** How a read is going, as GET /ingest/:id answers. */
export type IngestionResult = {
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  extractedCount: number;
  error: string | null;
};

/** One source to read, as the ingest API takes it. */
export type Source =
  | { pageId: string; sourceUrl: string }
  | { pageId: string; pastedText: string }
  | { pageId: string; file: File };

export type SourceWay = 'link' | 'text' | 'file';

/** The API's ceiling (file-text.ts), checked here too so a 40 MB scan fails before it uploads. */
export const FILE_MAX_BYTES = 5 * 1024 * 1024;

/** What the picker offers. The API decides from the file's bytes, not from this. */
export const FILE_ACCEPT =
  '.pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown';

export function fileSize(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const count = (n: number) => n.toLocaleString('en-MY');

/**
 * What is wrong with a source before it is sent, if anything. A login-walled
 * site is not an error but a turn: `paste` says why, and the form switches to
 * the paste box. Shared by onboarding and Facts & sources, so both refuse the
 * same things in the same words.
 */
export function checkSource(
  way: SourceWay,
  input: { sourceUrl: string; pastedText: string; file: File | null },
  pastedTextMax: number,
): { error: string } | { paste: string } | null {
  if (way === 'link') {
    const walled = loginWalledSite(input.sourceUrl);
    if (walled) return { paste: `${walled} does not let us read profiles. Paste your bio or About section from it instead.` };
  }
  if (way === 'file' && !input.file) return { error: 'Choose a file first: a PDF, a Word document or a text file.' };
  if (way === 'file' && input.file && input.file.size > FILE_MAX_BYTES) {
    return { error: 'That file is over 5 MB. Try a smaller one, or paste the text instead.' };
  }
  if (way === 'text' && input.pastedText.trim() === '') {
    return { error: 'Paste something first — a bio, captions, an About section, whatever says it best.' };
  }
  if (way === 'text' && input.pastedText.trim().length > pastedTextMax) {
    return { error: `That is more than ${count(pastedTextMax)} characters. Paste the part that says the most.` };
  }
  return null;
}

/** A file's bytes as base64, the way the picture uploads travel. Chunked: a spread of 5 MB overflows the stack. */
async function asBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let from = 0; from < bytes.length; from += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(from, from + 0x8000));
  }
  return btoa(binary);
}

/** Starts reading a source. `truncated`: a file longer than the cap, of which only the start was read. */
export async function ingestSource(input: Source): Promise<{ ingestionId: string; truncated?: boolean }> {
  return 'file' in input
    ? apiFetch<{ ingestionId: string; truncated: boolean }>('/ingest/file', {
        method: 'POST',
        body: JSON.stringify({ pageId: input.pageId, fileName: input.file.name, data: await asBase64(input.file) }),
      })
    : apiFetch<{ ingestionId: string }>('/ingest', { method: 'POST', body: JSON.stringify(input) });
}
