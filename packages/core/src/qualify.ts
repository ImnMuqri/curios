import { phoneNumbersIn } from './phone.js';

/** BACKEND.md's `turn_3`. Two turns is still browsing. */
export const MIN_VISITOR_TURNS = 3;

/**
 * A standalone number: a quantity, a count, a date. BACKEND.md calls this
 * `own_specifics`, and "own" is the load-bearing word -- it is the visitor
 * stating their own requirement, not the assistant quoting a price.
 *
 * Not preceded by a letter or another digit, which is the distinction that
 * matters: "2kg" is a quantity and "b2b" is a word with a digit in it. Guarding
 * only against adjacent digits lets "b2b" through -- found by the test, not by
 * reading. A bare \d anywhere would qualify almost any message, which is
 * exactly the inflated lead count this rule exists to avoid.
 */
const SPECIFIC = /(?<![A-Za-z\d])\d+/;

/**
 * A visitor asking to leave their number or to be contacted, in English, Malay or a mix of both:
 * "can I leave my number", "contact me", "boleh tinggal nombor", "hubungi saya", "wasap saya".
 * Matched loosely on purpose: the card it brings is one tap to ignore.
 */
const WANTS_CONTACT = [
  /\b(leave|left|give|share|drop|send)\b[^.?!]{0,24}\b(number|no\.?|phone|contact|whats ?app|wa)\b/i,
  /\b(call|contact|whats ?app|text|reach)\s+me\b/i,
  /\b(tinggal(kan)?|bagi|beri|kasi|hantar|letak|ambil)\b[^.?!]{0,24}\b(nombor|no\.?|nombor telefon|fon|telefon|whats ?app|wasap|wa)\b/i,
  /\b(hubungi|call|wasap|whats ?app|telefon)\s+(saya|aku)\b/i,
];

/** The visitor wants to be contacted: they asked to be, or typed their own phone number. */
export function wantsContact(message: string): boolean {
  return phoneNumbersIn(message).length > 0 || WANTS_CONTACT.some((pattern) => pattern.test(message));
}

/**
 * Whether the capture card may be offered.
 *
 * Deterministic, and deliberately so. BACKEND.md originally specified a model
 * returning a confidence score; why that changed is argued in
 * devDocs/slice-4-build-spec.md, and the shortest version is that "be
 * conservative" is a requirement you can tune and unit-test in a function and
 * cannot in a 0.81.
 *
 * Under-capturing is the intended failure direction. A card shown to somebody
 * checking opening hours costs the owner's trust in every number on their
 * dashboard; a card not shown to a real lead costs one lead, and slice 5's
 * Questions dashboard is the named mechanism for finding those.
 *
 * `visitorMessages` is the visitor's side only. The caller does that filtering
 * because only the caller knows which rows are whose.
 */
export function qualifies(input: {
  mode: 'PERSONAL' | 'BUSINESS';
  visitorMessages: string[];
}): boolean {
  if (input.mode !== 'BUSINESS') return false;
  // Asking to be contacted is the plainest intent there is: no waiting for a third turn.
  if (input.visitorMessages.some(wantsContact)) return true;
  if (input.visitorMessages.length < MIN_VISITOR_TURNS) return false;
  return input.visitorMessages.some((message) => SPECIFIC.test(message));
}
