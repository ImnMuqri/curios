import { malaysiaToday } from '@curios/core/orders';

export const DAY_MS = 86_400_000;
/** Malaysia is UTC+8 all year. */
export const MALAYSIA_OFFSET_MS = 8 * 3_600_000;

/** The instant Malaysia's midnight began for the day `daysAgo` days before `now`'s Malaysian day. */
export function malaysiaMidnight(now: Date, daysAgo = 0): Date {
  return new Date(Date.parse(`${malaysiaToday(now)}T00:00:00Z`) - daysAgo * DAY_MS - MALAYSIA_OFFSET_MS);
}

/** The Malaysian calendar day (`YYYY-MM-DD`) of an instant. */
export function malaysiaDay(at: Date): string {
  return malaysiaToday(at);
}
