'use client';

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
}: {
  ingestionId: string;
  fetchStatus: (ingestionId: string) => Promise<IngestionResult>;
}) {
  const { data } = useQuery({
    queryKey: ['ingestion', ingestionId],
    queryFn: () => fetchStatus(ingestionId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'QUEUED' || status === 'RUNNING' ? 2000 : false;
    },
  });

  if (!data || data.status === 'QUEUED' || data.status === 'RUNNING') {
    return <p role="status">Reading your website…</p>;
  }

  if (data.status === 'FAILED') {
    // The API's own `error` string, not a generic apology -- it exists
    // precisely so this screen can say which of the many ways a crawl fails
    // actually happened.
    return <p role="alert">{data.error}</p>;
  }

  return (
    <div>
      <p role="status">Found {data.extractedCount} facts.</p>
      <a href="/app/review">Review the facts</a>
    </div>
  );
}
