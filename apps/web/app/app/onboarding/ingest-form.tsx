'use client';

import { useState, type FormEvent } from 'react';
import { Button, Callout, Field } from '@curios/ui';
import { apiFetch } from '../../../lib/api.js';
import { JobStatus, type IngestionResult } from './job-status.js';

/**
 * One field: a URL. Per FRONTEND.md's onboarding rule -- "One field. A URL or
 * an `@handle`" -- and the `@handle` half is deliberately absent, because the
 * Instagram adapter throws `NOT_CONFIGURED` by design and connectors are
 * Pro/Max work.
 *
 * Once the ingest request is accepted, the form hands the returned
 * `ingestionId` straight to `JobStatus`, which polls it until it resolves.
 */
export function IngestForm({
  pageId,
  onIngest,
  fetchStatus,
}: {
  pageId: string;
  onIngest: (input: { pageId: string; sourceUrl: string }) => Promise<{ ingestionId: string }>;
  fetchStatus: (ingestionId: string) => Promise<IngestionResult>;
}) {
  const [sourceUrl, setSourceUrl] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [ingestionId, setIngestionId] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const { ingestionId: id } = await onIngest({ pageId, sourceUrl });
      setIngestionId(id);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Something failed. Try again.');
      setBusy(false);
    }
  }

  if (ingestionId) {
    return <JobStatus ingestionId={ingestionId} fetchStatus={fetchStatus} />;
  }

  return (
    <form onSubmit={(event) => void submit(event)}>
      <Field
        id="sourceUrl"
        label="Your website address"
        type="url"
        autoComplete="off"
        required
        value={sourceUrl}
        onChange={setSourceUrl}
      />

      {error ? <Callout tone="error">{error}</Callout> : null}

      <Button type="submit" busy={busy}>
        {busy ? 'Starting…' : 'Read my website'}
      </Button>
    </form>
  );
}

/**
 * Supplies the real `onIngest` and `fetchStatus` functions. Thin on purpose,
 * same shape as `Claim` in `claim-form.tsx`: a Server Component cannot hand a
 * closure to a Client Component, so whatever `page.tsx` eventually renders
 * this from passes only `pageId` -- a plain string, which crosses the RSC
 * boundary fine -- and the closures over `apiFetch` are built here, entirely
 * on the client side of that boundary.
 */
export function Ingest({ pageId }: { pageId: string }) {
  return (
    <IngestForm
      pageId={pageId}
      onIngest={(input) => apiFetch('/ingest', { method: 'POST', body: JSON.stringify(input) })}
      fetchStatus={(ingestionId) => apiFetch(`/ingest/${ingestionId}`)}
    />
  );
}
