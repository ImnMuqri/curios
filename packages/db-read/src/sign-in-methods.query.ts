import type { AuthProvider } from '@prisma/client';
import { prismaRead } from './client.js';

export interface SignInMethods {
  email: string;
  hasPassword: boolean;
  providers: AuthProvider[];
  /** The Google account's own address, which can differ from the account's; null when Google is not connected. */
  googleEmail: string | null;
}

/**
 * Every way this account can sign in today, plus the address it is under.
 *
 * Nothing in `packages/db-read` answered this before -- `getOwnerPage`
 * selects off `Page` and never touches `Account`, and a page and an account
 * are different things: an owner with no page yet still has sign-in methods.
 * The settings screen needs this to decide which forms to show: no
 * "Add a password" for an account that already has one, no "Connect Google"
 * for one already connected.
 *
 * `findUnique` on `Account.id`, the primary key -- a caller can only ever
 * name their own account here, since the id comes from the session, so there
 * is no cross-account row this could return by mistake.
 *
 * `email` is included slightly beyond what a strict reading of "sign-in
 * methods" requires: a settings screen that does not say which account it is
 * looking at makes "Add a password" ambiguous for anyone who has two, and
 * it is one more column on a read already being written.
 */
export async function getSignInMethods(accountId: string): Promise<SignInMethods | null> {
  const account = await prismaRead.account.findUnique({
    where: { id: accountId },
    select: {
      email: true,
      password: { select: { id: true } },
      identities: { select: { provider: true, email: true } },
    },
  });

  if (!account) return null;

  return {
    email: account.email,
    hasPassword: account.password !== null,
    providers: account.identities.map((identity) => identity.provider),
    googleEmail: account.identities.find((identity) => identity.provider === 'GOOGLE')?.email ?? null,
  };
}
