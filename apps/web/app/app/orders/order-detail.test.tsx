import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ApiError } from '../../../lib/api.js';
import { OrderDetail, type OrderMove, type OrderRow } from './order-detail.js';

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
  note: "Please write 'Selamat hari jadi Aisyah' on the coklat one. Thank you!",
  itemsCents: 23500,
  deliveryCents: 0,
  totalCents: 23500,
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
  createdAt: new Date('2026-10-16T02:02:00Z'),
  lines: [
    { itemName: 'Kek coklat moist', optionLabel: '1kg', unitPriceCents: 9500, quantity: 2, photoUrl: 'https://cdn.example/items/coklat.webp' },
    { itemName: 'Kek batik', optionLabel: null, unitPriceCents: 4500, quantity: 1, photoUrl: null },
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
  lines: [{ itemName: 'Kek coklat moist', optionLabel: '2kg', unitPriceCents: 17000, quantity: 1, photoUrl: null }],
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
  lines: [{ itemName: 'Kek batik', optionLabel: null, unitPriceCents: 4500, quantity: 1, photoUrl: null }, { itemName: 'Cookies balang', optionLabel: null, unitPriceCents: 2500, quantity: 1, photoUrl: null }],
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
  receiptUploadedAt: new Date('2026-10-12T03:20:00Z'),
  paidAt: new Date('2026-10-12T04:05:00Z'),
  cancelledAt: new Date('2026-10-13T01:00:00Z'),
  lines: [{ itemName: 'Burnt cheesecake', optionLabel: '8 inch', unitPriceCents: 12000, quantity: 1, photoUrl: null }],
};

function show(order: OrderRow, move: OrderMove = vi.fn(async () => undefined)) {
  const say = vi.fn();
  const onChanged = vi.fn();
  render(<OrderDetail order={order} now={now} pickupNote="Seksyen 7, Shah Alam. 10am to 6pm." move={move} say={say} onChanged={onChanged} />);
  return { move, say, onChanged };
}

const actionBox = () => within(screen.getByRole('region', { name: 'What to do next' }));
const steps = () => within(screen.getByRole('list', { name: 'Order progress' }));

describe('OrderDetail, who and where it is', () => {
  it('names the order and the customer, and opens WhatsApp to them by first name', () => {
    show(mira);
    expect(screen.getByRole('heading', { name: '#13 · Mira Hassan' })).toBeInTheDocument();
    expect(screen.getByText('Placed today, 10:02am · +60 12-345 6789')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'WhatsApp Mira' })).toHaveAttribute('href', 'https://wa.me/60123456789');
  });

  it('draws the four steps, with the receipt in and the check still to do', () => {
    show(mira);
    const items = steps().getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual(['Placedtoday, 10:02am', 'Receipttoday, 10:09am', 'PaidYour check', 'CompletedSat 17 Oct']);
    expect(items[2]).toHaveAttribute('aria-current', 'step');
  });

  it('draws a cancelled order’s last step as Cancelled, and Refunded once the money is back', () => {
    show(refundOwed);
    expect(steps().getAllByRole('listitem').map((li) => li.textContent)).toEqual(['PlacedMon, 10:02am', 'ReceiptMon, 11:20am', 'PaidMon, 12:05pm', 'CancelledTue, 9:00am']);
  });

  // The board's findIndex(!done): a cancelled order rings its first step not
  // reached. Only the ring: it is not the current step of anything.
  it('rings the first step a cancelled order never reached, as the board does', () => {
    show({ ...awaiting, status: 'CANCELLED', cancelledAt: new Date('2026-10-16T03:00:00Z') });
    const items = steps().getAllByRole('listitem');
    expect(items.map((li) => li.querySelector('[data-state]')?.getAttribute('data-state'))).toEqual(['done', 'next', 'todo', 'cancel']);
    for (const item of items) expect(item).not.toHaveAttribute('aria-current');
  });

  it('draws a refunded order’s last step as Refunded', () => {
    show({ ...refundOwed, refundedAt: new Date('2026-10-14T02:00:00Z') });
    expect(steps().getAllByRole('listitem')[3]).toHaveTextContent('RefundedWed, 10:00am');
    expect(screen.getByText('Refunded', { selector: '[data-badge]' })).toBeInTheDocument();
  });

  it('draws an order paid some other way with no receipt to wait for, and Completed next', () => {
    show({ ...awaiting, status: 'PAID', paidAt: new Date('2026-10-16T03:00:00Z') });
    const items = steps().getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual(['Placedtoday, 10:02am', 'ReceiptNone', 'Paidtoday, 11:00am', 'CompletedSat 17 Oct']);
    expect(items[1]).not.toHaveAttribute('aria-current');
    expect(items[3]).toHaveAttribute('aria-current', 'step');
  });

  it('draws an unpaid order still waiting for its receipt', () => {
    show(awaiting);
    expect(steps().getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Placedtoday, 10:02am', 'ReceiptWaiting', 'PaidNot yet', 'CompletedSat 17 Oct']);
    expect(steps().getAllByRole('listitem')[1]).toHaveAttribute('aria-current', 'step');
  });

  it('says what was ordered, with each line, the delivery fee and the total', () => {
    show(awaiting);
    expect(screen.getByText('1× Kek coklat moist')).toBeInTheDocument();
    expect(screen.getByText('2kg · RM170 each')).toBeInTheDocument();
    expect(screen.getByText('Delivery')).toBeInTheDocument();
    expect(screen.getByText('Flat fee')).toBeInTheDocument();
    expect(screen.getByText('RM180', { selector: 'b' })).toBeInTheDocument();
    expect(screen.getByText('Delivery · Sat 17 Oct')).toBeInTheDocument();
    expect(screen.getByText('12, Jalan Bunga Raya 7/3, Seksyen 7, Shah Alam')).toBeInTheDocument();
  });

  it('shows the item’s photo, the pickup place and the customer’s note', () => {
    const { container } = render(
      <OrderDetail order={mira} now={now} pickupNote="Seksyen 7, Shah Alam. 10am to 6pm." move={vi.fn()} say={vi.fn()} onChanged={vi.fn()} />,
    );
    expect(container.querySelector('img[src="https://cdn.example/items/coklat.webp"]')).not.toBeNull();
    expect(screen.getByText('3 items')).toBeInTheDocument();
    expect(screen.getByText('Pickup · Sat 17 Oct')).toBeInTheDocument();
    expect(screen.getByText('Seksyen 7, Shah Alam. 10am to 6pm.')).toBeInTheDocument();
    expect(screen.getByText('Note from Mira')).toBeInTheDocument();
  });
});

describe('OrderDetail, the receipt', () => {
  it('shows the receipt sent, and opens it large', () => {
    show(mira);
    expect(screen.getByText('Receipt to check')).toBeInTheDocument();
    expect(screen.getByText('receipt-mira.jpg')).toBeInTheDocument();
    expect(screen.getByText('Uploaded today, 10:09am')).toBeInTheDocument();
    expect(screen.getByText('Check it landed in your account before you mark it paid.')).toBeInTheDocument();

    const trigger = screen.getByRole('button', { name: 'Open the receipt' });
    trigger.focus();
    fireEvent.click(trigger);
    const zoom = screen.getByRole('dialog', { name: 'Receipt' });
    expect(within(zoom).getByRole('img', { name: 'Receipt for order #13' })).toHaveAttribute('src', mira.receiptUrl);
    // Focus goes into the dialog, onto its close button.
    expect(within(zoom).getByRole('button', { name: 'Close' })).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    // And back to the receipt it came from.
    expect(trigger).toHaveFocus();
  });

  it('closes the large receipt with its close button too', () => {
    show(mira);
    const trigger = screen.getByRole('button', { name: 'Open the receipt' });
    fireEvent.click(trigger);
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Receipt' })).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('opens a PDF receipt in its own tab instead of as a picture', () => {
    show({ ...mira, receiptUrl: 'https://cdn.example/receipts/p1/abc.pdf', receiptType: 'application/pdf' });
    expect(screen.getByRole('link', { name: 'Open the receipt' })).toHaveAttribute('href', 'https://cdn.example/receipts/p1/abc.pdf');
    expect(screen.getByText('receipt-mira.pdf')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open the receipt' })).toBeNull();
  });

  it('says no receipt is in yet, and where the customer pays', () => {
    show(awaiting);
    expect(screen.getByText('Not paid')).toBeInTheDocument();
    expect(screen.getByText('Hakim has not uploaded a receipt yet. Their order page shows your QR and bank details.')).toBeInTheDocument();
  });

  it('says a receipt marked not received was cleared', () => {
    show({ ...awaiting, receiptRejectedAt: new Date('2026-10-16T05:00:00Z') });
    expect(screen.getByText('You marked the receipt not received. Hakim’s order page asks them to pay again.')).toBeInTheDocument();
  });
});

describe('OrderDetail, the next step', () => {
  it('asks for the receipt check, then marks it paid', async () => {
    const { move, say, onChanged } = show(mira);
    expect(actionBox().getByText('Check the receipt, then mark it paid')).toBeInTheDocument();
    expect(actionBox().getByText('Make sure RM235 reached your account.')).toBeInTheDocument();

    fireEvent.click(actionBox().getByRole('button', { name: 'Mark paid' }));

    await waitFor(() => expect(say).toHaveBeenCalledWith('#13 marked paid. Mira can see it on their order page.'));
    expect(move).toHaveBeenCalledWith('o13', 'paid');
    expect(onChanged).toHaveBeenCalled();
  });

  it('puts Not received beside Mark paid while a receipt is in, and asks first', async () => {
    const { move, say } = show(mira);
    fireEvent.click(actionBox().getByRole('button', { name: 'Not received' }));
    expect(actionBox().getByText('Mark the receipt not received? Mira will be asked to pay again.')).toBeInTheDocument();

    fireEvent.click(actionBox().getByRole('button', { name: 'Yes, not received' }));

    await waitFor(() => expect(say).toHaveBeenCalledWith('#13: receipt marked not received. Mira will be asked to pay again.'));
    expect(move).toHaveBeenCalledWith('o13', 'not-received');
  });

  it('waits for payment when no receipt is in, and can still mark it paid', async () => {
    const { move, say } = show(awaiting);
    expect(actionBox().getByText('Waiting for Hakim to pay')).toBeInTheDocument();
    expect(actionBox().getByText('Paid some other way? You can still mark it paid.')).toBeInTheDocument();
    expect(actionBox().queryByRole('button', { name: 'Not received' })).toBeNull();

    fireEvent.click(actionBox().getByRole('button', { name: 'Mark paid' }));

    await waitFor(() => expect(say).toHaveBeenCalledWith('#12 marked paid.'));
    expect(move).toHaveBeenCalledWith('o12', 'paid');
  });

  it('marks a paid order completed', async () => {
    const { move, say } = show(paid);
    expect(screen.getByText('Paid yesterday, 9:41pm')).toBeInTheDocument();
    expect(actionBox().getByText('Paid. Ready on Fri 16 Oct')).toBeInTheDocument();
    expect(actionBox().getByText('Mark it completed once Wei has it.')).toBeInTheDocument();

    fireEvent.click(actionBox().getByRole('button', { name: 'Mark completed' }));

    await waitFor(() => expect(say).toHaveBeenCalledWith('#11 completed. Nice one.'));
    expect(move).toHaveBeenCalledWith('o11', 'completed');
  });

  it('asks before cancelling a paid order, saying what will be owed', async () => {
    const { move, say } = show(paid);
    fireEvent.click(actionBox().getByRole('button', { name: 'Cancel order' }));
    expect(actionBox().getByText('Cancel #11? You will owe Wei RM70.')).toBeInTheDocument();

    fireEvent.click(actionBox().getByRole('button', { name: 'Keep' }));
    expect(move).not.toHaveBeenCalled();

    fireEvent.click(actionBox().getByRole('button', { name: 'Cancel order' }));
    fireEvent.click(actionBox().getByRole('button', { name: 'Yes, cancel' }));

    await waitFor(() => expect(say).toHaveBeenCalledWith('#11 cancelled. A refund is owed.'));
    expect(move).toHaveBeenCalledWith('o11', 'cancel');
  });

  it('asks only the number before cancelling an unpaid one', async () => {
    const { say } = show(awaiting);
    fireEvent.click(actionBox().getByRole('button', { name: 'Cancel order' }));
    expect(actionBox().getByText('Cancel #12?')).toBeInTheDocument();
    fireEvent.click(actionBox().getByRole('button', { name: 'Yes, cancel' }));
    await waitFor(() => expect(say).toHaveBeenCalledWith('#12 cancelled.'));
  });

  // Cancelling a receipt still to check leaves paidAt empty, so no refund is
  // tracked: the question says so, and points at Mark paid first.
  it('warns before cancelling an order whose receipt is in, that a paid one should be marked paid first', async () => {
    const { move, say } = show(mira);
    fireEvent.click(actionBox().getByRole('button', { name: 'Cancel order' }));
    expect(
      actionBox().getByText('Cancel #13? Mira’s receipt is in. If the money arrived, mark it paid first, so cancelling records the refund you owe.'),
    ).toBeInTheDocument();

    fireEvent.click(actionBox().getByRole('button', { name: 'Yes, cancel' }));
    await waitFor(() => expect(say).toHaveBeenCalledWith('#13 cancelled.'));
    expect(move).toHaveBeenCalledWith('o13', 'cancel');
  });

  it('says what is owed on a paid order that was cancelled, and marks it refunded', async () => {
    const { move, say } = show(refundOwed);
    expect(actionBox().getByText('You owe Farid RM120')).toBeInTheDocument();
    expect(actionBox().getByText('Send it back yourself, then mark it refunded.')).toBeInTheDocument();
    expect(actionBox().queryByRole('button', { name: 'Cancel order' })).toBeNull();

    fireEvent.click(actionBox().getByRole('button', { name: 'Mark refunded' }));

    await waitFor(() => expect(say).toHaveBeenCalledWith('#9 marked refunded.'));
    expect(move).toHaveBeenCalledWith('o9', 'refunded');
  });

  it('has nothing to do on a completed or refunded order', () => {
    show({ ...paid, status: 'COMPLETED', completedAt: new Date('2026-10-16T03:30:00Z') });
    expect(screen.queryByRole('region', { name: 'What to do next' })).toBeNull();
    expect(steps().getAllByRole('listitem')[3]).toHaveTextContent('Completedtoday, 11:30am');
  });

  it('says why a move failed, in the API’s words', async () => {
    const move = vi.fn(async () => {
      throw new ApiError(409, 'ORDER_STATE', 'This order has already moved on. Refresh to see where it is.');
    });
    const { say, onChanged } = show(mira, move);
    fireEvent.click(actionBox().getByRole('button', { name: 'Mark paid' }));
    expect(await screen.findByText('This order has already moved on. Refresh to see where it is.')).toBeInTheDocument();
    expect(say).not.toHaveBeenCalled();
    // The order moved on (or is gone): the list is read again, as the words say.
    expect(onChanged).toHaveBeenCalledTimes(1);
    // And the buttons are live again for whatever it is now.
    expect(actionBox().getByRole('button', { name: 'Mark paid' })).toBeEnabled();
  });

  it('does not read the list again after a failure that is not about the order', async () => {
    const move = vi.fn(async () => {
      throw new ApiError(500, 'INTERNAL_ERROR', 'Something failed. Try again.');
    });
    const { onChanged } = show(mira, move);
    fireEvent.click(actionBox().getByRole('button', { name: 'Mark paid' }));
    expect(await screen.findByText('Something failed. Try again.')).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('sends a double tap once, and stays busy until the refreshed order arrives', async () => {
    let finish: () => void = () => undefined;
    const move = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const say = vi.fn();
    const onChanged = vi.fn();
    const props = { now, pickupNote: null, move, say, onChanged };
    const { rerender } = render(<OrderDetail order={mira} {...props} />);

    const button = actionBox().getByRole('button', { name: 'Mark paid' });
    fireEvent.click(button);
    fireEvent.click(button);
    finish();
    await waitFor(() => expect(say).toHaveBeenCalledTimes(1));
    expect(move).toHaveBeenCalledTimes(1);

    // Moved, but the server's read has not come back: nothing to tap yet.
    expect(actionBox().getByRole('button', { name: 'Mark paid' })).toBeDisabled();
    fireEvent.click(actionBox().getByRole('button', { name: 'Mark paid' }));
    expect(move).toHaveBeenCalledTimes(1);

    // The refreshed order arrives: its own next step, live.
    rerender(<OrderDetail order={{ ...mira, status: 'PAID', paidAt: new Date('2026-10-16T05:59:00Z') }} {...props} />);
    expect(actionBox().getByRole('button', { name: 'Mark completed' })).toBeEnabled();
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
  paidAt: new Date('2026-10-16T03:20:00Z'),
  paidVia: 'CHIP',
  paidMethodLabel: 'FPX · Maybank2u',
  paidRef: 'CHIP-4K2X',
  lines: [
    { itemName: 'Kek coklat moist', optionLabel: '2kg', unitPriceCents: 17000, quantity: 1, photoUrl: null },
    { itemName: 'Kek batik', optionLabel: null, unitPriceCents: 4500, quantity: 1, photoUrl: null },
  ],
};

describe('OrderDetail, an order paid online', () => {
  it('draws Placed, Paid by FPX, Checked by the bank, Completed', () => {
    show(online);
    const items = steps().getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual(['Placedtoday, 11:18am', 'Paid by FPXtoday, 11:20am', 'CheckedBy the bank', 'CompletedSat 17 Oct']);
    expect(items[3]).toHaveAttribute('aria-current', 'step');
  });

  it('says the bank confirmed it through CHIP, with the reference, and has no receipt to check', () => {
    show(online);
    expect(screen.getByText('RM215 paid by FPX · Maybank2u')).toBeInTheDocument();
    expect(screen.getByText('Confirmed by the bank through CHIP, so there is no receipt to check. Ref CHIP-4K2X.')).toBeInTheDocument();
    expect(screen.getByText('Paid today, 11:20am', { selector: '[data-badge]' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open the receipt' })).toBeNull();
    expect(screen.queryByText(/receipt was uploaded/)).toBeNull();
  });

  it('leaves the reference out when CHIP gave none', () => {
    show({ ...online, paidRef: null });
    expect(screen.getByText('Confirmed by the bank through CHIP, so there is no receipt to check.')).toBeInTheDocument();
  });

  it('has Mark completed as its only move, besides cancelling', async () => {
    const { move } = show(online);
    expect(actionBox().getByText('Paid. Ready on Sat 17 Oct')).toBeInTheDocument();
    expect(actionBox().queryByRole('button', { name: 'Mark paid' })).toBeNull();
    expect(actionBox().queryByRole('button', { name: 'Not received' })).toBeNull();
    expect(actionBox().getAllByRole('button').map((b) => b.textContent)).toEqual(['Cancel order', 'Mark completed']);
    fireEvent.click(actionBox().getByRole('button', { name: 'Mark completed' }));
    await waitFor(() => expect(move).toHaveBeenCalledWith('o14', 'completed'));
  });

  it('keeps the hand-marked Refund flow when it is cancelled: Mark refunded', async () => {
    const cancelledOnline: OrderRow = { ...online, status: 'CANCELLED', cancelledAt: new Date('2026-10-16T04:00:00Z') };
    const { move } = show(cancelledOnline);
    expect(actionBox().getByText('You owe Nurul RM215')).toBeInTheDocument();
    // The Payment card still says how it was paid.
    expect(screen.getByText('RM215 paid by FPX · Maybank2u')).toBeInTheDocument();
    fireEvent.click(actionBox().getByRole('button', { name: 'Mark refunded' }));
    await waitFor(() => expect(move).toHaveBeenCalledWith('o14', 'refunded'));
  });

  it('leaves an order the owner marked paid as it was: Paid, with a receipt step', () => {
    show(paid);
    expect(steps().getAllByRole('listitem').map((li) => li.querySelector('b')?.textContent)).toEqual(['Placed', 'Receipt', 'Paid', 'Completed']);
    expect(screen.queryByText(/through CHIP/)).toBeNull();
  });
});

describe('OrderDetail, an order paid twice', () => {
  it('says the second payment is to refund in CHIP, beside the first payment', () => {
    show({ ...paid, paidVia: 'RECEIPT', chipPaidTwiceAt: new Date('2026-10-16T04:00:00Z') });
    const note = screen.getByRole('note', { name: 'Paid twice' });
    expect(note).toHaveTextContent('Paid twice — refund RM70 in CHIP');
    // The first payment still stands: the order is paid and to be made.
    expect(actionBox().getByRole('button', { name: 'Mark completed' })).toBeInTheDocument();
  });

  it('says nothing of it on an order paid once', () => {
    show(paid);
    expect(screen.queryByRole('note', { name: 'Paid twice' })).toBeNull();
  });

  it('shows the CHIP payment and the kept receipt together, and does not say there is none', () => {
    show({ ...paid, paidVia: 'CHIP', paidRef: 'CH0042', paidMethodLabel: 'FPX · Maybank2u', chipPaidTwiceAt: new Date('2026-10-16T04:00:00Z') });
    expect(screen.getByText('RM70 paid by FPX · Maybank2u')).toBeInTheDocument();
    expect(screen.getByText(/Confirmed by the bank through CHIP\. A receipt was also sent — check it before you refund one\. Ref CH0042\./)).toBeInTheDocument();
    expect(screen.queryByText(/so there is no receipt to check/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Open the receipt' })).toBeInTheDocument();
  });

  it('still says there is no receipt to check for an online payment paid once', () => {
    show({ ...paid, paidVia: 'CHIP', receiptUploadedAt: null, receiptUrl: null });
    expect(screen.getByText(/so there is no receipt to check/)).toBeInTheDocument();
  });

  it('offers Mark refunded, asks first, and moves the order the owner way', async () => {
    const { move, say } = show({ ...paid, paidVia: 'RECEIPT', chipPaidTwiceAt: new Date('2026-10-16T04:00:00Z') });
    expect(screen.getByText('You owe RM70. Refund it in CHIP, then mark it refunded.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Mark refunded' }));
    expect(move).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Yes, refunded' }));
    await waitFor(() => expect(move).toHaveBeenCalledWith('o11', 'refunded'));
    expect(say).toHaveBeenCalledWith('#11: second payment marked refunded.');
  });

  it('once refunded, goes quiet, keeps the order paid and still offers Mark completed', () => {
    show({ ...paid, paidVia: 'RECEIPT', chipPaidTwiceAt: new Date('2026-10-16T04:00:00Z'), refundedAt: new Date('2026-10-16T05:00:00Z') });
    expect(screen.queryByRole('note', { name: 'Paid twice' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Mark refunded' })).toBeNull();
    expect(screen.getByText('Second payment refunded')).toBeInTheDocument();
    expect(screen.queryByText('Refunded')).toBeNull();
    expect(actionBox().getByRole('button', { name: 'Mark completed' })).toBeInTheDocument();
  });

  it('offers Mark refunded on a completed paid-twice order too', () => {
    show({ ...paid, status: 'COMPLETED', completedAt: new Date('2026-10-16T08:00:00Z'), paidVia: 'RECEIPT', chipPaidTwiceAt: new Date('2026-10-16T04:00:00Z') });
    expect(screen.getByRole('button', { name: 'Mark refunded' })).toBeInTheDocument();
  });
});
