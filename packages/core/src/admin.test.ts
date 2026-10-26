import { describe, expect, it } from 'vitest';
import { ADMIN_ACTIONS, ADMIN_COOKIE, ADMIN_SESSION_TTL_MS, initials, maskPhone } from './admin.js';

describe('maskPhone', () => {
  it('keeps the country code and last two digits', () => {
    expect(maskPhone('+60123456789')).toBe('+60••••••89');
  });
  it('normalises a local number first', () => {
    expect(maskPhone('0123456789')).toBe('+60••••••89');
  });
  it('masks a non-Malaysian number generically', () => {
    expect(maskPhone('+6591234567')).toBe('+659••••••67');
    expect(maskPhone('+1 415 555 0100')).toBe('+141••••••00');
  });
});

describe('initials', () => {
  it('takes one per word', () => {
    expect(initials('Aisyah Rahman')).toBe('A. R.');
    expect(initials('lina')).toBe('L.');
    expect(initials('  ')).toBe('');
  });
});

describe('constants', () => {
  it('are fixed', () => {
    expect(ADMIN_COOKIE).toBe('curios_admin');
    expect(ADMIN_SESSION_TTL_MS).toBe(28_800_000);
    expect(Object.keys(ADMIN_ACTIONS)).toHaveLength(14);
  });
});
