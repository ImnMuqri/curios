import type { PlanState } from '@curios/core';
import { FREE_LEADS } from '@curios/core';
import { Callout } from '@curios/ui';

/**
 * A date as an owner in Malaysia reads it. `paidUntil` is stored in UTC, and
 * 20:00 UTC is already tomorrow in Kuala Lumpur -- so the zone is named rather
 * than inherited from wherever this renders.
 *
 * Duplicated from the billing screen's `formatDate` on purpose: two screens
 * that happen to format a date the same way are not a shared abstraction, and
 * the alternative is a copy module imported across feature folders for one
 * Intl call.
 */
function malaysianDate(date: Date): string {
  return date.toLocaleDateString('en-MY', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Kuala_Lumpur',
  });
}

export interface Notice {
  tone: 'info' | 'action';
  text: string;
  /**
   * Every notice has one. A screen that explains capture has stopped and offers
   * no way to start it again is the finding this whole slice answers.
   */
  action: { href: string; label: string };
}

const BILLING = '/app/billing';

/**
 * What the leads screen says about the free trial.
 *
 * Split from the component so the wording is testable without rendering, and
 * so the states are visible in one place rather than spread through JSX.
 *
 * Returns null where there is nothing to say. A personal page never captures,
 * so a count would be noise; a paid page is simply working, and an owner who
 * has paid does not need a meter on the screen they check for new business.
 */
export function trialNotice(state: PlanState): Notice | null {
  switch (state.kind) {
    case 'personal':
    case 'paid':
      return null;

    case 'trial':
      // A trial that outlived a subscription needs both facts said at once: the
      // subscription ended, and capture has NOT stopped, because free leads are
      // left. Either sentence alone is misleading.
      return state.lapsedOn
        ? {
            tone: 'action',
            text: `Your subscription ended on ${malaysianDate(state.lapsedOn)}, and you have ${state.remaining} free leads left. After those, the capture card stops appearing on your page.`,
            action: { href: BILLING, label: 'Renew your plan' },
          }
        : {
            tone: 'info',
            // The count, and what happens at the end of it. The count alone
            // would still leave the card's disappearance a surprise.
            text: `${state.used} of your ${FREE_LEADS} free leads used. After ${FREE_LEADS}, the capture card stops appearing on your page until you subscribe.`,
            action: { href: BILLING, label: 'See plans' },
          };

    case 'trialSpent':
      return {
        tone: 'action',
        text: `All ${FREE_LEADS} of your free leads are used, so the capture card is no longer shown on your page. Everything else still works — your page, your FAQ pages and chat are unaffected.`,
        action: { href: BILLING, label: 'See your options' },
      };

    case 'lapsed':
      return {
        tone: 'action',
        // Named separately from a spent trial because the owner has paid
        // before and the thing to do about it is different.
        text: `Your subscription ended on ${malaysianDate(state.paidUntil)}, so the capture card is no longer shown on your page. Everything else still works.`,
        action: { href: BILLING, label: 'Renew your plan' },
      };
  }
}

export function TrialNotice({ state }: { state: PlanState }) {
  const notice = trialNotice(state);
  if (!notice) return null;
  return (
    <Callout tone={notice.tone}>
      {notice.text} <a href={notice.action.href}>{notice.action.label}</a>
    </Callout>
  );
}
