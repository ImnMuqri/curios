import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Payments } from '@curios/db-read/admin';

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

import { PaymentsScreen } from './payments-screen.js';

const NOW = new Date('2026-10-27T04:00:00Z'); // 12:00 in Malaysia

function fixture(over: Partial<Payments> = {}): Payments {
  return {
    receivedCents: 1_038_800,
    paying: { total: 212, monthly: 186, annual: 26 },
    endingThisWeek: 6,
    failedWebhooks24h: 1,
    rows: [
      { id: 'a', createdAt: new Date('2026-10-27T02:48:00Z'), name: 'Nasi Lemak Kak Mah', plan: 'MONTHLY', paidVia: 'FPX', amountCents: 4900, status: 'Paid', providerRef: 'CHIP-8QW2' },
      { id: 'b', createdAt: new Date('2026-10-27T01:12:00Z'), name: 'Studio Hana', plan: 'ANNUAL', paidVia: null, amountCents: 49_000, status: 'Not confirmed', providerRef: 'CHIP-8QT9' },
      { id: 'c', createdAt: new Date('2026-10-26T05:00:00Z'), name: 'Coach Farah', plan: 'MONTHLY', paidVia: null, amountCents: 4900, status: 'Abandoned', providerRef: null },
      { id: 'd', createdAt: new Date('2026-10-22T05:00:00Z'), name: 'Klinik Aina', plan: 'MONTHLY', paidVia: 'Card', amountCents: 4900, status: 'Failed', providerRef: 'CHIP-8Q7Z' },
    ],
    webhooks: [
      { id: 'w1', eventType: 'purchase.paid', purchaseId: 'CHIP-8QT9', attempts: 3, outcome: 'failed', statusCode: 500, lastAttemptAt: new Date('2026-10-27T01:12:00Z'), displayName: 'Studio Hana' },
      { id: 'w2', eventType: 'purchase.paid', purchaseId: 'CHIP-8QW2', attempts: 1, outcome: 'ok', statusCode: 200, lastAttemptAt: new Date('2026-10-27T02:48:00Z'), displayName: 'Kak Mah' },
      { id: 'w3', eventType: 'purchase.cancelled', purchaseId: 'CHIP-8QK1', attempts: 1, outcome: 'ok', statusCode: 200, lastAttemptAt: new Date('2026-10-26T05:00:00Z'), displayName: null },
    ],
    shop: { orders: 1204, totalCents: 9_834_000, shops: 131 },
    ...over,
  };
}

const figure = (label: string) => screen.getByText(label).closest('div') as HTMLElement;

beforeEach(() => {
  apiFetch.mockReset();
  apiFetch.mockResolvedValue({ status: 'ok' });
  refresh.mockClear();
});

describe('PaymentsScreen', () => {
  it('shows the four figures with their sublines and no Refunded', () => {
    render(<PaymentsScreen payments={fixture()} period="30d" now={NOW} />);

    expect(within(figure('Received, the last 30 days')).getByText('RM10,388')).toBeInTheDocument();
    expect(within(figure('Paying for Business')).getByText('212')).toBeInTheDocument();
    expect(within(figure('Paying for Business')).getByText('186 monthly, 26 yearly')).toBeInTheDocument();
    expect(within(figure('Ending this week')).getByText('6')).toBeInTheDocument();
    expect(within(figure('Ending this week')).getByText('Reminders go 3 days before')).toBeInTheDocument();
    expect(within(figure('Webhook failed')).getByText('1')).toBeInTheDocument();
    const note = within(figure('Webhook failed')).getByText('Needs a replay');
    expect(note.style.color).toBe('rgb(180, 50, 31)');
    expect(screen.queryByText(/Refunded/)).not.toBeInTheDocument();
  });

  it('does not paint Needs a replay red at 0', () => {
    render(<PaymentsScreen payments={fixture({ failedWebhooks24h: 0 })} period="7d" now={NOW} />);

    expect(within(figure('Webhook failed')).getByText('0')).toBeInTheDocument();
    expect(within(figure('Webhook failed')).getByText('Needs a replay').style.color).not.toBe('rgb(180, 50, 31)');
  });

  it('lists the Business payments with the board’s columns, a dash where Paid by is unknown', () => {
    render(<PaymentsScreen payments={fixture()} period="7d" now={NOW} />);

    const table = screen.getByRole('table', { name: 'Business payments' });
    const heads = within(table).getAllByRole('columnheader').map((h) => h.textContent);
    expect(heads).toEqual(['Date', 'Page', 'Plan', 'Paid by', 'Amount', 'Status', 'CHIP ref']);
    const rs = within(table).getAllByRole('row');
    expect(rs).toHaveLength(5);
    expect(within(rs[1]!).getByText('Today 10:48')).toBeInTheDocument();
    expect(within(rs[1]!).getByText('Nasi Lemak Kak Mah')).toBeInTheDocument();
    expect(within(rs[1]!).getByText('Monthly')).toBeInTheDocument();
    expect(within(rs[1]!).getByText('FPX')).toBeInTheDocument();
    expect(within(rs[1]!).getByText('RM49')).toBeInTheDocument();
    expect(within(rs[1]!).getByText('Paid')).toBeInTheDocument();
    expect(within(rs[1]!).getByText('CHIP-8QW2')).toBeInTheDocument();
    expect(within(rs[2]!).getByText('Yearly')).toBeInTheDocument();
    expect(within(rs[2]!).getByText('RM490')).toBeInTheDocument();
    expect(within(rs[2]!).getByText('—')).toBeInTheDocument();
    expect(within(rs[3]!).getByText('Yesterday')).toBeInTheDocument();
    expect(within(rs[3]!).getAllByText('—')).toHaveLength(2);
    expect(within(rs[4]!).getByText('22 Oct')).toBeInTheDocument();
  });

  it('colours each status as the board does', () => {
    render(<PaymentsScreen payments={fixture()} period="7d" now={NOW} />);

    const dot = (label: string) => screen.getByText(label).querySelector('i') as HTMLElement;
    expect(dot('Paid').style.background).toBe('rgb(29, 154, 108)');
    expect(dot('Not confirmed').style.background).toBe('rgb(242, 163, 60)');
    expect(dot('Abandoned').style.background).toBe('rgb(154, 160, 171)');
    expect(dot('Failed').style.background).toBe('rgb(216, 69, 47)');
  });

  it('reads each webhook as event · purchase, with failed attempts and a subline', () => {
    render(<PaymentsScreen payments={fixture()} period="7d" now={NOW} />);

    expect(screen.getByText('Last 24 hours')).toBeInTheDocument();
    expect(screen.getByText('purchase.paid · CHIP-8QT9 · failed 3 times')).toBeInTheDocument();
    expect(screen.getByText('Our server answered 500. Studio Hana’s payment may not show as paid.')).toBeInTheDocument();
    expect(screen.getByText('purchase.paid · CHIP-8QW2')).toBeInTheDocument();
    expect(screen.getByText('Today 10:48 · 200 OK')).toBeInTheDocument();
    expect(screen.getByText('purchase.cancelled · CHIP-8QK1')).toBeInTheDocument();
    expect(screen.getByText('Yesterday · 200 OK')).toBeInTheDocument();
  });

  it('shows Replay on failed webhooks only', () => {
    render(<PaymentsScreen payments={fixture()} period="7d" now={NOW} />);

    expect(screen.getAllByRole('button', { name: 'Replay' })).toHaveLength(1);
    expect(screen.getByText('purchase.paid · CHIP-8QT9 · failed 3 times').closest('div')).toContainElement(
      screen.getByRole('button', { name: 'Replay' }),
    );
  });

  it('Replay asks for a reason, posts it and toasts the returned status', async () => {
    apiFetch.mockResolvedValue({ status: 'Studio Hana is paid until 3 Oct 2027.' });
    render(<PaymentsScreen payments={fixture()} period="7d" now={NOW} />);

    await userEvent.click(screen.getByRole('button', { name: 'Replay' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByRole('textbox'), ' Webhook failed 3 times ');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Replay' }));

    expect(apiFetch).toHaveBeenCalledWith('/admin/webhooks/w1/replay', {
      method: 'POST',
      body: JSON.stringify({ reason: 'Webhook failed 3 times' }),
    });
    expect(refresh).toHaveBeenCalled();
    expect(await screen.findByRole('status')).toHaveTextContent('Replayed. Studio Hana is paid until 3 Oct 2027.');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps the dialog on the API’s message and still refreshes when a replay fails again', async () => {
    const { ApiError } = await import('../../../lib/api.js');
    apiFetch.mockRejectedValue(new ApiError(502, 'CHIP_UNREACHABLE', 'CHIP could not be reached.'));
    render(<PaymentsScreen payments={fixture()} period="7d" now={NOW} />);

    await userEvent.click(screen.getByRole('button', { name: 'Replay' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByRole('textbox'), 'Again');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Replay' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('CHIP could not be reached.');
    expect(refresh).toHaveBeenCalled();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('carries the note and the shop-orders box', () => {
    render(<PaymentsScreen payments={fixture()} period="7d" now={NOW} />);

    expect(
      screen.getByText('Shop orders are paid into each owner’s own CHIP account. Curios only sees that an order was paid, never the money.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Shop orders paid online, this month')).toBeInTheDocument();
    expect(screen.getByText('1,204 orders · RM98,340')).toBeInTheDocument();
    expect(screen.getByText('Across 131 shops. Owners’ money, shown for scale only.')).toBeInTheDocument();
  });

  it('says order and shop in the singular for one', () => {
    render(<PaymentsScreen payments={fixture({ shop: { orders: 1, totalCents: 1000, shops: 1 } })} period="7d" now={NOW} />);

    expect(screen.getByText('1 order · RM10')).toBeInTheDocument();
    expect(screen.getByText('Across 1 shop. Owners’ money, shown for scale only.')).toBeInTheDocument();
  });

  it('says so when there are no payments or webhooks', () => {
    render(<PaymentsScreen payments={fixture({ rows: [], webhooks: [] })} period="7d" now={NOW} />);

    expect(screen.getByText('No payments yet.')).toBeInTheDocument();
    expect(screen.getByText('No webhooks in the last 24 hours.')).toBeInTheDocument();
  });

  it('marks the period and links the others', () => {
    render(<PaymentsScreen payments={fixture()} period="today" now={NOW} />);

    const nav = screen.getByRole('navigation', { name: 'Period' });
    expect(within(nav).getByRole('link', { name: 'Today' })).toHaveAttribute('aria-current', 'true');
    expect(within(nav).getByRole('link', { name: '30 days' })).toHaveAttribute('href', '/payments?period=30d');
    expect(within(nav).getByRole('link', { name: '7 days' })).toHaveAttribute('href', '/payments');
  });
});
