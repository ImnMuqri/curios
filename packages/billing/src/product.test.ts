import { describe, expect, it } from 'vitest';
import { billDescription } from './product.js';

describe('billDescription', () => {
  it('names the plan and the page', () => {
    expect(billDescription('MONTHLY', 'Nadia Bakes')).toBe('Curios Business, 1 month — Nadia Bakes');
    expect(billDescription('ANNUAL', 'Nadia Bakes')).toBe('Curios Business, 1 year — Nadia Bakes');
  });

  it('cuts a long name at 200 characters', () => {
    expect(billDescription('MONTHLY', 'x'.repeat(500))).toHaveLength(200);
  });
});
