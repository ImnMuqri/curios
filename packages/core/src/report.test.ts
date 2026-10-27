import { describe, expect, it } from 'vitest';
import { FLAG_OVER, isFlagged, REPORT_DETAILS_MAX, REPORT_REASONS } from './report.js';

describe('reports', () => {
  it('flags a page only past five open reports', () => {
    expect(FLAG_OVER).toBe(5);
    expect(isFlagged(5)).toBe(false);
    expect(isFlagged(6)).toBe(true);
  });

  it('names every reason in English and Malay', () => {
    expect(Object.keys(REPORT_REASONS)).toEqual(['SCAM', 'IMPERSONATION', 'WRONG_PRICES', 'OFFENSIVE', 'OTHER']);
    for (const label of Object.values(REPORT_REASONS)) {
      expect(label.en.length).toBeGreaterThan(0);
      expect(label.ms.length).toBeGreaterThan(0);
    }
    expect(REPORT_DETAILS_MAX).toBe(500);
  });
});
