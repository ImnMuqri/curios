import { describe, expect, it, vi } from 'vitest';
import { BlockedAddressError, type ResolvedAddress } from '@curios/core';
import { createHostGuard } from './host-guard.js';

const publicAnswer: ResolvedAddress[] = [{ address: '203.0.113.9', family: 4 }];

describe('createHostGuard', () => {
  it('passes a host that resolves publicly', async () => {
    const guard = createHostGuard({ lookup: async () => publicAnswer });
    await expect(guard('nadiabakes.com')).resolves.toBeUndefined();
  });

  it('rejects a host that resolves into a private range', async () => {
    const guard = createHostGuard({
      lookup: async () => [{ address: '10.0.0.5', family: 4 }],
    });
    await expect(guard('internal.example')).rejects.toBeInstanceOf(BlockedAddressError);
  });

  it('rejects a host that will not resolve at all', async () => {
    // An address this check cannot see is not an address it lets through.
    const guard = createHostGuard({
      lookup: async () => {
        throw new Error('ENOTFOUND');
      },
    });
    await expect(guard('nope.invalid')).rejects.toBeInstanceOf(BlockedAddressError);
  });

  it('rejects rather than hangs when resolution outlasts the timeout', async () => {
    vi.useFakeTimers();
    const guard = createHostGuard({
      lookup: () => new Promise<ResolvedAddress[]>(() => {}),
      timeoutMs: 2000,
    });
    const pending = expect(guard('slow.example')).rejects.toBeInstanceOf(BlockedAddressError);
    await vi.advanceTimersByTimeAsync(2001);
    await pending;
    vi.useRealTimers();
  });

  it('waves everything through when private addresses are allowed', async () => {
    const guard = createHostGuard({
      lookup: async () => [{ address: '127.0.0.1', family: 4 }],
      allowPrivate: true,
    });
    await expect(guard('localhost')).resolves.toBeUndefined();
  });
});
