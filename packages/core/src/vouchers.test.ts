import { describe, expect, it } from 'vitest';
import {
  COUNTED_ORDER_WHERE,
  checkVoucherInput,
  normalizeVoucherCode,
  pickVoucher,
  voucherEndsAt,
  voucherSaving,
  voucherState,
  type VoucherInput,
  type VoucherTerms,
} from './vouchers';

const terms = (over: Partial<VoucherTerms> = {}): VoucherTerms => ({
  id: 'v1',
  mode: 'AUTO',
  kind: 'PERCENT',
  percent: 10,
  amountCents: null,
  itemId: null,
  minSpendCents: null,
  label: 'Raya',
  ...over,
});

const lines = [
  { itemId: 'cake', unitCents: 2000, quantity: 1 },
  { itemId: 'cookie', unitCents: 2500, quantity: 1 },
];

describe('voucherSaving', () => {
  it('takes a percent of the whole basket', () => {
    const basket = [
      { itemId: 'a', unitCents: 4500, quantity: 1 },
      { itemId: 'b', unitCents: 2500, quantity: 2 },
    ];
    expect(voucherSaving(terms(), basket)).toBe(950);
  });
  it('floors a percent to the sen', () => {
    expect(voucherSaving(terms(), [{ itemId: 'a', unitCents: 1999, quantity: 1 }])).toBe(199);
  });
  it('lets 100% cover the items and no more', () => {
    expect(voucherSaving(terms({ percent: 100 }), lines)).toBe(4500);
  });
  it('never takes more than it applies to', () => {
    const v = terms({ kind: 'AMOUNT', percent: null, amountCents: 1000 });
    expect(voucherSaving(v, [{ itemId: 'a', unitCents: 700, quantity: 1 }])).toBe(700);
  });
  it('takes a one-item percent from that item alone', () => {
    const v = terms({ percent: 50, itemId: 'cake' });
    const basket = [
      { itemId: 'cake', unitCents: 9500, quantity: 2 },
      { itemId: 'cookie', unitCents: 2500, quantity: 1 },
    ];
    expect(voucherSaving(v, basket)).toBe(9500);
  });
  it('takes a one-item amount once per order', () => {
    const v = terms({ kind: 'AMOUNT', percent: null, amountCents: 500, itemId: 'cake' });
    expect(voucherSaving(v, [{ itemId: 'cake', unitCents: 2000, quantity: 3 }])).toBe(500);
  });
  it('saves nothing when its item is not in the basket', () => {
    expect(voucherSaving(terms({ itemId: 'brownie' }), lines)).toBe(0);
  });
  it('needs the minimum spend on all items', () => {
    const v = terms({ minSpendCents: 5000 });
    expect(voucherSaving(v, [{ itemId: 'a', unitCents: 4999, quantity: 1 }])).toBe(0);
    expect(voucherSaving(v, [{ itemId: 'a', unitCents: 5000, quantity: 1 }])).not.toBe(0);
  });
  it('judges the minimum spend on all items even for a one-item voucher', () => {
    const v = terms({ itemId: 'cake', minSpendCents: 4500 });
    expect(voucherSaving(v, lines)).toBe(200);
  });
});

describe('pickVoucher', () => {
  const small = terms({ id: 'small', percent: 5 });
  const big = terms({ id: 'big', percent: 20 });
  it('returns the larger saving', () => {
    expect(pickVoucher([small, big], lines)).toEqual({ voucher: big, savingCents: 900 });
  });
  it('lets a typed code win a tie with the best automatic one', () => {
    const typed = terms({ id: 'typed', mode: 'CODE', percent: 20, label: 'HELLO' });
    expect(pickVoucher([big, typed], lines, 'typed')?.voucher.id).toBe('typed');
  });
  it('lets a typed code lose when it saves less', () => {
    const typed = terms({ id: 'typed', mode: 'CODE', percent: 5, label: 'HELLO' });
    expect(pickVoucher([big, typed], lines, 'typed')?.voucher.id).toBe('big');
  });
  it('returns null when nothing saves anything', () => {
    expect(pickVoucher([terms({ itemId: 'brownie' })], lines)).toBeNull();
    expect(pickVoucher([], lines)).toBeNull();
  });
  it('ignores a typed id that is not among the candidates', () => {
    expect(pickVoucher([small], lines, 'nope')?.voucher.id).toBe('small');
  });
});

describe('normalizeVoucherCode', () => {
  it('trims and uppercases', () => {
    expect(normalizeVoucherCode('  raya10 ')).toBe('RAYA10');
  });
});

describe('checkVoucherInput', () => {
  const ok: VoucherInput = {
    mode: 'CODE',
    code: 'raya10',
    name: null,
    kind: 'PERCENT',
    percent: 10,
    amountCents: null,
    itemId: null,
    minSpendCents: null,
    endsOn: null,
    maxUses: null,
  };
  const bad = (over: Partial<VoucherInput>) => checkVoucherInput({ ...ok, ...over });

  it('accepts a good code voucher, normalising its code', () => {
    expect(checkVoucherInput(ok)).toBeNull();
  });
  it('needs a code of 3-20 letters and digits for CODE', () => {
    expect(bad({ code: null })).not.toBeNull();
    expect(bad({ code: 'ab' })).not.toBeNull();
    expect(bad({ code: 'RAYA 10' })).not.toBeNull();
    expect(bad({ code: 'A'.repeat(21) })).not.toBeNull();
  });
  it('needs a name of 1-40 characters for AUTO', () => {
    const auto = { mode: 'AUTO' as const, code: null };
    expect(bad({ ...auto, name: null })).not.toBeNull();
    expect(bad({ ...auto, name: '' })).not.toBeNull();
    expect(bad({ ...auto, name: 'x'.repeat(41) })).not.toBeNull();
    expect(bad({ ...auto, name: 'Raya' })).toBeNull();
    expect(bad({ ...auto, name: 'x'.repeat(40) })).toBeNull();
  });
  it('needs a percent of 1-100 and no amount for PERCENT', () => {
    expect(bad({ percent: null })).not.toBeNull();
    expect(bad({ percent: 0 })).not.toBeNull();
    expect(bad({ percent: 101 })).not.toBeNull();
    expect(bad({ percent: 100 })).toBeNull();
    expect(bad({ amountCents: 500 })).not.toBeNull();
  });
  it('needs an amount above 0 and no percent for AMOUNT', () => {
    const amount = { kind: 'AMOUNT' as const, percent: null };
    expect(bad({ ...amount, amountCents: 500 })).toBeNull();
    expect(bad({ ...amount, amountCents: 0 })).not.toBeNull();
    expect(bad({ ...amount, amountCents: null })).not.toBeNull();
    expect(bad({ ...amount, amountCents: 500, percent: 10 })).not.toBeNull();
  });
  it('limits maxUses to a whole number from 1 to 100000', () => {
    expect(bad({ maxUses: 1 })).toBeNull();
    expect(bad({ maxUses: 100_000 })).toBeNull();
    expect(bad({ maxUses: 0 })).not.toBeNull();
    expect(bad({ maxUses: 100_001 })).not.toBeNull();
    expect(bad({ maxUses: 1.5 })).not.toBeNull();
  });
  it('needs a minimum spend above 0 when given', () => {
    expect(bad({ minSpendCents: 5000 })).toBeNull();
    expect(bad({ minSpendCents: 0 })).not.toBeNull();
  });
  it('caps an amount and a minimum spend at the most an order can total', () => {
    const amount = { kind: 'AMOUNT' as const, percent: null };
    expect(bad({ ...amount, amountCents: 100_000_000 })).toBeNull();
    expect(bad({ ...amount, amountCents: 100_000_001 })).toContain('RM1,000,000');
    expect(bad({ minSpendCents: 100_000_000 })).toBeNull();
    expect(bad({ minSpendCents: 100_000_001 })).toContain('RM1,000,000');
    expect(bad({ ...amount, amountCents: 3_000_000_000 })).not.toBeNull();
  });
  it('needs a real YYYY-MM-DD end day when given', () => {
    expect(bad({ endsOn: '2026-11-30' })).toBeNull();
    expect(bad({ endsOn: '30/11/2026' })).not.toBeNull();
    expect(bad({ endsOn: '2026-02-31' })).not.toBeNull();
  });
});

describe('voucherEndsAt', () => {
  it('is midnight Malaysia at the end of the named day', () => {
    expect(voucherEndsAt('2026-11-30')).toEqual(new Date('2026-12-01T00:00:00+08:00'));
  });
});

describe('voucherState', () => {
  const now = new Date('2026-11-01T00:00:00Z');
  const live = { active: true, endsAt: null, maxUses: null };
  it('is on when nothing stops it', () => {
    expect(voucherState(live, 0, now)).toBe('on');
  });
  it('is off when not active, before anything else', () => {
    expect(voucherState({ active: false, endsAt: '2026-10-01T00:00:00Z', maxUses: 1 }, 5, now)).toBe('off');
  });
  it('is ended once endsAt has come, before used up', () => {
    expect(voucherState({ ...live, endsAt: now, maxUses: 1 }, 5, now)).toBe('ended');
    expect(voucherState({ ...live, endsAt: '2026-11-01T00:00:01Z' }, 0, now)).toBe('on');
  });
  it('is used up at maxUses', () => {
    expect(voucherState({ ...live, maxUses: 3 }, 3, now)).toBe('usedUp');
    expect(voucherState({ ...live, maxUses: 3 }, 2, now)).toBe('on');
  });
});

describe('COUNTED_ORDER_WHERE', () => {
  it('leaves out orders cancelled before they were paid', () => {
    expect(COUNTED_ORDER_WHERE).toEqual({ NOT: { status: 'CANCELLED', paidAt: null } });
  });
});
