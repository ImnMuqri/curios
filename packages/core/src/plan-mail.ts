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

/** Three days before a paid plan ends. The one thing it must not do is imply an automatic charge. */
export function planEndingMail(input: { displayName: string; paidUntil: Date; appUrl: string }): Mail {
  const ends = longDay(input.paidUntil);
  const subject = `Your Curios plan for ${input.displayName} ends on ${ends}`;
  const noCharge = 'We do not charge you automatically: FPX payments need your approval each time, so nothing will be taken from your account.';
  const keep = 'If you do nothing, your page, your FAQ pages and chat all keep working. Only the capture card stops.';
  const url = billingUrl(input.appUrl);
  return {
    subject,
    text: [`Your Curios plan for ${input.displayName} ends on ${ends}.`, '', noCharge, '', 'To keep the capture card on your page, pay for another month or year here:', url, '', keep].join('\n'),
    html: renderMailHtml({
      subject,
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
