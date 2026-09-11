# Slice 8 — The capture gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the state "a Business page that has not paid", and stop lead capture on it — after three free leads have proved the product works.

**Architecture:** A pure rule in `packages/core` decides whether a page may capture. Two columns on `Page` hold the state: a `paidUntil` date and a `leadsCaptured` counter. The rule is enforced twice — the public page hides the card, the anonymous endpoint refuses the capture — because hiding UI is not enforcement. No payment, no third party, no secrets.

**Tech Stack:** TypeScript, Prisma 6, Fastify 5, Next 15 (App Router, RSC), vitest, Postgres.

**Spec:** `devDocs/slice-8-build-spec.md` — read it before Task 1.

## Global Constraints

- `FREE_LEADS = 3`, a named constant in `packages/core`. Not an env var — unlike the conversation cap, this is a product promise made on a pricing page, not an operational dial.
- The rule is `BUSINESS && (paidUntil > now || leadsCaptured < FREE_LEADS)`. One implementation, in `packages/core`, never re-expressed as a Prisma `where` clause.
- `now` is a parameter to the rule, never read from the clock inside it. A rule that reads the clock cannot be tested at its boundary.
- **Enforced in two places**: `apps/web/app/[handle]/page.tsx` (hides the card) and `apps/api/src/modules/leads/lead.service.ts` (refuses the capture). Both, or neither counts.
- A refused capture throws the **existing** `NotQualifiedError`. Never a distinguishable billing error — an anonymous visitor must not learn the owner's payment status.
- `leadsCaptured` increments **in the same transaction as the lead insert**, and only when a lead is actually stored.
- **No schema change beyond the two columns.** No `Subscription`, no `Payment`, no plan enum. Those are slice 9.
- **Nothing reads a price.** RM39/RM390 is settled and recorded in README, and no code in this slice touches it.
- Test commands: `pnpm turbo run test --concurrency=1` for the workspace. **Never omit `--concurrency=1`** — the DB-touching packages share one test database and each truncates `"Account" CASCADE`, so in parallel they wipe each other's fixtures.
- A container restart wipes the test database — it is `tmpfs`. Restoring needs `prisma migrate deploy` against `DATABASE_URL_TEST` **and** `packages/db/prisma/sql/readonly-role.sql`, because migrations create tables but not roles.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/core/src/plan.ts` | `FREE_LEADS` and `canCapture`. Pure, no I/O, no clock. |
| `packages/db/prisma/schema.prisma` | `Page.paidUntil`, `Page.leadsCaptured`. |
| `apps/api/src/modules/leads/lead.service.ts` | The refusal, and the counter increment inside the insert's transaction. |
| `packages/db-read/src/page.query.ts` | Carries the two columns to the public page. |
| `apps/web/app/[handle]/page.tsx` | Passes the rule's answer as `canCapture`. |
| `devDocs/manual-verification-plan-gate.md` | The three page states a human should see. |

---

### Task 1: The rule

**Files:**
- Create: `packages/core/src/plan.ts`
- Create: `packages/core/src/plan.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `FREE_LEADS: number` (3)
  - `canCapture(input: { mode: 'PERSONAL' | 'BUSINESS'; paidUntil: Date | null; leadsCaptured: number; now: Date }): boolean`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/plan.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { canCapture, FREE_LEADS } from './plan.js';

const NOW = new Date('2026-09-12T00:00:00Z');
const FUTURE = new Date('2026-10-12T00:00:00Z');
const PAST = new Date('2026-08-12T00:00:00Z');

const paid = { mode: 'BUSINESS' as const, paidUntil: FUTURE, leadsCaptured: 99, now: NOW };

describe('canCapture', () => {
  it('lets a paid business page capture, however many leads it has had', () => {
    expect(canCapture(paid)).toBe(true);
  });

  it('refuses a personal page however it is paid', () => {
    // The tier decision, not the billing one: personal pages never capture.
    expect(canCapture({ ...paid, mode: 'PERSONAL' })).toBe(false);
  });

  it('lets a page that has never paid capture inside its trial', () => {
    expect(canCapture({ ...paid, paidUntil: null, leadsCaptured: 0 })).toBe(true);
  });

  it('lets it capture on the last free lead', () => {
    // The boundary. `leadsCaptured` is how many have ALREADY been captured, so
    // at FREE_LEADS - 1 the page has had two and is entitled to a third.
    expect(canCapture({ ...paid, paidUntil: null, leadsCaptured: FREE_LEADS - 1 })).toBe(true);
  });

  it('refuses once the trial is spent', () => {
    expect(canCapture({ ...paid, paidUntil: null, leadsCaptured: FREE_LEADS })).toBe(false);
  });

  it('refuses a lapsed page whose trial is also spent', () => {
    expect(canCapture({ ...paid, paidUntil: PAST, leadsCaptured: FREE_LEADS })).toBe(false);
  });

  it('lets a lapsed page capture if it somehow still has trial left', () => {
    // Not a real sequence -- a page that paid usually captured first -- but the
    // rule is an OR and this pins that it is, rather than a hidden precedence.
    expect(canCapture({ ...paid, paidUntil: PAST, leadsCaptured: 0 })).toBe(true);
  });

  it('treats the instant the payment expires as expired', () => {
    // `now === paidUntil` is not "still paid". Asserted because the obvious
    // implementations differ here and neither is obviously wrong.
    expect(canCapture({ ...paid, paidUntil: NOW, leadsCaptured: FREE_LEADS })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run src/plan.test.ts`
Expected: FAIL — `Failed to resolve import "./plan.js"`. That is a missing-module failure, which proves only that the file is absent; after Step 3, re-read each assertion and satisfy yourself it passes on its own merits.

- [ ] **Step 3: Write minimal implementation**

Create `packages/core/src/plan.ts`:

```ts
/**
 * How many leads a page may capture before it has to pay.
 *
 * Three, and counted rather than timed. A fourteen-day trial can expire having
 * produced nothing, which teaches an owner the product does not work and
 * spends the model budget proving it; a lead trial ends only once the product
 * has demonstrably worked. A page that never captures anything never pays and
 * never feels cheated.
 *
 * Not an env var, unlike the conversation cap. That one is an operational dial
 * for spend; this is a promise printed on a pricing page.
 */
export const FREE_LEADS = 3;

/**
 * Whether this page may take a phone number.
 *
 * The one thing a lapsed page loses. Everything else it keeps -- the FAQ pages
 * stay indexed, the public page stays indexed, chat keeps answering at the
 * same cap. Withdrawing FAQ generation would 404 URLs the owner earned in
 * search, and rankings do not return the moment a bill is paid. Capture is
 * what README says a business pays for, so capture is what stops.
 *
 * `now` is a parameter and not `new Date()`, the same as every other rule in
 * this package: a function that reads the clock cannot be tested at the
 * instant its answer changes.
 */
export function canCapture(input: {
  mode: 'PERSONAL' | 'BUSINESS';
  paidUntil: Date | null;
  leadsCaptured: number;
  now: Date;
}): boolean {
  if (input.mode !== 'BUSINESS') return false;
  // `>` and not `>=`: the instant a payment expires, it has expired.
  if (input.paidUntil !== null && input.paidUntil.getTime() > input.now.getTime()) return true;
  return input.leadsCaptured < FREE_LEADS;
}
```

- [ ] **Step 4: Export from the package barrel**

Add to `packages/core/src/index.ts`, after the `cap.js` line:

```ts
export { canCapture, FREE_LEADS } from './plan.js';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/core && npx vitest run src/plan.test.ts`
Expected: PASS, 8 tests.

Then prove two assertions are load-bearing, restoring after each:
1. Change `leadsCaptured < FREE_LEADS` to `<=`. Only "refuses once the trial is spent" must fail.
2. Change the expiry comparison to `>=`. Only "treats the instant the payment expires as expired" must fail.

Record both outputs. A boundary test that passes under either comparison has not encoded the boundary.

- [ ] **Step 6: Run the package gates**

Run: `pnpm --filter @curios/core lint && pnpm --filter @curios/core typecheck && pnpm --filter @curios/core test`

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/plan.ts packages/core/src/plan.test.ts packages/core/src/index.ts
git commit -m "feat(core): three leads, then a page has to pay"
```

---

### Task 2: The columns

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (the `Page` model, currently at lines 78-101)
- Modify: `packages/db/src/schema.test.ts`
- Create: a migration under `packages/db/prisma/migrations/`

**Interfaces:**
- Produces: `Page.paidUntil: Date | null`, `Page.leadsCaptured: number` (default 0).

- [ ] **Step 1: Write the failing test**

Add to `packages/db/src/schema.test.ts`, inside the existing `describe('the owner surface columns')`:

```ts
it('starts a page unpaid with no leads captured', async () => {
  // The state every page begins in, and the one the trial is measured from.
  const account = await prisma.account.create({
    data: { email: `plan-${randomUUID()}@example.com` },
    select: { id: true },
  });
  const skeleton = `plan-${randomUUID().slice(0, 8)}`;

  const page = await prisma.page.create({
    data: { accountId: account.id, handle: skeleton, skeleton, displayName: 'Nadia Bakes' },
    select: { paidUntil: true, leadsCaptured: true },
  });

  expect(page.paidUntil).toBeNull();
  expect(page.leadsCaptured).toBe(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/db && npx vitest run src/schema.test.ts`
Expected: FAIL — Prisma rejects `paidUntil` in the `select` as an unknown field.

- [ ] **Step 3: Add the columns**

In `packages/db/prisma/schema.prisma`, inside `model Page`, after `published`:

```prisma
  /// Paid through this instant. Null means never paid. A one-off Billplz bill
  /// extends it; there is no subscription to activate, suspend or reconcile,
  /// because a one-off bill has no lifecycle to model. Lapsed is a comparison.
  paidUntil     DateTime?
  /// Leads ever captured, and never decremented. A counter rather than
  /// count(Lead) because slice 5 gave owners a lead delete -- counting rows
  /// would let somebody delete their three trial leads and get three more.
  leadsCaptured Int            @default(0)
```

- [ ] **Step 4: Generate the migration without applying it**

```bash
cd packages/db && DATABASE_URL="$(grep '^DATABASE_URL=' ../../.env | cut -d= -f2-)" npx prisma migrate dev --create-only --name plan_gate
```

`--create-only` is not optional. A plain `migrate dev` applies immediately and, on detecting drift, offers to **reset** — which drops the dev database. Never accept a reset prompt; if one appears, stop and report BLOCKED with its text.

Read the generated SQL. It must add one nullable column and one integer column with a default, and nothing else. If it contains `DROP`, `TRUNCATE`, or anything rewriting existing rows, report BLOCKED with the SQL quoted.

- [ ] **Step 5: Apply to both databases**

```bash
cd packages/db
DATABASE_URL="$(grep '^DATABASE_URL=' ../../.env | cut -d= -f2-)" npx prisma migrate deploy
DATABASE_URL="$(grep '^DATABASE_URL_TEST=' ../../.env | cut -d= -f2-)" npx prisma migrate deploy
npx prisma generate
```

`migrate deploy` never prompts and never resets, which is why both databases go through it.

- [ ] **Step 6: Run tests**

Run: `cd packages/db && npx vitest run src/schema.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations packages/db/src/schema.test.ts
git commit -m "feat(db): a page can be paid, and remembers what it captured"
```

---

### Task 3: The endpoint refuses

**Files:**
- Modify: `apps/api/src/modules/leads/lead.service.ts` (the gate at lines 88-92; the insert at lines 107-110)
- Create: `apps/api/src/modules/leads/lead.plan.test.ts`

**Interfaces:**
- Consumes: `canCapture`, `FREE_LEADS` from `@curios/core` (Task 1); the two columns (Task 2).

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/modules/leads/lead.plan.test.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { FREE_LEADS } from '@curios/core';
import { captureLead, NotQualifiedError } from './lead.service.js';

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });
const queue = { add: vi.fn() };

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE "Account" CASCADE');
  queue.add.mockClear();
});

/**
 * A conversation that already qualifies for capture, so the only thing these
 * tests vary is the plan. Three visitor turns and a number, which is what
 * `qualifies` in packages/core requires.
 */
async function readyToCapture(page: { paidUntil?: Date | null; leadsCaptured?: number }) {
  const account = await prisma.account.create({
    data: { email: `pg-${randomUUID()}@example.com` },
    select: { id: true },
  });
  const slug = `pg-${randomUUID().slice(0, 8)}`;
  const row = await prisma.page.create({
    data: {
      accountId: account.id,
      handle: slug,
      skeleton: slug,
      displayName: 'Nadia Bakes',
      published: true,
      paidUntil: page.paidUntil ?? null,
      leadsCaptured: page.leadsCaptured ?? 0,
    },
    select: { id: true },
  });
  const conversation = await prisma.conversation.create({
    data: {
      pageId: row.id,
      messages: {
        create: [
          { role: 'USER', content: 'nak order kek 2kg' },
          { role: 'ASSISTANT', content: 'boleh' },
          { role: 'USER', content: 'untuk 20 orang' },
          { role: 'ASSISTANT', content: 'ok' },
          { role: 'USER', content: 'hantar 5 haribulan' },
        ],
      },
    },
    select: { id: true },
  });
  return { pageId: row.id, conversationId: conversation.id };
}

const capture = (conversationId: string) =>
  captureLead({ prisma, queue } as never, { conversationId, phone: '0123456789' });

describe('the capture gate', () => {
  it('captures for a page inside its trial', async () => {
    const { conversationId } = await readyToCapture({ leadsCaptured: 0 });

    await expect(capture(conversationId)).resolves.toMatchObject({ leadId: expect.any(String) });
  });

  it('captures on the last free lead', async () => {
    const { conversationId } = await readyToCapture({ leadsCaptured: FREE_LEADS - 1 });

    await expect(capture(conversationId)).resolves.toBeTruthy();
  });

  it('refuses once the trial is spent and nothing has been paid', async () => {
    const { conversationId } = await readyToCapture({ leadsCaptured: FREE_LEADS });

    await expect(capture(conversationId)).rejects.toBeInstanceOf(NotQualifiedError);
  });

  it('refuses with the same error an unqualified conversation gets', async () => {
    // Deliberate. A distinguishable billing error would tell an anonymous
    // visitor -- anyone with curl -- whether this owner has paid, which is
    // nobody's business but the owner's.
    const { conversationId } = await readyToCapture({ leadsCaptured: FREE_LEADS });

    await expect(capture(conversationId)).rejects.toMatchObject({ code: 'NOT_QUALIFIED' });
  });

  it('captures for a paid page whose trial is long gone', async () => {
    const { conversationId } = await readyToCapture({
      paidUntil: new Date(Date.now() + 86_400_000),
      leadsCaptured: 99,
    });

    await expect(capture(conversationId)).resolves.toBeTruthy();
  });

  it('refuses a page whose payment has lapsed', async () => {
    const { conversationId } = await readyToCapture({
      paidUntil: new Date(Date.now() - 86_400_000),
      leadsCaptured: FREE_LEADS,
    });

    await expect(capture(conversationId)).rejects.toBeInstanceOf(NotQualifiedError);
  });

  it('counts a captured lead against the trial', async () => {
    const { pageId, conversationId } = await readyToCapture({ leadsCaptured: 1 });

    await capture(conversationId);

    const row = await prisma.page.findUniqueOrThrow({
      where: { id: pageId },
      select: { leadsCaptured: true },
    });
    expect(row.leadsCaptured).toBe(2);
  });

  it('does not count a refused capture', async () => {
    // The counter must track leads that exist. A refusal that still
    // incremented would spend a page's trial without giving it anything.
    const { pageId, conversationId } = await readyToCapture({ leadsCaptured: FREE_LEADS });

    await expect(capture(conversationId)).rejects.toBeInstanceOf(NotQualifiedError);

    const row = await prisma.page.findUniqueOrThrow({
      where: { id: pageId },
      select: { leadsCaptured: true },
    });
    expect(row.leadsCaptured).toBe(FREE_LEADS);
  });

  it('stores the lead and the count together or not at all', async () => {
    // One transaction. Two statements that can partially fail would either
    // lose a count -- a free fourth lead -- or count a lead nobody stored.
    const { pageId, conversationId } = await readyToCapture({ leadsCaptured: 0 });

    await capture(conversationId);

    const [leads, row] = await Promise.all([
      prisma.lead.count({ where: { pageId } }),
      prisma.page.findUniqueOrThrow({ where: { id: pageId }, select: { leadsCaptured: true } }),
    ]);
    expect(leads).toBe(1);
    expect(row.leadsCaptured).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && npx vitest run src/modules/leads/lead.plan.test.ts`

Expected, and be precise — only **four** of the nine fail before the gate exists:

| Test | Before |
|---|---|
| captures for a page inside its trial | **passes** — capture already works |
| captures on the last free lead | **passes** |
| refuses once the trial is spent | **FAILS** — capture succeeds |
| refuses with the same error | **FAILS** |
| captures for a paid page whose trial is gone | **passes** |
| refuses a lapsed page | **FAILS** |
| counts a captured lead | **FAILS** — nothing increments |
| does not count a refused capture | **passes** — vacuously, since nothing increments at all |
| stores the lead and count together | **FAILS** |

The five that pass are regression guards for behaviour this task must not break, and one — "does not count a refused capture" — passes vacuously today and only becomes meaningful once the increment exists. Do not delete any of them.

- [ ] **Step 3: Add the gate**

In `apps/api/src/modules/leads/lead.service.ts`, widen the import on line 1:

```ts
import {
  canCapture,
  LEAD_QUEUE,
  normalizeMalaysianPhone,
  qualifies,
  type LeadJobData,
} from '@curios/core';
```

Widen the conversation query's page select (currently `page: { select: { mode: true } }`) to:

```ts
      page: { select: { mode: true, paidUntil: true, leadsCaptured: true } },
```

Then, immediately after the existing `if (!eligible) throw new NotQualifiedError();`:

```ts
  // The plan gate, and deliberately the same error as the qualification gate
  // above. A distinguishable "you have not paid" would tell an anonymous
  // caller -- this endpoint takes no session -- whether this owner is paying,
  // which is the owner's business and nobody else's.
  const allowed = canCapture({
    mode: conversation.page.mode,
    paidUntil: conversation.page.paidUntil,
    leadsCaptured: conversation.page.leadsCaptured,
    now: new Date(),
  });
  if (!allowed) throw new NotQualifiedError();
```

- [ ] **Step 4: Make the insert and the count one transaction**

Replace the existing `deps.prisma.lead.create({...})` call with:

```ts
  // One transaction. The counter is what the trial is measured against, so a
  // stored lead that was never counted is a free fourth lead, and a count
  // without a lead spends a page's trial on nothing.
  const [lead] = await deps.prisma.$transaction([
    deps.prisma.lead.create({
      data: { pageId: conversation.pageId, conversationId: conversation.id, phone },
      select: { id: true },
    }),
    deps.prisma.page.update({
      where: { id: conversation.pageId },
      data: { leadsCaptured: { increment: 1 } },
    }),
  ]);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/api && npx vitest run src/modules/leads/`
Expected: PASS, every file. The existing `lead.service.test.ts` and `lead.delete.test.ts` must still pass — if a pre-existing test now fails, its fixture predates the gate and needs `leadsCaptured` or `paidUntil` set, not a loosened assertion. Say which in your report.

- [ ] **Step 6: Prove the gate is load-bearing**

Comment out the `if (!allowed) throw new NotQualifiedError();` line and re-run. Exactly the three refusal tests must fail. Restore it.

Then comment out the `page.update` from the transaction and re-run. "counts a captured lead" and "stores the lead and count together" must fail. Restore it.

- [ ] **Step 7: Run the api suite**

Run: `cd apps/api && npx vitest run`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/leads/
git commit -m "feat(api): a page that has not paid stops taking numbers"
```

---

### Task 4: The card disappears

**Files:**
- Modify: `packages/db-read/src/page.query.ts`
- Modify: `packages/db-read/src/page.query.test.ts`
- Modify: `apps/web/app/[handle]/page.tsx:98`
- Modify: `apps/web/app/[handle]/page.test.tsx`

**Interfaces:**
- Consumes: `canCapture` from `@curios/core` (Task 1); the two columns (Task 2).
- Produces: `PublicPage` gains `paidUntil: Date | null` and `leadsCaptured: number`.

- [ ] **Step 1: Widen the read, with a test**

Add to `packages/db-read/src/page.query.test.ts`:

```ts
it('carries what the capture gate needs', async () => {
  // The page decides whether to render the card, so it needs the same two
  // facts the endpoint checks. Without them the card is shown to a lapsed
  // owner and fails only when a visitor tries to use it.
  const page = await getPublicPage(publishedHandle);

  expect(page).toMatchObject({ paidUntil: null, leadsCaptured: 0 });
});
```

Use whatever fixture handle that file already publishes — read it first; do not create a second published page beside the existing one.

- [ ] **Step 2: Run it, then widen `PublicPage`**

Run: `cd packages/db-read && npx vitest run src/page.query.test.ts`
Expected: FAIL — the returned object has neither key.

Then in `packages/db-read/src/page.query.ts`, add to the `PublicPage` interface:

```ts
  /** Paid through this instant, or null. The capture gate's first input. */
  paidUntil: Date | null;
  /** Leads ever captured, for the free-trial half of the gate. */
  leadsCaptured: number;
```

and to the `select`:

```ts
      paidUntil: true,
      leadsCaptured: true,
```

Re-run: PASS.

- [ ] **Step 3: Write the failing page test**

Add to `apps/web/app/[handle]/page.test.tsx`. Read the file's existing `page` fixture first and extend it with `paidUntil: null, leadsCaptured: 0`; every existing test keeps working because that is the trial state.

```tsx
describe('the capture card and the plan', () => {
  it('offers capture to a page inside its trial', async () => {
    getPublicPage.mockResolvedValueOnce({ ...page, paidUntil: null, leadsCaptured: 0 });

    render(await HandlePage({ params: Promise.resolve({ handle: 'nadia' }) }));

    expect(screen.getByRole('button', { name: /ask/i })).toBeInTheDocument();
  });

  it('offers capture to a paid page whose trial is spent', async () => {
    getPublicPage.mockResolvedValueOnce({
      ...page,
      paidUntil: new Date(Date.now() + 86_400_000),
      leadsCaptured: 99,
    });

    render(await HandlePage({ params: Promise.resolve({ handle: 'nadia' }) }));

    expect(screen.getByRole('button', { name: /ask/i })).toBeInTheDocument();
  });
});
```

`Ask` receives `canCapture` as a prop and only wires `onCapture` when it is true, so the card's presence is not directly queryable from this level. Assert what *is* observable — the ask bar renders in every case — and prove the prop itself in Step 5 by breaking it. Say in your report if you find a better observable; do not assert on an implementation detail to manufacture one.

- [ ] **Step 4: Pass the rule's answer**

In `apps/web/app/[handle]/page.tsx`, add the import:

```tsx
import { canCapture } from '@curios/core';
```

and replace line 98's `canCapture={page.mode === 'BUSINESS'}` with:

```tsx
        canCapture={canCapture({
          mode: page.mode,
          paidUntil: page.paidUntil,
          leadsCaptured: page.leadsCaptured,
          now: new Date(),
        })}
```

- [ ] **Step 5: Prove both sites are wired**

The endpoint's half was proven in Task 3. For this half: temporarily hard-code `canCapture={false}` and confirm the two tests above still pass — they will, because they assert the ask bar rather than the card.

**That is the finding, not a pass.** It means this file has no test that can distinguish a gated card from an ungated one. Add one that can: assert on what `Ask` actually does with the prop, or lift the decision into a small exported helper this test can call directly. Report which you chose and why. A gate whose absence no test notices is the defect slice 6 shipped and a review caught; do not ship it twice.

- [ ] **Step 6: Run the gates**

```bash
pnpm --filter @curios/db-read test
cd apps/web && npx vitest run app/\[handle\]/
cd ../.. && pnpm lint && pnpm typecheck && pnpm turbo run test --concurrency=1 --force
```

- [ ] **Step 7: Commit**

```bash
git add packages/db-read/src apps/web/app/\[handle\]/
git commit -m "feat(web): the card only shows where it will work"
```

---

### Task 5: Gates, documents, and a walkthrough

**Files:**
- Modify: `devDocs/README.md` (the tier table)
- Modify: `devDocs/BACKEND.md` (the capture-card rule)
- Create: `devDocs/manual-verification-plan-gate.md`

- [ ] **Step 1: Run all four gates**

```bash
pnpm lint
pnpm typecheck
pnpm turbo run test --concurrency=1 --force
pnpm --filter @curios/web build
```

`--force` because a turbo cache hit replays an older log and proves nothing about this tree. If a gate fails for a reason you cannot tie to this slice, report BLOCKED with the output rather than chasing it.

- [ ] **Step 2: Correct README's tier table**

It has two columns, Personal and Business, and describes what every page gets — true only because `mode` defaults to `BUSINESS` and nothing else gated anything. There are now three states. Give the capture-card row the distinction at minimum: Personal never, Business unpaid only for its first three leads, Business paid always. Match the table's terse register; do not turn a cell into a paragraph.

- [ ] **Step 3: Correct BACKEND.md's capture rule**

It describes the capture card as gating on mode. It now also gates on plan, and the trial is part of the rule rather than a marketing layer above it. Say so in the section's own voice, and name `canCapture` so the next reader can find the one implementation.

- [ ] **Step 4: Write the manual verification document**

Create `devDocs/manual-verification-plan-gate.md`, following the shape of the four that already exist — read `manual-verification-caps.md` and `manual-verification-leads.md` first. State plainly what cannot be automated, separate browser-only checks from the rest, give runnable commands, and mark it **NOT RUN**.

It must cover the three page states, and the SQL to put a page into each:

```bash
# spend the trial without capturing three leads
docker exec -i curios-postgres psql -U curios -d curios -c \
  "UPDATE \"Page\" SET \"leadsCaptured\" = 3, \"paidUntil\" = NULL WHERE handle = 'YOURHANDLE';"

# make it paid
docker exec -i curios-postgres psql -U curios -d curios -c \
  "UPDATE \"Page\" SET \"paidUntil\" = now() + interval '30 days' WHERE handle = 'YOURHANDLE';"
```

And it must say the thing the automated tests cannot: that a lapsed owner sees the card **simply vanish, with no explanation**, because telling them is `/app/billing`'s job in slice 9. Whoever walks this should judge how bad that is, because it is the strongest argument for shipping slice 9 close behind.

- [ ] **Step 5: Verify the documents against the code**

Re-read both corrected passages against what Tasks 1-4 built. If a sentence is aspirational rather than true, fix the sentence — unless the code is wrong, in which case stop and report rather than editing the document to match a defect.

- [ ] **Step 6: Commit**

```bash
git add devDocs/
git commit -m "docs: three page states, not two"
```

---

## Self-Review

**Spec coverage.** Every section maps to a task: the rule and `FREE_LEADS` to Task 1; the two columns and the no-`Subscription` decision to Task 2; the endpoint half of the two-site enforcement, the shared error, and the transaction to Task 3; the page half to Task 4; the corrected documents and walkthrough to Task 5. The spec's accepted check-then-create race is deliberately not "fixed" by any task — it is documented in the spec and in `plan.ts`'s comment, and a task that closed it would contradict the spec.

**Placeholder scan.** No TBDs. Every code step carries its code. Two steps are deliberately open-ended and say why: Task 4 Step 1 and Step 3 depend on fixtures in files the implementer must read first, and Task 4 Step 5 asks for a judgement about how to make the page-side gate observable, because the honest answer depends on what `Ask` exposes.

**Type consistency.** `canCapture({ mode, paidUntil, leadsCaptured, now })` and `FREE_LEADS` keep their names and shapes from Task 1's Produces block through Tasks 3 and 4. `paidUntil` is `Date | null` and `leadsCaptured` is `number` in the rule, the schema, `PublicPage`, and every fixture.

**The risk worth naming.** Task 4 Step 5 is likely to find that this codebase cannot currently observe the page-side gate from a test, because `Ask` takes `canCapture` as a prop and swallows it. That is a real gap and the step is written to surface it rather than let an implementer paper over it with an assertion on the prop's own value — which would test React, not the gate. If the answer turns out to need a small refactor of `Ask`, that is worth doing here rather than pretending the site is covered.
