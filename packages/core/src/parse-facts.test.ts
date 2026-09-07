import { describe, expect, it } from 'vitest';
import { parseFactBlocks } from './parse-facts.js';

const good = `category: PRICE
confidence: 0.9
source: Kek butter 1kg — RM95, tempahan 3 hari awal
Kek 1kg butter starts at RM95
---
category: HOURS
confidence: 0.8
source: Buka Isnin hingga Sabtu, 9 pagi - 6 petang
Open Monday to Saturday, 9am to 6pm`;

describe('parseFactBlocks', () => {
  it('parses well formed blocks', () => {
    const result = parseFactBlocks(good);
    expect(result.facts).toHaveLength(2);
    expect(result.failed).toBe(0);
    expect(result.total).toBe(2);
  });

  it('keeps the claim text verbatim, including non-English prose', () => {
    const raw = `category: PRICE
confidence: 0.9
source: Harga bermula RM95
Kek 1kg butter bermula RM95, tempahan 3 hari awal`;
    expect(parseFactBlocks(raw).facts[0]?.claim).toBe(
      'Kek 1kg butter bermula RM95, tempahan 3 hari awal',
    );
  });

  it('joins a multi-line claim into one claim', () => {
    const raw = `category: MISC
confidence: 0.7
source: about us
We bake every morning
and deliver in Klang Valley`;
    expect(parseFactBlocks(raw).facts[0]?.claim).toBe(
      'We bake every morning and deliver in Klang Valley',
    );
  });

  it('skips a block with an unknown category and counts it failed', () => {
    const raw = `category: NONSENSE
confidence: 0.9
source: x
A claim`;
    const result = parseFactBlocks(raw);
    expect(result.facts).toHaveLength(0);
    expect(result.failed).toBe(1);
  });

  it('skips a block with a missing claim line', () => {
    const raw = `category: PRICE
confidence: 0.9
source: x`;
    expect(parseFactBlocks(raw).failed).toBe(1);
  });

  it('clamps an out of range confidence rather than discarding the claim', () => {
    const raw = `category: PRICE
confidence: 4.2
source: x
A claim`;
    expect(parseFactBlocks(raw).facts[0]?.confidence).toBe(1);
  });

  it('defaults a missing confidence to 0.5', () => {
    const raw = `category: PRICE
source: x
A claim`;
    expect(parseFactBlocks(raw).facts[0]?.confidence).toBe(0.5);
  });

  it('survives a mix of good and broken blocks', () => {
    const raw = `${good}
---
category:
confidence: nope
---
category: POLICY
confidence: 0.6
source: Deposit 50% required
A 50% deposit is required`;
    const result = parseFactBlocks(raw);
    expect(result.facts).toHaveLength(3);
    expect(result.failed).toBe(1);
    expect(result.total).toBe(4);
  });

  it('ignores preamble the model was told not to write but sometimes does', () => {
    const raw = `Here are the claims I found:
---
category: PRICE
confidence: 0.9
source: x
A claim`;
    const result = parseFactBlocks(raw);
    expect(result.facts).toHaveLength(1);
  });

  it('returns an empty result for empty input', () => {
    expect(parseFactBlocks('')).toEqual({ facts: [], total: 0, failed: 0 });
  });
});

describe('the question line', () => {
  it('parses a question alongside the claim', () => {
    const raw = [
      'category: PRICE',
      'confidence: 0.9',
      'source: Kek coklat 1kg - RM45',
      'question: Berapa harga kek coklat 1kg?',
      'Kek coklat 1kg berharga RM45.',
    ].join('\n');

    expect(parseFactBlocks(raw).facts[0]).toMatchObject({
      claim: 'Kek coklat 1kg berharga RM45.',
      question: 'Berapa harga kek coklat 1kg?',
    });
  });

  it('yields a fact with a null question when the model omits the line', () => {
    // Lenient, like every other field here. A missing question costs one entry
    // in the ask bar's cycle; dropping the fact costs a price a customer needed.
    const raw = ['category: PRICE', 'confidence: 0.9', 'source: x', 'Kek RM45.'].join('\n');

    expect(parseFactBlocks(raw).facts[0]).toMatchObject({ claim: 'Kek RM45.', question: null });
    expect(parseFactBlocks(raw).failed).toBe(0);
  });

  it('does not mistake a question line inside the claim for the field', () => {
    // The field is recognised only before the claim begins, exactly like
    // category, confidence and source. Otherwise a claim that happens to
    // contain "question:" would eat itself.
    const raw = [
      'category: MISC',
      'source: x',
      'Our FAQ answers the question: do you deliver?',
    ].join('\n');

    expect(parseFactBlocks(raw).facts[0]).toMatchObject({
      claim: 'Our FAQ answers the question: do you deliver?',
      question: null,
    });
  });

  it('treats an empty question line as no question at all', () => {
    const raw = ['category: MISC', 'source: x', 'question:   ', 'A claim.'].join('\n');
    expect(parseFactBlocks(raw).facts[0]).toMatchObject({ claim: 'A claim.', question: null });
  });
});
