import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ApiError } from '../../../lib/api.js';
import { OrderDetail, ownerView, type OrderRow } from './order-detail.js';
import { sessionTime, type DigitalAct } from './sent-by-email.js';

// Friday 16 Oct 2026, 4:30pm in Malaysia.
const now = new Date('2026-10-16T08:30:00Z');

type Line = OrderRow['lines'][number];
const digital = (over: Partial<NonNullable<Line['digital']>> = {}): NonNullable<Line['digital']> => ({
  delivery: 'FILES',
  files: [],
  linkOpenedAt: null,
  codes: [],
  codesLeft: null,
  session: null,
  times: [],
  ...over,
});
const line = (id: string, itemName: string, d: NonNullable<Line['digital']>, quantity = 1): Line => ({
  id,
  itemName,
  optionLabel: null,
  unitPriceCents: 2500,
  quantity,
  photoUrl: null,
  digital: d,
});
const physical: Line = { id: 'lp', itemName: 'Kek batik', optionLabel: null, unitPriceCents: 4500, quantity: 1, photoUrl: null, digital: null };

const base: OrderRow = {
  id: 'o15',
  number: 15,
  code: 'Q7M4',
  customerName: 'Mira Hassan',
  phone: '+60123456789',
  method: null,
  day: null,
  address: null,
  note: null,
  itemsCents: 21400,
  deliveryCents: 0,
  totalCents: 21400,
  status: 'PAID',
  receiptUrl: null,
  receiptType: null,
  receiptUploadedAt: null,
  receiptRejectedAt: null,
  paidAt: new Date('2026-10-16T08:05:00Z'),
  completedAt: null,
  cancelledAt: null,
  refundedAt: null,
  paidVia: 'CHIP',
  paidMethodLabel: 'FPX · Maybank2u',
  paidRef: 'CHIP-7Q4M',
  chipPaidTwiceAt: null,
  secondRefundedAt: null,
  createdAt: new Date('2026-10-16T08:04:00Z'),
  email: 'mira.hassan@gmail.example',
  sentAt: new Date('2026-10-16T08:05:00Z'),
  lines: [
    line('lf', 'Kek coklat recipe e-book', digital({ delivery: 'FILES', files: [{ name: 'recipes.pdf', used: 1, left: 4, expiresAt: new Date('2026-11-14T08:05:00Z') }] })),
    line('ls', 'Online class: Kek batik', digital({ delivery: 'SESSION', session: { startsAt: new Date('2026-11-07T12:00:00Z'), seats: 1, remindedAt: null }, times: [{ id: 's2', startsAt: new Date('2026-11-14T12:00:00Z'), seatsLeft: 5 }] })),
    line('lc', 'Gift voucher RM50', digital({ delivery: 'CODES', codes: ['KL50-8F2K-QM'], codesLeft: 7 })),
    line('lk', 'Video course: Basic cakes', digital({ delivery: 'LINK', linkOpenedAt: new Date('2026-10-16T08:12:00Z') })),
  ],
};

function show(order: OrderRow, act: DigitalAct = vi.fn(async () => undefined)) {
  const say = vi.fn();
  const onChanged = vi.fn();
  render(<OrderDetail order={order} now={now} pickupNote={null} move={vi.fn()} act={act} say={say} onChanged={onChanged} />);
  return { act, say, onChanged };
}
const card = () => within(screen.getByRole('region', { name: /Sent by email/ }));
const row = (name: string) => within(card().getByText(name).closest('div')!);

describe('Sent by email', () => {
  it('says who it went to and when, and what happened to each item', () => {
    show(base);
    expect(card().getByText('To mira.hassan@gmail.example')).toBeInTheDocument();
    expect(card().getByText('Sent today, 4:05pm')).toBeInTheDocument();
    expect(row('Kek coklat recipe e-book').getByText('downloaded once · 4 downloads left')).toBeInTheDocument();
    expect(row('Kek coklat recipe e-book').getByText('Links until 14 Nov')).toBeInTheDocument();
    expect(row('Online class: Kek batik').getByText('Sat 7 Nov, 8:00pm · 1 seat booked')).toBeInTheDocument();
    // The owner's own stock: the code itself is shown.
    expect(row('Gift voucher RM50').getByText('KL50-8F2K-QM')).toBeInTheDocument();
    expect(row('Gift voucher RM50').getByText(/7 codes left/)).toBeInTheDocument();
    expect(row('Video course: Basic cakes').getByText('Link sent · opened today, 4:12pm')).toBeInTheDocument();
  });

  it('says a link is not opened yet, a file not downloaded, and a reminder sent', () => {
    const order: OrderRow = {
      ...base,
      lines: [
        line('lf', 'Two files', digital({ files: [{ name: 'a.pdf', used: 0, left: 5, expiresAt: new Date('2026-11-14T08:05:00Z') }, { name: 'b.zip', used: 3, left: 2, expiresAt: new Date('2026-11-14T08:05:00Z') }] })),
        line('lk', 'The course', digital({ delivery: 'LINK' })),
        line('ls', 'The class', digital({ delivery: 'SESSION', session: { startsAt: new Date('2026-11-07T12:00:00Z'), seats: 2, remindedAt: new Date('2026-11-06T01:00:00Z') } })),
      ],
    };
    show(order);
    expect(screen.getByText('a.pdf: not downloaded yet · 5 downloads left')).toBeInTheDocument();
    expect(screen.getByText('b.zip: downloaded 3 times · 2 downloads left')).toBeInTheDocument();
    expect(screen.getByText('Link sent · not opened yet')).toBeInTheDocument();
    expect(screen.getByText('Sat 7 Nov, 8:00pm · 2 seats booked · reminder sent')).toBeInTheDocument();
  });

  it('shows what will happen when it is paid, with no actions, before it is sent', () => {
    show({ ...base, status: 'PLACED', paidAt: null, paidVia: null, sentAt: null, receiptUploadedAt: new Date('2026-10-16T08:10:00Z') });
    expect(card().getByText('Not sent yet')).toBeInTheDocument();
    expect(card().getByText('Download links go out when it’s paid')).toBeInTheDocument();
    expect(card().getByText('Link goes out when it’s paid')).toBeInTheDocument();
    expect(card().getByText('A code is given when it’s paid')).toBeInTheDocument();
    expect(card().getByText('Seat held for Sat 7 Nov, 8:00pm')).toBeInTheDocument();
    expect(card().queryByRole('button')).toBeNull();
  });

  it('replaces Getting it to them on a digital-only order, and sits beside it on a mixed one', () => {
    const { unmount } = render(<OrderDetail order={base} now={now} pickupNote={null} move={vi.fn()} act={vi.fn()} say={vi.fn()} onChanged={vi.fn()} />);
    expect(screen.queryByText('Getting it to them')).toBeNull();
    unmount();
    show({ ...base, method: 'PICKUP', day: '2026-10-17', lines: [physical, base.lines[0]!] });
    expect(screen.getByText('Getting it to them')).toBeInTheDocument();
    expect(card().getByText('Kek coklat recipe e-book')).toBeInTheDocument();
    // The physical line is not in the card.
    expect(card().queryByText('Kek batik')).toBeNull();
    expect(screen.getByText('Pickup · Sat 17 Oct')).toBeInTheDocument();
  });

  it('makes New links, and says it only mails on Resend', async () => {
    const { act, say, onChanged } = show(base);
    fireEvent.click(card().getByRole('button', { name: 'New links' }));
    await waitFor(() => expect(act).toHaveBeenCalledWith('o15', 'new-links', undefined));
    expect(say).toHaveBeenCalledWith('New download links made. Resend the email so Mira gets them.');
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('gives a new code to that line', async () => {
    const { act, say } = show(base);
    fireEvent.click(card().getByRole('button', { name: 'New code' }));
    await waitFor(() => expect(act).toHaveBeenCalledWith('o15', 'new-code', { lineId: 'lc' }));
    expect(say).toHaveBeenCalledWith('Gave Mira another code. They keep the first one. Resend the email to send both.');
  });

  it('moves the time to the one picked, from the item’s other times with room', async () => {
    const { act, say } = show(base);
    fireEvent.click(card().getByRole('button', { name: 'Move time' }));
    const pick = card().getByRole('combobox', { name: 'Move Mira to' });
    expect(within(pick).getAllByRole('option').map((o) => o.textContent)).toEqual(['Sat 14 Nov, 8:00pm · 5 seats left']);
    fireEvent.click(card().getByRole('button', { name: 'Move' }));
    await waitFor(() => expect(act).toHaveBeenCalledWith('o15', 'move-time', { lineId: 'ls', sessionId: 's2' }));
    expect(say).toHaveBeenCalledWith('Moved Mira to Sat 14 Nov, 8:00pm. Resend the email so they know.');
  });

  it('says so when no other time has room', () => {
    const order = { ...base, lines: [line('ls', 'The class', digital({ delivery: 'SESSION', session: { startsAt: new Date('2026-11-07T12:00:00Z'), seats: 1, remindedAt: null }, times: [] }))] };
    show(order);
    fireEvent.click(card().getByRole('button', { name: 'Move time' }));
    expect(card().getByText('No other time with room for Mira. Add one in your store first.')).toBeInTheDocument();
    expect(card().queryByRole('combobox')).toBeNull();
  });

  it('resends the email', async () => {
    const { act, say } = show(base);
    fireEvent.click(card().getByRole('button', { name: 'Resend the email' }));
    await waitFor(() => expect(act).toHaveBeenCalledWith('o15', 'resend', undefined));
    expect(say).toHaveBeenCalledWith('Sent again to mira.hassan@gmail.example.');
  });

  it('shows the API’s own words in place when an action is refused, and reads the order again', async () => {
    const act: DigitalAct = vi.fn(async () => {
      throw new ApiError(409, 'SOLD_OUT', 'Every code for this item is already given out.');
    });
    const { say, onChanged } = show(base, act);
    fireEvent.click(card().getByRole('button', { name: 'New code' }));
    expect(await card().findByRole('alert')).toHaveTextContent('Every code for this item is already given out.');
    expect(say).not.toHaveBeenCalled();
    expect(onChanged).toHaveBeenCalled();
    // Free again: another action can run.
    expect(card().getByRole('button', { name: 'New code' })).toBeEnabled();
  });

  it('sends a double tap once', async () => {
    let finish: () => void = () => undefined;
    const act: DigitalAct = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    show(base, act);
    const button = card().getByRole('button', { name: 'New links' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(act).toHaveBeenCalledTimes(1);
    finish();
    await waitFor(() => expect(card().getByRole('button', { name: 'New links' })).toBeEnabled());
  });

  it('offers no actions on a cancelled order', () => {
    show({ ...base, status: 'CANCELLED', cancelledAt: new Date('2026-10-16T09:00:00Z') });
    expect(card().queryByRole('button')).toBeNull();
  });
});

describe('a digital-only order in Orders', () => {
  it('ends at Sent: badge, last step, and nothing to complete', () => {
    expect(ownerView(base)).toBe('sent');
    show(base);
    const steps = within(screen.getByRole('list', { name: 'Order progress' })).getAllByRole('listitem');
    expect(steps.map((li) => li.textContent)).toEqual(['Placedtoday, 4:04pm', 'Paid by FPXtoday, 4:05pm', 'CheckedBy the bank', 'Senttoday, 4:05pm']);
    expect(screen.queryByRole('region', { name: 'What to do next' })).toBeNull();
    expect(screen.queryByText(/Ready on/)).toBeNull();
  });

  it('reads Mark paid and send for a receipt in, and says where it goes', async () => {
    const order: OrderRow = {
      ...base,
      status: 'PLACED',
      paidAt: null,
      paidVia: null,
      sentAt: null,
      receiptUploadedAt: new Date('2026-10-16T08:10:00Z'),
      lines: [line('lf', 'Kek coklat recipe e-book', digital())],
    };
    const move = vi.fn(async () => undefined);
    const say = vi.fn();
    render(<OrderDetail order={order} now={now} pickupNote={null} move={move} act={vi.fn()} say={say} onChanged={vi.fn()} />);
    const box = within(screen.getByRole('region', { name: 'What to do next' }));
    expect(box.getByText('Their kek coklat recipe e-book goes to mira.hassan@gmail.example the moment you do.')).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Order progress' })).getAllByRole('listitem')[3]!.textContent).toBe('SentWhen you mark it paid');
    fireEvent.click(box.getByRole('button', { name: 'Mark paid and send' }));
    await waitFor(() => expect(move).toHaveBeenCalledWith('o15', 'paid'));
    expect(say).toHaveBeenCalledWith('#15 paid. It’s on its way to Mira’s email.');
  });

  it('keeps Mark completed on a mixed order, once paid', () => {
    const mixed: OrderRow = { ...base, method: 'PICKUP', day: '2026-10-17', paidVia: 'MANUAL', lines: [physical, base.lines[0]!] };
    show(mixed);
    expect(ownerView(mixed)).toBe('paid');
    expect(within(screen.getByRole('region', { name: 'What to do next' })).getByRole('button', { name: 'Mark completed' })).toBeInTheDocument();
    expect(screen.getByText('Paid. Ready on Sat 17 Oct')).toBeInTheDocument();
  });
});

describe('sessionTime', () => {
  it('says Malaysian time', () => {
    expect(sessionTime(new Date('2026-11-07T12:00:00Z'))).toBe('Sat 7 Nov, 8:00pm');
  });
});
