/** Billing period, as the key UsageCounter rows carry. The anniversary rule arrives with billing; the shape does not change. */
export function currentPeriod(now = new Date()): string {
  return now.toISOString().slice(0, 7);
}
