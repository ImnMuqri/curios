import { planState, type PlanInput } from '@curios/core';

/** The line under the owner's name in the sidebar: where their plan stands. */
export function planLabel(input: PlanInput): string {
  const state = planState(input);
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
