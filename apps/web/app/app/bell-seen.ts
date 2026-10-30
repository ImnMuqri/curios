import type { NavBadges } from '@curios/db-read';

/**
 * What the owner had in the bell when they last marked it read: each count it listed, and each alert.
 * The bell's items are worked out on every load (the nav's counts, the frame's alerts), never stored,
 * so "read" is this record of them. An item is new while its count is above what was read, or its
 * alert was not there to read. A cookie rather than browser storage, as theme.ts says, so the layout
 * renders the badge right from the first paint.
 *
 * A plain module, not the frame's: the layout (a Server Component) reads it.
 */
export const BELL_COOKIE = 'curios_bell';

export type BellKey = keyof NavBadges;

export interface BellSeen {
  counts: Partial<Record<BellKey, number>>;
  alerts: string[];
}

const KEYS: readonly BellKey[] = ['orders', 'questions', 'leads', 'review'];

/**
 * An alert as the bell remembers it: its id, which already changes when its news does (`trial-2`,
 * `paused-2026-11-14`). The Curios team's banner keeps one id whatever it says, so its words are
 * folded in: a new message is new again.
 */
export function bellAlertKey(alert: { id: string; text: string }, bannerId: string): string {
  if (alert.id !== bannerId) return alert.id;
  let hash = 5381;
  for (const char of alert.text) hash = ((hash * 33) ^ char.charCodeAt(0)) >>> 0;
  return `${alert.id}-${hash.toString(36)}`;
}

/** `orders:2.leads:1|trial-0.paused`: only characters a cookie value takes as they are. */
export function formatBellSeen(seen: BellSeen): string {
  const counts = KEYS.filter((key) => (seen.counts[key] ?? 0) > 0).map((key) => `${key}:${seen.counts[key]}`);
  return `${counts.join('.')}|${seen.alerts.join('.')}`;
}

export function parseBellSeen(value: string | undefined): BellSeen {
  const seen: BellSeen = { counts: {}, alerts: [] };
  if (!value) return seen;
  const [counts = '', alerts = ''] = value.split('|');
  for (const part of counts.split('.')) {
    const [key, n] = part.split(':');
    const count = Number(n);
    if (KEYS.includes(key as BellKey) && Number.isInteger(count) && count > 0) seen.counts[key as BellKey] = count;
  }
  seen.alerts = alerts.split('.').filter((id) => /^[a-z0-9-]{1,80}$/.test(id));
  return seen;
}

/**
 * What was read, held to what is there now: a count that has gone down was dealt with, so a new one
 * after it is news; an alert that has gone is forgotten, so its return is news.
 */
export function heldTo(seen: BellSeen, now: BellSeen): BellSeen {
  const counts: BellSeen['counts'] = {};
  for (const key of KEYS) {
    const held = Math.min(seen.counts[key] ?? 0, now.counts[key] ?? 0);
    if (held > 0) counts[key] = held;
  }
  return { counts, alerts: seen.alerts.filter((id) => now.alerts.includes(id)) };
}
