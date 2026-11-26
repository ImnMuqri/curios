import { describe, expect, it } from 'vitest';
import {
  catalogLine,
  choiceCombos,
  type ChoicesPricing,
  formatRinggit,
  fromPrice,
  lowestAvailablePrice,
  MAX_OPTIONS,
  PRICE_MAX_CENTS,
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
  it('accepts an Ask item with no starting price, or a valid one', () => {
    expect(pricingProblem({ kind: 'ask', fromCents: null })).toBeNull();
    expect(pricingProblem({ kind: 'ask', fromCents: 18000 })).toBeNull();
    expect(pricingProblem({ kind: 'ask', fromCents: PRICE_MAX_CENTS })).toBeNull();
  });
  it('refuses an Ask item starting at zero, below it, a fraction of a sen or above the most', () => {
    for (const fromCents of [0, -100, 95.5, PRICE_MAX_CENTS + 1]) {
      expect(pricingProblem({ kind: 'ask', fromCents })).toMatch(/starting price/);
    }
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
    chipConnected: false,
    physicalItems: true,
  };
  it('is ready with a QR and pickup', () => {
    expect(storeGaps(ready)).toEqual([]);
  });
  it('accepts full bank details in place of a QR', () => {
    expect(
      storeGaps({ ...ready, paymentQrKey: null, bankName: 'Maybank', bankAccountName: 'Lina', bankAccountNumber: '1234567890' }),
    ).toEqual([]);
  });
  it('counts a CHIP connection as a way to pay', () => {
    expect(storeGaps({ ...ready, paymentQrKey: null, chipConnected: true })).toEqual([]);
    expect(storeGaps({ ...ready, paymentQrKey: null })).toEqual(['payment']);
  });
  it('counts partial bank details as no way to pay', () => {
    expect(storeGaps({ ...ready, paymentQrKey: null, bankName: 'Maybank' })).toEqual(['payment']);
  });
  it('needs pickup or delivery', () => {
    expect(storeGaps({ ...ready, pickupEnabled: false })).toEqual(['fulfilment']);
    expect(storeGaps({ ...ready, pickupEnabled: false, deliveryMode: 'RIDER' })).toEqual([]);
  });

  it('asks a shop of digital items alone for no pickup or delivery, only a way to pay', () => {
    expect(storeGaps({ ...ready, pickupEnabled: false, physicalItems: false })).toEqual([]);
    expect(storeGaps({ ...ready, pickupEnabled: false, physicalItems: false, paymentQrKey: null })).toEqual(['payment']);
  });
  it('says what is missing in one sentence', () => {
    expect(storeGapMessage(['payment', 'fulfilment'])).toBe(
      'Before your shop can open, add a way to pay (connect CHIP, or add a DuitNow QR or your bank account) and turn on pickup or delivery.',
    );
  });
});

describe('choices pricing', () => {
  const two: ChoicesPricing = {
    kind: 'choices',
    groupOne: { name: 'Flavour', choices: [{ label: 'Vanilla' }, { label: 'Chocolate', photoId: 'p1' }] },
    groupTwo: { name: 'Size', choices: [{ label: '500g' }, { label: '1kg' }] },
    combos: [
      { one: 0, two: 0, priceCents: 5000, available: true },
      { one: 0, two: 1, priceCents: 8000, available: true },
      { one: 1, two: 0, priceCents: 6000, available: false },
      { one: 1, two: 1, priceCents: 9000, available: true },
    ],
  };
  const one: ChoicesPricing = {
    kind: 'choices',
    groupOne: { name: 'Size', choices: [{ label: '500g' }, { label: '1kg' }] },
    combos: [
      { one: 0, priceCents: 5000, available: true },
      { one: 1, priceCents: 8000, available: false },
    ],
  };
  const withCombos = (base: ChoicesPricing, combos: ChoicesPricing['combos']): ChoicesPricing => ({ ...base, combos });

  it('accepts a full two-group grid and a single group', () => {
    expect(pricingProblem(two)).toBeNull();
    expect(pricingProblem(one)).toBeNull();
  });
  it('builds labels in group-one-major order', () => {
    expect(choiceCombos(two).map((c) => c.label)).toEqual(['Vanilla · 500g', 'Vanilla · 1kg', 'Chocolate · 500g', 'Chocolate · 1kg']);
    expect(choiceCombos(one).map((c) => c.label)).toEqual(['500g', '1kg']);
    expect(choiceCombos(two).map((c) => c.position)).toEqual([0, 1, 2, 3]);
  });
  it('sorts combos sent in any order', () => {
    expect(choiceCombos(withCombos(two, [...two.combos].reverse())).map((c) => c.label)[0]).toBe('Vanilla · 500g');
  });
  it('refuses a missing, duplicate or unknown combination', () => {
    expect(pricingProblem(withCombos(two, two.combos.slice(1)))).toMatch(/price for every/i);
    expect(pricingProblem(withCombos(two, [...two.combos, two.combos[0]!]))).toMatch(/price for every/i);
    expect(pricingProblem(withCombos(two, [...two.combos.slice(1), { one: 5, two: 0, priceCents: 100, available: true }]))).toMatch(/price for every/i);
    expect(pricingProblem(withCombos(one, [{ one: 0, two: 0, priceCents: 100, available: true }, one.combos[1]!]))).toMatch(/price for every/i);
  });
  it('needs at least one combination on', () => {
    expect(pricingProblem(withCombos(one, one.combos.map((c) => ({ ...c, available: false }))))).toMatch(/at least one/i);
  });
  it('holds prices to the option limit', () => {
    expect(pricingProblem(withCombos(one, [{ one: 0, priceCents: 0, available: true }, one.combos[1]!]))).toMatch(/RM0/);
    expect(pricingProblem(withCombos(one, [{ one: 0, priceCents: PRICE_MAX_CENTS + 1, available: true }, one.combos[1]!]))).toMatch(/RM/);
    expect(pricingProblem(withCombos(one, [{ one: 0, priceCents: 1.5, available: true }, one.combos[1]!]))).toMatch(/RM/);
  });
  it('limits choices and names', () => {
    const many = Array.from({ length: 11 }, (_, i) => ({ label: `c${i}` }));
    expect(pricingProblem({ ...one, groupOne: { name: 'Size', choices: many }, combos: [] })).toMatch(/at most 10/);
    expect(pricingProblem({ ...one, groupOne: { name: 'Size', choices: [] }, combos: [] })).toMatch(/at least one choice/i);
    expect(pricingProblem({ ...one, groupOne: { name: ' ', choices: one.groupOne.choices } })).toMatch(/name/i);
    expect(pricingProblem({ ...one, groupOne: { name: 'x'.repeat(41), choices: one.groupOne.choices } })).toMatch(/name/i);
    expect(pricingProblem({ ...one, groupOne: { name: 'Size', choices: [{ label: 'x'.repeat(41) }, { label: 'b' }] } })).toMatch(/40/);
  });
  it('refuses a duplicate label within a group and the separator inside a label', () => {
    expect(pricingProblem({ ...one, groupOne: { name: 'Size', choices: [{ label: 'A' }, { label: ' a ' }] } })).toMatch(/twice/);
    expect(pricingProblem({ ...one, groupOne: { name: 'Size', choices: [{ label: 'A · B' }, { label: 'C' }] } })).toMatch(/·/);
  });
  it('finds the lowest available price, ignoring combinations that are off', () => {
    expect(lowestAvailablePrice(two.combos)).toBe(5000);
    expect(lowestAvailablePrice([{ priceCents: 100, available: false }, { priceCents: 900, available: true }])).toBe(900);
    expect(lowestAvailablePrice([{ priceCents: 100, available: false }])).toBeNull();
    expect(lowestAvailablePrice([])).toBeNull();
  });
  it('writes the catalog line from the available combinations only', () => {
    expect(catalogLine({ priceCents: null, options: [{ label: 'Vanilla · 500g', priceCents: 5000 }, { label: 'Chocolate · 1kg', priceCents: 9000 }], choiceGroups: ['Flavour', 'Size'] })).toBe(
      'Flavour / Size: Vanilla · 500g RM50; Chocolate · 1kg RM90',
    );
    expect(catalogLine({ priceCents: null, options: [{ label: '1kg', priceCents: 9000 }], choiceGroups: ['Size'] })).toBe('Size: 1kg RM90');
    expect(catalogLine({ priceCents: null, options: [{ label: '1kg', priceCents: 9000 }, { label: '2kg', priceCents: 17000 }] })).toBe('1kg RM90 · 2kg RM170');
    expect(catalogLine({ priceCents: 2500, options: [] })).toBe('RM25');
  });
});
