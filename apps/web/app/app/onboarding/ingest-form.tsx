'use client';

import { useState, type FormEvent } from 'react';
import { Button, Callout, Field } from '@curios/ui';
import { apiFetch } from '../../../lib/api.js';
import { JobStatus, type IngestionResult } from './job-status.js';

type Source = { pageId: string; sourceUrl: string } | { pageId: string; pastedText: string };

/**
 * A link, or text pasted straight in -- for anyone whose presence is a social
 * profile the crawler cannot read. FRONTEND.md's one-field rule still holds:
 * one field is shown at a time, and the owner picks which.
 *
 * Once the ingest request is accepted, the form hands the returned
 * `ingestionId` straight to `JobStatus`, which polls it until it resolves. If
 * it finds nothing, the form comes back with the paste box open.
 */
export function IngestForm({
  pageId,
  mode,
  pastedTextMax,
  onIngest,
  fetchStatus,
}: {
  pageId: string;
  mode: 'PERSONAL' | 'BUSINESS';
  /** The API's cap, from `page.tsx`: this file may not import the core barrel. */
  pastedTextMax: number;
  onIngest: (input: Source) => Promise<{ ingestionId: string }>;
  fetchStatus: (ingestionId: string) => Promise<IngestionResult>;
}) {
  const [using, setUsing] = useState<'link' | 'text'>('link');
  const [sourceUrl, setSourceUrl] = useState('');
  const [pastedText, setPastedText] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [ingestionId, setIngestionId] = useState<string | null>(null);
  const personal = mode === 'PERSONAL';
  const count = (n: number) => n.toLocaleString('en-MY');

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    // Checked here so the owner is told before anything is sent; the API's
    // schema is what actually enforces it.
    if (using === 'text' && pastedText.length > pastedTextMax) {
      setError(`That is more than ${count(pastedTextMax)} characters. Paste the part that says the most.`);
      return;
    }
    setBusy(true);
    try {
      const { ingestionId: id } = await onIngest(
        using === 'text' ? { pageId, pastedText } : { pageId, sourceUrl },
      );
      setIngestionId(id);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Something failed. Try again.');
      setBusy(false);
    }
  }

  if (ingestionId) {
    return (
      <JobStatus
        ingestionId={ingestionId}
        fetchStatus={fetchStatus}
        onNothingFound={() => {
          setIngestionId(null);
          setUsing('text');
          setBusy(false);
        }}
      />
    );
  }

  return (
    <form onSubmit={(event) => void submit(event)}>
      {using === 'link' ? (
        <Field
          id="sourceUrl"
          label={personal ? 'A link about you' : 'Your website address'}
          type="url"
          autoComplete="off"
          required
          hint={
            personal
              ? 'Your site, Linktree or profile — or paste a few paragraphs about yourself instead.'
              : undefined
          }
          value={sourceUrl}
          onChange={setSourceUrl}
        />
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

      <Button
        type="button"
        variant="secondary"
        onClick={() => {
          setError('');
          setUsing(using === 'link' ? 'text' : 'link');
        }}
      >
        {using === 'link' ? 'Paste text instead' : 'Use a link instead'}
      </Button>

      {error ? <Callout tone="error">{error}</Callout> : null}

      <Button type="submit" busy={busy}>
        {busy
          ? 'Starting…'
          : using === 'text'
            ? 'Read what I pasted'
            : personal
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
}: {
  pageId: string;
  mode: 'PERSONAL' | 'BUSINESS';
  pastedTextMax: number;
}) {
  return (
    <IngestForm
      pageId={pageId}
      mode={mode}
      pastedTextMax={pastedTextMax}
      onIngest={(input) => apiFetch('/ingest', { method: 'POST', body: JSON.stringify(input) })}
      fetchStatus={(ingestionId) => apiFetch(`/ingest/${ingestionId}`)}
    />
  );
}
