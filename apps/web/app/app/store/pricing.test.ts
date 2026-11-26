import { describe, expect, it } from 'vitest';
import { pricingProblem } from '@curios/core/store';
import { CATEGORY_SENTENCE, checkFields, FROM_PARSE_SENTENCE, ownerPriceLine, type PricingDraft, SKU_SENTENCE, TAG_SENTENCE, draftOf, NAME_SENTENCE, PRICE_PARSE_SENTENCE, pricedFields, pricingOf, dropGroupTwo, setSame, cellKey, cellOf, choicesToOptions, startChoices, ownerPricingLine } from './pricing.js';

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
      sku: null,
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

  it('trims an item code, sends null for blank, and refuses one over 40 characters', () => {
    expect(checkFields('Tart', '', single, { category: '', tag: '', sku: ' TRT-01 ' })).toMatchObject({ sku: 'TRT-01' });
    expect(checkFields('Tart', '', single, { category: '', tag: '', sku: '  ' })).toMatchObject({ sku: null });
    expect(checkFields('Tart', '', single, { category: '', tag: '', sku: 'x'.repeat(41) })).toEqual({ error: SKU_SENTENCE });
    expect('error' in checkFields('Tart', '', single, { category: '', tag: '', sku: 'x'.repeat(40) })).toBe(false);
  });
});

describe('pricedFields', () => {
  it('lays a pricing out as the item holds it', () => {
    expect(pricedFields({ kind: 'single', priceCents: 900 })).toEqual({ priceCents: 900, askForPrice: false, options: [] });
    expect(pricedFields({ kind: 'options', options: [{ label: '1kg', priceCents: 9500 }] })).toEqual({ priceCents: null, askForPrice: false, options: [{ label: '1kg', priceCents: 9500 }] });
    expect(pricedFields({ kind: 'ask', fromCents: 18000 })).toEqual({ priceCents: 18000, askForPrice: true, options: [] });
    expect(pricedFields({ kind: 'ask', fromCents: null })).toEqual({ priceCents: null, askForPrice: true, options: [] });
  });
});

describe('Ask items', () => {
  const ask = (price: string): PricingDraft => ({ kind: 'single', ask: true, price, options: [] });

  it('reads an Ask item as Ask, with its starting price or none', () => {
    expect(draftOf({ priceCents: 18000, askForPrice: true, options: [] })).toMatchObject({ ask: true, price: '180' });
    expect(draftOf({ priceCents: null, askForPrice: true, options: [] })).toMatchObject({ ask: true, price: '' });
    expect(draftOf({ priceCents: 900, askForPrice: false, options: [] }).ask).toBeFalsy();
  });

  it('sends an empty starting price as null and a typed one in sen', () => {
    expect(pricingOf(ask(''))).toEqual({ pricing: { kind: 'ask', fromCents: null } });
    expect(pricingOf(ask('  '))).toEqual({ pricing: { kind: 'ask', fromCents: null } });
    expect(pricingOf(ask('RM 180.50'))).toEqual({ pricing: { kind: 'ask', fromCents: 18050 } });
  });

  it("says the board's sentence for words, and core's for a price out of range", () => {
    expect(pricingOf(ask('lots'))).toEqual({ error: FROM_PARSE_SENTENCE });
    expect(pricingOf(ask('0'))).toEqual({ error: pricingProblem({ kind: 'ask', fromCents: 0 }) });
    expect(pricingOf(ask('20000'))).toEqual({ error: 'A starting price is above RM0, up to RM10,000. Or leave it empty.' });
  });

  it('a draft that is not Ask is priced as before, whatever options wait in it', () => {
    expect(pricingOf({ kind: 'single', ask: false, price: '9', options: [] })).toEqual({ pricing: { kind: 'single', priceCents: 900 } });
  });

  it('says the price as the owner sees it', () => {
    expect(ownerPriceLine({ priceCents: 18000, askForPrice: true, options: [] })).toBe('From RM180, ask for a price');
    expect(ownerPriceLine({ priceCents: null, askForPrice: true, options: [] })).toBe('Price on request');
    expect(ownerPriceLine({ priceCents: 2500, options: [] })).toBe('RM25');
  });
});

describe('choices', () => {
  const choices = {
    groupOne: { name: 'Flavour', choices: [{ id: 'a', label: 'Vanilla', photoId: 'p1', photoKey: 'k1' }, { id: 'b', label: 'Chocolate', photoId: null, photoKey: null }] },
    groupTwo: { name: 'Size', choices: [{ id: 'x', label: '500g', photoId: null, photoKey: null }, { id: 'y', label: '1kg', photoId: null, photoKey: null }] },
    combos: [
      { id: 'c1', label: 'Vanilla · 500g', oneId: 'a', twoId: 'x', priceCents: 4500, available: true },
      { id: 'c2', label: 'Vanilla · 1kg', oneId: 'a', twoId: 'y', priceCents: 8000, available: false },
      { id: 'c3', label: 'Chocolate · 500g', oneId: 'b', twoId: 'x', priceCents: 5000, available: true },
      { id: 'c4', label: 'Chocolate · 1kg', oneId: 'b', twoId: 'y', priceCents: 9000, available: true },
    ],
  };
  const item = { priceCents: null, options: choices.combos.map((c) => ({ label: c.label, priceCents: c.priceCents })), choices };

  it('opens a choices item as choices, and saves back the same pricing', () => {
    const draft = draftOf(item);
    expect(draft.choices).toBeTruthy();
    expect(pricingOf(draft)).toEqual({
      pricing: {
        kind: 'choices',
        groupOne: { name: 'Flavour', choices: [{ label: 'Vanilla', photoId: 'p1' }, { label: 'Chocolate' }] },
        groupTwo: { name: 'Size', choices: [{ label: '500g' }, { label: '1kg' }] },
        combos: [
          { one: 0, two: 0, priceCents: 4500, available: true },
          { one: 0, two: 1, priceCents: 8000, available: false },
          { one: 1, two: 0, priceCents: 5000, available: true },
          { one: 1, two: 1, priceCents: 9000, available: true },
        ],
      },
    });
  });

  it('drops a photo pick that is not one of the item photos, and never sends two for one group', () => {
    const draft = draftOf(item);
    const dropped = pricingOf(draft, ['other']);
    expect('pricing' in dropped && dropped.pricing.kind === 'choices' && dropped.pricing.groupOne.choices[0]).toEqual({ label: 'Vanilla' });
    const one = dropGroupTwo(draft.choices!);
    const priced = pricingOf({ ...draft, choices: one });
    expect('pricing' in priced && priced.pricing.kind === 'choices' && priced.pricing.combos.map((c) => 'two' in c)).toEqual([false, false]);
  });

  it('says what is wrong with a price or with every combination off', () => {
    const draft = draftOf(item);
    const c = draft.choices!;
    const zero = { ...c, cells: Object.fromEntries(Object.entries(c.cells).map(([k, v]) => [k, { ...v, price: '0' }])) };
    expect(pricingOf({ ...draft, choices: zero })).toEqual({ error: '"Vanilla · 500g": Give it a price above RM0, up to RM10,000.' });
    const off = { ...c, cells: Object.fromEntries(Object.entries(c.cells).map(([k, v]) => [k, { ...v, available: false }])) };
    expect(pricingOf({ ...draft, choices: off })).toEqual({ error: 'Keep at least one combination on sale.' });
  });

  it('same price fills every group-one choice, and turning it off copies back', () => {
    const c = setSame(draftOf(item).choices!, true);
    const shared = { ...c, cells: { ...c.cells, [cellKey('*', c.two![1]!.key)]: { price: '70', available: true } } };
    expect(cellOf(shared, c.one[1]!.key, c.two![1]!.key).price).toBe('70');
    const back = setSame(shared, false);
    expect(cellOf(back, c.one[0]!.key, c.two![1]!.key).price).toBe('70');
    expect(cellOf(back, c.one[1]!.key, c.two![1]!.key).price).toBe('70');
  });

  it('flattens to a plain list of the combinations on sale, and starts from a plain list', () => {
    expect(choicesToOptions(draftOf(item).choices!).map((o) => [o.label, o.price])).toEqual([['Vanilla · 500g', '45'], ['Chocolate · 500g', '50'], ['Chocolate · 1kg', '90']]);
    const started = startChoices([{ key: 1, label: '1kg', price: '95' }]);
    expect(started.two).toHaveLength(1);
    expect(cellOf(started, started.one[0]!.key, started.two![0]!.key).price).toBe('95');
  });

  it('says From RM and ignores switched-off combinations', () => {
    expect(ownerPriceLine(item)).toBe('From RM45');
    const dear = { ...item, choices: { ...choices, combos: choices.combos.map((c) => (c.priceCents < 5000 ? { ...c, available: false } : c)) } };
    expect(ownerPriceLine(dear)).toBe('From RM50');
    const p = pricingOf(draftOf(item));
    expect('pricing' in p && ownerPricingLine(p.pricing)).toBe('From RM45');
    expect('pricing' in p && pricedFields(p.pricing).options.map((o) => o.label)).toEqual(['Vanilla · 500g', 'Chocolate · 500g', 'Chocolate · 1kg']);
  });
});
