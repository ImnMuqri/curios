import type { Period } from '@curios/db-read/admin';

export const PERIODS: { key: Period; label: string; phrase: string }[] = [
  { key: 'today', label: 'Today', phrase: 'today' },
  { key: '7d', label: '7 days', phrase: 'the last 7 days' },
  { key: '30d', label: '30 days', phrase: 'the last 30 days' },
];

/** `?period=` as a Period; anything else is the default, 7 days. */
export function parsePeriod(value: string | string[] | undefined): Period {
  const v = Array.isArray(value) ? value[0] : value;
  return PERIODS.find((p) => p.key === v)?.key ?? '7d';
}
