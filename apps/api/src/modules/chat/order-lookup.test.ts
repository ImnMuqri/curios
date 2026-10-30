import { describe, expect, it } from 'vitest';
import { findOrderCode, lastFourDigits, mentionsOrder, orderCard, orderCodeCandidates, productCard } from './order-lookup.js';

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
    expect(orderCard({ ...base, status: 'CANCELLED', paidAt: now, totalCents: 0 }, 'Kek Lina', now)).toMatchObject({ pill: 'Cancelled', tone: 'stop' });
    expect(orderCard({ ...base, status: 'CANCELLED', paidAt: now, refundedAt: now }, 'Kek Lina', now)).toMatchObject({
      pill: 'Refunded',
      tone: 'quiet',
    });
    expect(orderCard({ ...base, status: 'COMPLETED', paidAt: now }, 'Kek Lina', now)).toMatchObject({ pill: 'Done', tone: 'ok' });
  });

  it('says a digital order was sent, not that it is ready for delivery', () => {
    const digital = { ...base, method: null, day: null, status: 'PAID' as const, paidAt: now, lines: [{ itemName: 'Recipe e-book', optionLabel: null, quantity: 1 }] };
    const sent = orderCard({ ...digital, sentAt: now }, 'Kek Lina', now);
    expect(sent).toMatchObject({ status: 'Paid. It was sent to your email', pill: 'Paid · Sent to your email', tone: 'ok', when: '' });
    expect(orderCard({ ...digital, sentAt: null }, 'Kek Lina', now)).toMatchObject({ status: 'Paid', pill: 'Paid' });
    expect(orderCard({ ...digital, status: 'COMPLETED', sentAt: now }, 'Kek Lina', now).pill).toBe('Paid · Sent to your email');
    // Unpaid, it is still the ordinary waiting words.
    expect(orderCard({ ...digital, status: 'PLACED', paidAt: null }, 'Kek Lina', now).pill).toBe('Waiting for payment');
  });
});

describe('productCard', () => {
  const item = (id: string, name: string, over: Record<string, unknown> = {}) => ({
    id,
    name,
    slug: name.toLowerCase().replace(/ /g, '-'),
    priceCents: 900 as number | null,
    photoKey: null as string | null,
    options: [] as { id: string; label: string; priceCents: number }[],
    ...over,
  });
  const items = [
    item('a', 'Kek Batik', { priceCents: null, photoKey: 'items/p/batik.webp', options: [{ id: 'o2', label: '2kg', priceCents: 17000 }, { id: 'o1', label: '1kg', priceCents: 9500 }] }),
    item('b', 'Kek Coklat Moist'),
    item('c', 'Tart Nenas'),
  ];

  it('is the first item the answer names, ignoring case and punctuation: one card, never two', () => {
    expect(productCard('We have tart nenas, KEK BATIK and kek coklat-moist!', items, 'https://files.example')).toEqual({
      itemId: 'c',
      slug: 'tart-nenas',
      name: 'Tart Nenas',
      fromPriceCents: 900,
      photoUrl: null,
      firstOptionId: null,
      buy: 'add',
    });
  });

  it('carries the cheapest price, the photo URL and the first option of an item with options', () => {
    expect(productCard('Kek batik is lovely', items, 'https://files.example/')).toEqual({
      itemId: 'a',
      slug: 'kek-batik',
      name: 'Kek Batik',
      fromPriceCents: 9500,
      photoUrl: 'https://files.example/items/p/batik.webp',
      firstOptionId: 'o2',
      buy: 'add',
    });
  });

  it('sends a class to its page for a time, and sells a sold-out item to no one', () => {
    const now = new Date('2026-10-24T00:00:00Z');
    const cls = { id: 'c1', name: 'Online Class', slug: 'online-class', priceCents: 6000, photoKey: null, options: [], kind: 'DIGITAL' as const, delivery: 'SESSION' as const, sessions: [{ id: 's', startsAt: new Date('2026-11-01T00:00:00Z'), seats: 5, bookings: [] }] };
    expect(productCard('Join the online class', [cls], null, now)?.buy).toBe('pick');
    const full = { ...cls, sessions: [{ ...cls.sessions[0]!, bookings: [{ seats: 5 }] }] };
    expect(productCard('Join the online class', [full], null, now)?.buy).toBe('soldOut');
    const voucher = { id: 'v', name: 'Gift Voucher', slug: 'gift', priceCents: 5000, photoKey: null, options: [], kind: 'DIGITAL' as const, delivery: 'CODES' as const, _count: { codes: 0 } };
    expect(productCard('A gift voucher', [voucher], null, now)?.buy).toBe('soldOut');
    expect(productCard('A gift voucher', [{ ...voucher, _count: { codes: 2 } }], null, now)?.buy).toBe('add');
  });

  it('has no photo URL when storage is not configured', () => {
    expect(productCard('Kek batik', items, null)?.photoUrl).toBeNull();
  });

  it('matches whole words only, and is null when nothing is named', () => {
    expect(productCard('Kek Batiks are lovely', items, null)).toBeNull();
    expect(productCard('Hello', items, null)).toBeNull();
  });
});
