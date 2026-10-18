import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { OrderStats } from '@curios/db-read';
import type { OrderRow } from './order-detail.js';
import { OrdersScreen } from './orders-screen.js';

vi.mock('next/navigation', () => ({ usePathname: () => '/app/orders' }));

// Friday 16 Oct 2026, 2pm in Malaysia.
const now = new Date('2026-10-16T06:00:00Z');

const base: OrderRow = {
  id: 'o13',
  number: 13,
  code: 'YVA4',
  customerName: 'Mira Hassan',
  phone: '+60123456789',
  method: 'PICKUP',
  day: '2026-10-17',
  address: null,
  note: null,
  itemsCents: 23500,
  deliveryCents: 0,
  totalCents: 23500,
  status: 'PLACED',
  receiptUrl: 'https://cdn.example/r.jpg',
  receiptType: 'image/jpeg',
  receiptUploadedAt: new Date('2026-10-16T02:09:00Z'),
  receiptRejectedAt: null,
  paidAt: null,
  completedAt: null,
  cancelledAt: null,
  refundedAt: null,
  createdAt: new Date('2026-10-16T02:02:00Z'),
  lines: [
    { itemName: 'Kek coklat moist', optionLabel: '1kg', unitPriceCents: 9500, quantity: 2, photoUrl: null },
    { itemName: 'Kek batik', optionLabel: null, unitPriceCents: 4500, quantity: 1, photoUrl: null },
  ],
};
const none = { receiptUrl: null, receiptType: null, receiptUploadedAt: null };
const one = (name: string, cents: number) => [{ itemName: name, optionLabel: null, unitPriceCents: cents, quantity: 1, photoUrl: null }];

const orders: OrderRow[] = [
  base,
  { ...base, ...none, id: 'o12', number: 12, customerName: 'Hakim Rahman', method: 'DELIVERY', totalCents: 18000, lines: one('Kek coklat moist', 17000) },
  { ...base, id: 'o11', number: 11, customerName: 'Wei Ling', day: '2026-10-16', totalCents: 7000, status: 'PAID', paidAt: new Date('2026-10-15T13:41:00Z'), lines: [...one('Cookies balang', 2500), ...one('Kek batik', 4500)] },
  { ...base, id: 'o10', number: 10, customerName: 'Aina Sofea', method: 'DELIVERY', totalCents: 10000, status: 'PAID', paidAt: new Date('2026-10-13T07:02:00Z') },
  { ...base, id: 'o9', number: 9, customerName: 'Farid Azman', day: '2026-10-14', totalCents: 12000, status: 'CANCELLED', paidAt: new Date('2026-10-12T04:05:00Z'), cancelledAt: new Date('2026-10-13T01:00:00Z'), lines: one('Burnt cheesecake', 12000) },
  { ...base, id: 'o8', number: 8, customerName: 'Siti Nur', day: '2026-10-13', totalCents: 5000, status: 'COMPLETED', paidAt: new Date('2026-10-11T09:10:00Z'), completedAt: new Date('2026-10-13T03:30:00Z') },
];

const stats: OrderStats = { toCheck: 1, toMake: 2, paidThisWeekCents: 17000, week: [0, 0, 5000, 10000, 0, 7000, 0] };

function show(list = orders, extra: { selected?: string | null; stats?: OrderStats } = {}) {
  const move = vi.fn(async () => undefined);
  const onChanged = vi.fn();
  render(
    <OrdersScreen
      orders={list}
      stats={extra.stats ?? stats}
      now={now}
      selected={extra.selected ?? null}
      keptMonths={12}
      shopUrl="/keklina/shop"
      publicUrl="https://curios.my/keklina/shop"
      pickupNote="Seksyen 7, Shah Alam. 10am to 6pm."
      move={move}
      onChanged={onChanged}
    />,
  );
  return { move, onChanged };
}

// These check the figures, not how they count up (count-up.test.tsx does): motion off.
const motion = window.matchMedia.bind(window);
beforeAll(() => {
  window.matchMedia = (query: string) => ({ ...motion(query), matches: query.includes('reduce') });
});
afterAll(() => {
  window.matchMedia = motion;
});

const figures = () => within(screen.getByRole('list', { name: 'Your orders' }));
const rows = () => within(screen.getByRole('list', { name: 'Orders' }));
const filter = (name: RegExp) => within(screen.getByRole('tablist', { name: 'Show orders' })).getByRole('tab', { name });

describe('OrdersScreen, the header and the figures', () => {
  it('says how the list is kept, and links to the shop', () => {
    show();
    expect(screen.getByRole('heading', { name: 'Orders', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('Newest first · kept for 12 months')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See your shop' })).toHaveAttribute('href', '/keklina/shop');
  });

  it('counts the receipts to check, what is paid and to make, and what was paid this week', () => {
    show();
    expect(figures().getByText('Receipts to check').previousSibling).toHaveTextContent('1');
    expect(figures().getByText('Paid, to make').previousSibling).toHaveTextContent('2');
    expect(figures().getByText('Paid this week').previousSibling).toHaveTextContent('RM170');
  });

  it('says a week with sen in it exactly', () => {
    show(orders, { stats: { ...stats, paidThisWeekCents: 17050 } });
    expect(figures().getByText('Paid this week').previousSibling).toHaveTextContent('RM170.50');
  });

  it('draws the last seven days of payments, today last', () => {
    const { container } = render(
      <OrdersScreen orders={orders} stats={stats} now={now} selected={null} keptMonths={12} shopUrl="/s" publicUrl="/s" pickupNote={null} move={vi.fn()} onChanged={vi.fn()} />,
    );
    const bars = container.querySelectorAll('[data-spark] i');
    expect(bars).toHaveLength(7);
    expect(bars[6]).toHaveAttribute('data-today');
  });
});

describe('OrdersScreen, the list', () => {
  it('shows each order with its number, what and when, its total and its badge', () => {
    show();
    const mira = rows().getByRole('button', { name: /Mira Hassan/ });
    expect(mira).toHaveTextContent('#13 · 3 items · Pickup Sat');
    expect(mira).toHaveTextContent('RM235');
    expect(mira).toHaveTextContent('To check');
    expect(within(mira).getByLabelText('Receipt to check')).toBeInTheDocument();
    expect(rows().getByRole('button', { name: /Hakim Rahman/ })).toHaveTextContent('#12 · 1 item · Delivery Sat');
    expect(rows().getByRole('button', { name: /Hakim Rahman/ })).toHaveTextContent('Awaiting payment');
    expect(rows().getByRole('button', { name: /Wei Ling/ })).toHaveTextContent('Paid');
    expect(rows().getByRole('button', { name: /Farid Azman/ })).toHaveTextContent('Refund owed');
    expect(rows().getByRole('button', { name: /Siti Nur/ })).toHaveTextContent('Completed');
  });

  it('opens the newest first, and the one chosen', () => {
    show();
    expect(screen.getByRole('heading', { name: '#13 · Mira Hassan' })).toBeInTheDocument();
    fireEvent.click(rows().getByRole('button', { name: /Wei Ling/ }));
    expect(screen.getByRole('heading', { name: '#11 · Wei Ling' })).toBeInTheDocument();
    expect(rows().getByRole('button', { name: /Wei Ling/ })).toHaveAttribute('aria-current', 'true');
  });

  it('opens the order the link names (?order=)', () => {
    show(orders, { selected: 'o10' });
    expect(screen.getByRole('heading', { name: '#10 · Aina Sofea' })).toBeInTheDocument();
  });

  it('filters to check, paid and refunds, counting each', () => {
    show();
    expect(filter(/^All/)).toHaveTextContent(/^All$/);
    expect(filter(/^To check/)).toHaveTextContent('1');
    expect(filter(/^Paid/)).toHaveTextContent('2');
    expect(filter(/^Refunds/)).toHaveTextContent('1');

    fireEvent.click(filter(/^Paid/));
    expect(rows().getAllByRole('button').map((b) => b.querySelector('b')?.textContent)).toEqual(['Wei Ling', 'Aina Sofea']);
    expect(screen.getByRole('heading', { name: '#11 · Wei Ling' })).toBeInTheDocument();

    fireEvent.click(filter(/^Refunds/));
    expect(rows().getAllByRole('button')).toHaveLength(1);
    expect(screen.getByRole('heading', { name: '#9 · Farid Azman' })).toBeInTheDocument();
  });

  it('says so when a filter has nothing in it', () => {
    show(orders.filter((o) => o.status !== 'CANCELLED'));
    expect(filter(/^Refunds/)).toHaveTextContent(/^Refunds$/);
    fireEvent.click(filter(/^Refunds/));
    expect(screen.getByText('All clear')).toBeInTheDocument();
    expect(screen.getByText('Nobody is waiting on a refund.')).toBeInTheDocument();
  });

  it('shows the toast in the board’s words after a move, and reads the server again', async () => {
    const { move, onChanged } = show();
    fireEvent.click(screen.getByRole('button', { name: 'Mark paid' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('#13 marked paid. Mira can see it on their order page.'));
    expect(move).toHaveBeenCalledWith('o13', 'paid');
    expect(onChanged).toHaveBeenCalled();
  });
});

describe('OrdersScreen, before the first order', () => {
  it('says where the first order lands, with the link to share and the shop to set up', () => {
    show([], { stats: { toCheck: 0, toMake: 0, paidThisWeekCents: 0, week: [0, 0, 0, 0, 0, 0, 0] } });
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Your first order lands here' })).toBeInTheDocument();
    expect(screen.getByText('When someone checks out in your shop, the order shows up here with their receipt. You check it, mark it paid, and make it.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy your link' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Set up your shop' })).toHaveAttribute('href', '/app/store');
    expect(figures().getByText('Paid this week').previousSibling).toHaveTextContent('RM0');
  });
});
