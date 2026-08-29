import { createHash } from 'node:crypto';
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';

export type Fetcher = (url: string) => Promise<{ ok: boolean; text(): Promise<string> }>;

export class WeakPasswordError extends Error {
  readonly statusCode = 400;
  readonly code = 'WEAK_PASSWORD';

  constructor(message: string) {
    super(message);
    this.name = 'WeakPasswordError';
  }
}

/** NIST 800-63B: length, screened against known breaches, and nothing else. */
export const MIN_PASSWORD_LENGTH = 8;

/** OWASP, and the parameters ADMIN.md already specifies for the admin system. */
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export async function hashPassword(plain: string): Promise<string> {
  return argonHash(plain, OPTIONS);
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argonVerify(hash, plain);
  } catch {
    // An unparseable hash is a corrupted row, not a valid login. Failing that
    // attempt is right; throwing would turn one bad row into an outage and
    // would tell an attacker which account it belongs to.
    return false;
  }
}

/**
 * Spends the time an unknown address would have spent verifying a real hash.
 * Without it the response time is an oracle and the identical error message
 * that hides account existence becomes decoration.
 */
export async function burnTime(): Promise<void> {
  await argonHash('timing-equalisation', OPTIONS);
}

/**
 * Have I Been Pwned's range API in k-anonymity mode: only the first five
 * characters of the SHA-1 leave this process, and the match completes locally
 * against the returned suffixes. The password and its full hash never leave.
 *
 * Fails open by design. This is a strength check, not an authorization check,
 * and a third party's uptime must not decide whether someone can sign up.
 */
export async function isBreached(
  plain: string,
  fetcher: Fetcher = (url) => fetch(url),
): Promise<boolean> {
  const sha1 = createHash('sha1').update(plain).digest('hex').toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);

  try {
    const response = await fetcher(`https://api.pwnedpasswords.com/range/${prefix}`);
    if (!response.ok) return false;

    const body = await response.text();
    return body.split('\n').some((line) => line.trim().split(':')[0]?.toUpperCase() === suffix);
  } catch {
    return false;
  }
}
