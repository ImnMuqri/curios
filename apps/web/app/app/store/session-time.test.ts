import { describe, expect, it } from 'vitest';
import { timeLabel, toInstant, toMalaysia } from './session-time.js';

describe('session times, in Malaysia time', () => {
  it('sends a typed date and time with its +08:00 offset', () => {
    expect(toInstant('2026-11-07', '20:00')).toBe('2026-11-07T20:00:00+08:00');
    expect(new Date(toInstant('2026-11-07', '20:00')!).toISOString()).toBe('2026-11-07T12:00:00.000Z');
  });

  it('refuses what is not a real date and time', () => {
    expect(toInstant('', '20:00')).toBeNull();
    expect(toInstant('2026-11-07', '')).toBeNull();
    expect(toInstant('2026-02-30', '20:00')).toBeNull();
    expect(toInstant('2026-11-07', '24:00')).toBeNull();
  });

  it('shows an instant as the Malaysian wall clock, across midnight too', () => {
    expect(toMalaysia('2026-11-07T12:00:00.000Z')).toEqual({ date: '2026-11-07', time: '20:00' });
    expect(toMalaysia(new Date('2026-11-07T17:30:00Z'))).toEqual({ date: '2026-11-08', time: '01:30' });
  });

  it('writes a time the way the board does', () => {
    expect(timeLabel('2026-11-07T12:00:00Z')).toBe('Sat 7 Nov, 8:00pm');
    expect(timeLabel('2026-11-15T07:00:00Z')).toBe('Sun 15 Nov, 3:00pm');
    expect(timeLabel('2026-11-07T04:05:00Z')).toBe('Sat 7 Nov, 12:05pm');
    expect(timeLabel('2026-11-06T16:00:00Z')).toBe('Sat 7 Nov, 12:00am');
  });
});
