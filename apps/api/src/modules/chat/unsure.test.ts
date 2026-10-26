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

  it('removes a marker the model put after answering part of the question, without making the reply unsure', () => {
    expect(run(['Ada pilihan less-sugar. Untuk lain-lain, [?] saya tanya Nadia.'])).toEqual({ out: 'Ada pilihan less-sugar. Untuk lain-lain, saya tanya Nadia.', unsure: false });
    expect(run(['Ada pilihan less-sugar. ', '[', '?', '] saya tanya Nadia.'])).toEqual({ out: 'Ada pilihan less-sugar. saya tanya Nadia.', unsure: false });
    expect(run(['[?] Tak pasti. [?] Saya tanya Nadia.'])).toEqual({ out: 'Tak pasti. Saya tanya Nadia.', unsure: true });
  });

  it('leaves brackets that are not the marker, mid-reply and at the very end', () => {
    expect(run(['Saiz [6 inci] ', 'RM85 [', 'tanya]'])).toEqual({ out: 'Saiz [6 inci] RM85 [tanya]', unsure: false });
    expect(run(['RM85 [', '?'])).toEqual({ out: 'RM85 [?', unsure: false });
  });
});
