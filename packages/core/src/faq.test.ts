import { describe, expect, it } from 'vitest';
import { FAQ_MIN_ASKS, faqSlugBase, qualifiesForFaq, serialiseJsonLd } from './faq.js';

describe('qualifiesForFaq', () => {
  const asked = { mode: 'BUSINESS' as const, askCount: FAQ_MIN_ASKS, answered: true };

  it('accepts a business question asked enough times and answered', () => {
    expect(qualifiesForFaq(asked)).toBe(true);
  });

  it('refuses a personal page however often the question is asked', () => {
    // README's tier table: personal pages are not indexed and do not generate
    // FAQ pages, and both halves are the same privacy decision.
    expect(qualifiesForFaq({ ...asked, mode: 'PERSONAL' })).toBe(false);
  });

  it('refuses a question one ask short of the threshold', () => {
    expect(qualifiesForFaq({ ...asked, askCount: FAQ_MIN_ASKS - 1 })).toBe(false);
  });

  it('refuses a much-asked question the owner has not answered', () => {
    // The count is evidence of demand; `answered` is evidence of intent. A
    // public page carrying an answer the owner never wrote is the one failure
    // this product cannot afford.
    expect(qualifiesForFaq({ ...asked, askCount: 50, answered: false })).toBe(false);
  });
});

describe('faqSlugBase', () => {
  it('makes a readable slug from a Malay question', () => {
    expect(faqSlugBase('Berapa harga kek lapis?')).toBe('berapa-harga-kek-lapis');
  });

  it('collapses punctuation and repeated separators rather than emitting empty segments', () => {
    expect(faqSlugBase('Open   on  Sunday??  ')).toBe('open-on-sunday');
  });

  it('truncates a long question without leaving a trailing separator', () => {
    const slug = faqSlugBase(`${'panjang '.repeat(30)}soalan`);
    expect(slug!.length).toBeLessThanOrEqual(60);
    expect(slug!.endsWith('-')).toBe(false);
  });

  it('returns null when there is nothing sluggable', () => {
    // A question of pure punctuation cannot become a URL. Null rather than an
    // empty string, so the caller cannot accidentally write '' as a slug and
    // create a route that resolves to nothing.
    expect(faqSlugBase('???!!!')).toBeNull();
  });
});

describe('serialiseJsonLd', () => {
  it('leaves no character that could close the script element', () => {
    // The whole reason this function exists. The payload carries
    // owner-written answer text into a script element, and JSON.stringify
    // does not escape '<' -- it is a legal character in a JSON string.
    const json = serialiseJsonLd({ answer: '</script><img src=x onerror=alert(1)>' });
    expect(json).not.toContain('<');
  });

  it('still parses back to exactly the original payload', () => {
    // The escape must be transparent: consumers read the owner's real text.
    const payload = { answer: '</script> a < b' };
    expect(JSON.parse(serialiseJsonLd(payload))).toEqual(payload);
  });
});
