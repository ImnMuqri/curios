import { describe, expect, it } from 'vitest';
import { findOrderCode, lastFourDigits, mentionsOrder, orderCard, orderCodeCandidates, orderChips } from './order-lookup.js';

describe('findOrderCode', () => {
  it('finds a code with a digit in it, in any case', () => {
    expect(findOrderCode('Where’s my order 7Q4M?')).toBe('7Q4M');
    expect(findOrderCode('status YVA4 pls')).toBe('YVA4');
    expect(findOrderCode('mana tempahan saya 7q4m')).toBe('7Q4M');
    expect(findOrderCode('where is my order 7q4m')).toBe('7Q4M');
  });

  it('never takes a word with no digit, however it is written or wherever it stands', () => {
    expect(findOrderCode('Can I order cake for Saturday?')).toBeNull();
    expect(findOrderCode('nak buat tempahan baru')).toBeNull();
    expect(findOrderCode('WHAT IS MY ORDER')).toBeNull();
    expect(findOrderCode('where is my order hxpt')).toBeNull();
    expect(findOrderCode('HXPT')).toBeNull();
  });

  it('leaves prices, quantities and plain numbers alone', () => {
    expect(findOrderCode('order 3pcs kek')).toBeNull();
    expect(findOrderCode('is the RM95 cake ready')).toBeNull();
    expect(findOrderCode('order 6789')).toBeNull();
  });

  it('never takes a word with a character outside the alphabet', () => {
    // 0, O, 1, I and L are not in the alphabet.
    expect(findOrderCode('order 10KG')).toBeNull();
    expect(findOrderCode('order B1LA')).toBeNull();
    expect(findOrderCode('order H0LD')).toBeNull();
  });
});

describe('orderCodeCandidates', () => {
  it('lists every word with a digit and a letter, upper-cased, once', () => {
    expect(orderCodeCandidates('what cake, yva4? YVA4 3pcs mana')).toEqual(['YVA4', '3PCS']);
  });
});

describe('mentionsOrder', () => {
  it('hears order, pesanan, tempahan and status', () => {
    expect(mentionsOrder('Where is my ORDER')).toBe(true);
    expect(mentionsOrder('pesanan saya')).toBe(true);
    expect(mentionsOrder('tempahan')).toBe(true);
    expect(mentionsOrder('status?')).toBe(true);
    expect(mentionsOrder('ordering a cake')).toBe(false);
  });
});

describe('lastFourDigits', () => {
  it('reads the last four digits typed, however they are written', () => {
    expect(lastFourDigits('6789')).toBe('6789');
    expect(lastFourDigits('012-345 6789')).toBe('6789');
    expect(lastFourDigits('+60 12 345 6789')).toBe('6789');
    expect(lastFourDigits('678')).toBeNull();
  });
});

describe('orderCard', () => {
  const base = {
    number: 14,
    code: '7Q4M',
    method: 'PICKUP' as const,
    day: new Date('2026-12-05T00:00:00Z'),
    totalCents: 21_500,
    status: 'PLACED' as const,
    receiptUploadedAt: null,
    paidAt: null,
    refundedAt: null,
    lines: [
      { itemName: 'Kek coklat moist', optionLabel: '2kg', quantity: 1 },
      { itemName: 'Kek batik', optionLabel: null, quantity: 2 },
    ],
  };
  const now = new Date('2026-12-01T04:00:00Z');

  it('draws an unpaid order as the board does, with the order page’s pill', () => {
    expect(orderCard(base, 'Kek Lina', now)).toEqual({
      number: 14,
      code: '7Q4M',
      status: 'Waiting for your payment',
      pill: 'Waiting for payment',
      tone: 'wait',
      steps: { placed: true, paid: false, ready: false, done: false },
      summary: '1× Kek coklat moist 2kg, 2× Kek batik',
      when: 'Pickup · Sat 5 Dec',
      totalCents: 21_500,
      note: 'Your order page has the full details and how to pay.',
    });
  });

  it('says who is checking a receipt, and who is getting it ready', () => {
    const checking = orderCard({ ...base, receiptUploadedAt: now }, 'Kek Lina', now);
    expect(checking.pill).toBe('Receipt sent · Kek Lina is checking');
    expect(checking.status).toBe('Kek Lina is checking your receipt');

    const paid = orderCard({ ...base, status: 'PAID', paidAt: now }, 'Kek Lina', now);
    expect(paid.pill).toBe('Paid · Kek Lina is getting it ready');
    expect(paid.steps).toEqual({ placed: true, paid: true, ready: false, done: false });
    expect(paid.note).toBe('Your order page has the full details.');
  });

  it('lights Ready on the day, and names a delivery', () => {
    const ready = orderCard(
      { ...base, method: 'DELIVERY', status: 'PAID', paidAt: now },
      'Kek Lina',
      new Date('2026-12-05T02:00:00Z'),
    );
    expect(ready.pill).toBe('Ready');
    expect(ready.status).toBe('Ready for delivery');
    expect(ready.when).toBe('Delivery · Sat 5 Dec');
  });

  it('uses the order page’s words for a cancelled order', () => {
    expect(orderCard({ ...base, status: 'CANCELLED' }, 'Kek Lina', now)).toMatchObject({ pill: 'Cancelled', tone: 'stop' });
    expect(orderCard({ ...base, status: 'CANCELLED', paidAt: now }, 'Kek Lina', now)).toMatchObject({
      pill: 'Cancelled · refund due',
      tone: 'stop',
    });
    expect(orderCard({ ...base, status: 'CANCELLED', paidAt: now, refundedAt: now }, 'Kek Lina', now)).toMatchObject({
      pill: 'Refunded',
      tone: 'quiet',
    });
    expect(orderCard({ ...base, status: 'COMPLETED', paidAt: now }, 'Kek Lina', now)).toMatchObject({ pill: 'Done', tone: 'ok' });
  });
});

describe('orderChips', () => {
  const items = [
    { id: 'a', name: 'Kek Batik' },
    { id: 'b', name: 'Kek Coklat Moist' },
    { id: 'c', name: 'Tart Nenas' },
  ];

  it('matches item names in the answer, ignoring case and punctuation, in the answer’s order, at most two', () => {
    expect(orderChips('We have tart nenas, KEK BATIK and kek coklat-moist!', items)).toEqual([
      { itemId: 'c', label: 'Order Tart Nenas' },
      { itemId: 'a', label: 'Order Kek Batik' },
    ]);
  });

  it('matches whole words only', () => {
    expect(orderChips('Kek Batiks are lovely', items)).toEqual([]);
  });
});
