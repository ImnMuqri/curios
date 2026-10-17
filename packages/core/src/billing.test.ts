import { describe, expect, it } from 'vitest';
import { extendPaidUntil, PLAN_PRICES_CENTS } from './billing.js';

const at = (iso: string) => new Date(iso);

describe('PLAN_PRICES_CENTS', () => {
  it('holds the published prices, in cents', () => {
    expect(PLAN_PRICES_CENTS).toEqual({ MONTHLY: 4900, ANNUAL: 49000 });
  });
});

describe('extendPaidUntil', () => {
  it('starts from now when the page has never paid', () => {
    expect(
      extendPaidUntil({ paidUntil: null, now: at('2026-03-10T08:00:00.000Z'), plan: 'MONTHLY' }),
    ).toEqual(at('2026-04-10T08:00:00.000Z'));
  });

  it('stacks on a paidUntil still in the future, so renewing early loses nothing', () => {
    expect(
      extendPaidUntil({
        paidUntil: at('2026-03-20T08:00:00.000Z'),
        now: at('2026-03-10T08:00:00.000Z'),
        plan: 'MONTHLY',
      }),
    ).toEqual(at('2026-04-20T08:00:00.000Z'));
  });

  it('starts from now after a lapse, rather than back-dating paid time', () => {
    expect(
      extendPaidUntil({
        paidUntil: at('2026-01-05T00:00:00.000Z'),
        now: at('2026-03-10T08:00:00.000Z'),
        plan: 'MONTHLY',
      }),
    ).toEqual(at('2026-04-10T08:00:00.000Z'));
  });

  it('clamps Jan 31 to the last day of February', () => {
    expect(
      extendPaidUntil({ paidUntil: null, now: at('2026-01-31T12:00:00.000Z'), plan: 'MONTHLY' }),
    ).toEqual(at('2026-02-28T12:00:00.000Z'));
  });

  it('clamps to Feb 29 in a leap year', () => {
    expect(
      extendPaidUntil({ paidUntil: null, now: at('2028-01-31T12:00:00.000Z'), plan: 'MONTHLY' }),
    ).toEqual(at('2028-02-29T12:00:00.000Z'));
  });

  it('rolls December into January of the next year', () => {
    expect(
      extendPaidUntil({ paidUntil: null, now: at('2026-12-31T23:30:00.000Z'), plan: 'MONTHLY' }),
    ).toEqual(at('2027-01-31T23:30:00.000Z'));
  });

  it('adds a calendar year for the annual plan, clamping Feb 29', () => {
    expect(
      extendPaidUntil({ paidUntil: null, now: at('2028-02-29T09:00:00.000Z'), plan: 'ANNUAL' }),
    ).toEqual(at('2029-02-28T09:00:00.000Z'));
  });
});
