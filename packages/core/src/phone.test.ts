import { describe, expect, it } from 'vitest';
import { normalizeMalaysianPhone } from './phone.js';

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
