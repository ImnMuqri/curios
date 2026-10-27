import { describe, expect, it } from 'vitest';
import {
  canCapture,
  canTakeOrders,
  FREE_LEADS,
  FREE_ORDERS,
  orderState,
  planState,
} from './plan.js';

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
      lapsedOn: PAST,
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

  it('marks a trial that outlived a lapsed subscription with the date it ended', () => {
    // Paid once, captured one lead, lapsed -- and two free leads remain. The OR
    // rule already lets this page capture; what it lacked was a way to say why.
    const state = planState({
      mode: 'BUSINESS',
      paidUntil: new Date('2026-08-01T00:00:00.000Z'),
      leadsCaptured: 1,
      now: new Date('2026-09-17T00:00:00.000Z'),
    });

    expect(state).toEqual({
      kind: 'trial',
      used: 1,
      remaining: FREE_LEADS - 1,
      lapsedOn: new Date('2026-08-01T00:00:00.000Z'),
    });
  });

  it('leaves lapsedOn off a trial that never paid', () => {
    const state = planState({
      mode: 'BUSINESS',
      paidUntil: null,
      leadsCaptured: 1,
      now: new Date('2026-09-17T00:00:00.000Z'),
    });

    expect(state).toEqual({ kind: 'trial', used: 1, remaining: FREE_LEADS - 1 });
    expect(state).not.toHaveProperty('lapsedOn');
  });

  it('still lets a lapsed page with trial left capture', () => {
    // The point of the OR rule, and the reason lapsedOn is a property of a trial
    // rather than a state of its own: nothing about enforcement changes here.
    expect(
      canCapture({
        mode: 'BUSINESS',
        paidUntil: new Date('2026-08-01T00:00:00.000Z'),
        leadsCaptured: 1,
        now: new Date('2026-09-17T00:00:00.000Z'),
      }),
    ).toBe(true);
  });
});

describe('orderState and canTakeOrders', () => {
  const base = {
    mode: 'BUSINESS' as const,
    paidUntil: null,
    ordersPlaced: 0,
    ordersAtTrialReset: 0,
    now: NOW,
  };
  const cases = [
    { name: 'personal', input: { ...base, mode: 'PERSONAL' as const }, state: { kind: 'personal' }, can: false },
    { name: 'paid', input: { ...base, paidUntil: FUTURE, ordersPlaced: 99 }, state: { kind: 'paid', paidUntil: FUTURE }, can: true },
    { name: 'trial, none used', input: base, state: { kind: 'trial', used: 0, remaining: 3 }, can: true },
    { name: 'trial, two used', input: { ...base, ordersPlaced: 2 }, state: { kind: 'trial', used: 2, remaining: 1 }, can: true },
    { name: 'trial spent', input: { ...base, ordersPlaced: FREE_ORDERS }, state: { kind: 'trialSpent' }, can: false },
    { name: 'lapsed', input: { ...base, paidUntil: PAST, ordersPlaced: 3 }, state: { kind: 'lapsed', paidUntil: PAST }, can: false },
    { name: 'after a reset', input: { ...base, ordersPlaced: 5, ordersAtTrialReset: 3 }, state: { kind: 'trial', used: 2, remaining: 1 }, can: true },
  ];
  for (const c of cases) {
    it(`${c.name}: state and enforcement agree`, () => {
      expect(orderState(c.input)).toEqual(c.state);
      expect(canTakeOrders(c.input)).toBe(c.can);
    });
  }
});

describe('the allowances the admin sets', () => {
  const trial = { mode: 'BUSINESS' as const, paidUntil: null, leadsCaptured: 3, now: NOW };
  const orders = { mode: 'BUSINESS' as const, paidUntil: null, ordersPlaced: 3, ordersAtTrialReset: 0, now: NOW };

  it('counts free leads against the allowance passed in, so a raised one lets the 4th lead through', () => {
    expect(planState(trial, 5)).toEqual({ kind: 'trial', used: 3, remaining: 2 });
    expect(canCapture(trial, 5)).toBe(true);
  });

  it('takes nothing back when the allowance is lowered: spent, with no negative remaining', () => {
    expect(planState(trial, 2)).toEqual({ kind: 'trialSpent' });
    expect(canCapture(trial, 2)).toBe(false);
    expect(planState({ ...trial, paidUntil: PAST }, 2)).toEqual({ kind: 'lapsed', paidUntil: PAST });
  });

  it('counts free orders against the allowance passed in, raised or lowered', () => {
    expect(orderState(orders, 5)).toEqual({ kind: 'trial', used: 3, remaining: 2 });
    expect(canTakeOrders(orders, 5)).toBe(true);
    expect(orderState(orders, 2)).toEqual({ kind: 'trialSpent' });
    expect(canTakeOrders(orders, 2)).toBe(false);
  });

  it('defaults to the constants, so a caller with no settings behaves as before', () => {
    expect(planState(trial)).toEqual(planState(trial, FREE_LEADS));
    expect(orderState(orders)).toEqual(orderState(orders, FREE_ORDERS));
  });
});
