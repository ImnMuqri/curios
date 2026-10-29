import { planState, type PlanInput } from '@curios/core';

/** The line under the owner's name in the sidebar: where their plan stands, against the free leads in force. */
export function planLabel(input: PlanInput, freeLeads: number): string {
  const state = planState(input, freeLeads);
  switch (state.kind) {
    case 'personal':
      return 'Personal page';
    case 'paid':
      return 'Business plan';
    case 'trial':
      // A paid plan that ran out while free leads remain is still an ended plan to its owner.
      return state.lapsedOn ? 'Plan ended' : 'Free trial';
    case 'trialSpent':
      return 'Free trial';
    case 'lapsed':
      return 'Plan ended';
  }
}

const DAY = 86_400_000;

/** The month a paid plan's bar measures against: "18 days left" fills 60% (the boards). */
const BAR_DAYS = 30;

/**
 * The sidebar's plan block under the nav: the plan's name, how it stands, and how full its bar is
 * (null: no bar). `glance` is the same in one line, for the account menu's plan card. Only the paid state is drawn on the boards ("18 days left, until 14 Nov"); the
 * others say the same thing the plan's banners do, in a line.
 */
export function planBlock(input: PlanInput, freeLeads: number): { name: string; note: string; fill: number | null; glance: string } {
  const state = planState(input, freeLeads);
  const name = planLabel(input, freeLeads);
  const on = (date: Date) => date.toLocaleDateString('en-MY', { day: 'numeric', month: 'short', timeZone: 'Asia/Kuala_Lumpur' });
  switch (state.kind) {
    case 'personal':
      return { name, note: 'Free, always', fill: null, glance: 'Personal page · free, always' };
    case 'paid': {
      const days = Math.max(1, Math.ceil((state.paidUntil.getTime() - input.now.getTime()) / DAY));
      // "Paid until", never "renews": auto-renew is opt-in, so most plans simply end.
      return { name, note: `${days} ${days === 1 ? 'day' : 'days'} left, until ${on(state.paidUntil)}`, fill: Math.min(1, days / BAR_DAYS), glance: `Business · paid until ${on(state.paidUntil)}` };
    }
    case 'trial':
      if (state.lapsedOn) return { name, note: `Ended ${on(state.lapsedOn)}`, fill: 0, glance: `Plan ended ${on(state.lapsedOn)}` };
      return { name, note: `${state.remaining} of ${freeLeads} free leads left`, fill: freeLeads > 0 ? state.remaining / freeLeads : 0, glance: `Free trial · ${state.remaining} of ${freeLeads} free leads left` };
    case 'trialSpent':
      return { name, note: 'Free leads used up', fill: 0, glance: 'Free trial · free leads used up' };
    case 'lapsed':
      return { name, note: `Ended ${on(state.paidUntil)}`, fill: 0, glance: `Plan ended ${on(state.paidUntil)}` };
  }
}
