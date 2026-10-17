import { FREE_LEADS, type PlanState } from '@curios/core';
import { shortDate, usageResets } from './billing/billing-copy.js';

/**
 * One of the dashboard's stop states, from the design handoff's Alerts board,
 * as plain data for the banner under a screen's header.
 *
 * - `tone`: info (blue, can be dismissed), warn (amber, stays), stop (red,
 *   stays, and puts a dot on Billing).
 * - `where`: every screen, or the one screen it is about.
 * - `id`: what a dismissal remembers. It changes when the news does (another
 *   lead used, a new month), so a dismissed banner comes back when there is
 *   something new to say.
 * - `meter`: the segments under the text, filled or not.
 */
export interface Alert {
  id: string;
  tone: 'info' | 'warn' | 'stop';
  where: 'all' | '/app/leads' | '/app/questions';
  icon: 'lead' | 'card' | 'chat';
  title: string;
  text: string;
  meter?: boolean[];
  action: { href: string; label: string };
}

const BILLING = '/app/billing';

/** "Near" the conversation limit: about 80% of it, as the handoff asks. */
export const NEAR_SHARE = 0.8;

/** The cap meter's five segments, filled by how much of the month is used. */
function fifths(used: number, cap: number): boolean[] {
  const filled = cap > 0 ? Math.min(5, Math.floor((used / cap) * 5)) : 0;
  return Array.from({ length: 5 }, (_, i) => i < filled);
}

/**
 * Which alerts this owner has right now, most urgent first. The words are the
 * board's (the owner's decision of 2026-10-16), keeping the repo's meaning
 * where the old trial notice on Leads said the same thing.
 */
export function alertsFor(input: { plan: PlanState; usage: { used: number; cap: number }; now: Date }): Alert[] {
  const { plan, usage, now } = input;
  const alerts: Alert[] = [];

  switch (plan.kind) {
    case 'lapsed':
      alerts.push({
        id: `lapsed-${plan.paidUntil.toISOString().slice(0, 10)}`,
        tone: 'stop',
        where: 'all',
        icon: 'card',
        title: `Your Business plan ended on ${shortDate(plan.paidUntil, true)}`,
        text: 'The capture card is no longer shown and your shop has stopped taking orders. Your page and chat still work. Pay again to switch them back on.',
        action: { href: BILLING, label: 'Renew your plan' },
      });
      break;
    case 'trial':
      if (plan.lapsedOn) {
        // The plan ended but free leads are left, so capture has NOT stopped
        // yet: both halves said at once, as the old trial notice did.
        alerts.push({
          id: `ended-${plan.lapsedOn.toISOString().slice(0, 10)}-${plan.used}`,
          tone: 'stop',
          where: 'all',
          icon: 'card',
          title: `Your Business plan ended on ${shortDate(plan.lapsedOn, true)}`,
          text: `You have ${plan.remaining} free ${plan.remaining === 1 ? 'lead' : 'leads'} left. After ${plan.remaining === 1 ? 'that' : 'those'}, the capture card stops appearing on your page. Your page and chat still work.`,
          meter: Array.from({ length: FREE_LEADS }, (_, i) => i < plan.used),
          action: { href: BILLING, label: 'Renew your plan' },
        });
      } else {
        alerts.push({
          id: `trial-${plan.used}`,
          tone: 'info',
          where: '/app/leads',
          icon: 'lead',
          title: `${plan.used} of your ${FREE_LEADS} free leads used`,
          text: `After ${FREE_LEADS}, the capture card stops appearing on your page until you subscribe.`,
          meter: Array.from({ length: FREE_LEADS }, (_, i) => i < plan.used),
          action: { href: BILLING, label: 'See plans' },
        });
      }
      break;
    case 'trialSpent':
      alerts.push({
        id: 'spent',
        tone: 'warn',
        where: '/app/leads',
        icon: 'lead',
        title: `Your ${FREE_LEADS} free leads are used`,
        text: 'The capture card is no longer shown on your page. Everything else still works: your page, your FAQ pages and the chat.',
        meter: Array.from({ length: FREE_LEADS }, () => true),
        action: { href: BILLING, label: 'See your options' },
      });
      break;
    case 'paid':
    case 'personal':
      break;
  }

  const month = now.toISOString().slice(0, 7);
  const resets = shortDate(usageResets(now));
  if (usage.cap > 0 && usage.used >= usage.cap) {
    alerts.push({
      id: `cap-${month}`,
      tone: 'warn',
      where: '/app/questions',
      icon: 'chat',
      title: `Your page answered ${usage.cap.toLocaleString('en-MY')} conversations this month`,
      text: `Until ${resets}, the chat gives a short fixed reply and points people to your links. Nothing extra is charged. New questions still land here.`,
      meter: fifths(usage.used, usage.cap),
      action: { href: BILLING, label: 'See usage' },
    });
  } else if (usage.cap > 0 && usage.used >= usage.cap * NEAR_SHARE) {
    alerts.push({
      id: `near-${month}`,
      tone: 'info',
      where: '/app/questions',
      icon: 'chat',
      title: `${usage.used.toLocaleString('en-MY')} of ${usage.cap.toLocaleString('en-MY')} conversations used this month`,
      text: `At ${usage.cap.toLocaleString('en-MY')} the chat gives a short fixed reply until ${resets}. Your links keep working.`,
      meter: fifths(usage.used, usage.cap),
      action: { href: BILLING, label: 'See usage' },
    });
  }

  return alerts;
}

/** A red dot on Billing in the sidebar until the owner chooses: a used-up trial, or a plan that ended. */
export function billingNeedsYou(plan: PlanState): boolean {
  return plan.kind === 'trialSpent' || plan.kind === 'lapsed' || (plan.kind === 'trial' && plan.lapsedOn !== undefined);
}
