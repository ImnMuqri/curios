import { describe, expect, it } from 'vitest';
import { amountsIn, numbersIn, REPLY_FALLBACK, replyGuard } from './reply-guard.js';

const run = (input: { neverSay?: string[]; known?: string; visitor?: string }, pieces: string[]) => {
  const guard = replyGuard({ neverSay: input.neverSay ?? [], given: input.known ?? '', visitor: input.visitor ?? '' });
  const out = pieces.map((piece) => guard.push(piece)).join('') + guard.end();
  return { out, dropped: { ...guard.dropped }, replaced: guard.replaced };
};

describe('amountsIn and numbersIn', () => {
  it('reads an amount however it is written, as hundredths', () => {
    expect(amountsIn('RM95, RM 1,500.00, rm9.50 dan 80 ringgit')).toEqual([9500, 150000, 950, 8000]);
  });

  it('counts every number in what the visitor typed, prices or not', () => {
    expect(numbersIn('Kek butter 1kg RM95, cupcake 6 biji RM28. Deposit 50%.')).toEqual(new Set([100, 9500, 600, 2800, 5000]));
  });
});

describe('replyGuard: never-say', () => {
  it('drops the sentence that carries a never-say word and keeps the rest', () => {
    expect(run({ neverSay: ['jamin'], known: 'RM95' }, ['Saya tak boleh jamin tentang harga masa depan. Harga kek butter 1kg kami RM95.'])).toEqual({
      out: 'Harga kek butter 1kg kami RM95.',
      dropped: { 'never-say': 1, amount: 0, phone: 0 },
      replaced: false,
    });
  });

  it('catches the word however the stream splits it, in any case, inside a longer word', () => {
    expect(run({ neverSay: ['jamin'] }, ['Kek tak di', 'JAMIN', ' sampai awal. ', 'Tempah 2 hari awal.']).out).toBe('Tempah 2 hari awal.');
  });

  it('matches a phrase across a line break', () => {
    expect(run({ neverSay: ['halal certified'] }, ['Kami tak\nhalal\ncertified lagi! ', 'Tempah awal.']).out).toBe('Tempah awal.');
  });
});

describe('replyGuard: amounts', () => {
  const known = 'FACTS: Kek butter 1kg RM95, tempahan 3 hari awal. Cupcake sekotak 6 biji RM28.';

  it('drops a price the model worked out, and keeps the ones it was given', () => {
    expect(run({ known }, ['Kek butter 1kg kami RM95. Untuk 2kg, harga akan jadi RM190. ', 'Tempah 3 hari awal.'])).toEqual({
      out: 'Kek butter 1kg kami RM95. Tempah 3 hari awal.',
      dropped: { 'never-say': 0, amount: 1, phone: 0 },
      replaced: false,
    });
  });

  it('drops a total, however the amount is written', () => {
    expect(run({ known }, ['10 kotak jadi RM 280.00 semua. ', 'Sekotak RM28.']).out).toBe('Sekotak RM28.');
    expect(run({ known }, ['Semua sekali 280 ringgit. ', 'Sekotak RM28.']).out).toBe('Sekotak RM28.');
  });

  it('lets an amount the visitor typed be said back to them', () => {
    expect(run({ known, visitor: 'bajet saya 150, cukup?' }, ['Dengan RM150, boleh dapat kek butter 1kg RM95.']).out).toBe(
      'Dengan RM150, boleh dapat kek butter 1kg RM95.',
    );
  });

  it('does not let a number the page holds as something else license a price: 1kg is not RM1', () => {
    expect(run({ known }, ['Ada yang RM1. ', 'Ada yang RM3. ', 'Sekotak RM28.']).out).toBe('Sekotak RM28.');
  });

  it('treats RM95 and RM95.00 as the same amount, and leaves numbers that are not money alone', () => {
    expect(run({ known }, ['Harganya RM95.00 untuk 1kg, siap dalam 5 hari.']).out).toBe('Harganya RM95.00 untuk 1kg, siap dalam 5 hari.');
  });
});

describe('replyGuard: phone numbers', () => {
  it('never says a phone number the owner did not put out, however it is written', () => {
    expect(run({ known: 'PROFILE Instagram: iman' }, ['You can reach Iman at +60 11-2953 9716. ', 'Or email iman@example.com.'])).toEqual({
      out: 'Or email iman@example.com.',
      dropped: { 'never-say': 0, amount: 0, phone: 1 },
      replaced: false,
    });
  });

  it('says one the owner published, in a link, spelled any way', () => {
    expect(run({ known: 'PROFILE WhatsApp: Chat -- https://wa.me/601129539716' }, ['WhatsApp Iman at 011-2953 9716.']).out).toBe('WhatsApp Iman at 011-2953 9716.');
  });

  it('says back the number a visitor typed', () => {
    expect(run({ known: '', visitor: 'my number is 012-345 6789' }, ['Got it, 012-345 6789.']).out).toBe('Got it, 012-345 6789.');
  });
});

describe('replyGuard: the reply as a whole', () => {
  it('sends the fallback when every sentence was dropped, never an empty reply', () => {
    expect(run({ neverSay: ['halal'], known: 'RM95' }, ['Kek kami halal. ', '2kg jadi RM190!'])).toEqual({
      out: REPLY_FALLBACK,
      dropped: { 'never-say': 1, amount: 1, phone: 0 },
      replaced: true,
    });
  });

  it('leaves a reply that keeps both promises exactly as it was, decimals and line breaks included', () => {
    const reply = 'Cupcake RM9.50 sebiji.\n\nKedai buka Isnin hingga Sabtu, 9 pagi hingga 6 petang';
    expect(run({ neverSay: ['halal'], known: 'cupcake RM9.50' }, [reply.slice(0, 13), reply.slice(13)])).toEqual({
      out: reply,
      dropped: { 'never-say': 0, amount: 0, phone: 0 },
      replaced: false,
    });
  });
});
