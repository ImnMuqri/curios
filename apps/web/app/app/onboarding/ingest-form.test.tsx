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
  it('tells its caller when the job it started settles', async () => {
    const onSettled = vi.fn();
    wrap(
      <IngestForm
        pageId="p1"
        mode="BUSINESS"
        pastedTextMax={20_000}
        onIngest={vi.fn(async () => ({ ingestionId: 'i-1' }))}
        fetchStatus={vi.fn().mockResolvedValue({ status: 'SUCCEEDED', extractedCount: 4, error: null })}
        onSettled={onSettled}
      />,
    );
    await userEvent.type(screen.getByLabelText('Your website address'), 'https://a.example/');
    await userEvent.click(screen.getByRole('button', { name: 'Read my website' }));
    await vi.waitFor(() => expect(onSettled).toHaveBeenCalledTimes(1));
  });

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
    // Told up front, before they paste a link that can only find nothing.
    expect(screen.getByText(/LinkedIn and Instagram block us/)).toBeInTheDocument();
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

  it('refuses a whitespace-only paste before sending it', async () => {
    // `required` is satisfied by "   ", so this is caught here, not by the
    // browser -- and not by the API, whose raw validation wording is not fit
    // for an owner to read.
    const onIngest = vi.fn(async () => ({ ingestionId: 'i-1' }));
    wrap(
      <IngestForm pageId="p1" mode="BUSINESS" pastedTextMax={20_000} onIngest={onIngest} fetchStatus={vi.fn(pending)} />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Paste text instead' }));
    await userEvent.type(screen.getByLabelText('About your business'), '   ');
    await userEvent.click(screen.getByRole('button', { name: 'Read what I pasted' }));

    expect(onIngest).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Paste something first');
  });

  it('does not fail someone whose paste is only over the cap before trimming', async () => {
    // The API trims before measuring, so trailing whitespace here must not
    // fail someone the API would have accepted.
    const onIngest = vi.fn(async () => ({ ingestionId: 'i-1' }));
    wrap(
      <IngestForm pageId="p1" mode="BUSINESS" pastedTextMax={10} onIngest={onIngest} fetchStatus={vi.fn(pending)} />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Paste text instead' }));
    await userEvent.type(screen.getByLabelText('About your business'), '1234567890   ');
    await userEvent.click(screen.getByRole('button', { name: 'Read what I pasted' }));

    expect(onIngest).toHaveBeenCalledWith({ pageId: 'p1', pastedText: '1234567890   ' });
  });

  it('goes back to the paste box when the link gave us nothing', async () => {
    // Where a site built entirely in JavaScript lands: the crawl succeeded and
    // found nothing. It must not be a dead end. (Instagram used to be the
    // example here; it is now caught before sending -- see the LinkedIn test.)
    const onIngest = vi.fn(async () => ({ ingestionId: 'i-1' }));
    const fetchStatus = vi.fn(async () => ({ status: 'SUCCEEDED' as const, extractedCount: 0, error: null }));
    wrap(
      <IngestForm pageId="p1" mode="PERSONAL" pastedTextMax={20_000} onIngest={onIngest} fetchStatus={fetchStatus} />,
    );

    await userEvent.type(screen.getByLabelText('A link about you'), 'https://nadiabakes.carrd.co');
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

  // A login wall shows the crawler nothing, so sending the link would spend an
  // ingestion, and a rate-limit token, to arrive at "we found nothing".
  it('opens the paste box instead of sending a LinkedIn link', async () => {
    const onIngest = vi.fn(async () => ({ ingestionId: 'i-1' }));
    wrap(
      <IngestForm pageId="p1" mode="PERSONAL" pastedTextMax={20_000} onIngest={onIngest} fetchStatus={vi.fn(pending)} />,
    );

    await userEvent.type(screen.getByLabelText('A link about you'), 'https://www.linkedin.com/in/nadia');
    await userEvent.click(screen.getByRole('button', { name: 'Read this link' }));

    expect(onIngest).not.toHaveBeenCalled();
    expect(screen.getByLabelText('About you')).toBeInTheDocument();
    expect(screen.getByText(/LinkedIn does not let us read profiles/)).toBeInTheDocument();
  });

  it('adds a second source after the first, into the same page', async () => {
    const onIngest = vi
      .fn<(input: unknown) => Promise<{ ingestionId: string }>>()
      .mockResolvedValueOnce({ ingestionId: 'i-1' })
      .mockResolvedValueOnce({ ingestionId: 'i-2' });
    const fetchStatus = vi.fn(async () => ({ status: 'SUCCEEDED' as const, extractedCount: 3, error: null }));
    wrap(
      <IngestForm pageId="p1" mode="BUSINESS" pastedTextMax={20_000} onIngest={onIngest} fetchStatus={fetchStatus} />,
    );

    await userEvent.type(screen.getByLabelText('Your website address'), 'https://nadiabakes.my');
    await userEvent.click(screen.getByRole('button', { name: 'Read my website' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Add another link or text' }));

    // Back to an empty form, saying where the first source's facts went.
    const field = screen.getByLabelText('Another link');
    expect(field).toHaveValue('');
    expect(screen.getByText(/already in your review queue/i)).toBeInTheDocument();

    await userEvent.type(field, 'https://shopee.com.my/nadiabakes');
    await userEvent.click(screen.getByRole('button', { name: 'Read this link' }));

    expect(onIngest).toHaveBeenLastCalledWith({ pageId: 'p1', sourceUrl: 'https://shopee.com.my/nadiabakes' });
  });
});

