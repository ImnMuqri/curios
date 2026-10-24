/** Digital items: what a shop can sell that is delivered by email, not posted or collected. */

export type ItemKind = 'PHYSICAL' | 'DIGITAL';

/** Files an item can hold. */
export const MAX_DIGITAL_FILES = 5;
/** 100 MB each. */
export const MAX_DIGITAL_FILE_BYTES = 104_857_600;
/** How many times a download link works. */
export const DOWNLOAD_USES = 5;
/** How long a download link lasts, from when it is made. */
export const DOWNLOAD_DAYS = 30;
/** The longest note that can go with a link. */
export const ACCESS_NOTE_MAX = 200;

/** The file types a digital item accepts: PDF, images, ZIP, audio, video. */
export const DIGITAL_FILE_TYPES = ['application/pdf', 'image/*', 'application/zip', 'audio/*', 'video/*'] as const;

/** Codes pasted one per line: trimmed, blanks and duplicates dropped, first-seen order kept. */
export function parseCodes(text: string): string[] {
  const seen = new Set<string>();
  const codes: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const code = line.trim();
    if (code === '' || seen.has(code)) continue;
    seen.add(code);
    codes.push(code);
  }
  return codes;
}

/** True when there is at least one line and every one is digital: such an order has no method and no day. */
export function isDigitalOnly(lines: { kind: ItemKind }[]): boolean {
  return lines.length > 0 && lines.every((line) => line.kind === 'DIGITAL');
}

/** Seats still open at a session time, never below zero. */
export function seatsLeft(session: { seats: number }, booked: number): number {
  return Math.max(0, session.seats - booked);
}
