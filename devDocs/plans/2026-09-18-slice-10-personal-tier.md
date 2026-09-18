# Slice 10 — The free personal tier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An owner can choose a free personal page when they claim a handle, get facts onto it without a website, opt it into search engines, and upgrade it to a business page later — and every dashboard screen tells the truth about which one they have.

**Architecture:** Almost every gate already reads `Page.mode`, so this slice supplies the missing ways in: `mode` on the claim, a one-way upgrade, and one new column, `allowSearchIndexing`, whose rule lives in a single core function, `shouldIndex`. Ingestion gains a second source — pasted text, held on the `Ingestion` row beside a now-nullable `sourceUrl`, with a database `CHECK` that exactly one is set — read by a new text adapter in the worker. The crawler gains a meta-tag fallback for thin pages, and an empty crawl stops paying for a model call.

**Tech Stack:** TypeScript, Prisma 6, Postgres, Fastify 5 with `fastify-type-provider-zod` and zod 3, BullMQ 5, cheerio, Next 15 (App Router, RSC), vitest, Testing Library.

**Spec:** `devDocs/slice-10-build-spec.md` — read it before Task 1.

**Branch:** `slice-10/personal-tier`, stacked on `slice-9/money-path` (slice 9, pushed and unmerged — its Billplz sandbox payment is still unrun). This slice's billing-screen changes build on slice 9's `/app/billing`.

## Global Constraints

- **"Never paid" still means `paidUntil` is null**, and the trial rule does not change: `canCapture` and `planState` are untouched.
- **`mode` defaults to `BUSINESS`** on the claim, matching the column. The onboarding form always sends it; the API accepts its absence so existing callers keep working.
- **The upgrade is one-way and succeeds without change on a business page.** An owner with no page gets the existing `NoPageError` (`NO_PAGE`, 404). There is no route back to personal.
- **Indexing is decided in one place:** `shouldIndex({ mode, allowSearchIndexing })` in `@curios/core` — true for every business page, and for a personal page only when it has opted in. Nothing else restates the rule.
- **An ingestion has exactly one source:** `sourceUrl` or `pastedText`, never both, never neither. The API refuses both and neither before writing anything; the database `CHECK` constraint `Ingestion_one_source` holds if anything ever writes around the API.
- **The new column is `pastedText`, never `sourceText`:** `Fact.sourceText` already exists and means the excerpt one fact came from.
- **`pastedText` is capped at 20,000 characters.** The SSRF host guard runs only for URLs. The per-page ingest limiter applies to both sources.
- **The og/meta fallback applies only when a page's body text is under 200 characters**, so existing business crawls and their tests are unaffected.
- **An empty crawl makes no model call:** no documents means the ingestion succeeds with zero facts.
- **No client component imports the `@curios/core` barrel** — it pulls in `node:crypto`. Values reach the browser as plain props from a server component; `import type` is fine.
- **Migrations:** `prisma migrate dev --create-only`, read the SQL, append any hand-written SQL, then `migrate deploy` against both databases. **Never accept a reset prompt** — it drops the development database.
- **Tests:** the workspace suite is `pnpm turbo run test --concurrency=1` — **never omit `--concurrency=1`**. A container restart wipes the tmpfs test database; restore it with `prisma migrate deploy` against `DATABASE_URL_TEST` **and** `packages/db/prisma/sql/readonly-role.sql`.
- **vitest does not typecheck.** Run `npx tsc --noEmit` in every package you touch — and in every package that imports a type you changed. Read exit codes directly (`; echo "EXIT: $?"`), never through `| tail` or `| head`. To force a workspace gate, call turbo directly (`pnpm turbo run typecheck --concurrency=1 --force`); `pnpm typecheck -- --force` sends the flag to `tsc`, which fails every package with `TS5093`.
- **Every test is proven by a mutation that makes it fail.** A test asserting an absence — "does not render", "is not called" — passes before the code exists, so it needs a mutation more than any other.
- **Out of this plan:** bio-code verification, going from business back to personal, writing facts by hand, real social ingestion, and learning the owner's voice (the next slice).

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/core/src/indexing.ts` | `shouldIndex` — the one statement of the indexing rule. |
| `packages/core/src/types.ts` | `SourceDocument.url` nullable; `IngestJobData.sourceUrl` optional. |
| `packages/db/prisma/schema.prisma` | `Page.allowSearchIndexing`; `Ingestion.sourceUrl` nullable, `Ingestion.pastedText`. |
| `packages/gateway/src/anthropic.gateway.ts` | A document with no URL is written without a `url` attribute. |
| `apps/workers/src/sources/text.adapter.ts` | Pasted text into one `SourceDocument`. |
| `apps/workers/src/sources/website.adapter.ts` | The meta-tag fallback for thin pages. |
| `apps/workers/src/ingestion/extract.service.ts` | Picks the source from the job; no model call on an empty crawl. |
| `apps/api/src/modules/pages/page.service.ts` | `claimHandle` takes `mode`; `upgradeToBusiness`; `setSearchIndexing`. |
| `apps/api/src/modules/pages/page.routes.ts` | `POST /pages` with `mode`; `POST /pages/upgrade`; `PATCH /pages/search-indexing`. |
| `apps/api/src/modules/ingest/ingest.service.ts` | Starts an ingestion from a URL or from pasted text. |
| `apps/api/src/modules/ingest/ingest.routes.ts` | The either-or body; the nullable `sourceUrl` in the status response. |
| `packages/db-read/src/page.query.ts`, `owner-page.query.ts` | `allowSearchIndexing` on `PublicPage` and `OwnerPage`. |
| `apps/web/app/app/onboarding/*` | The tier choice, the paste box, the nothing-found path. |
| `apps/web/app/[handle]/page.tsx` | Robots from `shouldIndex`. |
| `apps/web/app/app/settings/search-indexing.tsx` | The Settings switch. Client. |
| `apps/web/app/app/billing/upgrade-button.tsx` | The two-step upgrade. Client. |
| `apps/web/app/app/leads/page.tsx`, `questions/*` | Honest copy for a personal page. |
| `devDocs/*` | The corrections the spec lists, and the new walkthrough. |

---
### Task 1: The indexing rule, in one place

**Files:**
- Create: `packages/core/src/indexing.ts`
- Create: `packages/core/src/indexing.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `shouldIndex(input: { mode: 'PERSONAL' | 'BUSINESS'; allowSearchIndexing: boolean }): boolean`, exported from `@curios/core`. Task 8's public page calls it.

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/indexing.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { shouldIndex } from './indexing.js';

describe('shouldIndex', () => {
  it('indexes a business page', () => {
    expect(shouldIndex({ mode: 'BUSINESS', allowSearchIndexing: false })).toBe(true);
  });

  it('indexes a business page whatever its personal-page setting says', () => {
    // The column means "if this page is personal, index it". A business page
    // that once set it, or never did, is indexed the same.
    expect(shouldIndex({ mode: 'BUSINESS', allowSearchIndexing: true })).toBe(true);
  });

  it('keeps a personal page out of search results by default', () => {
    // README's Personal privacy decision: most people do not want an AI page
    // about themselves ranking for their own name.
    expect(shouldIndex({ mode: 'PERSONAL', allowSearchIndexing: false })).toBe(false);
  });

  it('indexes a personal page whose owner opted in', () => {
    expect(shouldIndex({ mode: 'PERSONAL', allowSearchIndexing: true })).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd packages/core && npx vitest run src/indexing.test.ts`
Expected: the file fails to load — `./indexing.js` does not exist.

- [ ] **Step 3: Implement**

Create `packages/core/src/indexing.ts`:

```ts
/**
 * Whether search engines may index a page.
 *
 * Every business page, and a personal page only when its owner has opted in.
 * The personal default is private because most people do not want an AI page
 * about themselves ranking for their own name -- README's Personal privacy
 * decision -- and a default has to be the safe one.
 *
 * One function, called by the public page's metadata, so the rule is written
 * once. Two expressions of one rule are how a page and a test end up
 * disagreeing about it, which is `canCapture`'s reason for existing too.
 */
export function shouldIndex(input: {
  mode: 'PERSONAL' | 'BUSINESS';
  allowSearchIndexing: boolean;
}): boolean {
  return input.mode === 'BUSINESS' || input.allowSearchIndexing;
}
```

In `packages/core/src/index.ts`, directly after the line

```ts
export type { BillingPlan } from './billing.js';
```

add:

```ts
export { shouldIndex } from './indexing.js';
```

- [ ] **Step 4: Run it and watch it pass**

Run: `cd packages/core && npx vitest run src/indexing.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Prove the tests can fail**

Make each change, run the file, confirm the named test fails, then restore:

1. Return `input.mode === 'BUSINESS'` alone — `'indexes a personal page whose owner opted in'` fails.
2. Return `input.allowSearchIndexing` alone — `'indexes a business page'` fails.

- [ ] **Step 6: Package gates**

```bash
cd packages/core
npx vitest run; echo "TEST EXIT: $?"
npx tsc --noEmit; echo "TSC EXIT: $?"
npx eslint src/indexing.ts src/indexing.test.ts src/index.ts; echo "LINT EXIT: $?"
```

Expected: all three exit 0.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/indexing.ts packages/core/src/indexing.test.ts packages/core/src/index.ts
git commit -m "feat(core): one rule for whether search engines may index a page"
```

---

### Task 2: The opt-in column, and an ingestion with one of two sources

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<timestamp>_personal_tier/migration.sql` (generated, then one hand-written statement appended)
- Modify: `packages/db/src/schema.test.ts`
- Modify: `apps/api/src/modules/ingest/ingest.routes.ts` (one line)

**Interfaces:**
- Consumes: nothing.
- Produces: `Page.allowSearchIndexing: Boolean @default(false)`; `Ingestion.sourceUrl: String?`; `Ingestion.pastedText: String?`; the constraint `Ingestion_one_source`. `GET /ingest/:id` answers `sourceUrl` as nullable.

- [ ] **Step 1: Write the failing tests**

In `packages/db/src/schema.test.ts`, find the test `'keeps both stamps once they are written'`. Directly after it, inside the same `describe`, add:

```ts
  it('keeps a new page out of search results until its owner says otherwise', async () => {
    const pageId = await aPageForPayments();

    const page = await prisma.page.findUniqueOrThrow({
      where: { id: pageId },
      select: { allowSearchIndexing: true },
    });

    expect(page.allowSearchIndexing).toBe(false);
  });

  it('accepts an ingestion from pasted text alone', async () => {
    const pageId = await aPageForPayments();

    const ingestion = await prisma.ingestion.create({
      data: { pageId, pastedText: 'I bake cakes in Shah Alam.' },
      select: { sourceUrl: true, pastedText: true },
    });

    expect(ingestion).toEqual({ sourceUrl: null, pastedText: 'I bake cakes in Shah Alam.' });
  });

  it('refuses an ingestion with both a website address and pasted text', async () => {
    // Raw SQL, because Prisma's own types would let this through and only the
    // database constraint can refuse it. 23514 is Postgres's check violation.
    const pageId = await aPageForPayments();

    await expect(
      prisma.$executeRaw`INSERT INTO "Ingestion" ("id", "pageId", "sourceUrl", "pastedText", "updatedAt")
        VALUES (${`ing-${randomUUID()}`}, ${pageId}, 'https://nadia.example/', 'About me', now())`,
    ).rejects.toThrow(/23514/);
  });

  it('refuses an ingestion with neither', async () => {
    const pageId = await aPageForPayments();

    await expect(
      prisma.$executeRaw`INSERT INTO "Ingestion" ("id", "pageId", "updatedAt")
        VALUES (${`ing-${randomUUID()}`}, ${pageId}, now())`,
    ).rejects.toThrow(/23514/);
  });
```

`aPageForPayments`, `randomUUID` and `prisma` are already defined in this file.

- [ ] **Step 2: Run them and watch them fail**

Run: `cd packages/db && npx vitest run src/schema.test.ts`
Expected: all four new tests fail — Prisma has no `allowSearchIndexing` or `pastedText`, the raw inserts either name an unknown column or succeed without a constraint to refuse them — and every existing test still passes.

If every test in the file fails with `relation "Account" does not exist`, the tmpfs test database was wiped by a container restart. Restore it from the repo root before reading anything into the result:

```bash
DATABASE_URL="$(grep '^DATABASE_URL_TEST=' .env | cut -d= -f2-)" pnpm --filter @curios/db exec prisma migrate deploy
docker exec -i curios-postgres-test psql -U curios -d curios_test < packages/db/prisma/sql/readonly-role.sql
```

- [ ] **Step 3: Change the schema**

In `packages/db/prisma/schema.prisma`, in `model Page`, directly after the line

```prisma
  renewalReminderFor DateTime?
```

add:

```prisma
  /// Whether a personal page may appear in search results. Off by default:
  /// most people do not want an AI page about themselves ranking for their own
  /// name. Business pages are always indexed, so this is read only for personal
  /// pages -- see shouldIndex in @curios/core.
  allowSearchIndexing Boolean @default(false)
```

In `model Ingestion`, replace the line `sourceUrl String` (its padding may differ) with:

```prisma
  /// The page crawled. Null when the owner pasted text instead.
  sourceUrl      String?
  /// What the owner pasted. Null when a URL was crawled. Not called
  /// sourceText: Fact.sourceText already exists and means the excerpt one fact
  /// came from, which is a different thing.
  pastedText     String?
```

- [ ] **Step 4: Generate the migration, read it, and add the constraint**

```bash
cd packages/db && DATABASE_URL="$(grep '^DATABASE_URL=' ../../.env | cut -d= -f2-)" npx prisma migrate dev --create-only --name personal_tier
```

`--create-only` is not optional: a plain `migrate dev` applies immediately and, on detecting drift, offers to **reset** — which drops the development database. Never accept a reset prompt; if one appears, stop and report BLOCKED with its text.

Read the generated `migration.sql`. It must contain only: adding `"allowSearchIndexing" BOOLEAN NOT NULL DEFAULT false` to `"Page"`, adding `"pastedText" TEXT` to `"Ingestion"`, and `ALTER COLUMN "sourceUrl" DROP NOT NULL` on `"Ingestion"`. If it contains `DROP TABLE`, `DROP COLUMN`, `TRUNCATE`, or changes to any other table, report BLOCKED with the SQL quoted.

Then append this to the end of that `migration.sql`, by hand:

```sql
-- Exactly one source per ingestion. Prisma cannot express a CHECK, so it is
-- written here. The API refuses both and neither before writing; this is what
-- holds if anything ever writes around the API. Every existing row has a
-- sourceUrl and no pastedText, so it satisfies the constraint as it is added.
ALTER TABLE "Ingestion" ADD CONSTRAINT "Ingestion_one_source"
  CHECK (("sourceUrl" IS NULL) <> ("pastedText" IS NULL));
```

- [ ] **Step 5: Apply to both databases**

```bash
cd packages/db
DATABASE_URL="$(grep '^DATABASE_URL=' ../../.env | cut -d= -f2-)" npx prisma migrate deploy
DATABASE_URL="$(grep '^DATABASE_URL_TEST=' ../../.env | cut -d= -f2-)" npx prisma migrate deploy
npx prisma generate
```

If `prisma generate` fails with an `EPERM` rename on Windows, a running development process is holding the query engine. Report BLOCKED rather than killing anything — those processes belong to the owner of the machine.

Then confirm the constraint exists in both databases:

```bash
docker exec curios-postgres-test psql -U curios -d curios_test -tAc "SELECT conname FROM pg_constraint WHERE conname = 'Ingestion_one_source';"
docker exec curios-postgres psql -U curios -d curios -tAc "SELECT conname FROM pg_constraint WHERE conname = 'Ingestion_one_source';"
```

Expected: `Ingestion_one_source` from both.

- [ ] **Step 6: Keep the status response honest**

`GET /ingest/:id` returns the row's `sourceUrl`, which can now be null. In `apps/api/src/modules/ingest/ingest.routes.ts`, in the `200` response schema, change

```ts
            sourceUrl: z.string(),
```

to

```ts
            // Null for an ingestion from pasted text.
            sourceUrl: z.string().nullable(),
```

- [ ] **Step 7: Run the tests and watch them pass**

Run: `cd packages/db && npx vitest run src/schema.test.ts`
Expected: every test passes, the four new ones included.

If a refusal test fails because the error does not contain `23514`, report the actual message rather than loosening the assertion.

- [ ] **Step 8: Prove the tests can fail**

On the test database only, with raw SQL — no migration churn:

1. Drop the constraint, run the file, confirm both refusal tests fail, then put it back:

```bash
docker exec curios-postgres-test psql -U curios -d curios_test -c 'ALTER TABLE "Ingestion" DROP CONSTRAINT "Ingestion_one_source";'
cd packages/db && npx vitest run src/schema.test.ts; echo "MUTATED EXIT: $?"
docker exec curios-postgres-test psql -U curios -d curios_test -c 'ALTER TABLE "Ingestion" ADD CONSTRAINT "Ingestion_one_source" CHECK (("sourceUrl" IS NULL) <> ("pastedText" IS NULL));'
```

2. Give the column the wrong default, run the file, confirm `'keeps a new page out of search results'` fails, then restore it:

```bash
docker exec curios-postgres-test psql -U curios -d curios_test -c 'ALTER TABLE "Page" ALTER COLUMN "allowSearchIndexing" SET DEFAULT true;'
cd packages/db && npx vitest run src/schema.test.ts; echo "MUTATED EXIT: $?"
docker exec curios-postgres-test psql -U curios -d curios_test -c 'ALTER TABLE "Page" ALTER COLUMN "allowSearchIndexing" SET DEFAULT false;'
```

Run the file once more and confirm everything passes.

- [ ] **Step 9: Gates — this package, and the two that read Ingestion**

```bash
cd packages/db
npx vitest run; echo "DB TEST EXIT: $?"
npx tsc --noEmit; echo "DB TSC EXIT: $?"
npx eslint src/schema.test.ts; echo "DB LINT EXIT: $?"
cd ../../apps/api
npx tsc --noEmit; echo "API TSC EXIT: $?"
npx vitest run src/modules/ingest; echo "API INGEST TEST EXIT: $?"
cd ../workers
npx tsc --noEmit; echo "WORKERS TSC EXIT: $?"
```

Expected: all exit 0. `Ingestion.sourceUrl` becoming nullable changes a Prisma type both apps read; their `tsc` is what shows nothing else depended on it being a string.

- [ ] **Step 10: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations packages/db/src/schema.test.ts apps/api/src/modules/ingest/ingest.routes.ts
git commit -m "feat(db): a personal page's search opt-in, and an ingestion from a URL or from text"
```

---
### Task 3: Claiming a tier, upgrading, and opting into search

**Files:**
- Modify: `apps/api/src/modules/pages/page.service.ts`
- Modify: `apps/api/src/modules/pages/page.routes.ts`
- Modify: `apps/api/src/modules/pages/page.routes.test.ts`

**Interfaces:**
- Consumes: `Page.allowSearchIndexing` (Task 2); the existing `NoPageError`; the owner scope in `app.ts` that already registers `pageRoutes` behind `requireSession`.
- Produces:
  - `POST /pages` accepts `mode?: 'PERSONAL' | 'BUSINESS'`, defaulting to `BUSINESS`.
  - `POST /pages/upgrade` → `200 { status: 'business' }`, or `404 NO_PAGE`.
  - `PATCH /pages/search-indexing` with `{ allow: boolean }` → `200 { allowSearchIndexing: boolean }`, or `404 NO_PAGE`.
  - `upgradeToBusiness(prisma: PrismaClient, accountId: string): Promise<void>` and `setSearchIndexing(prisma: PrismaClient, accountId: string, allow: boolean): Promise<void>`.

Task 7's claim form sends `mode`; Task 9's billing screen calls the upgrade; Task 8's Settings switch calls the search-indexing route.

- [ ] **Step 1: Write the failing tests**

In `apps/api/src/modules/pages/page.routes.test.ts`, directly after the existing `claim` helper, add:

```ts
const claimAs = (cookie: string, handle: string, mode: 'PERSONAL' | 'BUSINESS') =>
  app.inject({
    method: 'POST',
    url: '/pages',
    remoteAddress: from(),
    cookies: { [SESSION_COOKIE]: cookie },
    payload: { handle, displayName: 'Nadia', mode },
  });

const call = (cookie: string | undefined, method: 'POST' | 'PATCH', url: string, payload?: object) =>
  app.inject({
    method,
    url,
    remoteAddress: from(),
    cookies: cookie ? { [SESSION_COOKIE]: cookie } : {},
    ...(payload ? { payload } : {}),
  });

const modeOf = async (handle: string) =>
  (await app.prisma.page.findUniqueOrThrow({ where: { handle }, select: { mode: true } })).mode;
```

Inside `describe('POST /pages')`, add:

```ts
  it('claims a personal page when the owner asks for one', async () => {
    const handle = `h${randomUUID().slice(0, 8)}`;

    const res = await claimAs(await anOwner(), handle, 'PERSONAL');

    expect(res.statusCode).toBe(201);
    expect(await modeOf(handle)).toBe('PERSONAL');
  });

  it('claims a business page when no tier is sent', async () => {
    // The column's own default. Existing callers send no mode, and must keep
    // getting what they got before this slice.
    const handle = `h${randomUUID().slice(0, 8)}`;

    const res = await claim(await anOwner(), handle);

    expect(res.statusCode).toBe(201);
    expect(await modeOf(handle)).toBe('BUSINESS');
  });
```

At the end of the file, add:

```ts
describe('POST /pages/upgrade', () => {
  it('refuses an unauthenticated caller', async () => {
    expect((await call(undefined, 'POST', '/pages/upgrade')).statusCode).toBe(401);
  });

  it('makes a personal page a business page', async () => {
    const cookie = await anOwner();
    const handle = `h${randomUUID().slice(0, 8)}`;
    await claimAs(cookie, handle, 'PERSONAL');

    const res = await call(cookie, 'POST', '/pages/upgrade');

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'business' });
    expect(await modeOf(handle)).toBe('BUSINESS');
  });

  it('succeeds without change on a page that is already business', async () => {
    // A second click, or a stale screen, must not produce an error: there is
    // nothing to refuse.
    const cookie = await anOwner();
    const handle = `h${randomUUID().slice(0, 8)}`;
    await claimAs(cookie, handle, 'BUSINESS');

    const res = await call(cookie, 'POST', '/pages/upgrade');

    expect(res.statusCode).toBe(200);
    expect(await modeOf(handle)).toBe('BUSINESS');
  });

  it('answers NO_PAGE for an owner with no page yet', async () => {
    const res = await call(await anOwner(), 'POST', '/pages/upgrade');

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: { code: 'NO_PAGE' } });
  });
});

describe('PATCH /pages/search-indexing', () => {
  const allowed = async (handle: string) =>
    (
      await app.prisma.page.findUniqueOrThrow({
        where: { handle },
        select: { allowSearchIndexing: true },
      })
    ).allowSearchIndexing;

  it('refuses an unauthenticated caller', async () => {
    const res = await call(undefined, 'PATCH', '/pages/search-indexing', { allow: true });

    expect(res.statusCode).toBe(401);
  });

  it('turns search indexing on, and off again', async () => {
    const cookie = await anOwner();
    const handle = `h${randomUUID().slice(0, 8)}`;
    await claimAs(cookie, handle, 'PERSONAL');

    const on = await call(cookie, 'PATCH', '/pages/search-indexing', { allow: true });
    expect(on.json()).toEqual({ allowSearchIndexing: true });
    expect(await allowed(handle)).toBe(true);

    await call(cookie, 'PATCH', '/pages/search-indexing', { allow: false });
    expect(await allowed(handle)).toBe(false);
  });

  it('answers NO_PAGE for an owner with no page yet', async () => {
    const res = await call(await anOwner(), 'PATCH', '/pages/search-indexing', { allow: true });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: { code: 'NO_PAGE' } });
  });
});
```

`anOwner`, `claim`, `from`, `randomUUID` and `SESSION_COOKIE` are already in this file.

- [ ] **Step 2: Run them and watch them fail**

Run: `cd apps/api && npx vitest run src/modules/pages/page.routes.test.ts`
Expected: `'claims a personal page when the owner asks for one'` fails (the body's `mode` is ignored, or refused as an unknown key), both new describes fail (the routes do not exist, so each answers 404 without a `NO_PAGE` body), and `'claims a business page when no tier is sent'` passes already — it guards that the default does not move. If anything else happens, report exactly what.

- [ ] **Step 3: The service**

In `apps/api/src/modules/pages/page.service.ts`, change `claimHandle`'s `input` type from

```ts
  input: { handle: string; displayName: string },
```

to

```ts
  input: { handle: string; displayName: string; mode?: 'PERSONAL' | 'BUSINESS' },
```

and in its `prisma.page.create` `data`, after `displayName: input.displayName.trim(),`, add:

```ts
        // The column's own default, spelled out so the claim reads without the
        // schema open. The onboarding form always sends a choice.
        mode: input.mode ?? 'BUSINESS',
```

At the end of the file, add:

```ts
/**
 * Makes the owner's personal page a business page. One-way: nothing leads
 * back, because going from business to personal would need rules for paid
 * time, captured leads and indexed FAQ pages that nothing needs yet.
 *
 * A page that is already business succeeds without change -- a second click or
 * a stale screen is not an error. Zero rows changed means one of two things,
 * so a read tells them apart; the read cannot race anything, because the only
 * write it could miss is this same idempotent one.
 *
 * What the page gains needs no further write: a personal page never captures,
 * so `leadsCaptured` is still 0 and the full trial is there; `trialResetAt` is
 * still null, so the reset is too; and FAQ pages and indexing follow from the
 * mode itself.
 */
export async function upgradeToBusiness(prisma: PrismaClient, accountId: string): Promise<void> {
  const upgraded = await prisma.page.updateMany({
    where: { accountId, mode: 'PERSONAL' },
    data: { mode: 'BUSINESS' },
  });
  if (upgraded.count === 1) return;

  const page = await prisma.page.findUnique({ where: { accountId }, select: { id: true } });
  if (!page) throw new NoPageError();
}

/**
 * Whether the owner's page may appear in search results, if it is personal.
 * Accepted for any page: a business page is indexed regardless (`shouldIndex`
 * in @curios/core), so setting this there changes nothing anyone sees.
 */
export async function setSearchIndexing(
  prisma: PrismaClient,
  accountId: string,
  allow: boolean,
): Promise<void> {
  const updated = await prisma.page.updateMany({
    where: { accountId },
    data: { allowSearchIndexing: allow },
  });
  if (updated.count !== 1) throw new NoPageError();
}
```

- [ ] **Step 4: The routes**

In `apps/api/src/modules/pages/page.routes.ts`, change the import from `./page.service.js` to:

```ts
import { claimHandle, publishPage, setSearchIndexing, upgradeToBusiness } from './page.service.js';
```

In the `POST /pages` body schema, after `displayName: z.string().min(1).max(80),`, add:

```ts
          // Optional so existing callers keep working; absent means BUSINESS,
          // the column's own default.
          mode: z.enum(['PERSONAL', 'BUSINESS']).optional(),
```

After the `app.post('/publish', ...)` call, add:

```ts
  app.post('/pages/upgrade', async (request, reply) => {
    if (!request.account) throw new UnauthenticatedError();

    await upgradeToBusiness(app.prisma, request.account.id);
    return reply.send({ status: 'business' });
  });

  app.patch(
    '/pages/search-indexing',
    { schema: { body: z.object({ allow: z.boolean() }) } },
    async (request, reply) => {
      if (!request.account) throw new UnauthenticatedError();

      await setSearchIndexing(app.prisma, request.account.id, request.body.allow);
      return reply.send({ allowSearchIndexing: request.body.allow });
    },
  );
```

- [ ] **Step 5: Run them and watch them pass**

Run: `cd apps/api && npx vitest run src/modules/pages/page.routes.test.ts`
Expected: every test passes, the nine new ones included.

- [ ] **Step 6: Prove the tests can fail**

Make each change, run the file, confirm the named test fails, then restore:

1. In `claimHandle`, write `mode: 'BUSINESS'` whatever was sent — `'claims a personal page when the owner asks for one'` fails.
2. In `upgradeToBusiness`, change the `where` to `mode: 'BUSINESS'` — `'makes a personal page a business page'` fails.
3. In `upgradeToBusiness`, return without the read when nothing changed — the upgrade's `'answers NO_PAGE for an owner with no page yet'` fails.
4. In `setSearchIndexing`, write `allowSearchIndexing: true` whatever was sent — `'turns search indexing on, and off again'` fails.

- [ ] **Step 7: The whole API suite and gates**

```bash
cd apps/api
npx vitest run; echo "TEST EXIT: $?"
npx tsc --noEmit; echo "TSC EXIT: $?"
npx eslint src/modules/pages; echo "LINT EXIT: $?"
```

Expected: all three exit 0, with every existing test still passing.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/pages
git commit -m "feat(api): claim a personal page, upgrade it once, and opt it into search"
```

---
### Task 4: The worker reads pasted text, and an empty crawl costs nothing

**Files:**
- Modify: `packages/core/src/types.ts`
- Modify: `packages/gateway/src/anthropic.gateway.ts`
- Modify: `packages/gateway/src/anthropic.gateway.test.ts`
- Modify: `apps/workers/src/sources/types.ts`
- Create: `apps/workers/src/sources/text.adapter.ts`
- Create: `apps/workers/src/sources/text.adapter.test.ts`
- Modify: `apps/workers/src/ingestion/extract.service.ts`
- Modify: `apps/workers/src/ingestion/extract.service.test.ts`

**Interfaces:**
- Consumes: `Ingestion.pastedText` (Task 2).
- Produces:
  - `SourceDocument.url: string | null`, and `IngestJobData.sourceUrl?: string`, in `@curios/core`.
  - `textAdapter: SourceAdapter` (`id: 'text'`) in `apps/workers/src/sources/text.adapter.ts`.
  - `runExtraction` reads the job's source: a URL goes to the website adapter; no URL means the row's `pastedText` goes to the text adapter. No documents means no model call.

Task 6's API enqueues a job with no `sourceUrl` for pasted text; this task is what makes the worker handle it. It lands first so every package still typechecks at every commit.

- [ ] **Step 1: Write the failing tests**

In `packages/gateway/src/anthropic.gateway.test.ts`, inside `describe('buildSourceBlock')`, add:

```ts
  it('writes a document with no URL without a url attribute', () => {
    // Text the owner pasted has no page. An empty url="" would read as a page
    // at the empty address.
    const block = buildSourceBlock([
      { url: null, title: 'Written by the page owner', text: 'I bake cakes in Shah Alam.' },
    ]);

    expect(block).toBe('<source title="Written by the page owner">\nI bake cakes in Shah Alam.\n</source>');
  });
```

Create `apps/workers/src/sources/text.adapter.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { textAdapter } from './text.adapter.js';

describe('textAdapter', () => {
  it('turns pasted text into one document with no URL', async () => {
    expect(await textAdapter.fetch('I bake cakes\n\n   in Shah Alam.')).toEqual([
      { url: null, title: 'Written by the page owner', text: 'I bake cakes in Shah Alam.' },
    ]);
  });

  it('returns nothing for text that is only whitespace', async () => {
    expect(await textAdapter.fetch('  \n\t ')).toEqual([]);
  });
});
```

In `apps/workers/src/ingestion/extract.service.test.ts`, inside `describe('runExtraction')`, add:

```ts
  it('reads pasted text from the row when the job has no website address', async () => {
    const pasted = await prisma.ingestion.create({
      data: { pageId, pastedText: 'Kek butter 1kg RM95.\n\nBuka Isnin hingga Sabtu.' },
    });
    const gateway = gatewayReturning(RAW);
    // There is no address to crawl, so the website adapter must not be asked.
    const website = { id: 'website' as const, fetch: vi.fn(adapter.fetch) };

    await runExtraction(
      { prisma, gateway, adapter: website },
      { ingestionId: pasted.id, pageId, idempotencyKey: pasted.id },
    );

    expect(website.fetch).not.toHaveBeenCalled();
    expect(gateway.extract).toHaveBeenCalledWith({
      documents: [
        { url: null, title: 'Written by the page owner', text: 'Kek butter 1kg RM95. Buka Isnin hingga Sabtu.' },
      ],
    });
    const facts = await prisma.fact.findMany({ where: { pageId }, select: { sourceUrl: true } });
    expect(facts.length).toBeGreaterThan(0);
    expect(facts.every((fact) => fact.sourceUrl === null)).toBe(true);
  });

  it('makes no model call when there is nothing to read', async () => {
    // A blocked profile or a dead link comes back as no documents at all.
    // Sending an empty source to the model costs tokens and can only come
    // back empty.
    const gateway = gatewayReturning(RAW);
    const empty = { id: 'website' as const, fetch: async () => [] };

    const result = await runExtraction({ prisma, gateway, adapter: empty }, job());

    expect(result).toEqual({ extractedCount: 0 });
    expect(gateway.extract).not.toHaveBeenCalled();
    expect(await prisma.modelCall.count()).toBe(0);
    expect(
      await prisma.ingestion.findUniqueOrThrow({
        where: { id: ingestionId },
        select: { status: true, extractedCount: true },
      }),
    ).toEqual({ status: 'SUCCEEDED', extractedCount: 0 });
  });
```

`prisma`, `pageId`, `ingestionId`, `adapter`, `gatewayReturning`, `RAW`, `job` and `vi` are already defined in that file.

- [ ] **Step 2: Run them and watch them fail**

```bash
cd packages/gateway && npx vitest run src/anthropic.gateway.test.ts; echo "GATEWAY EXIT: $?"
cd ../../apps/workers && npx vitest run src/sources/text.adapter.test.ts src/ingestion/extract.service.test.ts; echo "WORKERS EXIT: $?"
```

Expected: the gateway test fails (it writes `url="null"` or throws on a null); `text.adapter.test.ts` fails to load; both new extraction tests fail — the first because the website adapter is asked about an undefined address, the second because the model is called with an empty source. If anything else happens, report exactly what.

- [ ] **Step 3: The types**

In `packages/core/src/types.ts`, change `SourceDocument` to:

```ts
export interface SourceDocument {
  /** The page it came from. Null for text the owner pasted, which has no page. */
  url: string | null;
  title: string;
  text: string;
}
```

and in `IngestJobData`, change the `sourceUrl` line to:

```ts
  /**
   * The page to crawl. Absent when the owner pasted text instead: the worker
   * reads that from the Ingestion row, so the text lives in one place and the
   * job stays small.
   */
  sourceUrl?: string;
```

In `apps/workers/src/sources/types.ts`, change the `id` union to:

```ts
  id: 'website' | 'instagram' | 'text';
```

- [ ] **Step 4: The gateway**

In `packages/gateway/src/anthropic.gateway.ts`, change the body of `buildSourceBlock` to:

```ts
  return documents
    .map((d) => {
      // A document with no URL -- text the owner pasted -- carries no url
      // attribute at all, rather than an empty one that reads as a page at "".
      const url = d.url === null ? '' : ` url="${escapeForPrompt(d.url)}"`;
      return `<source${url} title="${escapeForPrompt(d.title)}">\n${escapeForPrompt(d.text)}\n</source>`;
    })
    .join('\n\n');
```

A document with a URL is written exactly as before, so every existing gateway test still holds.

- [ ] **Step 5: The text adapter**

Create `apps/workers/src/sources/text.adapter.ts`:

```ts
import type { SourceDocument } from '@curios/core';
import type { SourceAdapter } from './types.js';

/**
 * Text the owner pasted, as one document with no URL.
 *
 * Whitespace is collapsed the way the website adapter collapses a page's body,
 * so extraction sees pasted text and crawled text in the same shape. The title
 * tells the model where the words came from, since there is no page to name.
 * Nothing about trust changes: it is the owner's own text about their own page,
 * and every fact extracted from it goes through Review before it appears.
 */
export const textAdapter: SourceAdapter = {
  id: 'text',
  async fetch(input: string): Promise<SourceDocument[]> {
    const text = input.replace(/\s+/g, ' ').trim();
    return text === '' ? [] : [{ url: null, title: 'Written by the page owner', text }];
  },
};
```

- [ ] **Step 6: The extraction**

In `apps/workers/src/ingestion/extract.service.ts`, add to the imports:

```ts
import { textAdapter } from '../sources/text.adapter.js';
```

Replace the line

```ts
    const documents: SourceDocument[] = await adapter.fetch(job.sourceUrl);
```

with:

```ts
    // A URL is crawled; no URL means the owner pasted text, which the row holds.
    const documents: SourceDocument[] = job.sourceUrl
      ? await adapter.fetch(job.sourceUrl)
      : await textAdapter.fetch(await pastedTextOf(prisma, job.ingestionId));

    // Nothing to read: a blocked profile, a dead link, an empty paste. Marked
    // succeeded with zero facts and no model call -- an empty source costs
    // tokens and can only come back empty. The onboarding screen offers the
    // paste box when this happens.
    if (documents.length === 0) {
      await prisma.ingestion.update({
        where: { id: job.ingestionId },
        data: { status: 'SUCCEEDED', extractedCount: 0 },
      });
      return { extractedCount: 0 };
    }
```

In the fact rows, change `sourceUrl: job.sourceUrl,` to:

```ts
        // Taken from the job, not the document: a fact from pasted text has no
        // page, and Review hides the Source link when there is none.
        sourceUrl: job.sourceUrl ?? null,
```

At the end of the file, add:

```ts
/**
 * The text an owner pasted for this ingestion. The Ingestion_one_source
 * constraint means a job with no URL always has some; the throw guards the
 * type, and would mean the constraint had been removed.
 */
async function pastedTextOf(prisma: PrismaClient, ingestionId: string): Promise<string> {
  const row = await prisma.ingestion.findUniqueOrThrow({
    where: { id: ingestionId },
    select: { pastedText: true },
  });
  if (row.pastedText === null) {
    throw new Error('This ingestion has neither a website address nor pasted text.');
  }
  return row.pastedText;
}
```

`PrismaClient` is already imported in this file as a type from `@curios/db`.

- [ ] **Step 7: Run them and watch them pass**

```bash
cd packages/gateway && npx vitest run; echo "GATEWAY EXIT: $?"
cd ../../apps/workers && npx vitest run src/sources src/ingestion; echo "WORKERS EXIT: $?"
```

Expected: both exit 0, every existing test in those folders still passing.

- [ ] **Step 8: Prove the tests can fail**

Make each change, run the affected file, confirm the named test fails, then restore:

1. In `runExtraction`, always call `adapter.fetch(job.sourceUrl ?? '')` — `'reads pasted text from the row when the job has no website address'` fails.
2. Remove the `documents.length === 0` early return — `'makes no model call when there is nothing to read'` fails.
3. In `buildSourceBlock`, always write `url="${escapeForPrompt(d.url ?? '')}"` — `'writes a document with no URL without a url attribute'` fails.
4. In `textAdapter`, return the document even when the text is empty — `'returns nothing for text that is only whitespace'` fails.

- [ ] **Step 9: Gates — every package that reads the two changed types**

```bash
cd packages/core && npx tsc --noEmit; echo "CORE TSC EXIT: $?"
cd ../gateway && npx tsc --noEmit; echo "GATEWAY TSC EXIT: $?"; npx eslint src; echo "GATEWAY LINT EXIT: $?"
cd ../../apps/workers && npx vitest run; echo "WORKERS TEST EXIT: $?"; npx tsc --noEmit; echo "WORKERS TSC EXIT: $?"; npx eslint src/sources src/ingestion; echo "WORKERS LINT EXIT: $?"
cd ../api && npx tsc --noEmit; echo "API TSC EXIT: $?"
```

Expected: all exit 0. The API still sets `sourceUrl` on every job it enqueues; its `tsc` confirms the now-optional field broke nothing there.

- [ ] **Step 10: Commit**

```bash
git add packages/core/src/types.ts packages/gateway/src apps/workers/src/sources apps/workers/src/ingestion
git commit -m "feat(workers): read pasted text as a source, and stop paying for an empty crawl"
```

---
### Task 5: The crawler reads meta tags when a page is a JavaScript shell

**Files:**
- Modify: `apps/workers/src/sources/website.adapter.ts`
- Modify: `apps/workers/src/sources/website.adapter.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `extractText` appends `og:title`, `og:description` and `<meta name="description">` to the text of a page whose body is under 200 characters, each once. Pages with real content are unchanged.

A social profile renders in JavaScript, so its body reaches a crawler nearly empty — but the tags it serves for link previews often still name the person and carry their bio. When a platform refuses the bot outright, none of this helps; that case ends at zero facts and the paste box (Task 7).

- [ ] **Step 1: Write the failing tests**

In `apps/workers/src/sources/website.adapter.test.ts`, after the existing `describe('extractText')` block, add:

```ts
const SHELL = `<html><head>
  <title>Nadia (@nadiabakes)</title>
  <meta property="og:title" content="Nadia (@nadiabakes)">
  <meta property="og:description" content="Home baker in Shah Alam. Kek butter from RM95, order by DM.">
  <meta name="description" content="Home baker in Shah Alam. Kek butter from RM95, order by DM.">
</head><body><div id="root"></div></body></html>`;

describe('extractText, on a page that renders in JavaScript', () => {
  it('reads the meta tags when the body has almost nothing', () => {
    const { text } = extractText(SHELL);

    expect(text).toContain('Nadia (@nadiabakes)');
    expect(text).toContain('Kek butter from RM95');
  });

  it('does not repeat a description that og and meta share', () => {
    const { text } = extractText(SHELL);

    expect(text.split('Kek butter from RM95').length - 1).toBe(1);
  });

  it('ignores meta tags on a page with real content', () => {
    // Well over 200 characters of body. The fallback is for shells; a real page
    // already says what it says, and its description is usually marketing.
    const prose = 'Kek butter 1kg RM95, tempahan 3 hari awal. '.repeat(8);
    const html = `<html><head><meta property="og:description" content="A tagline that must not appear"></head><body><p>${prose}</p></body></html>`;

    expect(extractText(html).text).not.toContain('must not appear');
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd apps/workers && npx vitest run src/sources/website.adapter.test.ts`
Expected: the first two fail — the meta tags are not read at all — and `'ignores meta tags on a page with real content'` passes already: it guards that the fallback never reaches a real page. Every existing test still passes.

- [ ] **Step 3: Implement**

In `apps/workers/src/sources/website.adapter.ts`, after the `MAX_TOTAL_BYTES` constant, add:

```ts
/** Below this, a page's body is too thin to extract from -- usually a JavaScript shell. */
const THIN_BODY_CHARS = 200;
```

Replace `extractText` with:

```ts
export function extractText(html: string): { title: string; text: string; links: string[] } {
  const $ = cheerio.load(html);
  $('script, style, noscript, svg').remove();

  const title = $('title').first().text().trim();
  const body = $('body').text().replace(/\s+/g, ' ').trim();
  const links = $('a[href]')
    .map((_, el) => $(el).attr('href') ?? '')
    .get()
    .filter(Boolean);

  return { title, text: body.length < THIN_BODY_CHARS ? withMetaTags($, body) : body, links };
}

/**
 * A thin body with the tags a crawler is shown for link previews appended:
 * og:title, og:description and the meta description. Platforms that render in
 * JavaScript often still serve these, and they are sometimes the only words
 * about the owner that reach a bot. Each distinct value appears once.
 */
function withMetaTags($: cheerio.CheerioAPI, body: string): string {
  const meta = [
    $('meta[property="og:title"]').attr('content'),
    $('meta[property="og:description"]').attr('content'),
    $('meta[name="description"]').attr('content'),
  ]
    .map((value) => (value ?? '').replace(/\s+/g, ' ').trim())
    .filter((value, index, all) => value !== '' && all.indexOf(value) === index);

  return [body, ...meta].filter((part) => part !== '').join(' ');
}
```

The existing fixtures have bodies under 200 characters but no meta tags, so the fallback adds nothing to them and their assertions hold.

- [ ] **Step 4: Run them and watch them pass**

Run: `cd apps/workers && npx vitest run src/sources/website.adapter.test.ts`
Expected: every test passes.

- [ ] **Step 5: Prove the tests can fail**

Make each change, run the file, confirm the named test fails, then restore:

1. Return `body` without the fallback — `'reads the meta tags when the body has almost nothing'` fails.
2. Drop the `all.indexOf(value) === index` condition — `'does not repeat a description that og and meta share'` fails.
3. Set `THIN_BODY_CHARS` to `Number.POSITIVE_INFINITY` — `'ignores meta tags on a page with real content'` fails.

- [ ] **Step 6: Gates**

```bash
cd apps/workers
npx vitest run; echo "TEST EXIT: $?"
npx tsc --noEmit; echo "TSC EXIT: $?"
npx eslint src/sources; echo "LINT EXIT: $?"
```

- [ ] **Step 7: Commit**

```bash
git add apps/workers/src/sources/website.adapter.ts apps/workers/src/sources/website.adapter.test.ts
git commit -m "feat(workers): read a page's meta tags when its body is a JavaScript shell"
```

---

### Task 6: The API accepts pasted text

**Files:**
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `apps/api/src/modules/ingest/ingest.service.ts`
- Modify: `apps/api/src/modules/ingest/ingest.routes.ts`
- Modify: `apps/api/src/modules/ingest/ingest.service.test.ts`
- Modify: `apps/api/src/modules/ingest/ingest.authz.test.ts`

**Interfaces:**
- Consumes: `Ingestion.pastedText` (Task 2); `IngestJobData.sourceUrl` optional (Task 4).
- Produces:
  - `POST /ingest` accepts `{ pageId, sourceUrl }` or `{ pageId, pastedText }` — exactly one — and answers `202 { ingestionId }`.
  - `PASTED_TEXT_MAX = 20_000`, exported from `@curios/core` beside the other ingest contracts, so the API enforces it and Task 7's onboarding page can show the same number. The web app cannot import the API.
  - A pasted-text job is enqueued as `{ ingestionId, pageId, idempotencyKey }`, with no `sourceUrl` key.

Task 7's ingest form sends `pastedText`.

- [ ] **Step 1: Write the failing tests**

In `apps/api/src/modules/ingest/ingest.service.test.ts`, inside `describe('startIngestion')`, add:

```ts
  it('starts an ingestion from pasted text, with no website address anywhere', async () => {
    const add = vi.fn<QueueLike['add']>(async () => ({ id: 'job-1' }));

    const { ingestionId } = await startIngestion(
      { prisma, queue: { add }, guard: async () => {} },
      accountId,
      { pageId, pastedText: 'I bake cakes in Shah Alam.' },
    );

    const row = await prisma.ingestion.findUniqueOrThrow({
      where: { id: ingestionId },
      select: { status: true, sourceUrl: true, pastedText: true },
    });
    expect(row).toEqual({ status: 'QUEUED', sourceUrl: null, pastedText: 'I bake cakes in Shah Alam.' });
    // No sourceUrl key at all: the worker reads the text from the row.
    expect(add.mock.calls[0]?.[1]).toEqual({ ingestionId, pageId, idempotencyKey: ingestionId });
  });

  it('never asks the host guard about pasted text', async () => {
    // There is no host to guard. A guard consulted anyway would make the paste
    // box fail whenever DNS does.
    const guard = vi.fn(async () => {});

    await startIngestion(
      { prisma, queue: { add: vi.fn<QueueLike['add']>(async () => ({ id: 'job-1' })) }, guard },
      accountId,
      { pageId, pastedText: 'About me.' },
    );

    expect(guard).not.toHaveBeenCalled();
  });

  it('refuses pasted text for a page that is not yours, and writes nothing', async () => {
    await expect(
      startIngestion(
        { prisma, queue: { add: vi.fn<QueueLike['add']>(async () => ({ id: 'job-1' })) }, guard: async () => {} },
        'someone-else',
        { pageId, pastedText: 'Not my page.' },
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    expect(await prisma.ingestion.count({ where: { pageId } })).toBe(0);
  });
```

In `apps/api/src/modules/ingest/ingest.authz.test.ts`, at the end of the file, add:

```ts
describe('POST /ingest with pasted text', () => {
  const ingest = (cookie: string, payload: object) =>
    app.inject({
      method: 'POST',
      url: '/ingest',
      remoteAddress: from(),
      cookies: { [SESSION_COOKIE]: cookie },
      payload,
    });

  it('accepts pasted text, and reports its status with no website address', async () => {
    const mine = await anOwnerWithAPage();

    const started = await ingest(mine.cookie, { pageId: mine.pageId, pastedText: 'I bake cakes in Shah Alam.' });
    expect(started.statusCode).toBe(202);

    const status = await app.inject({
      method: 'GET',
      url: `/ingest/${started.json().ingestionId}`,
      remoteAddress: from(),
      cookies: { [SESSION_COOKIE]: mine.cookie },
    });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({ status: 'QUEUED', sourceUrl: null });
  });

  it('refuses a body with both a website address and pasted text, and writes nothing', async () => {
    const mine = await anOwnerWithAPage();

    const res = await ingest(mine.cookie, {
      pageId: mine.pageId,
      sourceUrl: 'https://example.com/',
      pastedText: 'Both at once.',
    });

    expect(res.statusCode).toBe(400);
    expect(await app.prisma.ingestion.count({ where: { pageId: mine.pageId } })).toBe(0);
  });

  it('refuses a body with neither', async () => {
    const mine = await anOwnerWithAPage();

    expect((await ingest(mine.cookie, { pageId: mine.pageId })).statusCode).toBe(400);
  });

  it('refuses pasted text over the cap', async () => {
    const mine = await anOwnerWithAPage();

    const res = await ingest(mine.cookie, { pageId: mine.pageId, pastedText: 'x'.repeat(20_001) });

    expect(res.statusCode).toBe(400);
  });
});
```

`anOwnerWithAPage`, `from` and `SESSION_COOKIE` are already defined in that file.

- [ ] **Step 2: Run them and watch them fail**

Run: `cd apps/api && npx vitest run src/modules/ingest`
Expected: the three service tests fail (the service ignores `pastedText` and refuses the missing URL), `'accepts pasted text'` fails (400), `'refuses pasted text over the cap'` fails only if the body is otherwise accepted — record what you see — and `'refuses a body with both'` and `'refuses a body with neither'` may already pass, because today's schema requires `sourceUrl` and ignores `pastedText`. Those two guard the new schema; say which passed early.

- [ ] **Step 3: The service**

In `packages/core/src/types.ts`, directly after the `IngestJobData` interface, add:

```ts
/**
 * The most an owner may paste as an ingestion source. Here rather than in the
 * API because the onboarding screen counts against it too, and the two apps
 * never import each other. The API's schema enforces it; the screen only warns.
 */
export const PASTED_TEXT_MAX = 20_000;
```

In `packages/core/src/index.ts`, add `PASTED_TEXT_MAX` to the export list from `./types.js`, after `MAIL_QUEUE`, keeping it alphabetical.

In `apps/api/src/modules/ingest/ingest.service.ts`, replace the whole of `startIngestion` — its `/** 202 and enqueue ... */` comment through its closing brace — with:

```ts
/** 202 and enqueue. Nothing generative runs inside an HTTP request. */
export async function startIngestion(
  deps: IngestDeps,
  accountId: string,
  input: { pageId: string; sourceUrl?: string; pastedText?: string },
): Promise<{ ingestionId: string }> {
  if (input.pastedText !== undefined) {
    return startFromPastedText(deps, accountId, input.pageId, input.pastedText);
  }
  // The route refuses a body with neither. This guards a direct caller.
  if (input.sourceUrl === undefined) throw new InvalidSourceUrlError();

  // Shape only. Whether the address is one we may reach -- literal or resolved
  // -- is the guard's question below, because that is where the escape hatch
  // is honoured.
  const verdict = inspectSourceUrl(input.sourceUrl);
  if (!verdict.ok) throw new InvalidSourceUrlError();
  const url = verdict.url;

  // Ownership is checked here, before any row exists. Facts land unverified,
  // so an ingestion into someone else's page plants claims in a stranger's
  // review queue waiting to be accepted.
  await assertOwnsPage(deps.prisma, accountId, input.pageId);

  // After the ownership check, deliberately. Resolving first would let a
  // stranger use this endpoint as a resolver for pages they do not own, which
  // is a smaller leak than the one this function is here to close but a leak
  // opened by this function all the same.
  try {
    await deps.guard(verdict.hostname);
  } catch (error) {
    if (error instanceof BlockedAddressError) throw new BlockedSourceUrlError();
    throw error;
  }

  const ingestion = await deps.prisma.ingestion.create({
    data: { pageId: input.pageId, sourceUrl: url.href },
    select: { id: true },
  });

  await enqueue(deps.queue, { ingestionId: ingestion.id, pageId: input.pageId, sourceUrl: url.href });
  return { ingestionId: ingestion.id };
}

/**
 * The same path, for text the owner pasted. Ownership first, for the reason the
 * URL path gives. No host guard, because there is no host: a guard consulted
 * anyway would make the paste box fail whenever DNS does.
 */
async function startFromPastedText(
  deps: IngestDeps,
  accountId: string,
  pageId: string,
  pastedText: string,
): Promise<{ ingestionId: string }> {
  await assertOwnsPage(deps.prisma, accountId, pageId);

  const ingestion = await deps.prisma.ingestion.create({
    data: { pageId, pastedText },
    select: { id: true },
  });

  // No sourceUrl on the job: the worker reads the text from the row, so it
  // lives in one place and the job stays small.
  await enqueue(deps.queue, { ingestionId: ingestion.id, pageId });
  return { ingestionId: ingestion.id };
}

async function assertOwnsPage(prisma: PrismaClient, accountId: string, pageId: string): Promise<void> {
  const page = await prisma.page.findFirst({
    where: { id: pageId, accountId },
    select: { id: true },
  });
  if (!page) throw new PageNotYoursError();
}

async function enqueue(
  queue: QueueLike,
  job: { ingestionId: string; pageId: string; sourceUrl?: string },
): Promise<void> {
  await queue.add(
    INGEST_QUEUE,
    // The ingestion id is stable per request, so a replayed job is a repeat of
    // the same work rather than new work.
    { ...job, idempotencyKey: job.ingestionId },
    { jobId: job.ingestionId, attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
  );
}
```

- [ ] **Step 4: The route**

In `apps/api/src/modules/ingest/ingest.routes.ts`, add to the imports:

```ts
import { PASTED_TEXT_MAX } from '@curios/core';
```

and replace the `POST /ingest` body schema line with:

```ts
        body: z
          .object({
            pageId: z.string().min(1).max(64),
            sourceUrl: z.string().min(1).max(2048).optional(),
            pastedText: z.string().trim().min(1).max(PASTED_TEXT_MAX).optional(),
          })
          // Exactly one source, refused here before anything is written. The
          // Ingestion_one_source constraint holds if anything writes around this.
          .refine((body) => (body.sourceUrl === undefined) !== (body.pastedText === undefined), {
            message: 'Send a website address or pasted text, one or the other.',
          }),
```

keeping the existing comment about `pageId` above it.

- [ ] **Step 5: Run them and watch them pass**

Run: `cd apps/api && npx vitest run src/modules/ingest`
Expected: every test passes, the seven new ones included.

- [ ] **Step 6: Prove the tests can fail**

Make each change, run the affected file, confirm the named test fails, then restore:

1. In `startFromPastedText`, call `await deps.guard('')` before creating the row — `'never asks the host guard about pasted text'` fails.
2. Remove the `.refine(...)` — `'refuses a body with both a website address and pasted text'` fails with a 202.
3. Remove `assertOwnsPage` from `startFromPastedText` — `'refuses pasted text for a page that is not yours'` fails.
4. Change `.max(PASTED_TEXT_MAX)` to `.max(PASTED_TEXT_MAX + 1)` — `'refuses pasted text over the cap'` fails.

- [ ] **Step 7: The whole API suite and gates**

```bash
cd packages/core && npx tsc --noEmit; echo "CORE TSC EXIT: $?"
cd ../../apps/api
npx vitest run; echo "TEST EXIT: $?"
npx tsc --noEmit; echo "TSC EXIT: $?"
npx eslint src/modules/ingest; echo "LINT EXIT: $?"
```

Expected: all three exit 0, every existing ingest test still passing unchanged.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/types.ts packages/core/src/index.ts apps/api/src/modules/ingest
git commit -m "feat(api): start an ingestion from pasted text, never both, never neither"
```

---
### Task 7: Onboarding — the tier, the paste box, and a way out of "nothing found"

**Files:**
- Modify: `apps/web/app/app/onboarding/claim-form.tsx`
- Modify: `apps/web/app/app/onboarding/claim-form.test.tsx`
- Modify: `apps/web/app/app/onboarding/ingest-form.tsx`
- Create: `apps/web/app/app/onboarding/ingest-form.test.tsx`
- Modify: `apps/web/app/app/onboarding/job-status.tsx`
- Modify: `apps/web/app/app/onboarding/job-status.test.tsx`
- Modify: `apps/web/app/app/onboarding/page.tsx`

**Interfaces:**
- Consumes: `POST /pages` with `mode` (Task 3); `POST /ingest` with `pastedText`, and `PASTED_TEXT_MAX` from `@curios/core` (Task 6); a zero-fact ingestion that succeeded (Task 4); `ringgit` from `apps/web/app/app/billing/billing-copy.ts` and `PLAN_PRICES_CENTS` from `@curios/core`.
- Produces:
  - `ClaimForm({ monthlyPrice, onClaim })`, where `onClaim` receives `{ handle, displayName, mode }`; `Claim({ monthlyPrice })`.
  - `IngestForm({ pageId, mode, pastedTextMax, onIngest, fetchStatus })`; `Ingest({ pageId, mode, pastedTextMax })`.
  - `JobStatus` gains `onNothingFound?: () => void`.

Neither onboarding component may import the `@curios/core` barrel — both are client components. The price and the cap reach them as props from `page.tsx`, a Server Component, which is also what keeps the claim form's "RM39" and the paste box's "20,000" from drifting away from the constants.

- [ ] **Step 1: Update the existing claim-form tests for the new choice**

Every existing test in `apps/web/app/app/onboarding/claim-form.test.tsx` renders `<ClaimForm onClaim={...} />` and submits without a tier. Both now change, and the tests must say so rather than pass by accident:

1. Add `monthlyPrice="RM39"` to every `<ClaimForm ... />` render in the file.
2. In every existing test that clicks **Claim**, choose a tier first — directly before the click:

```tsx
    await userEvent.click(screen.getByRole('radio', { name: /^business/i }));
```

Nothing else in those tests changes.

- [ ] **Step 2: Write the failing tests**

Add to `describe('ClaimForm')` in `claim-form.test.tsx`:

```tsx
  it('offers no tier until the owner picks one', () => {
    // No default, on purpose: nobody should land in a tier they did not pick
    // and find out later.
    render(<ClaimForm monthlyPrice="RM39" onClaim={vi.fn()} />);

    expect(screen.getByRole('radio', { name: /^personal/i })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: /^business/i })).not.toBeChecked();
  });

  it('will not claim until a tier is chosen', async () => {
    const claim = vi.fn(async () => ({}));
    render(<ClaimForm monthlyPrice="RM39" onClaim={claim} />);

    await userEvent.type(screen.getByLabelText('Handle'), 'nadia');
    await userEvent.type(screen.getByLabelText('Display name'), 'Nadia');
    await userEvent.click(screen.getByRole('button', { name: 'Claim' }));

    expect(claim).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Choose whether this page is about you or for selling.',
    );
  });

  it('sends the tier the owner chose', async () => {
    const claim = vi.fn(async () => ({}));
    render(<ClaimForm monthlyPrice="RM39" onClaim={claim} />);

    await userEvent.click(screen.getByRole('radio', { name: /^personal/i }));
    await userEvent.type(screen.getByLabelText('Handle'), 'nadia');
    await userEvent.type(screen.getByLabelText('Display name'), 'Nadia');
    await userEvent.click(screen.getByRole('button', { name: 'Claim' }));

    expect(claim).toHaveBeenCalledWith({ handle: 'nadia', displayName: 'Nadia', mode: 'PERSONAL' });
  });

  it('names the business price it was given', () => {
    render(<ClaimForm monthlyPrice="RM39" onClaim={vi.fn()} />);

    expect(screen.getByRole('radio', { name: /RM39 a month/ })).toBeInTheDocument();
  });
```

Create `apps/web/app/app/onboarding/ingest-form.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { IngestForm } from './ingest-form.js';

const wrap = (ui: React.ReactNode) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
};

/** A status that never arrives, for tests that stop at the form. */
const pending = () => new Promise<never>(() => {});

describe('IngestForm', () => {
  it('sends pasted text when the owner switches to it', async () => {
    const onIngest = vi.fn(async () => ({ ingestionId: 'i-1' }));
    wrap(
      <IngestForm pageId="p1" mode="BUSINESS" pastedTextMax={20_000} onIngest={onIngest} fetchStatus={vi.fn(pending)} />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Paste text instead' }));
    await userEvent.type(screen.getByLabelText('About your business'), 'Kek butter RM95.');
    await userEvent.click(screen.getByRole('button', { name: 'Read what I pasted' }));

    expect(onIngest).toHaveBeenCalledWith({ pageId: 'p1', pastedText: 'Kek butter RM95.' });
  });

  it('tells a personal owner any link will do, or their own words', () => {
    wrap(
      <IngestForm pageId="p1" mode="PERSONAL" pastedTextMax={20_000} onIngest={vi.fn()} fetchStatus={vi.fn(pending)} />,
    );

    expect(screen.getByLabelText('A link about you')).toBeInTheDocument();
    expect(screen.getByText(/Linktree or profile/)).toBeInTheDocument();
  });

  it('refuses pasted text over the cap before sending it', async () => {
    const onIngest = vi.fn(async () => ({ ingestionId: 'i-1' }));
    wrap(
      <IngestForm pageId="p1" mode="BUSINESS" pastedTextMax={10} onIngest={onIngest} fetchStatus={vi.fn(pending)} />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Paste text instead' }));
    await userEvent.type(screen.getByLabelText('About your business'), 'eleven char');
    await userEvent.click(screen.getByRole('button', { name: 'Read what I pasted' }));

    expect(onIngest).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('more than 10 characters');
  });

  it('goes back to the paste box when the link gave us nothing', async () => {
    // Where an Instagram URL usually lands: the crawl succeeded and found
    // nothing. It must not be a dead end.
    const onIngest = vi.fn(async () => ({ ingestionId: 'i-1' }));
    const fetchStatus = vi.fn(async () => ({ status: 'SUCCEEDED' as const, extractedCount: 0, error: null }));
    wrap(
      <IngestForm pageId="p1" mode="PERSONAL" pastedTextMax={20_000} onIngest={onIngest} fetchStatus={fetchStatus} />,
    );

    await userEvent.type(screen.getByLabelText('A link about you'), 'https://instagram.com/nadiabakes');
    await userEvent.click(screen.getByRole('button', { name: 'Read this link' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Paste text instead' }));

    expect(screen.getByLabelText('About you')).toBeInTheDocument();
  });
});
```

In `apps/web/app/app/onboarding/job-status.test.tsx`, add `import userEvent from '@testing-library/user-event';` to the imports, change the first test's assertion from `/reading your website/i` to `/reading what you gave us/i` (and its comment's quoted phrase to match), and add to `describe('JobStatus')`:

```tsx
  it('offers the paste box when the page gave us nothing to use', async () => {
    const onNothingFound = vi.fn();
    wrap(
      <JobStatus
        ingestionId="i-1"
        fetchStatus={vi.fn().mockResolvedValue({ status: 'SUCCEEDED', extractedCount: 0, error: null })}
        onNothingFound={onNothingFound}
      />,
    );

    expect(await screen.findByText(/could not find anything to use/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Paste text instead' }));
    expect(onNothingFound).toHaveBeenCalledOnce();
  });
```

- [ ] **Step 3: Run them and watch them fail**

Run: `cd apps/web && npx vitest run app/app/onboarding`
Expected: the four new claim-form tests fail (there is no tier choice), `ingest-form.test.tsx` fails (no paste mode, no `mode` or `pastedTextMax` props), and the two job-status changes fail (the copy and the zero branch). The existing claim-form tests fail too, until Step 4 — they now click a radio that does not exist yet. If anything else happens, report exactly what.

- [ ] **Step 4: The claim form**

In `apps/web/app/app/onboarding/claim-form.tsx`, replace `ClaimForm`'s signature and state, and its `submit`, so the top of the component reads:

```tsx
export type Tier = 'PERSONAL' | 'BUSINESS';

export function ClaimForm({
  monthlyPrice,
  onClaim,
}: {
  /** The business price as an owner reads it, e.g. "RM39". A prop, because this file may not import the core barrel. */
  monthlyPrice: string;
  onClaim: (input: { handle: string; displayName: string; mode: Tier }) => Promise<unknown>;
}) {
  const [handle, setHandle] = useState('');
  const [displayName, setDisplayName] = useState('');
  // No default, on purpose: nobody should land in a tier they did not pick and
  // find out later.
  const [mode, setMode] = useState<Tier | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (mode === null) {
      setError('Choose whether this page is about you or for selling.');
      return;
    }
    setBusy(true);
    try {
      await onClaim({ handle, displayName, mode });
    } catch (failure) {
```

keeping the existing `catch` body and its comment unchanged. As the first child of the `<form>`, before the `handle` field, add:

```tsx
      <fieldset>
        <legend>What is this page for?</legend>
        <label>
          <input
            type="radio"
            name="mode"
            value="PERSONAL"
            checked={mode === 'PERSONAL'}
            onChange={() => setMode('PERSONAL')}
          />
          Personal — about you. Free. Hidden from search engines unless you choose otherwise.
        </label>
        <label>
          <input
            type="radio"
            name="mode"
            value="BUSINESS"
            checked={mode === 'BUSINESS'}
            onChange={() => setMode('BUSINESS')}
          />
          Business — for selling. Three free leads, then {monthlyPrice} a month.
        </label>
      </fieldset>
```

Change the `Claim` wrapper to take and pass the price:

```tsx
export function Claim({ monthlyPrice }: { monthlyPrice: string }) {
  const router = useRouter();

  return (
    <ClaimForm
      monthlyPrice={monthlyPrice}
      onClaim={async (input) => {
```

keeping the rest of its body unchanged.

- [ ] **Step 5: The status screen**

In `apps/web/app/app/onboarding/job-status.tsx`, add `import { Button } from '@curios/ui';` beside the `Callout` import (one import: `import { Button, Callout } from '@curios/ui';`), add to the props type:

```tsx
  /**
   * Called from the nothing-found state, so the form can reopen with the paste
   * box. Where a social profile the crawler could not read lands.
   */
  onNothingFound?: () => void;
```

and to the destructuring `onNothingFound,`. Change the waiting copy to:

```tsx
    return <Callout tone="info">Reading what you gave us…</Callout>;
```

and directly before the final `return` (the "Found N facts" one), add:

```tsx
  if (data.extractedCount === 0) {
    return (
      <div>
        <Callout tone="action">
          We could not find anything to use there. Some sites, Instagram and TikTok especially, do not
          let us read them.
        </Callout>
        {onNothingFound ? (
          <Button type="button" onClick={onNothingFound}>
            Paste text instead
          </Button>
        ) : null}
      </div>
    );
  }
```

- [ ] **Step 6: The ingest form**

Replace `IngestForm` and `Ingest` in `apps/web/app/app/onboarding/ingest-form.tsx`, and the doc comment above `IngestForm`, with:

```tsx
type Source = { pageId: string; sourceUrl: string } | { pageId: string; pastedText: string };

/**
 * A link, or text pasted straight in -- for anyone whose presence is a social
 * profile the crawler cannot read. FRONTEND.md's one-field rule still holds:
 * one field is shown at a time, and the owner picks which.
 *
 * Once the ingest request is accepted, the form hands the returned
 * `ingestionId` straight to `JobStatus`, which polls it until it resolves. If
 * it finds nothing, the form comes back with the paste box open.
 */
export function IngestForm({
  pageId,
  mode,
  pastedTextMax,
  onIngest,
  fetchStatus,
}: {
  pageId: string;
  mode: 'PERSONAL' | 'BUSINESS';
  /** The API's cap, from `page.tsx`: this file may not import the core barrel. */
  pastedTextMax: number;
  onIngest: (input: Source) => Promise<{ ingestionId: string }>;
  fetchStatus: (ingestionId: string) => Promise<IngestionResult>;
}) {
  const [using, setUsing] = useState<'link' | 'text'>('link');
  const [sourceUrl, setSourceUrl] = useState('');
  const [pastedText, setPastedText] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [ingestionId, setIngestionId] = useState<string | null>(null);
  const personal = mode === 'PERSONAL';
  const count = (n: number) => n.toLocaleString('en-MY');

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    // Checked here so the owner is told before anything is sent; the API's
    // schema is what actually enforces it.
    if (using === 'text' && pastedText.length > pastedTextMax) {
      setError(`That is more than ${count(pastedTextMax)} characters. Paste the part that says the most.`);
      return;
    }
    setBusy(true);
    try {
      const { ingestionId: id } = await onIngest(
        using === 'text' ? { pageId, pastedText } : { pageId, sourceUrl },
      );
      setIngestionId(id);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Something failed. Try again.');
      setBusy(false);
    }
  }

  if (ingestionId) {
    return (
      <JobStatus
        ingestionId={ingestionId}
        fetchStatus={fetchStatus}
        onNothingFound={() => {
          setIngestionId(null);
          setUsing('text');
          setBusy(false);
        }}
      />
    );
  }

  return (
    <form onSubmit={(event) => void submit(event)}>
      {using === 'link' ? (
        <Field
          id="sourceUrl"
          label={personal ? 'A link about you' : 'Your website address'}
          type="url"
          autoComplete="off"
          required
          hint={
            personal
              ? 'Your site, Linktree or profile — or paste a few paragraphs about yourself instead.'
              : undefined
          }
          value={sourceUrl}
          onChange={setSourceUrl}
        />
      ) : (
        <Field
          id="pastedText"
          label={personal ? 'About you' : 'About your business'}
          multiline
          required
          hint={`${count(pastedText.length)} of ${count(pastedTextMax)} characters. A bio, captions, an About section — whatever says it best.`}
          value={pastedText}
          onChange={setPastedText}
        />
      )}

      <Button
        type="button"
        variant="secondary"
        onClick={() => {
          setError('');
          setUsing(using === 'link' ? 'text' : 'link');
        }}
      >
        {using === 'link' ? 'Paste text instead' : 'Use a link instead'}
      </Button>

      {error ? <Callout tone="error">{error}</Callout> : null}

      <Button type="submit" busy={busy}>
        {busy
          ? 'Starting…'
          : using === 'text'
            ? 'Read what I pasted'
            : personal
              ? 'Read this link'
              : 'Read my website'}
      </Button>
    </form>
  );
}

/**
 * Supplies the real `onIngest` and `fetchStatus`. Thin on purpose, same shape
 * as `Claim` in `claim-form.tsx`: a Server Component cannot hand a closure to a
 * Client Component, so `page.tsx` passes only plain values and the closures
 * over `apiFetch` are built here.
 */
export function Ingest({
  pageId,
  mode,
  pastedTextMax,
}: {
  pageId: string;
  mode: 'PERSONAL' | 'BUSINESS';
  pastedTextMax: number;
}) {
  return (
    <IngestForm
      pageId={pageId}
      mode={mode}
      pastedTextMax={pastedTextMax}
      onIngest={(input) => apiFetch('/ingest', { method: 'POST', body: JSON.stringify(input) })}
      fetchStatus={(ingestionId) => apiFetch(`/ingest/${ingestionId}`)}
    />
  );
}
```

- [ ] **Step 7: The onboarding page**

In `apps/web/app/app/onboarding/page.tsx`, change the `@curios/core` import to:

```tsx
import { PASTED_TEXT_MAX, PLAN_PRICES_CENTS, SESSION_COOKIE } from '@curios/core';
```

add:

```tsx
import { ringgit } from '../billing/billing-copy.js';
```

and change the final `return` to:

```tsx
  // Plain values across the boundary. The price and the cap come from the
  // constants here, on the server, because the two client components may not
  // import the core barrel.
  return page ? (
    <Ingest pageId={page.id} mode={page.mode} pastedTextMax={PASTED_TEXT_MAX} />
  ) : (
    <Claim monthlyPrice={ringgit(PLAN_PRICES_CENTS.MONTHLY)} />
  );
```

- [ ] **Step 8: Run them and watch them pass**

Run: `cd apps/web && npx vitest run app/app/onboarding`
Expected: every test passes.

- [ ] **Step 9: Prove the tests can fail**

Make each change, run the folder, confirm the named test fails, then restore:

1. Start `ClaimForm`'s tier at `'BUSINESS'` — `'offers no tier until the owner picks one'` fails.
2. Send `mode: 'BUSINESS'` whatever was chosen — `'sends the tier the owner chose'` fails.
3. Remove the over-cap check from `IngestForm` — `'refuses pasted text over the cap before sending it'` fails.
4. Remove the `extractedCount === 0` branch from `JobStatus` — `'offers the paste box when the page gave us nothing to use'` and `'goes back to the paste box when the link gave us nothing'` fail.
5. Always send `{ pageId, sourceUrl }` — `'sends pasted text when the owner switches to it'` fails.

- [ ] **Step 10: The whole web suite and gates**

```bash
cd apps/web
npx vitest run; echo "TEST EXIT: $?"
npx tsc --noEmit; echo "TSC EXIT: $?"
npx eslint app/app/onboarding; echo "LINT EXIT: $?"
```

Expected: all three exit 0. One existing test, `app/[handle]/budget.test.ts`, reads Next's build manifest from `.next`; if it complains that the manifest lists no files for a route, the build is stale — run `pnpm --filter @curios/web build` once, re-run, and say so in your report.

- [ ] **Step 11: Commit**

```bash
git add apps/web/app/app/onboarding
git commit -m "feat(web): choose a tier when claiming, paste text instead of a link, and never dead-end on nothing found"
```

---
### Task 8: The public page asks `shouldIndex`, and Settings gets the switch

**Files:**
- Modify: `packages/db-read/src/page.query.ts`
- Modify: `packages/db-read/src/page.query.test.ts`
- Modify: `packages/db-read/src/owner-page.query.ts`
- Modify: `packages/db-read/src/owner-page.query.test.ts`
- Modify: `apps/web/app/[handle]/page.tsx`
- Modify: `apps/web/app/[handle]/page.test.tsx`
- Create: `apps/web/app/app/settings/search-indexing.tsx`
- Create: `apps/web/app/app/settings/search-indexing.test.tsx`
- Modify: `apps/web/app/app/settings/page.tsx`
- Modify: `apps/web/app/app/settings/page.test.tsx`
- Modify: `apps/web/app/app/layout.test.tsx`, `apps/web/app/app/review/page.test.tsx`, `apps/web/app/app/billing/page.test.tsx` — one fixture field each

**Interfaces:**
- Consumes: `shouldIndex` (Task 1); `Page.allowSearchIndexing` (Task 2); `PATCH /pages/search-indexing` (Task 3).
- Produces:
  - `PublicPage.allowSearchIndexing: boolean` and `OwnerPage.allowSearchIndexing: boolean` in `@curios/db-read`.
  - `SearchIndexingForm({ mode, allowed, onChange })` and `SearchIndexing({ mode, allowed })` in `apps/web/app/app/settings/search-indexing.tsx`.

- [ ] **Step 1: Write the failing tests**

In `packages/db-read/src/page.query.test.ts`, inside its `describe`, add:

```ts
  it('carries whether a personal page opted into search results', async () => {
    await write.account.create({
      data: {
        email: 'indexed@example.com',
        pages: {
          create: {
            handle: 'indexed',
            skeleton: 'indexed',
            displayName: 'Opted In',
            published: true,
            mode: 'PERSONAL',
            allowSearchIndexing: true,
          },
        },
      },
    });

    expect((await getPublicPage('indexed'))?.allowSearchIndexing).toBe(true);
  });
```

In `packages/db-read/src/owner-page.query.test.ts`, inside its `describe`, add:

```ts
  it('carries the search-indexing choice, for the Settings switch', async () => {
    const accountId = await anAccount({ published: true });
    expect((await getOwnerPage(accountId))?.allowSearchIndexing).toBe(false);

    await write.page.updateMany({ where: { accountId }, data: { allowSearchIndexing: true } });

    expect((await getOwnerPage(accountId))?.allowSearchIndexing).toBe(true);
  });
```

In `apps/web/app/[handle]/page.test.tsx`, find the shared `page` fixture that `getPublicPage` is mocked with, and add `allowSearchIndexing: false,` as its last field. Next to the existing tests that assert `meta.robots`, add:

```tsx
  it('lets a personal page that opted in be indexed', async () => {
    vi.mocked(getPublicPage).mockResolvedValueOnce({ ...page, mode: 'PERSONAL', allowSearchIndexing: true });
    const { generateMetadata } = await import('./page.js');

    const meta = await generateMetadata({ params: Promise.resolve({ handle: 'nadia' }) });

    expect(meta.robots).toBeUndefined();
  });
```

Create `apps/web/app/app/settings/search-indexing.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SearchIndexingForm } from './search-indexing.js';

const SWITCH = { name: 'Show my page in search results' };

describe('SearchIndexingForm', () => {
  it('starts a personal page out of search results', () => {
    render(<SearchIndexingForm mode="PERSONAL" allowed={false} onChange={vi.fn()} />);

    expect(screen.getByRole('checkbox', SWITCH)).not.toBeChecked();
  });

  it('sends the owner’s choice, and shows it straight away', async () => {
    const onChange = vi.fn(async () => undefined);
    render(<SearchIndexingForm mode="PERSONAL" allowed={false} onChange={onChange} />);

    await userEvent.click(screen.getByRole('checkbox', SWITCH));

    expect(onChange).toHaveBeenCalledWith(true);
    expect(screen.getByRole('checkbox', SWITCH)).toBeChecked();
  });

  it('puts the switch back, and says so, when the change could not be saved', async () => {
    const onChange = vi.fn(async () => {
      throw new Error('Something failed on our side. Try again.');
    });
    render(<SearchIndexingForm mode="PERSONAL" allowed={false} onChange={onChange} />);

    await userEvent.click(screen.getByRole('checkbox', SWITCH));

    expect(await screen.findByRole('alert')).toHaveTextContent('Something failed');
    expect(screen.getByRole('checkbox', SWITCH)).not.toBeChecked();
  });

  it('tells a business page it is always in search results, with nothing to switch', () => {
    render(<SearchIndexingForm mode="BUSINESS" allowed={false} onChange={vi.fn()} />);

    expect(screen.getByText('Business pages always appear in search results.')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });
});
```

In `apps/web/app/app/settings/page.test.tsx`:

1. Replace the `@curios/db-read` mock so it also provides `getOwnerPage`:

```tsx
const getSignInMethods = vi.fn();
const getOwnerPage = vi.fn();
vi.mock('@curios/db-read', () => ({ getSignInMethods, getOwnerPage }));
```

2. Mock the new component, beside the existing component mocks:

```tsx
const SearchIndexing = vi.fn((_props: { mode: string; allowed: boolean }) => null);
vi.mock('./search-indexing.js', () => ({ SearchIndexing }));
```

3. In the `beforeEach`, add `getOwnerPage.mockReset(); getOwnerPage.mockResolvedValue(null); SearchIndexing.mockClear();`.

4. Add, following how the file's existing tests render the page:

```tsx
  it('offers a personal page its search switch, set as the page has it', async () => {
    getOwnerPage.mockResolvedValue({
      id: 'p1',
      handle: 'nadia',
      displayName: 'Nadia',
      published: true,
      mode: 'PERSONAL',
      paidUntil: null,
      leadsCaptured: 0,
      trialResetAt: null,
      allowSearchIndexing: false,
    });

    await renderWith({}, methods({}));

    expect(SearchIndexing.mock.calls[0]?.[0]).toEqual({ mode: 'PERSONAL', allowed: false });
  });
```

`renderWith` and `methods` are the file's existing render helper and sign-in fixture.

- [ ] **Step 2: Run them and watch them fail**

```bash
cd packages/db-read && npx vitest run src/page.query.test.ts src/owner-page.query.test.ts; echo "DB-READ EXIT: $?"
cd ../../apps/web && npx vitest run "app/[handle]" app/app/settings; echo "WEB EXIT: $?"
```

Expected: both db-read tests fail (neither query selects the column); the opted-in robots test fails (the page is `noindex` for every personal page); `search-indexing.test.tsx` fails to load; the Settings test fails (the page never renders the switch). If anything else happens, report exactly what.

- [ ] **Step 3: The two queries**

In `packages/db-read/src/page.query.ts`, add to `PublicPage`, after `leadsCaptured`:

```ts
  /** Whether this page, if personal, may appear in search results. See shouldIndex in @curios/core. */
  allowSearchIndexing: boolean;
```

and to the `select`, after `leadsCaptured: true,`:

```ts
      allowSearchIndexing: true,
```

In `packages/db-read/src/owner-page.query.ts`, add to `OwnerPage`, after `trialResetAt`:

```ts
  /** Whether this page, if personal, may appear in search results. Settings' switch. */
  allowSearchIndexing: boolean;
```

and to the `select`, after `trialResetAt: true,`:

```ts
      allowSearchIndexing: true,
```

`OwnerPage` has only required fields, so the three `OwnerPage` fixtures in `apps/web` — `app/app/layout.test.tsx`, `app/app/review/page.test.tsx` and `app/app/billing/page.test.tsx` — each need `allowSearchIndexing: false,` added as their last field. Grep for any others (`grep -rn "OwnerPage = {" apps packages`) and fix every one found.

- [ ] **Step 4: The public page**

In `apps/web/app/[handle]/page.tsx`, add `shouldIndex` to the existing import from `@curios/core`, and in `generateMetadata` replace

```tsx
    ...(page.mode === 'PERSONAL' ? { robots: { index: false, follow: false } } : {}),
```

with

```tsx
    // One rule, in @curios/core: every business page, and a personal page only
    // once its owner has opted in. There is no sitemap, so this tag is the
    // whole of the control.
    ...(shouldIndex(page) ? {} : { robots: { index: false, follow: false } }),
```

- [ ] **Step 5: The switch**

Create `apps/web/app/app/settings/search-indexing.tsx`:

```tsx
'use client';

import { Callout } from '@curios/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiFetch } from '../../../lib/api.js';

/**
 * Whether a personal page may appear in search results.
 *
 * Off by default -- most people do not want an AI page about themselves
 * ranking for their own name -- and it says so beside the switch, because an
 * owner who finds their page missing from Google should not have to guess why.
 * A business page is always indexed, so it gets a sentence instead of a
 * switch that would do nothing.
 *
 * Optimistic: the switch moves when pressed, and moves back if the save fails.
 */
export function SearchIndexingForm({
  mode,
  allowed,
  onChange,
}: {
  mode: 'PERSONAL' | 'BUSINESS';
  allowed: boolean;
  onChange: (allow: boolean) => Promise<unknown>;
}) {
  const [on, setOn] = useState(allowed);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (mode === 'BUSINESS') {
    return (
      <section>
        <h3>Search engines</h3>
        <p>Business pages always appear in search results.</p>
      </section>
    );
  }

  async function change(next: boolean) {
    setError('');
    setOn(next);
    setBusy(true);
    try {
      await onChange(next);
    } catch (failure) {
      setOn(!next);
      setError(failure instanceof Error ? failure.message : 'Something failed. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h3>Search engines</h3>
      <p>
        Your page starts out of search results: most people do not want an AI page about themselves
        ranking for their own name.
      </p>
      <label>
        <input
          type="checkbox"
          checked={on}
          disabled={busy}
          onChange={(event) => void change(event.target.checked)}
        />
        Show my page in search results
      </label>
      {error ? <Callout tone="error">{error}</Callout> : null}
    </section>
  );
}

/** Supplies the real handler. A Server Component may not pass a function here. */
export function SearchIndexing({ mode, allowed }: { mode: 'PERSONAL' | 'BUSINESS'; allowed: boolean }) {
  const router = useRouter();
  return (
    <SearchIndexingForm
      mode={mode}
      allowed={allowed}
      onChange={async (allow) => {
        await apiFetch('/pages/search-indexing', { method: 'PATCH', body: JSON.stringify({ allow }) });
        router.refresh();
      }}
    />
  );
}
```

In `apps/web/app/app/settings/page.tsx`:

1. Add `getOwnerPage` to the `@curios/db-read` import, and `import { SearchIndexing } from './search-indexing.js';`.
2. Replace

```tsx
  const methods = await getSignInMethods(owner.accountId);
```

with

```tsx
  const [methods, page] = await Promise.all([
    getSignInMethods(owner.accountId),
    getOwnerPage(owner.accountId),
  ]);
```

3. After the sign-in callouts — as the last child of the fragment — add:

```tsx
      {/* An account with no page yet has nothing to index. */}
      {page ? <SearchIndexing mode={page.mode} allowed={page.allowSearchIndexing} /> : null}
```

- [ ] **Step 6: Run them and watch them pass**

```bash
cd packages/db-read && npx vitest run; echo "DB-READ EXIT: $?"
cd ../../apps/web && npx vitest run "app/[handle]" app/app/settings app/app/layout.test.tsx app/app/review app/app/billing; echo "WEB EXIT: $?"
```

Expected: both exit 0.

- [ ] **Step 7: Prove the tests can fail**

Make each change, run the affected tests, confirm the named test fails, then restore:

1. In `generateMetadata`, go back to `page.mode === 'PERSONAL'` — `'lets a personal page that opted in be indexed'` fails.
2. In `SearchIndexingForm`, send `!next` — `'sends the owner’s choice, and shows it straight away'` fails.
3. Remove the `setOn(!next)` from the `catch` — `'puts the switch back, and says so, when the change could not be saved'` fails.
4. Remove the `mode === 'BUSINESS'` branch — `'tells a business page it is always in search results'` fails.
5. In `page.query.ts`, remove `allowSearchIndexing: true` from the `select` — `'carries whether a personal page opted into search results'` fails.
6. In the Settings page, render nothing in place of `<SearchIndexing />` — `'offers a personal page its search switch'` fails.

- [ ] **Step 8: Gates**

```bash
cd packages/db-read && npx tsc --noEmit; echo "DB-READ TSC EXIT: $?"; npx eslint .; echo "DB-READ LINT EXIT: $?"
cd ../../apps/web
npx vitest run; echo "WEB TEST EXIT: $?"
npx tsc --noEmit; echo "WEB TSC EXIT: $?"
npx eslint "app/[handle]" app/app/settings; echo "WEB LINT EXIT: $?"
```

Expected: all exit 0. Web `tsc` is what shows every `OwnerPage` and `PublicPage` fixture now carries the field. If `budget.test.ts` complains about a stale `.next` manifest, run `pnpm --filter @curios/web build` once and say so.

- [ ] **Step 9: Commit**

```bash
git add packages/db-read/src apps/web/app
git commit -m "feat(web): a personal page can opt into search, and the public page asks one rule"
```

---
### Task 9: Leads, Billing and Questions tell a personal page the truth

**Files:**
- Modify: `apps/web/app/app/leads/page.tsx`
- Create: `apps/web/app/app/leads/page.test.tsx`
- Create: `apps/web/app/app/billing/upgrade-button.tsx`
- Create: `apps/web/app/app/billing/upgrade-button.test.tsx`
- Modify: `apps/web/app/app/billing/page.tsx`
- Modify: `apps/web/app/app/billing/page.test.tsx`
- Modify: `apps/web/app/app/questions/question-list.tsx`
- Modify: `apps/web/app/app/questions/question-list.test.tsx`
- Modify: `apps/web/app/app/questions/page.tsx`

**Interfaces:**
- Consumes: `POST /pages/upgrade` (Task 3); `OwnerPage` with `mode` and `allowSearchIndexing` (Task 8); plan 1's `ringgit` and `PLAN_PRICES_CENTS`.
- Produces:
  - `UpgradeForm({ onUpgrade, refresh })` and `UpgradeToBusiness()` in `apps/web/app/app/billing/upgrade-button.tsx`.
  - `QuestionList` and `Questions` take a required `publishesFaq: boolean`.

The nav keeps all five screens. Each says something true about a personal page instead of an empty list or a promise that does not apply.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/app/app/leads/page.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { OwnerPage } from '@curios/db-read';

const getLeads = vi.fn();
const getOwnerPage = vi.fn();
vi.mock('@curios/db-read', () => ({ getLeads, getOwnerPage }));

const resolveOwner = vi.fn();
vi.mock('../session.js', () => ({ resolveOwner }));

vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve({ get: () => ({ value: 'a-session-value' }) }),
}));

const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});
vi.mock('next/navigation', () => ({ redirect }));

// The list closes over apiFetch and the router. These tests are about what the
// page decides to show, so the list records that it was rendered instead.
const Leads = vi.fn((_props: { leads: unknown[] }) => null);
vi.mock('./lead-list.js', () => ({ Leads }));

const LeadsPage = (await import('./page.js')).default;

const personal: OwnerPage = {
  id: 'p1',
  handle: 'nadia',
  displayName: 'Nadia',
  published: true,
  mode: 'PERSONAL',
  paidUntil: null,
  leadsCaptured: 0,
  trialResetAt: null,
  allowSearchIndexing: false,
};

describe('LeadsPage', () => {
  beforeEach(() => {
    getLeads.mockReset();
    getOwnerPage.mockReset();
    resolveOwner.mockReset();
    Leads.mockClear();
    resolveOwner.mockResolvedValue({ accountId: 'acc1' });
    getLeads.mockResolvedValue([]);
  });

  it('tells a personal page why it has no leads, and where that changes', async () => {
    getOwnerPage.mockResolvedValue(personal);

    render(await LeadsPage());

    expect(screen.getByText(/Personal pages don't collect phone numbers/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Billing' })).toHaveAttribute('href', '/app/billing');
    // An empty list under that sentence would read as "leads will land here".
    expect(Leads).not.toHaveBeenCalled();
  });

  it('shows a business page its leads', async () => {
    getOwnerPage.mockResolvedValue({ ...personal, mode: 'BUSINESS' });

    render(await LeadsPage());

    expect(Leads).toHaveBeenCalledTimes(1);
  });
});
```

Create `apps/web/app/app/billing/upgrade-button.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UpgradeForm } from './upgrade-button.js';

describe('UpgradeForm', () => {
  it('asks before switching, and says it cannot be undone', async () => {
    const onUpgrade = vi.fn(async () => undefined);
    render(<UpgradeForm onUpgrade={onUpgrade} refresh={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: 'Make this a business page' }));

    // One click must not do it: it is one-way, and it ends the privacy default.
    expect(onUpgrade).not.toHaveBeenCalled();
    expect(screen.getByText(/appear in search results/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /can't be undone/ })).toBeInTheDocument();
  });

  it('switches, then re-reads the screen', async () => {
    const onUpgrade = vi.fn(async () => undefined);
    const refresh = vi.fn();
    render(<UpgradeForm onUpgrade={onUpgrade} refresh={refresh} />);

    await userEvent.click(screen.getByRole('button', { name: 'Make this a business page' }));
    await userEvent.click(screen.getByRole('button', { name: /can't be undone/ }));

    expect(onUpgrade).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('lets the owner back out', async () => {
    const onUpgrade = vi.fn(async () => undefined);
    render(<UpgradeForm onUpgrade={onUpgrade} refresh={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: 'Make this a business page' }));
    await userEvent.click(screen.getByRole('button', { name: 'Keep it personal' }));

    expect(onUpgrade).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Make this a business page' })).toBeInTheDocument();
  });
});
```

In `apps/web/app/app/billing/page.test.tsx`, beside the existing component mocks, add:

```tsx
const UpgradeToBusiness = vi.fn(() => null);
vi.mock('./upgrade-button.js', () => ({ UpgradeToBusiness }));
```

add `UpgradeToBusiness.mockClear();` to the `beforeEach`, and add to `describe('BillingPage')`:

```tsx
  it('offers a personal page the upgrade, and says what changes', async () => {
    await renderWith({ ...page, mode: 'PERSONAL' });

    expect(UpgradeToBusiness).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('heading', { name: 'Selling something?' })).toBeInTheDocument();
    expect(screen.getByText(/appears in search results/)).toBeInTheDocument();
  });

  it('does not offer the upgrade to a business page', async () => {
    await renderWith(page);

    expect(UpgradeToBusiness).not.toHaveBeenCalled();
  });
```

In `apps/web/app/app/questions/question-list.test.tsx`, add `publishesFaq` to every existing `<QuestionList ... />` render — `publishesFaq={true}` — and add to `describe('QuestionList')`:

```tsx
  it('tells a business owner their answer may be published at /faq', async () => {
    render(
      <QuestionList questions={questions} publishesFaq={true} onAnswer={vi.fn()} onSuppress={vi.fn()} onDelete={vi.fn()} />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Answer this' }));

    expect(screen.getByText(/publishes the question and your answer at \/faq/)).toBeInTheDocument();
  });

  it('tells a personal owner their answer is not published anywhere', async () => {
    // Personal pages never get FAQ pages. Promising one would be the only false
    // sentence on this screen.
    render(
      <QuestionList questions={questions} publishesFaq={false} onAnswer={vi.fn()} onSuppress={vi.fn()} onDelete={vi.fn()} />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Answer this' }));

    expect(
      screen.getByText('Saving this lets your page answer the question the way you wrote it.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/publishes the question/)).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd apps/web && npx vitest run app/app/leads app/app/billing app/app/questions`
Expected: the personal leads test fails (the list is rendered and there is no explanation); `upgrade-button.test.tsx` fails to load; the personal billing test fails; the personal Questions test fails. `'shows a business page its leads'`, `'does not offer the upgrade to a business page'` and `'tells a business owner their answer may be published at /faq'` pass already — they guard the business screens against this change. If anything else happens, report exactly what.

- [ ] **Step 3: Leads**

In `apps/web/app/app/leads/page.tsx`, add `Callout` to the `@curios/ui` import (`import { Callout, Shell } from '@curios/ui';`) and replace

```tsx
      <Leads leads={leads} />
```

with

```tsx
      {page?.mode === 'PERSONAL' ? (
        // A personal page never offers the capture card, so there will never
        // be a list here. Say why, and where that changes.
        <Callout tone="info">
          Personal pages don't collect phone numbers. Visitors can still chat with your page. If
          you start selling, you can make this a business page from <a href="/app/billing">Billing</a>.
        </Callout>
      ) : (
        <Leads leads={leads} />
      )}
```

- [ ] **Step 4: The upgrade button**

Create `apps/web/app/app/billing/upgrade-button.tsx`:

```tsx
'use client';

import { Button, Callout } from '@curios/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiFetch } from '../../../lib/api.js';

/**
 * Personal to business, in two steps. One click must not do it: the switch is
 * one-way -- nothing leads back -- and it ends the privacy default, so the
 * owner sees both facts before confirming.
 *
 * Presentational half of the wrapper split, the shape of `ResetTrialForm`.
 */
export function UpgradeForm({
  onUpgrade,
  refresh,
}: {
  onUpgrade: () => Promise<unknown>;
  refresh: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function upgrade() {
    setError('');
    setBusy(true);
    try {
      await onUpgrade();
      // Re-reads the Server Component: the plan summary, the pay buttons and
      // this section all change with the mode.
      refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Something failed. Try again.');
      setBusy(false);
    }
  }

  if (!confirming) {
    return <Button onClick={() => setConfirming(true)}>Make this a business page</Button>;
  }

  return (
    <div>
      <p>Your page will appear in search results, and you cannot switch it back to personal.</p>
      <Button busy={busy} onClick={() => void upgrade()}>
        Yes, switch — this can't be undone
      </Button>
      <Button variant="secondary" disabled={busy} onClick={() => setConfirming(false)}>
        Keep it personal
      </Button>
      {error ? <Callout tone="error">{error}</Callout> : null}
    </div>
  );
}

/** Supplies the real handlers. A Server Component may not pass a function here. */
export function UpgradeToBusiness() {
  const router = useRouter();
  return (
    <UpgradeForm
      onUpgrade={() => apiFetch('/pages/upgrade', { method: 'POST' })}
      refresh={() => router.refresh()}
    />
  );
}
```

- [ ] **Step 5: The billing screen**

In `apps/web/app/app/billing/page.tsx`, add `import { UpgradeToBusiness } from './upgrade-button.js';` and replace

```tsx
      {state.kind === 'personal' ? null : (
        <PayButtons
```

through its closing `)}` with:

```tsx
      {state.kind === 'personal' ? (
        <section>
          <h2>Selling something?</h2>
          <p>
            A business page can take customers' phone numbers: three free leads, then{' '}
            {ringgit(PLAN_PRICES_CENTS.MONTHLY)} a month. Questions asked three or more times get
            their own FAQ pages, and the page appears in search results.
          </p>
          <UpgradeToBusiness />
        </section>
      ) : (
        <PayButtons
          options={[
            { plan: 'MONTHLY', label: `Pay ${ringgit(PLAN_PRICES_CENTS.MONTHLY)} for a month` },
            { plan: 'ANNUAL', label: `Pay ${ringgit(PLAN_PRICES_CENTS.ANNUAL)} for a year` },
          ]}
        />
      )}
```

- [ ] **Step 6: Questions**

In `apps/web/app/app/questions/question-list.tsx`:

1. Add `publishesFaq: boolean;` to `QuestionList`'s props type, after `questions`, with the comment:

```tsx
  /**
   * Whether saving an answer can publish it at /faq. False for a personal
   * page, which never gets FAQ pages -- see qualifiesForFaq in @curios/core.
   */
  publishesFaq: boolean;
```

and `publishesFaq,` to its destructuring.

2. Change the answer field's `hint` to:

```tsx
                hint={
                  publishesFaq
                    ? 'Asked 3 or more times? Saving this also publishes the question and your answer at /faq, where search engines can find them.'
                    : 'Saving this lets your page answer the question the way you wrote it.'
                }
```

3. Change `Questions` to take and pass it:

```tsx
export function Questions({ questions, publishesFaq }: { questions: OwnerQuestion[]; publishesFaq: boolean }) {
```

and add `publishesFaq={publishesFaq}` to the `<QuestionList` it renders.

In `apps/web/app/app/questions/page.tsx`, add `getOwnerPage` to the `@curios/db-read` import, replace

```tsx
  const questions = await getQuestions(owner.accountId);
```

with

```tsx
  const [questions, page] = await Promise.all([
    getQuestions(owner.accountId),
    getOwnerPage(owner.accountId),
  ]);
```

and render `<Questions questions={questions} publishesFaq={page?.mode !== 'PERSONAL'} />`.

- [ ] **Step 7: Run them and watch them pass**

Run: `cd apps/web && npx vitest run app/app/leads app/app/billing app/app/questions`
Expected: every test passes.

- [ ] **Step 8: Prove the tests can fail**

Make each change, run the affected tests, confirm the named test fails, then restore:

1. In the leads page, render `<Leads leads={leads} />` for every page — `'tells a personal page why it has no leads, and where that changes'` fails.
2. In the billing page, render `null` for a personal page instead of the section — `'offers a personal page the upgrade, and says what changes'` fails.
3. In `UpgradeForm`, make the first button call `void upgrade()` directly — `'asks before switching, and says it cannot be undone'` fails.
4. Make "Keep it personal" do nothing — `'lets the owner back out'` fails.
5. In `QuestionList`, always use the /faq hint — `'tells a personal owner their answer is not published anywhere'` fails.

- [ ] **Step 9: The whole web suite and gates**

```bash
cd apps/web
npx vitest run; echo "TEST EXIT: $?"
npx tsc --noEmit; echo "TSC EXIT: $?"
npx eslint app/app/leads app/app/billing app/app/questions; echo "LINT EXIT: $?"
```

Expected: all three exit 0. If `budget.test.ts` complains about a stale `.next` manifest, run `pnpm --filter @curios/web build` once and say so.

- [ ] **Step 10: Commit**

```bash
git add apps/web/app/app/leads apps/web/app/app/billing apps/web/app/app/questions
git commit -m "feat(web): leads, billing and questions tell a personal page the truth"
```

---
### Task 10: The documents, and the walkthrough

**Files:**
- Modify: `devDocs/README.md`
- Modify: `devDocs/BACKEND.md`
- Modify: `devDocs/FRONTEND.md`
- Create: `devDocs/manual-verification-personal-tier.md`

**Interfaces:**
- Consumes: everything Tasks 1–9 built.
- Produces: documents that describe the free tier as built, and a walkthrough whose coverage table exists from the start.

There is no test for prose. Step 5 stands in for one: every name the documents cite must resolve with a grep.

- [ ] **Step 1: README**

In `devDocs/README.md`:

1. Directly after the build-order list (after `8. Free personal tier (a config flag, not a project)`), add a line:

```
All eight are built, the last in slice 10 — see `slice-10-build-spec.md`.
```

2. In the Settled decisions table, add a row directly after the **Plans** row:

```
| Tiers | Chosen when the handle is claimed — personal or business, with neither pre-selected. A personal page can become a business page once, from Billing; there is no way back, because business to personal would need rules for paid time, captured leads and indexed FAQ pages that nothing needs. A personal owner with no website pastes text instead of a link. See slice-10-build-spec.md. |
```

3. Replace the **Personal privacy** row's decision text, `` `noindex` by default on personal pages, opt-in only. ``, with:

```
`noindex` by default on personal pages, opt-in only, from a switch in Settings. `shouldIndex` in `@curios/core` is the one statement of the rule.
```

- [ ] **Step 2: BACKEND**

In `devDocs/BACKEND.md`:

1. In the table under `### What mode actually changes`, replace the **Indexing** row with:

```
| Indexing | **`noindex` unless the owner opts in** (Settings) | always indexed |
```

2. Replace the sentence `It is a toggle in Appearance, off until the owner turns it on.` with:

```
It is a switch in Settings, off until the owner turns it on, and `shouldIndex` in `@curios/core` is the one place the rule is written -- the public page's metadata calls it rather than restating it.

**The tier is chosen at claim, and personal upgrades once.** `POST /pages` takes `mode`, defaulting to business. `POST /pages/upgrade` moves a personal page to business in one conditional update and succeeds without change on a page that is already business; nothing moves it back. The upgraded page needs no other write: a personal page never captures, so `leadsCaptured` is still 0 and the whole trial is there, and FAQ pages and indexing follow from the mode itself.
```

3. Under `## Ingestion pipeline`, replace step 1 — the paragraph beginning `1. **Fetch.**` — with:

```
1. **Fetch.** Either a URL or pasted text, never both: `Ingestion.sourceUrl` and
   `Ingestion.pastedText`, held to exactly one by the `Ingestion_one_source`
   constraint. A site is crawled same-origin, depth 2, cap 25 pages; when a page's
   body is under 200 characters -- a JavaScript shell, as social profiles are -- its
   `og:title`, `og:description` and meta description are read too. Pasted text becomes
   one document with no URL, and its facts carry none. A crawl that returns nothing
   makes no model call. Instagram proper stays behind an adapter that throws
   `NOT_CONFIGURED`: the platform will break any access, so it stays isolated.
```

- [ ] **Step 3: FRONTEND**

In `devDocs/FRONTEND.md`:

1. In the screen list, change the `/app/onboarding` line to:

```
/app/onboarding           choose personal or business, paste a link or text, review facts
```

2. In the paragraph beginning `**Personal pages are \`noindex\` by default.**`, replace `The toggle lives in Appearance, off until they turn it on.` with:

```
The switch lives in Settings, off until they turn it on.
```

Leave the rest of the screen list alone. It is a design list, not an inventory — `/app/knowledge`, `/app/links` and `/app/appearance` are all unbuilt — so removing one line would imply the others exist.

- [ ] **Step 4: The walkthrough**

Create `devDocs/manual-verification-personal-tier.md`:

````markdown
# Manual verification — the free personal tier

**Status: NOT RUN.** Written at the end of slice 10. Running it is recommended, not a gate:
nothing in this slice's correctness depends on a third party. It exists because one thing only a
real request can tell us — what a social profile actually returns to our crawler.

Re-run it after any change to `apps/workers/src/sources`, to onboarding, or to the crawler's user
agent.

## What CI proves, and what still needs a person

Every test named below was checked to exist, by name, before this table was written.

| # | Check | Proven by | Still needs a person |
|---|---|---|---|
| 1 | Claiming a personal page | `page.routes.test.ts` — 'claims a personal page when the owner asks for one'; `claim-form.test.tsx` — 'sends the tier the owner chose' | **Partly** — the form as an owner sees it |
| 2 | A social profile URL | `website.adapter.test.ts` — 'reads the meta tags when the body has almost nothing'; `extract.service.test.ts` — 'makes no model call when there is nothing to read'; `ingest-form.test.tsx` — 'goes back to the paste box when the link gave us nothing' | **Yes** — only a real request shows what Instagram, TikTok and Linktree return to `CuriosBot` today |
| 3 | Pasted text becomes facts | `ingest.service.test.ts` — 'starts an ingestion from pasted text, with no website address anywhere'; `extract.service.test.ts` — 'reads pasted text from the row when the job has no website address' | **Partly** — whether a short bio yields facts worth publishing |
| 4 | Opting into search | `indexing.test.ts` — 'indexes a personal page whose owner opted in'; `page.test.tsx` under `app/[handle]` — 'lets a personal page that opted in be indexed'; `search-indexing.test.tsx` — 'sends the owner’s choice, and shows it straight away' | **Partly** — the robots tag in a real page's source |
| 5 | The upgrade | `page.routes.test.ts` — 'makes a personal page a business page'; `upgrade-button.test.tsx` — 'asks before switching, and says it cannot be undone' | **Partly** |
| 6 | Honest screens for a personal page | `leads/page.test.tsx` — 'tells a personal page why it has no leads, and where that changes'; `billing/page.test.tsx` — 'offers a personal page the upgrade, and says what changes'; `question-list.test.tsx` — 'tells a personal owner their answer is not published anywhere' | **No** |

## Before you start

Everything running — `docker compose up -d`, then the API, the web app and the workers. A fresh
account with no page yet.

## The checks

### 1. Claim a personal page

On `/app/onboarding`, confirm neither tier is selected, and that pressing **Claim** without one
says to choose. Choose **Personal**, claim a handle, and confirm:

```bash
docker exec -i curios-postgres psql -U curios -d curios -c \
  "SELECT handle, mode, \"allowSearchIndexing\" FROM \"Page\" WHERE handle = 'YOURHANDLE';"
```

Expect `PERSONAL` and `f`.

### 2. Give it a social profile

Paste an Instagram profile URL, then a TikTok profile, then a Linktree page. For each, record in
the table below what happened: facts found, zero facts with the paste box offered, or a failure
and its message. For any that found nothing, look at what the crawler actually received:

```bash
curl -sA 'CuriosBot/0.1 (+https://curios.my/bot)' 'THE_URL' | head -c 2000
```

A login wall, a 403, or a page with `og:` tags but no body text are all expected; say which.

### 3. Paste text

Choose **Paste text instead**, paste a short bio, and confirm the facts on `/app/review` came from
it — the quoted line under each fact, and no Source link.

### 4. Search results

In Settings, confirm the switch reads off. View the public page's source and find
`<meta name="robots" content="noindex, nofollow">`. Turn the switch on, reload the source, and
confirm the tag is gone.

### 5. Upgrade

On `/app/billing`, press **Make this a business page**, read the warning, press **Keep it
personal**, and confirm nothing changed. Press it again and confirm. The page is now business:
the plan summary shows the free trial, and the query from check 1 shows `BUSINESS`.

### 6. The other screens

Before upgrading, glance at Leads and Questions: Leads explains why there are no leads, and the
answer box on Questions does not mention `/faq`.

## Recording the result

Add a line per run, newest first. For check 2, record each URL tried and what came back.

| Date | Who | Checks passed | What social URLs returned | Checks failed, and what was seen |
|---|---|---|---|---|
````

- [ ] **Step 5: Check every claim you just wrote**

Documents drift because nobody checks them. Every one of these must print a match:

```bash
grep -rn "export function shouldIndex" packages/core/src/indexing.ts
grep -rn "Ingestion_one_source" packages/db/prisma/migrations
grep -rn "pastedText" packages/db/prisma/schema.prisma
grep -rn "upgradeToBusiness" apps/api/src/modules/pages/page.service.ts
grep -rn "NOT_CONFIGURED" apps/workers/src/sources/instagram.adapter.ts
grep -rn "THIN_BODY_CHARS = 200" apps/workers/src/sources/website.adapter.ts
grep -rn "claims a personal page when the owner asks for one" apps/api/src/modules/pages/page.routes.test.ts
grep -rn "sends the tier the owner chose" apps/web/app/app/onboarding/claim-form.test.tsx
grep -rn "reads the meta tags when the body has almost nothing" apps/workers/src/sources/website.adapter.test.ts
grep -rn "makes no model call when there is nothing to read" apps/workers/src/ingestion/extract.service.test.ts
grep -rn "goes back to the paste box when the link gave us nothing" apps/web/app/app/onboarding/ingest-form.test.tsx
grep -rn "starts an ingestion from pasted text, with no website address anywhere" apps/api/src/modules/ingest/ingest.service.test.ts
grep -rn "reads pasted text from the row when the job has no website address" apps/workers/src/ingestion/extract.service.test.ts
grep -rn "indexes a personal page whose owner opted in" packages/core/src/indexing.test.ts
grep -rn "lets a personal page that opted in be indexed" "apps/web/app/[handle]/page.test.tsx"
grep -rn "sends the owner’s choice, and shows it straight away" apps/web/app/app/settings/search-indexing.test.tsx
grep -rn "makes a personal page a business page" apps/api/src/modules/pages/page.routes.test.ts
grep -rn "asks before switching, and says it cannot be undone" apps/web/app/app/billing/upgrade-button.test.tsx
grep -rn "tells a personal page why it has no leads, and where that changes" apps/web/app/app/leads/page.test.tsx
grep -rn "offers a personal page the upgrade, and says what changes" apps/web/app/app/billing/page.test.tsx
grep -rn "tells a personal owner their answer is not published anywhere" apps/web/app/app/questions/question-list.test.tsx
```

A citation that does not resolve is the defect this step exists to catch — fix the document, not the grep.

- [ ] **Step 6: The workspace gates**

```bash
pnpm turbo run test --concurrency=1 --force > /tmp/s10-test.log 2>&1; echo "TEST EXIT: $?"
grep -E "^\s*(Tasks|Cached|Failed):" /tmp/s10-test.log
pnpm turbo run typecheck --concurrency=1 --force > /tmp/s10-tc.log 2>&1; echo "TYPECHECK EXIT: $?"
grep -E "^\s*(Tasks|Cached|Failed):" /tmp/s10-tc.log
pnpm turbo run lint --concurrency=1 --force > /tmp/s10-lint.log 2>&1; echo "LINT EXIT: $?"
grep -E "^\s*(Tasks|Cached|Failed):" /tmp/s10-lint.log
```

Expected: all three exit 0, with 9 successful of 9 total and 0 cached. Call turbo directly as written: `pnpm typecheck -- --force` passes `--force` to `tsc`, which fails every package with `TS5093`.

- [ ] **Step 7: Commit**

```bash
git add devDocs
git commit -m "docs: the free personal tier, described as built, with its walkthrough"
```

---

## What this plan does not close

- **What real social profiles return to `CuriosBot`.** Check 2 of the walkthrough is the only thing that can tell you, and the answer changes whenever the platforms do.
- **Slice 9's Billplz sandbox payment.** Still unrun, on the branch beneath this one. Nothing here changes that.
- **Learning how the owner writes**, so the page sounds like them — the next slice, with its own spec.
