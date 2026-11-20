import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  pickupPlaceName: null,
  pickupPlaceAddress: null,
  pickupFrom: null,
  pickupTo: null,
  note: null,
  itemsCents: 23500,
  deliveryCents: 0,
  totalCents: 23500,
  discountCents: 0,
  voucherLabel: null,
  status: 'PLACED',
  receiptUrl: 'https://cdn.example/r.jpg',
  receiptType: 'image/jpeg',
  receiptUploadedAt: new Date('2026-10-16T02:09:00Z'),
  receiptRejectedAt: null,
  paidAt: null,
  completedAt: null,
  cancelledAt: null,
  refundedAt: null,
  paidVia: null,
  paidMethodLabel: null,
  paidRef: null,
  chipPaidTwiceAt: null,
  secondRefundedAt: null,
  createdAt: new Date('2026-10-16T02:02:00Z'),
  email: null,
  sentAt: null,
  lines: [
    { id: 'l1', digital: null, itemName: 'Kek coklat moist', optionLabel: '1kg', unitPriceCents: 9500, quantity: 2, photoUrl: null },
    { id: 'l1', digital: null, itemName: 'Kek batik', optionLabel: null, unitPriceCents: 4500, quantity: 1, photoUrl: null },
  ],
};
const none = { receiptUrl: null, receiptType: null, receiptUploadedAt: null };
const one = (name: string, cents: number) => [{ id: 'l1', digital: null, itemName: name, optionLabel: null, unitPriceCents: cents, quantity: 1, photoUrl: null }];

const orders: OrderRow[] = [
  base,
  { ...base, ...none, id: 'o12', number: 12, customerName: 'Hakim Rahman', method: 'DELIVERY', totalCents: 18000, lines: one('Kek coklat moist', 17000) },
  { ...base, id: 'o11', number: 11, customerName: 'Wei Ling', day: '2026-10-16', totalCents: 7000, status: 'PAID', paidAt: new Date('2026-10-15T13:41:00Z'), lines: [...one('Cookies balang', 2500), ...one('Kek batik', 4500)] },
  { ...base, id: 'o10', number: 10, customerName: 'Aina Sofea', method: 'DELIVERY', totalCents: 10000, status: 'PAID', paidAt: new Date('2026-10-13T07:02:00Z') },
  { ...base, id: 'o9', number: 9, customerName: 'Farid Azman', day: '2026-10-14', totalCents: 12000, status: 'CANCELLED', paidAt: new Date('2026-10-12T04:05:00Z'), cancelledAt: new Date('2026-10-13T01:00:00Z'), lines: one('Burnt cheesecake', 12000) },
  { ...base, id: 'o8', number: 8, customerName: 'Siti Nur', day: '2026-10-13', totalCents: 5000, status: 'COMPLETED', paidAt: new Date('2026-10-11T09:10:00Z'), completedAt: new Date('2026-10-13T03:30:00Z') },
];

const stats: OrderStats = { toCheck: 1, toMake: 2, paidThisWeekCents: 17000, paidDaysCents: [0, 0, 0, 0, 0, 0, 17000], paidTodayCents: 17000 };

function show(
  list = orders,
  extra: { selected?: string | null; stats?: OrderStats; paging?: { older: string | null; paged: boolean }; move?: () => Promise<void> } = {},
) {
  const move = vi.fn(extra.move ?? (async () => undefined));
  const onChanged = vi.fn();
  const view = (next: OrderRow[]) => (
    <OrdersScreen
      orders={next}
      paging={extra.paging}
      stats={extra.stats ?? stats}
      now={now}
      selected={extra.selected ?? null}
      keptMonths={12}
      shopUrl="/keklina/shop"
      publicUrl="https://curios.my/keklina/shop"
      move={move}
      act={vi.fn()}
      onChanged={onChanged}
    />
  );
  const { rerender } = render(view(list));
  // The server's read after a move: the same screen with the orders as they are now.
  return { move, onChanged, refresh: (next: OrderRow[]) => rerender(view(next)) };
}

const header = () => screen.getByRole('heading', { name: 'Orders', level: 1 }).closest('header')!;
const strip = () => within(screen.getByRole('group', { name: 'Orders at a glance' }));
const chip = (name: RegExp) => within(screen.getByRole('group', { name: 'Show orders' })).getByRole('button', { name });
/** Every order row on the screen, newer and older, in order. */
const rowButtons = () => [...document.querySelectorAll<HTMLButtonElement>('[data-order-row]')];
const names = () => rowButtons().map((b) => b.querySelector('b')?.textContent);
const rowOf = (name: string) => rowButtons().find((b) => b.querySelector('b')?.textContent === name)!;
const detailName = () => screen.getByRole('heading', { level: 2 }).textContent;

describe('OrdersScreen, the header', () => {
  it('has the Inbox kicker, the title, the board’s line, and See your shop', () => {
    show();
    expect(within(header()).getByText('Inbox')).toBeInTheDocument();
    expect(within(header()).getByText('Check receipts first. Everything else waits for you below.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See your shop' })).toHaveAttribute('href', '/keklina/shop');
    expect(screen.getByText('Newest first · kept for 12 months')).toBeInTheDocument();
  });
});

describe('OrdersScreen, the stat cards', () => {
  it('shows the receipts to check (urgent), what is paid and to make, and this week with today and the spark', () => {
    show();
    const check = strip().getByRole('button', { name: /Receipt to check/ });
    expect(check).toHaveTextContent('Receipt to check1Check it →');
    expect(strip().getByRole('button', { name: /Paid, to make/ })).toHaveTextContent('Paid, to make2See them →');
    const week = screen.getByText('This week').parentElement!;
    expect(week).toHaveTextContent('RM170');
    expect(week).toHaveTextContent('+RM170 today');
    // Seven bars, today last.
    expect(week.querySelectorAll('svg rect')).toHaveLength(7);
    // The arrows are decoration.
    for (const arrow of screen.getAllByText('→')) expect(arrow).toHaveAttribute('aria-hidden', 'true');
  });

  it('leaves out the today line when nothing came in today', () => {
    show(orders, { stats: { ...stats, paidTodayCents: 0, paidDaysCents: [17000, 0, 0, 0, 0, 0, 0] } });
    expect(screen.queryByText(/today$/)).toBeNull();
  });

  it('draws exactly seven bars, whatever length the series comes in', () => {
    show(orders, { stats: { ...stats, paidDaysCents: [5, 1, 2, 3, 4, 5, 6, 7, 17000] } });
    expect(screen.getByText('This week').parentElement!.querySelectorAll('svg rect')).toHaveLength(7);
  });

  it('says one count everywhere: the urgent card, the To check chip and stats.toCheck', () => {
    show(orders, { stats: { ...stats, toCheck: 3 } });
    expect(strip().getByRole('button', { name: /Receipt to check/ }).querySelector('b')).toHaveTextContent('3');
    expect(chip(/^To check/).querySelector('u')).toHaveTextContent('3');
    expect(chip(/^Paid/).querySelector('u')).toHaveTextContent(String(stats.toMake));
  });

  it('filters the list from a card, and clears it with a second click', () => {
    show();
    const check = strip().getByRole('button', { name: /Receipt to check/ });
    fireEvent.click(check);
    expect(check).toHaveAttribute('aria-pressed', 'true');
    expect(chip(/^To check/)).toHaveAttribute('aria-pressed', 'true');
    expect(names()).toEqual(['Mira Hassan']);
    fireEvent.click(check);
    expect(check).toHaveAttribute('aria-pressed', 'false');
    expect(chip(/^All/)).toHaveAttribute('aria-pressed', 'true');
    expect(names()).toHaveLength(orders.length);

    fireEvent.click(strip().getByRole('button', { name: /Paid, to make/ }));
    expect(names()).toEqual(['Wei Ling', 'Aina Sofea']);
  });
});

describe('OrdersScreen, the filter bar', () => {
  it('has All, To check, Paid and Refunds, the counts as plain numbers', () => {
    show();
    expect(chip(/^All/)).toHaveTextContent(/^All$/);
    expect(chip(/^To check/)).toHaveTextContent('To check1');
    expect(chip(/^Paid/)).toHaveTextContent('Paid2');
    expect(chip(/^Refunds/)).toHaveTextContent('Refunds1');
    for (const u of document.querySelectorAll('u')) expect(u).not.toHaveAttribute('data-tone');
  });

  it('filters to check, paid and refunds, opening the first of each', () => {
    show();
    fireEvent.click(chip(/^Paid/));
    expect(names()).toEqual(['Wei Ling', 'Aina Sofea']);
    expect(detailName()).toBe('Wei Ling');
    fireEvent.click(chip(/^Refunds/));
    expect(names()).toEqual(['Farid Azman']);
    expect(detailName()).toBe('Farid Azman');
  });

  it('says All clear, in the words for that filter, when a filter has nothing in it', () => {
    show(orders.filter((o) => o.status !== 'CANCELLED'));
    // A zero is not shown, as the board never draws one.
    expect(chip(/^Refunds/)).toHaveTextContent(/^Refunds$/);
    fireEvent.click(chip(/^Refunds/));
    expect(screen.getByText('All clear')).toBeInTheDocument();
    expect(screen.getByText('Nobody is waiting on a refund.')).toBeInTheDocument();
  });

  const search = () => screen.getByRole('searchbox', { name: 'Search name or order' });

  it('narrows the list by name, by order number, and by an item, inside the filter chosen', () => {
    show();
    expect(search()).toHaveAttribute('placeholder', 'Search name or order');
    fireEvent.change(search(), { target: { value: 'wei' } });
    expect(names()).toEqual(['Wei Ling']);
    expect(detailName()).toBe('Wei Ling');
    fireEvent.change(search(), { target: { value: '#10' } });
    expect(names()).toEqual(['Aina Sofea']);
    fireEvent.change(search(), { target: { value: 'cheesecake' } });
    expect(names()).toEqual(['Farid Azman']);
    fireEvent.click(chip(/^Paid/));
    expect(screen.getByText('No match')).toBeInTheDocument();
  });

  it('says No match in the board’s words, and keeps the chips counting', () => {
    show();
    fireEvent.change(search(), { target: { value: 'nobody' } });
    expect(screen.getByText('No match')).toBeInTheDocument();
    expect(screen.getByText('Try a name or an order number, like 14.')).toBeInTheDocument();
    expect(chip(/^Paid/)).toHaveTextContent('2');
  });
});

describe('OrdersScreen, the list', () => {
  it('shows each order with its number, how many and when, its total and its tag', () => {
    show();
    const mira = rowOf('Mira Hassan');
    expect(mira).toHaveTextContent('#13 · 3 items · Pickup Sat');
    expect(mira).toHaveTextContent('RM235');
    expect(within(mira).getByText('To check')).toHaveAttribute('data-tone', 'wait');
    expect(rowOf('Hakim Rahman')).toHaveTextContent('#12 · 1 item · Delivery Sat');
    expect(within(rowOf('Hakim Rahman')).getByText('Awaiting payment')).not.toHaveAttribute('data-tone');
    expect(within(rowOf('Wei Ling')).getByText('Paid')).toHaveAttribute('data-tone', 'ok');
    expect(within(rowOf('Farid Azman')).getByText('Refund owed')).toHaveAttribute('data-tone', 'red');
    expect(within(rowOf('Siti Nur')).getByText('Completed')).toHaveAttribute('data-tone', 'ok');
  });

  it('reads Cancelled in grey for an order cancelled before payment', () => {
    show([{ ...orders[1]!, status: 'CANCELLED', cancelledAt: new Date('2026-10-16T03:00:00Z') }]);
    expect(within(rowOf('Hakim Rahman')).getByText('Cancelled')).not.toHaveAttribute('data-tone');
  });

  it('adds the pickup time an order kept to its row', () => {
    show([{ ...base, pickupPlaceName: 'Home', pickupPlaceAddress: 'Seksyen 7', pickupFrom: 600, pickupTo: 720 }]);
    expect(rowOf('Mira Hassan')).toHaveTextContent('#13 · 3 items · Pickup Sat, 10am–12pm');
  });

  it('opens the newest first, and the one chosen', () => {
    show();
    expect(detailName()).toBe('Mira Hassan');
    fireEvent.click(rowOf('Wei Ling'));
    expect(detailName()).toBe('Wei Ling');
    expect(rowOf('Wei Ling')).toHaveAttribute('aria-current', 'true');
    expect(rowOf('Mira Hassan')).toHaveAttribute('aria-current', 'false');
  });

  it('opens the order the link names (?order=)', () => {
    show(orders, { selected: 'o10' });
    expect(detailName()).toBe('Aina Sofea');
  });

  it('puts orders placed before the last 7 days under Older orders, on the All list only', () => {
    const old: OrderRow = { ...orders[5]!, id: 'o3', number: 3, customerName: 'Zara Ismail', createdAt: new Date('2026-10-08T02:00:00Z') };
    show([...orders, old]);
    const older = screen.getByRole('list', { name: 'Older orders' });
    expect(within(older).getAllByRole('button').map((b) => b.querySelector('b')?.textContent)).toEqual(['Zara Ismail']);
    expect(within(screen.getByRole('list', { name: 'Orders' })).getAllByRole('button')).toHaveLength(orders.length);
    fireEvent.click(chip(/^Paid/));
    expect(screen.queryByText('Older orders')).toBeNull();
  });

  it('says nothing of older orders when every order is from this week', () => {
    show();
    expect(screen.queryByText('Older orders')).toBeNull();
  });

  it('shows Paid twice, in red, in the list while the second payment is owed back', () => {
    const twice: OrderRow = { ...base, ...none, id: 'o15', number: 15, customerName: 'Laila Musa', status: 'PAID', paidAt: new Date('2026-10-16T03:20:00Z'), paidVia: 'RECEIPT', chipPaidTwiceAt: new Date('2026-10-16T03:30:00Z') };
    show([twice, ...orders]);
    expect(within(rowOf('Laila Musa')).getByText('Paid twice')).toHaveAttribute('data-tone', 'red');
    // Listed under Refunds, and counted there; still under Paid.
    expect(chip(/^Refunds/)).toHaveTextContent('2');
    fireEvent.click(chip(/^Refunds/));
    expect(names()).toContain('Laila Musa');
    fireEvent.click(chip(/^Paid/));
    expect(names()).toContain('Laila Musa');
  });

  it('leaves Refunds, and reads Paid, once the second payment is marked refunded', () => {
    const done: OrderRow = { ...base, ...none, id: 'o15', number: 15, customerName: 'Laila Musa', status: 'PAID', paidAt: new Date('2026-10-16T03:20:00Z'), paidVia: 'RECEIPT', chipPaidTwiceAt: new Date('2026-10-16T03:30:00Z'), secondRefundedAt: new Date('2026-10-16T05:00:00Z') };
    show([done, ...orders]);
    expect(within(rowOf('Laila Musa')).getByText('Paid')).toBeInTheDocument();
    fireEvent.click(chip(/^Refunds/));
    expect(names()).not.toContain('Laila Musa');
  });

  it('shows the toast in the board’s words after a move, and reads the server again', async () => {
    const { move, onChanged } = show();
    fireEvent.click(screen.getByRole('button', { name: 'Mark paid' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('#13 marked paid. Mira can see it on their order page.'));
    expect(move).toHaveBeenCalledWith('o13', 'paid');
    expect(onChanged).toHaveBeenCalled();
  });
});

describe('OrdersScreen, paging', () => {
  it('offers no paging when every order fits', () => {
    show();
    expect(screen.queryByRole('navigation', { name: 'More orders' })).toBeNull();
  });

  it('keeps the pager at the foot: older orders below the last finished one, and back to the newest', () => {
    show(orders, { paging: { older: 'o3', paged: true } });
    const nav = screen.getByRole('navigation', { name: 'More orders' });
    expect(within(nav).getByRole('link', { name: 'Older orders' })).toHaveAttribute('href', '/app/orders?before=o3');
    expect(within(nav).getByRole('link', { name: 'Newest' })).toHaveAttribute('href', '/app/orders');
  });
});

describe('OrdersScreen, on a phone', () => {
  let matches = true;
  beforeEach(() => {
    matches = true;
    vi.stubGlobal('matchMedia', (query: string) => ({ matches, media: query, addEventListener() {}, removeEventListener() {} }));
  });
  afterEach(() => vi.unstubAllGlobals());

  const split = () => document.querySelector('[data-order-row]')!.closest('ul')!.parentElement!.parentElement!;

  it('opens a picked order as its own view, focusing its heading, and goes back to the row it came from', async () => {
    show();
    expect(split()).not.toHaveAttribute('data-open');
    fireEvent.click(rowOf('Wei Ling'));
    expect(split()).toHaveAttribute('data-open');
    await waitFor(() => expect(screen.getByRole('heading', { level: 2, name: 'Wei Ling' })).toHaveFocus());

    fireEvent.click(screen.getByRole('button', { name: 'All orders' }));
    expect(split()).not.toHaveAttribute('data-open');
    await waitFor(() => expect(rowOf('Wei Ling')).toHaveFocus());
  });

  it('keeps the detail beside the list on a wide screen: no own view, focus stays on the row', () => {
    matches = false;
    show();
    const row = rowOf('Wei Ling');
    row.focus();
    fireEvent.click(row);
    expect(split()).not.toHaveAttribute('data-open');
    expect(row).toHaveFocus();
  });

  it('opens the order the link names as its own view', () => {
    show(orders, { selected: 'o10' });
    expect(split()).toHaveAttribute('data-open');
  });
});

describe('OrdersScreen, after a move on a wide screen', () => {
  const paidNow = (o: OrderRow): OrderRow => ({ ...o, status: 'PAID', paidAt: new Date('2026-10-16T05:59:00Z'), paidVia: 'RECEIPT' });
  const second: OrderRow = { ...base, id: 'o14', number: 14, customerName: 'Laila Musa', createdAt: new Date('2026-10-16T01:00:00Z') };

  it('holds the order it moved, by id, instead of showing the next customer’s card under the pointer', async () => {
    const { refresh, onChanged } = show([base, second], { stats: { ...stats, toCheck: 2 } });
    fireEvent.click(chip(/^To check/));
    expect(screen.getByRole('heading', { level: 2, name: 'Mira Hassan' })).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Mark paid' }));
    });
    expect(onChanged).toHaveBeenCalled();
    refresh([paidNow(base), second]);
    // Mira's card stays, now paid, with its next move; Laila's receipt is in the list, not on the card.
    expect(screen.getByRole('heading', { level: 2, name: 'Mira Hassan' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark completed' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark paid' })).toBeNull();
    expect(names()).toEqual(['Laila Musa']);
    // The pressed control is gone: focus is on the card's heading, not the body.
    expect(screen.getByRole('heading', { level: 2, name: 'Mira Hassan' })).toHaveFocus();
    // Picking the other lets go.
    fireEvent.click(rowOf('Laila Musa'));
    expect(screen.getByRole('heading', { level: 2, name: 'Laila Musa' })).toBeInTheDocument();
  });

  it('lets go of the held order when a chip, a card or the search changes', async () => {
    const { refresh } = show([base, second], { stats: { ...stats, toCheck: 2 } });
    fireEvent.click(chip(/^To check/));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Mark paid' }));
    });
    refresh([paidNow(base), second]);
    expect(screen.getByRole('heading', { level: 2, name: 'Mira Hassan' })).toBeInTheDocument();
    fireEvent.click(chip(/^To check/));
    fireEvent.click(chip(/^To check/));
    expect(screen.getByRole('heading', { level: 2, name: 'Laila Musa' })).toBeInTheDocument();
  });
});

describe('OrdersScreen, before the first order', () => {
  it('shows Peek, where the first order lands, the link to share and the shop to set up, under the header line', () => {
    show([], { stats: { toCheck: 0, toMake: 0, paidThisWeekCents: 0, paidDaysCents: [0, 0, 0, 0, 0, 0, 0], paidTodayCents: 0 } });
    expect(screen.queryByRole('group', { name: 'Show orders' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Orders at a glance' })).toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: 'Your first order lands here' })).toBeInTheDocument();
    expect(screen.getByText('When someone checks out in your shop, the order shows up here with their receipt. You check it, mark it paid, and make it.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy your link' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Set up your shop' })).toHaveAttribute('href', '/app/store');
    expect(within(header()).getByText('Check receipts first. Everything else waits for you below.')).toBeInTheDocument();
  });
});

describe('OrdersScreen, orders paid online', () => {
  const online: OrderRow = { ...base, ...none, id: 'o14', number: 14, customerName: 'Nurul Izzah', status: 'PAID', paidAt: new Date('2026-10-16T03:20:00Z'), paidVia: 'CHIP', paidMethodLabel: 'FPX · Maybank2u', paidRef: 'CHIP-4K2X' };

  it('reads Paid online, in green, and is listed under Paid, never To check', () => {
    show([online, ...orders]);
    expect(within(rowOf('Nurul Izzah')).getByText('Paid online')).toHaveAttribute('data-tone', 'ok');
    fireEvent.click(chip(/^Paid/));
    expect(names()).toContain('Nurul Izzah');
    fireEvent.click(chip(/^To check/));
    expect(names()).not.toContain('Nurul Izzah');
  });
});

describe('OrdersScreen, a digital-only order', () => {
  const sent: OrderRow = {
    ...base,
    id: 'o20',
    number: 20,
    customerName: 'Farah Nadia',
    method: null,
    day: null,
    status: 'PAID',
    paidAt: new Date('2026-10-16T05:00:00Z'),
    paidVia: 'CHIP',
    email: 'farah@example.com',
    sentAt: new Date('2026-10-16T05:00:00Z'),
    lines: [{ id: 'ld', itemName: 'Recipe e-book', optionLabel: null, unitPriceCents: 2500, quantity: 1, photoUrl: null, digital: { delivery: 'LINK', files: [], linkOpenedAt: null, codes: [], codesLeft: null, session: null, times: [] } }],
  };

  it('says Digital instead of a method and day, and Sent instead of Paid', () => {
    show([sent, ...orders]);
    expect(rowOf('Farah Nadia')).toHaveTextContent('#20 · 1 item · Digital');
    expect(within(rowOf('Farah Nadia')).getByText('Sent')).toBeInTheDocument();
  });

  it('is not listed under Paid: there is nothing to make', () => {
    show([sent, ...orders]);
    fireEvent.click(chip(/^Paid/));
    expect(names()).not.toContain('Farah Nadia');
  });
});

describe('OrdersScreen, round 1 fixes', () => {
  it('shows a failed move in the error toast: no tick, role alert, until dismissed', async () => {
    show(orders, {
      move: async () => {
        throw new Error('This order was cancelled.');
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Mark paid' }));
    const alert = await screen.findByText('This order was cancelled.');
    expect(alert.closest('[role="alert"]')).not.toBeNull();
    expect(alert).toHaveAttribute('data-tone', 'error');
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('This order was cancelled.')).toBeNull();
  });

  it('puts Older orders at 00:00 in Malaysia six days back, the This week window, not 168 hours', () => {
    // now is Fri 16 Oct, 2pm in Malaysia: the week starts Sat 10 Oct, 00:00 (9 Oct 16:00 UTC).
    const at = (id: string, name: string, iso: string): OrderRow => ({ ...orders[5]!, id, number: Number(id.slice(1)), customerName: name, createdAt: new Date(iso) });
    show([
      at('o31', 'Week start', '2026-10-09T16:00:00Z'),
      at('o30', 'Just before', '2026-10-09T15:59:00Z'),
      // Within 168 hours of now, but on Fri 9 Oct in Malaysia: older.
      at('o29', 'Fri evening', '2026-10-09T10:00:00Z'),
    ]);
    expect(within(screen.getByRole('list', { name: 'Orders' })).getAllByRole('button').map((b) => b.querySelector('b')?.textContent)).toEqual(['Week start']);
    expect(within(screen.getByRole('list', { name: 'Older orders' })).getAllByRole('button').map((b) => b.querySelector('b')?.textContent)).toEqual(['Just before', 'Fri evening']);
  });

  it('on a later page, says what needs the owner is on the newest page when a filter is empty there', () => {
    show([orders[5]!], { paging: { older: null, paged: true } });
    fireEvent.click(chip(/^To check/));
    expect(screen.getByText('Not on this page')).toBeInTheDocument();
    expect(screen.queryByText('All clear')).toBeNull();
    expect(screen.getByRole('link', { name: 'newest page' })).toHaveAttribute('href', '/app/orders');
  });

  describe('on a phone, after a move', () => {
    beforeEach(() => {
      vi.stubGlobal('matchMedia', (query: string) => ({ matches: true, media: query, addEventListener() {}, removeEventListener() {} }));
    });
    afterEach(() => vi.unstubAllGlobals());

    const paidNow = (o: OrderRow): OrderRow => ({ ...o, status: 'PAID', paidAt: new Date('2026-10-16T05:59:00Z'), paidVia: 'RECEIPT' });

    it('keeps the only receipt it marked paid on screen under To check, until the owner goes back', () => {
      const { refresh } = show();
      fireEvent.click(strip().getByRole('button', { name: /Receipt to check/ }));
      fireEvent.click(rowOf('Mira Hassan'));
      refresh(orders.map((o) => (o.id === 'o13' ? paidNow(o) : o)));
      // Not blank: the same order, now paid, with its next move.
      expect(document.querySelector('[data-open]')).not.toBeNull();
      expect(screen.getByRole('heading', { level: 2, name: 'Mira Hassan' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Mark completed' })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'All orders' }));
      expect(document.querySelector('[data-open]')).toBeNull();
      expect(screen.getByText('All clear')).toBeInTheDocument();
    });

    it('never swaps to the next receipt under the same thumb: two receipts, the first marked paid', () => {
      const second: OrderRow = { ...base, id: 'o14', number: 14, customerName: 'Laila Musa', createdAt: new Date('2026-10-16T01:00:00Z') };
      const { refresh } = show([base, second], { stats: { ...stats, toCheck: 2 } });
      fireEvent.click(chip(/^To check/));
      fireEvent.click(rowOf('Mira Hassan'));
      refresh([paidNow(base), second]);
      expect(screen.getByRole('heading', { level: 2, name: 'Mira Hassan' })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { level: 2, name: 'Laila Musa' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Mark paid' })).toBeNull();
      // Back on the list, the second one waits there to be picked.
      fireEvent.click(screen.getByRole('button', { name: 'All orders' }));
      expect(document.querySelector('[data-open]')).toBeNull();
      expect(names()).toEqual(['Laila Musa']);
    });

    it('goes back to the list, saying so, when the open order is gone from the list altogether', async () => {
      const { refresh } = show();
      fireEvent.click(rowOf('Wei Ling'));
      refresh(orders.filter((o) => o.id !== 'o11'));
      await waitFor(() => expect(document.querySelector('[data-open]')).toBeNull());
      expect(screen.getByRole('status')).toHaveTextContent('That order is no longer in this list.');
      // Neutral news, not a success: no tick.
      expect(screen.getByRole('status').querySelector('svg')).toBeNull();
      expect(screen.queryByRole('heading', { level: 2, name: 'Wei Ling' })).toBeNull();
      // Focus lands on the first row, not the body.
      await waitFor(() => expect(rowButtons()[0]).toHaveFocus());
    });

    it('puts focus on the first row when back finds the order’s row gone from the filter', async () => {
      const second: OrderRow = { ...base, id: 'o14', number: 14, customerName: 'Laila Musa', createdAt: new Date('2026-10-16T01:00:00Z') };
      const { refresh } = show([base, second], { stats: { ...stats, toCheck: 2 } });
      fireEvent.click(chip(/^To check/));
      fireEvent.click(rowOf('Mira Hassan'));
      refresh([paidNow(base), second]);
      fireEvent.click(screen.getByRole('button', { name: 'All orders' }));
      await waitFor(() => expect(rowOf('Laila Musa')).toHaveFocus());
    });
  });
});
