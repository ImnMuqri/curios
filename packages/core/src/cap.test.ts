import { afterEach, describe, expect, it } from 'vitest';
import { conversationCap, FREE_CONVERSATIONS_PER_MONTH, isOverCap } from './cap.js';

afterEach(() => {
  delete process.env.CONVERSATION_CAP_PER_MONTH;
});

describe('isOverCap', () => {
  it('allows the last conversation the cap pays for', () => {
    // The boundary, and the reason it is asserted at exactly the cap rather
    // than somewhere comfortable: the counter increments BEFORE this is read,
    // so on the 200th conversation `used` is already 200. A `>=` comparison
    // would refuse it and deliver 199 of a 200 cap.
    expect(isOverCap({ used: 200, cap: 200 })).toBe(false);
  });

  it('refuses the one after that', () => {
    expect(isOverCap({ used: 201, cap: 200 })).toBe(true);
  });

  it('is not over when nothing has been used', () => {
    expect(isOverCap({ used: 0, cap: 200 })).toBe(false);
  });
});

describe('conversationCap', () => {
  it('is the free allowance when the environment says nothing', () => {
    expect(conversationCap()).toBe(FREE_CONVERSATIONS_PER_MONTH);
  });

  it('takes an operator override', () => {
    // The number is a guess by construction -- see the spec. This is what
    // makes being wrong about it cost an env var rather than a deploy.
    process.env.CONVERSATION_CAP_PER_MONTH = '500';
    expect(conversationCap()).toBe(500);
  });

  it('treats an empty string as unset rather than as zero', () => {
    process.env.CONVERSATION_CAP_PER_MONTH = '';
    expect(conversationCap()).toBe(FREE_CONVERSATIONS_PER_MONTH);
  });

  it('refuses a cap of zero', () => {
    // Zero would silently take every page dark, which is the one outcome
    // BACKEND.md forbids. Louder to fail at boot than to serve nothing.
    process.env.CONVERSATION_CAP_PER_MONTH = '0';
    expect(() => conversationCap()).toThrow(/positive integer/);
  });

  it('refuses a negative cap', () => {
    process.env.CONVERSATION_CAP_PER_MONTH = '-5';
    expect(() => conversationCap()).toThrow(/positive integer/);
  });

  it('refuses something that is not a number', () => {
    process.env.CONVERSATION_CAP_PER_MONTH = 'lots';
    expect(() => conversationCap()).toThrow(/positive integer/);
  });
});
