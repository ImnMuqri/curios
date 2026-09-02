import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { JobStatus } from './job-status.js';

const wrap = (ui: React.ReactNode) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
};

describe('JobStatus', () => {
  it('says what is happening while the job runs', async () => {
    wrap(<JobStatus ingestionId="i-1" fetchStatus={vi.fn().mockResolvedValue({ status: 'RUNNING', extractedCount: 0, error: null })} />);

    // "Reading your website" is a instruction-shaped empty state, not a
    // spinner with no words. Someone on a slow connection needs to know the
    // machine is doing something and roughly what.
    expect(await screen.findByText(/reading your website/i)).toBeInTheDocument();
  });

  it('reports the count when it succeeds', async () => {
    wrap(<JobStatus ingestionId="i-1" fetchStatus={vi.fn().mockResolvedValue({ status: 'SUCCEEDED', extractedCount: 23, error: null })} />);

    expect(await screen.findByText(/23/)).toBeInTheDocument();
  });

  it('shows the failure reason rather than a generic apology', async () => {
    wrap(<JobStatus ingestionId="i-1" fetchStatus={vi.fn().mockResolvedValue({ status: 'FAILED', extractedCount: 0, error: 'Could not reach that address.' })} />);

    // The ingestion row carries an `error` string precisely so this screen can
    // say which of the many ways a crawl fails actually happened.
    expect(await screen.findByText(/could not reach that address/i)).toBeInTheDocument();
  });

  it('stops polling once the job resolves', async () => {
    const fetchStatus = vi.fn().mockResolvedValue({ status: 'SUCCEEDED', extractedCount: 1, error: null });
    wrap(<JobStatus ingestionId="i-1" fetchStatus={fetchStatus} />);
    await screen.findByText(/1/);

    const callsAtResolution = fetchStatus.mock.calls.length;
    await new Promise((r) => setTimeout(r, 60));

    // A poll that never stops is a request every two seconds forever on a
    // phone, for a job that finished.
    expect(fetchStatus.mock.calls.length).toBe(callsAtResolution);
  });
});
