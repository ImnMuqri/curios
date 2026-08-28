import { describe, expect, it } from 'vitest';
import { buildSystemPrompt, selectFacts, type PromptFact } from './prompt.js';

const facts: PromptFact[] = [
  { id: 'f1', category: 'PRICE', claim: 'Kek 1kg butter starts at RM95' },
  { id: 'f2', category: 'HOURS', claim: 'Open Monday to Saturday, 9am to 6pm' },
  { id: 'f3', category: 'LOCATION', claim: 'Shop is in Shah Alam' },
  { id: 'f4', category: 'PRODUCT', claim: 'We make brownies' },
];

describe('buildSystemPrompt', () => {
  const input = { displayName: 'Nadia Bakes', facts, neverSay: ['halal certified'] };

  it('is byte identical across calls with the same input', () => {
    expect(buildSystemPrompt(input)).toBe(buildSystemPrompt(input));
  });

  it('contains no timestamp, uuid, or other varying token', () => {
    const prompt = buildSystemPrompt(input);
    expect(prompt).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(prompt).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i);
  });

  it('includes every supplied fact with its id', () => {
    const prompt = buildSystemPrompt(input);
    for (const fact of facts) {
      expect(prompt).toContain(fact.claim);
      expect(prompt).toContain(fact.id);
    }
  });

  it('includes the never-say phrases', () => {
    expect(buildSystemPrompt(input)).toContain('halal certified');
  });

  it('states the refusal rule', () => {
    expect(buildSystemPrompt(input).toLowerCase()).toContain('only state a price');
  });

  it('states the language rule as a rule, not a detected value', () => {
    const prompt = buildSystemPrompt(input);
    expect(prompt).toContain('language the question was asked in');
    expect(prompt).not.toContain('The visitor is writing in');
  });

  it('changes when a fact changes, so the cache correctly invalidates', () => {
    const edited = [...facts.slice(1), { id: 'f1', category: 'PRICE' as const, claim: 'RM99 now' }];
    expect(buildSystemPrompt(input)).not.toBe(buildSystemPrompt({ ...input, facts: edited }));
  });
});

describe('selectFacts', () => {
  it('always includes HOURS and LOCATION regardless of the question', () => {
    const selected = selectFacts(facts, 'berapa harga kek');
    expect(selected.map((f) => f.id)).toContain('f2');
    expect(selected.map((f) => f.id)).toContain('f3');
  });

  it('includes facts matching a word in the question', () => {
    const selected = selectFacts(facts, 'tell me about brownies');
    expect(selected.map((f) => f.id)).toContain('f4');
  });

  it('is case and punctuation insensitive when matching', () => {
    const selected = selectFacts(facts, 'BROWNIES?!');
    expect(selected.map((f) => f.id)).toContain('f4');
  });

  it('returns facts in a stable order for cache stability', () => {
    expect(selectFacts(facts, 'brownies').map((f) => f.id)).toEqual(
      selectFacts(facts, 'brownies').map((f) => f.id),
    );
  });
});
