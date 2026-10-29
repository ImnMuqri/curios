import { describe, expect, it } from 'vitest';
import { FREE_LEADS } from '@curios/core';
import { planBlock, planLabel } from './plan-label.js';

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
    expect(planLabel({ ...input, now }, FREE_LEADS)).toBe(label);
  });
});

describe('planBlock', () => {
  it('counts a paid plan down in days, its bar out of a month', () => {
    const until = new Date('2026-11-03T00:00:00Z');
    expect(planBlock({ mode: 'BUSINESS', paidUntil: until, leadsCaptured: 9, now }, FREE_LEADS)).toEqual({ name: 'Business plan', note: '18 days left, until 3 Nov', fill: 0.6, glance: 'Business · paid until 3 Nov' });
  });

  it('fills a year-long plan to the brim until its last month', () => {
    expect(planBlock({ mode: 'BUSINESS', paidUntil: new Date('2027-06-01T00:00:00Z'), leadsCaptured: 0, now }, FREE_LEADS).fill).toBe(1);
  });

  it('counts the free leads left on a trial, and an empty bar once they are spent', () => {
    expect(planBlock({ mode: 'BUSINESS', paidUntil: null, leadsCaptured: 1, now }, 3)).toEqual({ name: 'Free trial', note: '2 of 3 free leads left', fill: 2 / 3, glance: 'Free trial · 2 of 3 free leads left' });
    expect(planBlock({ mode: 'BUSINESS', paidUntil: null, leadsCaptured: 3, now }, 3)).toEqual({ name: 'Free trial', note: 'Free leads used up', fill: 0, glance: 'Free trial · free leads used up' });
  });

  it('says when an ended plan ended', () => {
    expect(planBlock({ mode: 'BUSINESS', paidUntil: earlier, leadsCaptured: 3, now }, 3).note).toMatch(/^Ended 16 Sep/);
  });

  it('gives a personal page no bar', () => {
    expect(planBlock({ mode: 'PERSONAL', paidUntil: null, leadsCaptured: 0, now }, 3)).toEqual({ name: 'Personal page', note: 'Free, always', fill: null, glance: 'Personal page · free, always' });
  });
});
