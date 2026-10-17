import { describe, expect, it } from 'vitest';
import { capReachedMail, planEndedMail, planEndingMail, trialSpentMail } from './plan-mail.js';

const appUrl = 'https://curios.my/';

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
    const mail = planEndedMail({ displayName: 'Kek Lina', paidUntil: new Date('2026-10-13T20:00:00.000Z'), appUrl });

    expect(mail.html).toContain('Your Business plan ended on 14 Oct 2026');
    expect(mail.text).toContain('Your page and chat still work. Pay again to switch them back on.');
  });

  it('says why each came, and that it is not a switchable one', () => {
    expect(trialSpentMail({ displayName: 'Kek Lina', appUrl }).html).toContain('it’s about your Curios plan');
  });
});
