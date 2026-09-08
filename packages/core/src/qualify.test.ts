import { describe, expect, it } from 'vitest';
import { MIN_VISITOR_TURNS, qualifies } from './qualify.js';

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
