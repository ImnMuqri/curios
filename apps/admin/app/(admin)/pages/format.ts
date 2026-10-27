import type { AdminPageStatus } from '@curios/db-read/admin';

export const STATUS_COLOUR: Record<AdminPageStatus, string> = {
  Live: '#1d9a6c',
  Lapsed: '#f2a33c',
  Flagged: '#f2a33c',
  Suspended: '#d8452f',
  Draft: '#9aa0ab',
};

/** The board's meter colours: blue, amber from 80% of the cap, red at it. */
export const meterColour = (used: number, cap: number) =>
  used >= cap ? '#d8452f' : used >= cap * 0.8 ? '#f2a33c' : '#2340c8';

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
