import { describe, expect, it } from 'vitest';
import { capReachedMail, planEndedMail, planEndingMail, trialSpentMail } from './plan-mail.js';
import { orderState } from './plan.js';

const appUrl = 'https://curios.my/';
const PAID_UNTIL = new Date('2026-10-13T20:00:00.000Z');
/** The shop as it stands once the plan has ended, by the rule checkout uses. */
const ended = (page: { ordersPlaced: number; storeEnabled?: boolean }) => ({
  state: orderState({ mode: 'BUSINESS', paidUntil: PAID_UNTIL, ordersPlaced: page.ordersPlaced, ordersAtTrialReset: 0, now: new Date(PAID_UNTIL.getTime() + 1) }),
  storeEnabled: page.storeEnabled ?? true,
});

describe('the plan emails', () => {
  it('trial used up: the board’s subject, what stopped, what still works, and the prices', () => {
    const mail = trialSpentMail({ displayName: 'Kek Lina', appUrl });

    expect(mail.subject).toBe('Your page stopped taking numbers');
    expect(mail.text).toContain('the capture card is no longer shown on Kek Lina');
    expect(mail.text).toContain('Everything else still works');
    expect(mail.text).toContain('RM49 a month, or RM490 a year');
    expect(mail.html).toContain('href="https://curios.my/app/billing"');
    expect(mail.html).toContain('>See your options</a>');
  });

  it('limit reached: the board’s subject, the cap in force, and when it resets', () => {
    const mail = capReachedMail({ displayName: 'Kek Lina', cap: 2000, resets: new Date('2026-11-01T00:00:00.000Z'), appUrl });

    expect(mail.subject).toBe('Your page reached its monthly limit');
    expect(mail.html).toContain('Your page answered 2,000 conversations this month');
    expect(mail.text).toContain('Until 1 Nov, the chat gives a short fixed reply');
    expect(mail.text).toContain('Nothing extra is charged.');
  });

  it('plan ending: the date as it was always written, and no charge implied', () => {
    const mail = planEndingMail({ displayName: 'Kek Lina', paidUntil: new Date('2026-09-20T03:00:00.000Z'), appUrl });

    expect(mail.subject).toBe('Your Curios plan for Kek Lina ends on 20 September 2026');
    expect(mail.text).toContain('We do not charge you automatically');
    expect(mail.text).not.toContain('—');
    expect(mail.html).toContain('>Renew your plan</a>');
  });

  it('plan ended: the plan-ended banner’s words, on the Malaysian calendar', () => {
    // 20:00 UTC on the 13th is already the 14th in Kuala Lumpur.
    const mail = planEndedMail({ displayName: 'Kek Lina', paidUntil: new Date('2026-10-13T20:00:00.000Z'), appUrl, shop: ended({ ordersPlaced: 3 }) });

    expect(mail.html).toContain('Your Business plan ended on 14 Oct 2026');
    expect(mail.text).toContain('Your page and chat still work. Pay again to switch them back on.');
  });

  // The shop's half follows orderState, the rule checkout uses: a plan that
  // ended with free orders left has NOT stopped the shop yet.
  it('plan ended with free orders left: says how many, and not that the shop stopped', () => {
    const mail = planEndedMail({ displayName: 'Kek Lina', paidUntil: PAID_UNTIL, appUrl, shop: ended({ ordersPlaced: 1 }) });

    expect(mail.text).toContain('Your shop still has 2 free orders. After those, checkout pauses until you pay.');
    expect(mail.text).not.toContain('stopped taking orders');
    expect(mail.html).not.toContain('stopped taking orders');
    expect(planEndedMail({ displayName: 'Kek Lina', paidUntil: PAID_UNTIL, appUrl, shop: ended({ ordersPlaced: 2 }) }).text).toContain(
      'Your shop still has 1 free order. After that, checkout pauses until you pay.',
    );
  });

  it('plan ended with no free orders left: the shop has stopped taking orders', () => {
    const mail = planEndedMail({ displayName: 'Kek Lina', paidUntil: PAID_UNTIL, appUrl, shop: ended({ ordersPlaced: 3 }) });

    expect(mail.text).toContain('The capture card is no longer shown and your shop has stopped taking orders.');
    expect(mail.html).toContain('your shop has stopped taking orders');
  });

  it('plan ended with the Store off: says nothing about orders', () => {
    const mail = planEndedMail({ displayName: 'Kek Lina', paidUntil: PAID_UNTIL, appUrl, shop: ended({ ordersPlaced: 3, storeEnabled: false }) });

    expect(mail.text).toContain('The capture card is no longer shown. Your page and chat still work. Pay again to switch it back on.');
    expect(mail.text).not.toMatch(/order|shop|checkout/i);
  });

  it('says why each came, and that it is not a switchable one', () => {
    expect(trialSpentMail({ displayName: 'Kek Lina', appUrl }).html).toContain('it’s about your Curios plan');
  });
});
