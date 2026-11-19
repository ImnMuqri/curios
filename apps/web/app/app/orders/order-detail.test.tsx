import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ApiError } from '../../../lib/api.js';
import { OrderDetail, type OrderMove, type OrderRow } from './order-detail.js';
import type { DigitalAct } from './sent-by-email.js';

// Friday 16 Oct 2026, 2pm in Malaysia.
const now = new Date('2026-10-16T06:00:00Z');

const mira: OrderRow = {
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
  note: "Please write 'Selamat hari jadi Aisyah' on the coklat one. Thank you!",
  itemsCents: 23500,
  deliveryCents: 0,
  totalCents: 23500,
  discountCents: 0,
  voucherLabel: null,
  status: 'PLACED',
  receiptUrl: 'https://cdn.example/receipts/p1/abc.jpg',
  receiptType: 'image/jpeg',
  // 10:09am and 10:02am in Malaysia.
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
    { id: 'l1', digital: null, itemName: 'Kek coklat moist', optionLabel: '1kg', unitPriceCents: 9500, quantity: 2, photoUrl: 'https://cdn.example/items/coklat.webp' },
    { id: 'l1', digital: null, itemName: 'Kek batik', optionLabel: null, unitPriceCents: 4500, quantity: 1, photoUrl: null },
  ],
};

const awaiting: OrderRow = {
  ...mira,
  id: 'o12',
  number: 12,
  customerName: 'Hakim Rahman',
  method: 'DELIVERY',
  address: '12, Jalan Bunga Raya 7/3, Seksyen 7, Shah Alam',
  note: null,
  itemsCents: 17000,
  deliveryCents: 1000,
  totalCents: 18000,
  receiptUrl: null,
  receiptType: null,
  receiptUploadedAt: null,
  lines: [{ id: 'l1', digital: null, itemName: 'Kek coklat moist', optionLabel: '2kg', unitPriceCents: 17000, quantity: 1, photoUrl: null }],
};

const paid: OrderRow = {
  ...mira,
  id: 'o11',
  number: 11,
  customerName: 'Wei Ling',
  day: '2026-10-16',
  note: null,
  itemsCents: 7000,
  totalCents: 7000,
  status: 'PAID',
  paidAt: new Date('2026-10-15T13:41:00Z'),
  lines: [{ id: 'l1', digital: null, itemName: 'Kek batik', optionLabel: null, unitPriceCents: 4500, quantity: 1, photoUrl: null }, { id: 'l1', digital: null, itemName: 'Cookies balang', optionLabel: null, unitPriceCents: 2500, quantity: 1, photoUrl: null }],
};

const refundOwed: OrderRow = {
  ...mira,
  id: 'o9',
  number: 9,
  customerName: 'Farid Azman',
  note: null,
  itemsCents: 12000,
  totalCents: 12000,
  status: 'CANCELLED',
  createdAt: new Date('2026-10-12T02:02:00Z'),
  email: null,
  sentAt: null,
  receiptUploadedAt: new Date('2026-10-12T03:20:00Z'),
  paidAt: new Date('2026-10-12T04:05:00Z'),
  cancelledAt: new Date('2026-10-13T01:00:00Z'),
  lines: [{ id: 'l1', digital: null, itemName: 'Burnt cheesecake', optionLabel: '8 inch', unitPriceCents: 12000, quantity: 1, photoUrl: null }],
};

function show(order: OrderRow, move: OrderMove = vi.fn(async () => undefined), act: DigitalAct = vi.fn(async () => undefined)) {
  const say = vi.fn();
  const onChanged = vi.fn();
  render(<OrderDetail order={order} now={now} move={move} act={act} say={say} onChanged={onChanged} />);
  return { move, act, say, onChanged };
}

const next = () => within(screen.getByRole('region', { name: 'What to do next' }));
const steps = () => within(screen.getByRole('list', { name: 'Order progress' }));
const lit = () => steps().getAllByRole('listitem').map((li) => li.hasAttribute('data-on'));
/** The label and value rows, as [label, value] pairs. */
const kv = () => [...document.querySelectorAll('dl > div')].map((row) => [row.querySelector('dt')!.textContent, row.querySelector('dd')!.textContent]);
const bare = (order: OrderRow) => render(<OrderDetail order={order} now={now} move={vi.fn()} act={vi.fn()} say={vi.fn()} onChanged={vi.fn()} />);

describe('OrderDetail, who and where it is', () => {
  it('says the order and when, names the customer, tags it, and opens WhatsApp to them by first name', () => {
    show(mira);
    expect(screen.getByText('Order #13 · Today, 10:02am')).toBeInTheDocument();
    const heading = screen.getByRole('heading', { level: 2, name: 'Mira Hassan' });
    // The phone's own view moves focus here.
    expect(heading).toHaveAttribute('tabindex', '-1');
    expect(screen.getByText('Receipt to check')).toHaveAttribute('data-tone', 'wait');
    expect(screen.getByRole('link', { name: 'WhatsApp Mira' })).toHaveAttribute('href', 'https://wa.me/60123456789');
  });

  it('draws four quiet steps, Placed, Paid, Ready, Done, lit as far as the order has come', () => {
    show(mira);
    expect(steps().getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Placed', 'Paid', 'Ready', 'Done']);
    expect(lit()).toEqual([true, false, false, false]);
    expect(steps().getAllByRole('listitem')[0]).toHaveAttribute('aria-current', 'step');
  });

  it('lights Paid once paid, Ready once its day has come, and Done once completed', () => {
    const one = bare({ ...paid, day: '2026-10-17' });
    expect(lit()).toEqual([true, true, false, false]);
    one.unmount();
    const two = bare(paid);
    expect(lit()).toEqual([true, true, true, false]);
    two.unmount();
    show({ ...paid, status: 'COMPLETED', completedAt: new Date('2026-10-16T03:30:00Z') });
    expect(lit()).toEqual([true, true, true, true]);
  });

  it('keeps what a cancelled order reached: nothing before payment, Placed and Paid after it', () => {
    const one = bare({ ...awaiting, status: 'CANCELLED', cancelledAt: new Date('2026-10-16T03:00:00Z') });
    expect(lit()).toEqual([false, false, false, false]);
    for (const item of steps().getAllByRole('listitem')) expect(item).not.toHaveAttribute('aria-current');
    one.unmount();
    show(refundOwed);
    expect(lit()).toEqual([true, true, false, false]);
  });

  it('lists the items, the total and the WhatsApp number as label and value rows', () => {
    show(mira);
    expect(kv()).toEqual([
      ['Items', '2× Kek coklat moist 1kg · Kek batik'],
      ['Total', 'RM235'],
      ['WhatsApp', '+60 12-345 6789'],
    ]);
  });

  it('says one item as Item, and a pickup with no address or note as a Pickup row', () => {
    show({ ...paid, note: null, pickupPlaceName: 'Home', pickupFrom: 600, pickupTo: 720, lines: [paid.lines[0]!] });
    expect(kv()).toEqual([
      ['Item', 'Kek batik'],
      ['Total', 'RM70'],
      ['Paid by', 'Receipt · checked by you'],
      ['Pickup', 'Home · Fri 16 Oct, 10am–12pm'],
      ['WhatsApp', '+60 12-345 6789'],
    ]);
    expect(screen.queryByText('Getting it to them')).toBeNull();
  });

  it('puts the delivery fee beside the total, and the address under Getting it to them', () => {
    show(awaiting);
    expect(kv()).toContainEqual(['Item', 'Kek coklat moist · 2kg']);
    expect(kv()).toContainEqual(['Total', 'RM170 + RM10 delivery']);
    expect(kv().map(([label]) => label)).not.toContain('Delivery');
    expect(screen.getByText('Getting it to them')).toBeInTheDocument();
    expect(screen.getByText('Delivery · Sat 17 Oct')).toBeInTheDocument();
    expect(screen.getByText('12, Jalan Bunga Raya 7/3, Seksyen 7, Shah Alam')).toBeInTheDocument();
  });

  it('shows the pickup place and time with its address, and the customer’s note, under Getting it to them', () => {
    show({ ...mira, pickupPlaceName: 'Home', pickupPlaceAddress: 'Seksyen 7, Shah Alam', pickupFrom: 600, pickupTo: 720 });
    expect(screen.getByText('Pickup · Sat 17 Oct, 10am–12pm · Home')).toBeInTheDocument();
    expect(screen.getByText('Seksyen 7, Shah Alam')).toBeInTheDocument();
    expect(screen.getByText('Note from Mira')).toBeInTheDocument();
    expect(screen.getByText(/Selamat hari jadi Aisyah/)).toBeInTheDocument();
    expect(kv().map(([label]) => label)).not.toContain('Pickup');
  });

  it('says how it was paid: by CHIP with its reference, by a receipt checked, or marked by hand', () => {
    const one = bare(online);
    expect(kv()).toContainEqual(['Paid by', 'FPX · Maybank2u · Ref CHIP-4K2X']);
    one.unmount();
    const two = bare({ ...paid, paidVia: 'RECEIPT' });
    expect(kv()).toContainEqual(['Paid by', 'Receipt · checked by you']);
    two.unmount();
    show({ ...paid, paidVia: 'MANUAL', receiptUploadedAt: null, receiptUrl: null });
    expect(kv()).toContainEqual(['Paid by', 'Marked paid by you']);
  });
});

describe('OrderDetail, the receipt', () => {
  it('shows the receipt as a tile, and opens it in a Dialog that takes focus and gives it back', async () => {
    show(mira);
    const tile = screen.getByRole('button', { name: /^Receipt/ });
    expect(tile).toHaveTextContent('Uploaded today, 10:09am · tap to open');
    tile.focus();
    fireEvent.click(tile);
    const dialog = await screen.findByRole('dialog', { name: 'Receipt for order #13' });
    expect(within(dialog).getByRole('img', { name: 'Receipt for order #13' })).toHaveAttribute('src', mira.receiptUrl);
    expect(within(dialog).getByText('Make sure RM235 reached your account before you mark it paid.')).toBeInTheDocument();
    // Focus goes into the dialog.
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));

    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // And back to the tile it came from.
    await waitFor(() => expect(tile).toHaveFocus());
  });

  it('closes the receipt with its close button too', async () => {
    show(mira);
    const tile = screen.getByRole('button', { name: /^Receipt/ });
    tile.focus();
    fireEvent.click(tile);
    const dialog = await screen.findByRole('dialog', { name: 'Receipt for order #13' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(tile).toHaveFocus());
  });

  // Nothing reads the receipt yet, so nothing here claims to have checked it: the picture and the reminder only.
  it('claims nothing about what the receipt shows', () => {
    show(mira);
    expect(screen.queryByText('Amount')).toBeNull();
    expect(screen.queryByText('Paid to')).toBeNull();
    expect(screen.queryByText('Matches')).toBeNull();
  });

  it('opens a PDF receipt in its own tab instead of as a picture', () => {
    show({ ...mira, receiptUrl: 'https://cdn.example/receipts/p1/abc.pdf', receiptType: 'application/pdf' });
    const link = screen.getByRole('link', { name: /^Receipt/ });
    expect(link).toHaveAttribute('href', 'https://cdn.example/receipts/p1/abc.pdf');
    expect(link).toHaveTextContent('Uploaded today, 10:09am · opens the PDF');
    expect(screen.queryByRole('button', { name: /^Receipt/ })).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('says no receipt came, and that it can still be marked paid', () => {
    show(awaiting);
    expect(screen.getByText('Awaiting payment')).toBeInTheDocument();
    expect(next().getByText('No receipt was uploaded. Paid some other way? You can still mark it paid.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Receipt/ })).toBeNull();
  });

  it('shows the amber Receipt not received card once a receipt was marked not received', () => {
    show({ ...awaiting, receiptRejectedAt: new Date('2026-10-16T05:00:00Z') });
    expect(screen.getByText('Receipt not received')).toBeInTheDocument();
    expect(screen.getByText('You marked the receipt not received. Hakim’s order page asks them to pay again.').closest('[data-tone="warn"]')).not.toBeNull();
    expect(next().getByText('Paid some other way? You can still mark it paid.')).toBeInTheDocument();
  });

  it('shows no Receipt not received card before a receipt was ever marked so', () => {
    show(awaiting);
    expect(screen.queryByText('Receipt not received')).toBeNull();
  });
});

describe('OrderDetail, the next step', () => {
  it('marks a checked receipt paid with the full-width pill, then reads the server again', async () => {
    const { move, say, onChanged } = show(mira);
    fireEvent.click(next().getByRole('button', { name: 'Mark paid' }));
    await waitFor(() => expect(say).toHaveBeenCalledWith('#13 marked paid. Mira can see it on their order page.'));
    expect(move).toHaveBeenCalledWith('o13', 'paid');
    expect(onChanged).toHaveBeenCalled();
  });

  it('can still mark an unpaid order paid', async () => {
    const { move, say } = show(awaiting);
    expect(screen.queryByRole('button', { name: 'Not received' })).toBeNull();
    fireEvent.click(next().getByRole('button', { name: 'Mark paid' }));
    await waitFor(() => expect(say).toHaveBeenCalledWith('#12 marked paid.'));
    expect(move).toHaveBeenCalledWith('o12', 'paid');
  });

  it('marks a paid order completed, saying when it is ready', async () => {
    const { move, say } = show(paid);
    expect(next().getByText('Paid. Ready on Fri 16 Oct. Mark it completed once Wei has it.')).toBeInTheDocument();
    fireEvent.click(next().getByRole('button', { name: 'Mark completed' }));
    await waitFor(() => expect(say).toHaveBeenCalledWith('#11 completed. Nice one.'));
    expect(move).toHaveBeenCalledWith('o11', 'completed');
  });

  it('says what to do about a paid order that was cancelled, and marks it refunded', async () => {
    const { move, say } = show(refundOwed);
    expect(screen.getByText('Refund owed')).toHaveAttribute('data-tone', 'red');
    expect(next().getByText('Send it back yourself, then mark it refunded.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel order' })).toBeNull();
    fireEvent.click(next().getByRole('button', { name: 'Mark refunded' }));
    await waitFor(() => expect(say).toHaveBeenCalledWith('#9 marked refunded.'));
    expect(move).toHaveBeenCalledWith('o9', 'refunded');
  });

  it('says nothing is owed on an order cancelled before payment, and when', () => {
    show({ ...awaiting, status: 'CANCELLED', cancelledAt: new Date('2026-10-16T03:00:00Z') });
    expect(screen.getByText('Nothing was paid, so nothing is owed.')).toBeInTheDocument();
    expect(kv()).toContainEqual(['Cancelled', 'Today, 11:00am, before payment']);
    expect(screen.queryByRole('region', { name: 'What to do next' })).toBeNull();
  });

  it('has nothing to do on a completed order but WhatsApp', () => {
    show({ ...paid, status: 'COMPLETED', completedAt: new Date('2026-10-16T03:30:00Z') });
    expect(screen.queryByRole('region', { name: 'What to do next' })).toBeNull();
    expect(screen.getByRole('link', { name: 'WhatsApp Wei' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel order' })).toBeNull();
  });

  it('says why a move failed in the toast, in the API’s words, and reads the order again when it moved on', async () => {
    const move = vi.fn(async () => {
      throw new ApiError(409, 'ORDER_STATE', 'This order has already moved on. Refresh to see where it is.');
    });
    const { say, onChanged } = show(mira, move);
    fireEvent.click(next().getByRole('button', { name: 'Mark paid' }));
    await waitFor(() => expect(say).toHaveBeenCalledWith('This order has already moved on. Refresh to see where it is.'));
    expect(onChanged).toHaveBeenCalledTimes(1);
    // And the button is live again for whatever it is now.
    expect(next().getByRole('button', { name: 'Mark paid' })).toBeEnabled();
  });

  it('does not read the list again after a failure that is not about the order', async () => {
    const move = vi.fn(async () => {
      throw new ApiError(500, 'INTERNAL_ERROR', 'Something failed. Try again.');
    });
    const { say, onChanged } = show(mira, move);
    fireEvent.click(next().getByRole('button', { name: 'Mark paid' }));
    await waitFor(() => expect(say).toHaveBeenCalledWith('Something failed. Try again.'));
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('sends a double tap once, and stays busy until the refreshed order arrives', async () => {
    let finish: () => void = () => undefined;
    const move = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const say = vi.fn();
    const onChanged = vi.fn();
    const props = { now, move, act: vi.fn(), say, onChanged };
    const { rerender } = render(<OrderDetail order={mira} {...props} />);

    const button = next().getByRole('button', { name: 'Mark paid' });
    fireEvent.click(button);
    fireEvent.click(button);
    finish();
    await waitFor(() => expect(say).toHaveBeenCalledTimes(1));
    expect(move).toHaveBeenCalledTimes(1);

    // Moved, but the server's read has not come back: nothing to tap yet.
    expect(next().getByRole('button', { name: 'Mark paid' })).toBeDisabled();

    // The refreshed order arrives: its own next step, live.
    rerender(<OrderDetail order={{ ...mira, status: 'PAID', paidAt: new Date('2026-10-16T05:59:00Z') }} {...props} />);
    expect(next().getByRole('button', { name: 'Mark completed' })).toBeEnabled();
  });
});

describe('OrderDetail, the moves that ask first', () => {
  it('asks before Not received, in the board’s words, and sends it on yes', async () => {
    const { move, say } = show(mira);
    fireEvent.click(screen.getByRole('button', { name: 'Not received' }));
    const panel = within(screen.getByRole('group', { name: 'Not received' }));
    expect(panel.getByText('Mark the receipt not received? Mira will be asked to pay again.')).toBeInTheDocument();
    expect(panel.getByRole('button', { name: 'Keep it' })).toHaveFocus();
    fireEvent.click(panel.getByRole('button', { name: 'Yes, not received' }));
    await waitFor(() => expect(say).toHaveBeenCalledWith('#13: receipt marked not received. Mira will be asked to pay again.'));
    expect(move).toHaveBeenCalledWith('o13', 'not-received');
  });

  it('asks before cancelling a paid order, saying what will be owed; Keep it sends nothing', async () => {
    const { move, say } = show(paid);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel order' }));
    const panel = () => within(screen.getByRole('group', { name: 'Cancel order' }));
    expect(panel().getByText('Cancel #11? You will owe Wei RM70.')).toBeInTheDocument();
    fireEvent.click(panel().getByRole('button', { name: 'Keep it' }));
    expect(screen.queryByRole('group', { name: 'Cancel order' })).toBeNull();
    expect(move).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel order' }));
    fireEvent.click(panel().getByRole('button', { name: 'Yes, cancel' }));
    await waitFor(() => expect(say).toHaveBeenCalledWith('#11 cancelled. A refund is owed.'));
    expect(move).toHaveBeenCalledWith('o11', 'cancel');
  });

  it('asks only the number before cancelling an unpaid one', async () => {
    const { say } = show(awaiting);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel order' }));
    expect(screen.getByText('Cancel #12?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Yes, cancel' }));
    await waitFor(() => expect(say).toHaveBeenCalledWith('#12 cancelled.'));
  });

  // Cancelling a receipt still to check leaves paidAt empty, so no refund is tracked: the question says so.
  it('warns before cancelling an order whose receipt is in, that a paid one should be marked paid first', () => {
    show(mira);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel order' }));
    expect(screen.getByText('Cancel #13? Mira’s receipt is in. If the money arrived, mark it paid first, so cancelling records the refund you owe.')).toBeInTheDocument();
  });

  it('keeps one question open at a time', () => {
    show(mira);
    fireEvent.click(screen.getByRole('button', { name: 'Not received' }));
    expect(screen.getByRole('group', { name: 'Not received' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel order' }));
    expect(screen.getByRole('group', { name: 'Cancel order' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Not received' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Not received' })).toBeVisible();
  });

  it('keeps the question open and says why in the toast when the move fails', async () => {
    const move = vi.fn(async () => {
      throw new ApiError(500, 'INTERNAL_ERROR', 'Something failed. Try again.');
    });
    const { say } = show(paid, move);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel order' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, cancel' }));
    await waitFor(() => expect(say).toHaveBeenCalledWith('Something failed. Try again.'));
    expect(screen.getByRole('group', { name: 'Cancel order' })).toBeInTheDocument();
  });
});

// The board's sample #14: Nurul paid RM215 by FPX, so there is no receipt and nothing to check.
const online: OrderRow = {
  ...paid,
  id: 'o14',
  number: 14,
  customerName: 'Nurul Izzah',
  phone: '+60137782041',
  day: '2026-10-17',
  itemsCents: 21500,
  totalCents: 21500,
  receiptUrl: null,
  receiptType: null,
  receiptUploadedAt: null,
  // 11:18am and 11:20am in Malaysia.
  createdAt: new Date('2026-10-16T03:18:00Z'),
  email: null,
  sentAt: null,
  paidAt: new Date('2026-10-16T03:20:00Z'),
  paidVia: 'CHIP',
  paidMethodLabel: 'FPX · Maybank2u',
  paidRef: 'CHIP-4K2X',
  lines: [
    { id: 'l1', digital: null, itemName: 'Kek coklat moist', optionLabel: '2kg', unitPriceCents: 17000, quantity: 1, photoUrl: null },
    { id: 'l1', digital: null, itemName: 'Kek batik', optionLabel: null, unitPriceCents: 4500, quantity: 1, photoUrl: null },
  ],
};

describe('OrderDetail, an order paid online', () => {
  it('tags it Paid online and says there is nothing to check, with no receipt', () => {
    show(online);
    expect(screen.getByText('Paid online')).toHaveAttribute('data-tone', 'ok');
    expect(next().getByText('Paid through CHIP, so there’s nothing to check.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Receipt/ })).toBeNull();
  });

  it('has Mark completed as its only move, besides cancelling', async () => {
    const { move } = show(online);
    expect(next().getAllByRole('button').map((b) => b.textContent)).toEqual(['Mark completed']);
    expect(screen.queryByRole('button', { name: 'Not received' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Cancel order' })).toBeInTheDocument();
    fireEvent.click(next().getByRole('button', { name: 'Mark completed' }));
    await waitFor(() => expect(move).toHaveBeenCalledWith('o14', 'completed'));
  });

  it('asks for the money back once it is cancelled', async () => {
    const { move } = show({ ...online, status: 'CANCELLED', cancelledAt: new Date('2026-10-16T04:00:00Z') });
    expect(kv()).toContainEqual(['Paid by', 'FPX · Maybank2u · Ref CHIP-4K2X']);
    fireEvent.click(next().getByRole('button', { name: 'Mark refunded' }));
    await waitFor(() => expect(move).toHaveBeenCalledWith('o14', 'refunded'));
  });
});

describe('OrderDetail, an order paid twice', () => {
  const twice: OrderRow = { ...paid, paidVia: 'RECEIPT', chipPaidTwiceAt: new Date('2026-10-16T04:00:00Z') };

  it('tags it Paid twice, in red, and says what to do in the soft red panel', () => {
    show(twice);
    expect(screen.getByText('Paid twice', { selector: 'span' })).toHaveAttribute('data-tone', 'red');
    const panel = screen.getByRole('region', { name: 'Paid twice' });
    expect(panel).toHaveTextContent('It was paid, and CHIP took RM70 again too. Refund the second RM70 in CHIP, then mark it refunded.');
    // The first payment still stands: the order is paid and to be made.
    expect(next().getByRole('button', { name: 'Mark completed' })).toBeInTheDocument();
  });

  it('puts the receipt inside the panel when CHIP paid first and a transfer came in too', () => {
    show({ ...paid, paidVia: 'CHIP', paidRef: 'CHIP-8K2M', paidMethodLabel: 'FPX · Maybank2u', chipPaidTwiceAt: new Date('2026-10-16T04:00:00Z') });
    const panel = within(screen.getByRole('region', { name: 'Paid twice' }));
    expect(panel.getByText('Confirmed by the bank through CHIP, and a receipt for a transfer came in too. Send the second RM70 back to Wei, then mark it refunded.')).toBeInTheDocument();
    expect(panel.getByRole('button', { name: /^Receipt/ })).toBeInTheDocument();
    // Once, in the panel: not again above it.
    expect(screen.getAllByRole('button', { name: /^Receipt/ })).toHaveLength(1);
  });

  it('asks first, in the board’s words, then marks the second payment refunded', async () => {
    const { move, say } = show(twice);
    fireEvent.click(screen.getByRole('button', { name: 'Mark refunded' }));
    const panel = within(screen.getByRole('group', { name: 'Mark refunded' }));
    expect(panel.getByText('Marked the second payment refunded?')).toBeInTheDocument();
    fireEvent.click(panel.getByRole('button', { name: 'Not yet' }));
    expect(move).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Mark refunded' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, refunded' }));
    await waitFor(() => expect(move).toHaveBeenCalledWith('o11', 'refunded'));
    expect(say).toHaveBeenCalledWith('#11: second payment marked refunded.');
  });

  it('says nothing of it on an order paid once', () => {
    show(paid);
    expect(screen.queryByRole('region', { name: 'Paid twice' })).toBeNull();
    expect(screen.queryByText('Paid twice')).toBeNull();
  });

  it('goes quiet once refunded, keeps the order Paid and still offers Mark completed', () => {
    show({ ...twice, secondRefundedAt: new Date('2026-10-16T05:00:00Z') });
    expect(screen.queryByRole('region', { name: 'Paid twice' })).toBeNull();
    expect(screen.getByText('Second payment refunded')).toBeInTheDocument();
    expect(screen.getByText('Paid', { selector: 'span' })).toBeInTheDocument();
    expect(next().getByRole('button', { name: 'Mark completed' })).toBeInTheDocument();
  });

  it('offers Mark refunded on a completed paid-twice order too', () => {
    show({ ...twice, status: 'COMPLETED', completedAt: new Date('2026-10-16T08:00:00Z') });
    expect(screen.getByRole('button', { name: 'Mark refunded' })).toBeInTheDocument();
  });

  it('asks for both payments back when an order paid twice is cancelled first, from the one Mark refunded', () => {
    show({ ...refundOwed, paidVia: 'RECEIPT', chipPaidTwiceAt: new Date('2026-10-16T04:00:00Z') });
    expect(next().getByText('Send it back yourself and refund the CHIP payment too, then mark it refunded.')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Paid twice' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Mark refunded' })).toHaveLength(1);
  });

  it('says Refunded once, not Second payment refunded as well, on a refunded cancelled order paid twice', () => {
    const at = new Date('2026-10-16T05:00:00Z');
    show({ ...refundOwed, paidVia: 'RECEIPT', chipPaidTwiceAt: new Date('2026-10-16T04:00:00Z'), refundedAt: at, secondRefundedAt: at });
    expect(screen.getByText('Refunded')).toBeInTheDocument();
    expect(screen.queryByText('Second payment refunded')).toBeNull();
  });
});

describe('OrderDetail, a voucher', () => {
  it('shows the subtotal and what the voucher took off above the total', () => {
    show({ ...mira, itemsCents: 23500, totalCents: 22550, discountCents: 950, voucherLabel: 'RAYA10' });
    expect(kv()).toEqual(expect.arrayContaining([['Subtotal', 'RM235'], ['Voucher', 'RAYA10 · −RM9.50'], ['Total', 'RM225.50']]));
  });

  it('shows no voucher row with no discount', () => {
    show(mira);
    expect(screen.queryByText(/−RM/)).toBeNull();
  });

  const free: OrderRow = { ...paid, itemsCents: 7000, totalCents: 0, discountCents: 7000, voucherLabel: 'FREE100', paidVia: 'VOUCHER', receiptUploadedAt: null, receiptUrl: null, receiptType: null };

  it('says Paid with a voucher in a soft card, with no receipt to check or wait for', () => {
    show(free);
    expect(screen.getByText('Paid with a voucher')).toBeInTheDocument();
    expect(screen.getByText('The voucher took the whole order off, so there is no receipt to check.')).toBeInTheDocument();
    expect(kv().map(([label]) => label)).not.toContain('Paid by');
    expect(screen.queryByText(/No receipt was uploaded/)).toBeNull();
    // Paid like any paid order: it is made and completed, and may be cancelled.
    expect(next().getByRole('button', { name: 'Mark completed' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel order' })).toBeInTheDocument();
  });

  it('owes nothing once a voucher-paid order is cancelled', () => {
    show({ ...free, status: 'CANCELLED', cancelledAt: new Date('2026-10-16T01:00:00Z') });
    expect(screen.queryByText('Refund owed')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Mark refunded' })).toBeNull();
  });
});

describe('orders.module.css', () => {
  const css = readFileSync(join(import.meta.dirname, 'orders.module.css'), 'utf8');

  it('has no --hijau-wash, which has no dark twin (P6): the soft cards use the calm surfaces', () => {
    expect(css).not.toMatch(/--hijau-wash/);
    expect(css).toMatch(/\.twice \{[^}]*background: var\(--calm-twice\);[^}]*box-shadow: inset 0 0 0 1px var\(--calm-twice-ring\);/);
    expect(css).toMatch(/\.soft\[data-tone='warn'\] \{\s*background: var\(--calm-urgent\);/);
  });

  it('draws the steps as 3px lines, ink once reached, and the move as a full-width pill in the action fill', () => {
    expect(css).toMatch(/\.steps > li \{[^}]*border-top: 3px solid var\(--line\);/);
    expect(css).toMatch(/\.steps > li\[data-on\] \{\s*border-color: var\(--ink\);/);
    expect(css).toMatch(/\.primary \{\s*background: var\(--action\);/);
    expect(css).toMatch(/\.primary,\s*\.whatsapp \{[^}]*width: 100%;[^}]*height: 52px;[^}]*border-radius: var\(--r-pill\);/);
  });
});
