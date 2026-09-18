import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { IngestForm } from './ingest-form.js';

const wrap = (ui: React.ReactNode) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
};

/** A status that never arrives, for tests that stop at the form. */
const pending = () => new Promise<never>(() => {});

describe('IngestForm', () => {
  it('sends pasted text when the owner switches to it', async () => {
    const onIngest = vi.fn(async () => ({ ingestionId: 'i-1' }));
    wrap(
      <IngestForm pageId="p1" mode="BUSINESS" pastedTextMax={20_000} onIngest={onIngest} fetchStatus={vi.fn(pending)} />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Paste text instead' }));
    await userEvent.type(screen.getByLabelText('About your business'), 'Kek butter RM95.');
    await userEvent.click(screen.getByRole('button', { name: 'Read what I pasted' }));

    expect(onIngest).toHaveBeenCalledWith({ pageId: 'p1', pastedText: 'Kek butter RM95.' });
  });

  it('tells a personal owner any link will do, or their own words', () => {
    wrap(
      <IngestForm pageId="p1" mode="PERSONAL" pastedTextMax={20_000} onIngest={vi.fn()} fetchStatus={vi.fn(pending)} />,
    );

    expect(screen.getByLabelText('A link about you')).toBeInTheDocument();
    expect(screen.getByText(/Linktree or profile/)).toBeInTheDocument();
  });

  it('refuses pasted text over the cap before sending it', async () => {
    const onIngest = vi.fn(async () => ({ ingestionId: 'i-1' }));
    wrap(
      <IngestForm pageId="p1" mode="BUSINESS" pastedTextMax={10} onIngest={onIngest} fetchStatus={vi.fn(pending)} />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Paste text instead' }));
    await userEvent.type(screen.getByLabelText('About your business'), 'eleven char');
    await userEvent.click(screen.getByRole('button', { name: 'Read what I pasted' }));

    expect(onIngest).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('more than 10 characters');
  });

  it('goes back to the paste box when the link gave us nothing', async () => {
    // Where an Instagram URL usually lands: the crawl succeeded and found
    // nothing. It must not be a dead end.
    const onIngest = vi.fn(async () => ({ ingestionId: 'i-1' }));
    const fetchStatus = vi.fn(async () => ({ status: 'SUCCEEDED' as const, extractedCount: 0, error: null }));
    wrap(
      <IngestForm pageId="p1" mode="PERSONAL" pastedTextMax={20_000} onIngest={onIngest} fetchStatus={fetchStatus} />,
    );

    await userEvent.type(screen.getByLabelText('A link about you'), 'https://instagram.com/nadiabakes');
    await userEvent.click(screen.getByRole('button', { name: 'Read this link' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Paste text instead' }));

    expect(screen.getByLabelText('About you')).toBeInTheDocument();
  });

  it('tells a pasted-text owner their text gave nothing, not that a crawl failed', async () => {
    // The paste box is the thing they just used -- offering it back as the
    // escape hatch would be a dead end wearing the label of the way out.
    const onIngest = vi.fn(async () => ({ ingestionId: 'i-1' }));
    const fetchStatus = vi.fn(async () => ({ status: 'SUCCEEDED' as const, extractedCount: 0, error: null }));
    wrap(
      <IngestForm pageId="p1" mode="BUSINESS" pastedTextMax={20_000} onIngest={onIngest} fetchStatus={fetchStatus} />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Paste text instead' }));
    await userEvent.type(screen.getByLabelText('About your business'), 'Kek butter RM95.');
    await userEvent.click(screen.getByRole('button', { name: 'Read what I pasted' }));

    expect(await screen.findByText(/could not find anything to use in what you pasted/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Paste text instead' })).not.toBeInTheDocument();
  });
});
