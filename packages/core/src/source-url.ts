import { isBlockedAddress } from './address.js';

/**
 * Thrown when an address must not be dialled.
 *
 * The message is deliberately incurious. `apps/workers` writes a failed job's
 * error.message into Ingestion.error, and GET /ingest/:id hands that field to
 * the owner, so anything specific here becomes a resolution oracle with
 * detail. The address that caused it travels on `blocked`, which only the log
 * reads.
 */
export class BlockedAddressError extends Error {
  readonly code = 'BLOCKED_SOURCE_URL';
  readonly blocked: string;

  constructor(blocked: string) {
    super('That address points somewhere this crawler will not go.');
    this.name = 'BlockedAddressError';
    this.blocked = blocked;
  }
}

export type SourceUrlVerdict =
  | { ok: true; url: URL; hostname: string }
  | { ok: false; reason: 'unparseable' | 'not_http' | 'has_credentials' };

/**
 * What can be decided about a pasted address from its shape alone.
 *
 * Shape only. No address is judged here, not even a literal one, and that is a
 * correction rather than an omission: an earlier version rejected
 * http://127.0.0.1/ right here, which looked like a cheap win and quietly
 * broke the escape hatch. INGEST_ALLOW_PRIVATE_ADDRESSES exists so the manual
 * walkthrough can crawl a page on 127.0.0.1, and a literal refused before
 * anyone consults the flag is a switch that does not switch anything.
 *
 * So every address question -- literal or resolved -- goes to the one place
 * that resolves, which honours the flag and costs nothing extra: a resolver
 * handed "127.0.0.1" answers 127.0.0.1 without touching the network. One
 * decision, one flag, one place to get it wrong.
 */
export function inspectSourceUrl(input: string): SourceUrlVerdict {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { ok: false, reason: 'unparseable' };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: 'not_http' };
  }
  if (url.username !== '' || url.password !== '') return { ok: false, reason: 'has_credentials' };

  // Brackets are stripped because url.hostname keeps them, and a resolver
  // handed '[::1]' fails in a way that reads as a network problem.
  const hostname = url.hostname.replace(/^\[/, '').replace(/\]$/, '');

  return { ok: true, url, hostname };
}

export interface ResolvedAddress {
  address: string;
  family: number;
}

/**
 * Every address in a resolver's answer must be public, or none of it is used.
 *
 * Not a filter. Dropping the private entries and dialling the survivors sounds
 * safer and is the opposite: a host answering [public, 127.0.0.1] would still
 * be crawled, which is exactly the answer an attacker arranges.
 */
export function requirePublicAddresses(
  entries: readonly ResolvedAddress[],
  options: { allowPrivate: boolean },
): ResolvedAddress[] {
  if (options.allowPrivate) return [...entries];
  if (entries.length === 0) throw new BlockedAddressError('none');

  for (const entry of entries) {
    if (isBlockedAddress(entry.address)) throw new BlockedAddressError(entry.address);
  }
  return [...entries];
}

/**
 * The local-verification switch, off unless it is spelled exactly.
 *
 * A typo must fail closed. 'TRUE' in a production environment file is a
 * mistake, and reading it as permission would make the mistake silent.
 */
export function allowsPrivateAddresses(raw: string | undefined): boolean {
  return raw === 'true';
}

/**
 * Hosts whose pages cannot be read. The worker's Instagram adapter (apps/workers
 * sources/instagram.adapter.ts) always fails with NOT_CONFIGURED, so a retry of
 * one of these would only fail the same way. The same host test as `linkKind`.
 */
const WALLED_HOSTS = ['instagram.com'] as const;

export function isWalledSource(sourceUrl: string | null): boolean {
  if (sourceUrl === null) return false;
  let host: string;
  try {
    host = new URL(sourceUrl).hostname.toLowerCase();
  } catch {
    return false;
  }
  return WALLED_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}
