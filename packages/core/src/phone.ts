/**
 * Malaysian mobile numbers, in the spellings people actually type.
 *
 * One stored form, because the 24-hour dedupe is a string comparison: if
 * 012-345 6789 and +60123456789 stored differently, the same person captured
 * twice in an hour would look like two leads, and a lead count an owner cannot
 * trust makes every other number on their dashboard suspect too.
 *
 * Mobile only. A Malaysian mobile is 01X followed by 7 or 8 more digits; 03
 * and the other fixed-line prefixes are refused, because a lead nobody can
 * WhatsApp is not a lead this product can act on.
 */
export function normalizeMalaysianPhone(raw: string): string | null {
  const digits = raw.replace(/[\s\-()]/g, '');

  // Refused outright rather than stripped down to its digits: a number with a
  // payload stapled to it is not a typo, and quietly salvaging one is how a
  // field that looks validated stops being.
  if (!/^\+?\d+$/.test(digits)) return null;

  let national: string;
  if (digits.startsWith('+60')) national = digits.slice(3);
  else if (digits.startsWith('60')) national = digits.slice(2);
  else if (digits.startsWith('0')) national = digits.slice(1);
  else return null;

  // 1 followed by 8 or 9 more digits: 12-3456789 is the common form, and an
  // 011 number carries one extra.
  if (!/^1\d{8,9}$/.test(national)) return null;

  return `+60${national}`;
}

/**
 * A stored number the way people write it: +60 12-781 4402, and for an 011
 * number +60 11-2345 6789. Anything that is not a stored Malaysian mobile
 * comes back as it was, rather than half-formatted.
 */
export function formatMalaysianPhone(e164: string): string {
  const match = /^\+60(1\d)(\d{3,4})(\d{4})$/.exec(e164);
  if (!match) return e164;
  const [, prefix, middle, last] = match;
  return `+60 ${prefix}-${middle} ${last}`;
}

/** What a contact detail is replaced with in stored wording. */
export const REMOVED = '[removed]';

/**
 * A visitor's wording with any email address and any phone-shaped number blanked out, for what is
 * kept as the page's own statistics (a question's wording, a topic's title -- which an FAQ page can
 * show). A phone-shaped number is nine to fifteen digits, spaced or dashed or bracketed however:
 * every Malaysian number, landline or mobile, with or without +60, and bank account numbers too.
 * Prices, dates and order numbers are shorter and stay.
 */
export function withoutContactDetails(text: string): string {
  return text
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, REMOVED)
    .replace(/[+(]?\d(?:[\s\-().]*\d){8,14}/g, REMOVED);
}
