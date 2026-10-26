import { describe, expect, it } from 'vitest';
import { NEVER_SAY_FALLBACK, neverSayFilter } from './never-say-filter.js';

const run = (phrases: string[], pieces: string[]) => {
  const filter = neverSayFilter(phrases);
  const out = pieces.map((piece) => filter.push(piece)).join('') + filter.end();
  return { out, dropped: filter.dropped, replaced: filter.replaced };
};

describe('neverSayFilter', () => {
  it('drops the sentence that carries a never-say word and keeps the rest', () => {
    expect(run(['jamin'], ['Saya tak boleh jamin tentang harga masa depan. Harga kek butter 1kg kami RM95.'])).toEqual({
      out: 'Harga kek butter 1kg kami RM95.',
      dropped: 1,
      replaced: false,
    });
  });

  it('catches the word however the stream splits it, in any case, inside a longer word', () => {
    expect(run(['jamin'], ['Kek tak di', 'JAMIN', ' sampai awal. ', 'Tempah 2 hari awal.'])).toEqual({
      out: 'Tempah 2 hari awal.',
      dropped: 1,
      replaced: false,
    });
  });

  it('matches a phrase across a line break', () => {
    expect(run(['halal certified'], ['Kami tak\nhalal\ncertified lagi! ', 'Kek butter RM95.']).out).toBe('Kek butter RM95.');
  });

  it('sends the fallback when every sentence was dropped, never an empty reply', () => {
    expect(run(['halal'], ['Kek kami halal. ', 'Semua bahan halal!'])).toEqual({ out: NEVER_SAY_FALLBACK, dropped: 2, replaced: true });
  });

  it('leaves a reply with no never-say word exactly as it was, decimals and line breaks included', () => {
    const reply = 'Cupcake RM9.50 sebiji.\n\nKedai buka Isnin hingga Sabtu, 9 pagi hingga 6 petang';
    expect(run(['halal'], [reply.slice(0, 13), reply.slice(13)])).toEqual({ out: reply, dropped: 0, replaced: false });
  });

  it('passes everything straight through when the page has no list', () => {
    const filter = neverSayFilter([]);
    expect(filter.push('Kek halal ')).toBe('Kek halal ');
    expect(filter.end()).toBe('');
  });
});
