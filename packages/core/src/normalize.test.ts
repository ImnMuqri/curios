import { describe, expect, it } from 'vitest';
import { normalizeClaim } from './normalize.js';

describe('normalizeClaim', () => {
  it('lowercases', () => {
    expect(normalizeClaim('Kek Butter')).toBe('kek butter');
  });

  it('collapses runs of whitespace including newlines and tabs', () => {
    expect(normalizeClaim('kek   butter\n\t1kg')).toBe('kek butter 1kg');
  });

  it('trims leading and trailing whitespace', () => {
    expect(normalizeClaim('  kek butter  ')).toBe('kek butter');
  });

  it('strips punctuation but keeps digits and letters', () => {
    expect(normalizeClaim('Kek 1kg butter — RM95!')).toBe('kek 1kg butter rm95');
  });

  it('applies NFKC so full-width and composed forms collapse', () => {
    expect(normalizeClaim('ＲＭ９５')).toBe('rm95');
  });

  it('treats differing punctuation and case as the same claim', () => {
    expect(normalizeClaim('Buka hari Ahad?')).toBe(normalizeClaim('buka hari ahad'));
  });

  it('keeps distinct claims distinct', () => {
    expect(normalizeClaim('Kek 1kg RM95')).not.toBe(normalizeClaim('Kek 2kg RM95'));
  });

  it('returns an empty string for input that is only punctuation', () => {
    expect(normalizeClaim('!!! ---')).toBe('');
  });
});
