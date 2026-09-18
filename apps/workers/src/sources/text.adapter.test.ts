import { describe, expect, it } from 'vitest';
import { textAdapter } from './text.adapter.js';

describe('textAdapter', () => {
  it('turns pasted text into one document with no URL', async () => {
    expect(await textAdapter.fetch('I bake cakes\n\n   in Shah Alam.')).toEqual([
      { url: null, title: 'Written by the page owner', text: 'I bake cakes in Shah Alam.' },
    ]);
  });

  it('returns nothing for text that is only whitespace', async () => {
    expect(await textAdapter.fetch('  \n\t ')).toEqual([]);
  });
});
