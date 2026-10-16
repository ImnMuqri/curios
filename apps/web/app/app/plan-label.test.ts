import { describe, expect, it } from 'vitest';
import { planLabel } from './plan-label.js';

const now = new Date('2026-10-16T00:00:00Z');
const later = new Date('2026-11-16T00:00:00Z');
const earlier = new Date('2026-09-16T00:00:00Z');

describe('planLabel', () => {
  it.each([
    ['a personal page', { mode: 'PERSONAL', paidUntil: null, leadsCaptured: 0 }, 'Personal page'],
    ['a paid business page', { mode: 'BUSINESS', paidUntil: later, leadsCaptured: 9 }, 'Business plan'],
    ['a business page on its trial', { mode: 'BUSINESS', paidUntil: null, leadsCaptured: 1 }, 'Free trial'],
    ['a spent trial', { mode: 'BUSINESS', paidUntil: null, leadsCaptured: 3 }, 'Free trial'],
    ['a lapsed plan', { mode: 'BUSINESS', paidUntil: earlier, leadsCaptured: 3 }, 'Plan ended'],
    ['a lapsed plan with free leads left', { mode: 'BUSINESS', paidUntil: earlier, leadsCaptured: 0 }, 'Plan ended'],
  ] as const)('names %s', (_, input, label) => {
    expect(planLabel({ ...input, now })).toBe(label);
  });
});
