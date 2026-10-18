import { describe, expect, it } from 'vitest';
import {
  customerSteps,
  isOrderDay,
  malaysiaToday,
  openDays,
  ORDER_CODE_ALPHABET,
  ORDER_TOTAL_MAX_CENTS,
  orderCode,
  orderTotals,
  orderView,
} from './orders.js';

// 2026-10-18 is a Sunday; 23:30 in Malaysia.
const NOW = new Date('2026-10-18T15:30:00Z');
const s = { now: NOW, minNoticeDays: 2, closedDays: [0] };

describe('orderCode', () => {
  it('is four characters, all from the alphabet', () => {
    for (const r of [0, 0.5, 0.999999]) {
      const code = orderCode(() => r);
      expect(code).toHaveLength(4);
      for (const ch of code) expect(ORDER_CODE_ALPHABET).toContain(ch);
    }
    expect(orderCode()).toHaveLength(4);
  });
});

describe('malaysiaToday', () => {
  it('is the Malaysian calendar day, not the UTC one', () => {
    expect(malaysiaToday(new Date('2026-10-18T16:30:00Z'))).toBe('2026-10-19');
    expect(malaysiaToday(NOW)).toBe('2026-10-18');
  });
});

describe('isOrderDay', () => {
  it('honours notice, closed weekdays, the horizon and the past', () => {
    expect(isOrderDay('2026-10-19', s)).toBe(false);
    expect(isOrderDay('2026-10-20', s)).toBe(true);
    expect(isOrderDay('2026-10-25', s)).toBe(false);
    expect(isOrderDay('2026-12-31', s)).toBe(false);
    expect(isOrderDay('2026-10-17', s)).toBe(false);
  });

  it('accepts the last day inside the horizon and refuses nonsense', () => {
    expect(isOrderDay('2026-12-17', s)).toBe(true);
    expect(isOrderDay('2026-12-18', s)).toBe(false);
    expect(isOrderDay('2026-02-31', s)).toBe(false);
    expect(isOrderDay('tomorrow', s)).toBe(false);
  });
});

describe('openDays', () => {
  it('returns the next accepted days in order', () => {
    const days = openDays(s, 5);
    expect(days).toEqual(['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24']);
    for (const d of days) expect(isOrderDay(d, s)).toBe(true);
  });

  it('skips closed days', () => {
    expect(openDays(s, 7)).not.toContain('2026-10-25');
  });
});

describe('orderTotals', () => {
  const lines = [
    { unitCents: 1500, quantity: 2 },
    { unitCents: 800, quantity: 1 },
  ];
  it('sums options times quantities, adding a flat fee only on delivery', () => {
    expect(orderTotals(lines, { method: 'DELIVERY', mode: 'FLAT', feeCents: 1000 })).toEqual({
      itemsCents: 3800,
      deliveryCents: 1000,
      totalCents: 4800,
    });
    expect(
      orderTotals(lines, { method: 'PICKUP', mode: 'FLAT', feeCents: 1000 }).deliveryCents,
    ).toBe(0);
  });
  it('adds nothing for a rider', () => {
    expect(
      orderTotals(lines, { method: 'DELIVERY', mode: 'RIDER', feeCents: null }).totalCents,
    ).toBe(3800);
  });
});

describe('ORDER_TOTAL_MAX_CENTS', () => {
  it('is RM1,000,000, inside the Int column a total is stored in', () => {
    expect(ORDER_TOTAL_MAX_CENTS).toBe(100_000_000);
    expect(ORDER_TOTAL_MAX_CENTS).toBeLessThan(2 ** 31 - 1);
  });
});

describe('orderView', () => {
  const at = new Date('2026-10-18T00:00:00Z');
  const o = { receiptUploadedAt: null, paidAt: null, refundedAt: null };
  it('names each badge', () => {
    expect(orderView({ ...o, status: 'PLACED' })).toBe('awaitingPayment');
    expect(orderView({ ...o, status: 'PLACED', receiptUploadedAt: at })).toBe('toCheck');
    expect(orderView({ ...o, status: 'PAID', paidAt: at })).toBe('paid');
    expect(orderView({ ...o, status: 'COMPLETED', paidAt: at })).toBe('completed');
    expect(orderView({ ...o, status: 'CANCELLED', paidAt: at })).toBe('refundOwed');
    expect(orderView({ ...o, status: 'CANCELLED', paidAt: at, refundedAt: at })).toBe('refunded');
    expect(orderView({ ...o, status: 'CANCELLED' })).toBe('cancelled');
  });
});

describe('customerSteps', () => {
  const paidAt = new Date('2026-10-18T00:00:00Z');
  it('is not ready before the day, ready on it', () => {
    const o = { status: 'PAID' as const, paidAt, day: '2026-10-20' };
    expect(customerSteps(o, NOW)).toEqual({ placed: true, paid: true, ready: false, done: false });
    expect(customerSteps(o, new Date('2026-10-20T01:00:00Z')).ready).toBe(true);
  });
  it('is done once completed', () => {
    const r = customerSteps({ status: 'COMPLETED', paidAt, day: '2026-10-20' }, NOW);
    expect(r.done).toBe(true);
  });
  it('has not paid while placed', () => {
    expect(
      customerSteps({ status: 'PLACED', paidAt: null, day: '2026-10-20' }, NOW).paid,
    ).toBe(false);
  });
});
