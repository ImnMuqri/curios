'use client';

import { Button } from '@curios/ui';
import { useEffect, type ReactNode } from 'react';
import styles from './job-status.module.css';
import { useQuery } from '@tanstack/react-query';

export type IngestionResult = {
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  extractedCount: number;
  error: string | null;
};

/**
 * Polls one ingestion job until it resolves, then offers the review screen.
 *
 * `refetchInterval` is a function of the latest query state, not a fixed
 * number: it returns `2000` while the job is still `QUEUED` or `RUNNING`, and
 * `false` once it has `SUCCEEDED` or `FAILED`. That `false` is what stops the
 * poll -- a job that finished an hour ago must not still be costing a request
 * every two seconds on someone's phone.
 */
/**
 * One card for every state a source passes through: what is happening or
 * what happened, in a line, and the way forward right under it. A live
 * region, so a screen reader hears "Found 5 facts" without hunting for it.
 */
function StatusCard({
  tone,
  title,
  children,
  actions,
}: {
  tone: 'working' | 'done' | 'nothing' | 'failed';
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className={styles.card} data-tone={tone} role="status" aria-live="polite">
      <span className={styles.icon} aria-hidden="true">
        {tone === 'working' ? (
          <span className={styles.spinner} />
        ) : (
          <svg viewBox="0 0 24 24" width="20" height="20">
            {tone === 'done' ? <path d="M5 12.5l4.5 4.5L19 7.5" /> : null}
            {tone === 'nothing' ? <><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></> : null}
            {tone === 'failed' ? <><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5M12 16.5v.01" /></> : null}
          </svg>
        )}
      </span>
      <div className={styles.body}>
        <p className={styles.title}>{title}</p>
        {children ? <p className={styles.text}>{children}</p> : null}
        {actions ? <div className={styles.actions}>{actions}</div> : null}
      </div>
    </div>
  );
}

export function JobStatus({
  ingestionId,
  fetchStatus,
  intervalMs = 2000,
  onNothingFound,
  source = 'link',
  subject,
  onAddAnother,
  onSettled,
  recheck = false,
}: {
  ingestionId: string;
  fetchStatus: (ingestionId: string) => Promise<IngestionResult>;
  /**
   * Poll interval in ms. Injected only so tests can pass a shorter interval
   * and verify the poll stops; production uses the 2000ms default.
   */
  intervalMs?: number;
  /**
   * Called from the nothing-found state, so the form can reopen with the paste
   * box. Where a social profile the crawler could not read lands.
   */
  onNothingFound?: () => void;
  /**
   * Which source the owner gave us. A crawl that found nothing and a paste that
   * found nothing are different failures and need different words -- and the
   * paste box is not an escape hatch for someone who just used it.
   */
  source?: 'link' | 'text';
  /** What is being read, when there is a name to show (a file's). */
  subject?: string;
  /**
   * Called to read one more source for the same page: a shop after a website,
   * a portfolio after a LinkedIn bio. Offered after a success, and after a
   * failure, where it is the way forward. Each source is its own ingestion; the
   * facts land in one review queue, duplicates skipped.
   */
  onAddAnother?: () => void;
  /**
   * Called once, when the polled job first becomes SUCCEEDED or FAILED. Lets a
   * list that rendered this row from server props re-read.
   */
  onSettled?: (result: IngestionResult) => void;
  /**
   * The source already had facts, so finding no new ones is not "we could not
   * read it" -- it is "nothing changed".
   */
  recheck?: boolean;
}) {
  const { data } = useQuery({
    queryKey: ['ingestion', ingestionId],
    queryFn: () => fetchStatus(ingestionId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'QUEUED' || status === 'RUNNING' ? intervalMs : false;
    },
  });

  const settledStatus = data && (data.status === 'SUCCEEDED' || data.status === 'FAILED') ? data.status : null;
  useEffect(() => {
    if (settledStatus && data) onSettled?.(data);
    // Keyed on the settled status alone: a re-render must not fire it again.
  }, [settledStatus]);

  if (!data || data.status === 'QUEUED' || data.status === 'RUNNING') {
    return (
      <StatusCard tone="working" title="Reading what you gave us…">
        {subject ? `${subject}. ` : ''}This usually takes under a minute. You can leave this page: the facts will wait in Review.
      </StatusCard>
    );
  }

  if (data.status === 'FAILED') {
    // The API's own `error` string, not a generic apology -- it exists
    // precisely so this screen can say which of the many ways a crawl fails
    // actually happened.
    return (
      <StatusCard
        tone="failed"
        title="That didn't work"
        actions={
          onAddAnother ? (
            <Button type="button" onClick={onAddAnother}>
              Try a different source
            </Button>
          ) : undefined
        }
      >
        {data.error}
      </StatusCard>
    );
  }

  if (data.extractedCount === 0 && recheck) {
    return <StatusCard tone="done" title="No new facts — everything it found was already there." />;
  }

  if (data.extractedCount === 0) {
    return (
      <StatusCard
        tone="nothing"
        title="Nothing to use yet"
        actions={
          onNothingFound ? (
            <Button type="button" onClick={onNothingFound}>
              {source === 'text' ? 'Try different text' : 'Paste text instead'}
            </Button>
          ) : undefined
        }
      >
        {source === 'text'
          ? 'We could not find anything to use in what you pasted. Try a few sentences about what you sell, your prices, or your hours.'
          : 'We could not find anything to use there. Some sites, Instagram and TikTok especially, do not let us read them.'}
      </StatusCard>
    );
  }

  return (
    <StatusCard
      tone="done"
      title={`Found ${data.extractedCount} ${data.extractedCount === 1 ? 'fact' : 'facts'}.`}
      actions={
        <>
          <a className={styles.primary} href="/app/review">
            Review the facts
          </a>
          {onAddAnother ? (
            <Button type="button" variant="secondary" onClick={onAddAnother}>
              Add another source
            </Button>
          ) : null}
        </>
      }
    >
      They wait in Review until you accept them. Nothing reaches your page before that.
    </StatusCard>
  );
}
