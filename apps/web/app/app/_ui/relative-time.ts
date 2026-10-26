const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY_MS = 24 * HOUR;

// Built once: making an Intl.DateTimeFormat costs far more than using one, and a list calls this
// per row (it was a third of opening Leads, measured).
const DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' });
const WEEKDAY = new Intl.DateTimeFormat('en-MY', { weekday: 'short', timeZone: 'Asia/Kuala_Lumpur' });
const DATE = new Intl.DateTimeFormat('en-MY', { day: 'numeric', month: 'short', timeZone: 'Asia/Kuala_Lumpur' });

/** Malaysia's calendar day of a moment, as YYYY-MM-DD. */
const dayOf = (date: Date) => DAY.format(date);

/**
 * "just now", "12 min ago", "3h ago", "yesterday", "Mon", "3 Oct": when a
 * topic was last asked, the way the board says it. Measured from `now`, which
 * the server passes down, so the server's render and the browser's agree.
 */
export function relativeTime(date: Date, now: Date): string {
  const ago = now.getTime() - date.getTime();
  if (ago < MINUTE) return 'just now';
  if (ago < HOUR) return `${Math.floor(ago / MINUTE)} min ago`;
  if (ago < DAY_MS && dayOf(date) === dayOf(now)) return `${Math.floor(ago / HOUR)}h ago`;
  if (dayOf(date) === dayOf(new Date(now.getTime() - DAY_MS))) return 'yesterday';
  if (ago < 7 * DAY_MS) return WEEKDAY.format(date);
  return DATE.format(date);
}
