import { lookup as dnsLookup } from 'node:dns/promises';
import { Agent, fetch, type Dispatcher } from 'undici';
import {
  BlockedAddressError,
  inspectSourceUrl,
  isAddressLiteral,
  isBlockedAddress,
  requirePublicAddresses,
  type ResolvedAddress,
} from '@curios/core';

export const MAX_HOPS = 5;
/**
 * Half the crawler's whole-crawl budget of 4,000,000 bytes, so one page cannot
 * spend the entire allowance and starve the other twenty-four.
 */
export const MAX_RESPONSE_BYTES = 2_000_000;
const TOTAL_TIMEOUT_MS = 10_000;
const USER_AGENT = 'CuriosBot/0.1 (+https://curios.my/bot)';

export type ResolveAll = (hostname: string) => Promise<ResolvedAddress[]>;

/**
 * An Agent that resolves every connection itself and dials only what it vetted.
 *
 * This covers every hostname the crawler touches -- the root, the twenty-five
 * same-origin pages, every redirect hop -- with no call site to audit, because
 * there is no call site. It does NOT cover a literal address: net.connect
 * skips DNS when the host is already an address, so this lookup is never
 * called for http://127.0.0.1/. fetchGuarded handles that case, and the two
 * share a classifier and a flag so they cannot disagree.
 *
 * The signature is undici's, established by probing it rather than by reading
 * for it: the lookup is invoked with { hints: 0, all: true } and the callback
 * must answer with an ARRAY of { address, family }. Node's ordinary triple
 * (null, '127.0.0.1', 4) fails the request with "Invalid IP address:
 * undefined", which looks like a network fault rather than a wiring mistake.
 */
export function createGuardedAgent(options: {
  allowPrivate: boolean;
  onBlocked?: (hostname: string, blocked: string) => void;
  /**
   * Injectable so a test can make the vetted address differ from what the OS
   * would say. That difference is the only way to prove the socket used OUR
   * answer rather than resolving a second time -- which is the entire claim
   * this Agent makes.
   */
  resolve?: ResolveAll;
}): Agent {
  const resolve = options.resolve ?? defaultResolve;

  const guardedLookup = (
    hostname: string,
    _opts: unknown,
    callback: (error: Error | null, addresses: ResolvedAddress[]) => void,
  ): void => {
    resolve(hostname)
      .then((addresses) => {
        callback(null, requirePublicAddresses(addresses, { allowPrivate: options.allowPrivate }));
      })
      .catch((error: unknown) => {
        if (error instanceof BlockedAddressError) options.onBlocked?.(hostname, error.blocked);
        callback(error as Error, []);
      });
  };

  // No cast needed, which is worth stating because the obvious expectation is
  // that one would be: undici types connect.lookup as Node's LookupFunction,
  // whose documented overloads describe the (err, address, family) triple,
  // while it actually calls with all:true and reads an array back. The type is
  // loose enough to accept the array form, so the runtime shape the probe
  // established and the shape the compiler will take are the same shape. Do
  // not "fix" this by answering with the triple: it typechecks and fails every
  // request with "Invalid IP address: undefined".
  return new Agent({ connect: { lookup: guardedLookup } });
}

async function defaultResolve(hostname: string): Promise<ResolvedAddress[]> {
  return dnsLookup(hostname, { all: true, verbatim: true });
}

/**
 * Fetch one page, following redirects by hand.
 *
 * Automatic following is given up deliberately: it is the mechanism that walks
 * off the public internet in the middle of a request whose first hop passed.
 * Every hop is re-checked here for shape and for a literal address, and its
 * connection is guarded by the connector for everything else.
 *
 * One deadline covers the whole chain. Per-hop timeouts would let five
 * redirects hold a worker slot for fifty seconds.
 */
export async function fetchGuarded(
  target: string,
  deps: {
    agent: Dispatcher;
    /**
     * Needed here as well as in the Agent, and not by oversight -- see the
     * literal check below for the reason the connector cannot cover this.
     */
    allowPrivate: boolean;
    onBlocked?: (hostname: string, blocked: string) => void;
  },
): Promise<string> {
  const deadline = AbortSignal.timeout(TOTAL_TIMEOUT_MS);
  let current = target;

  for (let hop = 0; hop <= MAX_HOPS; hop += 1) {
    const verdict = inspectSourceUrl(current);
    if (!verdict.ok) throw new BlockedAddressError(verdict.reason);

    // A literal address never reaches the Agent's lookup. net.connect skips
    // DNS entirely when the host is already an address, so the connector --
    // the thing this module claims is impossible to bypass -- is simply not
    // consulted for http://127.0.0.1/. It has to be judged here.
    //
    // Found by running the guard rather than by reading it: with the flag off,
    // 127.0.0.1 was fetched. Every name still goes to the connector, and this
    // covers the one case that does not, using the same classifier and the
    // same flag so the two cannot drift.
    if (!deps.allowPrivate && isAddressLiteral(verdict.hostname)) {
      if (isBlockedAddress(verdict.hostname)) {
        deps.onBlocked?.(verdict.hostname, verdict.hostname);
        throw new BlockedAddressError(verdict.hostname);
      }
    }

    const response = await fetch(current, {
      dispatcher: deps.agent,
      redirect: 'manual',
      signal: deadline,
      headers: { 'user-agent': USER_AGENT },
    });

    if (isRedirect(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) throw new Error(`${response.status} with no location, ${current}`);
      current = new URL(location, current).href;
      continue;
    }

    if (!response.ok) throw new Error(`${response.status} ${current}`);
    return readCapped(response);
  }

  throw new Error(`too many redirects from ${target}`);
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

/**
 * Read the body with a running limit.
 *
 * response.text() reads whatever arrives, so a body that never ends holds the
 * slot until the deadline and a large one blows the crawler's total budget
 * inside a single page. Counting while reading is the only version of this
 * that can refuse early.
 */
async function readCapped(response: Awaited<ReturnType<typeof fetch>>): Promise<string> {
  const body = response.body;
  if (!body) return '';

  const decoder = new TextDecoder();
  const reader = body.getReader();
  let size = 0;
  let text = '';

  try {
    for (;;) {
      // Annotated because undici types the stream's chunks as `any`, and an
      // `any` flowing into a byte count is how a cap silently stops counting.
      const chunk = (await reader.read()) as { done: boolean; value?: Uint8Array };
      if (chunk.done) break;
      if (!chunk.value) continue;

      size += chunk.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        throw new Error(`response too large, over ${MAX_RESPONSE_BYTES} bytes`);
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => {});
  }

  return text + decoder.decode();
}
