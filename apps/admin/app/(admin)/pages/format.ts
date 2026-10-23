import type { AdminPageStatus } from '@curios/db-read/admin';

export const STATUS_COLOUR: Record<AdminPageStatus, string> = {
  Live: '#1d9a6c',
  Lapsed: '#f2a33c',
  Suspended: '#d8452f',
  Draft: '#9aa0ab',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' });
const hm = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kuala_Lumpur',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

/** "23 Oct 2026", on the Malaysian calendar. */
export function day(d: Date): string {
  const [y, m, n] = ymd.format(d).split('-').map(Number) as [number, number, number];
  return `${n} ${MONTHS[m - 1]} ${y}`;
}

/** "23 Oct 2026, 3:42pm". */
export function dayTime(d: Date): string {
  return `${day(d)}, ${hm.format(d).replace(' ', '').toLowerCase()}`;
}

/** Cents as "RM12.50", or "RM12" when whole. */
export function rm(cents: number): string {
  const v = cents / 100;
  return `RM${Number.isInteger(v) ? v : v.toFixed(2)}`;
}
