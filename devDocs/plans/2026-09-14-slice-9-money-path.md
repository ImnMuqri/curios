# Slice 9, Plan 1 — The money path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An owner pays RM39 for a month or RM390 for a year through a one-off Billplz FPX bill, and `Page.paidUntil` moves forward — granted by a verified callback, a verified redirect, or an hourly check, exactly once.

**Architecture:** A new `@curios/billing` package holds the signature check, the Billplz HTTP client and the one grant step, because the API and the workers both grant and the two apps never import each other. The grant binds a bill to the `Payment` row created for it, then claims the payment and locks the page row inside one transaction. The API raises bills and receives the callback and redirect; the workers run the hourly pending check; the web app gets a basic `/app/billing`.

**Tech Stack:** TypeScript, Prisma 6, Postgres, Fastify 5 with `fastify-type-provider-zod`, BullMQ 5.81, Next 15 (App Router, RSC), vitest.

**Spec:** `devDocs/slice-9-build-spec.md` — read it before Task 1. Plan 2 (reminders, the trial reset, the full billing screen, copy, documents) is separate and follows this one.

## Global Constraints

- **Prices** are `PLAN_PRICES_CENTS = { MONTHLY: 3900, ANNUAL: 39000 }` in `@curios/core`. Constants, never env vars.
- **All money is integer cents.** A `Payment` stores `amountCents` when it is created. A grant compares against that stored value, **never** against `PLAN_PRICES_CENTS`.
- **The signature:** HMAC-SHA256 keyed with the X Signature Key, over **every received parameter** except `x_signature`. Each key is concatenated to its value; the *concatenated pair strings* are sorted by their lowercased code points; the sorted pairs are joined with `|`. **Never a hard-coded field list** — `transaction_id` and `transaction_status` arrive only sometimes and are signed when they do. Compared in constant time.
- **The redirect** carries only `billplz[id]`, `billplz[paid]`, `billplz[paid_at]`, `billplz[x_signature]` and, sometimes, `billplz[transaction_id]` and `billplz[transaction_status]`. Keys hash as `billplz` plus the name, brackets dropped (`billplz[id]` → `billplzid`). It carries **no amount, collection, state or reference**, so the return route **fetches the bill** before granting.
- **The callback carries no `reference_1`.** `reference_1` is checked only on bills we fetched.
- **One grant step**, `grantPayment` in `@curios/billing`, used by the callback, the redirect and the hourly check. Inside one transaction: claim the payment `PENDING → PAID` with a conditional update, lock the page row with `SELECT ... FOR UPDATE`, compute with `extendPaidUntil`, write.
- **Missing Billplz config throws at boot.** API: `BILLPLZ_API_KEY`, `BILLPLZ_COLLECTION_ID`, `BILLPLZ_X_SIGNATURE_KEY`, `BILLPLZ_BASE_URL`, `BILLPLZ_CALLBACK_URL`, `BILLPLZ_REDIRECT_URL`. Workers: `BILLPLZ_API_KEY`, `BILLPLZ_BASE_URL`.
- **No test calls Billplz.** The API takes a stub client through `AppOverrides.billing`; the workers job takes one as a dependency.
- **The callback** answers 400 for a missing or wrong signature and 200 for everything else. It has **no per-IP rate limit**. Its form parser is registered **inside the Billplz routes plugin only**. It logs the bill id and the outcome — **never the body**, which carries the payer's email and mobile.
- **Bill creation** needs a session and `RATE_LIMIT_BILLING_PER_ACCOUNT` (default 10 an hour), keyed on `request.account?.id` falling back to the caller's address, never to a constant. An owner with no page gets the existing `NoPageError` (`NO_PAGE`, 404) — **not** `PAGE_NOT_FOUND`, which is the visitor chat's code. The spec first named the wrong one, and is corrected alongside this plan. A personal page gets `NOT_A_BUSINESS_PAGE` (400). A Billplz outage (network failure, timeout, 5xx) is `BILLPLZ_UNAVAILABLE` (502); a 4xx from Billplz is our misconfiguration and stays a plain error, which the API reports as `INTERNAL_ERROR`.
- **`errorsPlugin` replaces every 5xx message** with "Something failed on our side. Try again." and keeps only an allow-listed code. So the web app turns the `BILLPLZ_UNAVAILABLE` *code* into its own sentence.
- **No client component imports the `@curios/core` barrel** — it pulls in `node:crypto`. Prices reach the browser as plain props from a server component. Type-only imports (`import type`) are fine.
- **Migrations:** `prisma migrate dev --create-only`, read the SQL, then `migrate deploy` against both databases. Never accept a reset prompt.
- **Tests:** workspace suite is `pnpm turbo run test --concurrency=1` — **never omit `--concurrency=1`**. A container restart wipes the tmpfs test database; restore with `prisma migrate deploy` against `DATABASE_URL_TEST` **and** `packages/db/prisma/sql/readonly-role.sql`.
- **vitest does not typecheck.** Run `npx tsc --noEmit` in every package you touch. Read exit codes directly (`; echo "EXIT: $?"`) — never through `| tail` or `| head`.
- **Out of this plan:** `Page.trialResetAt`, `Page.renewalReminderFor`, reminders, the reset, `planState`'s `lapsedOn`, usage and payment history on the screen, and the document corrections. All plan 2.
- **Plan 1 is not done until one real Billplz sandbox payment has been granted by its callback** (Task 9).

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/core/src/billing.ts` | `PLAN_PRICES_CENTS`, `BillingPlan`, `extendPaidUntil`. Pure. |
| `packages/core/src/types.ts` | `BILLING_QUEUE`, `PENDING_CHECK_JOB`. |
| `packages/db/prisma/schema.prisma` | `BillingPlan` and `PaymentStatus` enums, `Payment`, `Page.payments`. |
| `packages/billing/src/signature.ts` | The source string, signing, verifying, flattening redirect keys. |
| `packages/billing/src/client.ts` | `createBillplzClient`: create a bill, fetch a bill. `BillplzUnavailableError`. |
| `packages/billing/src/grant.ts` | `grantPayment`, and evidence from a callback or a fetched bill. |
| `apps/api/src/modules/billing/billing.service.ts` | `createBillForOwner`, `NotABusinessPageError`, `billDescription`. |
| `apps/api/src/modules/billing/billing.routes.ts` | `ownerBillingRoutes` (POST /billing/bills), `billplzRoutes` (callback, return). |
| `apps/api/src/plugins/rate-limit.ts` | `billingPerAccountLimit`. |
| `apps/api/src/plugins/errors.ts` | `NOT_A_BUSINESS_PAGE`, `BILLPLZ_UNAVAILABLE` allow-listed. |
| `apps/api/src/app.ts` | Registers both billing plugins; `AppOverrides.billing`. |
| `apps/workers/src/billing/pending-check.ts` | `runPendingCheck`, `createBillingWorker`, `scheduleBillingJobs`. |
| `apps/web/app/app/billing/billing-copy.ts` | Plan summary, payment banner, ringgit formatting. Pure. |
| `apps/web/app/app/billing/pay-buttons.tsx` | The monthly and annual buttons. Client. |
| `apps/web/app/app/billing/page.tsx` | `/app/billing`. Server. |
| `devDocs/manual-verification-billing.md` | The walkthrough, with its coverage table, and the sandbox round trip. |

---

### Task 1: Prices, periods and the queue contract

**Files:**
- Create: `packages/core/src/billing.ts`
- Create: `packages/core/src/billing.test.ts`
- Modify: `packages/core/src/types.ts` (append)
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `PLAN_PRICES_CENTS: { readonly MONTHLY: 3900; readonly ANNUAL: 39000 }`
  - `type BillingPlan = 'MONTHLY' | 'ANNUAL'`
  - `extendPaidUntil(input: { paidUntil: Date | null; now: Date; plan: BillingPlan }): Date`
  - `BILLING_QUEUE = 'billing'`, `PENDING_CHECK_JOB = 'pending-check'`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/billing.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { extendPaidUntil, PLAN_PRICES_CENTS } from './billing.js';

const at = (iso: string) => new Date(iso);

describe('PLAN_PRICES_CENTS', () => {
  it('holds the published prices, in cents', () => {
    expect(PLAN_PRICES_CENTS).toEqual({ MONTHLY: 3900, ANNUAL: 39000 });
  });
});

describe('extendPaidUntil', () => {
  it('starts from now when the page has never paid', () => {
    expect(
      extendPaidUntil({ paidUntil: null, now: at('2026-03-10T08:00:00.000Z'), plan: 'MONTHLY' }),
    ).toEqual(at('2026-04-10T08:00:00.000Z'));
  });

  it('stacks on a paidUntil still in the future, so renewing early loses nothing', () => {
    expect(
      extendPaidUntil({
        paidUntil: at('2026-03-20T08:00:00.000Z'),
        now: at('2026-03-10T08:00:00.000Z'),
        plan: 'MONTHLY',
      }),
    ).toEqual(at('2026-04-20T08:00:00.000Z'));
  });

  it('starts from now after a lapse, rather than back-dating paid time', () => {
    expect(
      extendPaidUntil({
        paidUntil: at('2026-01-05T00:00:00.000Z'),
        now: at('2026-03-10T08:00:00.000Z'),
        plan: 'MONTHLY',
      }),
    ).toEqual(at('2026-04-10T08:00:00.000Z'));
  });

  it('clamps Jan 31 to the last day of February', () => {
    expect(
      extendPaidUntil({ paidUntil: null, now: at('2026-01-31T12:00:00.000Z'), plan: 'MONTHLY' }),
    ).toEqual(at('2026-02-28T12:00:00.000Z'));
  });

  it('clamps to Feb 29 in a leap year', () => {
    expect(
      extendPaidUntil({ paidUntil: null, now: at('2028-01-31T12:00:00.000Z'), plan: 'MONTHLY' }),
    ).toEqual(at('2028-02-29T12:00:00.000Z'));
  });

  it('rolls December into January of the next year', () => {
    expect(
      extendPaidUntil({ paidUntil: null, now: at('2026-12-31T23:30:00.000Z'), plan: 'MONTHLY' }),
    ).toEqual(at('2027-01-31T23:30:00.000Z'));
  });

  it('adds a calendar year for the annual plan, clamping Feb 29', () => {
    expect(
      extendPaidUntil({ paidUntil: null, now: at('2028-02-29T09:00:00.000Z'), plan: 'ANNUAL' }),
    ).toEqual(at('2029-02-28T09:00:00.000Z'));
  });
});
```

There is deliberately no "paidUntil equal to now" test: from that input, counting from `now` and counting from `paidUntil` give the same answer, so such a test could not fail.

- [ ] **Step 2: Run it and watch it fail**

Run: `cd packages/core && npx vitest run src/billing.test.ts`
Expected: the file fails to load — `./billing.js` does not exist — and no test runs.

- [ ] **Step 3: Implement**

Create `packages/core/src/billing.ts`:

```ts
/**
 * What a plan costs, in cents -- Billplz's unit, and the only unit money moves in here.
 *
 * Constants, not env vars, for FREE_LEADS's reason: this is a promise printed on a
 * pricing page, not an operational dial. A Payment stores the amount it was billed
 * at, so changing these never alters a bill already issued.
 */
export const PLAN_PRICES_CENTS = { MONTHLY: 3900, ANNUAL: 39000 } as const;

export type BillingPlan = keyof typeof PLAN_PRICES_CENTS;

/**
 * The paidUntil a payment of `plan` produces.
 *
 * Counts from whichever is later, now or the current paidUntil, so renewing early
 * stacks and renewing after a lapse starts fresh. Adds one calendar month or year in
 * UTC, clamped to the last day of a shorter month -- Jan 31 plus a month is the last
 * day of February. A fixed 30 days would cost a monthly owner about five days a year.
 *
 * `now` is a parameter so the month-end boundaries can be tested.
 */
export function extendPaidUntil(input: {
  paidUntil: Date | null;
  now: Date;
  plan: BillingPlan;
}): Date {
  const base =
    input.paidUntil !== null && input.paidUntil.getTime() > input.now.getTime()
      ? input.paidUntil
      : input.now;
  return addCalendarMonths(base, input.plan === 'ANNUAL' ? 12 : 1);
}

function addCalendarMonths(from: Date, months: number): Date {
  const year = from.getUTCFullYear();
  const month = from.getUTCMonth() + months;
  // Day 0 of the following month is the last day of the target month.
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      year,
      month,
      Math.min(from.getUTCDate(), lastDay),
      from.getUTCHours(),
      from.getUTCMinutes(),
      from.getUTCSeconds(),
      from.getUTCMilliseconds(),
    ),
  );
}
```

Append to `packages/core/src/types.ts`:

```ts
/**
 * The billing schedule. The name lives here for the same reason as every other
 * queue's: apps/workers consumes it, and a name spelled inside one app is how the
 * next app to need it gets it wrong. Scheduled jobs carry no data; the job name says
 * which check to run.
 */
export const BILLING_QUEUE = 'billing';
export const PENDING_CHECK_JOB = 'pending-check';
```

In `packages/core/src/index.ts`, replace the line

```ts
export { FACT_CATEGORIES, INGEST_QUEUE, LEAD_QUEUE, MAIL_QUEUE } from './types.js';
```

with

```ts
export {
  BILLING_QUEUE,
  FACT_CATEGORIES,
  INGEST_QUEUE,
  LEAD_QUEUE,
  MAIL_QUEUE,
  PENDING_CHECK_JOB,
} from './types.js';
```

and after the two `plan.js` export lines add:

```ts
export { extendPaidUntil, PLAN_PRICES_CENTS } from './billing.js';
export type { BillingPlan } from './billing.js';
```

- [ ] **Step 4: Run it and watch it pass**

Run: `cd packages/core && npx vitest run src/billing.test.ts`
Expected: 8 passed.

- [ ] **Step 5: Prove the tests can fail**

Make each change, run the file, confirm the named tests fail, then restore:
1. In `extendPaidUntil`, replace the ternary with `const base = input.paidUntil ?? input.now;` — "starts from now after a lapse" fails.
2. Replace `Math.min(from.getUTCDate(), lastDay)` with `from.getUTCDate()` — the three clamping tests fail (Jan 31, leap year, annual).

If a different set fails, report it rather than adjusting a test.

- [ ] **Step 6: Package gates**

```bash
cd packages/core
npx vitest run; echo "TEST EXIT: $?"
npx tsc --noEmit; echo "TSC EXIT: $?"
npx eslint src/billing.ts src/billing.test.ts src/types.ts src/index.ts; echo "LINT EXIT: $?"
```

Expected: all three exit 0.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/billing.ts packages/core/src/billing.test.ts packages/core/src/types.ts packages/core/src/index.ts
git commit -m "feat(core): plan prices, calendar-month extension and the billing queue name"
```

---
### Task 2: The Payment table

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<timestamp>_billing_payments/migration.sql` (generated)
- Modify: `packages/db/src/schema.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: Prisma model `Payment { id, pageId, plan, amountCents, billplzCollectionId, billplzBillId (unique, nullable), status, paidAt, grantedUntil, createdAt }`, enums `BillingPlan { MONTHLY ANNUAL }` and `PaymentStatus { PENDING PAID }`, relation `Page.payments`. Available as `prisma.payment` on any `PrismaClient` from `@curios/db`.

- [ ] **Step 1: Write the failing tests**

In `packages/db/src/schema.test.ts`, find the test `'refuses a null leadsCaptured, not only defaulting it to zero'`. Directly after it, inside the same `describe`, add:

```ts
  it('starts a payment pending, with nothing paid or granted yet', async () => {
    const pageId = await aPageForPayments();
    const payment = await prisma.payment.create({
      data: { pageId, plan: 'MONTHLY', amountCents: 3900, billplzCollectionId: 'col-test' },
      select: { status: true, paidAt: true, grantedUntil: true, billplzBillId: true },
    });

    expect(payment).toEqual({ status: 'PENDING', paidAt: null, grantedUntil: null, billplzBillId: null });
  });

  it('refuses a second payment carrying the same Billplz bill id', async () => {
    // The unique index is what lets one bill grant exactly once.
    const pageId = await aPageForPayments();
    const billplzBillId = `bill-${randomUUID()}`;
    const data = { pageId, plan: 'MONTHLY' as const, amountCents: 3900, billplzCollectionId: 'col-test', billplzBillId };
    await prisma.payment.create({ data });

    await expect(prisma.payment.create({ data })).rejects.toMatchObject({ code: 'P2002' });
  });

  it('allows any number of payments that never got a bill id', async () => {
    // A failed call to Billplz leaves a pending row with no bill id. Several of
    // those must not collide on the unique index.
    const pageId = await aPageForPayments();
    const data = { pageId, plan: 'ANNUAL' as const, amountCents: 39000, billplzCollectionId: 'col-test' };
    await prisma.payment.create({ data });

    await expect(prisma.payment.create({ data })).resolves.toBeTruthy();
  });

  it('will not delete a page that has a payment', async () => {
    // Restrict, where every other table cascades: a payment is a financial
    // record and must not vanish as a side effect of removing a page.
    const pageId = await aPageForPayments();
    await prisma.payment.create({
      data: { pageId, plan: 'MONTHLY', amountCents: 3900, billplzCollectionId: 'col-test' },
    });

    await expect(prisma.page.delete({ where: { id: pageId } })).rejects.toMatchObject({ code: 'P2003' });
  });
```

At the very end of the file, after every `describe`, add the helper:

```ts
async function aPageForPayments(): Promise<string> {
  const skeleton = `pay-${randomUUID().slice(0, 8)}`;
  const account = await prisma.account.create({
    data: {
      email: `payments-${randomUUID()}@example.com`,
      pages: { create: { handle: skeleton, skeleton, displayName: 'Nadia Bakes' } },
    },
    select: { pages: { select: { id: true } } },
  });
  return account.pages[0]?.id ?? '';
}
```

`randomUUID` and `prisma` are already imported and defined at the top of this file.

- [ ] **Step 2: Run them and watch them fail**

Run: `cd packages/db && npx vitest run src/schema.test.ts`
Expected: the four new tests fail — `prisma.payment` is undefined — and every existing test still passes.

- [ ] **Step 3: Change the schema**

In `packages/db/prisma/schema.prisma`, directly after the closing `}` of `enum AuthTokenKind`, add:

```prisma
enum BillingPlan {
  MONTHLY
  ANNUAL
}

enum PaymentStatus {
  PENDING
  PAID
}
```

In `model Page`, after the line `questions     Question[]`, add:

```prisma
  payments      Payment[]
```

At the end of the file, add:

```prisma
model Payment {
  id                  String        @id @default(cuid())
  pageId              String
  /// Restrict, not Cascade like every other table here: a payment is a financial
  /// record, and it must not disappear as a side effect of removing a page.
  page                Page          @relation(fields: [pageId], references: [id], onDelete: Restrict)
  plan                BillingPlan
  /// What was billed, fixed at creation. A grant is checked against this -- never
  /// against today's price, which may have changed since the bill was raised.
  amountCents         Int
  /// Fixed at creation for the same reason, so a later change of collection cannot
  /// break the grant for a bill already issued.
  billplzCollectionId String
  /// Filled from Billplz's response. Unique, so one bill can never grant twice;
  /// nullable, because a failed call to Billplz leaves a pending row without one.
  billplzBillId       String?       @unique
  status              PaymentStatus @default(PENDING)
  paidAt              DateTime?
  /// The paidUntil this payment produced -- an audit trail for every extension.
  grantedUntil        DateTime?
  createdAt           DateTime      @default(now())

  // The hourly pending check scans by status and age.
  @@index([status, createdAt])
  // Plan 2's "recent payments" reads by page, newest first.
  @@index([pageId, createdAt])
}
```

- [ ] **Step 4: Generate the migration without applying it**

```bash
cd packages/db && DATABASE_URL="$(grep '^DATABASE_URL=' ../../.env | cut -d= -f2-)" npx prisma migrate dev --create-only --name billing_payments
```

`--create-only` is not optional. A plain `migrate dev` applies immediately and, on detecting drift, offers to **reset** — which drops the dev database. Never accept a reset prompt; if one appears, stop and report BLOCKED with its text.

Read the generated `migration.sql`. It must contain only: `CREATE TYPE "BillingPlan"`, `CREATE TYPE "PaymentStatus"`, `CREATE TABLE "Payment"`, a unique index on `billplzBillId`, the two indexes, and a foreign key to `"Page"` with `ON DELETE RESTRICT`. If it contains `DROP`, `TRUNCATE`, `ALTER TABLE "Page"`, or anything else touching an existing table, report BLOCKED with the SQL quoted.

- [ ] **Step 5: Apply to both databases**

```bash
cd packages/db
DATABASE_URL="$(grep '^DATABASE_URL=' ../../.env | cut -d= -f2-)" npx prisma migrate deploy
DATABASE_URL="$(grep '^DATABASE_URL_TEST=' ../../.env | cut -d= -f2-)" npx prisma migrate deploy
npx prisma generate
```

If the test database has been wiped by a container restart, the second command also needs the readonly role restored afterwards: `docker exec -i curios-postgres-test psql -U curios -d curios_test < prisma/sql/readonly-role.sql`.

- [ ] **Step 6: Run the tests and watch them pass**

Run: `cd packages/db && npx vitest run src/schema.test.ts`
Expected: every test passes, the four new ones included.

If the unique test reports a code other than `P2002`, or the delete test a code other than `P2003`, report the actual code rather than loosening the assertion — it means the constraint is not what this task assumes.

- [ ] **Step 7: Prove the Restrict test can fail**

Confirm the constraint on the test database, then break it and restore it:

```bash
docker exec curios-postgres-test psql -U curios -d curios_test -tAc "SELECT confdeltype FROM pg_constraint WHERE conname = 'Payment_pageId_fkey';"
```

Expected: `r` (restrict). Then:

```bash
docker exec curios-postgres-test psql -U curios -d curios_test -c 'ALTER TABLE "Payment" DROP CONSTRAINT "Payment_pageId_fkey"; ALTER TABLE "Payment" ADD CONSTRAINT "Payment_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;'
cd packages/db && npx vitest run src/schema.test.ts; echo "MUTATED EXIT: $?"
docker exec curios-postgres-test psql -U curios -d curios_test -c 'ALTER TABLE "Payment" DROP CONSTRAINT "Payment_pageId_fkey"; ALTER TABLE "Payment" ADD CONSTRAINT "Payment_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE RESTRICT ON UPDATE CASCADE;'
docker exec curios-postgres-test psql -U curios -d curios_test -tAc "SELECT confdeltype FROM pg_constraint WHERE conname = 'Payment_pageId_fkey';"
```

Expected: with CASCADE, only `'will not delete a page that has a payment'` fails; after restoring, `confdeltype` reads `r` again. Run the file once more and confirm everything passes.

- [ ] **Step 8: Package gates**

```bash
cd packages/db
npx tsc --noEmit; echo "TSC EXIT: $?"
npx eslint src/schema.test.ts; echo "LINT EXIT: $?"
```

- [ ] **Step 9: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations packages/db/src/schema.test.ts
git commit -m "feat(db): a Payment table that keeps its rows when a page goes"
```

---
### Task 3: The billing package, and the signature

**Files:**
- Create: `packages/billing/package.json`
- Create: `packages/billing/tsconfig.json`
- Create: `packages/billing/vitest.config.ts`
- Create: `packages/billing/src/signature.ts`
- Create: `packages/billing/src/signature.test.ts`
- Create: `packages/billing/src/index.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (from `@curios/billing`):
  - `signatureSource(params: Record<string, string>): string`
  - `signBillplz(params: Record<string, string>, key: string): string` — lowercase hex
  - `verifyBillplzSignature(params: Record<string, string>, key: string): boolean`
  - `flattenRedirectParams(query: Record<string, string>): Record<string, string>`

- [ ] **Step 1: Scaffold the package**

Create `packages/billing/package.json`:

```json
{
  "name": "@curios/billing",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "lint": "eslint .", "typecheck": "tsc --noEmit", "test": "vitest run" },
  "dependencies": { "@curios/core": "workspace:*", "@curios/db": "workspace:*" },
  "devDependencies": { "typescript": "^5.7.3", "vitest": "^2.1.8" }
}
```

Create `packages/billing/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "./src", "noEmit": true },
  "include": ["src/**/*"]
}
```

Create `packages/billing/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['../../vitest.setup.ts'],
    // grant.test.ts (Task 5) truncates the shared "Account" table. Files in one
    // package run in parallel by default, and two truncating the same table race.
    fileParallelism: false,
  },
});
```

Create `packages/billing/src/index.ts`:

```ts
export {
  flattenRedirectParams,
  signatureSource,
  signBillplz,
  verifyBillplzSignature,
} from './signature.js';
```

Then, from the repo root:

```bash
pnpm install
```

Expected: `@curios/billing` is linked into the workspace, with no dependency added from the registry.

- [ ] **Step 2: Write the failing test**

Create `packages/billing/src/signature.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  flattenRedirectParams,
  signatureSource,
  verifyBillplzSignature,
} from './signature.js';

/**
 * Every signature below was computed with OpenSSL 3.2.3, outside this code:
 *
 *   printf '%s' '<source string>' | openssl dgst -sha256 -hmac 'S-test-signing-key-not-a-real-secret'
 *
 * So these prove the code builds the construction Billplz's docs describe. They
 * cannot prove Billplz signs that way -- the docs' own example hides its email and
 * never states its key. Only the sandbox round trip in the walkthrough proves that.
 */
const KEY = 'S-test-signing-key-not-a-real-secret';

const callback: Record<string, string> = {
  id: 'zq0tm2wc',
  collection_id: 'yhx5t1pp',
  paid: 'true',
  state: 'paid',
  amount: '3900',
  paid_amount: '3900',
  due_at: '2026-9-14',
  email: 'owner@example.com',
  mobile: '',
  name: 'Nadia Bakes',
  url: 'https://www.billplz-sandbox.com/bills/zq0tm2wc',
  paid_at: '2026-09-14 15:15:09 +0800',
};

const CALLBACK_SOURCE =
  'amount3900|collection_idyhx5t1pp|due_at2026-9-14|emailowner@example.com|idzq0tm2wc|mobile|nameNadia Bakes|paid_amount3900|paid_at2026-09-14 15:15:09 +0800|paidtrue|statepaid|urlhttps://www.billplz-sandbox.com/bills/zq0tm2wc';
const CALLBACK_SIGNATURE = '97d9f80f609867b9392b9a0b2a8d6e20d36130d2ccd9f877c64b6b0758d3e9b9';
const WITH_TRANSACTION_SIGNATURE =
  'd4cc3508d10e6aadc7acd9009a8fcc2c156875e883070d713d6e996c28cd25e5';
const REDIRECT_SOURCE =
  'billplzidzq0tm2wc|billplzpaid_at2026-09-14 15:15:09 +0800|billplzpaidtrue';
const REDIRECT_SIGNATURE = 'c83bf46ae199744df89608daab62739a8b3157f99d73ee3d60dcbfd5b8b2e681';

describe('signatureSource', () => {
  it('sorts the joined pairs, not the keys, as the docs example does', () => {
    // Sorting by key would put `paidtrue` before `paid_amount3900`. Sorting the
    // joined strings puts `_` (0x5F) before `t` (0x74), which is the docs' order.
    expect(signatureSource(callback)).toBe(CALLBACK_SOURCE);
  });

  it('leaves the signature itself out', () => {
    expect(signatureSource({ ...callback, x_signature: 'anything' })).toBe(CALLBACK_SOURCE);
  });
});

describe('verifyBillplzSignature', () => {
  it('accepts a correctly signed callback', () => {
    expect(verifyBillplzSignature({ ...callback, x_signature: CALLBACK_SIGNATURE }, KEY)).toBe(true);
  });

  it('signs transaction fields when they arrive, rather than a fixed list', () => {
    const withTransaction = {
      ...callback,
      transaction_id: 'AC4GC031F42H',
      transaction_status: 'completed',
      x_signature: WITH_TRANSACTION_SIGNATURE,
    };
    expect(verifyBillplzSignature(withTransaction, KEY)).toBe(true);
  });

  it('refuses a tampered amount', () => {
    expect(
      verifyBillplzSignature({ ...callback, paid_amount: '100', x_signature: CALLBACK_SIGNATURE }, KEY),
    ).toBe(false);
  });

  it('refuses a callback with no signature', () => {
    expect(verifyBillplzSignature(callback, KEY)).toBe(false);
  });

  it('refuses a signature of the wrong length without throwing', () => {
    expect(verifyBillplzSignature({ ...callback, x_signature: 'abc' }, KEY)).toBe(false);
  });

  it('refuses when there is no key to check against', () => {
    expect(verifyBillplzSignature({ ...callback, x_signature: CALLBACK_SIGNATURE }, '')).toBe(false);
  });
});

describe('flattenRedirectParams', () => {
  const redirect = {
    'billplz[id]': 'zq0tm2wc',
    'billplz[paid]': 'true',
    'billplz[paid_at]': '2026-09-14 15:15:09 +0800',
    'billplz[x_signature]': REDIRECT_SIGNATURE,
  };

  it('keys the redirect the way its signature is computed, brackets dropped', () => {
    expect(signatureSource(flattenRedirectParams(redirect))).toBe(REDIRECT_SOURCE);
  });

  it('verifies a correctly signed redirect', () => {
    expect(verifyBillplzSignature(flattenRedirectParams(redirect), KEY)).toBe(true);
  });

  it('leaves out query parameters that are not Billplz’s', () => {
    expect(flattenRedirectParams({ ...redirect, utm_source: 'mail' })).not.toHaveProperty('utm_source');
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `cd packages/billing && npx vitest run src/signature.test.ts`
Expected: the file fails to load — `./signature.js` does not exist.

- [ ] **Step 4: Implement**

Create `packages/billing/src/signature.ts`:

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Billplz's X Signature source string, as its API docs state it (checked 2026-09-14).
 *
 * Every parameter except `x_signature`; each key concatenated directly to its value;
 * the joined strings -- not the keys -- sorted ascending and case-insensitively;
 * joined with `|`. Built from whatever parameters arrived, never from a fixed list:
 * `transaction_id` and `transaction_status` appear only sometimes and are signed when
 * they do, so a fixed list would refuse every genuine payment that carries them.
 *
 * Case-insensitive means lowercased code points, as PHP's case-insensitive string
 * sort compares. Not `localeCompare`, whose collation of `_` against letters depends
 * on the ICU build it runs on.
 */
export function signatureSource(params: Record<string, string>): string {
  return Object.entries(params)
    .filter(([key]) => key !== 'x_signature')
    .map(([key, value]) => `${key}${value}`)
    .sort((a, b) => {
      const left = a.toLowerCase();
      const right = b.toLowerCase();
      return left < right ? -1 : left > right ? 1 : 0;
    })
    .join('|');
}

export function signBillplz(params: Record<string, string>, key: string): string {
  return createHmac('sha256', key).update(signatureSource(params)).digest('hex');
}

/**
 * Whether `params` were signed by the holder of `key`. False rather than throwing for
 * anything malformed: a missing signature, a missing key, a value of the wrong length.
 * A false here must always mean "do not grant" -- there is no path around it.
 */
export function verifyBillplzSignature(params: Record<string, string>, key: string): boolean {
  const received = params.x_signature;
  if (!received || !key) return false;

  const expected = Buffer.from(signBillplz(params, key), 'utf8');
  const actual = Buffer.from(received, 'utf8');
  // timingSafeEqual throws on unequal lengths, and a different length is simply wrong.
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * The redirect's parameters, keyed the way its signature is computed.
 *
 * Billplz sends them nested -- `billplz[id]` -- and the docs show the key hashed with
 * the prefix kept and the brackets dropped: `billplzid`. `billplz[x_signature]` carries
 * the signature itself. Anything not under `billplz[` is not Billplz's and is left out.
 */
export function flattenRedirectParams(query: Record<string, string>): Record<string, string> {
  const flat: Record<string, string> = {};
  for (const [key, value] of Object.entries(query)) {
    const match = /^billplz\[(.+)\]$/.exec(key);
    const name = match?.[1];
    if (!name) continue;
    flat[name === 'x_signature' ? 'x_signature' : `billplz${name}`] = value;
  }
  return flat;
}
```

- [ ] **Step 5: Run it and watch it pass**

Run: `cd packages/billing && npx vitest run src/signature.test.ts`
Expected: 11 passed.

- [ ] **Step 6: Prove the tests can fail**

Make each change, run the file, confirm the named tests fail, then restore:
1. Sort by key instead of by joined string: move `.sort(...)` before `.map(...)` and compare `a[0]` with `b[0]`. The two source-string tests and every accepting test fail.
2. Compare uppercased instead of lowercased strings. The same tests fail — uppercasing moves `_` after the letters.
3. Delete `actual.length === expected.length &&`. "refuses a signature of the wrong length without throwing" fails with a `RangeError`.

- [ ] **Step 7: Package gates**

```bash
cd packages/billing
npx tsc --noEmit; echo "TSC EXIT: $?"
npx eslint .; echo "LINT EXIT: $?"
```

- [ ] **Step 8: Commit**

```bash
git add packages/billing pnpm-lock.yaml
git commit -m "feat(billing): verify Billplz signatures over whatever arrived, against openssl vectors"
```

---
### Task 4: The Billplz client

**Files:**
- Create: `packages/billing/src/client.ts`
- Create: `packages/billing/src/client.test.ts`
- Modify: `packages/billing/src/index.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces (from `@curios/billing`):
  - `interface BillplzBill { id: string; collectionId: string; paid: boolean; state: string; amount: number; paidAmount: number; reference1: string | null; url: string }`
  - `interface CreateBillInput { collectionId: string; email: string; name: string; amountCents: number; description: string; callbackUrl: string; redirectUrl: string; reference1: string }`
  - `interface BillplzClient { createBill(input: CreateBillInput): Promise<BillplzBill>; getBill(id: string): Promise<BillplzBill> }`
  - `type FetchLike = (input: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<Response>`
  - `createBillplzClient(options: { apiKey: string; baseUrl: string; fetch?: FetchLike; timeoutMs?: number }): BillplzClient`
  - `class BillplzUnavailableError extends Error` — `statusCode = 502`, `code = 'BILLPLZ_UNAVAILABLE'`

- [ ] **Step 1: Write the failing test**

Create `packages/billing/src/client.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { BillplzUnavailableError, createBillplzClient, type FetchLike } from './client.js';

const billJson = {
  id: 'zq0tm2wc',
  collection_id: 'col-test',
  paid: false,
  state: 'due',
  amount: 3900,
  paid_amount: 0,
  reference_1_label: 'Payment',
  reference_1: 'pay-1',
  url: 'https://www.billplz-sandbox.com/bills/zq0tm2wc',
};

const input = {
  collectionId: 'col-test',
  email: 'owner@example.com',
  name: 'Nadia Bakes',
  amountCents: 3900,
  description: 'Curios Business, 1 month — Nadia Bakes',
  callbackUrl: 'https://api.example/billing/billplz/callback',
  redirectUrl: 'https://api.example/billing/billplz/return',
  reference1: 'pay-1',
};

function answering(status: number, body: unknown) {
  return vi.fn<FetchLike>(
    async () =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
  );
}

const clientWith = (send: FetchLike, timeoutMs?: number) =>
  createBillplzClient({ apiKey: 'secret-key', baseUrl: 'https://www.billplz-sandbox.com/', fetch: send, timeoutMs });

describe('createBill', () => {
  it('posts a form with basic auth and the amount in cents', async () => {
    const send = answering(200, billJson);

    const bill = await clientWith(send).createBill(input);

    const [url, init] = send.mock.calls[0] ?? [];
    expect(url).toBe('https://www.billplz-sandbox.com/api/v3/bills');
    expect(init?.method).toBe('POST');
    // The API key is the Basic-auth username; there is no password.
    expect(init?.headers.authorization).toBe(`Basic ${Buffer.from('secret-key:').toString('base64')}`);
    expect(Object.fromEntries(new URLSearchParams(init?.body))).toEqual({
      collection_id: 'col-test',
      email: 'owner@example.com',
      name: 'Nadia Bakes',
      amount: '3900',
      description: 'Curios Business, 1 month — Nadia Bakes',
      callback_url: 'https://api.example/billing/billplz/callback',
      redirect_url: 'https://api.example/billing/billplz/return',
      reference_1_label: 'Payment',
      reference_1: 'pay-1',
    });
    expect(bill).toEqual({
      id: 'zq0tm2wc',
      collectionId: 'col-test',
      paid: false,
      state: 'due',
      amount: 3900,
      paidAmount: 0,
      reference1: 'pay-1',
      url: 'https://www.billplz-sandbox.com/bills/zq0tm2wc',
    });
  });
});

describe('getBill', () => {
  it('fetches a bill by id and reads it into our shape', async () => {
    const send = answering(200, { ...billJson, paid: true, state: 'paid', paid_amount: 3900 });

    const bill = await clientWith(send).getBill('zq0tm2wc');

    const [url, init] = send.mock.calls[0] ?? [];
    expect(url).toBe('https://www.billplz-sandbox.com/api/v3/bills/zq0tm2wc');
    expect(init?.method).toBe('GET');
    expect(bill).toMatchObject({ paid: true, state: 'paid', paidAmount: 3900, reference1: 'pay-1' });
  });
});

describe('when Billplz misbehaves', () => {
  it('treats a network failure as Billplz being unavailable', async () => {
    const send = vi.fn<FetchLike>(async () => {
      throw new TypeError('fetch failed');
    });

    await expect(clientWith(send).getBill('zq0tm2wc')).rejects.toBeInstanceOf(BillplzUnavailableError);
  });

  it('treats a 5xx as Billplz being unavailable', async () => {
    await expect(clientWith(answering(503, {})).createBill(input)).rejects.toBeInstanceOf(
      BillplzUnavailableError,
    );
  });

  it('treats a 4xx as our own misconfiguration, not an outage to wait out', async () => {
    const attempt = clientWith(answering(401, { error: { message: 'Unauthorized' } })).createBill(input);

    await expect(attempt).rejects.toThrow(/refused POST \/api\/v3\/bills with 401/);
    await expect(attempt).rejects.not.toBeInstanceOf(BillplzUnavailableError);
  });

  it('refuses a bill in a shape it does not recognise', async () => {
    await expect(clientWith(answering(200, { id: 1 })).getBill('zq0tm2wc')).rejects.toThrow(
      /does not recognise/,
    );
  });

  it('gives up on a Billplz that never answers', async () => {
    const send = vi.fn<FetchLike>(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );

    await expect(clientWith(send, 20).getBill('zq0tm2wc')).rejects.toBeInstanceOf(BillplzUnavailableError);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd packages/billing && npx vitest run src/client.test.ts`
Expected: the file fails to load — `./client.js` does not exist.

- [ ] **Step 3: Implement**

Create `packages/billing/src/client.ts`:

```ts
export interface BillplzBill {
  id: string;
  collectionId: string;
  paid: boolean;
  state: string;
  amount: number;
  paidAmount: number;
  reference1: string | null;
  url: string;
}

export interface CreateBillInput {
  collectionId: string;
  email: string;
  name: string;
  amountCents: number;
  description: string;
  callbackUrl: string;
  redirectUrl: string;
  reference1: string;
}

export interface BillplzClient {
  createBill(input: CreateBillInput): Promise<BillplzBill>;
  getBill(id: string): Promise<BillplzBill>;
}

export type FetchLike = (
  input: string,
  init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<Response>;

/**
 * Billplz could not be reached, timed out, or answered 5xx -- an outage, worth an owner
 * trying again later. Deliberately NOT what a 4xx becomes: a refused request means our
 * key or our payload is wrong, and telling owners to retry a misconfiguration is the
 * mistake OAUTH_EXCHANGE_FAILED was kept off the error allow-list to avoid.
 */
export class BillplzUnavailableError extends Error {
  readonly statusCode = 502;
  readonly code = 'BILLPLZ_UNAVAILABLE';
  constructor(detail: string) {
    super(`Billplz is unavailable: ${detail}`);
    this.name = 'BillplzUnavailableError';
  }
}

export function createBillplzClient(options: {
  apiKey: string;
  baseUrl: string;
  fetch?: FetchLike;
  timeoutMs?: number;
}): BillplzClient {
  const send: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  // The API secret key is the Basic-auth username; Billplz takes no password.
  const authorization = `Basic ${Buffer.from(`${options.apiKey}:`).toString('base64')}`;
  const base = options.baseUrl.replace(/\/+$/, '');
  const timeoutMs = options.timeoutMs ?? 10_000;

  async function call(method: 'GET' | 'POST', path: string, form?: URLSearchParams): Promise<BillplzBill> {
    let response: Response;
    try {
      response = await send(`${base}${path}`, {
        method,
        headers: form
          ? { authorization, 'content-type': 'application/x-www-form-urlencoded' }
          : { authorization },
        body: form?.toString(),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new BillplzUnavailableError(String(error));
    }

    if (response.status >= 500) {
      throw new BillplzUnavailableError(`${method} ${path} answered ${response.status}`);
    }
    if (!response.ok) {
      throw new Error(`Billplz refused ${method} ${path} with ${response.status}: ${await response.text()}`);
    }
    const raw: unknown = await response.json();
    return toBill(raw);
  }

  return {
    createBill: (input) =>
      call(
        'POST',
        '/api/v3/bills',
        new URLSearchParams({
          collection_id: input.collectionId,
          email: input.email,
          name: input.name,
          amount: String(input.amountCents),
          description: input.description,
          callback_url: input.callbackUrl,
          redirect_url: input.redirectUrl,
          reference_1_label: 'Payment',
          reference_1: input.reference1,
        }),
      ),
    getBill: (id) => call('GET', `/api/v3/bills/${encodeURIComponent(id)}`),
  };
}

/**
 * Billplz's bill JSON, narrowed to what a grant needs. A shape we do not recognise
 * throws rather than guessing: a bill whose `paid` might be a string is not one to
 * grant paid time on.
 */
function toBill(raw: unknown): BillplzBill {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Billplz returned something that is not a bill');
  }
  const bill = raw as Record<string, unknown>;
  if (
    typeof bill.id !== 'string' ||
    typeof bill.collection_id !== 'string' ||
    typeof bill.paid !== 'boolean' ||
    typeof bill.state !== 'string' ||
    typeof bill.amount !== 'number' ||
    typeof bill.url !== 'string'
  ) {
    throw new Error('Billplz returned a bill in a shape this client does not recognise');
  }
  return {
    id: bill.id,
    collectionId: bill.collection_id,
    paid: bill.paid,
    state: bill.state,
    amount: bill.amount,
    paidAmount: typeof bill.paid_amount === 'number' ? bill.paid_amount : 0,
    reference1: typeof bill.reference_1 === 'string' ? bill.reference_1 : null,
    url: bill.url,
  };
}
```

Add to `packages/billing/src/index.ts`:

```ts
export { BillplzUnavailableError, createBillplzClient } from './client.js';
export type { BillplzBill, BillplzClient, CreateBillInput, FetchLike } from './client.js';
```

- [ ] **Step 4: Run it and watch it pass**

Run: `cd packages/billing && npx vitest run src/client.test.ts`
Expected: 7 passed.

- [ ] **Step 5: Prove the tests can fail**

Make each change, run the file, confirm the named test fails, then restore:
1. Replace both status checks with `if (!response.ok) throw new BillplzUnavailableError(String(response.status));` — "treats a 4xx as our own misconfiguration" fails.
2. Remove the `signal:` line — "gives up on a Billplz that never answers" fails on vitest's timeout.

- [ ] **Step 6: Package gates**

```bash
cd packages/billing
npx vitest run; echo "TEST EXIT: $?"
npx tsc --noEmit; echo "TSC EXIT: $?"
npx eslint .; echo "LINT EXIT: $?"
```

- [ ] **Step 7: Commit**

```bash
git add packages/billing/src/client.ts packages/billing/src/client.test.ts packages/billing/src/index.ts
git commit -m "feat(billing): a Billplz client that tells an outage from a misconfiguration"
```

---
### Task 5: The grant step

**Files:**
- Create: `packages/billing/src/grant.ts`
- Create: `packages/billing/src/grant.test.ts`
- Modify: `packages/billing/src/index.ts`

**Interfaces:**
- Consumes: `extendPaidUntil` (Task 1); `prisma.payment` and `Page.paidUntil` (Task 2); `BillplzBill` (Task 4).
- Produces (from `@curios/billing`):
  - `interface BillEvidence { billId: string; collectionId: string; paid: boolean; state: string; paidAmount: number; reference1?: string | null }`
  - `type GrantOutcome = { kind: 'granted'; paidUntil: Date } | { kind: 'already-granted' } | { kind: 'not-paid' } | { kind: 'unknown-bill' } | { kind: 'mismatch'; reason: 'collection' | 'amount' | 'reference' }`
  - `evidenceFromCallback(params: Record<string, string>): BillEvidence`
  - `evidenceFromBill(bill: BillplzBill): BillEvidence`
  - `grantPayment(prisma: PrismaClient, evidence: BillEvidence, options: { now: Date; afterRead?: () => Promise<void> }): Promise<GrantOutcome>`

- [ ] **Step 1: Write the failing test**

Create `packages/billing/src/grant.test.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { extendPaidUntil } from '@curios/core';
import { PrismaClient } from '@curios/db';
import { evidenceFromBill, evidenceFromCallback, grantPayment, type BillEvidence } from './grant.js';

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });

const NOW = new Date('2026-09-14T08:00:00.000Z');
const ONE_MONTH = extendPaidUntil({ paidUntil: null, now: NOW, plan: 'MONTHLY' });

beforeEach(async () => {
  // Reaches Payment too: TRUNCATE ... CASCADE follows the foreign keys regardless of
  // their ON DELETE rule, so Restrict does not stop it.
  await prisma.$executeRawUnsafe('TRUNCATE "Account" CASCADE');
});

async function aPage(paidUntil: Date | null = null): Promise<string> {
  const skeleton = `grant-${randomUUID().slice(0, 8)}`;
  const account = await prisma.account.create({
    data: {
      email: `grant-${randomUUID()}@example.com`,
      pages: { create: { handle: skeleton, skeleton, displayName: 'Nadia Bakes', paidUntil } },
    },
    select: { pages: { select: { id: true } } },
  });
  return account.pages[0]?.id ?? '';
}

async function aPendingPayment(pageId: string, billId: string, plan: 'MONTHLY' | 'ANNUAL' = 'MONTHLY') {
  return prisma.payment.create({
    data: {
      pageId,
      plan,
      amountCents: plan === 'ANNUAL' ? 39000 : 3900,
      billplzCollectionId: 'col-test',
      billplzBillId: billId,
    },
    select: { id: true },
  });
}

function paid(billId: string, overrides: Partial<BillEvidence> = {}): BillEvidence {
  return { billId, collectionId: 'col-test', paid: true, state: 'paid', paidAmount: 3900, ...overrides };
}

const pageRow = (id: string) =>
  prisma.page.findUniqueOrThrow({ where: { id }, select: { paidUntil: true } });
const paymentRow = (id: string) =>
  prisma.payment.findUniqueOrThrow({
    where: { id },
    select: { status: true, paidAt: true, grantedUntil: true },
  });

describe('grantPayment', () => {
  it('grants a paid bill: the payment is paid and paidUntil moves a month from now', async () => {
    const pageId = await aPage();
    const payment = await aPendingPayment(pageId, 'bill-1');

    const outcome = await grantPayment(prisma, paid('bill-1'), { now: NOW });

    expect(outcome).toEqual({ kind: 'granted', paidUntil: ONE_MONTH });
    expect((await pageRow(pageId)).paidUntil).toEqual(ONE_MONTH);
    expect(await paymentRow(payment.id)).toEqual({ status: 'PAID', paidAt: NOW, grantedUntil: ONE_MONTH });
  });

  it('stacks an annual payment on a paidUntil still in the future', async () => {
    const future = new Date('2026-10-01T00:00:00.000Z');
    const pageId = await aPage(future);
    await aPendingPayment(pageId, 'bill-1', 'ANNUAL');

    await grantPayment(prisma, paid('bill-1', { paidAmount: 39000 }), { now: NOW });

    expect((await pageRow(pageId)).paidUntil).toEqual(new Date('2027-10-01T00:00:00.000Z'));
  });

  it('does nothing for a bill that is not paid', async () => {
    const pageId = await aPage();
    const payment = await aPendingPayment(pageId, 'bill-1');

    const outcome = await grantPayment(prisma, paid('bill-1', { paid: false, state: 'due' }), { now: NOW });

    expect(outcome).toEqual({ kind: 'not-paid' });
    expect((await paymentRow(payment.id)).status).toBe('PENDING');
    expect((await pageRow(pageId)).paidUntil).toBeNull();
  });

  it('refuses a bill it never created', async () => {
    expect(await grantPayment(prisma, paid('bill-nobody-made'), { now: NOW })).toEqual({ kind: 'unknown-bill' });
  });

  it('refuses a bill from another collection', async () => {
    const pageId = await aPage();
    const payment = await aPendingPayment(pageId, 'bill-1');

    const outcome = await grantPayment(prisma, paid('bill-1', { collectionId: 'col-other' }), { now: NOW });

    expect(outcome).toEqual({ kind: 'mismatch', reason: 'collection' });
    expect((await paymentRow(payment.id)).status).toBe('PENDING');
    expect((await pageRow(pageId)).paidUntil).toBeNull();
  });

  it('refuses a paid amount that is not what was billed', async () => {
    // The invoice project's bug: a RM1 bill marking a RM5000 invoice paid.
    const pageId = await aPage();
    await aPendingPayment(pageId, 'bill-1');

    const outcome = await grantPayment(prisma, paid('bill-1', { paidAmount: 100 }), { now: NOW });

    expect(outcome).toEqual({ kind: 'mismatch', reason: 'amount' });
    expect((await pageRow(pageId)).paidUntil).toBeNull();
  });

  it('refuses a fetched bill whose reference is not this payment', async () => {
    const pageId = await aPage();
    await aPendingPayment(pageId, 'bill-1');

    const outcome = await grantPayment(prisma, paid('bill-1', { reference1: 'someone-else' }), { now: NOW });

    expect(outcome).toEqual({ kind: 'mismatch', reason: 'reference' });
  });

  it('accepts a fetched bill whose reference is this payment', async () => {
    const pageId = await aPage();
    const payment = await aPendingPayment(pageId, 'bill-1');

    const outcome = await grantPayment(prisma, paid('bill-1', { reference1: payment.id }), { now: NOW });

    expect(outcome.kind).toBe('granted');
  });

  it('grants once when the same bill arrives twice', async () => {
    const pageId = await aPage();
    await aPendingPayment(pageId, 'bill-1');

    await grantPayment(prisma, paid('bill-1'), { now: NOW });
    const second = await grantPayment(prisma, paid('bill-1'), { now: NOW });

    expect(second).toEqual({ kind: 'already-granted' });
    expect((await pageRow(pageId)).paidUntil).toEqual(ONE_MONTH);
  });

  it('grants once when the same bill arrives twice at once', async () => {
    // The callback and the redirect racing each other for one bill.
    const pageId = await aPage();
    await aPendingPayment(pageId, 'bill-1');

    const outcomes = await Promise.all([
      grantPayment(prisma, paid('bill-1'), { now: NOW }),
      grantPayment(prisma, paid('bill-1'), { now: NOW }),
    ]);

    expect(outcomes.map((outcome) => outcome.kind).sort()).toEqual(['already-granted', 'granted']);
    expect((await pageRow(pageId)).paidUntil).toEqual(ONE_MONTH);
  });

  it('extends twice when two payments for one page land together', async () => {
    // Deterministic, not probabilistic. Payment A pauses between reading paidUntil and
    // writing it, and B starts during that pause. With the page lock, B waits on the
    // row and reads A's result. Without it, B reads the old paidUntil and one paid
    // month is lost -- on every run, not occasionally.
    const pageId = await aPage();
    await aPendingPayment(pageId, 'bill-a');
    await aPendingPayment(pageId, 'bill-b');

    let signalRead = () => {};
    const aHasRead = new Promise<void>((resolve) => {
      signalRead = resolve;
    });
    let release = () => {};
    const aMayWrite = new Promise<void>((resolve) => {
      release = resolve;
    });

    const grantA = grantPayment(prisma, paid('bill-a'), {
      now: NOW,
      afterRead: async () => {
        signalRead();
        await aMayWrite;
      },
    });
    await aHasRead;
    const grantB = grantPayment(prisma, paid('bill-b'), { now: NOW });
    // Long enough for B to finish outright if nothing makes it wait.
    await new Promise((resolve) => setTimeout(resolve, 500));
    release();
    await Promise.all([grantA, grantB]);

    expect((await pageRow(pageId)).paidUntil).toEqual(
      extendPaidUntil({ paidUntil: ONE_MONTH, now: NOW, plan: 'MONTHLY' }),
    );
  });
});

describe('evidenceFromCallback', () => {
  it('reads the callback’s strings, with no reference because it carries none', () => {
    const evidence = evidenceFromCallback({
      id: 'bill-1',
      collection_id: 'col-test',
      paid: 'true',
      state: 'paid',
      paid_amount: '3900',
      x_signature: 'ignored',
    });

    expect(evidence).toEqual({ billId: 'bill-1', collectionId: 'col-test', paid: true, state: 'paid', paidAmount: 3900 });
    expect(evidence).not.toHaveProperty('reference1');
  });

  it('treats a paid amount that is not whole cents as matching nothing', () => {
    expect(Number.isNaN(evidenceFromCallback({ paid_amount: '39.00' }).paidAmount)).toBe(true);
  });
});

describe('evidenceFromBill', () => {
  it('carries the reference a fetched bill has', () => {
    expect(
      evidenceFromBill({
        id: 'bill-1',
        collectionId: 'col-test',
        paid: true,
        state: 'paid',
        amount: 3900,
        paidAmount: 3900,
        reference1: 'pay-1',
        url: 'https://www.billplz-sandbox.com/bills/bill-1',
      }),
    ).toEqual({ billId: 'bill-1', collectionId: 'col-test', paid: true, state: 'paid', paidAmount: 3900, reference1: 'pay-1' });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd packages/billing && npx vitest run src/grant.test.ts`
Expected: the file fails to load — `./grant.js` does not exist.

- [ ] **Step 3: Implement**

Create `packages/billing/src/grant.ts`:

```ts
import { extendPaidUntil } from '@curios/core';
import type { PrismaClient } from '@curios/db';
import type { BillplzBill } from './client.js';

/**
 * A bill as a grant needs it, from one of two places: the callback's own fields, or a
 * bill fetched from Billplz by the redirect or the hourly check.
 */
export interface BillEvidence {
  billId: string;
  collectionId: string;
  paid: boolean;
  state: string;
  paidAmount: number;
  /** Only a fetched bill has one. The callback does not carry reference_1. */
  reference1?: string | null;
}

export type GrantOutcome =
  | { kind: 'granted'; paidUntil: Date }
  | { kind: 'already-granted' }
  | { kind: 'not-paid' }
  | { kind: 'unknown-bill' }
  | { kind: 'mismatch'; reason: 'collection' | 'amount' | 'reference' };

export interface GrantOptions {
  now: Date;
  /**
   * Test-only. Runs inside the transaction, after paidUntil has been read under the
   * lock and before it is written, so a test can hold that window open and prove the
   * lock is what stops a second payment reading a stale paidUntil.
   */
  afterRead?: () => Promise<void>;
}

export function evidenceFromCallback(params: Record<string, string>): BillEvidence {
  const paidAmount = params.paid_amount ?? '';
  return {
    billId: params.id ?? '',
    collectionId: params.collection_id ?? '',
    paid: params.paid === 'true',
    state: params.state ?? '',
    // Whole cents only. Anything else -- "39.00", "" -- matches no stored amount.
    paidAmount: /^\d+$/.test(paidAmount) ? Number(paidAmount) : Number.NaN,
  };
}

export function evidenceFromBill(bill: BillplzBill): BillEvidence {
  return {
    billId: bill.id,
    collectionId: bill.collectionId,
    paid: bill.paid,
    state: bill.state,
    paidAmount: bill.paidAmount,
    reference1: bill.reference1,
  };
}

/**
 * The one step that turns a paid bill into paid time. The callback, the redirect and
 * the hourly check all come here, and nothing else writes Page.paidUntil.
 *
 * Binding first: the bill must be one we created, found by its unique id; in the
 * collection and for the amount we stored; and -- when it was fetched, and so carries
 * a reference -- referencing this payment. Then one transaction. The payment is claimed
 * with a conditional update, so a second arrival of the same bill changes nothing. The
 * page row is locked, so a second payment for the same page waits and reads this one's
 * result instead of the old paidUntil. Then extend, and write.
 */
export async function grantPayment(
  prisma: PrismaClient,
  evidence: BillEvidence,
  options: GrantOptions,
): Promise<GrantOutcome> {
  if (!evidence.paid || evidence.state !== 'paid') return { kind: 'not-paid' };

  const payment = await prisma.payment.findUnique({
    where: { billplzBillId: evidence.billId },
    select: {
      id: true,
      pageId: true,
      plan: true,
      amountCents: true,
      billplzCollectionId: true,
      status: true,
    },
  });
  if (!payment) return { kind: 'unknown-bill' };
  if (payment.billplzCollectionId !== evidence.collectionId) return { kind: 'mismatch', reason: 'collection' };
  if (payment.amountCents !== evidence.paidAmount) return { kind: 'mismatch', reason: 'amount' };
  if (evidence.reference1 !== undefined && evidence.reference1 !== payment.id) {
    return { kind: 'mismatch', reason: 'reference' };
  }
  if (payment.status === 'PAID') return { kind: 'already-granted' };

  return prisma.$transaction(async (tx): Promise<GrantOutcome> => {
    const claimed = await tx.payment.updateMany({
      where: { id: payment.id, status: 'PENDING' },
      data: { status: 'PAID', paidAt: options.now },
    });
    if (claimed.count === 0) return { kind: 'already-granted' };

    const rows = await tx.$queryRaw<{ paidUntil: Date | null }[]>`
      SELECT "paidUntil" FROM "Page" WHERE "id" = ${payment.pageId} FOR UPDATE
    `;
    const current = rows[0]?.paidUntil ?? null;
    if (options.afterRead) await options.afterRead();

    const paidUntil = extendPaidUntil({ paidUntil: current, now: options.now, plan: payment.plan });
    await tx.page.update({ where: { id: payment.pageId }, data: { paidUntil } });
    await tx.payment.update({ where: { id: payment.id }, data: { grantedUntil: paidUntil } });
    return { kind: 'granted', paidUntil };
  });
}
```

Add to `packages/billing/src/index.ts`:

```ts
export { evidenceFromBill, evidenceFromCallback, grantPayment } from './grant.js';
export type { BillEvidence, GrantOptions, GrantOutcome } from './grant.js';
```

- [ ] **Step 4: Run it and watch it pass**

Run: `cd packages/billing && npx vitest run src/grant.test.ts`
Expected: 14 passed.

- [ ] **Step 5: Prove the tests can fail**

Make each change, run the file, confirm the named test fails, then restore:
1. Delete `FOR UPDATE` from the query — "extends twice when two payments for one page land together" fails, every run. Run it three times to confirm it is not intermittent.
2. Delete `status: 'PENDING'` from the claim's `where` — "grants once when the same bill arrives twice at once" fails.
3. Delete the collection check — "refuses a bill from another collection" fails.
4. Delete the reference check — "refuses a fetched bill whose reference is not this payment" fails.

If the race test passes with the lock removed, stop and report it: the test is not proving what it claims, and nothing after this task may rely on it.

- [ ] **Step 6: Package gates**

```bash
cd packages/billing
npx vitest run; echo "TEST EXIT: $?"
npx tsc --noEmit; echo "TSC EXIT: $?"
npx eslint .; echo "LINT EXIT: $?"
```

Expected: 32 passed across three files (11 signature, 7 client, 14 grant).

- [ ] **Step 7: Commit**

```bash
git add packages/billing/src/grant.ts packages/billing/src/grant.test.ts packages/billing/src/index.ts
git commit -m "feat(billing): one grant step, bound to its payment and locked on its page"
```

---
### Task 6: The API — raising a bill, the callback, the return

**Files:**
- Modify: `apps/api/package.json`
- Modify: `apps/api/src/plugins/errors.ts`
- Modify: `apps/api/src/plugins/rate-limit.ts`
- Create: `apps/api/src/modules/billing/billing.service.ts`
- Create: `apps/api/src/modules/billing/billing.routes.ts`
- Create: `apps/api/src/modules/billing/billing.routes.test.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/vitest.setup.ts`

**Interfaces:**
- Consumes: `PLAN_PRICES_CENTS`, `BillingPlan` (Task 1); `prisma.payment` (Task 2); `verifyBillplzSignature`, `signBillplz`, `flattenRedirectParams` (Task 3); `createBillplzClient`, `BillplzClient`, `BillplzBill`, `BillplzUnavailableError` (Task 4); `grantPayment`, `evidenceFromCallback`, `evidenceFromBill`, `GrantOutcome` (Task 5); `NoPageError` from `apps/api/src/modules/pages/page.service.ts`.
- Produces:
  - `POST /billing/bills` with `{ plan: 'MONTHLY' | 'ANNUAL' }` → `201 { url: string }`
  - `POST /billing/billplz/callback` → 400 or 200
  - `GET /billing/billplz/return` → 302 to `{APP_URL}/app/billing?payment=paid|pending|failed`
  - `AppOverrides.billing?: { client?: BillplzClient }`
  - Error codes `NOT_A_BUSINESS_PAGE` (400) and `BILLPLZ_UNAVAILABLE` (502)

- [ ] **Step 1: Add the dependency and pin the test env**

In `apps/api/package.json`, add to `dependencies`:

```json
    "@curios/billing": "workspace:*",
```

Run `pnpm install` from the repo root.

Append to `apps/api/vitest.setup.ts`:

```ts
// The Billplz settings buildApp() now requires at boot. Dummies: every test that
// reaches Billplz injects a stub client through AppOverrides, so none of these is
// ever sent anywhere. They exist so the boot check passes, and so a developer's own
// sandbox keys in .env never change what a test does.
process.env.BILLPLZ_API_KEY = 'test-billplz-api-key';
process.env.BILLPLZ_COLLECTION_ID = 'test-collection';
process.env.BILLPLZ_X_SIGNATURE_KEY = 'test-signature-key';
process.env.BILLPLZ_BASE_URL = 'https://billplz.invalid';
process.env.BILLPLZ_CALLBACK_URL = 'http://localhost:3001/billing/billplz/callback';
process.env.BILLPLZ_REDIRECT_URL = 'http://localhost:3001/billing/billplz/return';
process.env.RATE_LIMIT_BILLING_PER_ACCOUNT = '10';
```

- [ ] **Step 2: Write the failing test**

Create `apps/api/src/modules/billing/billing.routes.test.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  BillplzUnavailableError,
  flattenRedirectParams,
  signBillplz,
  type BillplzBill,
  type BillplzClient,
} from '@curios/billing';
import { buildApp } from '../../app.js';
import { createSession, SESSION_COOKIE } from '../auth/session.service.js';

// Both pinned in apps/api/vitest.setup.ts.
const KEY = 'test-signature-key';
const COLLECTION = 'test-collection';

const client = {
  createBill: vi.fn<BillplzClient['createBill']>(),
  getBill: vi.fn<BillplzClient['getBill']>(),
};

let app: FastifyInstance;

let nth = 0;
/** A fresh source address per request, so no limiter sees a flood. */
const from = () => `203.0.115.${(nth++ % 200) + 1}`;

beforeAll(async () => {
  app = await buildApp({ billing: { client } });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  client.createBill.mockReset();
  client.getBill.mockReset();
  client.createBill.mockImplementation(async (input) => ({
    id: `bill-${randomUUID()}`,
    collectionId: input.collectionId,
    paid: false,
    state: 'due',
    amount: input.amountCents,
    paidAmount: 0,
    reference1: input.reference1,
    url: 'https://www.billplz-sandbox.com/bills/stub',
  }));
});

async function anOwner(mode: 'BUSINESS' | 'PERSONAL' = 'BUSINESS') {
  const slug = randomUUID().slice(0, 8);
  const account = await app.prisma.account.create({
    data: {
      email: `billing-${randomUUID()}@example.com`,
      pages: { create: { handle: `bl-${slug}`, skeleton: `bl-${slug}`, displayName: 'Nadia Bakes', mode } },
    },
    select: { id: true, email: true, pages: { select: { id: true } } },
  });
  const { value } = await createSession(app.prisma, account.id);
  return { cookie: value, email: account.email, pageId: account.pages[0]?.id ?? '' };
}

async function aPendingPayment(pageId: string) {
  const billId = `bill-${randomUUID()}`;
  const payment = await app.prisma.payment.create({
    data: { pageId, plan: 'MONTHLY', amountCents: 3900, billplzCollectionId: COLLECTION, billplzBillId: billId },
    select: { id: true },
  });
  return { billId, paymentId: payment.id };
}

function callbackBody(billId: string, overrides: Record<string, string> = {}, signature?: string) {
  const params: Record<string, string> = {
    id: billId,
    collection_id: COLLECTION,
    paid: 'true',
    state: 'paid',
    amount: '3900',
    paid_amount: '3900',
    due_at: '2026-9-14',
    email: 'payer@example.com',
    mobile: '',
    name: 'Nadia Bakes',
    url: `https://www.billplz-sandbox.com/bills/${billId}`,
    paid_at: '2026-09-14 15:15:09 +0800',
    ...overrides,
  };
  return new URLSearchParams({ ...params, x_signature: signature ?? signBillplz(params, KEY) }).toString();
}

function returnUrl(billId: string, paid: 'true' | 'false', signature?: string) {
  const query: Record<string, string> = {
    'billplz[id]': billId,
    'billplz[paid]': paid,
    'billplz[paid_at]': '2026-09-14 15:15:09 +0800',
  };
  const signed = { ...query, 'billplz[x_signature]': signature ?? signBillplz(flattenRedirectParams(query), KEY) };
  return `/billing/billplz/return?${new URLSearchParams(signed).toString()}`;
}

function paidBill(billId: string, paymentId: string): BillplzBill {
  return {
    id: billId,
    collectionId: COLLECTION,
    paid: true,
    state: 'paid',
    amount: 3900,
    paidAmount: 3900,
    reference1: paymentId,
    url: `https://www.billplz-sandbox.com/bills/${billId}`,
  };
}

const postCallback = (payload: string) =>
  app.inject({
    method: 'POST',
    url: '/billing/billplz/callback',
    remoteAddress: from(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload,
  });

const paidUntilOf = async (pageId: string) =>
  (await app.prisma.page.findUniqueOrThrow({ where: { id: pageId }, select: { paidUntil: true } })).paidUntil;
const statusOf = async (paymentId: string) =>
  (await app.prisma.payment.findUniqueOrThrow({ where: { id: paymentId }, select: { status: true } })).status;

describe('POST /billing/bills', () => {
  const raise = (cookie: string | undefined, plan = 'MONTHLY') =>
    app.inject({
      method: 'POST',
      url: '/billing/bills',
      remoteAddress: from(),
      cookies: cookie ? { [SESSION_COOKIE]: cookie } : {},
      payload: { plan },
    });

  it('refuses a caller with no session', async () => {
    expect((await raise(undefined)).statusCode).toBe(401);
  });

  it("raises a bill for the owner's page, bound to a new pending payment", async () => {
    const owner = await anOwner();

    const res = await raise(owner.cookie);

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ url: 'https://www.billplz-sandbox.com/bills/stub' });
    const payment = await app.prisma.payment.findFirstOrThrow({
      where: { pageId: owner.pageId },
      select: { id: true, status: true, amountCents: true, billplzCollectionId: true, billplzBillId: true },
    });
    expect(payment).toMatchObject({ status: 'PENDING', amountCents: 3900, billplzCollectionId: COLLECTION });
    expect(payment.billplzBillId).toMatch(/^bill-/);
    expect(client.createBill).toHaveBeenCalledWith({
      collectionId: COLLECTION,
      email: owner.email,
      name: 'Nadia Bakes',
      amountCents: 3900,
      description: 'Curios Business, 1 month — Nadia Bakes',
      callbackUrl: 'http://localhost:3001/billing/billplz/callback',
      redirectUrl: 'http://localhost:3001/billing/billplz/return',
      reference1: payment.id,
    });
  });

  it('refuses a personal page, and raises no bill', async () => {
    const owner = await anOwner('PERSONAL');

    const res = await raise(owner.cookie);

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: 'NOT_A_BUSINESS_PAGE' } });
    expect(client.createBill).not.toHaveBeenCalled();
    expect(await app.prisma.payment.count({ where: { pageId: owner.pageId } })).toBe(0);
  });

  it('tells an owner with no page to claim a handle first', async () => {
    const account = await app.prisma.account.create({
      data: { email: `billing-nopage-${randomUUID()}@example.com` },
      select: { id: true },
    });
    const { value } = await createSession(app.prisma, account.id);

    const res = await raise(value);

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: { code: 'NO_PAGE' } });
  });

  it('reports Billplz being down by its own code, leaving a harmless pending row', async () => {
    const owner = await anOwner();
    client.createBill.mockRejectedValue(new BillplzUnavailableError('connect ECONNREFUSED'));

    const res = await raise(owner.cookie);

    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ error: { code: 'BILLPLZ_UNAVAILABLE' } });
    const payment = await app.prisma.payment.findFirstOrThrow({
      where: { pageId: owner.pageId },
      select: { billplzBillId: true, status: true },
    });
    expect(payment).toEqual({ billplzBillId: null, status: 'PENDING' });
  });
});

describe('POST /billing/billplz/callback', () => {
  it('grants a signed, paid callback sent as a form', async () => {
    // The path that would be a 415 without the form parser this task adds.
    const owner = await anOwner();
    const { billId, paymentId } = await aPendingPayment(owner.pageId);

    const res = await postCallback(callbackBody(billId));

    expect(res.statusCode).toBe(200);
    expect(await statusOf(paymentId)).toBe('PAID');
    expect(await paidUntilOf(owner.pageId)).not.toBeNull();
  });

  it('refuses a callback whose signature does not verify', async () => {
    const owner = await anOwner();
    const { billId, paymentId } = await aPendingPayment(owner.pageId);

    const res = await postCallback(callbackBody(billId, {}, 'f'.repeat(64)));

    expect(res.statusCode).toBe(400);
    expect(await statusOf(paymentId)).toBe('PENDING');
  });

  it('answers 200 to a signed callback for an unpaid bill, and grants nothing', async () => {
    const owner = await anOwner();
    const { billId, paymentId } = await aPendingPayment(owner.pageId);

    const res = await postCallback(callbackBody(billId, { paid: 'false', state: 'due', paid_amount: '0' }));

    expect(res.statusCode).toBe(200);
    expect(await statusOf(paymentId)).toBe('PENDING');
  });

  it('answers 200 to a signed callback whose amount does not match, and grants nothing', async () => {
    // Signed, so it came from Billplz -- and still refused, because it is not what we billed.
    const owner = await anOwner();
    const { billId, paymentId } = await aPendingPayment(owner.pageId);

    const res = await postCallback(callbackBody(billId, { paid_amount: '100' }));

    expect(res.statusCode).toBe(200);
    expect(await statusOf(paymentId)).toBe('PENDING');
    expect(await paidUntilOf(owner.pageId)).toBeNull();
  });
});

describe('GET /billing/billplz/return', () => {
  const visit = (url: string) => app.inject({ method: 'GET', url, remoteAddress: from() });

  it('fetches the bill, grants it, and sends the owner back to the paid banner', async () => {
    const owner = await anOwner();
    const { billId, paymentId } = await aPendingPayment(owner.pageId);
    client.getBill.mockResolvedValue(paidBill(billId, paymentId));

    const res = await visit(returnUrl(billId, 'true'));

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('http://localhost:3000/app/billing?payment=paid');
    expect(client.getBill).toHaveBeenCalledWith(billId);
    expect(await statusOf(paymentId)).toBe('PAID');
  });

  it('sends a signed but unpaid redirect to the failed banner, without fetching', async () => {
    const owner = await anOwner();
    const { billId } = await aPendingPayment(owner.pageId);

    const res = await visit(returnUrl(billId, 'false'));

    expect(res.headers.location).toBe('http://localhost:3000/app/billing?payment=failed');
    expect(client.getBill).not.toHaveBeenCalled();
  });

  it('sends a redirect whose signature does not verify to pending, without fetching', async () => {
    const owner = await anOwner();
    const { billId, paymentId } = await aPendingPayment(owner.pageId);

    const res = await visit(returnUrl(billId, 'true', 'f'.repeat(64)));

    expect(res.headers.location).toBe('http://localhost:3000/app/billing?payment=pending');
    expect(client.getBill).not.toHaveBeenCalled();
    expect(await statusOf(paymentId)).toBe('PENDING');
  });

  it('sends the owner to pending when the bill cannot be fetched', async () => {
    const owner = await anOwner();
    const { billId, paymentId } = await aPendingPayment(owner.pageId);
    client.getBill.mockRejectedValue(new BillplzUnavailableError('timeout'));

    const res = await visit(returnUrl(billId, 'true'));

    expect(res.headers.location).toBe('http://localhost:3000/app/billing?payment=pending');
    expect(await statusOf(paymentId)).toBe('PENDING');
  });
});
```

The `http://localhost:3000` in the redirect assertions is the same value `link.test.ts` and `oauth.routes.test.ts` already assert against: `APP_URL` from `.env`, defaulting to it.

- [ ] **Step 3: Run it and watch it fail**

Run: `cd apps/api && npx vitest run src/modules/billing/billing.routes.test.ts`
Expected: the file fails to load — `../../app.js` accepts no `billing` override yet, and the routes do not exist. Record the actual error.

- [ ] **Step 4: Allow-list the two codes**

In `apps/api/src/plugins/errors.ts`, directly after the entry `'IDENTITY_TAKEN',`, add:

```ts
  // Starting a payment on a personal page. It says what is true: there is nothing
  // to pay for.
  'NOT_A_BUSINESS_PAGE',
  // A 502, so the handler below still replaces its message with the generic sentence.
  // Listed so the code survives the trip -- the web app turns it into "Billplz is not
  // answering". Unlike OAUTH_EXCHANGE_FAILED, an outage is worth waiting out, and a
  // misconfiguration never becomes this code: the Billplz client throws a plain Error
  // for a 4xx, which stays INTERNAL_ERROR.
  'BILLPLZ_UNAVAILABLE',
```

- [ ] **Step 5: Add the per-account limiter**

At the end of `apps/api/src/plugins/rate-limit.ts`, add:

```ts
/**
 * Per account, on starting a payment. Every request raises a bill at Billplz, so an
 * owner or a runaway loop must not be able to raise them without bound.
 *
 * Keyed on the account, falling back to the caller and never to a constant -- the
 * shape and the reason of ingestPerPageLimit: a shared constant bucket fills once and
 * locks everyone out.
 */
export function billingPerAccountLimit(redis: IORedis): RateLimitPluginOptions {
  return {
    ...FAIL_CLOSED,
    global: true,
    redis,
    hook: 'preHandler',
    nameSpace: namespace('billing-account:'),
    max: limit('RATE_LIMIT_BILLING_PER_ACCOUNT', 10),
    timeWindow: '1 hour',
    keyGenerator: (request) => request.account?.id ?? caller(request),
    errorResponseBuilder: tooMany((after) => `Too many payment attempts. Try again in ${after}.`),
  };
}
```

- [ ] **Step 6: The service**

Create `apps/api/src/modules/billing/billing.service.ts`:

```ts
import { PLAN_PRICES_CENTS, type BillingPlan } from '@curios/core';
import type { PrismaClient } from '@curios/db';
import type { BillplzClient } from '@curios/billing';
import { NoPageError } from '../pages/page.service.js';

export interface BillingConfig {
  collectionId: string;
  callbackUrl: string;
  redirectUrl: string;
}

export class NotABusinessPageError extends Error {
  readonly statusCode = 400;
  readonly code = 'NOT_A_BUSINESS_PAGE';
  constructor() {
    super('Only business pages have a paid plan. Personal pages are free.');
    this.name = 'NotABusinessPageError';
  }
}

/** Billplz caps a description at 200 characters, and a long shop name must not fail the bill. */
export function billDescription(plan: BillingPlan, displayName: string): string {
  return `Curios Business, ${plan === 'ANNUAL' ? '1 year' : '1 month'} — ${displayName}`.slice(0, 200);
}

/**
 * Starts a payment for the signed-in owner's page.
 *
 * The Payment row is created before Billplz is called, so its id can be the bill's
 * reference_1 -- the field a fetched bill is later checked against. If Billplz fails,
 * that row stays PENDING with no bill id, which is harmless: no bill can ever match it,
 * and the hourly check skips rows without one.
 */
export async function createBillForOwner(
  deps: { prisma: PrismaClient; client: BillplzClient; config: BillingConfig },
  input: { accountId: string; plan: BillingPlan },
): Promise<{ url: string }> {
  const page = await deps.prisma.page.findUnique({
    where: { accountId: input.accountId },
    select: { id: true, mode: true, displayName: true, account: { select: { email: true } } },
  });
  if (!page) throw new NoPageError();
  if (page.mode !== 'BUSINESS') throw new NotABusinessPageError();

  const amountCents = PLAN_PRICES_CENTS[input.plan];
  const payment = await deps.prisma.payment.create({
    data: {
      pageId: page.id,
      plan: input.plan,
      amountCents,
      billplzCollectionId: deps.config.collectionId,
    },
    select: { id: true },
  });

  const bill = await deps.client.createBill({
    collectionId: deps.config.collectionId,
    email: page.account.email,
    // Billplz caps the name at 255 characters.
    name: page.displayName.slice(0, 255),
    amountCents,
    description: billDescription(input.plan, page.displayName),
    callbackUrl: deps.config.callbackUrl,
    redirectUrl: deps.config.redirectUrl,
    reference1: payment.id,
  });

  await deps.prisma.payment.update({ where: { id: payment.id }, data: { billplzBillId: bill.id } });
  return { url: bill.url };
}
```

- [ ] **Step 7: The routes**

Create `apps/api/src/modules/billing/billing.routes.ts`:

```ts
import type { FastifyBaseLogger } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  createBillplzClient,
  evidenceFromBill,
  evidenceFromCallback,
  flattenRedirectParams,
  grantPayment,
  verifyBillplzSignature,
  type BillplzClient,
  type GrantOutcome,
} from '@curios/billing';
import { UnauthenticatedError } from '../../plugins/session.js';
import { createBillForOwner } from './billing.service.js';

export interface BillingRouteOptions {
  /**
   * Injected only by tests, the way the chat routes take a stub model. Without it the
   * client is built from the environment at registration.
   */
  client?: BillplzClient;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/**
 * Every Billplz setting, read once at registration -- the moment the chat routes check
 * their model key, and for the same reason: a missing value fails the deploy, not an
 * owner's payment. A missing signature key in particular must never reach a request,
 * where it could only mean refusing every genuine payment.
 */
function billplzSettings(options: BillingRouteOptions) {
  const apiKey = required('BILLPLZ_API_KEY');
  const baseUrl = required('BILLPLZ_BASE_URL');
  return {
    client: options.client ?? createBillplzClient({ apiKey, baseUrl }),
    collectionId: required('BILLPLZ_COLLECTION_ID'),
    signatureKey: required('BILLPLZ_X_SIGNATURE_KEY'),
    callbackUrl: required('BILLPLZ_CALLBACK_URL'),
    redirectUrl: required('BILLPLZ_REDIRECT_URL'),
  };
}

const errorSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

/** Starting a payment. Registered behind a session and a per-account limit in app.ts. */
export const ownerBillingRoutes: FastifyPluginAsyncZod<BillingRouteOptions> = async (app, options) => {
  const billplz = billplzSettings(options);

  app.post(
    '/billing/bills',
    {
      schema: {
        body: z.object({ plan: z.enum(['MONTHLY', 'ANNUAL']) }),
        response: { 201: z.object({ url: z.string() }), 400: errorSchema, 404: errorSchema },
      },
    },
    async (request, reply) => {
      if (!request.account) throw new UnauthenticatedError();

      const result = await createBillForOwner(
        { prisma: app.prisma, client: billplz.client, config: billplz },
        { accountId: request.account.id, plan: request.body.plan },
      );
      return reply.status(201).send(result);
    },
  );
};

/**
 * The bill id and the outcome, and nothing else. Billplz's parameters carry the payer's
 * email and mobile, and logging them on the way past is how they end up somewhere they
 * were never meant to be.
 */
function logOutcome(
  log: FastifyBaseLogger,
  billId: string | undefined,
  source: 'callback' | 'redirect',
  outcome: GrantOutcome,
): void {
  const details = {
    billId,
    source,
    outcome: outcome.kind,
    ...(outcome.kind === 'mismatch' ? { reason: outcome.reason } : {}),
  };
  if (outcome.kind === 'mismatch' || outcome.kind === 'unknown-bill') {
    log.error(details, 'billplz bill refused');
  } else {
    log.info(details, 'billplz bill handled');
  }
}

/** Billplz's callback and redirect. No session, and no per-IP limit -- see app.ts. */
export const billplzRoutes: FastifyPluginAsyncZod<BillingRouteOptions> = async (app, options) => {
  const billplz = billplzSettings(options);

  // Billplz posts its callback form-encoded, and nothing else in this API accepts a
  // form. Added inside this plugin's own encapsulated scope, so no other route starts
  // to. URLSearchParams keeps every value exactly as sent, which is what the signature
  // was computed over.
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_request, body, done) => {
      done(null, Object.fromEntries(new URLSearchParams(String(body))));
    },
  );

  app.post(
    '/billing/billplz/callback',
    { schema: { body: z.record(z.string(), z.string()) } },
    async (request, reply) => {
      if (!verifyBillplzSignature(request.body, billplz.signatureKey)) {
        request.log.error({ billId: request.body.id, source: 'callback' }, 'billplz signature did not verify');
        return reply.status(400).send();
      }

      const outcome = await grantPayment(app.prisma, evidenceFromCallback(request.body), { now: new Date() });
      logOutcome(request.log, request.body.id, 'callback', outcome);
      // 200 for everything that verified. Billplz retries anything else, and no retry
      // can fix an unpaid bill or one that does not match what we billed.
      return reply.status(200).send({ status: outcome.kind });
    },
  );

  app.get(
    '/billing/billplz/return',
    { schema: { querystring: z.record(z.string(), z.string()) } },
    async (request, reply) => {
      const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
      const back = (payment: 'paid' | 'pending' | 'failed') =>
        reply.redirect(`${appUrl}/app/billing?payment=${payment}`);
      const billId = request.query['billplz[id]'];

      if (!verifyBillplzSignature(flattenRedirectParams(request.query), billplz.signatureKey)) {
        request.log.error({ billId, source: 'redirect' }, 'billplz signature did not verify');
        return back('pending');
      }
      if (request.query['billplz[paid]'] !== 'true') return back('failed');

      // The redirect carries no amount, collection or reference, so it cannot be bound
      // as it stands. One fetch of the bill supplies them -- the same call the hourly
      // check makes, once per payment, which is not polling.
      let outcome: GrantOutcome;
      try {
        const bill = await billplz.client.getBill(billId ?? '');
        outcome = await grantPayment(app.prisma, evidenceFromBill(bill), { now: new Date() });
      } catch (error) {
        request.log.error({ err: error, billId, source: 'redirect' }, 'billplz bill could not be confirmed');
        return back('pending');
      }

      logOutcome(request.log, billId, 'redirect', outcome);
      return back(outcome.kind === 'granted' || outcome.kind === 'already-granted' ? 'paid' : 'pending');
    },
  );
};
```

- [ ] **Step 8: Wire it into the app**

In `apps/api/src/app.ts`:

1. Add `billingPerAccountLimit` to the import from `./plugins/rate-limit.js`, after `authPerIpLimit`.
2. After the `questionRoutes` import, add:

```ts
import {
  billplzRoutes,
  ownerBillingRoutes,
  type BillingRouteOptions,
} from './modules/billing/billing.routes.js';
```

3. Add `billing?: BillingRouteOptions;` as the last member of `interface AppOverrides`.
4. Directly after the owner scope that ends with `await scope.register(ownerLeadRoutes);` and its closing `});`, add:

```ts
  // Billplz's callback and redirect. No session -- Billplz has none -- and no per-IP
  // limit: every genuine retry comes from Billplz's own addresses, and a forged request
  // costs one HMAC to refuse. The plugin registers its own form parser, and its
  // encapsulation keeps that parser off every other route.
  await app.register(billplzRoutes, overrides.billing ?? {});

  // Starting a payment. The session hook goes before the limiter, as in the ingest
  // scope, so an unauthenticated request is refused before it can spend any budget.
  await app.register(async (scope) => {
    scope.addHook('onRequest', requireSession);
    await scope.register(rateLimit, billingPerAccountLimit(app.rateLimitRedis));
    await scope.register(ownerBillingRoutes, overrides.billing ?? {});
  });
```

- [ ] **Step 9: Run it and watch it pass**

Run: `cd apps/api && npx vitest run src/modules/billing/billing.routes.test.ts`
Expected: 13 passed.

- [ ] **Step 10: Prove the tests can fail**

Make each change, run the file, confirm the named test fails, then restore:
1. Delete the `app.addContentTypeParser(...)` call — "grants a signed, paid callback sent as a form" fails with a 415.
2. In the callback, change `if (!verifyBillplzSignature(...))` to `if (false)` — "refuses a callback whose signature does not verify" fails.
3. In the return route, delete the signature check — "sends a redirect whose signature does not verify to pending" fails.
4. In `errors.ts`, delete `'BILLPLZ_UNAVAILABLE',` — "reports Billplz being down by its own code" fails with `INTERNAL_ERROR`.

- [ ] **Step 11: The whole API suite and gates**

```bash
cd apps/api
npx vitest run; echo "TEST EXIT: $?"
npx tsc --noEmit; echo "TSC EXIT: $?"
npx eslint src/modules/billing src/plugins/errors.ts src/plugins/rate-limit.ts src/app.ts vitest.setup.ts; echo "LINT EXIT: $?"
```

Expected: every existing test still passes — none of them sets Billplz values, so this proves the pins in `vitest.setup.ts` cover the new boot check — and all three exit 0.

- [ ] **Step 12: Commit**

```bash
git add apps/api/package.json pnpm-lock.yaml apps/api/src/modules/billing apps/api/src/plugins/errors.ts apps/api/src/plugins/rate-limit.ts apps/api/src/app.ts apps/api/vitest.setup.ts
git commit -m "feat(api): raise a Billplz bill, and grant it from a verified callback or redirect"
```

---
### Task 7: The hourly pending check

**Files:**
- Modify: `apps/workers/package.json`
- Modify: `apps/workers/src/queues.ts`
- Create: `apps/workers/src/billing/pending-check.ts`
- Create: `apps/workers/src/billing/pending-check.test.ts`
- Modify: `apps/workers/src/main.ts`

**Interfaces:**
- Consumes: `BILLING_QUEUE`, `PENDING_CHECK_JOB` (Task 1); `prisma.payment` (Task 2); `createBillplzClient`, `BillplzClient`, `BillplzBill` (Task 4); `grantPayment`, `evidenceFromBill` (Task 5).
- Produces:
  - `runPendingCheck(deps: { prisma: PrismaClient; client: BillplzClient; now: Date; log?: BillingLog }): Promise<{ checked: number; granted: number }>`
  - `createBillingWorker(deps: { connection: IORedis; prisma: PrismaClient; client: BillplzClient; log?: BillingLog }): Worker`
  - `scheduleBillingJobs(queue: SchedulerQueue): Promise<void>`
  - `PENDING_MIN_AGE_MS` (2 hours), `PENDING_MAX_AGE_MS` (7 days)

- [ ] **Step 1: Add the dependency**

In `apps/workers/package.json`, add to `dependencies`:

```json
    "@curios/billing": "workspace:*",
```

Run `pnpm install` from the repo root.

- [ ] **Step 2: Write the failing test**

Create `apps/workers/src/billing/pending-check.test.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { BillplzBill, BillplzClient } from '@curios/billing';
import {
  PENDING_MAX_AGE_MS,
  PENDING_MIN_AGE_MS,
  runPendingCheck,
  scheduleBillingJobs,
  type SchedulerQueue,
} from './pending-check.js';

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });

const NOW = new Date('2026-09-14T08:00:00.000Z');
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const ago = (ms: number) => new Date(NOW.getTime() - ms);

let pageId = '';

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE "Account" CASCADE');
  const skeleton = `pc-${randomUUID().slice(0, 8)}`;
  const account = await prisma.account.create({
    data: {
      email: `pending-${randomUUID()}@example.com`,
      pages: { create: { handle: skeleton, skeleton, displayName: 'Nadia Bakes' } },
    },
    select: { pages: { select: { id: true } } },
  });
  pageId = account.pages[0]?.id ?? '';
});

async function aPayment(createdAt: Date, options: { billId?: string | null; status?: 'PENDING' | 'PAID' } = {}) {
  const billId = options.billId === undefined ? `bill-${randomUUID()}` : options.billId;
  await prisma.payment.create({
    data: {
      pageId,
      plan: 'MONTHLY',
      amountCents: 3900,
      billplzCollectionId: 'col-test',
      billplzBillId: billId,
      status: options.status ?? 'PENDING',
      createdAt,
    },
  });
  return billId;
}

/** A Billplz that says every bill it is asked about has been paid, for exactly what was billed. */
function aPayingClient() {
  return {
    createBill: vi.fn<BillplzClient['createBill']>(),
    getBill: vi.fn<BillplzClient['getBill']>(async (id): Promise<BillplzBill> => {
      const payment = await prisma.payment.findUniqueOrThrow({ where: { billplzBillId: id }, select: { id: true } });
      return {
        id,
        collectionId: 'col-test',
        paid: true,
        state: 'paid',
        amount: 3900,
        paidAmount: 3900,
        reference1: payment.id,
        url: `https://www.billplz-sandbox.com/bills/${id}`,
      };
    }),
  };
}

describe('runPendingCheck', () => {
  it('grants a payment whose callbacks never arrived', async () => {
    await aPayment(ago(3 * HOUR_MS));
    const client = aPayingClient();

    const result = await runPendingCheck({ prisma, client, now: NOW });

    expect(result).toEqual({ checked: 1, granted: 1 });
    const page = await prisma.page.findUniqueOrThrow({ where: { id: pageId }, select: { paidUntil: true } });
    expect(page.paidUntil).not.toBeNull();
  });

  it('checks a payment exactly two hours old', async () => {
    await aPayment(ago(PENDING_MIN_AGE_MS));
    const client = aPayingClient();

    await runPendingCheck({ prisma, client, now: NOW });

    expect(client.getBill).toHaveBeenCalledTimes(1);
  });

  it('leaves a payment a minute younger than that to its callback', async () => {
    await aPayment(ago(PENDING_MIN_AGE_MS - MINUTE_MS));
    const client = aPayingClient();

    expect(await runPendingCheck({ prisma, client, now: NOW })).toEqual({ checked: 0, granted: 0 });
    expect(client.getBill).not.toHaveBeenCalled();
  });

  it('still checks a payment exactly seven days old', async () => {
    await aPayment(ago(PENDING_MAX_AGE_MS));
    const client = aPayingClient();

    await runPendingCheck({ prisma, client, now: NOW });

    expect(client.getBill).toHaveBeenCalledTimes(1);
  });

  it('stops checking a payment a minute older than that', async () => {
    await aPayment(ago(PENDING_MAX_AGE_MS + MINUTE_MS));
    const client = aPayingClient();

    await runPendingCheck({ prisma, client, now: NOW });

    expect(client.getBill).not.toHaveBeenCalled();
  });

  it('skips a payment that never got a bill id', async () => {
    await aPayment(ago(3 * HOUR_MS), { billId: null });
    const client = aPayingClient();

    await runPendingCheck({ prisma, client, now: NOW });

    expect(client.getBill).not.toHaveBeenCalled();
  });

  it('never asks about a payment already paid', async () => {
    await aPayment(ago(3 * HOUR_MS), { status: 'PAID' });
    const client = aPayingClient();

    await runPendingCheck({ prisma, client, now: NOW });

    expect(client.getBill).not.toHaveBeenCalled();
  });

  it('keeps going when one bill cannot be fetched', async () => {
    // Oldest first: the four-hour-old payment is asked about first, and fails.
    await aPayment(ago(4 * HOUR_MS));
    await aPayment(ago(3 * HOUR_MS));
    const client = aPayingClient();
    client.getBill.mockRejectedValueOnce(new Error('Billplz unreachable'));

    expect(await runPendingCheck({ prisma, client, now: NOW })).toEqual({ checked: 2, granted: 1 });
  });
});

describe('scheduleBillingJobs', () => {
  it('schedules the pending check hourly, under a fixed id', async () => {
    const queue = { upsertJobScheduler: vi.fn<SchedulerQueue['upsertJobScheduler']>(async () => ({})) };

    await scheduleBillingJobs(queue);

    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      'pending-check',
      { pattern: '0 * * * *' },
      { name: 'pending-check' },
    );
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `cd apps/workers && npx vitest run src/billing/pending-check.test.ts`
Expected: the file fails to load — `./pending-check.js` does not exist.

- [ ] **Step 4: Implement**

In `apps/workers/src/queues.ts`, change the export to:

```ts
export const QUEUE_CONCURRENCY = { ingest: 2, mail: 5, billing: 1 } as const;
```

Create `apps/workers/src/billing/pending-check.ts`:

```ts
import { Worker } from 'bullmq';
import type IORedis from 'ioredis';
import { BILLING_QUEUE, PENDING_CHECK_JOB } from '@curios/core';
import type { PrismaClient } from '@curios/db';
import { evidenceFromBill, grantPayment, type BillplzClient } from '@curios/billing';
import { QUEUE_CONCURRENCY } from '../queues.js';

const HOUR_MS = 60 * 60 * 1000;

/** Younger than this, the callback may simply not have arrived yet. */
export const PENDING_MIN_AGE_MS = 2 * HOUR_MS;

/**
 * Older than this, the payment is left alone. An unpaid bill ages out by itself, and a
 * callback dropped after Billplz's fifth attempt -- about 24 hours after the first -- is
 * still well inside the window.
 */
export const PENDING_MAX_AGE_MS = 7 * 24 * HOUR_MS;

export interface BillingLog {
  info: (details: object, message: string) => void;
  error: (details: object, message: string) => void;
}

export interface SchedulerQueue {
  upsertJobScheduler(id: string, repeat: { pattern: string }, template: { name: string }): Promise<unknown>;
}

/**
 * Asks Billplz about payments still pending, and grants the ones it says were paid.
 *
 * This exists because of the fifth attempt. If every callback fails -- the API down for
 * a day -- Billplz stops, and without this an owner who has paid never gets it.
 */
export async function runPendingCheck(deps: {
  prisma: PrismaClient;
  client: BillplzClient;
  now: Date;
  log?: BillingLog;
}): Promise<{ checked: number; granted: number }> {
  const stale = await deps.prisma.payment.findMany({
    where: {
      status: 'PENDING',
      billplzBillId: { not: null },
      createdAt: {
        gte: new Date(deps.now.getTime() - PENDING_MAX_AGE_MS),
        lte: new Date(deps.now.getTime() - PENDING_MIN_AGE_MS),
      },
    },
    select: { billplzBillId: true },
    orderBy: { createdAt: 'asc' },
  });

  let granted = 0;
  for (const { billplzBillId } of stale) {
    if (!billplzBillId) continue;
    try {
      const bill = await deps.client.getBill(billplzBillId);
      const outcome = await grantPayment(deps.prisma, evidenceFromBill(bill), { now: deps.now });
      if (outcome.kind === 'granted') {
        granted += 1;
        deps.log?.info({ billId: billplzBillId }, 'pending payment granted by the hourly check');
      } else if (outcome.kind === 'mismatch' || outcome.kind === 'unknown-bill') {
        deps.log?.error({ billId: billplzBillId, outcome: outcome.kind }, 'pending payment refused by the hourly check');
      }
    } catch (error) {
      // One bill failing -- Billplz briefly unreachable, say -- must not stop the rest.
      deps.log?.error({ billId: billplzBillId, err: String(error) }, 'hourly check could not confirm a bill');
    }
  }

  return { checked: stale.length, granted };
}

export function createBillingWorker(deps: {
  connection: IORedis;
  prisma: PrismaClient;
  client: BillplzClient;
  log?: BillingLog;
}): Worker {
  return new Worker(
    BILLING_QUEUE,
    async (job) => {
      if (job.name === PENDING_CHECK_JOB) {
        await runPendingCheck({ prisma: deps.prisma, client: deps.client, now: new Date(), log: deps.log });
      }
    },
    { connection: deps.connection, concurrency: QUEUE_CONCURRENCY.billing },
  );
}

/** Upserted under a fixed id, so a restart replaces the schedule instead of adding a second. */
export async function scheduleBillingJobs(queue: SchedulerQueue): Promise<void> {
  await queue.upsertJobScheduler(PENDING_CHECK_JOB, { pattern: '0 * * * *' }, { name: PENDING_CHECK_JOB });
}
```

- [ ] **Step 5: Run it and watch it pass**

Run: `cd apps/workers && npx vitest run src/billing/pending-check.test.ts`
Expected: 9 passed.

- [ ] **Step 6: Prove the tests can fail**

Make each change, run the file, confirm the named test fails, then restore:
1. Change `lte:` to `lt:` — "checks a payment exactly two hours old" fails.
2. Change `gte:` to `gt:` — "still checks a payment exactly seven days old" fails.
3. Remove the `try`/`catch`, leaving its body — "keeps going when one bill cannot be fetched" fails.
4. Remove `status: 'PENDING',` — "never asks about a payment already paid" fails.

- [ ] **Step 7: Wire it into the process**

In `apps/workers/src/main.ts`:

1. Change `import { MAIL_QUEUE, type MailJobData } from '@curios/core';` to `import { BILLING_QUEUE, MAIL_QUEUE, type MailJobData } from '@curios/core';`.
2. Add, after the other imports:

```ts
import { createBillplzClient } from '@curios/billing';
import { createBillingWorker, scheduleBillingJobs } from './billing/pending-check.js';
```

3. Directly after the `ANTHROPIC_API_KEY` check, add:

```ts
const billplzApiKey = process.env.BILLPLZ_API_KEY;
if (!billplzApiKey) throw new Error('BILLPLZ_API_KEY is not set');
const billplzBaseUrl = process.env.BILLPLZ_BASE_URL;
if (!billplzBaseUrl) throw new Error('BILLPLZ_BASE_URL is not set');
```

4. Directly before `log.info('workers up');`, add:

```ts
// Its own connection, for the reason every worker above has one.
const billingWorker = createBillingWorker({
  connection: createRedis(),
  prisma,
  client: createBillplzClient({ apiKey: billplzApiKey, baseUrl: billplzBaseUrl }),
  log,
});
billingWorker.on('failed', (job, err) =>
  log.error({ jobId: job?.id, err: err.message }, 'billing job failed'),
);
billingWorker.on('error', (err) => log.error({ err: err.message }, 'billing worker error'));

// The repo's first schedule. Awaited, so a Redis that cannot take it stops the process
// here, rather than leaving a worker running with nothing ever scheduled.
await scheduleBillingJobs(new Queue(BILLING_QUEUE, { connection: createRedis() }));
```

- [ ] **Step 8: The whole workers suite and gates**

```bash
cd apps/workers
npx vitest run; echo "TEST EXIT: $?"
npx tsc --noEmit; echo "TSC EXIT: $?"
npx eslint src/billing src/queues.ts src/main.ts; echo "LINT EXIT: $?"
```

Expected: all three exit 0. `tsc` accepting the `await` at the top of `main.ts` confirms top-level await is available under this package's `module` setting; if it refuses, report the error rather than rewriting the call as an unawaited promise.

- [ ] **Step 9: Commit**

```bash
git add apps/workers/package.json pnpm-lock.yaml apps/workers/src/queues.ts apps/workers/src/billing apps/workers/src/main.ts
git commit -m "feat(workers): an hourly check that grants a payment whose callbacks all failed"
```

---
### Task 8: A basic /app/billing

**Files:**
- Create: `apps/web/app/app/billing/billing-copy.ts`
- Create: `apps/web/app/app/billing/billing-copy.test.ts`
- Create: `apps/web/app/app/billing/pay-buttons.tsx`
- Create: `apps/web/app/app/billing/pay-buttons.test.tsx`
- Create: `apps/web/app/app/billing/page.tsx`
- Create: `apps/web/app/app/billing/page.test.tsx`
- Modify: `apps/web/app/app/app-nav.tsx`

**Interfaces:**
- Consumes: `PLAN_PRICES_CENTS`, `BillingPlan` (Task 1); `POST /billing/bills` and the `?payment=paid|pending|failed` redirect (Task 6); existing `planState`, `PlanState`, `FREE_LEADS`, `getOwnerPage`, `apiFetch`, `ApiError`, `Shell`, `Callout`, `Button`.
- Produces: the `/app/billing` screen, and a Billing link in the dashboard nav.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/app/app/billing/billing-copy.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { FREE_LEADS, planState } from '@curios/core';
import { formatDate, paymentBanner, planSummary, ringgit } from './billing-copy.js';

const NOW = new Date('2026-09-14T08:00:00.000Z');

const stateOf = (page: { mode?: 'PERSONAL' | 'BUSINESS'; paidUntil?: Date | null; leadsCaptured?: number }) =>
  planState({
    mode: page.mode ?? 'BUSINESS',
    paidUntil: page.paidUntil ?? null,
    leadsCaptured: page.leadsCaptured ?? 0,
    now: NOW,
  });

describe('formatDate', () => {
  it('uses the calendar day in Malaysia, not in UTC', () => {
    // 20:00 UTC on 11 October is already 04:00 on the 12th in Kuala Lumpur.
    expect(formatDate(new Date('2026-10-11T20:00:00.000Z'))).toBe('12 October 2026');
  });
});

describe('ringgit', () => {
  it('writes whole ringgit the way the prices are published', () => {
    expect(ringgit(3900)).toBe('RM39');
    expect(ringgit(39000)).toBe('RM390');
  });

  it('keeps the cents when there are some', () => {
    expect(ringgit(3950)).toBe('RM39.50');
  });
});

describe('planSummary', () => {
  it('tells a personal page there is nothing to pay for', () => {
    expect(planSummary(stateOf({ mode: 'PERSONAL' }))).toBe(
      'Personal pages are free. There is nothing to pay for.',
    );
  });

  it('gives a paid page its paid-through date, in Malaysian time', () => {
    expect(planSummary(stateOf({ paidUntil: new Date('2026-10-11T20:00:00.000Z') }))).toBe(
      'Your plan is paid through 12 October 2026.',
    );
  });

  it('counts the trial', () => {
    expect(planSummary(stateOf({ leadsCaptured: 2 }))).toBe(
      `You are on the free trial: 2 of ${FREE_LEADS} free leads used.`,
    );
  });

  it('tells a spent trial what paying does', () => {
    expect(planSummary(stateOf({ leadsCaptured: FREE_LEADS }))).toBe(
      `All ${FREE_LEADS} of your free leads are used. Pay to keep the capture card on your page.`,
    );
  });

  it('tells a lapsed plan when it ended', () => {
    expect(
      planSummary(stateOf({ paidUntil: new Date('2026-08-01T00:00:00.000Z'), leadsCaptured: FREE_LEADS })),
    ).toBe('Your plan ended on 1 August 2026. Pay to turn the capture card back on.');
  });
});

describe('paymentBanner', () => {
  it('confirms a paid return', () => {
    expect(paymentBanner('paid')).toEqual({ tone: 'info', text: 'Payment received. Your plan is active.' });
  });

  it('says a pending return is still being confirmed', () => {
    expect(paymentBanner('pending')).toEqual({
      tone: 'info',
      text: 'We are still confirming your payment with Billplz. It will show here once it is confirmed.',
    });
  });

  it('says a failed return charged nothing', () => {
    expect(paymentBanner('failed')).toEqual({
      tone: 'error',
      text: 'The payment did not go through, and nothing was charged. You can try again below.',
    });
  });

  it('says nothing for anything else', () => {
    expect(paymentBanner(undefined)).toBeNull();
    expect(paymentBanner('granted')).toBeNull();
  });
});
```

Create `apps/web/app/app/billing/pay-buttons.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../../lib/api.js';
import { PayButtonsForm, payError } from './pay-buttons.js';

const options = [
  { plan: 'MONTHLY' as const, label: 'Pay RM39 for a month' },
  { plan: 'ANNUAL' as const, label: 'Pay RM390 for a year' },
];

describe('PayButtonsForm', () => {
  it('raises a bill for the plan pressed, and sends the browser to it', async () => {
    const onPay = vi.fn(async () => ({ url: 'https://www.billplz-sandbox.com/bills/abc' }));
    const navigate = vi.fn();
    render(<PayButtonsForm options={options} onPay={onPay} navigate={navigate} />);

    await userEvent.click(screen.getByRole('button', { name: 'Pay RM390 for a year' }));

    expect(onPay).toHaveBeenCalledWith('ANNUAL');
    expect(navigate).toHaveBeenCalledWith('https://www.billplz-sandbox.com/bills/abc');
  });

  it('holds the other button while one payment is starting', async () => {
    let finish = () => {};
    const onPay = vi.fn(
      () =>
        new Promise<{ url: string }>((resolve) => {
          finish = () => resolve({ url: 'https://www.billplz-sandbox.com/bills/abc' });
        }),
    );
    render(<PayButtonsForm options={options} onPay={onPay} navigate={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: 'Pay RM39 for a month' }));

    // Two bills raised by a double press would leave two pending payments for one owner.
    expect(screen.getByRole('button', { name: 'Pay RM390 for a year' })).toBeDisabled();
    finish();
  });

  it('says Billplz is not answering when the API reports it by code', async () => {
    // The API replaces a 502's message with its generic sentence, so the code is all that
    // arrives. This screen supplies the words.
    const onPay = vi.fn(async (): Promise<{ url: string }> => {
      throw new ApiError(502, 'BILLPLZ_UNAVAILABLE', 'Something failed on our side. Try again.');
    });
    render(<PayButtonsForm options={options} onPay={onPay} navigate={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: 'Pay RM39 for a month' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Billplz is not answering right now. Try again in a few minutes.',
    );
  });
});

describe('payError', () => {
  it('passes any other API message through unchanged', () => {
    expect(payError(new ApiError(429, 'RATE_LIMITED', 'Too many payment attempts. Try again in 1 hour.'))).toBe(
      'Too many payment attempts. Try again in 1 hour.',
    );
  });
});
```

Create `apps/web/app/app/billing/page.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { OwnerPage } from '@curios/db-read';

const getOwnerPage = vi.fn();
vi.mock('@curios/db-read', () => ({ getOwnerPage }));

const resolveOwner = vi.fn();
vi.mock('../session.js', () => ({ resolveOwner }));

vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve({ get: () => ({ value: 'a-session-value' }) }),
}));

// Throws, because the real `redirect` throws NEXT_REDIRECT. A mock that merely recorded
// the call would let control fall through a redirect the page must not survive.
const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});
vi.mock('next/navigation', () => ({ redirect }));

// PayButtons closes over apiFetch and window.location. These tests are about what the
// page decides to offer, so it records the options it was given instead.
const PayButtons = vi.fn((_props: { options: { plan: string; label: string }[] }) => null);
vi.mock('./pay-buttons.js', () => ({ PayButtons }));

const BillingPage = (await import('./page.js')).default;

const page: OwnerPage = {
  id: 'p1',
  handle: 'nadia',
  displayName: 'Nadia Bakes',
  published: true,
  mode: 'BUSINESS',
  paidUntil: null,
  leadsCaptured: 0,
};

async function renderWith(owned: OwnerPage | null, payment?: string) {
  getOwnerPage.mockResolvedValueOnce(owned);
  render(await BillingPage({ searchParams: Promise.resolve({ payment }) }));
}

describe('BillingPage', () => {
  beforeEach(() => {
    getOwnerPage.mockReset();
    resolveOwner.mockReset();
    PayButtons.mockClear();
    resolveOwner.mockResolvedValue({ accountId: 'acc1' });
  });

  it('offers both plans at their published prices to a business page', async () => {
    await renderWith(page);

    expect(screen.getByRole('heading', { name: 'Billing' })).toBeInTheDocument();
    expect(PayButtons).toHaveBeenCalledTimes(1);
    expect(PayButtons.mock.calls[0]?.[0].options).toEqual([
      { plan: 'MONTHLY', label: 'Pay RM39 for a month' },
      { plan: 'ANNUAL', label: 'Pay RM390 for a year' },
    ]);
  });

  it('offers nothing to pay for on a personal page', async () => {
    await renderWith({ ...page, mode: 'PERSONAL' });

    expect(PayButtons).not.toHaveBeenCalled();
    expect(screen.getByText('Personal pages are free. There is nothing to pay for.')).toBeInTheDocument();
  });

  it('shows the banner the API redirected back with', async () => {
    await renderWith(page, 'paid');

    expect(screen.getByRole('status')).toHaveTextContent('Payment received. Your plan is active.');
  });

  it('sends an owner with no page to onboarding', async () => {
    await expect(renderWith(null)).rejects.toThrow('NEXT_REDIRECT:/app/onboarding');
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd apps/web && npx vitest run app/app/billing`
Expected: all three files fail to load — none of the modules they import exists yet.

- [ ] **Step 3: The copy**

Create `apps/web/app/app/billing/billing-copy.ts`:

```ts
import { FREE_LEADS, type PlanState } from '@curios/core';

const MALAYSIAN_DATE: Intl.DateTimeFormatOptions = {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'Asia/Kuala_Lumpur',
};

/**
 * A date as an owner in Malaysia reads it: the calendar day in their own time zone.
 * paidUntil is stored in UTC, and 20:00 UTC is already tomorrow in Kuala Lumpur.
 */
export function formatDate(date: Date): string {
  return date.toLocaleDateString('en-MY', MALAYSIAN_DATE);
}

/** Whole ringgit without decimals, the way the prices are published: RM39, RM390. */
export function ringgit(cents: number): string {
  return cents % 100 === 0 ? `RM${cents / 100}` : `RM${(cents / 100).toFixed(2)}`;
}

export function planSummary(state: PlanState): string {
  switch (state.kind) {
    case 'personal':
      return 'Personal pages are free. There is nothing to pay for.';
    case 'paid':
      return `Your plan is paid through ${formatDate(state.paidUntil)}.`;
    case 'trial':
      return `You are on the free trial: ${state.used} of ${FREE_LEADS} free leads used.`;
    case 'trialSpent':
      return `All ${FREE_LEADS} of your free leads are used. Pay to keep the capture card on your page.`;
    case 'lapsed':
      return `Your plan ended on ${formatDate(state.paidUntil)}. Pay to turn the capture card back on.`;
  }
}

export interface PaymentBanner {
  tone: 'info' | 'error';
  text: string;
}

/**
 * What the screen says on returning from Billplz, keyed on the value the API's return
 * route redirects with. Anything else says nothing: a hand-typed query string must not
 * make the screen claim a payment happened.
 */
export function paymentBanner(value: string | undefined): PaymentBanner | null {
  switch (value) {
    case 'paid':
      return { tone: 'info', text: 'Payment received. Your plan is active.' };
    case 'pending':
      return {
        tone: 'info',
        text: 'We are still confirming your payment with Billplz. It will show here once it is confirmed.',
      };
    case 'failed':
      return {
        tone: 'error',
        text: 'The payment did not go through, and nothing was charged. You can try again below.',
      };
    default:
      return null;
  }
}
```

- [ ] **Step 4: The buttons**

Create `apps/web/app/app/billing/pay-buttons.tsx`:

```tsx
'use client';

import type { BillingPlan } from '@curios/core';
import { Button, Callout } from '@curios/ui';
import { useState } from 'react';
import { ApiError, apiFetch } from '../../../lib/api.js';

export interface PayOption {
  plan: BillingPlan;
  label: string;
}

/**
 * The API replaces every 5xx message with a generic sentence and keeps only an
 * allow-listed code, so a Billplz outage arrives as BILLPLZ_UNAVAILABLE and nothing
 * else. Anything below 500 carries a message written for the owner, used as it is.
 */
export function payError(failure: unknown): string {
  if (failure instanceof ApiError && failure.code === 'BILLPLZ_UNAVAILABLE') {
    return 'Billplz is not answering right now. Try again in a few minutes.';
  }
  return failure instanceof Error ? failure.message : 'Something failed. Try again.';
}

/**
 * Presentational half of the wrapper split, the shape of AddPasswordForm. Both buttons
 * hold while either is starting, because a double press would raise two bills.
 */
export function PayButtonsForm({
  options,
  onPay,
  navigate,
}: {
  options: PayOption[];
  onPay: (plan: BillingPlan) => Promise<{ url: string }>;
  navigate: (url: string) => void;
}) {
  const [busy, setBusy] = useState<BillingPlan | null>(null);
  const [error, setError] = useState('');

  async function pay(plan: BillingPlan) {
    setError('');
    setBusy(plan);
    try {
      const { url } = await onPay(plan);
      // Left busy: the browser is leaving for Billplz.
      navigate(url);
    } catch (failure) {
      setError(payError(failure));
      setBusy(null);
    }
  }

  return (
    <div>
      {options.map((option) => (
        <Button
          key={option.plan}
          busy={busy === option.plan}
          disabled={busy !== null && busy !== option.plan}
          onClick={() => void pay(option.plan)}
        >
          {option.label}
        </Button>
      ))}
      {error ? <Callout tone="error">{error}</Callout> : null}
    </div>
  );
}

/**
 * Supplies the real handlers. `page.tsx` is a Server Component and may not pass a
 * function to a Client Component, so the closure over apiFetch is built here. The
 * options arrive as plain data: this file must not import the @curios/core barrel,
 * whose node:crypto import has no place in a browser bundle.
 */
export function PayButtons({ options }: { options: PayOption[] }) {
  return (
    <PayButtonsForm
      options={options}
      onPay={(plan) =>
        apiFetch<{ url: string }>('/billing/bills', { method: 'POST', body: JSON.stringify({ plan }) })
      }
      navigate={(url) => window.location.assign(url)}
    />
  );
}
```

- [ ] **Step 5: The page, and the nav link**

Create `apps/web/app/app/billing/page.tsx`:

```tsx
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { PLAN_PRICES_CENTS, planState, SESSION_COOKIE } from '@curios/core';
import { getOwnerPage } from '@curios/db-read';
import { Callout, Shell } from '@curios/ui';
import { resolveOwner } from '../session.js';
import { paymentBanner, planSummary, ringgit } from './billing-copy.js';
import { PayButtons } from './pay-buttons.js';

/**
 * Plan 1's billing screen: where the page's plan stands, the two ways to pay, and what
 * happened on the way back from Billplz. Usage against the cap, payment history and the
 * trial reset are plan 2.
 *
 * `searchParams` is a Promise in Next 15 and must be awaited, as in settings/page.tsx.
 */
export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ payment?: string }>;
}) {
  const params = await searchParams;
  const owner = await resolveOwner((await cookies()).get(SESSION_COOKIE)?.value);
  if (!owner) redirect('/signin');

  const page = await getOwnerPage(owner.accountId);
  if (!page) redirect('/app/onboarding');

  const state = planState({
    mode: page.mode,
    paidUntil: page.paidUntil,
    leadsCaptured: page.leadsCaptured,
    now: new Date(),
  });
  const banner = paymentBanner(params.payment);

  return (
    <Shell title="Billing">
      {banner ? <Callout tone={banner.tone}>{banner.text}</Callout> : null}
      <p>{planSummary(state)}</p>
      {state.kind === 'personal' ? null : (
        <PayButtons
          options={[
            { plan: 'MONTHLY', label: `Pay ${ringgit(PLAN_PRICES_CENTS.MONTHLY)} for a month` },
            { plan: 'ANNUAL', label: `Pay ${ringgit(PLAN_PRICES_CENTS.ANNUAL)} for a year` },
          ]}
        />
      )}
    </Shell>
  );
}
```

In `apps/web/app/app/app-nav.tsx`, add a Billing item after Leads, so `ITEMS` reads:

```ts
const ITEMS = [
  { href: '/app/review', label: 'Review' },
  { href: '/app/questions', label: 'Questions' },
  { href: '/app/leads', label: 'Leads' },
  { href: '/app/billing', label: 'Billing' },
  { href: '/app/settings', label: 'Settings' },
];
```

`app-nav.test.tsx` checks every nav link has a `page.tsx`, so it now also checks this one.

- [ ] **Step 6: Run them and watch them pass**

Run: `cd apps/web && npx vitest run app/app/billing app/app/app-nav.test.tsx`
Expected: 23 passed — 12 copy, 4 buttons, 4 page, 3 nav.

- [ ] **Step 7: Prove the tests can fail**

Make each change, run the billing tests, confirm the named test fails, then restore:
1. In `billing-copy.ts`, change `timeZone: 'Asia/Kuala_Lumpur'` to `timeZone: 'UTC'` — "uses the calendar day in Malaysia, not in UTC" fails. **Not** by deleting the option: this machine runs at GMT+8, so local time already is Kuala Lumpur and a deleted option would still pass here.
2. In `page.tsx`, replace `state.kind === 'personal' ? null : (...)` with the `PayButtons` element alone — "offers nothing to pay for on a personal page" fails.
3. In `payError`, delete the `BILLPLZ_UNAVAILABLE` branch — "says Billplz is not answering when the API reports it by code" fails.
4. Delete `disabled={...}` from the button — "holds the other button while one payment is starting" fails.

- [ ] **Step 8: The whole web suite and gates**

```bash
cd apps/web
npx vitest run; echo "TEST EXIT: $?"
npx tsc --noEmit; echo "TSC EXIT: $?"
npx eslint app/app/billing app/app/app-nav.tsx; echo "LINT EXIT: $?"
```

- [ ] **Step 9: Commit**

```bash
git add apps/web/app/app/billing apps/web/app/app/app-nav.tsx
git commit -m "feat(web): /app/billing, with both plans and what came back from Billplz"
```

---
### Task 9: Config, the walkthrough, and a real sandbox payment

**Files:**
- Modify: `.env.example`
- Create: `devDocs/manual-verification-billing.md`

**Interfaces:**
- Consumes: everything from Tasks 1–8.
- Produces: a documented configuration, a walkthrough that records the sandbox result, and the sandbox round trip that decides whether plan 1 is done.

Steps 1–3 are an agent's. **Steps 4–6 need the owner's Billplz sandbox credentials and a browser.** An agent completes Steps 1–3, commits, and reports BLOCKED at Step 4 naming exactly that; the controller runs Steps 4–6 with the owner.

- [ ] **Step 1: Document the configuration**

Append to `.env.example`:

```bash

# --- Billplz -----------------------------------------------------------------
# Payments. Sandbox by default: a sandbox account has its own keys and its own
# domain, and takes simulated FPX payments with test bank credentials -- no real
# money, no business registration. Production points BILLPLZ_BASE_URL at
# https://www.billplz.com with that account's keys. See
# devDocs/slice-9-build-spec.md.
#
# The API refuses to start without these, and so do the workers (which need the
# API key and base URL only).
#
# The callback cannot reach localhost. Billplz's servers call
# BILLPLZ_CALLBACK_URL, and a laptop is not on the internet, so in development
# the callback never arrives. The redirect still grants a payment -- the browser
# follows it -- and so does the workers' hourly pending check. To exercise the
# callback itself, run a tunnel and point BILLPLZ_CALLBACK_URL at it; see
# devDocs/manual-verification-billing.md.
BILLPLZ_API_KEY=replace-this-with-your-billplz-sandbox-secret-key
BILLPLZ_COLLECTION_ID=replace-this-with-your-sandbox-collection-id
BILLPLZ_X_SIGNATURE_KEY=replace-this-with-your-sandbox-x-signature-key
BILLPLZ_BASE_URL=https://www.billplz-sandbox.com
BILLPLZ_CALLBACK_URL=http://localhost:3001/billing/billplz/callback
BILLPLZ_REDIRECT_URL=http://localhost:3001/billing/billplz/return

# Starting a payment raises a bill at Billplz, so it is limited per account. The
# value below is the default; apps/api/vitest.setup.ts pins it for the tests.
RATE_LIMIT_BILLING_PER_ACCOUNT=10
```

- [ ] **Step 2: Write the walkthrough**

Create `devDocs/manual-verification-billing.md`:

````markdown
# Manual verification — getting paid

**Status: NOT RUN.** Written at the end of slice 9's plan 1. **Plan 1 is not done until checks 1–4
below have been run against the Billplz sandbox and recorded at the bottom of this file.**

Re-run it after any change to `packages/billing`, `apps/api/src/modules/billing`, or
`apps/workers/src/billing`, and before any real Billplz key goes into an environment.

## What CI proves, and what still needs a person

Every test named below was checked to exist, by name, before this table was written. **No** means
tests that run on every change prove the check. **Partly** means the logic underneath is proven, but
not the thing a person would actually see. **Yes** means only Billplz itself can confirm it.

| # | Check | Proven by | Still needs a person |
|---|---|---|---|
| 1 | Paying monthly on a business page lands on Billplz's bill for RM39.00 | `billing.routes.test.ts` — 'raises a bill for the owner's page, bound to a new pending payment'; `pay-buttons.test.tsx` — 'raises a bill for the plan pressed, and sends the browser to it' | **Partly** — the real Billplz bill page |
| 2 | The sandbox payment's callback verifies and grants | `signature.test.ts` — 'accepts a correctly signed callback'; `billing.routes.test.ts` — 'grants a signed, paid callback sent as a form' | **Yes** — only a real Billplz signature proves we verify the way Billplz signs |
| 3 | The redirect verifies and shows the paid banner | `signature.test.ts` — 'verifies a correctly signed redirect'; `billing.routes.test.ts` — 'fetches the bill, grants it, and sends the owner back to the paid banner'; `page.test.tsx` — 'shows the banner the API redirected back with' | **Yes** — same reason, and the redirect's key format is the docs' claim, not a tested one |
| 4 | The payment is granted once, extending `paidUntil` by a calendar month | `grant.test.ts` — 'grants a paid bill: the payment is paid and paidUntil moves a month from now'; 'grants once when the same bill arrives twice at once' | **Partly** — the rows after a real payment |
| 5 | A failed sandbox payment shows the failed banner and grants nothing | `billing.routes.test.ts` — 'sends a signed but unpaid redirect to the failed banner, without fetching' | **Partly** |
| 6 | A paid bill whose callback never arrived is granted by the hourly check | `pending-check.test.ts` — 'grants a payment whose callbacks never arrived' | **Partly** — the real schedule firing |
| 7 | A personal page is offered nothing to pay | `page.test.tsx` — 'offers nothing to pay for on a personal page'; `billing.routes.test.ts` — 'refuses a personal page, and raises no bill' | **No** |

## Before you start

1. **A Billplz sandbox account** at `https://www.billplz-sandbox.com`. From its settings: the API
   Secret Key, and the X Signature Key (turn X Signature on if it is off). Create a collection and
   note its id.
2. **A tunnel to the API**, so the sandbox can reach the callback:

   ```bash
   cloudflared tunnel --url http://localhost:3001
   ```

   Note the `https://....trycloudflare.com` address it prints.
3. **Your `.env`:**

   ```bash
   BILLPLZ_API_KEY=<sandbox secret key>
   BILLPLZ_COLLECTION_ID=<collection id>
   BILLPLZ_X_SIGNATURE_KEY=<sandbox X Signature key>
   BILLPLZ_BASE_URL=https://www.billplz-sandbox.com
   BILLPLZ_CALLBACK_URL=https://<tunnel address>/billing/billplz/callback
   BILLPLZ_REDIRECT_URL=http://localhost:3001/billing/billplz/return
   ```

   The redirect stays on `localhost`: it is the browser that follows it, and the browser is on your
   machine.
4. **Everything running** — `docker compose up -d`, then the API, the web app and the workers, each
   in its own terminal. The API and the workers refuse to start if a Billplz value is missing.
5. **A signed-in owner with a business page**, whose `paidUntil` you know:

   ```bash
   docker exec -i curios-postgres psql -U curios -d curios -c \
     "SELECT handle, mode, \"paidUntil\" FROM \"Page\" WHERE handle = 'YOURHANDLE';"
   ```

## The checks

### 1. Paying lands on Billplz's bill

On `http://localhost:3000/app/billing`, press **Pay RM39 for a month**. The browser must arrive at a
`billplz-sandbox.com` bill showing **RM39.00**, the page's display name, and a description of
`Curios Business, 1 month — <display name>`.

### 2. The callback verifies and grants

Pay with the sandbox's test bank and choose success. In the API's log, look for
`billplz bill handled` with `source: "callback"` and `outcome: "granted"` — or `already-granted` if the
redirect happened to arrive first.

**If the log says `billplz signature did not verify` with `source: "callback"`, stop.** Every genuine
payment would be refused. Record the failure; do not change the signature code to make it pass.

### 3. The redirect verifies and shows the paid banner

After paying, the browser must land on `/app/billing?payment=paid` with **Payment received. Your plan
is active.** In the API's log, there must be no `billplz signature did not verify` with
`source: "redirect"`.

**If the callback verified but the redirect did not,** suspect `paid_at` first. Billplz sends it like
`2026-09-14 15:15:09 +0800`. If Billplz puts a literal `+` in the query string rather than `%2B`, the
query parser reads it as a space, and the signature will not match. Record the raw redirect URL from
the browser's address bar; do not guess at a fix.

**If the browser lands on `pending` and the log says `billplz bill could not be confirmed`,** read the
error. `does not recognise` means Billplz's bill JSON is not the shape `client.ts` expects — `amount`
as a string, say. Record the response.

### 4. Granted exactly once

```bash
docker exec -i curios-postgres psql -U curios -d curios -c \
  "SELECT p.status, p.\"amountCents\", p.\"paidAt\", p.\"grantedUntil\", g.\"paidUntil\" FROM \"Payment\" p JOIN \"Page\" g ON g.id = p.\"pageId\" WHERE g.handle = 'YOURHANDLE' ORDER BY p.\"createdAt\" DESC LIMIT 3;"
```

The newest row must be `PAID`, `3900`, with `grantedUntil` equal to the page's `paidUntil` — and that
`paidUntil` exactly one calendar month after whichever was later: the moment of payment, or the
`paidUntil` you noted before starting. Both the callback and the redirect ran; the value moved once.

### 5. A failed payment grants nothing

Press **Pay RM39 for a month** again, and this time choose failure in the sandbox bank. The browser
must land on `/app/billing?payment=failed`, and the query from check 4 must show the new row still
`PENDING`, with `paidUntil` unchanged.

### 6. The hourly check grants what the callback and redirect never did

Make both deliveries fail: set `BILLPLZ_CALLBACK_URL` back to `http://localhost:3001/...`, which the
sandbox cannot reach, and `BILLPLZ_REDIRECT_URL` to `http://localhost:3000/app/billing`, which grants
nothing. Restart the API. Pay successfully. The row stays `PENDING`.

Age it past the check's two-hour floor:

```bash
docker exec -i curios-postgres psql -U curios -d curios -c \
  "UPDATE \"Payment\" SET \"createdAt\" = now() - interval '3 hours' WHERE status = 'PENDING' AND \"billplzBillId\" IS NOT NULL AND \"pageId\" = (SELECT id FROM \"Page\" WHERE handle = 'YOURHANDLE');"
```

With the workers running, wait for the top of the hour. The workers' log must show
`pending payment granted by the hourly check`, and the query from check 4 must show the row `PAID`.
Put both URLs back afterwards.

### 7. A personal page is offered nothing

Covered by CI. Worth a glance if you have a personal page to hand: `/app/billing` says there is nothing
to pay for, and shows no buttons.

## Recording the result

Add a line per run, newest first. Plan 1 is done when a run records checks 1–4 as passing.

| Date | Who | Checks passed | Checks failed, and what was seen |
|---|---|---|---|
````

- [ ] **Step 3: The workspace gates, and commit**

```bash
pnpm turbo run test --concurrency=1 --force > /tmp/gate-test.log 2>&1; echo "TEST EXIT: $?"
grep -E "^\s*(Tasks|Cached|Failed):" /tmp/gate-test.log
pnpm typecheck > /tmp/gate-tc.log 2>&1; echo "TYPECHECK EXIT: $?"
pnpm lint > /tmp/gate-lint.log 2>&1; echo "LINT EXIT: $?"
```

Expected: all three exit 0, with the test run reporting `9 successful, 9 total` — `@curios/billing` is the ninth package — and `0 cached`.

```bash
git add .env.example devDocs/manual-verification-billing.md
git commit -m "docs: Billplz config, and a walkthrough whose sandbox run decides when plan 1 is done"
```

An agent stops here and reports BLOCKED on Step 4: it needs the owner's sandbox credentials and a browser.

- [ ] **Step 4: Run checks 1–3 against the sandbox** (controller, with the owner)

Follow the walkthrough's *Before you start* and checks 1–3.

- [ ] **Step 5: Run checks 4–6** (controller, with the owner)

- [ ] **Step 6: Record the run, and decide**

Add the run to the walkthrough's table and change its **Status** line to the date it was run. If checks
1–4 passed, commit and plan 1 is done:

```bash
git add devDocs/manual-verification-billing.md
git commit -m "docs: the Billplz sandbox round trip, run and recorded"
```

If any of checks 1–4 failed, plan 1 is **not** done. Record what was seen; the fix is its own change,
followed by a new run.
