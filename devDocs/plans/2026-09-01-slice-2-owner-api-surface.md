# Slice 2, plan 2a — the owner API surface

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give an owner a handle, a review queue they can act on one fact at a time, a publish action, and a way to add a second sign-in method — all as authenticated API surface, with no UI.

**Architecture:** Everything here is `apps/api` writing, `packages/db-read` reading, and `packages/core` holding the pure rules. It continues the boundary plan 1 established: `apps/web` never writes, `apps/api` owns every mutation and re-authorizes each one against the session. Every new route is scoped by the caller's account inside the query rather than filtered after the read, which is the lesson the ingest IDOR taught at the end of plan 1.

**Tech Stack:** Fastify 5 with `fastify-type-provider-zod`, Prisma 6, Postgres 16, argon2id via `@node-rs/argon2`, vitest 2.

**Spec:** `devDocs/slice-2-build-spec.md` — sections *Handles*, *Onboarding*, *The fact review screen*, *Publishing*, and *Linking is explicit and authenticated*.

**Predecessor:** `devDocs/plans/2026-08-29-slice-2-auth-foundation.md` (plan 1, complete and merged). Its ledger is `.superpowers/sdd/2026-08-29-slice-2-auth-foundation/progress.md` and is worth reading before starting — several rulings below are continuations of findings recorded there.

**Successor:** plan 2b covers everything in `apps/web` — middleware, the authed layout, sign-in screens, onboarding, the review screen, publish. This plan deliberately ships nothing an owner can see, and every route here is exercised by tests rather than by a browser.

## Global Constraints

- Test databases are reached via `DATABASE_URL_TEST`, never `DATABASE_URL`. `apps/api/vitest.setup.ts` already repoints it and assigns a per-run `RATE_LIMIT_NAMESPACE`. Do not remove either: the first stops tests writing into the dev database, the second stops the suite throttling itself on a second run inside fifteen minutes.
- `apps/web` connects as `curios_readonly` and must never import `packages/db`. Reads go through `packages/db-read`.
- Never read `.env`. When key names are needed: `grep -oE '^[A-Z_]+=' .env`.
- Every new client-facing error code must be added to `DOMAIN_ERROR_CODES` in `apps/api/src/plugins/errors.ts` in the same task that introduces it. An unlisted code reaches the browser as `INTERNAL_ERROR` regardless of its status. This has now bitten twice — the rate limiter in slice 1, and `NOT_FOUND` in plan 1's Task 11 — so each task below carries its own whitelist step.
- Every `app.inject` in a test file that hits an auth or ingest route passes its own `remoteAddress`. Plan 1 stated this in prose three times and omitted it from its own code blocks three times; the blocks below carry it.
- Ownership is enforced inside the query (`where: { ..., page: { accountId } }`), never by reading and then comparing.
- 404, never 403, for a resource the caller does not own. A 403 confirms the id exists.
- The `postgres-test` container is `tmpfs`. Any `docker compose` restart empties it. Re-apply with `cd packages/db && DATABASE_URL="$DATABASE_URL_TEST" pnpm exec prisma migrate deploy`, then `docker exec -i curios-postgres-test psql -U curios -d curios_test < packages/db/prisma/sql/readonly-role.sql`.
- Four gates, all of which pass before a task is done: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.

---

## Pre-flight scan

### Shared files and interfaces between tasks

| Tasks | Producer to consumer | Finding |
|---|---|---|
| T1 → T3, T4, T5, T6 | `Page.skeleton`, `Page.accountId` unique, `Fact.rejectedAt` | **F3** below |
| T2 → T3 | `checkHandle`, `handleSkeleton`, `HANDLE_MIN`, `HANDLE_MAX` | clean — pure functions, no database |
| T2 → T4 | `hashSessionValue` in `packages/core` | **F1** below |
| T3 → T6, T7 | a `Page` row exists for the account | clean — sequential |
| T4 → plan 2b | `getOwnerSession`, `getReviewQueue` | nothing in this plan consumes them; they exist for the layout and the review screen |
| T5 → — | `verifyFact`, `editFact`, `rejectFact` | **F5** below |
| T1..T7 → `plugins/errors.ts` | each adds client-facing codes | sequential appends, one step per task |

### Findings and rulings

- **F1 — `packages/db-read` cannot reach the session hash, and duplicating it is how it drifts.** The `/app` layout must validate a session against the database, and `apps/web` reads only through `packages/db-read`. The SHA-256 that turns a cookie value into a `Session.id` lives in `apps/api/src/lib/tokens.ts`, which `db-read` cannot import. Copying four lines of hashing into a second package is exactly how two implementations of one security primitive diverge.
  **Ruling:** the hash moves to `packages/core` as `hashSessionValue`, and `apps/api/src/lib/tokens.ts` re-exports it so no plan 1 call site changes. Task 2 does the move. Rejected duplicating it. Rejected having the layout ask the API over HTTP — a network hop on every authed render, to answer what one indexed read answers.

- **F2 — the layout must not extend the session, and `validateSession` does.** `validateSession` performs the sliding refresh, which is a write, and `apps/web` holds a SELECT-only connection. Calling it from the layout fails in Postgres. This is the same trap FRONTEND.md fell into with "refreshed by middleware".
  **Ruling:** `getOwnerSession` is read-only and does not refresh. The API keeps refreshing on its own requests, which is where the write belongs. Cost if wrong: a session's idle clock advances only on API calls and not on page renders, which is acceptable because every authed screen makes API calls anyway.

- **F3 — the `skeleton` migration cannot be a bare NOT NULL unique column.** `Page` already holds rows, so adding a non-nullable column with no value fails on the spot.
  **Ruling:** one migration, in this order — add the column nullable, backfill existing rows, set NOT NULL, add the unique index. Verified before ruling rather than assumed: `SELECT COUNT(*) FROM (SELECT "accountId" FROM "Page" GROUP BY "accountId" HAVING COUNT(*) > 1) x` returns 0, so the `Page.accountId` unique constraint in the same migration is safe today. Re-run that check before applying it anywhere else.

- **F4 — one `P2002` in the claim path means three different things, and conflating them lies to the claimant.** `Page` will carry unique constraints on `handle`, on `skeleton`, and on `accountId`. A single catch reporting "that handle is taken" tells an owner who already has a page that their chosen handle is unavailable — false, and unfixable by trying another one.
  **Ruling:** the catch inspects `error.meta.target` and maps each constraint to its own error: taken, too similar to an existing handle, and you already have a page. Rejected a generic message — the entire point of the skeleton is that "too similar" is a different fact from "taken", and a claimant who cannot tell them apart will keep guessing.

- **F5 — "nothing bulk-accepts" is a negative requirement, and negative requirements decay without a test.** The spec's one hard rule is that nothing sets `verified: true` except an explicit human action on one specific fact. Every test written about the routes that *do* exist will still pass on the day someone adds `POST /facts/verify-all`.
  **Ruling:** Task 5 includes a test that reads Fastify's own route table and asserts every mutating route under `/facts` is scoped to a single `:id`. It fails at the moment a bulk route is added, which is the only moment anyone could reintroduce the one failure this product cannot recover from. Cost if wrong: one test that reads `app.printRoutes()`.

- **F6 — the spec reserves leading underscores twice, and the format rule already covers it.** It notes the character class permits underscore so `_next` is claimable, and separately forbids a leading or trailing separator. With the format rule enforced, `_next` fails on format before the reserved list is consulted.
  **Ruling:** implement both. The format rule rejects it; `_next` stays on the reserved list as the thing that still holds if the format rule is ever loosened. Recorded so nobody deletes the apparently redundant entry.

- **F8 — rejecting an already-accepted fact would leave it answering customers.** The spec says a rejected fact is invisible because both read paths filter `verified: true`. That holds only while rejected facts are unverified. An owner who accepts a fact and later rejects it — noticing a wrong price is exactly when they would — sets `rejectedAt` while `verified` stays true, and neither `getPublicPage` nor the chat service looks at `rejectedAt`. The claim keeps being served.
  **Ruling:** `rejectFact` sets `rejectedAt` **and** clears `verified`. Chosen over adding `rejectedAt: null` to both read paths, because that spreads the invariant across two packages and a third read path added later would miss it; clearing the flag keeps the guarantee inside the one write that creates the situation. The Task 5 test asserts both fields. Cost if wrong: an owner who rejects and then changes their mind re-accepts rather than un-rejects, which is one extra click on a path nobody takes twice.

- **F7 (minor, not ruled)** — `handleSkeleton` uses NFKD while `normalizeClaim` uses NFKC. Deliberate: the skeleton strips combining marks and therefore needs decomposition, while the claim key wants composed characters. They must not be unified. Left as a comment in the code rather than as a task.

---
### Task 1: Schema — handle skeleton, one page per account, soft-deleted facts

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<timestamp>_owner_surface/migration.sql`
- Test: `packages/db/src/schema.test.ts` (append)

**Interfaces:**
- Produces: `Page.skeleton` (String, unique), `Page.accountId` unique, `Fact.rejectedAt` (DateTime?).

- [ ] **Step 1: Write the failing test**

Append to `packages/db/src/schema.test.ts`:

```ts
describe('the owner surface columns', () => {
  it('refuses a second page for one account', async () => {
    const account = await prisma.account.create({
      data: { email: `one-page-${randomUUID()}@example.com` },
      select: { id: true },
    });
    await prisma.page.create({
      data: {
        accountId: account.id,
        handle: `first-${randomUUID().slice(0, 8)}`,
        skeleton: `first-${randomUUID().slice(0, 8)}`,
        displayName: 'First',
      },
    });

    // One page per account was a slice 1 convention enforced nowhere. The
    // database is the only place it can be enforced against a code path that
    // forgets to check.
    await expect(
      prisma.page.create({
        data: {
          accountId: account.id,
          handle: `second-${randomUUID().slice(0, 8)}`,
          skeleton: `second-${randomUUID().slice(0, 8)}`,
          displayName: 'Second',
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('refuses two handles that share a skeleton', async () => {
    const one = await prisma.account.create({
      data: { email: `sk-a-${randomUUID()}@example.com` },
      select: { id: true },
    });
    const two = await prisma.account.create({
      data: { email: `sk-b-${randomUUID()}@example.com` },
      select: { id: true },
    });
    const skeleton = `shape-${randomUUID().slice(0, 8)}`;

    await prisma.page.create({
      data: { accountId: one.id, handle: `${skeleton}-a`, skeleton, displayName: 'A' },
    });

    // Distinct handles, one skeleton. This is the constraint that makes the
    // confusables check atomic instead of a read-then-write race.
    await expect(
      prisma.page.create({
        data: { accountId: two.id, handle: `${skeleton}-b`, skeleton, displayName: 'B' },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('keeps a rejected fact as a row', async () => {
    const account = await prisma.account.create({
      data: { email: `rej-${randomUUID()}@example.com` },
      select: { id: true },
    });
    const page = await prisma.page.create({
      data: {
        accountId: account.id,
        handle: `rej-${randomUUID().slice(0, 8)}`,
        skeleton: `rej-${randomUUID().slice(0, 8)}`,
        displayName: 'R',
      },
      select: { id: true },
    });
    const fact = await prisma.fact.create({
      data: {
        pageId: page.id,
        category: 'PRICE',
        claim: 'we are halal certified',
        normalizedClaim: 'we are halal certified',
        confidence: 0.9,
        rejectedAt: new Date(),
      },
      select: { id: true, rejectedAt: true },
    });

    // A hard delete would be undone by the next crawl: extraction writes with
    // skipDuplicates against @@unique([pageId, normalizedClaim]), so the row
    // is what suppresses the re-ask.
    expect(fact.rejectedAt).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @curios/db test`
Expected: FAIL — `Unknown argument 'skeleton'` and `Unknown argument 'rejectedAt'`, before any migration exists.

- [ ] **Step 3: Amend the schema**

In `packages/db/prisma/schema.prisma`, add to `model Page`:

```prisma
  skeleton      String         @unique
```

immediately after the `handle` line, and add this to the model's attribute block:

```prisma
  @@unique([accountId])
```

Add to `model Fact`, after `flagged`:

```prisma
  rejectedAt      DateTime?
```

Do not run `prisma format`. It reformats unrelated models and turns a three-file diff into a whole-schema one — the same trap plan 1's Task 1 caught and reverted.

- [ ] **Step 4: Create the migration by hand**

`prisma migrate dev` will offer to add `skeleton` as a bare NOT NULL unique column, which fails against existing rows. Write the migration instead:

`prisma migrate dev --create-only` does not work here: Prisma refuses to run when the
environment is non-interactive and any step is unexecutable, which it always is in this
setup. Create the directory and file by hand instead, following the existing naming
convention (`packages/db/prisma/migrations/` holds `YYYYMMDDHHMMSS_description/`), and do
not touch `migration_lock.toml`:

```bash
mkdir -p "packages/db/prisma/migrations/$(date +%Y%m%d%H%M%S)_owner_surface"
```

Write this as its `migration.sql`:

```sql
-- Nullable first: Page already holds rows, so a bare NOT NULL column fails here.
ALTER TABLE "Page" ADD COLUMN "skeleton" TEXT;

-- Backfill. Every existing handle is lowercase ASCII, so the two digit folds
-- are the whole algorithm for them. New rows compute the skeleton in
-- application code, where NFKD and combining-mark stripping are available;
-- this statement is not that algorithm and is not meant to be reused.
UPDATE "Page" SET "skeleton" = replace(replace(lower("handle"), '0', 'o'), '1', 'i')
WHERE "skeleton" IS NULL;

ALTER TABLE "Page" ALTER COLUMN "skeleton" SET NOT NULL;

CREATE UNIQUE INDEX "Page_skeleton_key" ON "Page"("skeleton");

-- One page per account, previously a convention enforced nowhere.
CREATE UNIQUE INDEX "Page_accountId_key" ON "Page"("accountId");

ALTER TABLE "Fact" ADD COLUMN "rejectedAt" TIMESTAMP(3);
```

Before applying it anywhere with real data, re-run the check that made this safe:

```bash
docker exec curios-postgres psql -U curios -d curios -tAc 'SELECT COUNT(*) FROM (SELECT "accountId" FROM "Page" GROUP BY "accountId" HAVING COUNT(*) > 1) x;'
```

Expected: `0`. Anything else means an account owns two pages and the unique index will fail; stop and report rather than deleting a page.

- [ ] **Step 5: Apply to both databases and regenerate**

```bash
cd packages/db && pnpm exec prisma migrate deploy && DATABASE_URL="$DATABASE_URL_TEST" pnpm exec prisma migrate deploy && pnpm exec prisma generate && cd ../..
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @curios/db test`
Expected: PASS.

- [ ] **Step 7: Confirm nothing else broke**

Run: `pnpm test`
Expected: all 7 packages pass — but not on the first run. `skeleton` is required, so every
fixture that creates a `Page` needs one. There are six, and they span five packages:
`packages/db/src/schema.test.ts` (a pre-existing test in the same file you appended to),
`packages/db-read/src/page.query.test.ts`, `apps/api/src/modules/chat/chat.service.test.ts`,
`apps/api/src/modules/ingest/ingest.authz.test.ts`,
`apps/api/src/modules/ingest/ingest.service.test.ts`,
`apps/workers/src/ingestion/extract.service.test.ts`, and also `scripts/seed-dev.ts`.

Fix each the same mechanical way — `skeleton` equal to the handle that fixture already
uses — and commit them with this task. They are one consequence of one schema change, and
splitting them would leave the tree red in between. Do NOT weaken an assertion to make a
test pass; if one fails for any reason other than the missing column, stop and report it.

- [ ] **Step 8: Commit**

```bash
git add packages/db apps
git commit -m "feat(db): handle skeleton, one page per account, soft-deleted facts"
```

---

### Task 2: Handle rules, and the session hash both packages need

**Files:**
- Create: `packages/core/src/handle.ts`, `packages/core/src/session-hash.ts`
- Modify: `packages/core/src/index.ts`, `apps/api/src/lib/tokens.ts`
- Test: `packages/core/src/handle.test.ts`

**Interfaces:**
- Produces: `HANDLE_MIN`, `HANDLE_MAX`, `handleSkeleton(raw): string`, `checkHandle(raw): HandleCheck`, `hashSessionValue(value): string`.
- `type HandleCheck = { ok: true; handle: string; skeleton: string } | { ok: false; reason: 'FORMAT' | 'RESERVED' }`.

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/handle.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { checkHandle, handleSkeleton } from './handle.js';

describe('handleSkeleton', () => {
  it('folds accented letters onto their plain forms', () => {
    // What NFKD plus mark-stripping actually buys: every accented variant of a
    // Malay name collapses onto one shape.
    expect(handleSkeleton('nádiá')).toBe('nadia');
    expect(handleSkeleton('nàdîâ')).toBe('nadia');
  });

  it('does not fold a dotless i, and does not need to', () => {
    // U+0131 is an atomic letter, not a decomposition, so NFKD leaves it
    // alone. That is fine: the character class rejects it outright, which is a
    // stronger guarantee than folding would be. Asserted rather than left
    // implicit, so nobody "fixes" the skeleton to chase it.
    expect(handleSkeleton('nadıa')).not.toBe(handleSkeleton('nadia'));
  });

  it('folds zero to o and one to i', () => {
    expect(handleSkeleton('n0d1a')).toBe('nodia');
  });

  it('does not fold letters onto each other', () => {
    // Folding {1, l, i} together maps mail and mall to one skeleton. Two
    // ordinary words, one of which could then never be claimed.
    expect(handleSkeleton('mail')).not.toBe(handleSkeleton('mall'));
  });

  it('leaves digits people legitimately want alone', () => {
    // web3, 4u, 5star and 88 are all things a real shop asks for, and 88 is
    // culturally meaningful in this market.
    for (const handle of ['web3', '4u', '5star', '88shop']) {
      expect(handleSkeleton(handle)).toBe(handle);
    }
  });
});

describe('checkHandle', () => {
  it('accepts an ordinary handle and returns both forms', () => {
    expect(checkHandle('Nadia_Bakes')).toEqual({
      ok: true,
      handle: 'nadia_bakes',
      skeleton: 'nadia_bakes',
    });
  });

  it('rejects anything outside the character class or the length', () => {
    for (const bad of ['ab', 'a'.repeat(31), 'nadia bakes', 'nadia!', 'nadia.bakes']) {
      expect(checkHandle(bad)).toEqual({ ok: false, reason: 'FORMAT' });
    }
  });

  it('rejects a leading or trailing separator', () => {
    for (const bad of ['_nadia', 'nadia_', '-nadia', 'nadia-']) {
      expect(checkHandle(bad)).toEqual({ ok: false, reason: 'FORMAT' });
    }
  });

  it('rejects a reserved handle', () => {
    for (const bad of ['admin', 'api', 'app', 'auth', 'www', 'settings', 'privacy']) {
      expect(checkHandle(bad)).toEqual({ ok: false, reason: 'RESERVED' });
    }
  });

  it('rejects a reserved handle disguised with leetspeak', () => {
    // This is where the skeleton earns its place: the reserved check runs
    // against the folded form, so adm1n cannot walk past a list containing
    // admin.
    expect(checkHandle('adm1n')).toEqual({ ok: false, reason: 'RESERVED' });
  });

  it('rejects a non-ASCII lookalike on format, before the reserved list', () => {
    // admın never reaches the reserved check, because the character class does
    // not admit U+0131 at all. Two rules, and the blunter one fires first.
    expect(checkHandle('admın')).toEqual({ ok: false, reason: 'FORMAT' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @curios/core test src/handle.test.ts`
Expected: FAIL — cannot resolve `./handle.js`.

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/handle.ts`:

```ts
export const HANDLE_MIN = 3;
export const HANDLE_MAX = 30;

/**
 * Names that must never sit at the root of the same namespace as a handle.
 *
 * `_next` is Next.js's asset path, `auth` and `api` are our own routes, and
 * the rest are the ordinary reservations BACKEND.md calls day-one work,
 * because retrofitting this once people own handles is miserable.
 *
 * Checked against the SKELETON, not the raw handle, so `adm1n` cannot walk
 * past an entry for `admin`. Non-ASCII lookalikes are stopped earlier and
 * harder, by the character class in `checkHandle`.
 */
const RESERVED = new Set([
  'app', 'api', 'faq', 'admin', 'about', 'pricing', 'help', 'support', 'blog',
  'login', 'signup', 'settings', 'static', 'next', '_next', 'www', 'auth',
  'terms', 'privacy', 'security', 'curios', 'root', 'system',
]);

/**
 * The shape of a handle, for deciding whether two of them are confusable.
 *
 * NFKD and not NFKC, deliberately: decomposition is what puts the combining
 * marks somewhere they can be stripped, which collapses every accented variant
 * of a name onto one shape. It does NOT touch atomic lookalike letters such as
 * U+0131 -- those are rejected by the character class instead, which is a
 * stronger guarantee. Kept anyway, because it is what keeps this function
 * meaningful if the character class is ever widened for Unicode handles. `normalizeClaim` in this same package
 * uses NFKC for the opposite reason, and the two must not be unified.
 *
 * Only digits fold to letters. Folding letters onto each other — {1, l, i} —
 * maps `mail` and `mall` together, which is why UTS-39 skeletons are normally
 * used to flag for review rather than to hard-block. The residual gap is
 * stated rather than hidden: `nadla` will not collide with `nadia`, and
 * impersonation by letter substitution is handled by the takedown path
 * BACKEND.md specifies, not by this namespace.
 */
export function handleSkeleton(raw: string): string {
  return raw
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/0/g, 'o')
    .replace(/1/g, 'i');
}

export type HandleCheck =
  | { ok: true; handle: string; skeleton: string }
  | { ok: false; reason: 'FORMAT' | 'RESERVED' };

const SHAPE = /^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$/;

export function checkHandle(raw: string): HandleCheck {
  const handle = raw.trim().toLowerCase();

  if (handle.length < HANDLE_MIN || handle.length > HANDLE_MAX) {
    return { ok: false, reason: 'FORMAT' };
  }
  // SHAPE also rejects a leading or trailing separator, which is what makes
  // `_next` unclaimable on format alone. It stays on the reserved list anyway,
  // so the reservation still holds if this rule is ever loosened.
  if (!SHAPE.test(handle)) return { ok: false, reason: 'FORMAT' };

  const skeleton = handleSkeleton(handle);
  if (RESERVED.has(skeleton)) return { ok: false, reason: 'RESERVED' };

  return { ok: true, handle, skeleton };
}
```

Create `packages/core/src/session-hash.ts`:

```ts
import { createHash } from 'node:crypto';

/**
 * The lookup key for a session or auth token: SHA-256 of the value the
 * browser holds.
 *
 * Lives here rather than in `apps/api` because `packages/db-read` needs the
 * same hash to validate a session for the `/app` layout, and cannot import
 * from an app. Two implementations of one security primitive is how they
 * drift apart; there is exactly one, and both sides import it.
 *
 * SHA-256 and not argon2 on purpose: the input is 32 random bytes, so there is
 * no guessing to slow down, and lookup is by exact match.
 */
export function hashSessionValue(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
```

- [ ] **Step 4: Export them, and re-export the hash from its old home**

Add to `packages/core/src/index.ts`:

```ts
export { HANDLE_MIN, HANDLE_MAX, handleSkeleton, checkHandle } from './handle.js';
export type { HandleCheck } from './handle.js';
export { hashSessionValue } from './session-hash.js';
export { SESSION_ABSOLUTE_TTL_MS, SESSION_IDLE_TTL_MS } from './session.js';
```

In `apps/api/src/lib/tokens.ts`, delete the local `createHash` implementation of `hashToken` and re-export instead, so every plan 1 call site keeps working unchanged:

```ts
import { hashSessionValue } from '@curios/core';

/** Kept as a name because sessions and auth tokens both hash their value the
 *  same way; the implementation moved to @curios/core so packages/db-read can
 *  use it too. */
export const hashToken = hashSessionValue;
```

Leave `createToken` where it is — nothing outside `apps/api` mints tokens.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @curios/core test src/handle.test.ts`
Expected: PASS, 9 tests.

Then run the whole workspace: `pnpm test`. The existing `apps/api/src/lib/tokens.test.ts` must still pass untouched — that is the proof the move did not change behaviour. If it fails, the hash changed, and the fix is the implementation and never the test.

- [ ] **Step 6: Commit**

```bash
git add packages/core apps/api
git commit -m "feat(core): handle rules, and one session hash both packages share"
```

---
### Task 3: Claim a handle

**Files:**
- Create: `apps/api/src/modules/pages/page.service.ts`, `apps/api/src/modules/pages/page.routes.ts`
- Modify: `apps/api/src/app.ts`, `apps/api/src/plugins/errors.ts`
- Test: `apps/api/src/modules/pages/page.routes.test.ts`

**Interfaces:**
- Consumes: `checkHandle` (Task 2); `requireSession` and `UnauthenticatedError` from `../../plugins/session.js`.
- Produces: `claimHandle(prisma, accountId, input): Promise<{ pageId: string; handle: string }>`, `HandleInvalidError`, `HandleReservedError`, `HandleTakenError`, `HandleTooSimilarError`, `PageAlreadyExistsError`, `pageRoutes`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/modules/pages/page.routes.test.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { createSession, SESSION_COOKIE } from '../auth/session.service.js';

let app: FastifyInstance;

let nth = 0;
/** A fresh source address per request, so the limiter never sees a flood. */
const from = () => `203.0.113.${(nth++ % 200) + 1}`;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

async function anOwner(): Promise<string> {
  const account = await app.prisma.account.create({
    data: { email: `claim-${randomUUID()}@example.com`, emailVerifiedAt: new Date() },
    select: { id: true },
  });
  return (await createSession(app.prisma, account.id)).value;
}

const claim = (cookie: string, handle: string) =>
  app.inject({
    method: 'POST',
    url: '/pages',
    remoteAddress: from(),
    cookies: { [SESSION_COOKIE]: cookie },
    payload: { handle, displayName: 'A Shop' },
  });

describe('POST /pages', () => {
  it('refuses an unauthenticated caller', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/pages',
      remoteAddress: from(),
      payload: { handle: `h${randomUUID().slice(0, 8)}`, displayName: 'A Shop' },
    });

    expect(res.statusCode).toBe(401);
  });

  it('claims a handle and stores it lowercased', async () => {
    const cookie = await anOwner();
    const handle = `Shop${randomUUID().slice(0, 8)}`;

    const res = await claim(cookie, handle);

    expect(res.statusCode).toBe(201);
    expect(res.json().handle).toBe(handle.toLowerCase());
  });

  it('refuses a handle that is already taken', async () => {
    const handle = `dup${randomUUID().slice(0, 8)}`;
    await claim(await anOwner(), handle);

    const res = await claim(await anOwner(), handle);

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('HANDLE_TAKEN');
  });

  it('refuses a handle that only differs by a lookalike', async () => {
    const cookie = await anOwner();
    const stem = `shape${randomUUID().slice(0, 6)}`;
    await claim(cookie, `${stem}o`);

    // Same skeleton, different handle: 0 folds to o. Told apart from "taken"
    // on purpose -- an owner who cannot tell the two apart keeps guessing.
    const res = await claim(await anOwner(), `${stem}0`);

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('HANDLE_TOO_SIMILAR');
  });

  it('refuses a second page for an account that already has one', async () => {
    const cookie = await anOwner();
    await claim(cookie, `first${randomUUID().slice(0, 8)}`);

    const res = await claim(cookie, `second${randomUUID().slice(0, 8)}`);

    // Not "taken": the handle is free. Reporting the wrong reason here sends
    // someone off inventing handles to fix a problem that is not the handle.
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('PAGE_EXISTS');
  });

  it('refuses a malformed handle and a reserved one, distinguishably', async () => {
    const cookie = await anOwner();

    // Both length boundaries, and both must come back as domain errors. If the
    // route schema ever restates the length rule, these arrive as
    // INTERNAL_ERROR instead and the caller cannot tell a typo from an outage.
    expect((await claim(cookie, 'ab')).json().error.code).toBe('HANDLE_INVALID');
    expect((await claim(cookie, 'a'.repeat(31))).json().error.code).toBe('HANDLE_INVALID');
    expect((await claim(cookie, 'admin')).json().error.code).toBe('HANDLE_RESERVED');
    expect((await claim(cookie, 'adm1n')).json().error.code).toBe('HANDLE_RESERVED');
  });

  it('writes no page when the handle is rejected', async () => {
    const cookie = await anOwner();

    await claim(cookie, 'admin');

    const res = await claim(cookie, `after${randomUUID().slice(0, 8)}`);
    // If the rejected attempt had written a row, this would be PAGE_EXISTS.
    expect(res.statusCode).toBe(201);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @curios/api test src/modules/pages/page.routes.test.ts`
Expected: FAIL — `/pages` returns 404 for every case.

- [ ] **Step 3: Write the service**

Create `apps/api/src/modules/pages/page.service.ts`:

```ts
import type { PrismaClient } from '@curios/db';
import { checkHandle } from '@curios/core';

export class HandleInvalidError extends Error {
  readonly statusCode = 400;
  readonly code = 'HANDLE_INVALID';
  constructor() {
    super('Handles are 3 to 30 characters, letters, numbers, hyphens and underscores, and cannot start or end with a separator.');
    this.name = 'HandleInvalidError';
  }
}

export class HandleReservedError extends Error {
  readonly statusCode = 400;
  readonly code = 'HANDLE_RESERVED';
  constructor() {
    super('That handle is reserved. Pick another.');
    this.name = 'HandleReservedError';
  }
}

export class HandleTakenError extends Error {
  readonly statusCode = 409;
  readonly code = 'HANDLE_TAKEN';
  constructor() {
    super('That handle is taken. Pick another.');
    this.name = 'HandleTakenError';
  }
}

export class HandleTooSimilarError extends Error {
  readonly statusCode = 409;
  readonly code = 'HANDLE_TOO_SIMILAR';
  constructor() {
    // Deliberately a different message from "taken". The handle they typed is
    // free; what it collides with is another handle's shape, and being told
    // "taken" sends them off trying variants that collide the same way.
    super('That handle is too close to one already in use. Pick another.');
    this.name = 'HandleTooSimilarError';
  }
}

export class PageAlreadyExistsError extends Error {
  readonly statusCode = 409;
  readonly code = 'PAGE_EXISTS';
  constructor() {
    super('You already have a page.');
    this.name = 'PageAlreadyExistsError';
  }
}

/** Which unique index a P2002 came from. Prisma reports the field names. */
function violatedFields(error: unknown): string[] {
  if (typeof error !== 'object' || error === null) return [];
  // Narrowed by the `in` check above, so no assertion is needed on `code`.
  // The one on `meta` below IS needed -- nothing narrows that.
  if (!('code' in error) || error.code !== 'P2002') return [];
  const target = (error as { meta?: { target?: unknown } }).meta?.target;
  return Array.isArray(target) ? target.map(String) : [];
}

/**
 * Claims a handle and creates the owner's one page.
 *
 * The unique indexes on `handle`, `skeleton` and `accountId` are the
 * serialisation point; there is no read-then-write check here, because two
 * simultaneous claims would both pass it. Each index maps to its own error,
 * because "taken", "too similar" and "you already have a page" are three
 * different facts and only one of them is fixed by choosing another handle.
 */
export async function claimHandle(
  prisma: PrismaClient,
  accountId: string,
  input: { handle: string; displayName: string },
): Promise<{ pageId: string; handle: string }> {
  const checked = checkHandle(input.handle);
  if (!checked.ok) {
    throw checked.reason === 'RESERVED' ? new HandleReservedError() : new HandleInvalidError();
  }

  try {
    const page = await prisma.page.create({
      data: {
        accountId,
        handle: checked.handle,
        skeleton: checked.skeleton,
        displayName: input.displayName.trim(),
      },
      select: { id: true, handle: true },
    });
    return { pageId: page.id, handle: page.handle };
  } catch (error) {
    const fields = violatedFields(error);
    if (fields.includes('accountId')) throw new PageAlreadyExistsError();
    if (fields.includes('skeleton')) throw new HandleTooSimilarError();
    if (fields.includes('handle')) throw new HandleTakenError();
    throw error;
  }
}
```

- [ ] **Step 4: Whitelist the codes**

Add `'HANDLE_INVALID'`, `'HANDLE_RESERVED'`, `'HANDLE_TAKEN'`, `'HANDLE_TOO_SIMILAR'` and `'PAGE_EXISTS'` to `DOMAIN_ERROR_CODES` in `apps/api/src/plugins/errors.ts`. Without this every one of them reaches the browser as `INTERNAL_ERROR` and the tests above fail on the code rather than the status.

- [ ] **Step 5: Write the route**

Create `apps/api/src/modules/pages/page.routes.ts`:

```ts
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { UnauthenticatedError } from '../../plugins/session.js';
import { claimHandle } from './page.service.js';

export const pageRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/pages',
    {
      schema: {
        body: z.object({
          // Deliberately NOT HANDLE_MIN/HANDLE_MAX. Schema validation runs
          // before the handler, so bounding the handle here means a too-short
          // handle never reaches `checkHandle` and comes back as a Fastify
          // validation error -- which `errorsPlugin` does not whitelist, so the
          // caller is told INTERNAL_ERROR for typing two characters.
          //
          // The 200 is an abuse bound on the payload, nothing more. Every real
          // decision about what a handle may be belongs to `checkHandle`, which
          // has a code and a message that say what the rule is.
          handle: z.string().min(1).max(200),
          displayName: z.string().min(1).max(80),
        }),
      },
    },
    async (request, reply) => {
      // Required on the scope in app.ts. Narrowed rather than asserted, so a
      // non-null assertion cannot outlive someone moving that hook.
      if (!request.account) throw new UnauthenticatedError();

      const result = await claimHandle(app.prisma, request.account.id, request.body);
      return reply.status(201).send(result);
    },
  );
};
```

- [ ] **Step 6: Register it behind a session**

In `apps/api/src/app.ts`, add a scope after the auth scopes. The session check is an `onRequest` hook on the scope rather than a per-route `preHandler`, for the reason plan 1's Task 11 established: route-level hooks run after instance-level ones, so a per-route check lets any limiter registered here count a request that is about to be rejected.

```ts
  await app.register(async (scope) => {
    scope.addHook('onRequest', requireSession);
    await scope.register(pageRoutes);
  });
```

Import `pageRoutes` from `./modules/pages/page.routes.js`.

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm --filter @curios/api test src/modules/pages/page.routes.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 8: Prove the collision tests have teeth**

The RED above was a 404 on a missing route, which says nothing about whether the three P2002 branches are wired to the right constraints. Verify by mutation, one at a time: change `fields.includes('skeleton')` to `fields.includes('handle')` and confirm the too-similar test fails; restore; delete the `accountId` branch and confirm the second-page test fails; restore. Record what you saw.

- [ ] **Step 9: Commit**

```bash
git add apps/api
git commit -m "feat(api): claim a handle, with the three collisions told apart"
```

---

### Task 4: The two reads `apps/web` needs

**Files:**
- Create: `packages/db-read/src/session.query.ts`, `packages/db-read/src/review.query.ts`
- Modify: `packages/db-read/src/index.ts`, `packages/db-read/package.json`
- Test: `packages/db-read/src/session.query.test.ts`, `packages/db-read/src/review.query.test.ts`

**Interfaces:**
- Consumes: `hashSessionValue` (Task 2); `Fact.rejectedAt` (Task 1).
- Produces: `getOwnerSession(value): Promise<{ accountId: string } | null>`, `getReviewQueue(accountId, options): Promise<ReviewFact[]>`, `type ReviewFact`.

- [ ] **Step 1: Check the dependency, which is probably already there**

`packages/db-read` needs `@curios/core` for the hash. It already declares it — slice 1's
commit 3943eef added it — so confirm rather than add:

```bash
grep -n '@curios/core' packages/db-read/package.json
```

If for some reason it is absent, `pnpm --filter @curios/db-read add @curios/core@workspace:*`
adds it. That file keeps `scripts`, `dependencies` and `devDependencies` on single lines, and
a careless edit has broken it before, so afterwards confirm it still parses:
`node -e "JSON.parse(require('fs').readFileSync('packages/db-read/package.json','utf8'))"`

- [ ] **Step 2: Write the failing tests**

Create `packages/db-read/src/session.query.test.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { hashSessionValue } from '@curios/core';
import { getOwnerSession } from './session.query.js';

const write = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });

let accountId = '';

beforeAll(async () => {
  const account = await write.account.create({
    data: { email: `sess-${randomUUID()}@example.com` },
    select: { id: true },
  });
  accountId = account.id;
});

async function aSession(expiresAt: Date): Promise<string> {
  const value = randomUUID();
  await write.session.create({
    data: { id: hashSessionValue(value), accountId, expiresAt },
  });
  return value;
}

describe('getOwnerSession', () => {
  it('resolves a live session to its account', async () => {
    const value = await aSession(new Date(Date.now() + 60_000));

    expect(await getOwnerSession(value)).toEqual({ accountId });
  });

  it('refuses a session past its absolute expiry', async () => {
    const value = await aSession(new Date(Date.now() - 1000));

    expect(await getOwnerSession(value)).toBeNull();
  });

  it('refuses a session that has gone idle, exactly as the API does', async () => {
    const value = randomUUID();
    await write.session.create({
      data: {
        id: hashSessionValue(value),
        accountId,
        // Well inside the 30-day absolute window, well outside the 14-day idle
        // one. This is the gap where the API and this function would disagree
        // if only expiresAt were checked.
        expiresAt: new Date(Date.now() + 16 * 24 * 60 * 60 * 1000),
        lastSeenAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000),
      },
    });

    expect(await getOwnerSession(value)).toBeNull();
  });

  it('refuses a value that was never issued', async () => {
    expect(await getOwnerSession('invented')).toBeNull();
  });

  it('does not write, so the read-only role can run it', async () => {
    const value = await aSession(new Date(Date.now() + 60_000));
    const before = await write.session.findUnique({
      where: { id: hashSessionValue(value) },
      select: { lastSeenAt: true },
    });

    await getOwnerSession(value);

    // The API refreshes sessions. This must not, because apps/web holds a
    // SELECT-only connection -- the trap FRONTEND.md fell into with
    // "refreshed by middleware".
    const after = await write.session.findUnique({
      where: { id: hashSessionValue(value) },
      select: { lastSeenAt: true },
    });
    expect(after?.lastSeenAt.getTime()).toBe(before?.lastSeenAt.getTime());
  });
});
```

Create `packages/db-read/src/review.query.test.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { getReviewQueue } from './review.query.js';

const write = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });

let mine = '';
let theirs = '';
let myPageId = '';

async function anOwnerWithAPage(): Promise<{ accountId: string; pageId: string }> {
  const slug = randomUUID().slice(0, 8);
  const account = await write.account.create({
    data: {
      email: `rq-${randomUUID()}@example.com`,
      pages: { create: { handle: `rq-${slug}`, skeleton: `rq-${slug}`, displayName: 'Q' } },
    },
    select: { id: true, pages: { select: { id: true } } },
  });
  return { accountId: account.id, pageId: account.pages[0]?.id ?? '' };
}

async function aFact(pageId: string, claim: string, extra: Record<string, unknown> = {}) {
  await write.fact.create({
    data: {
      pageId,
      category: 'PRICE',
      claim,
      normalizedClaim: claim,
      confidence: 0.9,
      ...extra,
    },
  });
}

beforeAll(async () => {
  const a = await anOwnerWithAPage();
  const b = await anOwnerWithAPage();
  mine = a.accountId;
  myPageId = a.pageId;
  theirs = b.accountId;

  await aFact(myPageId, 'kuih lapis is rm12');
  await aFact(myPageId, 'we open at nine', { verified: true });
  await aFact(myPageId, 'we are halal certified', { rejectedAt: new Date() });
  await aFact(b.pageId, 'someone elses fact');
});

describe('getReviewQueue', () => {
  it('returns only facts still awaiting review', async () => {
    const queue = await getReviewQueue(mine, { limit: 50 });

    // Verified facts are done. Rejected facts were answered once already, and
    // asking again is the thing the soft delete exists to prevent.
    expect(queue.map((f) => f.claim)).toEqual(['kuih lapis is rm12']);
  });

  it('returns nothing for an account that owns none of them', async () => {
    // Scoped in the query rather than filtered after the read. This is the
    // same shape as the ingest IDOR plan 1 closed, on a read path.
    expect(await getReviewQueue(theirs, { limit: 50 })).toEqual(
      expect.not.arrayContaining([expect.objectContaining({ claim: 'kuih lapis is rm12' })]),
    );
  });

  it('carries the source line the review screen renders', async () => {
    const queue = await getReviewQueue(mine, { limit: 50 });

    // sourceText already exists in the schema, commented "the line it came
    // from, for the review screen". This is that screen.
    expect(queue[0]).toHaveProperty('sourceText');
  });

  it('bounds what it returns', async () => {
    for (let i = 0; i < 5; i += 1) await aFact(myPageId, `extra claim number ${i}`);

    // A 25-page crawl yields well over a hundred facts. Review is a queue that
    // empties, not a wall that intimidates.
    expect(await getReviewQueue(mine, { limit: 3 })).toHaveLength(3);
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm --filter @curios/db-read test`
Expected: FAIL — cannot resolve `./session.query.js` and `./review.query.js`.

- [ ] **Step 4: Write the queries**

Create `packages/db-read/src/session.query.ts`:

```ts
import { hashSessionValue, SESSION_IDLE_TTL_MS } from '@curios/core';
import { prismaRead } from './client.js';

/**
 * Whose session this is, or null. Read-only by design.
 *
 * The `/app` layout validates a session against the database, and `apps/web`
 * connects as `curios_readonly`. The API's `validateSession` also performs the
 * sliding refresh, which is a write, so the layout cannot call it -- that is
 * the trap FRONTEND.md fell into when it said the cookie was "refreshed by
 * middleware". Refreshing stays in the API, where a write is legal.
 *
 * BOTH clocks are checked, and both in the WHERE clause rather than after the
 * read, so an invalid row can never be returned to a caller that forgets to
 * look. The absolute one is `expiresAt`, fixed at creation. The idle one is
 * `lastSeenAt`, which the API moves on its sliding refresh.
 *
 * Checking only `expiresAt` here would let this disagree with the API: between
 * fourteen and thirty days of inactivity the API treats a session as dead while
 * this would still call it live, so the layout would render a dashboard whose
 * every request then 401s. Two components disagreeing about who is signed in is
 * worse than either answer.
 */
export async function getOwnerSession(value: string): Promise<{ accountId: string } | null> {
  const session = await prismaRead.session.findFirst({
    where: {
      id: hashSessionValue(value),
      expiresAt: { gt: new Date() },
      lastSeenAt: { gt: new Date(Date.now() - SESSION_IDLE_TTL_MS) },
    },
    select: { accountId: true },
  });

  return session ? { accountId: session.accountId } : null;
}
```

Create `packages/db-read/src/review.query.ts`:

```ts
import type { FactCategory } from '@curios/core';
import { prismaRead } from './client.js';

export interface ReviewFact {
  id: string;
  category: FactCategory;
  claim: string;
  sourceText: string | null;
  sourceUrl: string | null;
  confidence: number;
}

/**
 * The facts this owner still has to answer for, oldest first.
 *
 * Scoped through the page's owner inside the query. A read-then-filter here
 * would be the same defect as the ingest IDOR, on a read path, and it would
 * leak another owner's `sourceText` -- which is a verbatim line from their
 * website.
 *
 * Verified facts are finished. Rejected facts were answered once already, and
 * the whole point of `rejectedAt` being a soft delete is not asking again.
 */
export async function getReviewQueue(
  accountId: string,
  options: { limit: number },
): Promise<ReviewFact[]> {
  return prismaRead.fact.findMany({
    where: { page: { accountId }, verified: false, rejectedAt: null },
    orderBy: { createdAt: 'asc' },
    take: Math.min(Math.max(options.limit, 1), 100),
    select: {
      id: true,
      category: true,
      claim: true,
      sourceText: true,
      sourceUrl: true,
      confidence: true,
    },
  });
}
```

- [ ] **Step 4b: Move the session TTLs into `packages/core`**

`getOwnerSession` needs the idle window, and it lives in
`apps/api/src/modules/auth/session.service.ts`, which `packages/db-read` cannot import. This
is the same problem F1 ruled on for the hash, and it gets the same answer: one definition,
imported by both, rather than the number copied into a second package where it will drift.

Create `packages/core/src/session.ts`:

```ts
/**
 * How long a session lives, in two clocks.
 *
 * Here rather than in `apps/api` because `packages/db-read` enforces the same
 * two clocks for the authenticated layout, and cannot import from an app. A
 * copy in each package is how the API and the web layout end up disagreeing
 * about who is signed in.
 */
export const SESSION_ABSOLUTE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_IDLE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
```

Then in `apps/api/src/modules/auth/session.service.ts`, replace the two local constant
declarations with a re-export, so every existing call site keeps working unchanged:

```ts
import { SESSION_ABSOLUTE_TTL_MS, SESSION_IDLE_TTL_MS } from '@curios/core';

export const ABSOLUTE_TTL_MS = SESSION_ABSOLUTE_TTL_MS;
export const IDLE_TTL_MS = SESSION_IDLE_TTL_MS;
```

`REFRESH_AFTER_MS` still derives from `IDLE_TTL_MS` and does not change. `auth.routes.ts`
imports `ABSOLUTE_TTL_MS` and does not change either. The API's own session tests passing
unmodified is the evidence this moved nothing.

- [ ] **Step 5: Export them**

Add to `packages/db-read/src/index.ts`:

```ts
export { getOwnerSession } from './session.query.js';
export { getReviewQueue } from './review.query.js';
export type { ReviewFact } from './review.query.js';
```

- [ ] **Step 6: Turn off file parallelism in this package**

`page.query.test.ts` already truncates the shared `Account` table in `beforeAll`. Vitest runs
files within a package in parallel by default, so that truncate races the inserts the two new
test files make in their own `beforeAll` and occasionally deletes a row out from under them,
surfacing as an `Fact_pageId_fkey` violation. It is intermittent, which is the worst kind.

`apps/api/vitest.config.ts` already carries this exact fix for this exact reason. Add the same
line to `packages/db-read/vitest.config.ts`:

```ts
export default defineConfig({
  test: {
    setupFiles: ['../../vitest.setup.ts', './vitest.setup.ts'],
    fileParallelism: false,
  },
});
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm --filter @curios/db-read test`
Expected: PASS. Run it three times — an intermittent race is not disproved by one green run.

These run as the read-only role, which is the point: if either query ever gains a write, it fails here with SQLSTATE 42501 rather than in review.

- [ ] **Step 7: Commit**

```bash
git add packages/db-read
git commit -m "feat(db-read): read-only session validation and the review queue"
```

---
### Task 5: Review one fact at a time

**Files:**
- Create: `apps/api/src/modules/facts/fact.service.ts`, `apps/api/src/modules/facts/fact.routes.ts`
- Modify: `apps/api/src/app.ts`, `apps/api/src/plugins/errors.ts`
- Test: `apps/api/src/modules/facts/fact.routes.test.ts`

**Interfaces:**
- Consumes: `normalizeClaim` from `@curios/core`; `requireSession`, `UnauthenticatedError`.
- Produces: `verifyFact(prisma, accountId, factId)`, `editFact(prisma, accountId, factId, claim)`, `rejectFact(prisma, accountId, factId)`, `FactNotFoundError`, `DuplicateFactError`, `factRoutes`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/modules/facts/fact.routes.test.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { createSession, SESSION_COOKIE } from '../auth/session.service.js';

let app: FastifyInstance;

let nth = 0;
/** A fresh source address per request, so the limiter never sees a flood. */
const from = () => `203.0.113.${(nth++ % 200) + 1}`;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

async function anOwnerWithAFact(claim = 'kuih lapis is rm12') {
  const slug = randomUUID().slice(0, 8);
  const account = await app.prisma.account.create({
    data: {
      email: `fact-${randomUUID()}@example.com`,
      pages: { create: { handle: `f-${slug}`, skeleton: `f-${slug}`, displayName: 'F' } },
    },
    select: { id: true, pages: { select: { id: true } } },
  });
  const pageId = account.pages[0]?.id ?? '';
  const fact = await app.prisma.fact.create({
    data: { pageId, category: 'PRICE', claim, normalizedClaim: claim, confidence: 0.9 },
    select: { id: true },
  });
  const { value } = await createSession(app.prisma, account.id);
  return { cookie: value, pageId, factId: fact.id };
}

describe('POST /facts/:id/verify', () => {
  it('verifies one fact', async () => {
    const mine = await anOwnerWithAFact();

    const res = await app.inject({
      method: 'POST',
      url: `/facts/${mine.factId}/verify`,
      remoteAddress: from(),
      cookies: { [SESSION_COOKIE]: mine.cookie },
    });

    expect(res.statusCode).toBe(200);
    const fact = await app.prisma.fact.findUnique({ where: { id: mine.factId } });
    expect(fact?.verified).toBe(true);
  });

  it('refuses another owner fact, and leaves it unverified', async () => {
    const mine = await anOwnerWithAFact();
    const theirs = await anOwnerWithAFact('their price is rm40');

    const res = await app.inject({
      method: 'POST',
      url: `/facts/${theirs.factId}/verify`,
      remoteAddress: from(),
      cookies: { [SESSION_COOKIE]: mine.cookie },
    });

    // Verifying is what puts a claim in front of a customer. Doing it to
    // someone else's page is the planted-price attack in one request.
    expect(res.statusCode).toBe(404);
    const fact = await app.prisma.fact.findUnique({ where: { id: theirs.factId } });
    expect(fact?.verified).toBe(false);
  });

  it('refuses an unauthenticated caller', async () => {
    const mine = await anOwnerWithAFact();

    const res = await app.inject({
      method: 'POST',
      url: `/facts/${mine.factId}/verify`,
      remoteAddress: from(),
    });

    expect(res.statusCode).toBe(401);
  });
});

describe('PATCH /facts/:id', () => {
  it('re-normalises an edited claim', async () => {
    const mine = await anOwnerWithAFact();

    const res = await app.inject({
      method: 'PATCH',
      url: `/facts/${mine.factId}`,
      remoteAddress: from(),
      cookies: { [SESSION_COOKIE]: mine.cookie },
      payload: { claim: 'Kuih Lapis is RM14!' },
    });

    expect(res.statusCode).toBe(200);
    const fact = await app.prisma.fact.findUnique({ where: { id: mine.factId } });
    // The dedupe key must never drift from the text it keys.
    expect(fact?.claim).toBe('Kuih Lapis is RM14!');
    expect(fact?.normalizedClaim).toBe('kuih lapis is rm14');
  });

  it('reports an edit that collides with another fact on the same page', async () => {
    const mine = await anOwnerWithAFact('first claim here');
    await app.prisma.fact.create({
      data: {
        pageId: mine.pageId,
        category: 'PRICE',
        claim: 'second claim here',
        normalizedClaim: 'second claim here',
        confidence: 0.9,
      },
    });

    const res = await app.inject({
      method: 'PATCH',
      url: `/facts/${mine.factId}`,
      remoteAddress: from(),
      cookies: { [SESSION_COOKIE]: mine.cookie },
      payload: { claim: 'Second claim here' },
    });

    // A P2002 on [pageId, normalizedClaim], surfaced as something an owner can
    // act on rather than a 500.
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('FACT_DUPLICATE');
  });
});

describe('POST /facts/:id/reject', () => {
  it('soft-deletes the fact and stops it being public', async () => {
    const mine = await anOwnerWithAFact();
    await app.inject({
      method: 'POST',
      url: `/facts/${mine.factId}/verify`,
      remoteAddress: from(),
      cookies: { [SESSION_COOKIE]: mine.cookie },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/facts/${mine.factId}/reject`,
      remoteAddress: from(),
      cookies: { [SESSION_COOKIE]: mine.cookie },
    });

    expect(res.statusCode).toBe(200);
    const fact = await app.prisma.fact.findUnique({ where: { id: mine.factId } });
    expect(fact?.rejectedAt).not.toBeNull();
    // Both public read paths filter on `verified`, not on `rejectedAt`. If
    // rejecting a previously accepted fact left verified true, the rejected
    // claim would still be answering customers.
    expect(fact?.verified).toBe(false);
  });

  it('keeps the row, so the next crawl does not re-ask', async () => {
    const mine = await anOwnerWithAFact();

    await app.inject({
      method: 'POST',
      url: `/facts/${mine.factId}/reject`,
      remoteAddress: from(),
      cookies: { [SESSION_COOKIE]: mine.cookie },
    });

    // Extraction writes with skipDuplicates against
    // @@unique([pageId, normalizedClaim]). A hard delete would let the same
    // dismissed claim reappear in the queue on the next crawl.
    expect(await app.prisma.fact.findUnique({ where: { id: mine.factId } })).not.toBeNull();
  });
});

describe('the one hard rule', () => {
  it('exposes no route that can verify more than one fact', () => {
    const routes = app.printRoutes({ commonPrefix: false });

    // A negative requirement, so it needs a test that fails when someone adds
    // the thing rather than one that passes because they have not yet.
    //
    // What this catches: a bulk route with no id in its path. What it does NOT
    // catch: a bulk accept smuggled through the body of a route that still has
    // an :id. That case is covered behaviourally by the test below, and the
    // real backstop for both is that `verifyFact` takes one id and has no
    // plural form. This test is the cheap outer guard, not the guarantee.
    const mutating = routes
      .split('\n')
      .filter((line) => line.includes('/facts') && /POST|PATCH|PUT|DELETE/.test(line));

    expect(mutating.length).toBeGreaterThan(0);
    for (const line of mutating) {
      expect(line).toMatch(/:id/);
    }
  });

  it('verifies only the fact in the path, whatever the body asks for', async () => {
    const mine = await anOwnerWithAFact('the first claim');
    const second = await app.prisma.fact.create({
      data: {
        pageId: mine.pageId,
        category: 'PRICE',
        claim: 'the second claim',
        normalizedClaim: 'the second claim',
        confidence: 0.9,
      },
      select: { id: true },
    });

    await app.inject({
      method: 'POST',
      url: `/facts/${mine.factId}/verify`,
      remoteAddress: from(),
      cookies: { [SESSION_COOKIE]: mine.cookie },
      // The shape the route-table test cannot see: a bulk accept asked for
      // through the body of a route that does have an :id.
      payload: { alsoVerify: [second.id], all: true },
    });

    expect((await app.prisma.fact.findUnique({ where: { id: second.id } }))?.verified).toBe(false);
  });
});

describe('the other two routes are scoped and guarded too', () => {
  it('refuses to edit another owner fact', async () => {
    const mine = await anOwnerWithAFact();
    const theirs = await anOwnerWithAFact('their claim');

    const res = await app.inject({
      method: 'PATCH',
      url: `/facts/${theirs.factId}`,
      remoteAddress: from(),
      cookies: { [SESSION_COOKIE]: mine.cookie },
      payload: { claim: 'rewritten by a stranger' },
    });

    expect(res.statusCode).toBe(404);
    const fact = await app.prisma.fact.findUnique({ where: { id: theirs.factId } });
    expect(fact?.claim).toBe('their claim');
  });

  it('refuses to reject another owner fact', async () => {
    const mine = await anOwnerWithAFact();
    const theirs = await anOwnerWithAFact('their other claim');

    const res = await app.inject({
      method: 'POST',
      url: `/facts/${theirs.factId}/reject`,
      remoteAddress: from(),
      cookies: { [SESSION_COOKIE]: mine.cookie },
    });

    expect(res.statusCode).toBe(404);
    expect((await app.prisma.fact.findUnique({ where: { id: theirs.factId } }))?.rejectedAt).toBeNull();
  });

  it('refuses an unauthenticated caller on both', async () => {
    const mine = await anOwnerWithAFact();

    const edit = await app.inject({
      method: 'PATCH',
      url: `/facts/${mine.factId}`,
      remoteAddress: from(),
      payload: { claim: 'anything' },
    });
    const reject = await app.inject({
      method: 'POST',
      url: `/facts/${mine.factId}/reject`,
      remoteAddress: from(),
    });

    expect(edit.statusCode).toBe(401);
    expect(reject.statusCode).toBe(401);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @curios/api test src/modules/facts/fact.routes.test.ts`
Expected: FAIL — every route returns 404, and the route-table test fails on `mutating.length` being 0.

- [ ] **Step 3: Write the service**

Create `apps/api/src/modules/facts/fact.service.ts`:

```ts
import type { PrismaClient } from '@curios/db';
import { normalizeClaim } from '@curios/core';

export class FactNotFoundError extends Error {
  readonly statusCode = 404;
  readonly code = 'NOT_FOUND';
  constructor() {
    // 404 rather than 403 for a fact on someone else's page: a 403 confirms
    // the id exists.
    super('No such fact.');
    this.name = 'FactNotFoundError';
  }
}

export class DuplicateFactError extends Error {
  readonly statusCode = 409;
  readonly code = 'FACT_DUPLICATE';
  constructor() {
    super('You already have a fact that says this.');
    this.name = 'DuplicateFactError';
  }
}

function isUniqueViolation(error: unknown): boolean {
  // No assertion on `code`: the `in` check narrows it. Matches the identical
  // helper in auth.service.ts, and the linter rejects the cast anyway.
  return (
    typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002'
  );
}

/**
 * Accepts exactly one fact.
 *
 * There is no plural form of this function and there must never be one. The
 * spec's single hard rule is that nothing sets `verified: true` except an
 * explicit human action on one specific fact, because a bulk-accept control is
 * how an unreviewed price reaches a customer.
 *
 * A rejected fact cannot be accepted: it was already answered.
 */
export async function verifyFact(
  prisma: PrismaClient,
  accountId: string,
  factId: string,
): Promise<void> {
  const claimed = await prisma.fact.updateMany({
    where: { id: factId, page: { accountId }, rejectedAt: null },
    data: { verified: true },
  });

  if (claimed.count !== 1) throw new FactNotFoundError();
}

/**
 * Rewrites a claim, and the dedupe key with it.
 *
 * `normalizeClaim` is re-run rather than left alone, so the key never drifts
 * from the text it is meant to key. That is also what makes a collision
 * possible here, and a collision is an owner-fixable fact rather than a 500.
 */
export async function editFact(
  prisma: PrismaClient,
  accountId: string,
  factId: string,
  claim: string,
): Promise<void> {
  let updated;
  try {
    updated = await prisma.fact.updateMany({
      where: { id: factId, page: { accountId } },
      data: { claim, normalizedClaim: normalizeClaim(claim) },
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new DuplicateFactError();
    throw error;
  }

  // Thrown OUTSIDE the catch above, deliberately. Inside it, a not-found we
  // raised ourselves would be handed to `isUniqueViolation` to classify, and
  // the two would only stay distinct for as long as their `code` values happen
  // to differ.
  if (updated.count !== 1) throw new FactNotFoundError();
}

/**
 * Rejects a fact without deleting the row.
 *
 * The row is what suppresses the re-ask: extraction writes with
 * `skipDuplicates` against `@@unique([pageId, normalizedClaim])`, so a hard
 * delete means the next crawl re-creates the claim the owner just dismissed.
 *
 * `verified` is cleared as well as `rejectedAt` being set. Both public read
 * paths filter on `verified` and neither looks at `rejectedAt`, so rejecting a
 * previously accepted fact without this would leave the rejected claim
 * answering customers.
 */
export async function rejectFact(
  prisma: PrismaClient,
  accountId: string,
  factId: string,
): Promise<void> {
  const rejected = await prisma.fact.updateMany({
    where: { id: factId, page: { accountId } },
    data: { rejectedAt: new Date(), verified: false },
  });

  if (rejected.count !== 1) throw new FactNotFoundError();
}
```

- [ ] **Step 4: Whitelist the code**

Add `'FACT_DUPLICATE'` to `DOMAIN_ERROR_CODES`. `'NOT_FOUND'` is already listed, from plan 1's review round.

- [ ] **Step 5: Write the routes**

Create `apps/api/src/modules/facts/fact.routes.ts`:

```ts
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { UnauthenticatedError } from '../../plugins/session.js';
import { editFact, rejectFact, verifyFact } from './fact.service.js';

const params = z.object({ id: z.string().min(1).max(64) });

export const factRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post('/facts/:id/verify', { schema: { params } }, async (request, reply) => {
    if (!request.account) throw new UnauthenticatedError();

    await verifyFact(app.prisma, request.account.id, request.params.id);
    return reply.send({ status: 'verified' });
  });

  app.patch(
    '/facts/:id',
    { schema: { params, body: z.object({ claim: z.string().min(1).max(500) }) } },
    async (request, reply) => {
      if (!request.account) throw new UnauthenticatedError();

      await editFact(app.prisma, request.account.id, request.params.id, request.body.claim);
      return reply.send({ status: 'updated' });
    },
  );

  app.post('/facts/:id/reject', { schema: { params } }, async (request, reply) => {
    if (!request.account) throw new UnauthenticatedError();

    await rejectFact(app.prisma, request.account.id, request.params.id);
    return reply.send({ status: 'rejected' });
  });
};
```

- [ ] **Step 6: Register it in the authenticated scope**

In `apps/api/src/app.ts`, add `factRoutes` to the same session-guarded scope Task 3 created:

```ts
    await scope.register(factRoutes);
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm --filter @curios/api test src/modules/facts/fact.routes.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 8: Prove the ownership scoping has teeth**

Do this for all THREE functions, one at a time, not just `verifyFact`. In each, drop
`page: { accountId }` from the `where` clause, run the file, confirm the matching cross-owner
test fails, and restore. Record what you saw for each.

The RED in step 2 was a 404 from a missing route, which proves nothing about scoping. And a
mutation check on one of three functions proves nothing about the other two — that gap is
exactly what a later refactor walks through.

- [ ] **Step 9: Commit**

```bash
git add apps/api
git commit -m "feat(api): accept, edit and reject one fact at a time"
```

---

### Task 6: Publish

**Files:**
- Create: nothing
- Modify: `apps/api/src/modules/pages/page.service.ts`, `apps/api/src/modules/pages/page.routes.ts`, `apps/api/src/plugins/errors.ts`
- Test: `apps/api/src/modules/pages/page.routes.test.ts` (append)

**Interfaces:**
- Produces: `publishPage(prisma, accountId): Promise<void>`, `NoPageError`.

- [ ] **Step 1: Write the failing test**

Append to `apps/api/src/modules/pages/page.routes.test.ts`:

```ts
describe('POST /publish', () => {
  it('publishes the caller own page', async () => {
    const cookie = await anOwner();
    await claim(cookie, `pub${randomUUID().slice(0, 8)}`);

    const res = await app.inject({
      method: 'POST',
      url: '/publish',
      remoteAddress: from(),
      cookies: { [SESSION_COOKIE]: cookie },
    });

    expect(res.statusCode).toBe(200);
  });

  it('takes no page id at all', () => {
    const routes = app.printRoutes({ commonPrefix: false });

    // One page per account is a database constraint, so the caller's page is
    // never ambiguous. Taking an id would create an IDOR surface to defend for
    // no benefit -- the same class of hole plan 1 closed on /ingest.
    const publishRoutes = routes.split('\n').filter((line) => line.includes('publish'));
    expect(publishRoutes.length).toBeGreaterThan(0);
    for (const line of publishRoutes) expect(line).not.toMatch(/:/);
  });

  it('refuses an owner with no page yet', async () => {
    const cookie = await anOwner();

    const res = await app.inject({
      method: 'POST',
      url: '/publish',
      remoteAddress: from(),
      cookies: { [SESSION_COOKIE]: cookie },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NO_PAGE');
  });

  it('refuses an unauthenticated caller', async () => {
    const res = await app.inject({ method: 'POST', url: '/publish', remoteAddress: from() });

    expect(res.statusCode).toBe(401);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @curios/api test src/modules/pages/page.routes.test.ts`
Expected: FAIL — `/publish` returns 404 for the authenticated cases.

- [ ] **Step 3: Write the service**

Append to `apps/api/src/modules/pages/page.service.ts`:

```ts
export class NoPageError extends Error {
  readonly statusCode = 404;
  readonly code = 'NO_PAGE';
  constructor() {
    super('Claim a handle first.');
    this.name = 'NoPageError';
  }
}

/**
 * The deliberate owner action that makes a page visible.
 *
 * Takes no page id. One page per account is a database constraint, so the
 * caller's page is unambiguous, and an id parameter would only add an
 * authorization surface to get wrong.
 *
 * Slice 1 already filters both read paths on `published`, which is why this
 * had to exist in this slice at all: without it nothing an owner does can ever
 * be seen.
 */
export async function publishPage(prisma: PrismaClient, accountId: string): Promise<void> {
  const published = await prisma.page.updateMany({
    where: { accountId },
    data: { published: true },
  });

  if (published.count !== 1) throw new NoPageError();
}
```

- [ ] **Step 4: Whitelist the code and add the route**

Add `'NO_PAGE'` to `DOMAIN_ERROR_CODES`.

Append to `pageRoutes` in `apps/api/src/modules/pages/page.routes.ts`:

```ts
  app.post('/publish', async (request, reply) => {
    if (!request.account) throw new UnauthenticatedError();

    await publishPage(app.prisma, request.account.id);
    return reply.send({ status: 'published' });
  });
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @curios/api test src/modules/pages/page.routes.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/api
git commit -m "feat(api): publish a page"
```

---

### Task 7: A second way in — link a password or a Google account

**Files:**
- Modify: `apps/api/src/modules/auth/auth.service.ts`, `apps/api/src/modules/auth/auth.routes.ts`, `apps/api/src/modules/auth/oauth.service.ts`, `apps/api/src/app.ts`, `apps/api/src/plugins/errors.ts`
- Test: `apps/api/src/modules/auth/link.test.ts`

**Interfaces:**
- Consumes: `hashPassword`, `isBreached`, `MIN_PASSWORD_LENGTH`, `WeakPasswordError` (plan 1 Task 5); `beginGoogleSignIn`, `exchangeGoogleCode` (plan 1 Task 10).
- Produces: `addPassword(deps, accountId, password)`, `linkGoogleIdentity(prisma, accountId, profile)`, `PasswordAlreadySetError`, `IdentityTakenError`, `OAUTH_LINK_COOKIE`.

**Why this is its own task.** The spec's rule is that nothing merges at sign-in time and linking is explicit and authenticated, because automatic linking by matching address is where account takeovers live. That rule is already enforced by construction in plan 1 — no code path links — so this task is the first that can break it.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/modules/auth/link.test.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { createSession, SESSION_COOKIE } from './session.service.js';
import { hashPassword } from './password.service.js';
import { OAUTH_LINK_COOKIE, OAUTH_STATE_COOKIE, OAUTH_VERIFIER_COOKIE } from './oauth.service.js';

let app: FastifyInstance;

let nth = 0;
/** A fresh source address per request, so the limiter never sees a flood. */
const from = () => `203.0.113.${(nth++ % 200) + 1}`;

const SUB = `link-${randomUUID()}`;
const PASSWORD = 'a-long-enough-passphrase';

beforeAll(async () => {
  app = await buildApp({
    auth: {
      exchange: async () => ({
        sub: SUB,
        email: `google-${randomUUID()}@example.com`,
        emailVerified: true,
        name: 'Nadia',
      }),
      fetcher: async () => ({ ok: true, text: async () => '' }),
    },
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

async function anAccount(withPassword: boolean): Promise<{ id: string; cookie: string }> {
  const account = await app.prisma.account.create({
    data: {
      email: `link-${randomUUID()}@example.com`,
      emailVerifiedAt: new Date(),
      ...(withPassword ? { password: { create: { hash: await hashPassword(PASSWORD) } } } : {}),
    },
    select: { id: true },
  });
  const { value } = await createSession(app.prisma, account.id);
  return { id: account.id, cookie: value };
}

describe('POST /auth/password', () => {
  it('adds a password to an account that has none', async () => {
    const account = await anAccount(false);

    const res = await app.inject({
      method: 'POST',
      url: '/auth/password',
      remoteAddress: from(),
      cookies: { [SESSION_COOKIE]: account.cookie },
      payload: { password: PASSWORD },
    });

    expect(res.statusCode).toBe(200);
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      remoteAddress: from(),
      payload: {
        email: (await app.prisma.account.findUnique({ where: { id: account.id } }))?.email,
        password: PASSWORD,
      },
    });
    expect(login.statusCode).toBe(200);
  });

  it('refuses an unauthenticated caller', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/password',
      remoteAddress: from(),
      payload: { password: PASSWORD },
    });

    expect(res.statusCode).toBe(401);
  });

  it('refuses to overwrite a password that already exists', async () => {
    const account = await anAccount(true);

    const res = await app.inject({
      method: 'POST',
      url: '/auth/password',
      remoteAddress: from(),
      cookies: { [SESSION_COOKIE]: account.cookie },
      payload: { password: 'an-entirely-different-passphrase' },
    });

    // Changing a password is the reset flow, which proves control of the
    // inbox. Letting a session alone rewrite it means a stolen session
    // becomes permanent ownership.
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('PASSWORD_ALREADY_SET');
  });

  it('screens the new password like signup does', async () => {
    const account = await anAccount(false);

    const res = await app.inject({
      method: 'POST',
      url: '/auth/password',
      remoteAddress: from(),
      cookies: { [SESSION_COOKIE]: account.cookie },
      payload: { password: 'sh0rt' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('WEAK_PASSWORD');
  });
});

describe('linking Google while signed in', () => {
  it('attaches the identity to the account already signed in', async () => {
    const account = await anAccount(true);
    const state = 'a-state-this-browser-started-with';

    const res = await app.inject({
      method: 'GET',
      url: `/auth/google/callback?code=abc&state=${state}`,
      remoteAddress: from(),
      cookies: {
        [SESSION_COOKIE]: account.cookie,
        [OAUTH_LINK_COOKIE]: app.signCookie('1'),
        [OAUTH_STATE_COOKIE]: app.signCookie(state),
        [OAUTH_VERIFIER_COOKIE]: app.signCookie('v'),
      },
    });

    expect(res.statusCode).toBe(302);
    const identity = await app.prisma.authIdentity.findFirst({
      where: { provider: 'GOOGLE', providerUserId: SUB },
      select: { accountId: true },
    });
    // Attached to the signed-in account, and no second account created.
    expect(identity?.accountId).toBe(account.id);
  });

  it('creates no account and links nothing when the link cookie arrives without a session', async () => {
    const state = 'another-state';

    const before = await app.prisma.account.count();
    const res = await app.inject({
      method: 'GET',
      url: `/auth/google/callback?code=abc&state=${state}`,
      remoteAddress: from(),
      cookies: {
        [OAUTH_LINK_COOKIE]: app.signCookie('1'),
        [OAUTH_STATE_COOKIE]: app.signCookie(state),
        [OAUTH_VERIFIER_COOKIE]: app.signCookie('v'),
      },
    });

    // A link intent with nothing to link to must not quietly become a signup.
    // That is the branch where "explicit and authenticated" would be lost.
    expect(res.statusCode).toBe(401);
    expect(await app.prisma.account.count()).toBe(before);
  });

  it('refuses to move an identity that already belongs to another account', async () => {
    const first = await anAccount(true);
    const second = await anAccount(true);
    const state = 'shared-state';

    const link = (cookie: string) =>
      app.inject({
        method: 'GET',
        url: `/auth/google/callback?code=abc&state=${state}`,
        remoteAddress: from(),
        cookies: {
          [SESSION_COOKIE]: cookie,
          [OAUTH_LINK_COOKIE]: app.signCookie('1'),
          [OAUTH_STATE_COOKIE]: app.signCookie(state),
          [OAUTH_VERIFIER_COOKIE]: app.signCookie('v'),
        },
      });

    await link(first.cookie);
    const res = await link(second.cookie);

    // Otherwise linking is a way to take an identity off someone else's
    // account, which is the takeover the explicit-linking rule exists to stop.
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('IDENTITY_TAKEN');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @curios/api test src/modules/auth/link.test.ts`
Expected: FAIL — `/auth/password` returns 404, and `OAUTH_LINK_COOKIE` does not exist so the file will not resolve. Fix the import by writing the constant in step 3; do not stub it in the test.

- [ ] **Step 3: Add the services**

Append to `apps/api/src/modules/auth/auth.service.ts`:

```ts
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
    if (isUniqueViolation(error)) throw new IdentityTakenError();
    throw error;
  }
}
```

- [ ] **Step 4: Add the link-intent cookie**

In `apps/api/src/modules/auth/oauth.service.ts`, beside the other two cookie names:

```ts
/**
 * Set only by `GET /auth/google/link`, which requires a session. Its presence
 * on the callback is what turns that one endpoint from a sign-in into a link.
 *
 * Signed, like the state and verifier, so planting it is not enough to change
 * which branch the callback takes.
 */
export const OAUTH_LINK_COOKIE = 'curios_oauth_link';
```

- [ ] **Step 5: Add the routes**

In `apps/api/src/modules/auth/auth.routes.ts`, add `/auth/password` to `authFlowRoutes` (it carries no email address, so the per-email limiter has nothing to key on — see plan 1's Task 10 fix), and `/auth/google/link` alongside `/auth/google`:

```ts
  app.post(
    '/auth/password',
    { schema: { body: z.object({ password: z.string().min(1).max(200) }) } },
    async (request, reply) => {
      if (!request.account) throw new UnauthenticatedError();

      await addPassword({ prisma: app.prisma, fetcher }, request.account.id, request.body.password);
      return reply.send({ status: 'password_set' });
    },
  );

  app.get('/auth/google/link', async (request, reply) => {
    // Requires a session here as well as at the callback. Beginning a link
    // while signed out would set an intent cookie that outlives the reason
    // for it.
    if (!request.account) throw new UnauthenticatedError();

    const { url, state, verifier } = beginGoogleSignIn();
    const options = {
      httpOnly: true,
      sameSite: 'lax' as const,
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 600,
      signed: true,
    };

    return reply
      .setCookie(OAUTH_STATE_COOKIE, state, options)
      .setCookie(OAUTH_VERIFIER_COOKIE, verifier, options)
      .setCookie(OAUTH_LINK_COOKIE, '1', options)
      .redirect(url);
  });
```

In the `/auth/google/callback` handler, after the profile is exchanged and before `findOrCreateAccountForGoogle`, branch once:

```ts
      // One branch, stated plainly, in the one place that can see both the
      // intent cookie and the session.
      const linking = unsigned(request.cookies[OAUTH_LINK_COOKIE]) === '1';
      if (linking) {
        // A link intent with nothing to link to must not quietly become a
        // signup -- that is where "explicit and authenticated" would be lost.
        if (!request.account) throw new UnauthenticatedError();

        await linkGoogleIdentity(app.prisma, request.account.id, profile);
        return reply.redirect(`${appUrl}/app/settings?linked=google`);
      }
```

Add `OAUTH_LINK_COOKIE` to the cookies cleared at the top of the callback, so a link intent is spent on every path out exactly as the state and verifier are.

- [ ] **Step 6: Whitelist the codes**

Add `'PASSWORD_ALREADY_SET'` and `'IDENTITY_TAKEN'` to `DOMAIN_ERROR_CODES`.

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm --filter @curios/api test src/modules/auth/link.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 8: Prove the sign-in path did not change**

Run: `pnpm --filter @curios/api test src/modules/auth`
Expected: every plan 1 auth test still passes, including the OAuth route tests. This is the check that matters in this task: a branch was added to the security-critical callback, and the evidence that it did not disturb the sign-in path is that plan 1's tests for it are untouched and still green.

- [ ] **Step 9: Commit**

```bash
git add apps/api
git commit -m "feat(api): add a password or connect google, explicitly and authenticated"
```

---

## Self-review

Run after the plan is written, before dispatching Task 1.

**Spec coverage.** Walk the spec's plan-2a sections and name the task:

| Spec section | Task |
|---|---|
| Handles — claim rules, character class, length, reserved list | T2 |
| Handles — confusables, skeleton algorithm, no letter folding | T2 |
| Handles — claim races, P2002 as "taken" | T1 (indexes), T3 (mapping) |
| Handles — one page per account | T1 (constraint), T3 (error) |
| Onboarding — claim, then paste a URL, then poll | T3 here; the URL field and poll are plan 2b against the ingest routes plan 1 already secured |
| Onboarding — the two authorization holes | closed in plan 1 Task 11; nothing left here |
| Review screen — cards showing claim, category, sourceText | T4 (`getReviewQueue` returns all three) |
| Review screen — the one hard rule | T5, including the route-table test |
| Review screen — rejection is a soft delete | T1 (column), T5 (behaviour) |
| Review screen — editing re-normalises, collision is not a 500 | T5 |
| Review screen — bounded volume, oldest first | T4 |
| Publishing | T6 |
| Linking is explicit and authenticated | T7 |
| Session validated in the `/app` layout | T4 (`getOwnerSession`); the layout itself is plan 2b |

**Gaps deliberately left to plan 2b:** every screen, `middleware.ts`, the authed layout, and the sign-in forms. Nothing in this plan renders anything.

**Type consistency.** `checkHandle` returns `HandleCheck` in T2 and is destructured as `checked.handle` / `checked.skeleton` in T3. `getReviewQueue(accountId, { limit })` in T4 is not called anywhere in this plan — plan 2b is its first caller, so its shape is fixed here and must not be changed there. `hashSessionValue` is the name in `packages/core`; `hashToken` survives only as a re-export in `apps/api/src/lib/tokens.ts`.

**Placeholder scan.** No step says "add validation" or "handle errors" without showing the code. Every error class, every route, and every test body is written out.
