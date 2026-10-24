import { ACCESS_NOTE_MAX } from '@curios/core/digital';
import type { Delivery, DigitalFields, EditorItem } from './store-types.js';

/** What the owner has typed for a digital item, before it is judged. */
export type DigitalDraft = {
  kind: 'PHYSICAL' | 'DIGITAL';
  delivery: Delivery;
  link: string;
  note: string;
  /** "90 minutes", as typed. */
  minutes: string;
  place: 'ONLINE' | 'IN_PERSON';
  /** The meeting link, for an online class. */
  meet: string;
  /** The address, for one in person. */
  venue: string;
};

export function digitalDraftOf(item: EditorItem | null): DigitalDraft {
  const place = item?.sessionPlace ?? 'ONLINE';
  return {
    kind: item?.kind ?? 'PHYSICAL',
    delivery: item?.delivery ?? 'FILES',
    link: item?.accessUrl ?? '',
    note: item?.accessNote ?? '',
    minutes: item?.sessionMinutes ? `${item.sessionMinutes} minutes` : '',
    place,
    meet: place === 'ONLINE' ? (item?.sessionWhere ?? '') : '',
    venue: place === 'IN_PERSON' ? (item?.sessionWhere ?? '') : '',
  };
}

/** "90" or "90 minutes" as 90; null for anything else. */
export function parseMinutes(text: string): number | null {
  const match = /^\s*(\d{1,4})\s*(?:m|min|mins|minute|minutes)?\s*$/i.exec(text);
  if (!match) return null;
  const minutes = Number(match[1]);
  return minutes >= 1 && minutes <= 1440 ? minutes : null;
}

export const LINK_SENTENCE = 'The link they get has to start with https://, like https://youtu.be/abc.';
export const MINUTES_SENTENCE = 'Say how long it runs in minutes, like 90 minutes.';

/** The fields the API takes, or the first thing wrong, in the order the owner reads them. */
export function checkDigital(draft: DigitalDraft): { fields: DigitalFields } | { error: string } {
  if (draft.kind === 'PHYSICAL') return { fields: { kind: 'PHYSICAL' } };
  if (draft.delivery === 'FILES' || draft.delivery === 'CODES') return { fields: { kind: 'DIGITAL', delivery: draft.delivery } };
  if (draft.delivery === 'LINK') {
    const link = draft.link.trim();
    let valid = false;
    try {
      valid = new URL(link).protocol === 'https:';
    } catch {
      valid = false;
    }
    if (!valid) return { error: LINK_SENTENCE };
    if ([...draft.note].length > ACCESS_NOTE_MAX) return { error: `The note is up to ${ACCESS_NOTE_MAX} characters.` };
    return { fields: { kind: 'DIGITAL', delivery: 'LINK', accessUrl: link, accessNote: draft.note.trim() || null } };
  }
  const minutes = parseMinutes(draft.minutes);
  if (minutes === null) return { error: MINUTES_SENTENCE };
  const where = (draft.place === 'ONLINE' ? draft.meet : draft.venue).trim();
  if (where === '') return { error: draft.place === 'ONLINE' ? 'Add the meeting link buyers get after they pay.' : 'Add where it is, so buyers know after they pay.' };
  return { fields: { kind: 'DIGITAL', delivery: 'SESSION', sessionMinutes: minutes, sessionPlace: draft.place, sessionWhere: where } };
}
