'use client';

import { useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Callout } from '@curios/ui';
import type { KnowledgeSource } from '@curios/db-read';
import { apiFetch } from '../../../lib/api.js';
import { Ingest } from '../onboarding/ingest-form.js';
import { JobStatus, type IngestionResult } from '../onboarding/job-status.js';
import styles from './knowledge.module.css';
import { EmptyState } from '../_ui/empty-state.js';

const toMessage = (failure: unknown) => (failure instanceof Error ? failure.message : 'Something failed. Try again.');

// Pinned to Malaysian time, as lead-list does: this renders on a UTC server and
// again in the browser, and an unpinned date differs between them for sources
// added 00:00-08:00 MYT. Not billing-copy's formatDate: it pulls in the core
// barrel, which a client component may not import.
const addedOn = (value: Date) =>
  value.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kuala_Lumpur' });
const facts = (n: number) => `${n} ${n === 1 ? 'fact' : 'facts'}`;

/**
 * The owner's sources, presentational -- the ReviewQueue split. Handlers are
 * injected; `onChanged` is the one place a success asks the server to re-read.
 */
export function SourceList({
  sources,
  addForm,
  onRemove,
  onRecheck,
  fetchStatus,
  onChanged,
}: {
  sources: KnowledgeSource[];
  addForm: ReactNode;
  onRemove: (id: string) => Promise<{ removedFacts: number }>;
  onRecheck: (id: string) => Promise<void>;
  fetchStatus: (id: string) => Promise<IngestionResult>;
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function act(id: string, run: () => Promise<unknown>) {
    setBusy(id);
    setErrors(({ [id]: _gone, ...rest }) => rest);
    try {
      await run();
      setConfirming(null);
      onChanged();
    } catch (failure) {
      setErrors((prev) => ({ ...prev, [id]: toMessage(failure) }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section>
      {/* With nothing listed yet, the button lives in the empty state instead of above it. */}
      {adding ? addForm : sources.length > 0 ? <Button onClick={() => setAdding(true)}>Add a source</Button> : null}

      {sources.length === 0 ? (
        adding ? null : (
          <EmptyState
            icon="sources"
            title="No sources yet"
            action={<Button onClick={() => setAdding(true)}>Add a source</Button>}
          >
            Add your website or paste a few paragraphs, and its facts go to Review.
          </EmptyState>
        )
      ) : (
        <ul className={styles.list}>
          {sources.map((source) => {
            const reading = source.status === 'QUEUED' || source.status === 'RUNNING';
            return (
              <li key={source.id} className={styles.row}>
                <p className={styles.label}>{source.label}</p>
                <p className={styles.meta}>
                  Added {addedOn(source.createdAt)} ·{' '}
                  {source.tracked ? facts(source.factCount) : 'Facts from before tracking are listed under Facts'}
                </p>

                {reading ? (
                  <JobStatus
                    ingestionId={source.id}
                    fetchStatus={fetchStatus}
                    source={source.sourceUrl ? 'link' : 'text'}
                    recheck={source.tracked && source.factCount > 0}
                    onSettled={() => onChanged()}
                  />
                ) : (
                  <>
                    {source.status === 'FAILED' && source.error ? <Callout tone="error">{source.error}</Callout> : null}

                    {confirming === source.id ? (
                      <div className={styles.confirm} role="group" aria-label="Confirm removal">
                        <p>
                          {source.tracked
                            ? `Remove this source and its ${facts(source.factCount)}? Facts another source also says are removed too.`
                            : 'Remove this source? This removes the entry only — its older facts stay under Facts.'}
                        </p>
                        <Button busy={busy === source.id} onClick={() => void act(source.id, () => onRemove(source.id))}>
                          Remove source
                        </Button>
                        <Button variant="secondary" onClick={() => setConfirming(null)}>
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <div className={styles.actions}>
                        {source.sourceUrl ? (
                          <span className={styles.recheck}>
                            <Button variant="secondary" busy={busy === source.id} onClick={() => void act(source.id, () => onRecheck(source.id))}>
                              Check for new facts
                            </Button>
                            <small>Adds new facts. Doesn’t remove ones the site has dropped.</small>
                          </span>
                        ) : null}
                        <Button variant="secondary" onClick={() => setConfirming(source.id)}>
                          Remove
                        </Button>
                      </div>
                    )}
                  </>
                )}

                {errors[source.id] ? <Callout tone="error">{errors[source.id]}</Callout> : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** The real handlers. A server component cannot pass functions. */
export function Sources({
  sources,
  pageId,
  mode,
  pastedTextMax,
}: {
  sources: KnowledgeSource[];
  pageId: string;
  mode: 'PERSONAL' | 'BUSINESS';
  pastedTextMax: number;
}) {
  const router = useRouter();
  return (
    <SourceList
      sources={sources}
      addForm={<Ingest pageId={pageId} mode={mode} pastedTextMax={pastedTextMax} onSettled={() => router.refresh()} />}
      onRemove={(id) => apiFetch<{ removedFacts: number }>(`/sources/${id}`, { method: 'DELETE' })}
      onRecheck={async (id) => {
        await apiFetch(`/sources/${id}/recheck`, { method: 'POST' });
      }}
      fetchStatus={(id) => apiFetch<IngestionResult>(`/ingest/${id}`)}
      onChanged={() => router.refresh()}
    />
  );
}
