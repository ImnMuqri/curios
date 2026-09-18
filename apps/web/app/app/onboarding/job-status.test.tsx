import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { JobStatus } from './job-status.js';

const wrap = (ui: React.ReactNode) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
};

describe('JobStatus', () => {
  it('says what is happening while the job runs', async () => {
    wrap(<JobStatus ingestionId="i-1" fetchStatus={vi.fn().mockResolvedValue({ status: 'RUNNING', extractedCount: 0, error: null })} />);

    // "Reading what you gave us" is a instruction-shaped empty state, not a
    // spinner with no words. Someone on a slow connection needs to know the
    // machine is doing something and roughly what.
    expect(await screen.findByText(/reading what you gave us/i)).toBeInTheDocument();
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
    // The interval is injected ONLY so this test can outlive it. At the real
    // 2000ms a 60ms wait proves nothing: it passes identically whether the
    // interval stops or runs forever, because neither fires in 60ms. With 20ms
    // here and a 200ms wait, a poll that failed to stop would fire about ten
    // times and the assertion below would catch it.
    wrap(<JobStatus ingestionId="i-1" fetchStatus={fetchStatus} intervalMs={20} />);
    await screen.findByText(/1/);

    const callsAtResolution = fetchStatus.mock.calls.length;
    await new Promise((r) => setTimeout(r, 200));

    // A poll that never stops is a request every two seconds forever on a
    // phone, for a job that finished.
    expect(fetchStatus.mock.calls.length).toBe(callsAtResolution);
  });

  it('offers the paste box when the page gave us nothing to use', async () => {
    const onNothingFound = vi.fn();
    wrap(
      <JobStatus
        ingestionId="i-1"
        fetchStatus={vi.fn().mockResolvedValue({ status: 'SUCCEEDED', extractedCount: 0, error: null })}
        onNothingFound={onNothingFound}
      />,
    );

    expect(await screen.findByText(/could not find anything to use/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Paste text instead' }));
    expect(onNothingFound).toHaveBeenCalledOnce();
  });

  it('does not offer the paste box to someone who just pasted text', async () => {
    const onNothingFound = vi.fn();
    wrap(
      <JobStatus
        ingestionId="i-1"
        fetchStatus={vi.fn().mockResolvedValue({ status: 'SUCCEEDED', extractedCount: 0, error: null })}
        onNothingFound={onNothingFound}
        source="text"
      />,
    );

    expect(await screen.findByText(/could not find anything to use in what you pasted/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Paste text instead' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try different text' }));
    expect(onNothingFound).toHaveBeenCalledOnce();
  });
});
