import type { SourceDocument } from '@curios/core';
import type { SourceAdapter } from './types.js';

/**
 * Text the owner pasted, as one document with no URL.
 *
 * Whitespace is collapsed the way the website adapter collapses a page's body,
 * so extraction sees pasted text and crawled text in the same shape. The title
 * tells the model where the words came from, since there is no page to name.
 * Nothing about trust changes: it is the owner's own text about their own page,
 * and every fact extracted from it goes through Review before it appears.
 */
export const textAdapter: SourceAdapter = {
  id: 'text',
  async fetch(input: string): Promise<SourceDocument[]> {
    const text = input.replace(/\s+/g, ' ').trim();
    return text === '' ? [] : [{ url: null, title: 'Written by the page owner', text }];
  },
};
