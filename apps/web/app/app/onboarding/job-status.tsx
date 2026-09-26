'use client';

import { Button, Callout } from '@curios/ui';
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
export function JobStatus({
  ingestionId,
  fetchStatus,
  intervalMs = 2000,
  onNothingFound,
  source = 'link',
  onAddAnother,
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
  /**
   * Called to read one more source for the same page: a shop after a website,
   * a portfolio after a LinkedIn bio. Offered after a success, and after a
   * failure, where it is the way forward. Each source is its own ingestion; the
   * facts land in one review queue, duplicates skipped.
   */
  onAddAnother?: () => void;
}) {
  const { data } = useQuery({
    queryKey: ['ingestion', ingestionId],
    queryFn: () => fetchStatus(ingestionId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'QUEUED' || status === 'RUNNING' ? intervalMs : false;
    },
  });

  if (!data || data.status === 'QUEUED' || data.status === 'RUNNING') {
    return <Callout tone="info">Reading what you gave us…</Callout>;
  }

  if (data.status === 'FAILED') {
    // The API's own `error` string, not a generic apology -- it exists
    // precisely so this screen can say which of the many ways a crawl fails
    // actually happened.
    return (
      <div>
        <Callout tone="error">{data.error}</Callout>
        {onAddAnother ? (
          <Button type="button" onClick={onAddAnother}>
            Try a different link or text
          </Button>
        ) : null}
      </div>
    );
  }

  if (data.extractedCount === 0) {
    return (
      <div>
        <Callout tone="action">
          {source === 'text'
            ? 'We could not find anything to use in what you pasted. Try a few sentences about what you sell, your prices, or your hours.'
            : 'We could not find anything to use there. Some sites, Instagram and TikTok especially, do not let us read them.'}
        </Callout>
        {onNothingFound ? (
          <Button type="button" onClick={onNothingFound}>
            {source === 'text' ? 'Try different text' : 'Paste text instead'}
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div>
      <Callout tone="info">Found {data.extractedCount} facts.</Callout>
      <a href="/app/review">Review the facts</a>
      {onAddAnother ? (
        <Button type="button" variant="secondary" onClick={onAddAnother}>
          Add another link or text
        </Button>
      ) : null}
    </div>
  );
}
