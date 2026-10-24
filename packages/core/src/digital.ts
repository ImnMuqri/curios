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

const ZIP_ALIASES = ['application/x-zip-compressed', 'application/x-zip'];

/**
 * The type a file is stored and sent as, or null when it is not one a shop can hand over. Windows
 * browsers call a ZIP `application/x-zip-compressed` and some give no type at all, so the name
 * settles those: an empty type with a .zip or .pdf name is that type.
 */
export function digitalFileType(name: string, type: string): string | null {
  let bare = type.split(';')[0]?.trim().toLowerCase() ?? '';
  if (ZIP_ALIASES.includes(bare)) bare = 'application/zip';
  if (bare === '') {
    const ext = /\.([A-Za-z0-9]{1,5})$/.exec(name)?.[1]?.toLowerCase();
    bare = ext === 'zip' ? 'application/zip' : ext === 'pdf' ? 'application/pdf' : '';
  }
  if (bare === '') return null;
  const ok = DIGITAL_FILE_TYPES.some((t) => (t.endsWith('/*') ? bare.startsWith(t.slice(0, -1)) && bare.length > t.length - 1 : bare === t));
  return ok ? bare : null;
}

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

export type DigitalDelivery = 'FILES' | 'LINK' | 'CODES' | 'SESSION';

/** What a visitor sees of one session time: never the booked count, only what is left. */
export interface PublicSession {
  id: string;
  /** An ISO instant: the same text on the server render and in an API reply. */
  startsAt: string;
  seatsLeft: number;
}

/** How a digital item's files read in a line: their types (upper-case extensions) and how many. */
export interface DigitalFormat {
  kinds: string[];
  count: number;
}

export interface DigitalFacts {
  kind: ItemKind;
  delivery: DigitalDelivery | null;
  /** FILES items only: null for everything else, and for FILES with no file yet. */
  format: DigitalFormat | null;
  /** Not orderable: no file, no link, no code left, or no coming time with a seat. */
  soldOut: boolean;
  /** SESSION items only: the times still to come, full ones included (seatsLeft 0). */
  sessions: PublicSession[];
  /** SESSION items only: how long it runs and where (the place's address or meeting link is never public). */
  minutes: number | null;
  place: 'ONLINE' | 'IN_PERSON' | null;
}

/** The unused codes, files, link and times of one item, as the shop reads them. */
export interface DigitalStock {
  kind: ItemKind;
  delivery: DigitalDelivery | null;
  accessUrl: string | null;
  sessionMinutes?: number | null;
  sessionPlace?: 'ONLINE' | 'IN_PERSON' | null;
  files: { name: string; contentType: string }[];
  codesLeft: number;
  /** Every time with the seats already booked; past ones are dropped here. */
  sessions: { id: string; startsAt: Date; seats: number; booked: number }[];
}

const TYPE_KIND: [RegExp, string][] = [
  [/^application\/pdf$/, 'PDF'],
  [/^application\/zip$/, 'ZIP'],
  [/^image\//, 'IMAGE'],
  [/^audio\//, 'AUDIO'],
  [/^video\//, 'VIDEO'],
];

/** "PDF" from `guide.pdf`; the content type's family when the name has no usable extension. */
export function fileKind(file: { name: string; contentType: string }): string {
  const ext = /\.([A-Za-z0-9]{1,5})$/.exec(file.name)?.[1];
  if (ext) return ext.toUpperCase();
  return TYPE_KIND.find(([re]) => re.test(file.contentType))?.[1] ?? 'FILE';
}

/** Whether a digital item can be bought right now, and what the shop shows of it. */
export function digitalFacts(stock: DigitalStock, now: Date): DigitalFacts {
  if (stock.kind !== 'DIGITAL') return { kind: 'PHYSICAL', delivery: null, format: null, soldOut: false, sessions: [], minutes: null, place: null };
  const sessions =
    stock.delivery === 'SESSION'
      ? stock.sessions
          .filter((s) => s.startsAt.getTime() > now.getTime())
          .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
          .map((s) => ({ id: s.id, startsAt: s.startsAt.toISOString(), seatsLeft: seatsLeft(s, s.booked) }))
      : [];
  const soldOut =
    stock.delivery === 'FILES'
      ? stock.files.length === 0
      : stock.delivery === 'LINK'
        ? !stock.accessUrl
        : stock.delivery === 'CODES'
          ? stock.codesLeft <= 0
          : stock.delivery === 'SESSION'
            ? !sessions.some((s) => s.seatsLeft > 0)
            : true;
  const format =
    stock.delivery === 'FILES' && stock.files.length > 0
      ? { kinds: [...new Set(stock.files.map(fileKind))].slice(0, 3), count: stock.files.length }
      : null;
  const session = stock.delivery === 'SESSION';
  return {
    kind: 'DIGITAL',
    delivery: stock.delivery,
    format,
    soldOut,
    sessions,
    minutes: session ? (stock.sessionMinutes ?? null) : null,
    place: session ? (stock.sessionPlace ?? null) : null,
  };
}

/** The facts of an item that is not digital. */
export const PHYSICAL_FACTS: DigitalFacts = { kind: 'PHYSICAL', delivery: null, format: null, soldOut: false, sessions: [], minutes: null, place: null };
