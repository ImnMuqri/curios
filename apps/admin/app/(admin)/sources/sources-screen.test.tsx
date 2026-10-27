import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SourceRow, SourceStats } from '@curios/db-read/admin';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh }),
}));
const apiFetch = vi.fn();
vi.mock('../../../lib/api.js', () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  ApiError: class ApiError extends Error {
    constructor(
      readonly status: number,
      readonly code: string,
      message: string,
    ) {
      super(message);
    }
  },
}));

import { SourcesScreen } from './sources-screen.js';

const NOW = new Date('2026-10-27T04:00:00Z');

const stats = (over: Partial<SourceStats> = {}): SourceStats => ({
  waiting: 4,
  reading: 1,
  failedToday: 3,
  retryable: 1,
  typicalMs: 38_000,
  counts: { all: 5, running: 2, failed: 2, done: 1 },
  ...over,
});

const row = (over: Partial<SourceRow> = {}): SourceRow => ({
  id: 'i1',
  pageId: 'p1',
  displayName: 'Studio Hana',
  handle: 'studiohana',
  source: 'studiohana.com/classes',
  status: 'Failed',
  error: 'The site did not answer',
  facts: 0,
  startedAt: new Date('2026-10-27T03:55:00Z'),
  ...over,
});

const rows = [
  row(),
  row({ id: 'i2', pageId: 'p2', displayName: 'Kak Mah', handle: 'nasilemakkakmah', source: 'Pasted text', status: 'Done', error: null, facts: 12 }),
  row({ id: 'i3', pageId: 'p3', displayName: 'Klinik Aina', handle: 'klinikaina', source: 'klinikaina.my', status: 'Walled', error: 'The site refuses readers', facts: 0 }),
];

const base = { rows, stats: stats(), filter: 'all' as const, readingOn: true, now: NOW };
const figure = (label: string) => screen.getByText(label).closest('div') as HTMLElement;

beforeEach(() => {
  apiFetch.mockReset();
  apiFetch.mockResolvedValue(null);
  refresh.mockClear();
});

describe('SourcesScreen', () => {
  it('shows the four figures with their sublines', () => {
    render(<SourcesScreen {...base} />);

    expect(within(figure('Waiting')).getByText('4')).toBeInTheDocument();
    expect(within(figure('Waiting')).getByText('Starts within a minute')).toBeInTheDocument();
    expect(within(figure('Reading now')).getByText('1')).toBeInTheDocument();
    expect(within(figure('Couldn’t be read, today')).getByText('3')).toBeInTheDocument();
    expect(within(figure('Typical read time')).getByText('38s')).toBeInTheDocument();
    expect(within(figure('Typical read time')).getByText('A website, start to facts')).toBeInTheDocument();
  });

  it('says Queue paused in red when the reading switch is off, and offers Resume', () => {
    render(<SourcesScreen {...base} readingOn={false} />);

    const note = within(figure('Waiting')).getByText('Queue paused');
    expect(note.style.color).toBe('rgb(180, 50, 31)');
    expect(screen.queryByText('Starts within a minute')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resume the queue' })).toBeInTheDocument();
  });

  it('shows a dash for a typical read time with no data', () => {
    render(<SourcesScreen {...base} stats={stats({ typicalMs: null })} />);

    expect(within(figure('Typical read time')).getByText('—')).toBeInTheDocument();
  });

  it('has the four tabs with counts, as links to ?filter=', () => {
    render(<SourcesScreen {...base} filter="failed" />);

    const tabs = within(screen.getByRole('navigation', { name: 'Filter reads' }));
    expect(tabs.getByRole('link', { name: 'All 5' })).toHaveAttribute('href', '/sources');
    expect(tabs.getByRole('link', { name: 'Running 2' })).toHaveAttribute('href', '/sources?filter=running');
    expect(tabs.getByRole('link', { name: 'Couldn’t read 2' })).toHaveAttribute('href', '/sources?filter=failed');
    expect(tabs.getByRole('link', { name: 'Couldn’t read 2' })).toHaveAttribute('aria-current', 'true');
    expect(tabs.getByRole('link', { name: 'Done 1' })).toHaveAttribute('href', '/sources?filter=done');
  });

  it('lists each read: page, source, status with its error, facts and when', () => {
    render(<SourcesScreen {...base} />);

    const table = screen.getByRole('table', { name: 'Reading sources' });
    const rs = within(table).getAllByRole('row');
    expect(rs).toHaveLength(4);
    expect(within(rs[1]!).getByText('Studio Hana')).toBeInTheDocument();
    expect(within(rs[1]!).getByText('curios.my/studiohana')).toBeInTheDocument();
    expect(within(rs[1]!).getByText('studiohana.com/classes')).toBeInTheDocument();
    expect(within(rs[1]!).getByText('Failed')).toBeInTheDocument();
    expect(within(rs[1]!).getByText('The site did not answer')).toBeInTheDocument();
    expect(within(rs[1]!).getByText('5 min ago')).toBeInTheDocument();
    expect(within(rs[2]!).getByText('12')).toBeInTheDocument();
    expect(within(rs[2]!).getByText('Done')).toBeInTheDocument();
  });

  it('shows Retry on Failed rows only, not on Done or Walled', () => {
    render(<SourcesScreen {...base} />);

    expect(screen.getAllByRole('button', { name: 'Retry' })).toHaveLength(1);
    const rs = within(screen.getByRole('table', { name: 'Reading sources' })).getAllByRole('row');
    expect(within(rs[1]!).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(within(rs[3]!).queryByRole('button')).toBeNull();
  });

  it('Retry asks for a reason, posts it to the source’s retry route and toasts', async () => {
    render(<SourcesScreen {...base} />);

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByRole('textbox'), ' Site is back ');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Retry' }));

    expect(apiFetch).toHaveBeenCalledWith('/admin/sources/i1/retry', {
      method: 'POST',
      body: JSON.stringify({ reason: 'Site is back' }),
    });
    expect(refresh).toHaveBeenCalled();
    expect(await screen.findByRole('status')).toHaveTextContent('Queued again.');
  });

  it('keeps the dialog open and shows the API’s words when Retry is refused', async () => {
    const { ApiError } = await import('../../../lib/api.js');
    apiFetch.mockRejectedValue(new ApiError(409, 'READING_OFF', 'Reading new sources is switched off.'));
    render(<SourcesScreen {...base} />);

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByRole('textbox'), 'Try');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Retry' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Reading new sources is switched off.');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('Retry all failed posts the reason and toasts the board’s sentence', async () => {
    apiFetch.mockResolvedValue({ queued: 2, skipped: 1 });
    render(<SourcesScreen {...base} />);

    await userEvent.click(screen.getByRole('button', { name: 'Retry all failed' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByRole('textbox'), 'Outage over');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Retry all failed' }));

    expect(apiFetch).toHaveBeenCalledWith('/admin/sources/retry-failed', {
      method: 'POST',
      body: JSON.stringify({ reason: 'Outage over' }),
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Failed reads queued again. Walled ones are skipped.');
  });

  it('disables Retry all failed when nothing failed', () => {
    render(<SourcesScreen {...base} stats={stats({ retryable: 0, counts: { all: 5, running: 2, failed: 0, done: 3 } })} />);

    expect(screen.getByRole('button', { name: 'Retry all failed' })).toBeDisabled();
  });

  it('disables Retry all failed when the only failures are Walled', () => {
    render(<SourcesScreen {...base} stats={stats({ retryable: 0, counts: { all: 5, running: 2, failed: 1, done: 2 } })} />);

    expect(screen.getByRole('button', { name: 'Retry all failed' })).toBeDisabled();
  });

  it('enables Retry all failed with at least one retryable failure', () => {
    render(<SourcesScreen {...base} />);

    expect(screen.getByRole('button', { name: 'Retry all failed' })).toBeEnabled();
  });

  it('toasts that nothing was retried when the API queued none', async () => {
    apiFetch.mockResolvedValue({ queued: 0, skipped: 2 });
    render(<SourcesScreen {...base} />);

    await userEvent.click(screen.getByRole('button', { name: 'Retry all failed' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByRole('textbox'), 'Outage over');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Retry all failed' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Nothing to retry. Walled sources are skipped.');
  });

  it('says nothing failed in the last 7 days when the API queued and skipped none', async () => {
    apiFetch.mockResolvedValue({ queued: 0, skipped: 0 });
    render(<SourcesScreen {...base} />);

    await userEvent.click(screen.getByRole('button', { name: 'Retry all failed' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByRole('textbox'), 'Outage over');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Retry all failed' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Nothing to retry from the last 7 days.');
  });

  it('keeps the queued-again toast when some were queued', async () => {
    apiFetch.mockResolvedValue({ queued: 2, skipped: 1 });
    render(<SourcesScreen {...base} />);

    await userEvent.click(screen.getByRole('button', { name: 'Retry all failed' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByRole('textbox'), 'Outage over');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Retry all failed' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Failed reads queued again. Walled ones are skipped.');
  });

  it('clears a stale error once a later action succeeds', async () => {
    const { ApiError } = await import('../../../lib/api.js');
    apiFetch.mockRejectedValueOnce(new ApiError(502, 'QUEUE_UNAVAILABLE', 'x'));
    render(<SourcesScreen {...base} readingOn={false} />);

    await userEvent.click(screen.getByRole('button', { name: 'Resume the queue' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByRole('textbox'), 'Site is back');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Retry' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Queued again.');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('Pause the queue asks for a reason, then turns the reading switch off', async () => {
    render(<SourcesScreen {...base} />);

    await userEvent.click(screen.getByRole('button', { name: 'Pause the queue' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Pause reading new sources?')).toBeInTheDocument();
    await userEvent.type(within(dialog).getByRole('textbox'), 'Provider outage');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Pause the queue' }));

    expect(apiFetch).toHaveBeenCalledWith('/admin/settings/switches/reading', {
      method: 'PUT',
      body: JSON.stringify({ on: false, reason: 'Provider outage' }),
    });
    expect(refresh).toHaveBeenCalled();
  });

  it('Resume the queue turns the switch on with no dialog', async () => {
    render(<SourcesScreen {...base} readingOn={false} />);

    await userEvent.click(screen.getByRole('button', { name: 'Resume the queue' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(apiFetch).toHaveBeenCalledWith('/admin/settings/switches/reading', {
      method: 'PUT',
      body: JSON.stringify({ on: true }),
    });
    expect(refresh).toHaveBeenCalled();
  });

  it('says so in words when the queue cannot be reached, paused or resumed', async () => {
    const { ApiError } = await import('../../../lib/api.js');
    const words = "Couldn't reach the reading queue. Nothing was changed. Try again.";
    apiFetch.mockRejectedValue(new ApiError(502, 'QUEUE_UNAVAILABLE', 'Something failed on our side. Try again.'));
    const { unmount } = render(<SourcesScreen {...base} />);

    await userEvent.click(screen.getByRole('button', { name: 'Pause the queue' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByRole('textbox'), 'Provider outage');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Pause the queue' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(words);
    unmount();

    render(<SourcesScreen {...base} readingOn={false} />);
    await userEvent.click(screen.getByRole('button', { name: 'Resume the queue' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(words);
  });

  it('says Nothing here. when the tab is empty', () => {
    render(<SourcesScreen {...base} rows={[]} />);

    expect(screen.getByText('Nothing here.')).toBeInTheDocument();
  });
});
