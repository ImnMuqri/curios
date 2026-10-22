import type { BillingPlan } from '@curios/core';

/**
 * CHIP's product name, for a checkout and a renewal charge alike. It has no documented
 * short cap, but a long shop name must still not fail the purchase, so the line is cut
 * at 200 characters.
 */
export function billDescription(plan: BillingPlan, displayName: string): string {
  return `Curios Business, ${plan === 'ANNUAL' ? '1 year' : '1 month'} — ${displayName}`.slice(0, 200);
}
