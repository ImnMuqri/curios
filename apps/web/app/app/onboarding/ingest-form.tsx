'use client';

import { useState, type FormEvent } from 'react';
import { Button, Callout, Field } from '@curios/ui';
import { apiFetch } from '../../../lib/api.js';
import { JobStatus, type IngestionResult } from './job-status.js';
import { checkSource, FILE_ACCEPT, fileSize, ingestSource, type Source } from './source-input.js';
import styles from './onboarding.module.css';

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
    const problem = checkSource(using, { sourceUrl, pastedText, file }, pastedTextMax);
    if (problem && 'paste' in problem) {
      setUsing('text');
      setNotice(problem.paste);
      return;
    }
    if (problem) {
      setError(problem.error);
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
        subject={using === 'file' && file ? file.name : undefined}
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
      onIngest={ingestSource}
      fetchStatus={(ingestionId) => apiFetch(`/ingest/${ingestionId}`)}
    />
  );
}
