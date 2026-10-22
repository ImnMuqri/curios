import { describe, expect, it } from 'vitest';
import { itemSlug } from './slug.js';

describe('itemSlug', () => {
  it('makes a lowercase hyphenated ASCII slug from a name', () => {
    expect(itemSlug('Kek Batik Premium', new Set())).toBe('kek-batik-premium');
    expect(itemSlug('  Nasi   Lemak!! (Large) ', new Set())).toBe('nasi-lemak-large');
  });

  it('strips accents and falls back to "item" when nothing ASCII survives', () => {
    expect(itemSlug('Crème brûlée', new Set())).toBe('creme-brulee');
    expect(itemSlug('红豆糕', new Set())).toBe('item');
    expect(itemSlug('!!!', new Set())).toBe('item');
  });

  it('keeps the ASCII part of a mixed Chinese and Latin name', () => {
    expect(itemSlug('红豆糕 Red Bean', new Set())).toBe('red-bean');
  });

  it('adds -2, -3 when the slug is taken', () => {
    expect(itemSlug('Kek Batik', new Set(['kek-batik']))).toBe('kek-batik-2');
    expect(itemSlug('Kek Batik', new Set(['kek-batik', 'kek-batik-2']))).toBe('kek-batik-3');
    expect(itemSlug('红豆糕', new Set(['item']))).toBe('item-2');
  });

  it('keeps slugs a sane length', () => {
    expect(itemSlug('a'.repeat(200), new Set()).length).toBeLessThanOrEqual(60);
  });
});
