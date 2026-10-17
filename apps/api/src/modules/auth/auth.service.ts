import type { PrismaClient } from '@curios/db';
import type { Mailer } from '../../lib/mailer.js';
import { alreadySignedUpMail, resetMail, verifyMail } from './auth-mail.js';
import {
  burnTime,
  hashPassword,
  isBreached,
  MIN_PASSWORD_LENGTH,
  verifyPassword,
  WeakPasswordError,
  type Fetcher,
} from './password.service.js';
import { consumeToken, issueToken, tokenIsClaimable } from './token.service.js';

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
    error.code === 'P2002'
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
      await deps.mailer.send({ to: email, ...verifyMail(retry) });
      return;
    }

    await deps.mailer.send({ to: email, ...alreadySignedUpMail() });
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
  await deps.mailer.send({ to: email, ...verifyMail(token) });
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

export class InvalidTokenError extends Error {
  readonly statusCode = 400;
  readonly code = 'INVALID_TOKEN';

  constructor() {
    super('That link has expired or has already been used. Request a new one.');
    this.name = 'InvalidTokenError';
  }
}

export async function verifyEmail(prisma: PrismaClient, token: string): Promise<void> {
  const consumed = await consumeToken(prisma, token, 'EMAIL_VERIFICATION');
  if (!consumed) throw new InvalidTokenError();

  await prisma.account.update({
    where: { id: consumed.accountId },
    data: { emailVerifiedAt: new Date() },
  });
}

/** Always resolves, for the same enumeration reason signup does. */
export async function requestPasswordReset(
  deps: { prisma: PrismaClient; mailer: Mailer },
  email: string,
): Promise<void> {
  const normalised = normaliseEmail(email);
  const account = await deps.prisma.account.findUnique({
    where: { email: normalised },
    select: { id: true, password: { select: { id: true } } },
  });

  // No account, or a Google-only account with no password to reset: send
  // nothing and say nothing.
  //
  // The two paths now cost the same to within a few local database writes,
  // because neither waits for SMTP -- mail is queued, not sent, here. Before
  // that they differed by a whole mail round trip, which made the response
  // time answer exactly the question this identical response body refuses to.
  // Not constant-time, and not claimed to be; the remaining difference is
  // well under the noise of a network hop.
  if (!account?.password) return;

  // Supersede any reset link already outstanding. Asking again is what someone
  // does when the first did not arrive, or when they suspect the first request
  // was not theirs -- and in that second case the earlier link is exactly what
  // must stop working. Leaving it live for its full hour keeps a working key to
  // the account sitting in an inbox.
  await deps.prisma.authToken.updateMany({
    where: { accountId: account.id, kind: 'PASSWORD_RESET', usedAt: null },
    data: { usedAt: new Date() },
  });

  const token = await issueToken(deps.prisma, account.id, 'PASSWORD_RESET');
  await deps.mailer.send({ to: normalised, ...resetMail(token, normalised) });
}

export async function resetPassword(
  prisma: PrismaClient,
  input: { token: string; password: string },
  fetcher?: Fetcher,
): Promise<void> {
  if (input.password.length < MIN_PASSWORD_LENGTH) {
    throw new WeakPasswordError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
  }

  // Cheapest decisive check first. Screening the password calls a third party,
  // and doing that before the token is known to be usable lets anyone make this
  // server open outbound requests with nothing but an invented token. This does
  // not authorise anything -- consumeToken below re-checks it atomically and is
  // still the only thing that grants the claim.
  if (!(await tokenIsClaimable(prisma, input.token, 'PASSWORD_RESET'))) {
    throw new InvalidTokenError();
  }

  if (await isBreached(input.password, fetcher)) {
    throw new WeakPasswordError('That password has appeared in a public breach. Pick another.');
  }

  // Hashed before the token is spent, so the slowest step cannot fail after the
  // link has already been burned. The token is only claimed once everything
  // that can reasonably fail has succeeded.
  const hash = await hashPassword(input.password);

  const consumed = await consumeToken(prisma, input.token, 'PASSWORD_RESET');
  if (!consumed) throw new InvalidTokenError();

  await prisma.$transaction([
    prisma.passwordCredential.upsert({
      where: { accountId: consumed.accountId },
      create: { accountId: consumed.accountId, hash },
      update: { hash },
    }),
    // Completing a reset proves control of the inbox, which is exactly what
    // verification proves. Without this an unverified account can reset its
    // password, be told 200, and still be refused at login with nothing left
    // to try. Only ever fills a blank, so a real verification date is kept.
    prisma.account.updateMany({
      where: { id: consumed.accountId, emailVerifiedAt: null },
      data: { emailVerifiedAt: new Date() },
    }),
    // Every session dies. A reset that leaves the intruder signed in is not a
    // recovery, and this is the one place revocation is not optional.
    prisma.session.deleteMany({ where: { accountId: consumed.accountId } }),
  ]);
}

export class PasswordAlreadySetError extends Error {
  readonly statusCode = 409;
  readonly code = 'PASSWORD_ALREADY_SET';
  constructor() {
    super('This account already has a password. Use the reset link to change it.');
    this.name = 'PasswordAlreadySetError';
  }
}

export class IdentityTakenError extends Error {
  readonly statusCode = 409;
  readonly code = 'IDENTITY_TAKEN';
  constructor() {
    super('That Google account is already connected to another Curios account.');
    this.name = 'IdentityTakenError';
  }
}

/**
 * Adds a password to an account that has none.
 *
 * Add, never change. Changing a password is the reset flow, which proves
 * control of the inbox first; letting a session rewrite the credential means a
 * stolen session becomes permanent ownership of the account.
 *
 * Screened exactly as signup screens, because a password added here is the
 * same credential with the same consequences.
 */
export async function addPassword(
  deps: { prisma: PrismaClient; fetcher?: Fetcher },
  accountId: string,
  password: string,
): Promise<void> {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new WeakPasswordError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  if (await isBreached(password, deps.fetcher)) {
    throw new WeakPasswordError('That password has appeared in a public breach. Pick another.');
  }

  const existing = await deps.prisma.passwordCredential.findUnique({
    where: { accountId },
    select: { id: true },
  });
  if (existing) throw new PasswordAlreadySetError();

  try {
    await deps.prisma.passwordCredential.create({
      data: { accountId, hash: await hashPassword(password) },
    });
  } catch (error) {
    // Two simultaneous adds: the unique constraint on accountId decides, and
    // the loser is told the same thing it would have been told a moment later.
    if (isUniqueViolation(error)) throw new PasswordAlreadySetError();
    throw error;
  }
}

/**
 * Attaches a Google identity to an account that is already signed in.
 *
 * This is the only linking path, and it is authenticated by construction: the
 * account comes from the session, never from the profile's email address.
 * Linking by matching address is the takeover the spec forbids -- someone
 * registers your address with a provider that does not verify it, and their
 * sign-in merges into your account.
 */
export async function linkGoogleIdentity(
  prisma: PrismaClient,
  accountId: string,
  profile: GoogleProfile,
): Promise<void> {
  if (!profile.emailVerified) throw new UnverifiedEmailError();

  const existing = await prisma.authIdentity.findUnique({
    where: { provider_providerUserId: { provider: 'GOOGLE', providerUserId: profile.sub } },
    select: { accountId: true },
  });

  if (existing) {
    // Idempotent for the owner who clicks twice; refused for everyone else,
    // because moving an identity between accounts is a takeover.
    if (existing.accountId === accountId) return;
    throw new IdentityTakenError();
  }

  try {
    await prisma.authIdentity.create({
      data: { accountId, provider: 'GOOGLE', providerUserId: profile.sub, email: profile.email },
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;

    // Someone won the race between the lookup above and this write. Re-read
    // before deciding what to say: the ordinary cause is the same owner
    // double-clicking, and telling them their own account belongs to someone
    // else is both wrong and alarming. Same shape as the race handler
    // `findOrCreateAccountForGoogle` already carries.
    const raced = await prisma.authIdentity.findUnique({
      where: { provider_providerUserId: { provider: 'GOOGLE', providerUserId: profile.sub } },
      select: { accountId: true },
    });
    if (raced?.accountId === accountId) return;

    throw new IdentityTakenError();
  }
}
