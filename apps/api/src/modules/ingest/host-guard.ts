import { lookup as dnsLookup } from 'node:dns/promises';
import {
  allowsPrivateAddresses,
  BlockedAddressError,
  requirePublicAddresses,
  type ResolvedAddress,
} from '@curios/core';

export type LookupAll = (hostname: string) => Promise<ResolvedAddress[]>;
export type HostGuard = (hostname: string) => Promise<void>;

const DEFAULT_TIMEOUT_MS = 2000;

/**
 * The fast fail, and only the fast fail.
 *
 * This exists so an owner who pastes a private address is told so, instead of
 * getting a 202 and finding a failed ingestion in the poll a minute later. It
 * is NOT the control -- the worker's connector is, because this answer is
 * already stale by the time a job runs. Deleting this function costs an error
 * message; deleting the worker's guard costs the property.
 *
 * The timeout is here because this runs inside an HTTP request, against the
 * rule that nothing slow does. Two seconds, and a lookup that outlasts it is a
 * rejection rather than a wait -- the race leaves the underlying lookup running
 * to its own conclusion, which is wasteful and harmless.
 */
export function createHostGuard(
  options: {
    lookup?: LookupAll;
    allowPrivate?: boolean;
    timeoutMs?: number;
  } = {},
): HostGuard {
  const lookup = options.lookup ?? defaultLookup;
  const allowPrivate =
    options.allowPrivate ?? allowsPrivateAddresses(process.env.INGEST_ALLOW_PRIVATE_ADDRESSES);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return async (hostname) => {
    let entries: ResolvedAddress[];
    try {
      entries = await withTimeout(lookup(hostname), timeoutMs);
    } catch (error) {
      if (error instanceof BlockedAddressError) throw error;
      throw new BlockedAddressError('unresolved');
    }
    requirePublicAddresses(entries, { allowPrivate });
  };
}

async function defaultLookup(hostname: string): Promise<ResolvedAddress[]> {
  // verbatim keeps the resolver's own ordering, which matters not at all here
  // -- every entry is checked -- but avoids Node re-sorting an answer we are
  // about to hand to a caller that may pin one of them.
  return dnsLookup(hostname, { all: true, verbatim: true });
}

async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new BlockedAddressError('timeout')), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
