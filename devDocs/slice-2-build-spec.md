# Slice 2 — Owner auth and the fact review screen

Slice 1 built a walking skeleton: a page that answers questions from facts an owner
has verified. It fakes the owner entirely. There is no sign-in, no way to claim a
handle, and the safety gate the whole product rests on — that no unreviewed price
reaches a customer — is operated with `UPDATE "Fact" SET verified = true` in psql.

This slice makes the owner real.

---

## What is in, what is out

| In | Out (and where it goes) |
|---|---|
| Google OAuth, end to end | Connectors — Instagram, Shopee (Pro/Max, later) |
| Email + password sign-in | Admin auth — separate system, see ADMIN.md |
| Email verification and password reset | Phone OTP publishing gate (deferred, below) |
| Session as a database row | `/app` dashboard shell, links/leads/questions screens |
| Handle claim with reserved list and confusables | Handle renames, 301s, 90-day reclaim |
| Onboarding: paste a URL, poll the job | Design system — `packages/ui` (its own slice) |
| The fact review screen | Golden-set harness, crawl breadth |
| Publish | `UsageCounter` caps and over-cap degradation (roadmap 7) |

---

## Two decisions that change earlier specs

Both are deliberate reversals of positions stated in devDocs. They are recorded here
rather than applied silently, and the affected documents are corrected as part of this
slice.

### Passwords are no longer a non-goal

BACKEND.md states: *"Google only. No passwords, no magic links, no email sending on the
login path at all."* Its reasoning is sound and worth preserving in the record — a shop
owner on a phone, a magic link costing four app switches, no credential of ours to leak,
and a dev login path identical to production because no email provider is required.

That is reversed. Google-only turns away anyone without a Google account, which in this
market is a real population, and the cost of that exclusion outweighs the cost of owning
a credential.

The consequences are accepted, not waved away:

- An email provider becomes a dependency of the login path.
- We now own a password hash, and its compromise is our incident.
- A reset flow exists, which is itself an attack surface.

The dev-and-production-are-the-same-path property is preserved by running a local mail
catcher (Mailpit) in `docker-compose.yml` beside Postgres and Redis, on a non-default host
port for the same reason the databases use one. Local signup needs no external account and
no configuration.

**Provider:** the sending interface is one internal module with two implementations
selected by environment — SMTP against Mailpit locally, and a hosted sender in production.
Resend is the default recommendation on setup cost, but nothing outside that module knows
which is in use, so the choice is reversible and is not load-bearing anywhere in this
spec. Mail is sent from a background job, never inside the HTTP request that triggered it,
matching the constraint that nothing slow runs in a request.

### The phone OTP publishing gate is deferred

`slice-1-build-spec.md` lists it as slice 2 work, and BACKEND.md gates publishing on it.
Deferred, because it adds a second external provider to a slice that already grew, and
because the gate proves phone ownership rather than protecting the safety property.
Unverified facts already cannot reach a customer — that is enforced by `verified: true`
filters on both read paths, and it does not depend on OTP.

Publishing in this slice is a plain owner action. When the gate arrives, it wraps that
action; nothing built here has to be undone.

---

## Architecture

### The write path, and why it is shaped this way

`apps/web` connects to Postgres as `curios_readonly`, a SELECT-only role. A test asserts
that a write from a Server Component fails in Postgres with SQLSTATE 42501 rather than in
code review. A global constraint forbids `apps/web` from importing `packages/db` at all.

The review screen's entire purpose is writing. So:

- `apps/web` **renders and reads**, through `packages/db-read`, exactly as it does now.
- Every mutation is a `fetch` from the browser to `apps/api` with `credentials: 'include'`.
- `apps/api` owns all writes and all authorization.

The read-only boundary is not weakened to accommodate the dashboard. It is the reason the
dashboard cannot leak a write.

### The session

A row, not a token.

```prisma
model Session {
  id         String   @id            // sha256 of the cookie value, never the value
  accountId  String
  account    Account  @relation(fields: [accountId], references: [id], onDelete: Cascade)
  expiresAt  DateTime
  createdAt  DateTime @default(now())
  lastSeenAt DateTime @default(now())

  @@index([accountId])
  @@index([expiresAt])
}
```

The cookie carries 32 random bytes, base64url. The row stores only a SHA-256 of that
value. Lookup is by exact match, so hashing costs nothing, and a database leak yields no
usable sessions — the same reasoning that applies to passwords.

`Session` is readable by `curios_readonly` with no grant work, because
`readonly-role.sql` ends with `ALTER DEFAULT PRIVILEGES ... GRANT SELECT ON TABLES`.

**Cookie:** `httpOnly`, `SameSite=Lax`, `Secure` outside development, `Path=/`, and in
production `Domain=.curios.my` so the web and API origins share it. In development the
two ports share it already, because cookies ignore port.

**Lifetime:** 30-day absolute, 14-day idle. Sign-out deletes the row. Sign-out-everywhere
deletes every row for the account. Revocation is immediate, which was the argument for a
row over a JWT.

**Refresh — and a correction to FRONTEND.md.** That document says *"Auth: httpOnly cookie,
refreshed by middleware."* Next middleware cannot refresh it: `apps/web` holds a SELECT-only
connection, so extending `expiresAt` is a write it is structurally incapable of making.
The API extends the session on any authenticated request, at most once per day to avoid a
write per request. FRONTEND.md is corrected in this slice.

### Where the session is validated — three layers, one boundary

Next middleware runs on the Edge runtime, where Prisma cannot run. `experimental.nodeMiddleware`
exists in the pinned Next 15.5.24, but the auth boundary is not a good place to spend an
experimental flag.

| Layer | Does | Runtime |
|---|---|---|
| `middleware.ts` | Checks the cookie is **present**, redirects to sign-in if not | Edge |
| `/app` layout | Validates the session against the database, redirects if invalid | Node |
| `apps/api` | Re-authorizes **every** mutation independently | Node |

The middleware is a redirect convenience and is never the security boundary. Nothing is
authorized because middleware let a request through.

### CSRF

Three mechanisms already stack: `SameSite=Lax` means a cross-site POST carries no cookie,
an `application/json` content type forces a preflight, and CORS permits exactly one
origin. No CSRF token is used.

**This is an assumption, not a conclusion.** If CORS is ever widened, or the API accepts
form-encoded bodies, this reasoning collapses and a token becomes mandatory. Recorded so
that a future change to either has somewhere to collide with.

---

## Authentication

### Identities are never looked up by email

The existing `findOrCreateAccountForGoogle` keys on Google's `sub` and documents why:

> *A new sub is never linked to an existing account by matching the address. That is the
> account-takeover path: someone registers your address through a provider that does not
> verify it, and your sign-in merges you into theirs.*

That rule was written when Google was the only provider, and passwords are exactly the
provider it warns about. It is preserved, not excepted. Email is a display attribute,
never a key.

`AuthProvider` does **not** gain a `PASSWORD` member. `AuthIdentity` means "an identity
at an external provider" — it stores a `providerUserId` we did not issue. A password is
a credential we own, so it lives in its own table below, and an account's sign-in methods
are the union of the two. Adding `PASSWORD` to the enum would create a row whose
`providerUserId` had to be invented, which is the kind of near-duplicate that later gets
out of sync.

### The password credential lives in its own table

```prisma
model PasswordCredential {
  id         String   @id @default(cuid())
  accountId  String   @unique
  account    Account  @relation(fields: [accountId], references: [id], onDelete: Cascade)
  hash       String
  updatedAt  DateTime @updatedAt
  createdAt  DateTime @default(now())
}
```

Not a column on `AuthIdentity`. That table is read on every Google sign-in, and a secret
sitting in a routinely-selected row is a leak waiting for a careless `select` or a logged
object.

**Hashing:** argon2id at the OWASP parameters ADMIN.md already specifies —
`memoryCost 19456, timeCost 2, parallelism 1`. Same parameters, deliberately **not** the
same code path: ADMIN.md keeps admin credentials in a separate system so a failure in one
cannot reach the other, and that separation is honoured.

Use `@node-rs/argon2`, which ships prebuilt binaries. The `argon2` package requires a
native toolchain that is awkward on Windows, where this is developed.

**Password policy**, following NIST 800-63B rather than folklore: minimum 8 characters,
screened against a breached-password list, **no** composition rules, **no** forced
rotation. Composition rules produce predictable passwords and rotation produces
incremented ones.

Screening uses the Have I Been Pwned range API with k-anonymity: only the first five
characters of the password's SHA-1 leave this system, and the match is completed locally
against the returned suffixes. The full password, and its full hash, never leave.
**The check fails open** — if HIBP is unreachable, signup proceeds. A third party's
availability must not decide whether someone can create an account, and this is a
strength check rather than an authorization one.

### An unverified account is inert

Signup creates the account and identity with `Account.emailVerifiedAt` null, and **issues
no session**. An unverified password account cannot be signed into, cannot own a page, and
cannot do anything at all.

This is what closes the takeover: an attacker who signs up as `victim@gmail.com` and waits
holds an account they can never use, because activating it requires reading an inbox they
do not control. Verification is the proof of address ownership that makes everything
downstream safe.

### Signup on an address that already has an account creates nothing

`Account.email` is unique, so creating a second row would either fail or force the
`sub+email` disambiguation the Google path uses — producing a confusing duplicate the
owner cannot explain.

Instead: **no row is written**, and the HTTP response is byte-identical to a successful
signup. The email carries the truth. An existing owner receives *"you already have an
account, sign in with Google"*; a new one receives a verification link. The form cannot be
used to discover who has an account, and the only person who learns anything is the one
who can read that inbox.

### Linking is explicit and authenticated

Nothing merges at sign-in time. While signed in, an owner may add a password or connect
Google from account settings. Automatic linking by matching address is where account
takeovers live; the manual version costs one click, once.

### Login failures are indistinguishable

One message and one duration for a wrong password and an unknown address. An unknown
address still runs a dummy argon2 verify, or the response time becomes the oracle the
identical message was meant to remove. ADMIN.md states this rule for admin; it applies
here for the same reason.

Rate limited by email **and** by IP, using the limiter built for the chat and ingest
routes. Credential stuffing is the case it exists for.

### OAuth flow integrity

The Google flow uses a `state` parameter, generated per attempt, stored in a short-lived
`httpOnly` cookie, and compared on return. Without it the callback accepts any
authorization code, which is login CSRF: an attacker grafts their Google account onto a
victim's session. PKCE (`S256`) is used alongside it.

### Tokens for verification and reset

One table, two purposes, distinguished by a `kind` column: `EMAIL_VERIFICATION` and
`PASSWORD_RESET`. Tokens are single-use, expire in 24 hours and 1 hour respectively, and
are stored as a SHA-256 hash exactly as sessions are.

**A completed password reset deletes every session for that account.** A reset exists to
end an intrusion; leaving the intruder's session alive defeats it.

---

## Handles

### Claim rules

From BACKEND.md, which calls the reserved list day-one work because *"retrofitting this
after people own handles is miserable"*:

- Minimum 3 characters, maximum 30, `[a-z0-9_-]`, no leading or trailing separator.
- Stored lowercase; comparison is case-insensitive.
- Reserved: `app`, `api`, `faq`, `admin`, `about`, `pricing`, `help`, `support`, `blog`,
  `login`, `signup`, `settings`, `static`, plus profanity and a Malaysian trademark seed.
- **Additionally reserved, found while designing this slice:** `_next`, `www`, `auth`,
  `terms`, `privacy`, `security`, and **any handle beginning with an underscore**. The
  character class permits underscore and the minimum is 3, so `_next` is claimable — and
  it is Next.js's internal asset path sitting at the root of the same namespace.
- The reserved check runs against the **skeleton**, not the raw handle. Otherwise `admın`
  walks straight past a list containing `admin`.

### Confusables

A `skeleton` column on `Page`, uniquely indexed, computed at claim time:

1. NFKD normalise, strip combining marks, lowercase.
2. Fold `0 → o` and `1 → i`.

Step 1 collapses every accented variant of a Malay name onto one shape.

**A correction to this section, found while implementing it:** step 1 does *not* kill
`nadıa` against `nadia`, as this spec originally claimed. U+0131 is an atomic letter with no
decomposition, so NFKD leaves it untouched. Nothing is lost: the character class admits only
`[a-z0-9_-]`, so a handle containing it is rejected outright, before the skeleton is computed
or the reserved list is consulted. The blunter rule fires first and harder. Step 1 still
earns its place on accents, and it keeps the algorithm meaningful if the character class is
ever widened for Unicode handles. Step 2 stops leetspeak impersonation with effectively no false
collisions, because those two digits do not appear meaningfully inside word-shaped
handles.

**No letter-to-letter folding.** Folding `{1, l, i}` together — considered and rejected —
maps `mail` and `mall` to the same skeleton. Two ordinary unrelated words, one of which
could never be claimed. This is why UTS-39 skeletons are normally used to flag for review
rather than to hard-block. `3`, `4`, `5`, `7`, `8` are likewise not folded: `web3`, `4u`,
`5star` and `88` are all things people legitimately want, and `88` is culturally
meaningful to a substantial part of this market.

**The residual gap, stated rather than hidden:** `nadla` will not collide with `nadia`.
Blocking it costs `mail`/`mall`. Impersonation by letter substitution is handled by the
takedown path BACKEND.md already specifies, not by the namespace.

### OPEN DECISION — ambiguous trademarks in the reserved seed

Raised by the final review of plan 2a, unresolved, and live on `main` since the seed shipped.

The profanity seed was built on a stated rule: **exclude a term if it is also an ordinary word
a business might legitimately want.** That is why `sial`, `bodoh` and `babi` are absent — the
last of these appears literally in pork-dish business names.

That rule was **not applied consistently to the trademark seed.** These five entries are real
Malaysian marks that are also ordinary words:

| Entry | Also means | A business that might want it |
|---|---|---|
| `tenaga` | "energy" / "power" in Malay | a gym, a solar installer, an energy drink |
| `boost` | ordinary English verb and noun | a gym, a supplement shop, a marketing agency |
| `proton` | a subatomic particle | a physics tutor, a lab, a tech shop |
| `firefly` | the insect | a cafe, a florist, a childcare business |
| `aeon` | an indefinite age | a design studio, a jeweller, a bookshop |

**The trade, stated so the call is easy to make.** Blocking one wrongly is a silent failure:
a shop hits "that handle is reserved", has no way to appeal it in the product, and gives up —
and we never hear about it. Allowing one wrongly is a loud failure with a named victim and an
existing remedy: the brand files a takedown, which BACKEND.md already specifies. This spec
already prefers the loud failure everywhere else it faces the same choice — see the
`nadla`/`nadia` residual above, which is routed to takedown rather than blocked.

**On that reasoning the five should probably be dropped.** It is recorded rather than acted on
because which of them a Malaysian business would realistically claim is market knowledge, and
the cost of guessing wrong is the invisible kind.

Whoever settles this: the list is `RESERVED_TRADEMARKS` in `packages/core/src/handle.ts`, and
removing an entry is deleting a string. `packages/core/src/handle.test.ts` asserts on
`maybank`, `mysejahtera`, `petr0nas` and `a1rasia`, none of which are in question here.

---

### SETTLED — the ingest URL is now filtered for private addresses

*Raised while driving the ingest job by hand at the end of plan 2b. Settled 2026-09-06;
the design and its reasoning are `devDocs/ssrf-ingest-guard-design.md`, the work is
`devDocs/plans/2026-09-06-ingest-address-guard.md`.*

The gap, for the record, since a settled decision that hides what it fixed is worth less
than the open one it replaced: `startIngestion` validated only the protocol, and the worker
fetched whatever it was given with no address filtering at all. An authenticated owner
could make the worker GET `http://127.0.0.1:…`, a private range, or a cloud metadata
endpoint, and read some of what came back through the review queue. That was live on `main`
from slice 1. It was never reachable by an anonymous visitor, and there is no metadata
service in the current deployment, but both of those were circumstances rather than
defences and neither was written down as a reason to accept it.

**What was built.** One classifier in `packages/core`, two independent callers, exactly as
this spec required — a filter in one place is not a filter.

- `apps/api` resolves the hostname inside the request under a 2s timeout and answers
  `400 BLOCKED_SOURCE_URL`. This is a **fast fail, not the defence**: its answer is stale by
  the time a job runs. Delete it and an owner gets a worse error; nothing opens.
- `apps/workers` puts the guard in `undici`'s `connect.lookup`, so the vetted address is the
  address dialled. There is one resolution, so DNS rebinding has no second one to race, and
  because it lives in the connector it covers the crawler's 25 pages and every redirect hop
  with no call site that can forget to call it.

**Two things worth carrying forward.**

*A literal address never reaches the connector.* `net.connect` skips DNS when the host is
already an address, so the guard is not called for `http://127.0.0.1/` at all. Every unit
test passed while this was open; running it against a real server with the real environment
variable is what found it. `fetchGuarded` now judges literals itself with the same
classifier and flag. Structural arguments — "it is in the socket, it cannot be bypassed" —
are the ones that feel too obvious to test.

*The escape hatch has to reach what it exists for.* `INGEST_ALLOW_PRIVATE_ADDRESSES` is off
unless spelled exactly `true`, so a typo fails closed. An earlier version refused IP
literals during URL parsing, before anything consulted the flag, which made the switch
useless for `http://127.0.0.1:8099/` — the address the ingest walkthrough tells you to
paste, and the address that found this gap in the first place.

**What this concedes, named rather than buried.** The API's check makes the endpoint a
small DNS oracle: an owner can learn whether a name resolves privately from which error
comes back. Accepted — the caller needs a verified account, a session and ownership of the
page. And ports are not restricted to 80/443, which the usual advice recommends; with every
private address unreachable, that would only stop reaching public services on odd ports,
something anyone can do from their own machine, while refusing to crawl a shop running on
`:8080`.

---

**Cost of precomputing:** changing this algorithm later requires a backfill migration, and
any collisions it newly surfaces must be adjudicated by hand. The alternative — computing
on read — cannot be uniquely indexed, so this is the trade that buys atomic claiming.

### Claim races

Unique indexes on `handle` and on `skeleton` are the serialisation point. A `P2002` is
caught and returned as "that handle is taken" — the same pattern, and for the same
reason, as the sign-in race already fixed in `findOrCreateAccountForGoogle`.

### One page per account

Currently a slice-1 convention enforced nowhere. This slice makes it real with a unique
constraint on `Page.accountId`, so a second page is rejected by the database rather than
by whichever code path happens to check.

---

## Onboarding

Sign in → no page yet → claim a handle and display name, creating the `Page` with
`published: false` → paste a URL → `POST /ingest` returns 202 with an ingestion id →
poll `GET /ingest/:id` until it resolves → review screen.

Input is a URL only. FRONTEND.md offers "a URL or an `@handle`", but the Instagram adapter
throws `NOT_CONFIGURED` by design and connectors are Pro/Max work. The field accepts a
URL; the handle form arrives with the connector that can serve it.

### Two authorization holes this closes

Both are pre-existing and both stop being theoretical the moment sessions exist.

**`POST /ingest` takes a `pageId` and checks nothing.** With authentication, this is a
live IDOR: any signed-in owner could run an arbitrary URL into *another owner's* page.
Because facts land unverified, the result is planted claims sitting in a stranger's review
queue, waiting for a tired human to accept one. The service must verify the page belongs
to the caller.

**`GET /ingest/:id` returns any ingestion by id**, leaking another owner's `sourceUrl` and
status. Same fix, same reason.

The ingest route also moves behind a session, which retires the denial-of-wallet exposure
recorded against it — a session gate plus the existing rate limit is a control rather than
merely a bound.

---

## The fact review screen

FRONTEND.md: *"The review screen is the highest leverage surface in the product... Never
auto-publish an unreviewed price. Getting a price wrong in public is the single failure
that loses a customer permanently."*

Facts render as cards, each showing its `claim`, `category`, and the `sourceText` it came
from — a field that already exists in the schema, commented *"the line it came from, for
the review screen."* The owner accepts, edits, or rejects each one.

### The one hard rule

**Nothing sets `verified: true` except an explicit human action on that specific fact.**
No select-all. No "accept all remaining". No auto-accept above a confidence threshold. A
bulk-accept control is precisely how an unreviewed price ships, and no amount of
convenience justifies reintroducing the single failure this product cannot recover from.

### Rejection is a soft delete

`Fact` gains `rejectedAt DateTime?`. Rejecting sets it; the row stays.

A hard delete would be undone by the next crawl: extraction writes with `skipDuplicates`
against `@@unique([pageId, normalizedClaim])`, so a deleted claim is simply re-created, and
"we are halal certified" reappears in the queue the owner already dismissed it from. The
surviving row keeps the unique index doing that suppression.

Both read paths — `getPublicPage` and the chat service — filter `verified: true`, so a
rejected fact is invisible regardless. The soft delete is about not asking the same
question twice.

### Editing

An edited claim is re-normalised through `normalizeClaim` in `packages/core`, so the
dedupe key never drifts from the text it is meant to key.

An edit can therefore collide with another fact's `normalizedClaim` on the same page.
That is a `P2002`, surfaced as "you already have a fact that says this" rather than a 500.

### Volume

A 25-page crawl can yield well over a hundred facts. The screen renders a bounded page of
them rather than all of them, oldest first, so review is a queue that empties rather than
a wall that intimidates.

---

## Publishing

A deliberate owner action that sets `published: true`. Slice 1 already filters both read
paths on it, so a page is invisible until this happens — which is why publish had to be in
this slice at all.

---

## Documents corrected by this slice

| Document | Correction |
|---|---|
| `BACKEND.md` | Auth section: Google-only reversed, with the original reasoning preserved as the record of what was traded away |
| `README.md` | Owner auth row in the risk table |
| `FRONTEND.md` | "refreshed by middleware" — the API refreshes; middleware cannot write |
| `slice-1-build-spec.md` | Phone OTP gate marked deferred rather than slice 2; its Auth section annotated where slice 2 replaced the design — OAuth state is a signed cookie, not a Redis entry, and the API refreshes the session rather than Next middleware |

Two of these were not caught by the verification grep this slice specified.
`slice-1-build-spec.md` said "Refreshed by **Next** middleware", which the pattern
`refreshed by middleware` does not match, and it described the OAuth state as living in
Redis with a short TTL. Both were live contradictions. A grep is only as good as the
wording it guesses, which is an argument for reading the sections rather than trusting
the pattern.

BACKEND.md's Auth section also gained the two architectural facts that arrived with the
reversal and had nowhere else to live: mail is queued rather than sent in-request, and a
password is a `PasswordCredential` row rather than an `AuthIdentity` one.

---

## A note on size

This slice roughly doubled when password authentication was added to it. It is now
comparable in scope to all of slice 1, which took thirteen tasks.

The recommendation is that this spec stays whole — the pieces genuinely depend on each
other, and splitting the *specification* would hide the account-linking rules from the
screens that rely on them — but that **implementation splits into two plans**:

1. **Auth foundation.** Sessions, Google OAuth with `state` and PKCE, password identities,
   verification, reset, the ingest authorization fixes.
2. **Owner surface.** Handle claim, onboarding, the review screen, publish.

Plan 1 ships nothing an owner can see, which is why it was rejected as a slice on its own.
As the first half of a slice that does ship something, it is the right seam.
