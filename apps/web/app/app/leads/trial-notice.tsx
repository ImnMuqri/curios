import type { PlanState } from '@curios/core';
import { FREE_LEADS } from '@curios/core';
import { Callout } from '@curios/ui';

/**
 * What the leads screen says about the free trial.
 *
 * Split from the component so the wording is testable without rendering, and
 * so the three states are visible in one place rather than spread through JSX.
 *
 * Returns null where there is nothing to say. A personal page never captures,
 * so a count would be noise; a paid page is simply working, and an owner who
 * has paid does not need a meter on the screen they check for new business.
 *
 * The copy says "until you subscribe", which is not yet true -- slice 9 owns
 * billing and there is nowhere to subscribe today. It is written for the state
 * this ships in rather than the state it is written in, because slice 8 cannot
 * deploy without slice 9 anyway: without billing, a page that spends its trial
 * would stop capturing permanently with no way to pay. If that ordering ever
 * changes, this sentence is a promise the product cannot keep and has to go.
 */
export function trialNotice(state: PlanState): { tone: 'info' | 'action'; text: string } | null {
  switch (state.kind) {
    case 'personal':
    case 'paid':
      return null;

    case 'trial':
      return {
        tone: 'info',
        // The count, and what happens at the end of it. The count alone would
        // still leave the card's disappearance a surprise.
        text: `${state.used} of your ${FREE_LEADS} free leads used. After ${FREE_LEADS}, the capture card stops appearing on your page until you subscribe.`,
      };

    case 'trialSpent':
      return {
        tone: 'action',
        text: `All ${FREE_LEADS} of your free leads are used, so the capture card is no longer shown on your page. Everything else still works — your page, your FAQ pages and chat are unaffected.`,
      };

    case 'lapsed':
      return {
        tone: 'action',
        // Named separately from a spent trial because the owner has paid
        // before and the thing to do about it is different.
        text: `Your subscription ended on ${state.paidUntil.toLocaleDateString('en-MY', { day: 'numeric', month: 'long', year: 'numeric' })}, so the capture card is no longer shown on your page. Everything else still works.`,
      };
  }
}

export function TrialNotice({ state }: { state: PlanState }) {
  const notice = trialNotice(state);
  if (!notice) return null;
  return <Callout tone={notice.tone}>{notice.text}</Callout>;
}
