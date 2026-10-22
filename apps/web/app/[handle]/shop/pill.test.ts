import { describe, expect, it } from 'vitest';
import { shopCopy } from './copy.js';
import { nextOrderDay, shopPillCaption } from './pill.js';

// Wednesday 14 Oct 2026, noon in Malaysia.
const now = new Date('2026-10-14T04:00:00Z');
const open = { pickupEnabled: true, deliveryMode: 'NONE' as const, minNoticeDays: 2, closedDays: [] as number[], canTakeOrders: true };
const en = shopCopy('en');

describe('shopPillCaption', () => {
  it('says the item count and the next pickup day', () => {
    expect(shopPillCaption({ ...open }, 3, en, now)).toBe('3 items · next pickup Fri 16 Oct');
  });

  it('skips closed days', () => {
    expect(shopPillCaption({ ...open, closedDays: [5, 6] }, 3, en, now)).toBe('3 items · next pickup Sun 18 Oct');
  });

  it('says "next delivery" for a shop that only delivers', () => {
    expect(shopPillCaption({ ...open, pickupEnabled: false, deliveryMode: 'FLAT' }, 1, en, now)).toBe('1 item · next delivery Fri 16 Oct');
  });

  it('says pickup when the shop does both', () => {
    expect(shopPillCaption({ ...open, deliveryMode: 'RIDER' }, 2, en, now)).toBe('2 items · next pickup Fri 16 Oct');
  });

  it('drops the day while orders are paused', () => {
    expect(shopPillCaption({ ...open, canTakeOrders: false }, 3, en, now)).toBe('3 items');
  });

  it('drops the day when the shop offers neither way to get it', () => {
    expect(shopPillCaption({ ...open, pickupEnabled: false }, 3, en, now)).toBe('3 items');
  });

  it('reads in Malay', () => {
    expect(shopPillCaption({ ...open }, 3, shopCopy('ms'), now)).toBe('3 barang · ambil seterusnya Jum 16 Okt');
  });
});

describe('nextOrderDay', () => {
  it('is the first day an order could be for', () => {
    expect(nextOrderDay({ ...open }, now)).toBe('2026-10-16');
    expect(nextOrderDay({ ...open, closedDays: [5, 6] }, now)).toBe('2026-10-18');
  });

  it('is null when paused or when there is no way to get the order', () => {
    expect(nextOrderDay({ ...open, canTakeOrders: false }, now)).toBeNull();
    expect(nextOrderDay({ ...open, pickupEnabled: false }, now)).toBeNull();
  });
});
