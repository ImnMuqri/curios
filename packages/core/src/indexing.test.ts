import { describe, expect, it } from 'vitest';
import { shouldIndex } from './indexing.js';

describe('shouldIndex', () => {
  it('indexes a business page', () => {
    expect(shouldIndex({ mode: 'BUSINESS', allowSearchIndexing: false })).toBe(true);
  });

  it('indexes a business page whatever its personal-page setting says', () => {
    // The column means "if this page is personal, index it". A business page
    // that once set it, or never did, is indexed the same.
    expect(shouldIndex({ mode: 'BUSINESS', allowSearchIndexing: true })).toBe(true);
  });

  it('keeps a personal page out of search results by default', () => {
    // README's Personal privacy decision: most people do not want an AI page
    // about themselves ranking for their own name.
    expect(shouldIndex({ mode: 'PERSONAL', allowSearchIndexing: false })).toBe(false);
  });

  it('indexes a personal page whose owner opted in', () => {
    expect(shouldIndex({ mode: 'PERSONAL', allowSearchIndexing: true })).toBe(true);
  });
});
