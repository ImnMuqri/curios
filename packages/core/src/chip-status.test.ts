import { describe, expect, it } from 'vitest';
import { FAIL_BANK_SAID, FAIL_WHAT_HAPPENED, failReason } from './chip-status';

describe('failReason', () => {
  it('names the CHIP statuses', () => {
    expect(failReason('cancelled')).toBe('cancelled');
    expect(failReason('expired')).toBe('expired');
    for (const s of ['error', 'failed', 'blocked']) expect(failReason(s)).toBe('declined');
    expect(failReason('overdue')).toBe('unfinished');
  });

  it('has words for every reason', () => {
    expect(FAIL_WHAT_HAPPENED.cancelled).toBe('Cancelled at bank');
    expect(FAIL_WHAT_HAPPENED.expired).toBe('Took too long');
    expect(FAIL_WHAT_HAPPENED.declined).toBe('Bank declined');
    expect(FAIL_WHAT_HAPPENED.unfinished).toBe("Didn't finish");
    expect(FAIL_BANK_SAID.cancelled).toBe('cancelled');
    expect(FAIL_BANK_SAID.expired).toBe('it took too long');
    expect(FAIL_BANK_SAID.declined).toBe('declined');
    expect(FAIL_BANK_SAID.unfinished).toBe("it didn't finish");
  });
});
