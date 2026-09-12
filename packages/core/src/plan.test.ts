import { describe, expect, it } from 'vitest';
import { canCapture, FREE_LEADS } from './plan.js';

const NOW = new Date('2026-09-12T00:00:00Z');
const FUTURE = new Date('2026-10-12T00:00:00Z');
const PAST = new Date('2026-08-12T00:00:00Z');

const paid = { mode: 'BUSINESS' as const, paidUntil: FUTURE, leadsCaptured: 99, now: NOW };

describe('canCapture', () => {
  it('lets a paid business page capture, however many leads it has had', () => {
    expect(canCapture(paid)).toBe(true);
  });

  it('refuses a personal page however it is paid', () => {
    // The tier decision, not the billing one: personal pages never capture.
    expect(canCapture({ ...paid, mode: 'PERSONAL' })).toBe(false);
  });

  it('lets a page that has never paid capture inside its trial', () => {
    expect(canCapture({ ...paid, paidUntil: null, leadsCaptured: 0 })).toBe(true);
  });

  it('lets it capture on the last free lead', () => {
    // The boundary. `leadsCaptured` is how many have ALREADY been captured, so
    // at FREE_LEADS - 1 the page has had two and is entitled to a third.
    expect(canCapture({ ...paid, paidUntil: null, leadsCaptured: FREE_LEADS - 1 })).toBe(true);
  });

  it('refuses once the trial is spent', () => {
    expect(canCapture({ ...paid, paidUntil: null, leadsCaptured: FREE_LEADS })).toBe(false);
  });

  it('refuses a lapsed page whose trial is also spent', () => {
    expect(canCapture({ ...paid, paidUntil: PAST, leadsCaptured: FREE_LEADS })).toBe(false);
  });

  it('lets a lapsed page capture if it somehow still has trial left', () => {
    // A real sequence, not a contrived one: paying up front is what RM390/year
    // encourages, and a page that paid, captured twice, then lapsed lands here
    // with three free leads still to spend. The rule is an OR and this pins
    // that it is, rather than a hidden precedence. Whether paying ought to
    // consume the trial is slice 9's call; today it does not.
    expect(canCapture({ ...paid, paidUntil: PAST, leadsCaptured: 0 })).toBe(true);
  });

  it('treats the instant the payment expires as expired', () => {
    // `now === paidUntil` is not "still paid". Asserted because the obvious
    // implementations differ here and neither is obviously wrong.
    expect(canCapture({ ...paid, paidUntil: NOW, leadsCaptured: FREE_LEADS })).toBe(false);
  });
});
