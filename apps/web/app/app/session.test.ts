import { describe, expect, it, vi } from 'vitest';

const getOwnerSession = vi.fn();
vi.mock('@curios/db-read', () => ({ getOwnerSession }));

const { resolveOwner } = await import('./session.js');

describe('resolveOwner', () => {
  it('resolves a valid cookie value to its account', async () => {
    getOwnerSession.mockResolvedValueOnce({ accountId: 'acc-1' });

    expect(await resolveOwner('a-real-value')).toEqual({ accountId: 'acc-1' });
    // Asserting the ARGUMENT, not just the return. Without this a version that
    // validated some other value -- a stale closure, a hardcoded literal --
    // passes, and that version either locks everyone out or, far worse, hands
    // everyone whichever account that value happens to belong to.
    expect(getOwnerSession).toHaveBeenCalledWith('a-real-value');
  });

  it('refuses a cookie the database does not recognise', async () => {
    // This is the case middleware cannot catch and this layer exists for: a
    // present cookie that is expired, revoked, or forged.
    getOwnerSession.mockResolvedValueOnce(null);

    expect(await resolveOwner('forged')).toBeNull();
    expect(getOwnerSession).toHaveBeenCalledWith('forged');
  });

  it('does not go to the database when there is no cookie at all', async () => {
    getOwnerSession.mockClear();

    expect(await resolveOwner(undefined)).toBeNull();
    expect(getOwnerSession).not.toHaveBeenCalled();
  });
});
