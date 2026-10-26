/** Class times are entered and shown in Malaysia time, which has no daylight saving: UTC+8, always. */
const OFFSET_HOURS = 8;
const OFFSET_MS = OFFSET_HOURS * 3_600_000;

const two = (n: number) => String(n).padStart(2, '0');

/** "2026-11-07" and "20:00", read as Malaysia time, as the ISO instant the API takes; null when either is not a real date and time. */
export function toInstant(date: string, time: string): string | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{2}):(\d{2})$/.exec(time);
  if (!d || !t) return null;
  const [year, month, day, hour, minute] = [d[1], d[2], d[3], t[1], t[2]].map(Number) as [number, number, number, number, number];
  const probe = new Date(Date.UTC(year, month - 1, day, hour, minute));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day || hour > 23 || minute > 59) return null;
  return `${d[1]}-${d[2]}-${d[3]}T${t[1]}:${t[2]}:00+08:00`;
}

/** An instant as Malaysia's wall clock: the date for a date field and the time for a time field. */
export function toMalaysia(instant: string | Date): { date: string; time: string } {
  const shifted = new Date(new Date(instant).getTime() + OFFSET_MS);
  return {
    date: `${shifted.getUTCFullYear()}-${two(shifted.getUTCMonth() + 1)}-${two(shifted.getUTCDate())}`,
    time: `${two(shifted.getUTCHours())}:${two(shifted.getUTCMinutes())}`,
  };
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Sat 7 Nov, 8:00pm" in Malaysia time, the way the board writes a class time. */
export function timeLabel(instant: string | Date): string {
  const shifted = new Date(new Date(instant).getTime() + OFFSET_MS);
  const hour = shifted.getUTCHours();
  const clock = `${hour % 12 === 0 ? 12 : hour % 12}:${two(shifted.getUTCMinutes())}${hour < 12 ? 'am' : 'pm'}`;
  return `${DAYS[shifted.getUTCDay()]} ${shifted.getUTCDate()} ${MONTHS[shifted.getUTCMonth()]}, ${clock}`;
}
