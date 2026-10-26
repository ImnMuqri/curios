import { describe, expect, it } from 'vitest';
import { formatMalaysianPhone, normalizeMalaysianPhone, phoneNumbersIn, withoutContactDetails, withoutPhoneNumbers } from './phone.js';

describe('normalizeMalaysianPhone', () => {
  it.each([
    ['0123456789', '+60123456789', 'the way a Malaysian types their own number'],
    ['012-345 6789', '+60123456789', 'with the separators people actually use'],
    ['+60123456789', '+60123456789', 'already E.164'],
    ['60123456789', '+60123456789', 'country code, no plus'],
    ['+6012 345 6789', '+60123456789', 'E.164 with spaces'],
    ['01123456789', '+601123456789', 'an 011 number, which is one digit longer'],
  ])('reads %s as %s (%s)', (raw, expected) => {
    expect(normalizeMalaysianPhone(raw)).toBe(expected);
  });

  it.each([
    ['', 'empty'],
    ['12345', 'too short to be anything'],
    ['0323456789', 'a landline, not a mobile -- 03 is Klang Valley fixed line'],
    ['+65912345678', 'Singapore, not Malaysia'],
    ['0121234', 'a mobile prefix but too few digits'],
    ['012345678901234', 'too many digits'],
    ['abcdefghij', 'not a number at all'],
    ['+60123456789; DROP TABLE', 'a number with a payload stapled to it'],
  ])('refuses %s (%s)', (raw) => {
    expect(normalizeMalaysianPhone(raw)).toBeNull();
  });

  it('stores one form, so dedupe compares like with like', () => {
    // The 24-hour dedupe is a string comparison. If 012-345 6789 and
    // +60123456789 stored differently, the same person captured twice in an
    // hour would look like two leads, and a lead count an owner cannot trust
    // makes every other number on their dashboard suspect too.
    const spellings = ['0123456789', '012-345 6789', '+60123456789', '60123456789'];
    const stored = new Set(spellings.map(normalizeMalaysianPhone));
    expect(stored.size).toBe(1);
  });
});

describe('formatMalaysianPhone', () => {
  it('writes a stored number the way people do', () => {
    expect(formatMalaysianPhone('+60127814402')).toBe('+60 12-781 4402');
    expect(formatMalaysianPhone('+601123456789')).toBe('+60 11-2345 6789');
  });

  it('leaves anything else as it was', () => {
    expect(formatMalaysianPhone('+6512345678')).toBe('+6512345678');
    expect(formatMalaysianPhone('not a number')).toBe('not a number');
  });
});

describe('withoutContactDetails', () => {
  it.each([
    ['wasap saya 012-345 6789', 'wasap saya [removed]'],
    ['call +60 12-781 4402 tq', 'call [removed] tq'],
    ['nombor saya 0123456789.', 'nombor saya [removed].'],
    ['office (03) 7956 1234', 'office [removed]'],
    ['email aina.k@gmail.com ok?', 'email [removed] ok?'],
    ['akaun 1234 5678 9012', 'akaun [removed]'],
  ])('blanks %j', (text, expected) => {
    expect(withoutContactDetails(text)).toBe(expected);
  });

  it.each(['berapa harga kek RM 1,500?', 'boleh ambil 2026-10-26?', 'order #1234 dah siap?', 'ada saiz 8 inch?'])(
    'leaves %j as it was',
    (text) => {
      expect(withoutContactDetails(text)).toBe(text);
    },
  );
});

describe('phoneNumbersIn', () => {
  it('reads one number however it is written, links included', () => {
    expect(phoneNumbersIn('Call +601129539716, 011-2953 9716 or wa.me/601129539716')).toEqual(['1129539716', '1129539716', '1129539716']);
    expect(phoneNumbersIn('Pejabat (03) 7956 1234')).toEqual(['379561234']);
    expect(phoneNumbersIn('London +44 20 7946 0958')).toEqual(['442079460958']);
  });

  it('finds none in prices, dates, postcodes or a bank account', () => {
    expect(phoneNumbersIn('RM1,500.00 on 2026-10-26 at 40150 Shah Alam, Maybank 5140 1234 5678')).toEqual([]);
  });
});

describe('withoutPhoneNumbers', () => {
  it('removes the phone number and keeps the email beside it', () => {
    expect(withoutPhoneNumbers('Reach Iman at +601129539716 or iman@example.com.')).toBe('Reach Iman at [removed] or iman@example.com.');
  });

  it('leaves a price and a date as they were', () => {
    expect(withoutPhoneNumbers('Logo RM350, siap 7 hari, 26 Okt 2026.')).toBe('Logo RM350, siap 7 hari, 26 Okt 2026.');
  });
});
