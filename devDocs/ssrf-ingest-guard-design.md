# Design — the ingest address guard

> Intended path: `devDocs/ssrf-ingest-guard-design.md`

Settles the OPEN DECISION recorded in `slice-2-build-spec.md`: *"the ingest URL is not
filtered for private addresses."* That section states the problem and is not repeated here.
This document says what gets built and, where a choice was close, what was traded away.

The gap has been live on `main` since slice 1. It is not introduced by any plan; it is
the absence of a control nobody wrote.

---

## The property this must hold

**No ingest fetch — the root, a crawled page, or a redirect hop — ever opens a socket to
an address that is not public unicast.**

Note the wording. Not "no URL is accepted", which is a weaker claim about strings, and not
"the hostname resolves publicly", which is a claim about a moment in time. The property is
about the address a socket is actually opened to, because that is the thing an attacker
cares about and the only thing that ends in a response body.

---

## Why one filter is two filters

The build spec already rules that a filter in one place is not a filter: the API decides
what to enqueue, the worker decides what to request. Both get one, and they are not the
same filter.

| | `apps/api` `startIngestion` | `apps/workers` `fetchPage` |
|---|---|---|
| Runs | Once, in the HTTP request | On every connection, forever |
| Answers | "should this be a job at all?" | "may this socket open?" |
| Failure mode | 400 to the owner, no job | the fetch fails, crawl continues |
| Is it the defence? | **No.** A fast fail. | **Yes.** |

Saying which one is the defence matters, because the API's check is the one with a race in
it and the worker's is the one without. If someone later deletes the API check for
latency, the property above still holds. Delete the worker's and it is gone.

---

## The worker: the guard is in the socket

`fetchPage` gets an `undici.Agent` whose `connect.lookup` is the guard, and the address
the guard returns is the address dialled. There is no second resolution, so DNS rebinding
has no gap to aim at — the classic resolve-then-connect race needs two resolutions and
this has one.

The second reason to put it here is structural: a connector cannot be forgotten. The
crawler in `website.adapter.ts` fetches up to 25 same-origin pages and every one of them
goes through this Agent, as does every redirect hop. There is no call site to audit,
because there is no call site — there is a socket, and the socket is guarded.

**Three facts established by probing undici 7.29.0 rather than by reading its docs:**

1. `connect.lookup` is genuinely forwarded to the connector. It was called.
2. It is called with `{ hints: 0, all: true }`, so the callback must return an **array** of
   `{ address, family }`. Answering with the ordinary Node triple `(null, '127.0.0.1', 4)`
   fails the request with `Invalid IP address: undefined`.
3. Pinning does not break name-based hosting over HTTP. Dialling `127.0.0.1` for a request
   to `shop.invalid:57472` still sent `Host: shop.invalid:57472`. The probe was plaintext,
   so the TLS servername travelling the same way is an expectation, not a measurement —
   it is confirmed by crawling an HTTPS site during manual verification, and if it is
   wrong the symptom is loud (a certificate mismatch), not silent.

That undici asks for *all* addresses is convenient rather than incidental: the guard
resolves, drops nothing silently, and returns only the addresses that passed. If none
passed it calls back an error, and the request never reaches a socket.

Redirects become `redirect: 'manual'` with a loop capped at **5 hops**. Each hop's target
is re-parsed and re-checked at the URL level; its connection is guarded by the same
connector regardless. Automatic redirect following is given up deliberately — it is the
mechanism that would otherwise walk off the public internet in the middle of a request
that already passed its check.

### The byte cap, folded in

`website.adapter.ts` caps a crawl at 4,000,000 bytes total, but counts only after
`response.text()` has already read a whole body into memory. One endpoint that streams
without ending occupies a worker slot until the 10s timeout, and a handful of large
responses overshoot the total cap within a single page.

`fetchPage` is being rewritten anyway, so it reads the body with a running limit and aborts
past it. This is adjacent to the SSRF work rather than part of it, and is recorded here so
the diff does not look like scope that arrived unannounced.

---

## The API: a fast fail, and its two named costs

`startIngestion` runs the URL-level check, then resolves the hostname with
`dns.promises.lookup` under a **2 second** timeout, and rejects with a new
`BlockedSourceUrlError` — 400, code `BLOCKED_SOURCE_URL`. A lookup that fails or times out
rejects; an address this check cannot see is not an address it lets through.

Without this the owner pastes a URL, gets a cheerful 202, waits, and finds a failed
ingestion in the poll with a generic error. That reads as a broken product rather than a
refused address.

**Cost one — a network call inside an HTTP request.** The build spec's rule is that
nothing slow runs in a request. This bends it. What bounds it: the 2s timeout, and the
ingest rate limit that already exists on the route. It is written here rather than left
for someone to discover in a trace.

**Cost two — a DNS oracle.** An owner can now learn whether a name resolves into a private
range by watching which error comes back. Accepted: the caller needs a verified account, a
session, and ownership of the page, and the alternative is the worse error experience
above. The leak is one bit about the attacker's own DNS records in the common case.

---

## The shared code, and why `node:dns` stays out of it

Two modules in `packages/core`, both pure:

- **`address.ts`** — `isBlockedAddress(ip)`. Classifies a numeric literal against the
  special-use registries. No imports at all.
- **`source-url.ts`** — `inspectSourceUrl(input)` for the URL-level pass, and
  `filterPublicAddresses(entries, { allowPrivate })`, which takes what a resolver already
  returned and hands back the addresses that passed, or throws when none did.

Neither module resolves anything. That is the point: `node:dns` stays out of
`@curios/core`, and every case in the table below runs without a network. The barrel is
already Node-only — it re-exports a module importing `node:crypto`, which is why
`middleware.ts` imports `@curios/core/cookie` rather than the barrel — so importing
`node:dns` would break nothing today. It stays out because a guard whose tests need a
resolver is a guard whose tests are unreliable, not merely slow.

Each app supplies its own resolution and composes the same two functions:

```
apps/api      inspectSourceUrl → dns.promises.lookup(host, { all: true })
                              → filterPublicAddresses → reject or enqueue

apps/workers  connect.lookup(host, { all: true }, cb)
                              → dns.lookup(host, { all: true })
                              → filterPublicAddresses → cb(null, vetted) or cb(err)
```

Two callers, one classifier, no second opinion about what "private" means. The worker's
composition is the guard itself — `filterPublicAddresses` returning the vetted list *is*
what undici dials, which is why the pinning has no gap between deciding and connecting.

### What the URL-level pass rejects before any resolution

Protocol other than `http:`/`https:` (already there, kept), embedded credentials
(`http://user:pw@host/` — the parser accepts them and no legitimate paste has them), and
any hostname that is an IP literal, classified directly.

The literal case needs less code than it appears to. WHATWG parsing already normalizes
`http://2130706433/`, `http://0177.0.0.1/`, `http://0x7f000001/` and `http://127.1/` all to
hostname `127.0.0.1`, so the decimal and octal spellings the build spec worried about are
folded before the classifier sees them. The one that does *not* fold conveniently is
IPv4-mapped IPv6: `[::ffff:127.0.0.1]` comes out as `[::ffff:7f00:1]`. The classifier reads
the hex-compressed form, and a test pins that exact string, because this is precisely the
spelling a half-written filter misses.

---

## The escape hatch

`INGEST_ALLOW_PRIVATE_ADDRESSES`, compared `=== 'true'`. Unset, empty, `TRUE`, `1` and
`yes` all deny — a typo fails closed. Read at the edge in each app and passed inward as a
boolean, so a test sets an argument rather than mutating the environment.

It exists because the ingest job's end-to-end verification points the crawler at a local
static page, and that is how the gap was found in the first place. A filter that makes the
verification path impossible is a filter someone comments out.

---

## Tests

The classifier gets a table, and public addresses are in it — a filter that blocks
everything also passes every blocking test.

| Must block | Must allow |
|---|---|
| `10.0.0.1`, `172.16.0.1`, `172.31.255.254`, `192.168.1.1` | `8.8.8.8` |
| `127.0.0.1` and the four spellings that fold to it | `203.0.113.9`† |
| `169.254.169.254`, and `169.254.0.0/16` generally | `1.1.1.1` |
| `100.64.0.1` (CGNAT), `100.100.100.200` | `2606:4700:4700::1111` |
| `0.0.0.0`, `255.255.255.255`, `224.0.0.1`, `240.0.0.1` | |
| `::1`, `::`, `fc00::1`, `fe80::1`, `ff02::1` | |
| `::ffff:7f00:1` — the compressed mapped form | |
| `64:ff9b::7f00:1` — NAT64 wrapping 127.0.0.1 | |

† `203.0.113.0/24` is TEST-NET-3 and is *not* globally routable. It is in the allow column
deliberately: this guard's job is private-network reachability, not routability pedantry,
and blocking documentation ranges buys nothing while adding entries that look arbitrary to
the next reader. Named so it reads as a decision rather than an oversight.

Beyond the table:

- A host resolving to `[public, private]` is rejected. Not "the first address is checked" —
  the mixed answer is the whole trick.
- API: a hostname resolving private returns 400 `BLOCKED_SOURCE_URL`, creates **no**
  `Ingestion` row, and enqueues nothing. The absence of the row is the assertion that
  matters; a rejected URL that still leaves a row is a queue of attempts.
- Worker: the pinning is proven, not assumed. A lookup returning a blocked address must
  reject, and the address dialled must be the one the guard returned. If undici ever stops
  forwarding `lookup`, this test fails rather than the guard silently detaching.
- Worker: a redirect to a private target is refused, and the hop cap holds.
- The flag denies for every non-`true` string, including `TRUE`.

**What no test here covers**, stated plainly: a real DNS rebinding attack against a live
nameserver, and TLS-to-a-vhost through the pinned connector. The first is closed by
construction rather than by assertion — there is one resolution, so there is nothing to
race — and the second is covered by the probe recorded above plus the ordinary crawl of an
HTTPS site during manual verification.

---

## Documents this corrects

| Document | Correction |
|---|---|
| `slice-2-build-spec.md` | The OPEN DECISION on private addresses is replaced by the ruling, with what remains uncovered kept |
| `.env.example` | `INGEST_ALLOW_PRIVATE_ADDRESSES`, with a comment saying it is a local-verification switch |
