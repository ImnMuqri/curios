import { describe, expect, it } from 'vitest';
import { contextAround } from './excerpt.js';

describe('contextAround', () => {
  it('takes what the page says just before and just after, as the board shows it', () => {
    const source = 'Kek Coklat Moist. 1kg RM95, 2kg RM170. Order 2 days ahead.';
    expect(contextAround(source, '1kg RM95, 2kg RM170')).toEqual({ before: 'Kek Coklat Moist. ', after: '. Order 2 days ahead.' });
  });

  it('stops at a line break, and finds the excerpt whatever its spacing or case', () => {
    const source = 'Menu\nKek Batik   RM45 a box\nCookies RM25';
    expect(contextAround(source, 'kek batik rm45')).toEqual({ before: '', after: ' a box' });
  });

  it('does not cut a word in half when the sentence runs past its reach', () => {
    const long = `${'word '.repeat(40)}Kek RM95 ${'more '.repeat(40)}`;
    const found = contextAround(long, 'Kek RM95');
    expect(found?.before.startsWith('word')).toBe(true);
    expect(found?.after.endsWith('more')).toBe(true);
  });

  it('says nothing for an excerpt that is not in the source as written', () => {
    expect(contextAround('Kek Batik RM45', 'Batik cake is RM45')).toBeNull();
    expect(contextAround('Kek Batik RM45', null)).toBeNull();
  });
});

describe('contextAround, in text read as one run', () => {
  it('stops at the sentence either side, as the board shows one', () => {
    const run = 'Kek Lina, homemade cakes in Shah Alam. Kek Coklat Moist: 1kg RM95, 2kg RM170. Kek Batik RM45 a box. Cookies balang RM25.';
    expect(contextAround(run, 'Kek Batik RM45 a box.')).toEqual({ before: 'Kek Coklat Moist: 1kg RM95, 2kg RM170. ', after: ' Cookies balang RM25.' });
    expect(contextAround(run, 'Kek Lina, homemade cakes in Shah Alam.')).toEqual({ before: '', after: ' Kek Coklat Moist: 1kg RM95, 2kg RM170.' });
  });
});
