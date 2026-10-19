import { describe, expect, it } from 'vitest';
import { unsureFilter } from './unsure.js';

const run = (pieces: string[]) => {
  const filter = unsureFilter();
  const out = pieces.map((piece) => filter.push(piece)).join('') + filter.end();
  return { out, unsure: filter.unsure };
};

describe('unsureFilter', () => {
  it('passes an answer through untouched', () => {
    expect(run(['Kek butter ', '1kg RM95.'])).toEqual({ out: 'Kek butter 1kg RM95.', unsure: false });
  });

  it('removes the marker, however the stream splits it, and says the reply was not sure', () => {
    expect(run(['[', '?', '] Tak pasti, ', 'saya akan tanya Lina.'])).toEqual({ out: 'Tak pasti, saya akan tanya Lina.', unsure: true });
    expect(run(['  [?]', "I'm not sure."])).toEqual({ out: "I'm not sure.", unsure: true });
  });

  it('lets go of a held-back start that turns out not to be the marker', () => {
    expect(run(['[', 'Note] RM95'])).toEqual({ out: '[Note] RM95', unsure: false });
    expect(run(['['])).toEqual({ out: '[', unsure: false });
  });
});
