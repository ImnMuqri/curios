import { describe, expect, it } from 'vitest';
import { canCapture, FREE_LEADS, planState } from './plan.js';

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

describe('planState', () => {
  // `canCapture` answers "may this page take a number". This answers "why",
  // which is what a screen needs to explain itself to an owner. Adding it here
  // rather than deriving the reason at the call site is the point: the whole
  // slice-8 constraint is that this rule lives in one place.

  it('calls a personal page personal, whatever it has paid or captured', () => {
    expect(planState({ ...paid, mode: 'PERSONAL' })).toEqual({ kind: 'personal' });
  });

  it('calls a page with time left paid, even with the trial spent', () => {
    expect(planState({ ...paid, leadsCaptured: FREE_LEADS })).toEqual({
      kind: 'paid',
      paidUntil: FUTURE,
    });
  });

  it('reports how much trial is left, so a screen can count down', () => {
    expect(planState({ ...paid, paidUntil: null, leadsCaptured: 0 })).toEqual({
      kind: 'trial',
      used: 0,
      remaining: FREE_LEADS,
    });
    expect(planState({ ...paid, paidUntil: null, leadsCaptured: FREE_LEADS - 1 })).toEqual({
      kind: 'trial',
      used: FREE_LEADS - 1,
      remaining: 1,
    });
  });

  it('separates a spent trial from a lapsed payment', () => {
    // Both refuse capture, and an owner needs different things said to them:
    // one has never paid, the other has and needs to renew.
    expect(planState({ ...paid, paidUntil: null, leadsCaptured: FREE_LEADS })).toEqual({
      kind: 'trialSpent',
    });
    expect(planState({ ...paid, paidUntil: PAST, leadsCaptured: FREE_LEADS })).toEqual({
      kind: 'lapsed',
      paidUntil: PAST,
    });
  });

  it('calls an expired page with trial left a trial, not a lapse', () => {
    expect(planState({ ...paid, paidUntil: PAST, leadsCaptured: 1 })).toEqual({
      kind: 'trial',
      used: 1,
      remaining: FREE_LEADS - 1,
    });
  });

  it('treats the expiry instant as expired, the same as canCapture does', () => {
    expect(planState({ ...paid, paidUntil: NOW, leadsCaptured: FREE_LEADS })).toEqual({
      kind: 'lapsed',
      paidUntil: NOW,
    });
  });

  it('never disagrees with canCapture, across every combination', () => {
    // The reason this file can hold two functions. If a later edit moves one
    // boundary and not the other, the page and the endpoint start disagreeing
    // about the same page -- silently, since each looks right on its own.
    const modes = ['PERSONAL', 'BUSINESS'] as const;
    const dates = [null, PAST, NOW, FUTURE];
    const counts = [0, FREE_LEADS - 1, FREE_LEADS, FREE_LEADS + 1];

    for (const mode of modes) {
      for (const paidUntil of dates) {
        for (const leadsCaptured of counts) {
          const input = { mode, paidUntil, leadsCaptured, now: NOW };
          const allowed = planState(input).kind === 'paid' || planState(input).kind === 'trial';
          expect(allowed).toBe(canCapture(input));
        }
      }
    }
  });
});
