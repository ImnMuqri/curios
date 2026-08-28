import { describe, expect, it } from 'vitest';
import { costFor, PRICE_VERSION } from './pricing.js';

const zero = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

describe('costFor', () => {
  it('prices one million Haiku input tokens at $1, i.e. 100000 milli-cents', () => {
    const { costMilliCents } = costFor('claude-haiku-4-5', { ...zero, inputTokens: 1_000_000 });
    expect(costMilliCents).toBe(100_000);
  });

  it('prices one million Haiku output tokens at $5', () => {
    const { costMilliCents } = costFor('claude-haiku-4-5', { ...zero, outputTokens: 1_000_000 });
    expect(costMilliCents).toBe(500_000);
  });

  it('prices one million Opus 5 input tokens at $5 and output at $25', () => {
    expect(costFor('claude-opus-5', { ...zero, inputTokens: 1_000_000 }).costMilliCents).toBe(500_000);
    expect(costFor('claude-opus-5', { ...zero, outputTokens: 1_000_000 }).costMilliCents).toBe(2_500_000);
  });

  it('prices cache reads at a tenth of input', () => {
    const { costMilliCents } = costFor('claude-haiku-4-5', { ...zero, cacheReadTokens: 1_000_000 });
    expect(costMilliCents).toBe(10_000);
  });

  it('prices cache writes at 1.25x input', () => {
    const { costMilliCents } = costFor('claude-haiku-4-5', { ...zero, cacheWriteTokens: 1_000_000 });
    expect(costMilliCents).toBe(125_000);
  });

  it('sums every component', () => {
    const { costMilliCents } = costFor('claude-haiku-4-5', {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
      cacheWriteTokens: 1_000_000,
    });
    expect(costMilliCents).toBe(100_000 + 500_000 + 10_000 + 125_000);
  });

  it('does not round a realistic small call down to zero', () => {
    // ~600 input, 150 output on Haiku. Integer cents would floor this to 0,
    // which is the bug milli-cents exists to prevent.
    const { costMilliCents } = costFor('claude-haiku-4-5', {
      ...zero,
      inputTokens: 600,
      outputTokens: 150,
    });
    expect(costMilliCents).toBeGreaterThan(0);
  });

  it('returns a stable price version', () => {
    expect(costFor('claude-haiku-4-5', zero).priceVersion).toBe(PRICE_VERSION);
  });

  it('throws on an unknown model rather than silently pricing at zero', () => {
    expect(() => costFor('gpt-4', zero)).toThrow(/unknown model/i);
  });
});
