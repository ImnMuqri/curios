import type { PrismaClient } from '@curios/db';
import type { Mailer } from '../../lib/mailer.js';
import {
  burnTime,
  hashPassword,
  isBreached,
  MIN_PASSWORD_LENGTH,
  verifyPassword,
  WeakPasswordError,
  type Fetcher,
} from './password.service.js';
import { issueToken } from './token.service.js';

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

  try {
    return await createAccount(prisma, profile, email);
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;

    // Someone else won a race between our lookup and our write. The mundane
    // case is a double-clicked sign-in button firing two identical requests.
    // Re-read first: if a concurrent request already created this identity,
    // that is our account.
    const raced = await prisma.authIdentity.findUnique({
      where: { provider_providerUserId: { provider: 'GOOGLE', providerUserId: profile.sub } },
      select: { accountId: true },
    });
    if (raced) return { accountId: raced.accountId };

    // Otherwise a different subject claimed the address in the meantime.
    // Disambiguate and try once more.
    return createAccount(prisma, profile, `${profile.sub}+${profile.email}`);
  }
}

/** Prisma's unique-constraint violation. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === 'P2002'
  );
}

async function createAccount(
  prisma: PrismaClient,
  profile: GoogleProfile,
  email: string,
): Promise<{ accountId: string }> {
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

export class InvalidCredentialsError extends Error {
  readonly statusCode = 401;
  readonly code = 'INVALID_CREDENTIALS';

  constructor() {
    super('Check your email and password. If you just signed up, confirm your address first.');
    this.name = 'InvalidCredentialsError';
  }
}

const normaliseEmail = (email: string): string => email.trim().toLowerCase();

/**
 * Always resolves, whether or not the address was already taken.
 *
 * The HTTP response cannot distinguish the two cases, so the signup form cannot
 * be used to discover who has an account. The email carries the truth instead,
 * and only the person who can read that inbox learns anything.
 *
 * An existing address writes NO row. `Account.email` is unique, so a second
 * insert would either fail or force the disambiguation the Google path uses,
 * producing a duplicate account the owner could never explain.
 */
export async function signUpWithPassword(
  deps: { prisma: PrismaClient; mailer: Mailer; fetcher?: Fetcher },
  input: { email: string; password: string },
): Promise<void> {
  const email = normaliseEmail(input.email);

  if (input.password.length < MIN_PASSWORD_LENGTH) {
    throw new WeakPasswordError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  if (await isBreached(input.password, deps.fetcher)) {
    throw new WeakPasswordError('That password has appeared in a public breach. Pick another.');
  }

  const existing = await deps.prisma.account.findUnique({
    where: { email },
    select: { id: true, emailVerifiedAt: true, password: { select: { id: true } } },
  });

  if (existing) {
    // Spend what the new-account path spends on argon2 below, or the response
    // time answers the question the identical 202 refuses to. Hashing is the
    // only expensive step on that path, so it is the one that has to be
    // matched to equalise the response time.
    await burnTime();

    // Two different existing-account cases, one identical HTTP response.
    //
    // An account that is unverified and has a password is almost always the
    // same person retrying -- often because the first attempt 500'd when mail
    // failed *after* the account was written. Telling them to sign in would
    // trap them: they cannot, because they are unverified, and the address is
    // taken so they cannot start over either. Re-send the link instead.
    //
    // Only the mail differs. The response is byte-identical either way, so the
    // form still cannot be used to discover who has an account, and the only
    // person who learns anything is whoever can read that inbox.
    // This branch deliberately does NOT install the password just submitted,
    // though the retry that reaches it may carry a different one.
    //
    // Installing it looks like the kinder behaviour and is the more dangerous
    // one: anyone who knows a pending address could post a signup for it and
    // have THEIR password waiting on the account the moment its owner clicks
    // verify. Keeping the first password means a verified account can only
    // ever be opened by whoever started it.
    // The cost is a retry whose new password is silently ignored; that person
    // verifies and then uses password reset, which is a recoverable dead end
    // rather than a takeover.
    if (!existing.emailVerifiedAt && existing.password) {
      const retry = await issueToken(deps.prisma, existing.id, 'EMAIL_VERIFICATION');
      await deps.mailer.send({
        to: email,
        subject: 'Confirm your email',
        text: `Confirm your address to finish setting up Curios:

${process.env.APP_URL ?? 'http://localhost:3000'}/verify?token=${retry}`,
      });
      return;
    }

    await deps.mailer.send({
      to: email,
      subject: 'You already have a Curios account',
      text: 'Someone tried to sign up with this address. You already have an account -- sign in instead. If that was not you, you can ignore this message.',
    });
    return;
  }

  const hash = await hashPassword(input.password);

  let account: { id: string };
  try {
    account = await deps.prisma.account.create({
      data: { email, password: { create: { hash } } },
      select: { id: true },
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;

    // Someone else took the address between the lookup above and this write --
    // the mundane case being a double-clicked submit firing twice. That is the
    // existing-account case, and it must answer the way that case answers, or
    // a duplicate submit returns a 500 that tells the caller the address is
    // taken. The Google path handles this same race for the same reason.
    return;
  }

  const token = await issueToken(deps.prisma, account.id, 'EMAIL_VERIFICATION');
  await deps.mailer.send({
    to: email,
    subject: 'Confirm your email',
    text: `Confirm your address to finish setting up Curios:\n\n${process.env.APP_URL ?? 'http://localhost:3000'}/verify?token=${token}`,
  });
}

/**
 * One failure for every cause, including an unverified address.
 *
 * Distinguishing "no such account" from "wrong password" hands an attacker a
 * list of real addresses. Distinguishing "not verified" does the same, which is
 * why the single message tells everyone to check verification too.
 */
export async function signInWithPassword(
  prisma: PrismaClient,
  input: { email: string; password: string },
): Promise<{ accountId: string }> {
  const email = normaliseEmail(input.email);

  const account = await prisma.account.findUnique({
    where: { email },
    select: { id: true, emailVerifiedAt: true, password: { select: { hash: true } } },
  });

  if (!account?.password) {
    // Spend the time a real verification would have spent, or the response time
    // is an oracle and the identical message above is decoration.
    await burnTime();
    throw new InvalidCredentialsError();
  }

  const ok = await verifyPassword(account.password.hash, input.password);
  if (!ok || !account.emailVerifiedAt) throw new InvalidCredentialsError();

  return { accountId: account.id };
}
