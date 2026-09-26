'use client';

import { useState, type FormEvent } from 'react';
import { Button, Callout, Field } from '@curios/ui';
import { apiFetch } from '../../../lib/api.js';
import { loginWalledSite } from '../../../lib/social-links.js';
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
        source={using}
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
          setNotice('');
          setBusy(false);
          setAdded((count) => count + 1);
        }}
      />
    );
  }

  return (
    <form onSubmit={(event) => void submit(event)}>
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
          setNotice('');
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
