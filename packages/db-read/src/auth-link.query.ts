import { hashSessionValue } from '@curios/core';
import { prismaRead } from './client.js';

/** What an emailed link is now: usable, too old, already followed, or never ours. */
export type AuthLink =
  | { state: 'usable' | 'expired' | 'used'; email: string; name: string | null; verified: boolean }
  | { state: 'unknown' };

/**
 * Where a verification or reset link stands, WITHOUT spending it.
 *
 * The System board answers each case differently ("This link has expired",
 * "That link doesn't work", "For lina@keklina.example"), and only the server
 * knows which one it is. Reading is all this does: the API is still the only
 * thing that claims a link, and it re-checks all of this atomically when it
 * does. Whoever holds the link got it from that inbox, so naming the address
 * back to them tells them nothing new.
 */
export async function getAuthLink(value: string, kind: 'EMAIL_VERIFICATION' | 'PASSWORD_RESET'): Promise<AuthLink> {
  const token = await prismaRead.authToken.findUnique({
    where: { id: hashSessionValue(value) },
    select: {
      kind: true,
      usedAt: true,
      expiresAt: true,
      account: { select: { email: true, name: true, emailVerifiedAt: true } },
    },
  });
  if (!token || token.kind !== kind) return { state: 'unknown' };

  const state = token.usedAt ? 'used' : token.expiresAt <= new Date() ? 'expired' : 'usable';
  return {
    state,
    email: token.account.email,
    name: token.account.name,
    verified: token.account.emailVerifiedAt !== null,
  };
}
