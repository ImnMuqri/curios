import { describe, expect, it } from 'vitest';
import { ringgit } from './money.js';

describe('ringgit', () => {
  it('writes whole ringgit without decimals', () => {
    expect(ringgit(4900)).toBe('RM49');
    expect(ringgit(0)).toBe('RM0');
  });

  it('writes sen to two places, never RM49.5', () => {
    expect(ringgit(4950)).toBe('RM49.50');
    expect(ringgit(4905)).toBe('RM49.05');
  });

  it('keeps the sign of a negative amount, even under one ringgit', () => {
    expect(ringgit(-50)).toBe('-RM0.50');
    expect(ringgit(-4950)).toBe('-RM49.50');
    expect(ringgit(-4900)).toBe('-RM49');
  });

  it('groups thousands', () => {
    expect(ringgit(123456)).toBe('RM1,234.56');
    expect(ringgit(9834000)).toBe('RM98,340');
  });
});
