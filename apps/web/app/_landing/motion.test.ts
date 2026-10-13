import { afterEach, describe, expect, it, vi } from 'vitest';
import { prefersReducedMotion } from './motion.js';

const stub = (matches: boolean) =>
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({ matches, media: query, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }));

afterEach(() => vi.restoreAllMocks());

describe('prefersReducedMotion', () => {
  it('reads the media query', () => {
    stub(true);
    expect(prefersReducedMotion()).toBe(true);
    stub(false);
    expect(prefersReducedMotion()).toBe(false);
  });
});
