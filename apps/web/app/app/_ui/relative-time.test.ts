import { describe, expect, it } from 'vitest';
import { relativeTime } from './relative-time.js';

// Friday 17 October 2026, 2pm in Kuala Lumpur.
const now = new Date('2026-10-17T06:00:00Z');
const ago = (ms: number) => new Date(now.getTime() - ms);
const MIN = 60 * 1000;
const HOUR = 60 * MIN;

describe('relativeTime', () => {
  it('says how long ago, the way the board does', () => {
    expect(relativeTime(ago(20 * 1000), now)).toBe('just now');
    expect(relativeTime(ago(12 * MIN), now)).toBe('12 min ago');
    expect(relativeTime(ago(3 * HOUR), now)).toBe('3h ago');
  });

  it('counts days in Malaysia, not hours', () => {
    // 11pm the night before, in Kuala Lumpur: 15 hours ago, but yesterday.
    expect(relativeTime(new Date('2026-10-16T15:00:00Z'), now)).toBe('yesterday');
  });

  it('names the weekday within a week, and the date after', () => {
    expect(relativeTime(new Date('2026-10-13T03:00:00Z'), now)).toBe('Tue');
    expect(relativeTime(new Date('2026-10-03T03:00:00Z'), now)).toBe('3 Oct');
  });
});
