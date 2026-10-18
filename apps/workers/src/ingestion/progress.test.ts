import { describe, expect, it } from 'vitest';
import { completedPart, nextProgress, progressAt, PROGRESS_FETCHED, PROGRESS_READ } from './progress.js';

describe('completedPart', () => {
  it('is everything before the last separator, and nothing before the first', () => {
    expect(completedPart('category: PRICE\nKek RM95')).toBe('');
    expect(completedPart('category: PRICE\nKek RM95\n---\ncategory: HOU')).toBe('category: PRICE\nKek RM95\n');
    expect(completedPart('a\n---\nb\n---\nc')).toBe('a\n---\nb\n');
  });
});

describe('progressAt', () => {
  const source = 'Kek Lina, homemade cakes.\nKek Batik RM45 a box.\nClosed on   Sundays.';

  it('places an excerpt in its source, whatever its spacing or case', () => {
    expect(progressAt(source, 'closed on sundays.')).toBe(PROGRESS_READ);
    const early = progressAt(source, 'Kek Lina, homemade cakes.');
    expect(early).toBeGreaterThan(PROGRESS_FETCHED);
    expect(early).toBeLessThan(50);
  });

  it('says nothing for an excerpt it cannot find', () => {
    expect(progressAt(source, 'Delivery to Klang RM10')).toBeNull();
    expect(progressAt(source, null)).toBeNull();
  });
});

describe('nextProgress', () => {
  it('never goes back, and still moves when a quote cannot be placed', () => {
    expect(nextProgress(60, 30)).toBe(60);
    expect(nextProgress(60, 80)).toBe(80);
    expect(nextProgress(60, null)).toBe(63);
    expect(nextProgress(PROGRESS_READ, null)).toBe(PROGRESS_READ);
  });
});
