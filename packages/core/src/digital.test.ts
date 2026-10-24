import { describe, expect, it } from 'vitest';
import { isDigitalOnly, parseCodes, seatsLeft } from './digital.js';

describe('parseCodes', () => {
  it('trims, drops blanks and duplicates, keeps order', () => {
    expect(parseCodes(' A1 \n\nA1\nB2 ')).toEqual(['A1', 'B2']);
  });
  it('handles Windows line endings and empty input', () => {
    expect(parseCodes('X\r\nY\r\n')).toEqual(['X', 'Y']);
    expect(parseCodes('  \n ')).toEqual([]);
  });
});

describe('isDigitalOnly', () => {
  it('is true only when every line is digital', () => {
    expect(isDigitalOnly([{ kind: 'DIGITAL' }, { kind: 'DIGITAL' }])).toBe(true);
    expect(isDigitalOnly([{ kind: 'DIGITAL' }, { kind: 'PHYSICAL' }])).toBe(false);
  });
  it('is false for no lines', () => {
    expect(isDigitalOnly([])).toBe(false);
  });
});

describe('seatsLeft', () => {
  it('counts down and stops at zero', () => {
    expect(seatsLeft({ seats: 10 }, 3)).toBe(7);
    expect(seatsLeft({ seats: 10 }, 10)).toBe(0);
    expect(seatsLeft({ seats: 10 }, 12)).toBe(0);
  });
});
