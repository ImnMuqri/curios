import { describe, expect, it } from 'vitest';
import type { VoucherTerms } from '@curios/core/vouchers';
import { itemPromo, shopPromo } from './promo.js';

const v = (over: Partial<VoucherTerms>): VoucherTerms => ({
  id: 'v', mode: 'AUTO', kind: 'PERCENT', percent: 10, amountCents: null, itemId: null, minSpendCents: null, label: 'Deal', ...over,
});
const percent = (id: string, p: number, over: Partial<VoucherTerms> = {}) => v({ id, percent: p, ...over });
const amount = (id: string, cents: number, over: Partial<VoucherTerms> = {}) => v({ id, kind: 'AMOUNT', percent: null, amountCents: cents, ...over });

describe('shopPromo ranks by what each saves on a typical order', () => {
  it('RM50 off beats 1% off', () => {
    expect(shopPromo([percent('p', 1), amount('a', 5_000)])?.id).toBe('a');
    expect(shopPromo([amount('a', 5_000), percent('p', 1)])?.id).toBe('a');
  });

  it('20% off beats RM5 off', () => {
    expect(shopPromo([amount('a', 500), percent('p', 20)])?.id).toBe('p');
    expect(shopPromo([percent('p', 20), amount('a', 500)])?.id).toBe('p');
  });

  it('judges a voucher with a minimum spend on that spend: 10% over RM300 (RM30) beats RM20 off', () => {
    expect(shopPromo([amount('a', 2_000), percent('p', 10, { minSpendCents: 30_000 })])?.id).toBe('p');
  });

  it('the bigger of two of a kind', () => {
    expect(shopPromo([percent('small', 5), percent('big', 15)])?.id).toBe('big');
    expect(shopPromo([amount('small', 500), amount('big', 1_500)])?.id).toBe('big');
  });

  it('ranks one-item vouchers the same way', () => {
    expect(itemPromo([percent('p', 1, { itemId: 'cake' }), amount('a', 5_000, { itemId: 'cake' })], 'cake')?.id).toBe('a');
  });
});
