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
  | { ok: false; reason: 'unparseable' | 'not_http' | 'has_credentials' | 'blocked_address' };

/**
 * Everything that can be decided about a pasted address without a network.
 *
 * The IP-literal case needs less work than it looks: WHATWG parsing already
 * folds 2130706433, 0177.0.0.1, 0x7f000001 and 127.1 to 127.0.0.1 before this
 * function sees any of them. What it does not fold is IPv4-mapped IPv6, which
 * arrives compressed as [::ffff:7f00:1] -- hence a classifier that reads the
 * hex form rather than a regex that looks for something readable.
 *
 * A hostname is not judged here. Whether `localhost` or `shop.example` points
 * somewhere private is a question only a resolver answers, and pretending
 * otherwise would suggest this function is a defence rather than a filter.
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

  const hostname = url.hostname.replace(/^\[/, '').replace(/\]$/, '');
  if (isLiteralAddress(hostname) && isBlockedAddress(hostname)) {
    return { ok: false, reason: 'blocked_address' };
  }

  return { ok: true, url, hostname };
}

/**
 * Does this hostname look like a numeric address rather than a name?
 *
 * Asked separately from isBlockedAddress because that function fails closed on
 * anything it cannot parse -- correct for an address, catastrophic for a
 * hostname, which it would block every one of.
 */
function isLiteralAddress(hostname: string): boolean {
  return hostname.includes(':') || /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname);
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
