import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReportGroup } from '@curios/db-read/admin';

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

import { ReportsScreen, whenOf } from './reports-screen.js';

const NOW = new Date('2026-10-27T04:00:00Z'); // 12:00 in Malaysia

const group = (over: Partial<ReportGroup> = {}): ReportGroup => ({
  pageId: 'p1',
  displayName: 'Gadget Murah 88',
  handle: 'gadgetmurah88',
  reason: 'SCAM',
  count: 4,
  countToday: 4,
  latestAt: new Date('2026-10-27T01:00:00Z'),
  quote: 'iPhone 16 Pro Max RM899 only, transfer first then we post.',
  decidedAt: null,
  outcome: null,
  ...over,
});

const open = [
  group(),
  group({ pageId: 'p2', displayName: 'Coach Farah', handle: 'coachfarah', reason: 'IMPERSONATION', count: 1, countToday: 0, latestAt: new Date('2026-10-26T03:00:00Z'), quote: null }),
];
const closed = [group({ pageId: 'p3', displayName: 'Kedai Bunga Sri', handle: 'kedaibungasri', reason: 'WRONG_PRICES', count: 1, latestAt: new Date('2026-10-20T03:00:00Z'), decidedAt: new Date('2026-10-26T03:00:00Z'), outcome: 'Dismissed' })];

const base = { open, closed, status: 'open' as const, now: NOW };

beforeEach(() => {
  apiFetch.mockReset();
  apiFetch.mockResolvedValue(null);
  refresh.mockClear();
});

describe('ReportsScreen', () => {
  it('has Open and Closed tabs with counts, as links to ?status=', () => {
    render(<ReportsScreen {...base} />);

    const tabs = within(screen.getByRole('navigation', { name: 'Filter reports' }));
    expect(tabs.getByRole('link', { name: 'Open 2' })).toHaveAttribute('aria-current', 'true');
    expect(tabs.getByRole('link', { name: 'Open 2' })).toHaveAttribute('href', '/reports');
    expect(tabs.getByRole('link', { name: 'Closed 1' })).toHaveAttribute('href', '/reports?status=closed');
  });

  it('shows each open page: name, address, reason, count, when and the quote', () => {
    render(<ReportsScreen {...base} />);

    const row = screen.getByText('Gadget Murah 88').closest('li')!;
    expect(within(row).getByText('curios.my/gadgetmurah88')).toBeInTheDocument();
    expect(within(row).getByText('Looks like a scam')).toBeInTheDocument();
    expect(within(row).getByText(/4 reports/)).toBeInTheDocument();
    expect(within(row).getByText(/today/)).toBeInTheDocument();
    expect(within(row).getByText('iPhone 16 Pro Max RM899 only, transfer first then we post.')).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Email owner' })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Suspend page' })).toBeInTheDocument();

    const other = screen.getByText('Coach Farah').closest('li')!;
    expect(within(other).getByText(/1 report\b/)).toBeInTheDocument();
    expect(within(other).getByText(/yesterday/)).toBeInTheDocument();
    expect(other.querySelector('q')).toBeNull();
  });

  it('colours the reason: red for scam, amber for impersonation, grey for the rest', () => {
    render(<ReportsScreen {...base} closed={[]} open={[...open, group({ pageId: 'p9', displayName: 'Z', handle: 'z', reason: 'OTHER' }), group({ pageId: 'p8', displayName: 'Y', handle: 'y', reason: 'OFFENSIVE' })]} />);

    const dot = (label: string) => screen.getByText(label).querySelector('i') as HTMLElement;
    expect(dot('Looks like a scam').style.background).toBe('rgb(216, 69, 47)');
    expect(dot('Pretending to be someone').style.background).toBe('rgb(242, 163, 60)');
    expect(dot('Something else').style.background).toBe('rgb(154, 160, 171)');
    expect(dot('Offensive').style.background).toBe('rgb(216, 69, 47)');
  });

  it('shows the true closed count when the list is cut short', () => {
    render(<ReportsScreen {...base} closedCount={73} />);
    expect(within(screen.getByRole('navigation', { name: 'Filter reports' })).getByRole('link', { name: 'Closed 73' })).toBeInTheDocument();
  });

  it('shows closed pages with their outcome and no actions', () => {
    render(<ReportsScreen {...base} status="closed" />);

    expect(screen.queryByText('Gadget Murah 88')).not.toBeInTheDocument();
    const row = screen.getByText('Kedai Bunga Sri').closest('li')!;
    expect(within(row).getByText('Dismissed')).toBeInTheDocument();
    // The when is the decision (yesterday), not the report (a week ago).
    expect(within(row).getByText(/yesterday/)).toBeInTheDocument();
    expect(within(row).queryByRole('button')).toBeNull();
  });

  it('says Nothing here. when the tab is empty', () => {
    render(<ReportsScreen {...base} open={[]} />);

    expect(screen.getByText('Nothing here.')).toBeInTheDocument();
  });

  it('carries builder’s call 2 as the note', () => {
    render(<ReportsScreen {...base} />);

    expect(
      screen.getByText('Visitors report a page from the “Report this page” link in its footer. Nothing happens to a page until you act.'),
    ).toBeInTheDocument();
  });

  it('Dismiss asks for a reason, then posts to the dismiss route and refreshes', async () => {
    render(<ReportsScreen {...base} />);

    await userEvent.click(within(screen.getByText('Gadget Murah 88').closest('li')!).getByRole('button', { name: 'Dismiss' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Dismiss reports on curios.my/gadgetmurah88?')).toBeInTheDocument();
    expect(within(dialog).getByText('They move to Closed. Nothing changes on the page.')).toBeInTheDocument();

    await userEvent.type(within(dialog).getByRole('textbox'), '  Not a breach ');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Dismiss' }));

    expect(apiFetch).toHaveBeenCalledWith('/admin/pages/p1/reports/dismiss', {
      method: 'POST',
      body: JSON.stringify({ reason: 'Not a breach' }),
    });
    expect(refresh).toHaveBeenCalled();
    expect(await screen.findByRole('status')).toHaveTextContent('Reports dismissed.');
  });

  it('Email owner says the owner sees the reason, and posts to the email route', async () => {
    render(<ReportsScreen {...base} />);

    await userEvent.click(within(screen.getByText('Gadget Murah 88').closest('li')!).getByRole('button', { name: 'Email owner' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Email the owner of curios.my/gadgetmurah88?')).toBeInTheDocument();
    expect(within(dialog).getByText('They get an email with your reason. The page stays live.')).toBeInTheDocument();
    expect(within(dialog).getByText('The owner sees this.')).toBeInTheDocument();

    await userEvent.type(within(dialog).getByRole('textbox'), 'Please fix the prices');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send email' }));

    expect(apiFetch).toHaveBeenCalledWith('/admin/pages/p1/reports/email-owner', {
      method: 'POST',
      body: JSON.stringify({ reason: 'Please fix the prices' }),
    });
  });

  it('Suspend page uses the suspend copy and route', async () => {
    render(<ReportsScreen {...base} />);

    await userEvent.click(within(screen.getByText('Gadget Murah 88').closest('li')!).getByRole('button', { name: 'Suspend page' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Suspend curios.my/gadgetmurah88?')).toBeInTheDocument();

    await userEvent.type(within(dialog).getByRole('textbox'), 'Scam reports');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Suspend page' }));

    expect(apiFetch).toHaveBeenCalledWith('/admin/pages/p1/suspend', { method: 'POST', body: JSON.stringify({ reason: 'Scam reports' }) });
    // The row leaves Open because the page is read again.
    expect(refresh).toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows the API’s own words when someone else decided first', async () => {
    const { ApiError } = await import('../../../lib/api.js');
    apiFetch.mockRejectedValue(new ApiError(409, 'NO_OPEN_REPORTS', 'That page has no open reports.'));
    render(<ReportsScreen {...base} />);

    await userEvent.click(within(screen.getByText('Gadget Murah 88').closest('li')!).getByRole('button', { name: 'Dismiss' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByRole('textbox'), 'x');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Dismiss' }));

    expect(await within(dialog).findByText('That page has no open reports.')).toBeInTheDocument();
  });
});

describe('whenOf', () => {
  it('says today, yesterday, then days ago, on the Malaysian calendar', () => {
    expect(whenOf(new Date('2026-10-27T00:30:00Z'), NOW)).toBe('today');
    expect(whenOf(new Date('2026-10-26T15:59:00Z'), NOW)).toBe('yesterday');
    expect(whenOf(new Date('2026-10-24T05:00:00Z'), NOW)).toBe('3 days ago');
  });
});
