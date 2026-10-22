import { PLAN_PRICES_CENTS } from './billing.js';
import { renderMailHtml } from './mail.js';
import { FREE_LEADS, type OrderState } from './plan.js';

/**
 * The emails about an owner's plan and its limits: the free leads used up,
 * the month's conversations used up, and a plan ending (three days before, and
 * on the day). Named on the design handoff's Alerts board ("Where else it
 * shows"); the words are written in its banners' voice, since the board draws
 * these emails only by their subjects.
 *
 * Not switchable in Settings, unlike the lead email: each says something has
 * stopped, or is about to, and the owner would otherwise find out from a
 * customer.
 */

export const PLAN_MAIL_FOOTER = 'You get this because it’s about your Curios plan.';

interface Mail {
  subject: string;
  text: string;
  html: string;
}

const MALAYSIA = 'Asia/Kuala_Lumpur';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "14 Oct 2026", or "1 Nov" without the year, on the Malaysian calendar. */
function day(date: Date, withYear = true): string {
  const parts = new Intl.DateTimeFormat('en-MY', { day: 'numeric', month: 'numeric', year: 'numeric', timeZone: MALAYSIA }).formatToParts(date);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const short = `${Number(part('day'))} ${MONTHS[Number(part('month')) - 1]}`;
  return withYear ? `${short} ${part('year')}` : short;
}

/** "20 September 2026": the plan-ending reminder has always written its date this way. */
function longDay(date: Date): string {
  return date.toLocaleDateString('en-MY', { day: 'numeric', month: 'long', year: 'numeric', timeZone: MALAYSIA });
}

const ringgit = (cents: number) => `RM${cents / 100}`;
const billingUrl = (appUrl: string) => `${appUrl.replace(/\/+$/, '')}/app/billing`;
const prices = `Business is ${ringgit(PLAN_PRICES_CENTS.MONTHLY)} a month, or ${ringgit(PLAN_PRICES_CENTS.ANNUAL)} a year.`;

/** Sent once, when the last free lead is captured. */
export function trialSpentMail(input: { displayName: string; appUrl: string }): Mail {
  const subject = 'Your page stopped taking numbers';
  const said = `Your ${FREE_LEADS} free leads are used, so the capture card is no longer shown on ${input.displayName}. Everything else still works: your page, your FAQ pages and the chat.`;
  const more = `${prices} Paying turns the capture card back on straight away.`;
  const url = billingUrl(input.appUrl);
  return {
    subject,
    text: [said, '', more, '', url].join('\n'),
    html: renderMailHtml({
      subject,
      appUrl: input.appUrl,
      topRight: input.displayName,
      tag: { label: 'Trial used up', tone: 'amber' },
      heading: `Your ${FREE_LEADS} free leads are used`,
      blocks: [
        // The heading already says the leads are used; the body says what that changed.
        { kind: 'p', text: `The capture card is no longer shown on ${input.displayName}. Everything else still works: your page, your FAQ pages and the chat.` },
        { kind: 'buttons', primary: { label: 'See your options', href: url } },
        { kind: 'small', text: more },
      ],
      footer: PLAN_MAIL_FOOTER,
    }),
  };
}

/** Sent once a month, the first time the month's conversations run out. */
export function capReachedMail(input: { displayName: string; cap: number; resets: Date; appUrl: string }): Mail {
  const subject = 'Your page reached its monthly limit';
  const cap = input.cap.toLocaleString('en-MY');
  const until = day(input.resets, false);
  const said = `Until ${until}, the chat gives a short fixed reply and points people to your links. Nothing extra is charged. New questions still land in Questions.`;
  const url = billingUrl(input.appUrl);
  return {
    subject,
    text: [`${input.displayName} answered ${cap} conversations this month.`, '', said, '', url].join('\n'),
    html: renderMailHtml({
      subject,
      appUrl: input.appUrl,
      topRight: input.displayName,
      tag: { label: 'Limit reached', tone: 'amber' },
      heading: `Your page answered ${cap} conversations this month`,
      blocks: [
        { kind: 'p', text: said },
        { kind: 'buttons', primary: { label: 'See usage', href: url } },
      ],
      footer: PLAN_MAIL_FOOTER,
    }),
  };
}

/**
 * Three days before a paid plan ends. With a saved card it says what will be charged,
 * to which card and when; without one, the one thing it must not do is imply an
 * automatic charge.
 */
export function planEndingMail(input: {
  displayName: string;
  paidUntil: Date;
  appUrl: string;
  card: { label: string | null; amountCents: number } | null;
}): Mail {
  const ends = longDay(input.paidUntil);
  // With a card the plan does not end on that day, it renews: the subject must say so.
  const subject = `Your Curios plan for ${input.displayName} ${input.card ? 'renews' : 'ends'} on ${ends}`;
  const keep = 'If you do nothing, your page, your FAQ pages and chat all keep working. Only the capture card stops.';
  const url = billingUrl(input.appUrl);

  if (input.card) {
    const charge = `We'll charge ${ringgit(input.card.amountCents)} to ${input.card.label ?? 'your card'} on ${ends}. Turn off auto-renew on Billing if you don't want that.`;
    return {
      subject,
      text: [`Your Curios plan for ${input.displayName} renews on ${ends}.`, '', charge, '', url].join('\n'),
      html: renderMailHtml({
        subject,
        appUrl: input.appUrl,
        topRight: input.displayName,
        tag: { label: 'Plan ending', tone: 'amber' },
        heading: `Your plan renews on ${ends}`,
        blocks: [
          { kind: 'p', text: charge },
          { kind: 'buttons', primary: { label: 'See billing', href: url } },
        ],
        footer: PLAN_MAIL_FOOTER,
      }),
    };
  }

  const noCharge = 'We do not charge you automatically: you pay each time, by FPX, card or e-wallet, so nothing will be taken from your account.';
  return {
    subject,
    text: [`Your Curios plan for ${input.displayName} ends on ${ends}.`, '', noCharge, '', 'To keep the capture card on your page, pay for another month or year here:', url, '', keep].join('\n'),
    html: renderMailHtml({
      subject,
      appUrl: input.appUrl,
      topRight: input.displayName,
      tag: { label: 'Plan ending', tone: 'amber' },
      heading: `Your plan ends on ${ends}`,
      blocks: [
        { kind: 'p', text: noCharge },
        { kind: 'p', text: 'To keep the capture card on your page, pay for another month or year.' },
        { kind: 'buttons', primary: { label: 'Renew your plan', href: url } },
        { kind: 'small', text: keep },
      ],
      footer: PLAN_MAIL_FOOTER,
    }),
  };
}

/** The day a renewal charge was declined: the card is tried again tomorrow, and the owner may pay now instead. */
export function renewalFailedMail(input: { displayName: string; paidUntil: Date; appUrl: string; attempts: number }): Mail {
  const subject = "We couldn't renew your Curios plan";
  const said = "Your card was declined when we tried to renew your plan. We'll try again tomorrow. To keep your capture card and shop on without waiting, pay now.";
  const url = billingUrl(input.appUrl);
  return {
    subject,
    text: [said, '', url].join('\n'),
    html: renderMailHtml({
      subject,
      appUrl: input.appUrl,
      topRight: input.displayName,
      tag: { label: 'Renewal failed', tone: 'merah' },
      heading: "We couldn't charge your card",
      blocks: [
        { kind: 'p', text: said },
        { kind: 'buttons', primary: { label: 'Pay now', href: url } },
      ],
      footer: PLAN_MAIL_FOOTER,
    }),
  };
}

/**
 * When auto-renew gives up: after the third declined charge (`attempts`), when the plan ran
 * out without a renewal going through (`lapsed`, which can follow a single try, so it never
 * claims three), or when the saved card can no longer be charged at all (`card-removed`).
 */
export function autoRenewStoppedMail(input: {
  displayName: string;
  paidUntil: Date;
  appUrl: string;
  reason: 'attempts' | 'lapsed' | 'card-removed';
  now: Date;
}): Mail {
  const subject = `Auto-renew is off for ${input.displayName}`;
  const why = {
    attempts: "We couldn't charge your card after 3 tries, so we've turned auto-renew off.",
    lapsed: "We couldn't renew your plan before it ran out, so we've turned auto-renew off.",
    'card-removed': "Your saved card can no longer be charged, so we've turned auto-renew off.",
  }[input.reason];
  const when = `Your plan ${input.paidUntil.getTime() > input.now.getTime() ? 'ends' : 'ended'} on ${day(input.paidUntil)}.`;
  const next = 'Pay on Billing to switch the capture card and shop back on.';
  const url = billingUrl(input.appUrl);
  return {
    subject,
    text: [why, when, '', next, url].join('\n'),
    html: renderMailHtml({
      subject,
      appUrl: input.appUrl,
      topRight: input.displayName,
      tag: { label: 'Auto-renew off', tone: 'amber' },
      heading: 'Auto-renew is off',
      blocks: [
        { kind: 'p', text: why },
        { kind: 'p', text: when },
        { kind: 'p', text: next },
        { kind: 'buttons', primary: { label: 'Pay on Billing', href: url } },
      ],
      footer: PLAN_MAIL_FOOTER,
    }),
  };
}

/** The shop as a plan-ended notice needs it: `orderState` for the page, and whether the Store is on. */
export interface PlanEndedShop {
  state: OrderState;
  storeEnabled: boolean;
}

/**
 * What a plan ending changed, for the every-screen banner and the email alike.
 * The capture card has stopped; the shop has stopped only when `orderState`
 * says it may not take orders (a page with free orders left still can), and a
 * Store that is off is not mentioned at all.
 */
export function planEndedSaid(shop: PlanEndedShop | undefined): string {
  if (shop?.storeEnabled && (shop.state.kind === 'trialSpent' || shop.state.kind === 'lapsed')) {
    return 'The capture card is no longer shown and your shop has stopped taking orders. Your page and chat still work. Pay again to switch them back on.';
  }
  if (shop?.storeEnabled && shop.state.kind === 'trial') {
    const left = shop.state.remaining;
    return `The capture card is no longer shown. Your shop still has ${left} free ${left === 1 ? 'order' : 'orders'}. After ${left === 1 ? 'that' : 'those'}, checkout pauses until you pay. Your page and chat still work. Pay again to switch the capture card back on.`;
  }
  return 'The capture card is no longer shown. Your page and chat still work. Pay again to switch it back on.';
}

/** On the day a paid plan ends: the plan-ended banner's words (the owner's choice, 2026-10-16). */
export function planEndedMail(input: { displayName: string; paidUntil: Date; appUrl: string; shop: PlanEndedShop }): Mail {
  const ended = day(input.paidUntil);
  const subject = `Your Curios plan for ${input.displayName} has ended`;
  const said = planEndedSaid(input.shop);
  const url = billingUrl(input.appUrl);
  return {
    subject,
    text: [`Your Business plan ended on ${ended}.`, '', said, '', url].join('\n'),
    html: renderMailHtml({
      subject,
      appUrl: input.appUrl,
      topRight: input.displayName,
      tag: { label: 'Plan ended', tone: 'merah' },
      heading: `Your Business plan ended on ${ended}`,
      blocks: [
        { kind: 'p', text: said },
        { kind: 'buttons', primary: { label: 'Renew your plan', href: url } },
      ],
      footer: PLAN_MAIL_FOOTER,
    }),
  };
}
