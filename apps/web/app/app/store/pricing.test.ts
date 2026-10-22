import { describe, expect, it } from 'vitest';
import { CATEGORY_SENTENCE, checkFields, type PricingDraft, TAG_SENTENCE, draftOf, NAME_SENTENCE, PRICE_PARSE_SENTENCE, pricedFields, pricingOf } from './pricing.js';

describe('draftOf', () => {
  it('reads a priced item as one price, and an item with options as its options', () => {
    expect(draftOf({ priceCents: 9550, options: [] })).toMatchObject({ kind: 'single', price: '95.50' });
    const options = draftOf({ priceCents: null, options: [{ label: '1kg', priceCents: 9500 }, { label: '2kg', priceCents: 17000 }] });
    expect(options.kind).toBe('options');
    expect(options.options.map((o) => [o.label, o.price])).toEqual([['1kg', '95'], ['2kg', '170']]);
  });

  it('starts a new item with an empty price and one empty option, ready for either', () => {
    const draft = draftOf(null);
    expect(draft).toMatchObject({ kind: 'single', price: '' });
    expect(draft.options).toHaveLength(1);
  });
});

describe('pricingOf', () => {
  it('turns ringgit as typed into sen', () => {
    expect(pricingOf({ kind: 'single', price: 'RM 95.5', options: [] })).toEqual({ pricing: { kind: 'single', priceCents: 9550 } });
  });

  it('says so when a price cannot be read', () => {
    expect(pricingOf({ kind: 'single', price: 'ninety', options: [] })).toEqual({ error: PRICE_PARSE_SENTENCE });
    expect(pricingOf({ kind: 'options', price: '', options: [{ key: 1, label: '1kg', price: '' }] })).toEqual({ error: PRICE_PARSE_SENTENCE });
  });

  it('passes on the shared rules, like a zero price or an option with no name', () => {
    expect('error' in pricingOf({ kind: 'single', price: '0', options: [] })).toBe(true);
    expect('error' in pricingOf({ kind: 'options', price: '', options: [{ key: 1, label: ' ', price: '9' }] })).toBe(true);
  });
});

describe('checkFields', () => {
  it('asks for a name first, then a price', () => {
    expect(checkFields(' ', '', { kind: 'single', price: 'x', options: [] })).toEqual({ error: NAME_SENTENCE });
    expect(checkFields('Tart', '', { kind: 'single', price: 'x', options: [] })).toEqual({ error: PRICE_PARSE_SENTENCE });
  });

  it('trims what it sends, and sends no description rather than an empty one', () => {
    expect(checkFields(' Tart ', '   ', { kind: 'single', price: '9', options: [] })).toEqual({
      name: 'Tart',
      description: null,
      category: null,
      tag: null,
      pricing: { kind: 'single', priceCents: 900 },
    });
  });

  it('counts the description the way the server will, without its surrounding spaces', () => {
    expect('error' in checkFields('Tart', ` ${'x'.repeat(280)} `, { kind: 'single', price: '9', options: [] })).toBe(false);
    expect('error' in checkFields('Tart', 'x'.repeat(281), { kind: 'single', price: '9', options: [] })).toBe(true);
  });
});

describe('checkFields, category and tag', () => {
  const single: PricingDraft = { kind: 'single', price: '9', options: [] };

  it('trims them and sends null for blank', () => {
    expect(checkFields('Tart', '', single, { category: ' Kuih  raya ', tag: ' New ' })).toMatchObject({ category: 'Kuih raya', tag: 'New' });
    expect(checkFields('Tart', '', single, { category: '  ', tag: '' })).toMatchObject({ category: null, tag: null });
  });

  it('refuses a tag over 20 characters with a sentence, and allows exactly 20', () => {
    expect(checkFields('Tart', '', single, { category: '', tag: 'x'.repeat(21) })).toEqual({ error: TAG_SENTENCE });
    expect('error' in checkFields('Tart', '', single, { category: '', tag: 'x'.repeat(20) })).toBe(false);
    expect(checkFields('Tart', '', single, { category: 'x'.repeat(31), tag: '' })).toEqual({ error: CATEGORY_SENTENCE });
  });
});

describe('pricedFields', () => {
  it('lays a pricing out as the item holds it', () => {
    expect(pricedFields({ kind: 'single', priceCents: 900 })).toEqual({ priceCents: 900, options: [] });
    expect(pricedFields({ kind: 'options', options: [{ label: '1kg', priceCents: 9500 }] })).toEqual({ priceCents: null, options: [{ label: '1kg', priceCents: 9500 }] });
  });
});
