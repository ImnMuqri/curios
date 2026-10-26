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

/**
 * A run of digits, spaced, dashed or bracketed however, long enough to be a phone number. Whether
 * it is one is `phoneKey`'s call.
 */
const PHONE_CANDIDATE = /\+?\(?\d(?:[\s\-().]*\d){7,14}/g;

/**
 * A phone number's digits without its country code or trunk zero -- "+60 11-2953 9716",
 * "011-29539716" and "wa.me/601129539716" are all "1129539716" -- or null when the candidate is
 * not a phone number. A phone number is Malaysian (60 or 0, then 8 to 10 digits) or any number
 * written with a +. A price, a date, a postcode or a bank account is none of these.
 */
function phoneKey(candidate: string): string | null {
  const digits = candidate.replace(/\D/g, '');
  if (candidate.trimStart().startsWith('+') && digits.length >= 8 && digits.length <= 15) {
    return digits.startsWith('60') ? digits.slice(2) : digits;
  }
  if (/^60\d{8,10}$/.test(digits)) return digits.slice(2);
  if (/^0\d{8,10}$/.test(digits)) return digits.slice(1);
  return null;
}

/** Every phone number in `text`, as `phoneKey` gives them, so two spellings of one number match. */
export function phoneNumbersIn(text: string): string[] {
  return [...text.matchAll(PHONE_CANDIDATE)].flatMap((m) => {
    const key = phoneKey(m[0]);
    return key ? [key] : [];
  });
}

/** The text with every phone number in it replaced. An email or any other number is left alone. */
export function withoutPhoneNumbers(text: string, replacement = REMOVED): string {
  return text.replace(PHONE_CANDIDATE, (m) => (phoneKey(m) ? replacement : m));
}
