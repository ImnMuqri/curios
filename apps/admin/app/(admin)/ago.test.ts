import { describe, expect, it } from 'vitest';
import { ago } from './ago.js';

const NOW = new Date('2026-10-27T04:00:00Z');
const before = (ms: number) => new Date(NOW.getTime() - ms);

describe('ago', () => {
  it('counts minutes, then hours, then days', () => {
    expect(ago(before(20_000), NOW)).toBe('just now');
    expect(ago(before(12 * 60_000), NOW)).toBe('12 min ago');
    expect(ago(before(60 * 60_000), NOW)).toBe('1h ago');
    expect(ago(before(5 * 3_600_000), NOW)).toBe('5h ago');
    expect(ago(before(30 * 3_600_000), NOW)).toBe('yesterday');
    expect(ago(before(3 * 86_400_000), NOW)).toBe('3 days ago');
  });
});
