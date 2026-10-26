import { describe, expect, it } from 'vitest';
import { MIN_VISITOR_TURNS, qualifies, wantsContact } from './qualify.js';

const specific = ['nak order kek 2kg', 'untuk 20 Mac', 'hantar ke Klang boleh?'];

describe('qualifies', () => {
  it('qualifies a business conversation with enough turns and a specific ask', () => {
    expect(qualifies({ mode: 'BUSINESS', visitorMessages: specific })).toBe(true);
  });

  it('never qualifies a personal page', () => {
    // BACKEND.md's plan matrix: capture card off for personal, on for
    // business. A personal page has no leads to capture.
    expect(qualifies({ mode: 'PERSONAL', visitorMessages: specific })).toBe(false);
  });

  it('does not qualify before the third turn', () => {
    expect(qualifies({ mode: 'BUSINESS', visitorMessages: specific.slice(0, 2) })).toBe(false);
    expect(MIN_VISITOR_TURNS).toBe(3);
  });

  it('does not qualify a conversation with no specifics in it', () => {
    // Three turns of browsing is not a lead. This is the anti-signal that
    // stops every hours-check becoming one, and BACKEND.md is explicit that an
    // inflated count costs more than a missed lead.
    expect(
      qualifies({
        mode: 'BUSINESS',
        visitorMessages: ['buka tak hari ni?', 'ada apa?', 'di mana kedai?'],
      }),
    ).toBe(false);
  });

  it.each([
    ['nak 2kg', 'a quantity'],
    ['untuk 20 Mac', 'a date'],
    ['boleh siap 3 hari?', 'a number of days'],
    ['nak 12 biji', 'a count'],
  ])('counts %s as specific (%s)', (message) => {
    expect(qualifies({ mode: 'BUSINESS', visitorMessages: ['hai', 'ada kek?', message] })).toBe(
      true,
    );
  });

  it('does not count a number that is part of a word', () => {
    // "kek2" and "b2b" are not specifics. A bare digit anywhere would make
    // almost any message qualify, which is the inflated count BACKEND.md warns
    // about.
    expect(
      qualifies({ mode: 'BUSINESS', visitorMessages: ['hai', 'ada apa', 'b2b macam mana'] }),
    ).toBe(false);
  });

  it('reads only what it is given, which is the visitor side', () => {
    // The caller passes visitor turns alone. The assistant quotes RM95 in
    // almost every answer, so a caller that passed the whole transcript would
    // qualify every conversation on the page -- this is the shape that makes
    // that mistake impossible to make quietly.
    expect(qualifies({ mode: 'BUSINESS', visitorMessages: ['hai', 'ada apa', 'ok'] })).toBe(false);
  });
});

describe('wantsContact', () => {
  it.each([
    'Can I left my number here',
    'can I leave my phone number?',
    'please contact me',
    'whatsapp me',
    'boleh tinggal nombor?',
    'saya nak bagi no wasap',
    'hubungi saya',
    'my number is 012-345 6789',
    // Asking how to reach the owner: the card comes at once, not three turns later.
    'How can I contact iman',
    'Does he have a phone number I can contact',
    'what is your phone number?',
    'contact info?',
    'how do I reach you',
    'macam mana nak hubungi kedai ni',
    'ada nombor telefon?',
  ])('hears %j', (message) => {
    expect(wantsContact(message)).toBe(true);
  });

  it.each(['berapa harga kek 2kg?', 'do you take WhatsApp orders?', 'how long does WhatsApp delivery take?', 'what time do you open?', 'no thanks'])(
    'does not hear %j',
    (message) => {
      expect(wantsContact(message)).toBe(false);
    },
  );
});

describe('qualifies, asked to be contacted', () => {
  it('offers the card at once, on the first turn, on a business page', () => {
    expect(qualifies({ mode: 'BUSINESS', visitorMessages: ['Can I left my number here'] })).toBe(true);
  });

  it('still never on a personal page', () => {
    expect(qualifies({ mode: 'PERSONAL', visitorMessages: ['please contact me'] })).toBe(false);
  });
});
