'use client';

import { useState, type FormEvent } from 'react';
import { Button, Callout, Field } from '@curios/ui';
import { apiFetch } from '../../../lib/api.js';
import { loginWalledSite } from '../../../lib/social-links.js';
import { JobStatus, type IngestionResult } from './job-status.js';
import styles from './onboarding.module.css';

type Source =
  | { pageId: string; sourceUrl: string }
  | { pageId: string; pastedText: string }
  | { pageId: string; file: File };

/** The API's ceiling (file-text.ts), checked here too so a 40 MB scan fails before it uploads. */
const FILE_MAX_BYTES = 5 * 1024 * 1024;

/** What the picker offers. The API decides from the file's bytes, not from this. */
const FILE_ACCEPT =
  '.pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown';

function fileSize(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * A link, or text pasted straight in -- for anyone whose presence is a social
 * profile the crawler cannot read. FRONTEND.md's one-field rule still holds:
 * one field is shown at a time, and the owner picks which.
 *
 * Once the ingest request is accepted, the form hands the returned
 * `ingestionId` straight to `JobStatus`, which polls it until it resolves. If
 * it finds nothing, the form comes back with the paste box open.
 *
 * One source at a time, as many as the owner likes: a website then a shop, a
 * LinkedIn bio then a portfolio. After each one resolves the owner can add
 * another, and the form comes back empty. Each is its own ingestion, and every
 * source's facts land in the same review queue, duplicates skipped.
 */
export function IngestForm({
  pageId,
  mode,
  pastedTextMax,
  onIngest,
  fetchStatus,
  onSettled,
}: {
  pageId: string;
  mode: 'PERSONAL' | 'BUSINESS';
  /** The API's cap, from `page.tsx`: this file may not import the core barrel. */
  pastedTextMax: number;
  /** `truncated`: a file longer than the cap, of which only the start was read. */
  onIngest: (input: Source) => Promise<{ ingestionId: string; truncated?: boolean }>;
  fetchStatus: (ingestionId: string) => Promise<IngestionResult>;
  /** Passed to the job's `JobStatus`; the Knowledge tab uses it to re-read its list. */
  onSettled?: (result: IngestionResult) => void;
}) {
  const [using, setUsing] = useState<'link' | 'text' | 'file'>('link');
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [sourceUrl, setSourceUrl] = useState('');
  const [pastedText, setPastedText] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [ingestionId, setIngestionId] = useState<string | null>(null);
  // Why the paste box opened on its own, when a link could not be read.
  const [notice, setNotice] = useState('');
  // How many sources this visit has already read, so the form can say so.
  const [added, setAdded] = useState(0);
  const personal = mode === 'PERSONAL';
  const count = (n: number) => n.toLocaleString('en-MY');

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    // Caught before sending: a login wall can only come back as "we found
    // nothing", after spending an ingestion and a rate-limit token.
    const walled = using === 'link' ? loginWalledSite(sourceUrl) : null;
    if (walled) {
      setUsing('text');
      setNotice(`${walled} does not let us read profiles. Paste your bio or About section from it instead.`);
      return;
    }
    // `required` is satisfied by whitespace, and the API's own answer to an
    // all-whitespace paste is Fastify's raw validation wording -- catch it
    // here so the owner hears it from us instead.
    if (using === 'file' && !file) {
      setError('Choose a file first: a PDF, a Word document or a text file.');
      return;
    }
    if (using === 'file' && file && file.size > FILE_MAX_BYTES) {
      setError('That file is over 5 MB. Try a smaller one, or paste the text instead.');
      return;
    }
    if (using === 'text' && pastedText.trim() === '') {
      setError('Paste something first — a bio, captions, an About section, whatever says it best.');
      return;
    }
    // Checked here so the owner is told before anything is sent; the API's
    // schema is what actually enforces it. The API trims before measuring, so
    // this compares trimmed length too -- trailing whitespace should not
    // fail someone the API would have accepted.
    if (using === 'text' && pastedText.trim().length > pastedTextMax) {
      setError(`That is more than ${count(pastedTextMax)} characters. Paste the part that says the most.`);
      return;
    }
    setBusy(true);
    try {
      const result = await onIngest(
        using === 'text'
          ? { pageId, pastedText }
          : using === 'file' && file
            ? { pageId, file }
            : { pageId, sourceUrl },
      );
      setTruncated(Boolean(result.truncated));
      setIngestionId(result.ingestionId);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Something failed. Try again.');
      setBusy(false);
    }
  }

  if (ingestionId) {
    return (
      <>
      {truncated ? (
        <Callout tone="info">That file is long, so your page read the first {count(pastedTextMax)} characters of it.</Callout>
      ) : null}
      <JobStatus
        ingestionId={ingestionId}
        fetchStatus={fetchStatus}
        // A file is read as text, and fails or finds nothing the way pasted text does.
        source={using === 'link' ? 'link' : 'text'}
        onSettled={onSettled}
        onNothingFound={() => {
          setIngestionId(null);
          setUsing('text');
          setBusy(false);
        }}
        onAddAnother={() => {
          setIngestionId(null);
          setUsing('link');
          setSourceUrl('');
          setPastedText('');
          setFile(null);
          setTruncated(false);
          setNotice('');
          setBusy(false);
          setAdded((count) => count + 1);
        }}
      />
      </>
    );
  }

  return (
    <form className={styles.ingest} onSubmit={(event) => void submit(event)}>
      {added > 0 ? (
        <Callout tone="info">
          Facts from what you added so far are already in your review queue.{' '}
          <a href="/app/review">Review them</a>, or add the next source.
        </Callout>
      ) : null}
      {notice ? <Callout tone="action">{notice}</Callout> : null}
      {using === 'link' ? (
        <Field
          id="sourceUrl"
          label={added > 0 ? 'Another link' : personal ? 'A link about you' : 'Your website address'}
          type="url"
          autoComplete="off"
          required
          hint={
            personal
              ? 'Your site, Linktree or profile — or paste a few paragraphs about yourself instead. LinkedIn and Instagram block us, so paste your bio from those.'
              : 'Your website, online shop, or any page about the business.'
          }
          value={sourceUrl}
          onChange={setSourceUrl}
        />
      ) : using === 'file' ? (
        // A label, so the whole zone opens the picker; drop a file on it as well.
        <label
          className={styles.drop}
          data-dragging={dragging || undefined}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            const dropped = event.dataTransfer.files[0];
            if (dropped) {
              setFile(dropped);
              setError('');
            }
          }}
        >
          <input
            type="file"
            accept={FILE_ACCEPT}
            aria-label="A file to read"
            className={styles.fileInput}
            onChange={(event) => {
              const chosen = event.target.files?.[0];
              if (chosen) {
                setFile(chosen);
                setError('');
              }
            }}
          />
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" className={styles.dropIcon}>
            <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
            <path d="M14 3v5h5M12 18v-6M9 15l3-3 3 3" />
          </svg>
          <span className={styles.dropTitle}>{file ? file.name : 'Choose a file, or drop it here'}</span>
          <span className={styles.dropHint}>
            {file
              ? `${fileSize(file.size)}. Click to choose a different one.`
              : personal
                ? 'Your resume or CV, a portfolio, a bio. PDF, Word (.docx) or text, up to 5 MB.'
                : 'A menu, a price list, a brochure. PDF, Word (.docx) or text, up to 5 MB.'}
          </span>
        </label>
      ) : (
        <Field
          id="pastedText"
          label={personal ? 'About you' : 'About your business'}
          multiline
          required
          hint={`${count(pastedText.length)} of ${count(pastedTextMax)} characters. A bio, captions, an About section — whatever says it best.`}
          value={pastedText}
          onChange={setPastedText}
        />
      )}

      {/* The other two ways in, whichever one is showing. */}
      {(['link', 'text', 'file'] as const)
        .filter((way) => way !== using)
        .map((way) => (
          <Button
            key={way}
            type="button"
            variant="secondary"
            onClick={() => {
              setError('');
              setNotice('');
              setUsing(way);
            }}
          >
            {way === 'link' ? 'Use a link instead' : way === 'text' ? 'Paste text instead' : 'Upload a file'}
          </Button>
        ))}

      {error ? <Callout tone="error">{error}</Callout> : null}

      <Button type="submit" busy={busy}>
        {busy
          ? 'Starting…'
          : using === 'text'
            ? 'Read what I pasted'
            : using === 'file'
              ? 'Read this file'
            : personal || added > 0
              ? 'Read this link'
              : 'Read my website'}
      </Button>
    </form>
  );
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

/**
 * Supplies the real `onIngest` and `fetchStatus`. Thin on purpose, same shape
 * as `Claim` in `claim-form.tsx`: a Server Component cannot hand a closure to a
 * Client Component, so `page.tsx` passes only plain values and the closures
 * over `apiFetch` are built here.
 */
export function Ingest({
  pageId,
  mode,
  pastedTextMax,
  onSettled,
}: {
  pageId: string;
  mode: 'PERSONAL' | 'BUSINESS';
  pastedTextMax: number;
  onSettled?: (result: IngestionResult) => void;
}) {
  return (
    <IngestForm
      onSettled={onSettled}
      pageId={pageId}
      mode={mode}
      pastedTextMax={pastedTextMax}
      onIngest={async (input) =>
        'file' in input
          ? apiFetch<{ ingestionId: string; truncated: boolean }>('/ingest/file', {
              method: 'POST',
              body: JSON.stringify({ pageId: input.pageId, fileName: input.file.name, data: await asBase64(input.file) }),
            })
          : apiFetch<{ ingestionId: string }>('/ingest', { method: 'POST', body: JSON.stringify(input) })
      }
      fetchStatus={(ingestionId) => apiFetch(`/ingest/${ingestionId}`)}
    />
  );
}
