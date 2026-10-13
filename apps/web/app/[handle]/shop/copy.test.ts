import { describe, expect, it } from 'vitest';
import { shopCopy } from './copy.js';

describe('shopCopy', () => {
  it('speaks Malay on a Malay page and English otherwise', () => {
    expect(shopCopy('ms').visit).toBe('Lawati kedai');
    expect(shopCopy('en').visit).toBe('Visit shop');
    expect(shopCopy('fr').visit).toBe('Visit shop');
  });
  it('counts items in each language', () => {
    expect(shopCopy('en').itemCount(1)).toBe('1 item');
    expect(shopCopy('en').itemCount(8)).toBe('8 items');
    expect(shopCopy('ms').itemCount(8)).toBe('8 barang');
  });
});
