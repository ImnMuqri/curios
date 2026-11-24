/** The calendar file for a class (RFC 5545). Kept apart from route.ts, which may export only the route's own names. */
/** RFC 5545 TEXT: backslash, semicolon and comma are escaped, a line break becomes \n. */
export function icsText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n');
}

/** A UTC time as an iCalendar DATE-TIME: 20261107T120000Z. */
export function icsTime(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** Content lines are at most 75 octets: longer ones continue on the next line after a space. */
export function fold(line: string): string {
  const parts: string[] = [];
  let current = '';
  let bytes = 0;
  // The first line may hold 75 octets, each continuation 74 (the space counts).
  let limit = 75;
  for (const ch of line) {
    const size = Buffer.byteLength(ch);
    if (bytes + size > limit) {
      parts.push(current);
      current = '';
      bytes = 0;
      limit = 74;
    }
    current += ch;
    bytes += size;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

/** The file's lines, joined and folded: the one ending every calendar here shares. */
function calendarFile(event: string[]): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Curios//Order//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT', ...event, 'END:VEVENT', 'END:VCALENDAR'];
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

/** Malaysia is UTC+8 all year, with no daylight saving: a pickup window is kept in its minutes after midnight there. */
const MALAYSIA_MS = 8 * 60 * 60_000;

/** `20261121` for the day after an ISO day, as an all-day event's exclusive end. */
function nextDayValue(day: string): string {
  const next = new Date(`${day}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10).replace(/-/g, '');
}

/**
 * The calendar file for a pickup order: its window on its day (Malaysia time) at its place, or the whole
 * day when the order kept no window. `day` is the order's ISO day (2026-11-21), `from` and `to` are minutes after midnight.
 */
export function pickupCalendar(input: {
  uid: string;
  now: Date;
  day: string;
  from: number | null;
  to: number | null;
  title: string;
  where: string | null;
  shopName: string;
  orderUrl: string;
}): string {
  const timed = input.from !== null && input.to !== null;
  const midnight = Date.parse(`${input.day}T00:00:00.000Z`) - MALAYSIA_MS;
  const when = timed
    ? [`DTSTART:${icsTime(new Date(midnight + input.from! * 60_000))}`, `DTEND:${icsTime(new Date(midnight + input.to! * 60_000))}`]
    : [`DTSTART;VALUE=DATE:${input.day.replace(/-/g, '')}`, `DTEND;VALUE=DATE:${nextDayValue(input.day)}`];
  return calendarFile([
    `UID:${input.uid}`,
    `DTSTAMP:${icsTime(input.now)}`,
    ...when,
    `SUMMARY:${icsText(input.title)}`,
    ...(input.where ? [`LOCATION:${icsText(input.where)}`] : []),
    `DESCRIPTION:${icsText(`${input.shopName}\n${input.orderUrl}`)}`,
  ]);
}

/** The calendar file for one session line. */
export function sessionCalendar(input: {
  uid: string;
  now: Date;
  startsAt: Date;
  minutes: number;
  title: string;
  where: string | null;
  shopName: string;
  orderUrl: string;
}): string {
  const end = new Date(input.startsAt.getTime() + input.minutes * 60_000);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Curios//Order//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${input.uid}`,
    `DTSTAMP:${icsTime(input.now)}`,
    `DTSTART:${icsTime(input.startsAt)}`,
    `DTEND:${icsTime(end)}`,
    `SUMMARY:${icsText(input.title)}`,
    ...(input.where ? [`LOCATION:${icsText(input.where)}`] : []),
    `DESCRIPTION:${icsText(`${input.shopName}\n${input.orderUrl}`)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.map(fold).join('\r\n')}\r\n`;
}
