import { describe, expect, it } from 'vitest';
import { pageIdFromArgs } from './backfill-args.js';

describe('pageIdFromArgs', () => {
  it('skips the -- pnpm forwards', () => {
    expect(pageIdFromArgs(['--', 'p1'])).toBe('p1');
  });
  it('takes a bare page id', () => {
    expect(pageIdFromArgs(['p1'])).toBe('p1');
  });
  it('is undefined with no arguments, or only --', () => {
    expect(pageIdFromArgs([])).toBeUndefined();
    expect(pageIdFromArgs(['--'])).toBeUndefined();
  });
});
