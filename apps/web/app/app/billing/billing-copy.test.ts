import { describe, expect, it } from 'vitest';
import { FREE_LEADS, planState } from '@curios/core';
import { formatDate, paymentBanner, paymentLine, paymentParts, planBadge, planSummary, ringgit, usageSummary } from './billing-copy.js';

const NOW = new Date('2026-09-14T08:00:00.000Z');

const stateOf = (page: { mode?: 'PERSONAL' | 'BUSINESS'; paidUntil?: Date | null; leadsCaptured?: number }) =>
  planState({
    mode: page.mode ?? 'BUSINESS',
    paidUntil: page.paidUntil ?? null,
    leadsCaptured: page.leadsCaptured ?? 0,
    now: NOW,
  });

describe('formatDate', () => {
  it('uses the calendar day in Malaysia, not in UTC', () => {
    // 20:00 UTC on 11 October is already 04:00 on the 12th in Kuala Lumpur.
    expect(formatDate(new Date('2026-10-11T20:00:00.000Z'))).toBe('12 October 2026');
  });
});

describe('ringgit', () => {
  it('writes whole ringgit the way the prices are published', () => {
    expect(ringgit(3900)).toBe('RM39');
    expect(ringgit(39000)).toBe('RM390');
  });

  it('keeps the cents when there are some', () => {
    expect(ringgit(3950)).toBe('RM39.50');
  });
});

describe('planSummary', () => {
  it('tells a personal page there is nothing to pay for', () => {
    expect(planSummary(stateOf({ mode: 'PERSONAL' }))).toBe(
      'Personal pages are free. There is nothing to pay for.',
    );
  });

  it('gives a paid page its paid-through date, in Malaysian time', () => {
    expect(planSummary(stateOf({ paidUntil: new Date('2026-10-11T20:00:00.000Z') }))).toBe(
      'Your plan is paid through 12 October 2026.',
    );
  });

  it('counts the trial', () => {
    expect(planSummary(stateOf({ leadsCaptured: 2 }))).toBe(
      `You are on the free trial: 2 of ${FREE_LEADS} free leads used.`,
    );
  });

  it('tells a spent trial what paying does', () => {
    expect(planSummary(stateOf({ leadsCaptured: FREE_LEADS }))).toBe(
      `All ${FREE_LEADS} of your free leads are used. Pay to keep the capture card on your page.`,
    );
  });

  it('tells a lapsed plan when it ended', () => {
    expect(
      planSummary(stateOf({ paidUntil: new Date('2026-08-01T00:00:00.000Z'), leadsCaptured: FREE_LEADS })),
    ).toBe('Your plan ended on 1 August 2026. Pay to turn the capture card back on.');
  });
});

describe('paymentBanner', () => {
  it('confirms a paid return', () => {
    expect(paymentBanner('paid')).toEqual({ tone: 'info', text: 'Payment received. Your plan is active.' });
  });

  it('says a pending return is still being confirmed', () => {
    expect(paymentBanner('pending')).toEqual({
      tone: 'info',
      text: 'We are still confirming your payment with Billplz. It will show here once it is confirmed.',
    });
  });

  it('says a failed return charged nothing', () => {
    expect(paymentBanner('failed')).toEqual({
      tone: 'error',
      text: 'The payment did not go through, and nothing was charged. You can try again below.',
    });
  });

  it('says nothing for anything else', () => {
    expect(paymentBanner(undefined)).toBeNull();
    expect(paymentBanner('granted')).toBeNull();
  });
});

describe('usageSummary', () => {
  it('counts this month against the cap in force', () => {
    expect(usageSummary({ used: 12, cap: 200, period: '2026-09' })).toBe(
      '12 of 200 conversations used this month.',
    );
  });

  it('adds nothing at exactly the cap, where chat still answers normally', () => {
    // The API refuses only above the cap (isOverCap is `>`), so the 200th
    // conversation of 200 was answered by the model like any other.
    expect(usageSummary({ used: 200, cap: 200, period: '2026-09' })).toBe(
      '200 of 200 conversations used this month.',
    );
  });

  it('says what happens past the cap, because chat has already changed', () => {
    // Over the cap the API answers with a fixed reply instead of the model. An
    // owner seeing "201 of 200" without that sentence would think nothing had.
    expect(usageSummary({ used: 201, cap: 200, period: '2026-09' })).toBe(
      '201 of 200 conversations used this month. Chat is answering with a short fixed reply until next month.',
    );
  });
});

describe('planSummary, after a lapse', () => {
  it('tells a page that lapsed with free leads left that its plan ended', () => {
    // The leads screen says both halves of this (trial-notice.tsx). This
    // screen saying only "free trial" would tell the same owner otherwise.
    expect(
      planSummary(stateOf({ paidUntil: new Date('2026-08-01T00:00:00.000Z'), leadsCaptured: 1 })),
    ).toBe(
      `Your plan ended on 1 August 2026. You have ${FREE_LEADS - 1} free leads left before the capture card stops.`,
    );
  });
});

describe('paymentLine', () => {
  const base = {
    id: 'pay-1',
    plan: 'MONTHLY' as const,
    amountCents: 3900,
    status: 'PAID' as const,
    paidAt: new Date('2026-09-11T20:00:00.000Z'), // the 12th in Kuala Lumpur
    grantedUntil: new Date('2026-10-12T00:00:00.000Z'),
    createdAt: new Date('2026-09-11T10:00:00.000Z'), // still the 11th in Kuala Lumpur
  };

  it('dates a paid payment by when it was paid, in Malaysian time', () => {
    // 20:00 UTC is already the 12th in Kuala Lumpur.
    expect(paymentLine(base)).toBe('12 September 2026 — RM39 for a month, paid');
  });

  it('dates an unfinished payment by when it was started, and says so', () => {
    expect(paymentLine({ ...base, status: 'PENDING', paidAt: null, grantedUntil: null })).toBe(
      '11 September 2026 — RM39 for a month, not completed',
    );
  });

  it('names the annual plan by its period, not its price', () => {
    expect(paymentLine({ ...base, plan: 'ANNUAL', amountCents: 39000 })).toBe(
      '12 September 2026 — RM390 for a year, paid',
    );
  });
});

describe('planBadge', () => {
  it('names each plan in two words, loud only when the plan has run out', () => {
    expect(planBadge(stateOf({ mode: 'PERSONAL' }))).toEqual({ text: 'Personal', tone: 'muda' });
    expect(planBadge(stateOf({ leadsCaptured: 1 }))).toEqual({ text: 'Free trial', tone: 'muda' });
    expect(planBadge(stateOf({ paidUntil: new Date('2099-01-01T00:00:00.000Z') }))).toEqual({ text: 'Business', tone: 'biru' });
    expect(planBadge(stateOf({ leadsCaptured: FREE_LEADS }))).toEqual({ text: 'Trial used up', tone: 'kuning' });
    expect(planBadge(stateOf({ leadsCaptured: FREE_LEADS, paidUntil: new Date('2020-01-01T00:00:00.000Z') }))).toEqual({ text: 'Plan ended', tone: 'kuning' });
  });
});

describe('paymentParts', () => {
  const base = { id: 'p', plan: 'ANNUAL' as const, amountCents: 39000, createdAt: new Date('2026-09-11T10:00:00.000Z') };

  it('dates a paid payment by when it was paid, and says how long it covers', () => {
    expect(
      paymentParts({ ...base, status: 'PAID', paidAt: new Date('2026-09-11T20:00:00.000Z'), grantedUntil: new Date('2027-09-12T00:00:00.000Z') }),
    ).toEqual({ date: '12 September 2026', what: 'RM390 for a year', paid: true, until: '12 September 2027' });
  });

  it('dates an unfinished one by when it was started, and promises nothing', () => {
    expect(paymentParts({ ...base, status: 'PENDING', paidAt: null, grantedUntil: null })).toEqual({
      date: '11 September 2026',
      what: 'RM390 for a year',
      paid: false,
      until: null,
    });
  });
});
