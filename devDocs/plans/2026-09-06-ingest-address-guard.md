# Ingest Address Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** No ingest fetch — the root URL, a crawled page, or a redirect hop — ever opens a socket to an address that is not public unicast.

**Architecture:** One pure address classifier in `packages/core`, with no resolver of its own, used by two independent callers. `apps/api` resolves in the request for a fast, specific 400. `apps/workers` puts the guard inside `undici`'s `connect.lookup`, so the vetted address is the address dialled and there is no second resolution for DNS rebinding to race. The worker's copy is the defence; the API's is a courtesy.

**Tech Stack:** TypeScript, vitest, `node:dns`, `undici` 7.x (new direct dependency of `apps/workers`), Fastify, BullMQ.

**Spec:** `devDocs/ssrf-ingest-guard-design.md` — read it before Task 1. It carries the reasoning this plan only executes, including the two probe results that shaped the interfaces.

## Global Constraints

- Node 22, ESM throughout. **Every relative import ends in `.js`**, even from a `.ts` file — `import { isBlockedAddress } from './address.js'`. This is not optional; the build fails otherwise.
- `packages/core` imports nothing from `node:` in these two new modules. The resolver is always injected or supplied by the caller. A test that needs DNS is a test that needs a network, and none of these do.
- Tests are `vitest`. Comments explain *why*, not *what* — match the density in `packages/core/src/handle.ts`.
- Gates, all four, from the repo root: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.
- `apps/api` tests need Postgres: `DATABASE_URL_TEST` must be set and `docker compose up -d` running.
- Never widen an error message to include a resolved IP address. `apps/workers/src/ingestion/extract.service.ts:125-128` writes a failed job's `error.message` into `Ingestion.error`, and `getIngestion` returns that field to the owner.
- The env flag is compared `=== 'true'` and nothing else. `TRUE`, `1`, `yes` and empty all mean deny.

---

### Task 1: The address classifier

The pure core. It answers one question about one numeric address and knows nothing about URLs, DNS, or HTTP.

**Files:**
- Create: `packages/core/src/address.ts`
- Test: `packages/core/src/address.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `isBlockedAddress(address: string): boolean`. Accepts a bare numeric address (`'10.0.0.1'`, `'::1'`), tolerates brackets (`'[::1]'`) and an IPv6 zone suffix (`'fe80::1%eth0'`). Returns `true` for anything it cannot parse.

- [ ] **Step 1: Write the failing test**

`packages/core/src/address.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isBlockedAddress } from './address.js';

describe('isBlockedAddress, IPv4', () => {
  it.each([
    ['10.0.0.1', 'private class A'],
    ['172.16.0.1', 'private class B, low end'],
    ['172.31.255.254', 'private class B, high end'],
    ['192.168.1.1', 'private class C'],
    ['127.0.0.1', 'loopback'],
    ['127.255.255.254', 'loopback, the rest of the /8'],
    ['169.254.169.254', 'the cloud metadata address'],
    ['169.254.1.1', 'link-local generally, not just metadata'],
    ['100.64.0.1', 'carrier-grade NAT'],
    ['100.100.100.200', "Alibaba's metadata address, inside CGNAT"],
    ['0.0.0.0', 'unspecified, which is localhost on Linux'],
    ['255.255.255.255', 'broadcast'],
    ['224.0.0.1', 'multicast'],
    ['240.0.0.1', 'reserved'],
    ['192.0.0.1', 'IETF protocol assignments'],
    ['198.18.0.1', 'benchmarking'],
  ])('blocks %s (%s)', (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each([
    ['8.8.8.8'],
    ['1.1.1.1'],
    // TEST-NET-3. Not globally routable, deliberately allowed: this guard is
    // about private-network reachability, not routability. See the design doc.
    ['203.0.113.9'],
    ['172.15.0.1'], // one below the private block
    ['172.32.0.1'], // one above it
    ['100.63.0.1'], // one below CGNAT
    ['100.128.0.1'], // one above it
  ])('allows %s', (address) => {
    expect(isBlockedAddress(address)).toBe(false);
  });
});

describe('isBlockedAddress, IPv6', () => {
  it.each([
    ['::1', 'loopback'],
    ['::', 'unspecified'],
    ['fc00::1', 'unique local, low end of the /7'],
    ['fdff::1', 'unique local, high end'],
    ['fe80::1', 'link-local'],
    ['ff02::1', 'multicast'],
    // The spelling a careless filter misses. WHATWG URL parsing compresses
    // ::ffff:127.0.0.1 to exactly this, so this is the form that actually
    // arrives, not the readable one.
    ['::ffff:7f00:1', 'IPv4-mapped loopback, hex-compressed'],
    ['::ffff:127.0.0.1', 'IPv4-mapped loopback, dotted'],
    ['::ffff:10.0.0.1', 'IPv4-mapped private'],
    ['64:ff9b::7f00:1', 'NAT64 wrapping loopback'],
    ['64:ff9b::a00:1', 'NAT64 wrapping 10.0.0.1'],
    ['100::1', 'the discard prefix'],
    ['fe80::1%eth0', 'a zone suffix must not defeat the check'],
    ['[::1]', 'brackets must not defeat the check'],
  ])('blocks %s (%s)', (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each([['2606:4700:4700::1111'], ['2404:6800:4003::200e']])('allows %s', (address) => {
    expect(isBlockedAddress(address)).toBe(false);
  });

  it('allows an IPv4-mapped public address, so the unwrap is real and not a blanket block', () => {
    // If ::ffff:* were simply blocked, every test above would still pass and
    // the classifier would be lying about why.
    expect(isBlockedAddress('::ffff:8.8.8.8')).toBe(false);
  });
});

describe('isBlockedAddress, garbage', () => {
  it.each([[''], ['not-an-address'], ['999.1.1.1'], ['10.0.0'], ['1.2.3.4.5'], ['::gggg']])(
    'blocks %s by failing closed',
    (address) => {
      expect(isBlockedAddress(address)).toBe(true);
    },
  );
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @curios/core test`
Expected: FAIL — cannot resolve `./address.js`.

- [ ] **Step 3: Write the classifier**

`packages/core/src/address.ts`:

```ts
/**
 * Is this numeric address one an ingest fetch must never dial?
 *
 * The registries this encodes are IANA's IPv4 and IPv6 special-purpose
 * registries, narrowed to what actually matters here: reaching a machine that
 * is not on the public internet. Documentation ranges -- TEST-NET, 2001:db8 --
 * are deliberately absent. They are unroutable rather than private, blocking
 * them protects nobody, and every entry that protects nobody makes the list
 * harder for the next reader to trust.
 *
 * Unparseable input returns true. There is no address here we can reason
 * about, and the only safe answer to "may I dial this?" is no.
 */
export function isBlockedAddress(address: string): boolean {
  // A zone suffix (fe80::1%eth0) and brackets ([::1]) are both spellings the
  // classifier must see through rather than fail to parse and accidentally
  // block for the wrong reason. Blocked-for-the-wrong-reason passes tests and
  // hides a parser that does not work.
  const bare = address.trim().replace(/^\[/, '').replace(/\]$/, '').split('%')[0] ?? '';

  const v4 = parseIPv4(bare);
  if (v4) return isBlockedV4(v4);

  const v6 = parseIPv6(bare);
  if (v6) return isBlockedV6(v6);

  return true;
}

/** Dotted quad only. Every other IPv4 spelling is folded by URL parsing before it reaches here. */
function parseIPv4(value: string): number[] | null {
  const parts = value.split('.');
  if (parts.length !== 4) return null;

  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    octets.push(n);
  }
  return octets;
}

function isBlockedV4(o: number[]): boolean {
  const [a = 0, b = 0, c = 0] = o;

  if (a === 0) return true; // 0.0.0.0/8 -- and 0.0.0.0 itself reaches localhost
  if (a === 10) return true; // 10/8
  if (a === 127) return true; // 127/8
  if (a === 169 && b === 254) return true; // 169.254/16, metadata included
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 0 && c === 0) return true; // 192.0.0/24
  if (a === 192 && b === 168) return true; // 192.168/16
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18/15
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10
  if (a >= 224) return true; // multicast, reserved, broadcast

  return false;
}

/** Returns eight 16-bit groups, or null. Handles `::` and a trailing dotted IPv4. */
function parseIPv6(value: string): number[] | null {
  if (!value.includes(':')) return null;

  let text = value;
  let embedded: number[] | null = null;

  // A trailing IPv4 (::ffff:127.0.0.1) occupies the last two groups.
  if (text.includes('.')) {
    const cut = text.lastIndexOf(':');
    const v4 = parseIPv4(text.slice(cut + 1));
    if (!v4) return null;
    embedded = [((v4[0] ?? 0) << 8) | (v4[1] ?? 0), ((v4[2] ?? 0) << 8) | (v4[3] ?? 0)];
    text = text.slice(0, cut);
  }

  const halves = text.split('::');
  if (halves.length > 2) return null;

  const head = parseGroups(halves[0] ?? '');
  const tail = halves.length === 2 ? parseGroups(halves[1] ?? '') : [];
  if (!head || !tail) return null;

  const known = head.length + tail.length + (embedded?.length ?? 0);

  if (halves.length === 2) {
    // '::' must stand for at least one group, so a full eight without it is malformed.
    if (known > 7) return null;
    return [...head, ...new Array<number>(8 - known).fill(0), ...tail, ...(embedded ?? [])];
  }

  if (known !== 8) return null;
  return [...head, ...tail, ...(embedded ?? [])];
}

function parseGroups(text: string): number[] | null {
  if (text === '') return [];
  const out: number[] = [];
  for (const group of text.split(':')) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
    out.push(Number.parseInt(group, 16));
  }
  return out;
}

function isBlockedV6(g: number[]): boolean {
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] = g;

  // Anything wrapping an IPv4 address is judged as that IPv4 address. This one
  // rule covers ::, ::1, the IPv4-mapped ::ffff:x and the deprecated
  // IPv4-compatible ::x forms, so none of them can smuggle 127.0.0.1 past a
  // check that only knows how to read four octets.
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && (g5 === 0 || g5 === 0xffff)) {
    return isBlockedV4(unwrapV4(g6, g7));
  }

  // NAT64. 64:ff9b::/96 exists precisely to carry an IPv4 address, and a
  // translator on the far side will happily carry it to a private one.
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) {
    return isBlockedV4(unwrapV4(g6, g7));
  }

  if (g0 === 0x100 && g1 === 0 && g2 === 0 && g3 === 0) return true; // 100::/64 discard
  if ((g0 & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g0 & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g0 & 0xff00) === 0xff00) return true; // ff00::/8 multicast

  return false;
}

function unwrapV4(high: number, low: number): number[] {
  return [(high >> 8) & 0xff, high & 0xff, (low >> 8) & 0xff, low & 0xff];
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @curios/core test`
Expected: PASS, every case.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/address.ts packages/core/src/address.test.ts
git commit -m "feat(core): classify an address as one the crawler may dial"
```

---

### Task 2: The URL pass, the answer rule, and the flag

Everything else `packages/core` owns: what a pasted string must look like before anyone resolves it, what to do with an answer once someone has, and how the escape hatch is read.

**Files:**
- Create: `packages/core/src/source-url.ts`
- Test: `packages/core/src/source-url.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `isBlockedAddress` from Task 1.
- Produces, all exported from the `@curios/core` barrel:
  - `type SourceUrlVerdict = { ok: true; url: URL; hostname: string } | { ok: false; reason: 'unparseable' | 'not_http' | 'has_credentials' | 'blocked_address' }`
  - `inspectSourceUrl(input: string): SourceUrlVerdict`
  - `interface ResolvedAddress { address: string; family: number }`
  - `requirePublicAddresses(entries: readonly ResolvedAddress[], options: { allowPrivate: boolean }): ResolvedAddress[]`
  - `class BlockedAddressError extends Error` with `readonly code = 'BLOCKED_SOURCE_URL'` and `readonly blocked: string` (the offending address, **for logs only**)
  - `allowsPrivateAddresses(raw: string | undefined): boolean`

- [ ] **Step 1: Write the failing test**

`packages/core/src/source-url.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  allowsPrivateAddresses,
  BlockedAddressError,
  inspectSourceUrl,
  requirePublicAddresses,
} from './source-url.js';

describe('inspectSourceUrl', () => {
  it('accepts an ordinary shop URL', () => {
    const verdict = inspectSourceUrl('https://nadiabakes.com/menu');
    expect(verdict).toMatchObject({ ok: true, hostname: 'nadiabakes.com' });
  });

  it.each([
    ['file:///etc/passwd', 'not_http'],
    ['gopher://example.com/', 'not_http'],
    ['not a url at all', 'unparseable'],
    ['', 'unparseable'],
  ])('refuses %s as %s', (input, reason) => {
    expect(inspectSourceUrl(input)).toEqual({ ok: false, reason });
  });

  it('refuses embedded credentials', () => {
    // The parser accepts them and no legitimate paste has them, so they are
    // far likelier to be an attempt at a service that reads userinfo than a
    // shop owner's website.
    expect(inspectSourceUrl('http://user:pw@example.com/')).toEqual({
      ok: false,
      reason: 'has_credentials',
    });
  });

  it.each([
    ['http://127.0.0.1/', 'the plain spelling'],
    ['http://2130706433/', 'decimal'],
    ['http://0177.0.0.1/', 'octal'],
    ['http://0x7f000001/', 'hex'],
    ['http://127.1/', 'short form'],
    ['http://[::1]/', 'IPv6 loopback'],
    ['http://[::ffff:127.0.0.1]/', 'IPv4-mapped'],
    ['http://[fd00::1]/', 'unique local'],
    ['http://169.254.169.254/latest/meta-data/', 'cloud metadata'],
  ])('refuses %s (%s) without resolving anything', (input) => {
    expect(inspectSourceUrl(input)).toEqual({ ok: false, reason: 'blocked_address' });
  });

  it('strips the brackets from an IPv6 hostname it accepts', () => {
    // url.hostname keeps them, and a resolver handed '[2606:...]' will fail in
    // a way that looks like a network problem rather than a bug here.
    const verdict = inspectSourceUrl('http://[2606:4700:4700::1111]/');
    expect(verdict).toMatchObject({ ok: true, hostname: '2606:4700:4700::1111' });
  });

  it('does not judge a hostname, because it cannot', () => {
    // localhost is blocked by what it resolves to, not by its spelling. A name
    // check here would imply a completeness this function cannot have.
    expect(inspectSourceUrl('http://localhost:8099/')).toMatchObject({ ok: true });
  });
});

describe('requirePublicAddresses', () => {
  const publicOne = { address: '203.0.113.9', family: 4 };
  const privateOne = { address: '127.0.0.1', family: 4 };

  it('returns every address when all of them are public', () => {
    expect(requirePublicAddresses([publicOne], { allowPrivate: false })).toEqual([publicOne]);
  });

  it('rejects the whole answer when any one address is private', () => {
    // The mixed answer is the entire trick. Filtering the private entry out and
    // dialling the survivor is the plausible-looking version of this function
    // that does not work.
    expect(() => requirePublicAddresses([publicOne, privateOne], { allowPrivate: false })).toThrow(
      BlockedAddressError,
    );
  });

  it('rejects an empty answer', () => {
    expect(() => requirePublicAddresses([], { allowPrivate: false })).toThrow(BlockedAddressError);
  });

  it('keeps the offending address off the message and on the error', () => {
    // extract.service.ts writes error.message into Ingestion.error, which
    // getIngestion returns to the owner. The message is for them; `blocked` is
    // for the log.
    try {
      requirePublicAddresses([privateOne], { allowPrivate: false });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(BlockedAddressError);
      expect((error as BlockedAddressError).message).not.toContain('127.0.0.1');
      expect((error as BlockedAddressError).blocked).toBe('127.0.0.1');
    }
  });

  it('lets everything through when private addresses are allowed', () => {
    expect(requirePublicAddresses([privateOne], { allowPrivate: true })).toEqual([privateOne]);
  });
});

describe('allowsPrivateAddresses', () => {
  it('allows only the exact string true', () => {
    expect(allowsPrivateAddresses('true')).toBe(true);
  });

  it.each([[undefined], [''], ['TRUE'], ['True'], ['1'], ['yes'], ['false'], [' true']])(
    'denies %s',
    (raw) => {
      expect(allowsPrivateAddresses(raw)).toBe(false);
    },
  );
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @curios/core test`
Expected: FAIL — cannot resolve `./source-url.js`.

- [ ] **Step 3: Write the module**

`packages/core/src/source-url.ts`:

```ts
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

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, reason: 'not_http' };
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
```

- [ ] **Step 4: Export from the barrel**

Append to `packages/core/src/index.ts`:

```ts
export { isBlockedAddress } from './address.js';
export {
  allowsPrivateAddresses,
  BlockedAddressError,
  inspectSourceUrl,
  requirePublicAddresses,
} from './source-url.js';
export type { ResolvedAddress, SourceUrlVerdict } from './source-url.js';
```

- [ ] **Step 5: Run the tests and the typecheck**

Run: `pnpm --filter @curios/core test && pnpm --filter @curios/core typecheck`
Expected: PASS both.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/source-url.ts packages/core/src/source-url.test.ts packages/core/src/index.ts
git commit -m "feat(core): the URL pass, the answer rule, and the switch"
```

---

### Task 3: The API's fast fail

`startIngestion` stops accepting addresses it can already tell are wrong. This is not the defence — Task 4 is — and the code says so.

**Files:**
- Create: `apps/api/src/modules/ingest/host-guard.ts`
- Test: `apps/api/src/modules/ingest/host-guard.test.ts`
- Modify: `apps/api/src/modules/ingest/ingest.service.ts`
- Modify: `apps/api/src/modules/ingest/ingest.service.test.ts`
- Modify: `apps/api/src/modules/ingest/ingest.routes.ts`
- Modify: `apps/api/src/modules/ingest/ingest.authz.test.ts`
- Modify: `apps/api/src/app.ts:48-52` (the `AppOverrides` interface) and `apps/api/src/app.ts:95` (the registration)

**Interfaces:**
- Consumes: `inspectSourceUrl`, `requirePublicAddresses`, `allowsPrivateAddresses`, `BlockedAddressError`, `ResolvedAddress` from Task 2.
- Produces:
  - `type HostGuard = (hostname: string) => Promise<void>` — resolves if the host may be crawled, throws `BlockedAddressError` otherwise.
  - `createHostGuard(options?: { lookup?: LookupAll; allowPrivate?: boolean; timeoutMs?: number }): HostGuard`
  - `type LookupAll = (hostname: string) => Promise<ResolvedAddress[]>`
  - `IngestDeps` gains a **required** `guard: HostGuard`.
  - `BlockedSourceUrlError` in `ingest.service.ts` — `statusCode = 400`, `code = 'BLOCKED_SOURCE_URL'`.
  - `interface IngestRouteOptions { guard?: HostGuard }`, and `AppOverrides` gains `ingest?: IngestRouteOptions`.

**Why `guard` is required rather than optional:** an optional dependency with a live default is one someone forgets to pass and never notices. Making it required breaks every call site at typecheck, which is the point — each one then states what it resolves with.

- [ ] **Step 1: Write the failing test for the guard**

`apps/api/src/modules/ingest/host-guard.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { BlockedAddressError, type ResolvedAddress } from '@curios/core';
import { createHostGuard } from './host-guard.js';

const publicAnswer: ResolvedAddress[] = [{ address: '203.0.113.9', family: 4 }];

describe('createHostGuard', () => {
  it('passes a host that resolves publicly', async () => {
    const guard = createHostGuard({ lookup: async () => publicAnswer });
    await expect(guard('nadiabakes.com')).resolves.toBeUndefined();
  });

  it('rejects a host that resolves into a private range', async () => {
    const guard = createHostGuard({
      lookup: async () => [{ address: '10.0.0.5', family: 4 }],
    });
    await expect(guard('internal.example')).rejects.toBeInstanceOf(BlockedAddressError);
  });

  it('rejects a host that will not resolve at all', async () => {
    // An address this check cannot see is not an address it lets through.
    const guard = createHostGuard({
      lookup: async () => {
        throw new Error('ENOTFOUND');
      },
    });
    await expect(guard('nope.invalid')).rejects.toBeInstanceOf(BlockedAddressError);
  });

  it('rejects rather than hangs when resolution outlasts the timeout', async () => {
    vi.useFakeTimers();
    const guard = createHostGuard({
      lookup: () => new Promise<ResolvedAddress[]>(() => {}),
      timeoutMs: 2000,
    });
    const pending = expect(guard('slow.example')).rejects.toBeInstanceOf(BlockedAddressError);
    await vi.advanceTimersByTimeAsync(2001);
    await pending;
    vi.useRealTimers();
  });

  it('waves everything through when private addresses are allowed', async () => {
    const guard = createHostGuard({
      lookup: async () => [{ address: '127.0.0.1', family: 4 }],
      allowPrivate: true,
    });
    await expect(guard('localhost')).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @curios/api test host-guard`
Expected: FAIL — cannot resolve `./host-guard.js`.

- [ ] **Step 3: Write the guard**

`apps/api/src/modules/ingest/host-guard.ts`:

```ts
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
export function createHostGuard(options: {
  lookup?: LookupAll;
  allowPrivate?: boolean;
  timeoutMs?: number;
} = {}): HostGuard {
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
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @curios/api test host-guard`
Expected: PASS, five tests.

- [ ] **Step 5: Write the failing service test**

Add to `apps/api/src/modules/ingest/ingest.service.test.ts`, inside `describe('startIngestion')`:

```ts
  it('refuses a url whose host resolves privately, and leaves no row behind', async () => {
    const add = vi.fn<QueueLike['add']>(async () => ({ id: 'job-1' }));
    await expect(
      startIngestion(
        { prisma, queue: { add }, guard: async () => { throw new BlockedAddressError('10.0.0.5'); } },
        accountId,
        { pageId, sourceUrl: 'https://internal.example/' },
      ),
    ).rejects.toMatchObject({ code: 'BLOCKED_SOURCE_URL', statusCode: 400 });

    // The absence of the row is the assertion that matters. A refused URL that
    // still writes one turns the table into a log of attempts.
    expect(await prisma.ingestion.count()).toBe(0);
    expect(add).not.toHaveBeenCalled();
  });

  it('refuses an address literal before it resolves anything', async () => {
    const add = vi.fn<QueueLike['add']>(async () => ({ id: 'job-1' }));
    const guard = vi.fn(async () => {});
    await expect(
      startIngestion({ prisma, queue: { add }, guard }, accountId, {
        pageId,
        sourceUrl: 'http://169.254.169.254/latest/meta-data/',
      }),
    ).rejects.toMatchObject({ code: 'BLOCKED_SOURCE_URL' });
    expect(guard).not.toHaveBeenCalled();
  });

  it('refuses embedded credentials', async () => {
    const add = vi.fn<QueueLike['add']>(async () => ({ id: 'job-1' }));
    await expect(
      startIngestion({ prisma, queue: { add }, guard: async () => {} }, accountId, {
        pageId,
        sourceUrl: 'http://user:pw@nadia.example/',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_SOURCE_URL' });
  });
```

Then update the import at the top of the file and **every existing** `startIngestion` call in it to pass a guard. There are four, at the calls inside `'creates a queued ingestion row and enqueues a job'`, `'passes an idempotency key so a replayed job does not duplicate work'`, `'rejects a non-http source url before touching the queue'`, and any added above:

```ts
import { BlockedAddressError } from '@curios/core';
```

and in each existing call, change `{ prisma, queue: { add } }` to `{ prisma, queue: { add }, guard: async () => {} }`.

**This is required, not cosmetic:** the fixtures use `https://nadia.example/`, and `.example` is a reserved TLD that never resolves. Without an injected guard those tests would perform real DNS, fail, and fail differently depending on the network.

- [ ] **Step 6: Run to verify RED**

Run: `pnpm --filter @curios/api test ingest.service`
Expected: FAIL — `guard` is not a property of `IngestDeps`, and the three new tests fail.

- [ ] **Step 7: Wire the service**

In `apps/api/src/modules/ingest/ingest.service.ts`, add the import, the error, the dep, and the two checks:

```ts
import { BlockedAddressError, inspectSourceUrl } from '@curios/core';
import type { HostGuard } from './host-guard.js';
```

```ts
export interface IngestDeps {
  prisma: PrismaClient;
  queue: QueueLike;
  /** Required on purpose: an optional guard with a live default is one a caller forgets. */
  guard: HostGuard;
}

export class BlockedSourceUrlError extends Error {
  readonly statusCode = 400;
  readonly code = 'BLOCKED_SOURCE_URL';
  constructor() {
    super('That address points somewhere this crawler will not go.');
    this.name = 'BlockedSourceUrlError';
  }
}
```

Replace the parse-and-protocol block at the top of `startIngestion` with:

```ts
  const verdict = inspectSourceUrl(input.sourceUrl);
  if (!verdict.ok) {
    // Two errors, not one. A bad scheme is the owner mistyping; a private
    // address is a different answer to a different question, and the codes are
    // what the web app keys its message off.
    if (verdict.reason === 'blocked_address') throw new BlockedSourceUrlError();
    throw new InvalidSourceUrlError();
  }
  const url = verdict.url;

  // Resolution before the ownership check would let a stranger use this as a
  // resolver for pages they do not own.
  const page = await deps.prisma.page.findFirst({
    where: { id: input.pageId, accountId },
    select: { id: true },
  });
  if (!page) throw new PageNotYoursError();

  try {
    await deps.guard(verdict.hostname);
  } catch (error) {
    if (error instanceof BlockedAddressError) throw new BlockedSourceUrlError();
    throw error;
  }
```

and delete the now-duplicated `page` lookup that followed it, leaving the `prisma.ingestion.create` call as the next statement.

- [ ] **Step 8: Run to verify GREEN**

Run: `pnpm --filter @curios/api test ingest.service`
Expected: PASS.

- [ ] **Step 9: Wire the route and the app**

`apps/api/src/modules/ingest/ingest.routes.ts` — take options the way `authRoutes` does:

```ts
import { createHostGuard, type HostGuard } from './host-guard.js';

export interface IngestRouteOptions {
  guard?: HostGuard;
}

export const ingestRoutes: FastifyPluginAsyncZod<IngestRouteOptions> = async (app, options) => {
  // One guard for the lifetime of the app, so the env flag is read once.
  const guard = options.guard ?? createHostGuard();
```

then add `400` responses for the new code (the existing `errorSchema` already covers the shape) and pass the guard through:

```ts
      const result = await startIngestion(
        { prisma: app.prisma, queue: app.ingestQueue, guard },
        request.account.id,
        request.body,
      );
```

`apps/api/src/app.ts` — extend the overrides interface at line 48 and the registration at line 95:

```ts
import { ingestRoutes, type IngestRouteOptions } from './modules/ingest/ingest.routes.js';

export interface AppOverrides {
  auth?: AuthRouteOptions;
  ingest?: IngestRouteOptions;
}
```

```ts
    await scope.register(ingestRoutes, overrides.ingest ?? {});
```

- [ ] **Step 10: Keep the authz tests off the network**

`apps/api/src/modules/ingest/ingest.authz.test.ts` builds the whole app and posts `https://example.com/`. Give it a guard so the suite never resolves anything:

```ts
beforeAll(async () => {
  // A real lookup here would make an authorization suite depend on DNS, and
  // fail offline for a reason that has nothing to do with authorization.
  app = await buildApp({ ingest: { guard: async () => {} } });
  await app.ready();
});
```

Then add one route-level test to the same file, proving the code reaches the client:

```ts
  it('answers 400 with BLOCKED_SOURCE_URL for a private address', async () => {
    const mine = await anOwnerWithAPage();

    const res = await app.inject({
      method: 'POST',
      url: '/ingest',
      remoteAddress: from(),
      headers: { cookie: `${SESSION_COOKIE}=${mine.cookie}` },
      payload: { pageId: mine.pageId, sourceUrl: 'http://169.254.169.254/latest/meta-data/' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('BLOCKED_SOURCE_URL');
  });
```

- [ ] **Step 11: Run the API suite**

Run: `pnpm --filter @curios/api test`
Expected: PASS, including the previously existing tests.

- [ ] **Step 12: Commit**

```bash
git add apps/api/src/modules/ingest apps/api/src/app.ts
git commit -m "feat(api): refuse an address the crawler must not be sent to"
```

---

### Task 4: The worker's guarded fetch

The defence. Everything above is a convenience; this is the thing that has to be right.

**Files:**
- Create: `apps/workers/src/ingestion/safe-fetch.ts`
- Test: `apps/workers/src/ingestion/safe-fetch.test.ts`
- Modify: `apps/workers/package.json`

**Interfaces:**
- Consumes: `inspectSourceUrl`, `requirePublicAddresses`, `BlockedAddressError` from Task 2.
- Produces:
  - `createGuardedAgent(options: { allowPrivate: boolean; onBlocked?: (hostname: string, blocked: string) => void }): Agent`
  - `fetchGuarded(target: string, deps: { agent: Dispatcher }): Promise<string>`
  - `MAX_RESPONSE_BYTES` (2,000,000) and `MAX_HOPS` (5), exported so the tests name the same numbers the code does.

- [ ] **Step 1: Add undici**

```bash
pnpm --filter @curios/workers add undici@^7.29.0
```

It is already in the tree transitively; this makes the dependency the code actually relies on a declared one.

- [ ] **Step 2: Write the failing test**

`apps/workers/src/ingestion/safe-fetch.test.ts`:

```ts
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BlockedAddressError } from '@curios/core';
import { createGuardedAgent, fetchGuarded, MAX_RESPONSE_BYTES } from './safe-fetch.js';

let server: Server | undefined;

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server?.close(() => resolve()));
  server = undefined;
});

async function serve(handler: Parameters<typeof createServer>[1]): Promise<number> {
  server = createServer(handler);
  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
}

describe('createGuardedAgent', () => {
  it('dials the address the guard returned, not one it resolved again', async () => {
    // The whole point of pinning, asserted end to end: the hostname is one that
    // does not exist, resolution is entirely ours, and the request still lands.
    const port = await serve((req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(`<title>ok</title><p>host was ${req.headers.host}</p>`);
    });
    const agent = createGuardedAgent({ allowPrivate: true });

    const html = await fetchGuarded(`http://shop.invalid:${port}/`, { agent });

    expect(html).toContain(`host was shop.invalid:${port}`);
    await agent.close();
  });

  it('refuses to connect when the answer contains a private address', async () => {
    // allowPrivate is false and 127.0.0.1 is where the server is, so this must
    // fail even though the server is listening and would answer.
    const port = await serve((_req, res) => res.end('<title>reached</title>'));
    const agent = createGuardedAgent({ allowPrivate: false });

    await expect(fetchGuarded(`http://localhost:${port}/`, { agent })).rejects.toThrow();
    await agent.close();
  });

  it('reports a refusal to the caller for the log', async () => {
    const port = await serve((_req, res) => res.end('<title>reached</title>'));
    const onBlocked = vi.fn();
    const agent = createGuardedAgent({ allowPrivate: false, onBlocked });

    await expect(fetchGuarded(`http://localhost:${port}/`, { agent })).rejects.toThrow();
    expect(onBlocked).toHaveBeenCalledWith('localhost', expect.stringMatching(/127\.0\.0\.1|::1/));
    await agent.close();
  });
});

describe('fetchGuarded', () => {
  it('refuses a blocked literal without opening a socket', async () => {
    const agent = createGuardedAgent({ allowPrivate: true });
    await expect(fetchGuarded('http://169.254.169.254/latest/meta-data/', { agent })).rejects.toBeInstanceOf(
      BlockedAddressError,
    );
    await agent.close();
  });

  it('follows a redirect and returns the destination', async () => {
    const port = await serve((req, res) => {
      if (req.url === '/start') {
        res.writeHead(302, { location: '/end' });
        return res.end();
      }
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<title>arrived</title>');
    });
    const agent = createGuardedAgent({ allowPrivate: true });

    expect(await fetchGuarded(`http://shop.invalid:${port}/start`, { agent })).toContain('arrived');
    await agent.close();
  });

  it('refuses a redirect that leaves for a blocked address', async () => {
    // The hop that walks off the public internet after a check has already
    // passed. This is why automatic redirect following is given up.
    const port = await serve((_req, res) => {
      res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' });
      res.end();
    });
    const agent = createGuardedAgent({ allowPrivate: true });

    await expect(fetchGuarded(`http://shop.invalid:${port}/`, { agent })).rejects.toBeInstanceOf(
      BlockedAddressError,
    );
    await agent.close();
  });

  it('gives up on a redirect loop rather than following it forever', async () => {
    let hops = 0;
    const port = await serve((_req, res) => {
      hops += 1;
      res.writeHead(302, { location: '/again' });
      res.end();
    });
    const agent = createGuardedAgent({ allowPrivate: true });

    await expect(fetchGuarded(`http://shop.invalid:${port}/`, { agent })).rejects.toThrow(/redirect/i);
    expect(hops).toBeLessThanOrEqual(6); // the first request plus MAX_HOPS
    await agent.close();
  });

  it('stops reading a body that will not stop arriving', async () => {
    // Without a cap this test never finishes, which is the failure mode in
    // production too: a worker slot held until the deadline.
    const port = await serve((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      const chunk = 'x'.repeat(64 * 1024);
      const pump = () => {
        while (res.write(chunk)) {
          /* keep going until the socket pushes back */
        }
      };
      res.on('drain', pump);
      pump();
    });
    const agent = createGuardedAgent({ allowPrivate: true });

    await expect(fetchGuarded(`http://shop.invalid:${port}/`, { agent })).rejects.toThrow(/too large/i);
    await agent.close();
  }, 20_000);

  it('returns a body that fits', async () => {
    const port = await serve((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<title>small</title>');
    });
    const agent = createGuardedAgent({ allowPrivate: true });

    expect(await fetchGuarded(`http://shop.invalid:${port}/`, { agent })).toBe('<title>small</title>');
    expect(MAX_RESPONSE_BYTES).toBe(2_000_000);
    await agent.close();
  });

  it('throws without naming the resolved address, because the owner reads this', async () => {
    // extract.service.ts writes error.message into Ingestion.error and
    // GET /ingest/:id returns it. Pinned here because improving an error
    // message is exactly how this gets broken later.
    const port = await serve((_req, res) => res.end('<title>reached</title>'));
    const agent = createGuardedAgent({ allowPrivate: false });

    // try/catch rather than a matcher: an assertion about what a message does
    // NOT contain passes trivially if nothing throws, so the unreachable guard
    // is doing real work here.
    try {
      await fetchGuarded(`http://localhost:${port}/`, { agent });
      expect.unreachable('should have refused');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain('127.0.0.1');
      expect(message).not.toContain('::1');
    } finally {
      await agent.close();
    }
  });
});
```

- [ ] **Step 3: Run to verify RED**

Run: `pnpm --filter @curios/workers test safe-fetch`
Expected: FAIL — cannot resolve `./safe-fetch.js`.

- [ ] **Step 4: Write the guarded fetch**

`apps/workers/src/ingestion/safe-fetch.ts`:

```ts
import { lookup as dnsLookup } from 'node:dns';
import { Agent, fetch, type Dispatcher } from 'undici';
import { BlockedAddressError, inspectSourceUrl, requirePublicAddresses } from '@curios/core';

export const MAX_HOPS = 5;
/**
 * Half the crawler's whole-crawl budget of 4,000,000 bytes, so one page cannot
 * spend the entire allowance and starve the other twenty-four.
 */
export const MAX_RESPONSE_BYTES = 2_000_000;
const TOTAL_TIMEOUT_MS = 10_000;
const USER_AGENT = 'CuriosBot/0.1 (+https://curios.my/bot)';

/**
 * An Agent that resolves every connection itself and dials only what it vetted.
 *
 * This is where the guarantee lives. Not in a function someone remembers to
 * call before fetching -- in the connector, so the crawler's twenty-five pages
 * and every redirect hop are covered by construction. There is no call site to
 * audit because there is no call site.
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
}): Agent {
  return new Agent({
    connect: {
      lookup(hostname, _opts, callback) {
        dnsLookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
          if (error) return callback(error, []);
          try {
            const vetted = requirePublicAddresses(addresses, { allowPrivate: options.allowPrivate });
            callback(null, vetted);
          } catch (blocked) {
            if (blocked instanceof BlockedAddressError) options.onBlocked?.(hostname, blocked.blocked);
            callback(blocked as Error, []);
          }
        });
      },
    },
  });
}

/**
 * Fetch one page, following redirects by hand.
 *
 * Automatic following is given up deliberately: it is the mechanism that walks
 * off the public internet in the middle of a request whose first hop passed.
 * The connector guards every hop regardless, so this loop is about the URL
 * level -- a redirect to file:// or to a literal private address is refused
 * before a socket is asked for.
 *
 * One deadline covers the whole chain. Per-hop timeouts would let five
 * redirects hold a worker slot for fifty seconds.
 */
export async function fetchGuarded(target: string, deps: { agent: Dispatcher }): Promise<string> {
  const deadline = AbortSignal.timeout(TOTAL_TIMEOUT_MS);
  let current = target;

  for (let hop = 0; hop <= MAX_HOPS; hop += 1) {
    const verdict = inspectSourceUrl(current);
    if (!verdict.ok) throw new BlockedAddressError(verdict.reason);

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
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        throw new Error(`response too large, over ${MAX_RESPONSE_BYTES} bytes`);
      }
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => {});
  }

  return text + decoder.decode();
}
```

- [ ] **Step 5: Run to verify GREEN**

Run: `pnpm --filter @curios/workers test safe-fetch`
Expected: PASS, every test.

If the pinning test fails with `Invalid IP address: undefined`, the callback is answering with Node's triple instead of an array — that is the probed behaviour in the comment, not a mystery.

**If `tsc` objects to the `lookup` signature**, undici types `connect.lookup` as Node's `LookupFunction`, whose overloads describe the triple form rather than the `all: true` form it actually calls with. Do **not** resolve that by answering with the triple — the probe says the request then fails. Narrow the callback parameter types explicitly and cast at the boundary:

```ts
      lookup(hostname: string, _opts: unknown, callback: (err: Error | null, addresses: ResolvedAddress[]) => void) {
```

with `ResolvedAddress` imported from `@curios/core`, and `connect: { lookup: guardedLookup as never }` if the Agent option still refuses it. A cast at one wiring point, with the probed behaviour named in the comment above it, is honest; changing the runtime shape to satisfy a type is not.

- [ ] **Step 6: Commit**

```bash
git add apps/workers/src/ingestion/safe-fetch.ts apps/workers/src/ingestion/safe-fetch.test.ts apps/workers/package.json pnpm-lock.yaml
git commit -m "feat(workers): a crawler that dials only what it vetted"
```

---

### Task 5: Wire it, switch it, and correct the record

The guard is written and tested but nothing uses it yet. This task makes it live, then closes the OPEN DECISION it settles.

**Files:**
- Modify: `apps/workers/src/ingestion/ingestion.worker.ts`
- Modify: `apps/workers/src/main.ts:15`
- Modify: `.env.example`
- Modify: `devDocs/slice-2-build-spec.md` (the OPEN DECISION on private addresses)
- Modify: `devDocs/plans/2026-09-06-ingest-address-guard.md` (this file — tick the boxes)

**Interfaces:**
- Consumes: `createGuardedAgent`, `fetchGuarded` from Task 4; `allowsPrivateAddresses` from Task 2.
- Produces: `createIngestionWorker` gains an optional `log` in its deps.

- [ ] **Step 1: Wire the worker**

Replace the `fetchPage` function and the adapter construction in `apps/workers/src/ingestion/ingestion.worker.ts`:

```ts
import { Worker } from 'bullmq';
import type IORedis from 'ioredis';
import type { PrismaClient } from '@curios/db';
import type { Gateway } from '@curios/gateway';
import { allowsPrivateAddresses, INGEST_QUEUE, type IngestJobData } from '@curios/core';
import { createWebsiteAdapter } from '../sources/website.adapter.js';
import { QUEUE_CONCURRENCY } from '../queues.js';
import { runExtraction } from './extract.service.js';
import { createGuardedAgent, fetchGuarded } from './safe-fetch.js';

export function createIngestionWorker(deps: {
  connection: IORedis;
  prisma: PrismaClient;
  gateway: Gateway;
  log?: { warn: (details: object, message: string) => void };
}): Worker<IngestJobData> {
  // Read once, at construction. A flag consulted per request is a flag that can
  // change under a running crawl.
  const allowPrivate = allowsPrivateAddresses(process.env.INGEST_ALLOW_PRIVATE_ADDRESSES);

  // One Agent for the process, so connections pool across pages and across jobs.
  const agent = createGuardedAgent({
    allowPrivate,
    onBlocked: (hostname, blocked) => {
      // One owner pasting a wrong URL and someone walking a range look
      // identical one at a time. Only the log can tell them apart.
      deps.log?.warn({ hostname, blocked }, 'ingest fetch refused a non-public address');
    },
  });

  const adapter = createWebsiteAdapter({ fetchPage: (url) => fetchGuarded(url, { agent }) });

  return new Worker<IngestJobData>(
    INGEST_QUEUE,
    async (job) => runExtraction({ prisma: deps.prisma, gateway: deps.gateway, adapter }, job.data),
    { connection: deps.connection, concurrency: QUEUE_CONCURRENCY.ingest },
  );
}
```

- [ ] **Step 2: Pass the logger in**

`apps/workers/src/main.ts:15`:

```ts
const worker = createIngestionWorker({ connection, prisma, gateway, log });
```

- [ ] **Step 3: Document the switch**

Add to `.env.example`, near the other ingest settings:

```bash
# Lets the crawler reach private, loopback and link-local addresses.
# For local verification ONLY -- the manual ingest walkthrough points the
# crawler at a static page on 127.0.0.1. Anything other than the exact string
# "true" denies, so a typo fails closed. Never set this in production.
INGEST_ALLOW_PRIVATE_ADDRESSES=true
```

- [ ] **Step 4: Run all four gates**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build --force
```

Expected: all four pass. `pnpm test` should report more tests than before across `@curios/core`, `@curios/api` and `@curios/workers`.

- [ ] **Step 5: Verify by hand, both ways**

Unit tests cannot prove the flag is wired to the real environment, only that the function reading it works.

1. With `INGEST_ALLOW_PRIVATE_ADDRESSES` **unset**, start the API and workers, sign in, and paste `http://127.0.0.1:8099/` into onboarding. Expect an immediate 400 on the screen, with the blocked-address message rather than the "not a website" one.
2. Serve a static page on `127.0.0.1:8099`, set `INGEST_ALLOW_PRIVATE_ADDRESSES=true`, restart both processes, and paste the same URL. Expect the ingestion to run and facts to land in the review queue, exactly as the existing walkthrough describes.
3. With the flag **unset** again, ingest a real HTTPS site. This is the only check that TLS survives the pinned connector — the design doc records it as an expectation, not a measurement. A certificate or SNI failure shows up here as a failed ingestion.

**Report each of these honestly, including any you did not run.** Step 3 in particular needs a real site and a network.

- [ ] **Step 6: Close the OPEN DECISION**

In `devDocs/slice-2-build-spec.md`, replace the section titled `### OPEN DECISION — the ingest URL is not filtered for private addresses` with a settled record: what was built, that the guard lives in the connector rather than at call sites, the port decision, the DNS-oracle cost the API check accepts, and a pointer to `devDocs/ssrf-ingest-guard-design.md`. Keep the paragraph describing how the gap was found — the walkthrough that pointed the crawler at `127.0.0.1:8099` is still how anyone verifies ingest, and the flag now exists for it.

Do not delete the "what limits it today" reasoning without replacing it. A settled decision that does not say what it traded is worth less than the open one it replaced.

- [ ] **Step 7: Commit**

```bash
git add apps/workers .env.example devDocs
git commit -m "feat(workers): put the address guard on the ingest path"
```

---

## Self-review

**Spec coverage.** Every section of `ssrf-ingest-guard-design.md` maps to a task. The classifier and its registry choices are Task 1, including the TEST-NET ruling as an explicit allow case. The URL pass, the mixed-answer rule and the flag are Task 2. The API's fast fail with its 2s timeout is Task 3. The connector, the manual redirect loop, the single deadline, the byte cap and the log hook are Task 4. Wiring, `.env.example` and the spec correction are Task 5.

**The port decision has no task, deliberately.** It is a decision not to build something, recorded in the design doc. Nothing to implement is not the same as nothing decided.

**Type consistency.** `HostGuard` is defined in Task 3 and used only there. `ResolvedAddress` comes from `@curios/core` and is never redefined. `requirePublicAddresses` keeps that name in Tasks 2, 3 and 4 — it was `filterPublicAddresses` in an earlier draft of the design and the rename is complete in both documents. `BlockedAddressError` is the core error thrown by the shared code; `BlockedSourceUrlError` is the API's HTTP-shaped one, and Task 3 converts between them at exactly one point.

**What no test here covers, stated plainly.** A live DNS rebinding attack, which is closed by construction rather than by assertion — one resolution means nothing to race. TLS through the pinned connector, which is Step 5.3 of Task 5 and must be reported honestly. And whether the env flag reaches the real process, which is Steps 5.1 and 5.2 for the same reason.

**A note on the API test fixtures.** Task 3 Step 5 changes existing passing tests, which usually deserves suspicion. The reason is that `https://nadia.example/` never resolves — `.example` is reserved — so those tests would begin performing real DNS and failing. Injecting the guard makes them hermetic, which they should have been.
