import { describe, expect, it } from 'vitest';
import { isPageLive, PUBLIC_PAGE_WHERE } from './visibility.js';

describe('page visibility', () => {
  it('is live only when published and not suspended', () => {
    expect(isPageLive({ published: true, suspendedAt: null })).toBe(true);
    expect(isPageLive({ published: true, suspendedAt: new Date() })).toBe(false);
    expect(isPageLive({ published: false, suspendedAt: null })).toBe(false);
    expect(isPageLive({ published: false, suspendedAt: new Date() })).toBe(false);
  });

  it('gives the same rule as a where clause', () => {
    expect(PUBLIC_PAGE_WHERE).toEqual({ published: true, suspendedAt: null });
  });
});
