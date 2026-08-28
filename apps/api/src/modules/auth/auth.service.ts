import type { PrismaClient } from '@curios/db';

export interface GoogleProfile {
  sub: string;
  email: string;
  emailVerified: boolean;
  name?: string;
}

export class UnverifiedEmailError extends Error {
  readonly statusCode = 400;
  readonly code = 'EMAIL_NOT_VERIFIED';
  constructor() {
    super('That Google account has no verified email address.');
  }
}

/**
 * Keyed on Google's `sub`, never the email.
 *
 * An email can change; the subject id cannot. Keying on email means a rename
 * silently creates a second account and orphans the first -- which in a
 * link-in-bio product means the URL on their printed card stops working.
 *
 * A new sub is never linked to an existing account by matching the address.
 * That is the account-takeover path: someone registers your address through a
 * provider that does not verify it, and your sign-in merges you into theirs.
 */
export async function findOrCreateAccountForGoogle(
  prisma: PrismaClient,
  profile: GoogleProfile,
): Promise<{ accountId: string }> {
  if (!profile.emailVerified) throw new UnverifiedEmailError();

  const existing = await prisma.authIdentity.findUnique({
    where: { provider_providerUserId: { provider: 'GOOGLE', providerUserId: profile.sub } },
    select: { accountId: true },
  });

  if (existing) return { accountId: existing.accountId };

  // Account.email is unique, so a second person with a colliding address gets a
  // disambiguated value rather than being merged into someone else's account.
  const emailTaken = await prisma.account.findUnique({ where: { email: profile.email } });
  const email = emailTaken ? `${profile.sub}+${profile.email}` : profile.email;

  const account = await prisma.account.create({
    data: {
      email,
      name: profile.name ?? null,
      identities: {
        create: { provider: 'GOOGLE', providerUserId: profile.sub, email: profile.email },
      },
    },
    select: { id: true },
  });

  return { accountId: account.id };
}
