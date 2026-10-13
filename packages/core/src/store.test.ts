import { describe, expect, it } from 'vitest';
import {
  formatRinggit,
  fromPrice,
  MAX_OPTIONS,
  normalizeBankAccountNumber,
  parseRinggit,
  priceLine,
  pricingProblem,
  storeGapMessage,
  storeGaps,
} from './store.js';

describe('formatRinggit', () => {
  it('drops sen when there are none, keeps two places when there are', () => {
    expect(formatRinggit(9500)).toBe('RM95');
    expect(formatRinggit(9550)).toBe('RM95.50');
    expect(formatRinggit(9505)).toBe('RM95.05');
  });
  it('groups thousands', () => {
    expect(formatRinggit(123456)).toBe('RM1,234.56');
  });
});

describe('parseRinggit', () => {
  it.each([
    ['95', 9500],
    ['RM 95', 9500],
    ['rm95', 9500],
    ['95.5', 9550],
    ['95.50', 9550],
    ['1,200', 120000],
    [' 28 ', 2800],
  ])('reads %j as %d sen', (text, cents) => {
    expect(parseRinggit(text)).toBe(cents);
  });
  it.each(['', 'abc', '95.555', '-5', '9 5', 'RM'])('refuses %j', (text) => {
    expect(parseRinggit(text)).toBeNull();
  });
  it('reads zero as zero; the caller decides it is not a price', () => {
    expect(parseRinggit('0')).toBe(0);
  });
});

describe('pricingProblem', () => {
  it('accepts one price', () => {
    expect(pricingProblem({ kind: 'single', priceCents: 9500 })).toBeNull();
  });
  it('refuses zero, fractions of a sen and absurd prices', () => {
    for (const priceCents of [0, -100, 95.5, 1_000_001]) {
      expect(pricingProblem({ kind: 'single', priceCents })).not.toBeNull();
    }
  });
  it('accepts options with their own prices', () => {
    expect(
      pricingProblem({ kind: 'options', options: [{ label: '1kg', priceCents: 9500 }, { label: '2kg', priceCents: 17000 }] }),
    ).toBeNull();
  });
  it('refuses no options, too many, a blank label, or the same label twice', () => {
    expect(pricingProblem({ kind: 'options', options: [] })).toMatch(/at least one/);
    const many = Array.from({ length: MAX_OPTIONS + 1 }, (_, i) => ({ label: `o${i}`, priceCents: 100 }));
    expect(pricingProblem({ kind: 'options', options: many })).toMatch(new RegExp(String(MAX_OPTIONS)));
    expect(pricingProblem({ kind: 'options', options: [{ label: '  ', priceCents: 100 }] })).toMatch(/name/);
    expect(
      pricingProblem({ kind: 'options', options: [{ label: '1kg', priceCents: 100 }, { label: '1KG ', priceCents: 200 }] }),
    ).toMatch(/twice/);
  });
});

describe('option prices', () => {
  it('names the option whose price is not a price', () => {
    expect(pricingProblem({ kind: 'options', options: [{ label: '1kg', priceCents: 0 }] })).toMatch(/"1kg"/);
  });
});

describe('priceLine and fromPrice', () => {
  const single = { priceCents: 2500, options: [] };
  const options = { priceCents: null, options: [{ label: '2kg', priceCents: 17000 }, { label: '1kg', priceCents: 9500 }] };
  it('reads one price as itself', () => {
    expect(priceLine(single)).toBe('RM25');
    expect(fromPrice(single)).toBe(2500);
  });
  it('lists options in their own order, and the lowest is the from price', () => {
    expect(priceLine(options)).toBe('2kg RM170 · 1kg RM95');
    expect(fromPrice(options)).toBe(9500);
  });
  it('has no from price when nothing is priced', () => {
    expect(fromPrice({ priceCents: null, options: [] })).toBeNull();
  });
});

describe('normalizeBankAccountNumber', () => {
  it('strips spaces and dashes', () => {
    expect(normalizeBankAccountNumber(' 1234-5678 9012 ')).toBe('123456789012');
  });
  it('refuses letters and implausible lengths', () => {
    expect(normalizeBankAccountNumber('12ab5678')).toBeNull();
    expect(normalizeBankAccountNumber('12345')).toBeNull();
    expect(normalizeBankAccountNumber('1'.repeat(21))).toBeNull();
  });
});

describe('storeGaps', () => {
  const ready = {
    pickupEnabled: true,
    deliveryMode: 'NONE' as const,
    paymentQrKey: 'qr/p/x.png',
    bankName: null,
    bankAccountName: null,
    bankAccountNumber: null,
  };
  it('is ready with a QR and pickup', () => {
    expect(storeGaps(ready)).toEqual([]);
  });
  it('accepts full bank details in place of a QR', () => {
    expect(
      storeGaps({ ...ready, paymentQrKey: null, bankName: 'Maybank', bankAccountName: 'Lina', bankAccountNumber: '1234567890' }),
    ).toEqual([]);
  });
  it('counts partial bank details as no way to pay', () => {
    expect(storeGaps({ ...ready, paymentQrKey: null, bankName: 'Maybank' })).toEqual(['payment']);
  });
  it('needs pickup or delivery', () => {
    expect(storeGaps({ ...ready, pickupEnabled: false })).toEqual(['fulfilment']);
    expect(storeGaps({ ...ready, pickupEnabled: false, deliveryMode: 'RIDER' })).toEqual([]);
  });
  it('says what is missing in one sentence', () => {
    expect(storeGapMessage(['payment', 'fulfilment'])).toBe(
      'Before your shop can open, add a way to pay (a DuitNow QR or your bank account) and turn on pickup or delivery.',
    );
  });
});
