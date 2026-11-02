/**
 * Pickup places and their time windows: the limits the forms enforce, the label
 * for a window, the check that a place's windows make sense, and the one line an
 * order shows for its pickup. Times are minutes after midnight, Malaysia time.
 */

export { PICKUP_NOTE_MAX } from './store';

export const PICKUP_LIMIT_MAX = 999;
export const PICKUP_PLACE_NAME_MAX = 60;
export const PICKUP_ADDRESS_MAX = 160;
export const PICKUP_PLACES_MAX = 10;
export const PICKUP_WINDOWS_MAX = 12;

function clock(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}${m === 0 ? '' : `:${String(m).padStart(2, '0')}`}${h < 12 ? 'am' : 'pm'}`;
}

/** `10am–12pm`, with minutes only when they are not `:00`. */
export function windowLabel(from: number, to: number): string {
  return `${clock(from)}–${clock(to)}`;
}

/** Plain English for the first thing wrong with a place's windows, or null. */
export function windowProblem(
  windows: { from: number; to: number; limit: number | null }[],
): string | null {
  for (const w of windows) {
    if (!(w.from >= 0 && w.from < w.to && w.to <= 1440)) {
      return 'A pickup time has to end after it starts.';
    }
    if (
      w.limit !== null &&
      !(Number.isInteger(w.limit) && w.limit >= 1 && w.limit <= PICKUP_LIMIT_MAX)
    ) {
      return `A limit is 1 to ${PICKUP_LIMIT_MAX} orders, or none.`;
    }
  }
  const sorted = [...windows].sort((a, b) => a.from - b.from);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const next = sorted[i]!;
    if (next.from < prev.to) {
      return `Two pickup times overlap: ${windowLabel(prev.from, prev.to)} and ${windowLabel(next.from, next.to)}.`;
    }
  }
  return null;
}

/**
 * `Pickup · Sat 5 Dec, 10am–12pm · Home, Seksyen 7`, each part only when there.
 * Null for anything but pickup: callers keep their own delivery wording. A page
 * in Malay passes its own word for pickup as `label`.
 */
export function pickupLine(o: {
  method: 'PICKUP' | 'DELIVERY' | null;
  dayLabel: string | null;
  pickupFrom: number | null;
  pickupTo: number | null;
  pickupPlaceName: string | null;
  label?: string;
}): string | null {
  if (o.method !== 'PICKUP') return null;
  const when = [
    o.dayLabel,
    o.pickupFrom !== null && o.pickupTo !== null ? windowLabel(o.pickupFrom, o.pickupTo) : null,
  ]
    .filter(Boolean)
    .join(', ');
  return [o.label ?? 'Pickup', when || null, o.pickupPlaceName].filter(Boolean).join(' · ');
}
