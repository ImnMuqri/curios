import type { HostGuard } from '../ingest/host-guard.js';

const TIMEOUT_MS = 3000;

/**
 * One hop of a short share link (spotify.link and friends): the host is checked first, the
 * request does not follow the redirect, and the answer is the `Location` it points at.
 * Anything that goes wrong -- a private address, a timeout, no redirect -- is null.
 * The caller parses the answer and decides whether it is acceptable.
 */
export async function resolveShortLink(
  url: string,
  deps: { fetch: typeof fetch; guard: HostGuard },
): Promise<string | null> {
  try {
    const host = new URL(url).hostname;
    await deps.guard(host);
    const res = await deps.fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
    const location = res.headers.get('location');
    // Only the Location matters; do not hold the connection open for a body nobody reads.
    await res.body?.cancel().catch(() => undefined);
    if (!location) return null;
    return new URL(location, url).toString();
  } catch {
    return null;
  }
}
