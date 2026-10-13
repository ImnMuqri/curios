import { describe, expect, it } from 'vitest';
import { HERO_TIMELINE, PAID_TIMELINE, captionAt, heroAsked, paidStepAt } from './timeline.js';

describe('the hero timeline', () => {
  it('runs its acts in order', () => {
    const t = HERO_TIMELINE;
    expect(t.bubblesFrom).toBeLessThan(t.bubblesTo);
    expect(t.bubblesTo).toBeLessThanOrEqual(t.flyFrom);
    expect(t.flyFrom).toBeLessThan(t.flyTo);
    expect(t.flyTo).toBeLessThanOrEqual(t.answerFrom);
    expect(t.answerTo).toBeLessThanOrEqual(1);
  });
  it('counts nobody before the bubbles fly, all forty exactly when they land, and never goes back', () => {
    expect(heroAsked(HERO_TIMELINE.flyFrom - 0.01, 40)).toBe(0);
    expect(heroAsked(HERO_TIMELINE.flyTo, 40)).toBe(40);
    expect(heroAsked(1, 40)).toBe(40);
    let last = 0;
    for (let p = 0; p <= 1; p += 0.01) {
      const n = heroAsked(p, 40);
      expect(n).toBeGreaterThanOrEqual(last);
      last = n;
    }
  });
  it('shows caption 1, then 2, then 3', () => {
    const c = HERO_TIMELINE.captions;
    expect(captionAt(0, c)).toBe(0);
    expect(captionAt(0.3, c)).toBe(1);
    expect(captionAt(0.9, c)).toBe(2);
    expect(captionAt(1, c)).toBe(2);
  });
});

describe('the paid timeline', () => {
  it('has five steps, in order, and every progress maps to one', () => {
    expect(PAID_TIMELINE.steps).toHaveLength(5);
    expect(paidStepAt(0)).toBe(1);
    expect(paidStepAt(0.5)).toBe(3);
    expect(paidStepAt(0.99)).toBe(5);
    expect(paidStepAt(1)).toBe(5);
  });
  // Review Focus 1: a section reached part-way is in the right step at once.
  it('clamps progress outside 0..1', () => {
    expect(paidStepAt(-1)).toBe(1);
    expect(paidStepAt(2)).toBe(5);
    expect(captionAt(-1, HERO_TIMELINE.captions)).toBe(0);
  });
});
