# Slice 9, Plan 2 — The owner experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An owner is reminded before their plan ends, can reset their free trial once if they never paid, and sees on one screen where their plan stands, what they have used, and what they have paid.

**Architecture:** Two nullable columns on `Page` carry all the new state — `trialResetAt` and `renewalReminderFor` — so neither the reset nor the reminders needs a table. A daily job claims a page by writing `renewalReminderFor` **before** enqueuing its email, so a crash loses at most one email and can never send two. The reset is a single conditional update with no read before it, so two clicks cannot both spend it. The screen reads usage and payment history through `@curios/db-read`, the way every other owner screen reads.

**Tech Stack:** TypeScript, Prisma 6, Postgres, Fastify 5 with `fastify-type-provider-zod`, BullMQ 5.81, Next 15 (App Router, RSC), vitest.

**Spec:** `devDocs/slice-9-build-spec.md` — read it before Task 1, particularly *Data*, *The scheduled job*, *What the owner sees* and *Documents corrected by this slice*.

**Plan 1** (`devDocs/plans/2026-09-14-slice-9-money-path.md`) is built and committed on branch `slice-9/money-path`: prices and `extendPaidUntil`, the `Payment` table, `@curios/billing` (signature, client, grant step), the API's bill/callback/return routes, the workers' hourly pending check, and a basic `/app/billing`. This plan continues from that work and assumes every piece of it exists. One thing from plan 1 is still open and is **not** this plan's to close: the Billplz sandbox round trip recorded in `devDocs/manual-verification-billing.md`, which still reads `Status: NOT RUN`.

## Global Constraints

- **"Never paid" means `paidUntil` is null.** That is the definition slice 8 wrote on the column; the reset adds no new flag for it.
- **The reset is one conditional update, with no read before it.** `POST /billing/trial-reset`, behind the session guard. It changes a row only where the page is `BUSINESS`, `paidUntil` is null, `trialResetAt` is null and `leadsCaptured` is at least 1 — a reset at zero would spend the one reset on nothing. Zero rows changed is a `TRIAL_RESET_USED` domain code, 409, allow-listed beside `PASSWORD_ALREADY_SET`.
- **Reminders are claimed before they are sent.** Daily at 10:00 Malaysia time — `pattern: '0 10 * * *'` with `tz: 'Asia/Kuala_Lumpur'`. Business pages whose `paidUntil` is later than now and at most 3 days away, and whose `renewalReminderFor` is not already that `paidUntil`. Each page is claimed by a conditional update setting `renewalReminderFor` to its `paidUntil`, and only then is the email enqueued onto the existing `mail` queue. A crash between the two loses that one email and can never send two; the screens still show the end date, so a lost email is the gentler failure.
- **The email is a pure function** returning `{ subject, text }`, the way `buildNotification` in `apps/workers/src/leads/notify.ts` is, and links to `{APP_URL}/app/billing`. It is the first worker email that links back to the app, so **the workers now require `APP_URL` at boot**, beside `BILLPLZ_API_KEY` and `BILLPLZ_BASE_URL`.
- **There is no auto-renew.** FPX cannot auto-charge and Billplz's recurring rail is card tokenisation in beta — see README's Settled decisions. The reminder must therefore say the plan *ends* and ask the owner to pay again; copy that implies an automatic charge is wrong.
- **`conversationCap()` reads `CONVERSATION_CAP_PER_MONTH` when called**, so the web app and the API must be given the same value, or both must leave it unset. Otherwise the screen shows a cap the API does not enforce.
- **All money is integer cents**, and the prices in `PLAN_PRICES_CENTS` are constants, never env vars.
- **No client component imports the `@curios/core` barrel** — it pulls in `node:crypto`. Values reach the browser as plain props from a server component; `import type` is fine.
- **Migrations:** `prisma migrate dev --create-only`, read the SQL, then `migrate deploy` against both databases. **Never accept a reset prompt** — it drops the development database.
- **Tests:** the workspace suite is `pnpm turbo run test --concurrency=1` — **never omit `--concurrency=1`**. A container restart wipes the tmpfs test database; restore it with `prisma migrate deploy` against `DATABASE_URL_TEST` **and** `packages/db/prisma/sql/readonly-role.sql`.
- **vitest does not typecheck.** Run `npx tsc --noEmit` in every package you touch. Read exit codes directly (`; echo "EXIT: $?"`) — never through `| tail` or `| head`. To force a workspace gate, call turbo directly (`pnpm turbo run typecheck --concurrency=1 --force`): `pnpm typecheck -- --force` sends `--force` to `tsc`, which fails every package with `TS5093` for a reason that has nothing to do with the code.
- **Every test is proven by a mutation that makes it fail**, as the spec's testing table requires. Where a task lists mutations, run each one, record which tests failed, and restore.
- **Out of this plan:** the sandbox round trip (plan 1's, still open), e-invoicing, auto-renew, anything to do with recurring rails.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/db/prisma/schema.prisma` | `Page.trialResetAt`, `Page.renewalReminderFor`. |
| `packages/core/src/plan.ts` | `PlanState`'s `trial` variant gains `lapsedOn`. |
| `apps/web/app/app/leads/trial-notice.tsx` | The notice's copy, its new lapsed-with-trial-left case, and its link to billing. |
| `packages/db-read/src/usage.query.ts` | `getConversationUsage` — this month's conversations for a page. |
| `packages/db-read/src/payments.query.ts` | `getRecentPayments` — the newest payments for a page. |
| `apps/api/src/modules/billing/billing.service.ts` | `resetTrial`, `TrialResetUsedError`. |
| `apps/api/src/modules/billing/billing.routes.ts` | `POST /billing/trial-reset`. |
| `apps/api/src/plugins/errors.ts` | `TRIAL_RESET_USED` allow-listed. |
| `apps/workers/src/billing/renewal-reminder.ts` | `buildRenewalReminder`, `runRenewalReminders`. |
| `apps/workers/src/billing/pending-check.ts` | The daily schedule joins the hourly one; the worker routes the new job name. |
| `apps/workers/src/main.ts` | `APP_URL` required at boot; the mail queue reaches the billing worker. |
| `packages/core/src/types.ts` | `RENEWAL_REMINDER_JOB`. |
| `apps/web/app/app/billing/billing-copy.ts` | Usage and payment-history copy. |
| `apps/web/app/app/billing/reset-button.tsx` | The trial reset control. Client. |
| `apps/web/app/app/billing/page.tsx` | The full screen: plan, usage, payments, reset. |
| `devDocs/*.md` | The corrections the spec's document table lists. |

---
### Task 1: The two columns on Page

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<timestamp>_owner_billing_columns/migration.sql` (generated)
- Modify: `packages/db/src/schema.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `Page.trialResetAt: DateTime?` and `Page.renewalReminderFor: DateTime?`, available on any `PrismaClient` from `@curios/db`. Task 5 writes `trialResetAt`; Task 6 writes `renewalReminderFor`; Task 7 reads neither directly.

- [ ] **Step 1: Write the failing tests**

In `packages/db/src/schema.test.ts`, find the test `'starts a payment pending, with nothing paid or granted yet'`. Directly after it, inside the same `describe`, add:

```ts
  it('starts a page with its trial reset unused and no reminder recorded', async () => {
    // Both columns are read as "has this happened yet", so their default is the
    // whole of their meaning: the reset's conditional update requires
    // trialResetAt null, and the reminder job treats null as never reminded.
    const pageId = await aPageForPayments();

    const page = await prisma.page.findUniqueOrThrow({
      where: { id: pageId },
      select: { trialResetAt: true, renewalReminderFor: true },
    });

    expect(page).toEqual({ trialResetAt: null, renewalReminderFor: null });
  });

  it('keeps both stamps once they are written', async () => {
    const pageId = await aPageForPayments();
    const resetAt = new Date('2026-09-17T02:00:00.000Z');
    const remindedFor = new Date('2026-10-01T00:00:00.000Z');

    const page = await prisma.page.update({
      where: { id: pageId },
      data: { trialResetAt: resetAt, renewalReminderFor: remindedFor },
      select: { trialResetAt: true, renewalReminderFor: true },
    });

    expect(page).toEqual({ trialResetAt: resetAt, renewalReminderFor: remindedFor });
  });
```

`aPageForPayments` is the helper plan 1's Task 2 added at the end of this file; it returns a page id.

- [ ] **Step 2: Run them and watch them fail**

Run: `cd packages/db && npx vitest run src/schema.test.ts`
Expected: the two new tests fail — Prisma's client has no `trialResetAt` on `Page`, so the `select` is rejected — and every existing test still passes.

If instead every test in the file fails with `relation "Account" does not exist`, the tmpfs test database was wiped by a container restart. Restore it from the repo root before reading anything into the result:

```bash
DATABASE_URL="$(grep '^DATABASE_URL_TEST=' .env | cut -d= -f2-)" pnpm --filter @curios/db exec prisma migrate deploy
docker exec -i curios-postgres-test psql -U curios -d curios_test < packages/db/prisma/sql/readonly-role.sql
```

- [ ] **Step 3: Change the schema**

In `packages/db/prisma/schema.prisma`, in `model Page`, directly after the line

```prisma
  leadsCaptured Int            @default(0)
```

add:

```prisma
  /// When the owner spent their one trial reset. Null means unused, and the
  /// reset's conditional update requires null -- so a second click changes no
  /// rows rather than granting a second trial.
  trialResetAt  DateTime?
  /// The paidUntil this owner was last reminded about. Renewing moves paidUntil,
  /// which makes the next period eligible by itself: no reminders table, and no
  /// way to send the same reminder twice.
  renewalReminderFor DateTime?
```

- [ ] **Step 4: Generate the migration without applying it**

```bash
cd packages/db && DATABASE_URL="$(grep '^DATABASE_URL=' ../../.env | cut -d= -f2-)" npx prisma migrate dev --create-only --name owner_billing_columns
```

`--create-only` is not optional. A plain `migrate dev` applies immediately and, on detecting drift, offers to **reset** — which drops the development database. Never accept a reset prompt; if one appears, stop and report BLOCKED with its text.

Read the generated `migration.sql`. It must contain exactly one statement: an `ALTER TABLE "Page" ADD COLUMN "trialResetAt" TIMESTAMP(3), ADD COLUMN "renewalReminderFor" TIMESTAMP(3)` — two nullable columns, in one or two `ALTER TABLE` statements. If it contains `DROP`, `TRUNCATE`, `NOT NULL`, a default, or anything touching another table, report BLOCKED with the SQL quoted.

- [ ] **Step 5: Apply to both databases**

```bash
cd packages/db
DATABASE_URL="$(grep '^DATABASE_URL=' ../../.env | cut -d= -f2-)" npx prisma migrate deploy
DATABASE_URL="$(grep '^DATABASE_URL_TEST=' ../../.env | cut -d= -f2-)" npx prisma migrate deploy
npx prisma generate
```

If `prisma generate` fails with an `EPERM` rename on Windows, a running development process is holding the query engine. Report BLOCKED rather than killing anything — those processes belong to the owner of the machine.

- [ ] **Step 6: Run the tests and watch them pass**

Run: `cd packages/db && npx vitest run src/schema.test.ts`
Expected: every test passes, the two new ones included.

- [ ] **Step 7: Prove the tests can fail**

Make the change, run the file, confirm the named test fails, then restore:

1. In `schema.prisma`, give `trialResetAt` a default of `now()` (`trialResetAt DateTime? @default(now())`), then re-run **Steps 4 and 5** to generate and apply that migration — `'starts a page with its trial reset unused'` fails, because a fresh page arrives already stamped. Then delete that migration directory, restore the line, and re-run Steps 4 and 5 to put the schema back. Confirm the file passes again, and confirm with

```bash
docker exec curios-postgres-test psql -U curios -d curios_test -tAc "SELECT column_default IS NULL, is_nullable FROM information_schema.columns WHERE table_name = 'Page' AND column_name = 'trialResetAt';"
```

that the column reads `t|YES` — no default, nullable.

This mutation costs two migration cycles. It is worth it once: the default on this column is the reset's entire guard, and a test that would pass with a default proves nothing about it.

- [ ] **Step 8: Package gates**

```bash
cd packages/db
npx vitest run; echo "TEST EXIT: $?"
npx tsc --noEmit; echo "TSC EXIT: $?"
npx eslint src/schema.test.ts; echo "LINT EXIT: $?"
```

Expected: all three exit 0.

- [ ] **Step 9: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations packages/db/src/schema.test.ts
git commit -m "feat(db): the columns behind one trial reset and one reminder per period"
```

---
### Task 2: `planState` learns that a trial can outlive a subscription

**Files:**
- Modify: `packages/core/src/plan.ts`
- Modify: `packages/core/src/plan.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `PlanState`'s trial variant becomes `{ kind: 'trial'; used: number; remaining: number; lapsedOn?: Date }`, where `lapsedOn` is present only when the page paid before and that payment has expired. `canCapture` is unchanged — a trial with leads left still captures, lapsed or not.

The case this exists for: a page pays, captures one lead, lets the subscription lapse, and still has two free leads. Today it is told "you are on the free trial", which is true and reads as though it never paid. Task 3 uses `lapsedOn` to say both things.

- [ ] **Step 1: Write the failing test**

In `packages/core/src/plan.test.ts`, inside the `describe('planState')` block, after the last existing test in it, add:

```ts
  it('marks a trial that outlived a lapsed subscription with the date it ended', () => {
    // Paid once, captured one lead, lapsed -- and two free leads remain. The OR
    // rule already lets this page capture; what it lacked was a way to say why.
    const state = planState({
      mode: 'BUSINESS',
      paidUntil: new Date('2026-08-01T00:00:00.000Z'),
      leadsCaptured: 1,
      now: new Date('2026-09-17T00:00:00.000Z'),
    });

    expect(state).toEqual({
      kind: 'trial',
      used: 1,
      remaining: FREE_LEADS - 1,
      lapsedOn: new Date('2026-08-01T00:00:00.000Z'),
    });
  });

  it('leaves lapsedOn off a trial that never paid', () => {
    const state = planState({
      mode: 'BUSINESS',
      paidUntil: null,
      leadsCaptured: 1,
      now: new Date('2026-09-17T00:00:00.000Z'),
    });

    expect(state).toEqual({ kind: 'trial', used: 1, remaining: FREE_LEADS - 1 });
    expect(state).not.toHaveProperty('lapsedOn');
  });

  it('still lets a lapsed page with trial left capture', () => {
    // The point of the OR rule, and the reason lapsedOn is a property of a trial
    // rather than a state of its own: nothing about enforcement changes here.
    expect(
      canCapture({
        mode: 'BUSINESS',
        paidUntil: new Date('2026-08-01T00:00:00.000Z'),
        leadsCaptured: 1,
        now: new Date('2026-09-17T00:00:00.000Z'),
      }),
    ).toBe(true);
  });
```

`FREE_LEADS`, `planState` and `canCapture` are already imported at the top of this file.

- [ ] **Step 2: Run it and watch it fail**

Run: `cd packages/core && npx vitest run src/plan.test.ts`
Expected: `'marks a trial that outlived a lapsed subscription'` fails — the returned object has no `lapsedOn` — while the other two pass, since they describe behaviour that already holds.

Two of the three tests passing before the change is the point: they are the guard that this change does not alter what a never-paid trial looks like or what `canCapture` answers.

- [ ] **Step 3: Implement**

In `packages/core/src/plan.ts`, change the `PlanState` union's trial member from

```ts
  | { kind: 'trial'; used: number; remaining: number }
```

to

```ts
  /**
   * `lapsedOn` is set when this page paid before and that payment has expired --
   * a subscription can end while free leads remain, because the rule below is an
   * OR. Optional rather than a state of its own: capture is unaffected, and only
   * the wording an owner reads changes.
   */
  | { kind: 'trial'; used: number; remaining: number; lapsedOn?: Date }
```

and change the trial branch of `planState` from

```ts
  if (input.leadsCaptured < FREE_LEADS) {
    return {
      kind: 'trial',
      used: input.leadsCaptured,
      remaining: FREE_LEADS - input.leadsCaptured,
    };
  }
```

to

```ts
  if (input.leadsCaptured < FREE_LEADS) {
    return {
      kind: 'trial',
      used: input.leadsCaptured,
      remaining: FREE_LEADS - input.leadsCaptured,
      // Spread, not `lapsedOn: input.paidUntil ?? undefined`: an explicit
      // `lapsedOn: undefined` is a property the object has, and `toEqual` in the
      // test above distinguishes that from a property it does not have.
      ...(input.paidUntil !== null ? { lapsedOn: input.paidUntil } : {}),
    };
  }
```

The branch is only reached when the payment has already expired — the paid branch above it returns first for a `paidUntil` still in the future — so a non-null `paidUntil` here always means a lapse.

- [ ] **Step 4: Run it and watch it pass**

Run: `cd packages/core && npx vitest run src/plan.test.ts`
Expected: every test passes.

- [ ] **Step 5: Prove the tests can fail**

Make each change, run the file, confirm the named tests fail, then restore:

1. Set `lapsedOn` unconditionally (`lapsedOn: input.paidUntil ?? undefined`) — `'leaves lapsedOn off a trial that never paid'` fails on the `not.toHaveProperty` assertion.
2. Return `{ kind: 'lapsed', paidUntil: input.paidUntil }` instead of the trial object when `paidUntil` is not null — `'still lets a lapsed page with trial left capture'` fails, because `canCapture` would now refuse a page with two free leads left.

Mutation 2 is the one that matters: it is the mistake this change invites, and it would silently take capture away from a page that is entitled to it.

- [ ] **Step 6: Package gates**

```bash
cd packages/core
npx vitest run; echo "TEST EXIT: $?"
npx tsc --noEmit; echo "TSC EXIT: $?"
npx eslint src/plan.ts src/plan.test.ts; echo "LINT EXIT: $?"
```

Expected: all three exit 0. `tsc` passing here also proves every existing consumer of `PlanState` still compiles against the widened trial variant — the leads screen, the billing screen and `canCapture`'s own callers.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/plan.ts packages/core/src/plan.test.ts
git commit -m "feat(core): a trial can outlive a subscription, so say when the subscription ended"
```

---
### Task 3: The trial notice tells the truth, and links somewhere

**Files:**
- Modify: `apps/web/app/app/leads/trial-notice.tsx`
- Modify: `apps/web/app/app/leads/trial-notice.test.tsx`

**Interfaces:**
- Consumes: `PlanState` with `lapsedOn` (Task 2).
- Produces: `trialNotice(state: PlanState): Notice | null` where `Notice` is `{ tone: 'info' | 'action'; text: string; action: { href: string; label: string } }`, and a `TrialNotice` component that renders the text and the link. Nothing else imports these two; the leads screen renders the component and is unchanged.

Three things change. The notice gains a link, because `/app/billing` now exists — the file's own comment says the "until you subscribe" wording is a promise the product cannot keep until it does. A trial that outlived a subscription gets its own sentence. And the dates are rendered in Malaysian time, as the billing screen's are, rather than in whatever zone the server happens to run in.

- [ ] **Step 1: Write the failing tests**

In `apps/web/app/app/leads/trial-notice.test.tsx`, add to the `describe('trialNotice')` block:

```ts
  it('sends every notice to billing, now that there is somewhere to pay', () => {
    const states = [
      from({ mode: 'BUSINESS', paidUntil: null, leadsCaptured: 1 }),
      from({ mode: 'BUSINESS', paidUntil: null, leadsCaptured: FREE_LEADS }),
      from({ mode: 'BUSINESS', paidUntil: PAST, leadsCaptured: FREE_LEADS }),
    ];

    for (const state of states) {
      expect(trialNotice(state)?.action.href).toBe('/app/billing');
      expect(trialNotice(state)?.action.label.length).toBeGreaterThan(0);
    }
  });

  it('tells a page that lapsed with free leads left both halves of that', () => {
    // Paid, captured one, lapsed, two free leads remain. Called a plain trial it
    // reads as though the page never paid; called a lapse it reads as though
    // capture has stopped, and it has not.
    const notice = trialNotice(from({ mode: 'BUSINESS', paidUntil: PAST, leadsCaptured: 1 }));

    expect(notice?.tone).toBe('action');
    expect(notice?.text).toContain('subscription ended');
    expect(notice?.text).toContain(`${FREE_LEADS - 1} free leads left`);
    expect(notice?.text).not.toContain('no longer shown');
  });

  it('writes the lapse date as a Malaysian calendar day', () => {
    // 20:00 UTC on 12 August is already the 13th in Kuala Lumpur, which is the
    // date the owner's own calendar shows.
    const notice = trialNotice(
      from({
        mode: 'BUSINESS',
        paidUntil: new Date('2026-08-12T20:00:00.000Z'),
        leadsCaptured: FREE_LEADS,
      }),
    );

    expect(notice?.text).toContain('13 August 2026');
  });
```

and add to the `describe('TrialNotice')` block:

```ts
  it('renders the link an owner has to follow to do anything about it', () => {
    render(<TrialNotice state={from({ mode: 'BUSINESS', paidUntil: null, leadsCaptured: FREE_LEADS })} />);

    expect(screen.getByRole('link')).toHaveAttribute('href', '/app/billing');
  });
```

`PAST`, `FREE_LEADS`, `from`, `render` and `screen` are already defined at the top of this file.

- [ ] **Step 2: Run them and watch them fail**

Run: `cd apps/web && npx vitest run app/app/leads/trial-notice.test.tsx`
Expected: the four new tests fail — `action` is undefined, there is no lapsed-with-leads sentence, the date renders as 12 August, and there is no link — while the six existing tests still pass.

- [ ] **Step 3: Implement**

Replace the whole of `apps/web/app/app/leads/trial-notice.tsx` with:

```tsx
import type { PlanState } from '@curios/core';
import { FREE_LEADS } from '@curios/core';
import { Callout } from '@curios/ui';

/**
 * A date as an owner in Malaysia reads it. `paidUntil` is stored in UTC, and
 * 20:00 UTC is already tomorrow in Kuala Lumpur -- so the zone is named rather
 * than inherited from wherever this renders.
 *
 * Duplicated from the billing screen's `formatDate` on purpose: two screens
 * that happen to format a date the same way are not a shared abstraction, and
 * the alternative is a copy module imported across feature folders for one
 * Intl call.
 */
function malaysianDate(date: Date): string {
  return date.toLocaleDateString('en-MY', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Kuala_Lumpur',
  });
}

export interface Notice {
  tone: 'info' | 'action';
  text: string;
  /**
   * Every notice has one. A screen that explains capture has stopped and offers
   * no way to start it again is the finding this whole slice answers.
   */
  action: { href: string; label: string };
}

const BILLING = '/app/billing';

/**
 * What the leads screen says about the free trial.
 *
 * Split from the component so the wording is testable without rendering, and
 * so the states are visible in one place rather than spread through JSX.
 *
 * Returns null where there is nothing to say. A personal page never captures,
 * so a count would be noise; a paid page is simply working, and an owner who
 * has paid does not need a meter on the screen they check for new business.
 */
export function trialNotice(state: PlanState): Notice | null {
  switch (state.kind) {
    case 'personal':
    case 'paid':
      return null;

    case 'trial':
      // A trial that outlived a subscription needs both facts said at once: the
      // subscription ended, and capture has NOT stopped, because free leads are
      // left. Either sentence alone is misleading.
      return state.lapsedOn
        ? {
            tone: 'action',
            text: `Your subscription ended on ${malaysianDate(state.lapsedOn)}, and you have ${state.remaining} free leads left. After those, the capture card stops appearing on your page.`,
            action: { href: BILLING, label: 'Renew your plan' },
          }
        : {
            tone: 'info',
            // The count, and what happens at the end of it. The count alone
            // would still leave the card's disappearance a surprise.
            text: `${state.used} of your ${FREE_LEADS} free leads used. After ${FREE_LEADS}, the capture card stops appearing on your page until you subscribe.`,
            action: { href: BILLING, label: 'See plans' },
          };

    case 'trialSpent':
      return {
        tone: 'action',
        text: `All ${FREE_LEADS} of your free leads are used, so the capture card is no longer shown on your page. Everything else still works — your page, your FAQ pages and chat are unaffected.`,
        action: { href: BILLING, label: 'Pay to turn capture back on' },
      };

    case 'lapsed':
      return {
        tone: 'action',
        // Named separately from a spent trial because the owner has paid
        // before and the thing to do about it is different.
        text: `Your subscription ended on ${malaysianDate(state.paidUntil)}, so the capture card is no longer shown on your page. Everything else still works.`,
        action: { href: BILLING, label: 'Renew your plan' },
      };
  }
}

export function TrialNotice({ state }: { state: PlanState }) {
  const notice = trialNotice(state);
  if (!notice) return null;
  return (
    <Callout tone={notice.tone}>
      {notice.text} <a href={notice.action.href}>{notice.action.label}</a>
    </Callout>
  );
}
```

A plain `<a>`, not `next/link`: nothing in `apps/web/app` imports `next/link`, and the dashboard's own navigation (`packages/ui/src/nav/Nav.tsx`, and `app/app/onboarding/job-status.tsx`) uses anchors. Following the established pattern beats introducing a second one for one link.

- [ ] **Step 4: Run them and watch them pass**

Run: `cd apps/web && npx vitest run app/app/leads/trial-notice.test.tsx`
Expected: 11 passed — the 7 already in the file, plus these 4.

- [ ] **Step 5: Prove the tests can fail**

Make each change, run the file, confirm the named test fails, then restore:

1. In `malaysianDate`, change `timeZone: 'Asia/Kuala_Lumpur'` to `timeZone: 'UTC'` — `'writes the lapse date as a Malaysian calendar day'` fails. **Not** by deleting the option: this machine runs at GMT+8, so a deleted option still produces the Malaysian day and proves nothing.
2. In the trial case, ignore `lapsedOn` and always return the counting sentence — `'tells a page that lapsed with free leads left both halves of that'` fails.
3. Remove the `<a>` from the component — `'renders the link an owner has to follow'` fails.

- [ ] **Step 6: The leads screen still renders**

Run: `cd apps/web && npx vitest run app/app/leads`
Expected: every leads test passes. The component's props did not change, so `lead-list.test.tsx` should be untouched by this — the leads screen has no page test of its own. If it fails, report it rather than adjusting the notice.

- [ ] **Step 7: Package gates**

```bash
cd apps/web
npx vitest run; echo "TEST EXIT: $?"
npx tsc --noEmit; echo "TSC EXIT: $?"
npx eslint app/app/leads; echo "LINT EXIT: $?"
```

- [ ] **Step 8: Commit**

```bash
git add apps/web/app/app/leads/trial-notice.tsx apps/web/app/app/leads/trial-notice.test.tsx
git commit -m "feat(web): the trial notice links to billing, and names a lapse that left leads"
```

---
### Task 4: Reading usage and payment history

**Files:**
- Create: `packages/db-read/src/usage.query.ts`
- Create: `packages/db-read/src/usage.query.test.ts`
- Create: `packages/db-read/src/payments.query.ts`
- Create: `packages/db-read/src/payments.query.test.ts`
- Modify: `packages/db-read/src/owner-page.query.ts`
- Modify: `packages/db-read/src/owner-page.query.test.ts`
- Modify: `packages/db-read/src/index.ts`
- Modify: `packages/db-read/vitest.setup.ts`
- Modify: `apps/web/app/app/layout.test.tsx`, `apps/web/app/app/review/page.test.tsx`, `apps/web/app/app/billing/page.test.tsx` — one fixture field each

**Interfaces:**
- Consumes: `conversationCap()` from `@curios/core`; `UsageCounter` and `Payment` from the schema.
- Produces (from `@curios/db-read`):
  - `interface ConversationUsage { used: number; cap: number; period: string }`
  - `getConversationUsage(pageId: string, now: Date): Promise<ConversationUsage>`
  - `interface OwnerPayment { id: string; plan: 'MONTHLY' | 'ANNUAL'; amountCents: number; status: 'PENDING' | 'PAID'; paidAt: Date | null; grantedUntil: Date | null; createdAt: Date }`
  - `RECENT_PAYMENTS = 5`
  - `getRecentPayments(pageId: string): Promise<OwnerPayment[]>`
  - `OwnerPage` gains `trialResetAt: Date | null`, which is how Task 7's screen knows whether to offer the reset at all.

Task 7's screen calls both. They live in `db-read` because every owner screen reads through the read-only role, which is the guard that a rendering bug cannot write.

- [ ] **Step 1: Confirm the read-only role can see Payment**

```bash
docker exec curios-postgres-test psql -U curios -d curios_test -tAc "SELECT has_table_privilege('curios_readonly','\"Payment\"','SELECT');"
docker exec curios-postgres psql -U curios -d curios -tAc "SELECT has_table_privilege('curios_readonly','\"Payment\"','SELECT');"
```

Expected: `t` from both. `readonly-role.sql` carries `ALTER DEFAULT PRIVILEGES`, so tables created by later migrations inherit the grant; this step is here because a `f` would otherwise surface as an authentication-shaped failure in Step 3 rather than a missing grant. If either prints `f`, re-run `packages/db/prisma/sql/readonly-role.sql` against that database and say so in your report.

Then pin the cap for this package's tests. `getConversationUsage` calls `conversationCap()`, which reads `CONVERSATION_CAP_PER_MONTH` when called, and the root setup loads `.env` — so a developer who raised the cap locally would change what these tests see. Append to `packages/db-read/vitest.setup.ts`, the same fix for the same reason as `apps/api/vitest.setup.ts`:

```ts
// Pinned to the production default. conversationCap() reads this when called,
// and the root setup loads .env, so without the pin a developer's local
// override would change what the usage test expects. Same as apps/api.
process.env.CONVERSATION_CAP_PER_MONTH = '200';
```

- [ ] **Step 2: Write the failing tests**

Create `packages/db-read/src/usage.query.test.ts`:

```ts
import { beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { FREE_CONVERSATIONS_PER_MONTH } from '@curios/core';
import { getConversationUsage } from './usage.query.js';

const write = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });

const NOW = new Date('2026-09-17T04:00:00.000Z');
let pageId = '';

beforeAll(async () => {
  await write.$executeRawUnsafe('TRUNCATE "Account" CASCADE');
  const account = await write.account.create({
    data: {
      email: 'usage@example.com',
      pages: { create: { handle: 'usage', skeleton: 'usage', displayName: 'Nadia Bakes' } },
    },
    select: { pages: { select: { id: true } } },
  });
  pageId = account.pages[0]?.id ?? '';

  await write.usageCounter.createMany({
    data: [
      { pageId, period: '2026-09', count: 12 },
      // Last month's, which must not be counted into this month's.
      { pageId, period: '2026-08', count: 99 },
    ],
  });
});

describe('getConversationUsage', () => {
  it('counts this month, in the same period the API increments', async () => {
    // The API's counter keys on `now.toISOString().slice(0, 7)`, so this must
    // agree with it exactly: a different bucket would show an owner a number
    // nothing is enforcing.
    expect(await getConversationUsage(pageId, NOW)).toEqual({
      used: 12,
      cap: FREE_CONVERSATIONS_PER_MONTH,
      period: '2026-09',
    });
  });

  it('reads zero for a month with no conversations at all', async () => {
    const usage = await getConversationUsage(pageId, new Date('2026-11-02T00:00:00.000Z'));

    expect(usage).toEqual({ used: 0, cap: FREE_CONVERSATIONS_PER_MONTH, period: '2026-11' });
  });

  it('counts nothing for another page', async () => {
    const other = await write.account.create({
      data: {
        email: 'usage-other@example.com',
        pages: { create: { handle: 'usage-other', skeleton: 'usageother', displayName: 'Someone Else' } },
      },
      select: { pages: { select: { id: true } } },
    });

    expect((await getConversationUsage(other.pages[0]?.id ?? '', NOW)).used).toBe(0);
  });
});
```

Create `packages/db-read/src/payments.query.test.ts`:

```ts
import { beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { getRecentPayments, RECENT_PAYMENTS } from './payments.query.js';

const write = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });

let pageId = '';
let otherPageId = '';

beforeAll(async () => {
  await write.$executeRawUnsafe('TRUNCATE "Account" CASCADE');
  const account = await write.account.create({
    data: {
      email: 'payments@example.com',
      pages: { create: { handle: 'payments', skeleton: 'payments', displayName: 'Nadia Bakes' } },
    },
    select: { pages: { select: { id: true } } },
  });
  pageId = account.pages[0]?.id ?? '';

  const other = await write.account.create({
    data: {
      email: 'payments-other@example.com',
      pages: { create: { handle: 'pay-other', skeleton: 'payother', displayName: 'Someone Else' } },
    },
    select: { pages: { select: { id: true } } },
  });
  otherPageId = other.pages[0]?.id ?? '';

  // Seven, so the clamp has something to cut, with distinct createdAt values so
  // "newest first" is a fact about the query and not about insertion order.
  for (let index = 0; index < 7; index += 1) {
    await write.payment.create({
      data: {
        pageId,
        plan: 'MONTHLY',
        amountCents: 3900,
        billplzCollectionId: 'col-test',
        status: 'PAID',
        paidAt: new Date(Date.UTC(2026, 2, index + 1)),
        grantedUntil: new Date(Date.UTC(2026, 3, index + 1)),
        createdAt: new Date(Date.UTC(2026, 2, index + 1)),
      },
    });
  }

  await write.payment.create({
    data: {
      pageId: otherPageId,
      plan: 'ANNUAL',
      amountCents: 39000,
      billplzCollectionId: 'col-test',
      status: 'PAID',
      paidAt: new Date(Date.UTC(2026, 5, 1)),
      createdAt: new Date(Date.UTC(2026, 5, 1)),
    },
  });
});

describe('getRecentPayments', () => {
  it('returns the newest first, and no more than the screen shows', async () => {
    const payments = await getRecentPayments(pageId);

    expect(payments).toHaveLength(RECENT_PAYMENTS);
    expect(payments.map((payment) => payment.createdAt)).toEqual([
      new Date(Date.UTC(2026, 2, 7)),
      new Date(Date.UTC(2026, 2, 6)),
      new Date(Date.UTC(2026, 2, 5)),
      new Date(Date.UTC(2026, 2, 4)),
      new Date(Date.UTC(2026, 2, 3)),
    ]);
  });

  it('carries what the screen prints, and nothing more', async () => {
    const [newest] = await getRecentPayments(pageId);

    expect(newest).toEqual({
      id: expect.any(String),
      plan: 'MONTHLY',
      amountCents: 3900,
      status: 'PAID',
      paidAt: new Date(Date.UTC(2026, 2, 7)),
      grantedUntil: new Date(Date.UTC(2026, 3, 7)),
      createdAt: new Date(Date.UTC(2026, 2, 7)),
    });
  });

  it('never returns another page’s payments', async () => {
    // What someone paid is theirs. This is the same scoping rule the leads query
    // carries, for the same reason.
    const payments = await getRecentPayments(pageId);

    expect(payments.every((payment) => payment.amountCents === 3900)).toBe(true);
    expect(await getRecentPayments(otherPageId)).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Run them and watch them fail**

Run: `cd packages/db-read && npx vitest run src/usage.query.test.ts src/payments.query.test.ts`
Expected: both files fail to load — neither module exists.

- [ ] **Step 4: Implement**

Create `packages/db-read/src/usage.query.ts`:

```ts
import { conversationCap } from '@curios/core';
import { prismaRead } from './client.js';

export interface ConversationUsage {
  /** Conversations started this period. */
  used: number;
  /** The cap in force, as the API computes it. */
  cap: number;
  /** The period key, `YYYY-MM`. */
  period: string;
}

/**
 * This month's conversation usage for one page.
 *
 * The period is `now.toISOString().slice(0, 7)` because that is exactly what
 * `currentPeriod()` in the API's chat service uses to increment the counter.
 * Two different definitions of "this month" would show an owner a number that
 * nothing enforces, which is worse than showing no number at all.
 *
 * `conversationCap()` reads `CONVERSATION_CAP_PER_MONTH` at call time, so this
 * app and the API must be given the same value -- or both must leave it unset.
 *
 * `now` is a parameter for the same reason it is everywhere else here: a
 * function that reads the clock cannot be tested at a month boundary.
 */
export async function getConversationUsage(pageId: string, now: Date): Promise<ConversationUsage> {
  const period = now.toISOString().slice(0, 7);
  const counter = await prismaRead.usageCounter.findUnique({
    where: { pageId_period: { pageId, period } },
    select: { count: true },
  });

  return { used: counter?.count ?? 0, cap: conversationCap(), period };
}
```

Create `packages/db-read/src/payments.query.ts`:

```ts
import { prismaRead } from './client.js';

export interface OwnerPayment {
  id: string;
  plan: 'MONTHLY' | 'ANNUAL';
  amountCents: number;
  status: 'PENDING' | 'PAID';
  /** Null until a payment is granted, and null forever for one that never was. */
  paidAt: Date | null;
  /** The paidUntil this payment produced. */
  grantedUntil: Date | null;
  createdAt: Date;
}

/**
 * How many payments the billing screen lists. A fixed number rather than a
 * parameter: there is one caller, five rows is what the screen has room for,
 * and an unused limit argument is an untested code path.
 */
export const RECENT_PAYMENTS = 5;

/**
 * This page's most recent payments, newest first.
 *
 * Scoped to one page inside the query, the way the leads query is: what someone
 * paid is theirs, and a screen that could be handed the wrong page id should
 * still be unable to show another owner's money.
 *
 * Pending rows are included deliberately. A payment that was started and never
 * completed is the thing an owner is most likely to be asking about.
 */
export async function getRecentPayments(pageId: string): Promise<OwnerPayment[]> {
  return prismaRead.payment.findMany({
    where: { pageId },
    orderBy: { createdAt: 'desc' },
    take: RECENT_PAYMENTS,
    select: {
      id: true,
      plan: true,
      amountCents: true,
      status: true,
      paidAt: true,
      grantedUntil: true,
      createdAt: true,
    },
  });
}
```

Add to `packages/db-read/src/index.ts`:

```ts
export { getConversationUsage } from './usage.query.js';
export type { ConversationUsage } from './usage.query.js';
export { getRecentPayments, RECENT_PAYMENTS } from './payments.query.js';
export type { OwnerPayment } from './payments.query.js';
```

- [ ] **Step 5: Tell the owner's page whether the reset is still there**

The billing screen must not offer a reset that would be refused, and `trialResetAt` is the column that decides it. In `packages/db-read/src/owner-page.query.test.ts`, add to the existing `describe`:

```ts
  it('carries whether the one trial reset has been spent', async () => {
    const accountId = await anAccount({ published: true });
    const before = await getOwnerPage(accountId);
    expect(before?.trialResetAt).toBeNull();

    const spentAt = new Date('2026-09-17T02:00:00.000Z');
    await write.page.updateMany({ where: { accountId }, data: { trialResetAt: spentAt } });

    // Without this column the screen would offer a reset the API then refuses,
    // which is worse than not offering one.
    expect((await getOwnerPage(accountId))?.trialResetAt).toEqual(spentAt);
  });
```

`anAccount` and `write` are already defined in that file. Then in `packages/db-read/src/owner-page.query.ts`, add the field to the interface, after `leadsCaptured`:

```ts
  /** When the owner spent their one trial reset, or null while it is unspent. */
  trialResetAt: Date | null;
```

and to the `select`, after `leadsCaptured: true,`:

```ts
      trialResetAt: true,
```

`OwnerPage` has only required fields, so a new field breaks every object literal typed as one. Three exist, all test fixtures in `apps/web`: `app/app/layout.test.tsx`, `app/app/review/page.test.tsx` and `app/app/billing/page.test.tsx`. In each, add `trialResetAt: null,` as the fixture's last field, after `leadsCaptured: 0,`. Then search for others — `grep -rn "OwnerPage = {" apps packages` — and fix every one it finds: the list above was right when this plan was written, not necessarily now.

- [ ] **Step 6: Run them and watch them pass**

Run: `cd packages/db-read && npx vitest run src/usage.query.test.ts src/payments.query.test.ts src/owner-page.query.test.ts`
Expected: the six new query tests pass, and the owner-page file's existing tests still do.

- [ ] **Step 7: Prove the tests can fail**

Make each change, run the affected file, confirm the named test fails, then restore:

1. In `getConversationUsage`, slice 10 characters instead of 7 (`now.toISOString().slice(0, 10)`) — `'counts this month, in the same period the API increments'` fails, because the day-level key matches no counter.
2. In `getRecentPayments`, order `asc` instead of `desc` — `'returns the newest first'` fails.
3. In `getRecentPayments`, drop the `where` clause — `'never returns another page’s payments'` fails.
4. In `owner-page.query.ts`, remove `trialResetAt: true` from the `select` — `'carries whether the one trial reset has been spent'` fails.

- [ ] **Step 8: Package gates**

```bash
cd packages/db-read
npx vitest run; echo "TEST EXIT: $?"
npx tsc --noEmit; echo "TSC EXIT: $?"
npx eslint .; echo "LINT EXIT: $?"
```

Expected: all three exit 0, with the package's existing query tests still passing.

Then check the app whose fixtures you touched, because this package's `tsc` cannot see them:

```bash
cd apps/web
npx tsc --noEmit; echo "WEB TSC EXIT: $?"
npx vitest run app/app/layout.test.tsx app/app/review app/app/billing; echo "WEB TEST EXIT: $?"
```

Expected: both exit 0.

- [ ] **Step 9: Commit**

```bash
git add packages/db-read/src/usage.query.ts packages/db-read/src/usage.query.test.ts packages/db-read/src/payments.query.ts packages/db-read/src/payments.query.test.ts packages/db-read/src/owner-page.query.ts packages/db-read/src/owner-page.query.test.ts packages/db-read/src/index.ts packages/db-read/vitest.setup.ts apps/web/app/app/layout.test.tsx apps/web/app/app/review/page.test.tsx apps/web/app/app/billing/page.test.tsx
git commit -m "feat(db-read): this month's usage, and the payments behind a page's paid time"
```

---
### Task 5: One reset, for a page that never paid

**Files:**
- Modify: `apps/api/src/plugins/errors.ts`
- Modify: `apps/api/src/modules/billing/billing.service.ts`
- Modify: `apps/api/src/modules/billing/billing.routes.ts`
- Modify: `apps/api/src/modules/billing/billing.routes.test.ts`

**Interfaces:**
- Consumes: `Page.trialResetAt` (Task 1); the existing session guard and the per-account billing limiter.
- Produces:
  - `POST /billing/trial-reset` → `200 { status: 'reset' }`, or `409 { error: { code: 'TRIAL_RESET_USED' } }`
  - `class TrialResetUsedError` — `statusCode = 409`, `code = 'TRIAL_RESET_USED'`
  - `resetTrial(deps: { prisma: PrismaClient }, input: { accountId: string; now: Date }): Promise<void>`

This is the supported reset `deferred-findings.md` has owed since slice 8: the trial is spendable by anyone, the owner's own testing included, and until now the only cure was an operator running `psql`. One reset, only for a page that never paid, because a page that paid and lapsed owes a renewal rather than a second trial.

- [ ] **Step 1: Write the failing tests**

In `apps/api/src/modules/billing/billing.routes.test.ts`, at the end of the file, add:

```ts
describe('POST /billing/trial-reset', () => {
  const reset = (cookie: string | undefined) =>
    app.inject({
      method: 'POST',
      url: '/billing/trial-reset',
      remoteAddress: from(),
      cookies: cookie ? { [SESSION_COOKIE]: cookie } : {},
    });

  const pageRow = (pageId: string) =>
    app.prisma.page.findUniqueOrThrow({
      where: { id: pageId },
      select: { leadsCaptured: true, trialResetAt: true },
    });

  it('refuses a caller with no session', async () => {
    expect((await reset(undefined)).statusCode).toBe(401);
  });

  it('gives a spent trial back to a page that never paid', async () => {
    const owner = await anOwner();
    await app.prisma.page.update({ where: { id: owner.pageId }, data: { leadsCaptured: 3 } });

    const res = await reset(owner.cookie);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'reset' });
    const page = await pageRow(owner.pageId);
    expect(page.leadsCaptured).toBe(0);
    expect(page.trialResetAt).not.toBeNull();
  });

  it('refuses the second reset, and leaves the count where it was', async () => {
    // The whole point of the stamp: one reset, not one per click.
    const owner = await anOwner();
    await app.prisma.page.update({ where: { id: owner.pageId }, data: { leadsCaptured: 3 } });
    await reset(owner.cookie);
    await app.prisma.page.update({ where: { id: owner.pageId }, data: { leadsCaptured: 2 } });

    const res = await reset(owner.cookie);

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: { code: 'TRIAL_RESET_USED' } });
    expect((await pageRow(owner.pageId)).leadsCaptured).toBe(2);
  });

  it('refuses a page that has paid before, even one whose plan lapsed', async () => {
    // A lapsed page owes a renewal. A free trial back would be a discount
    // nobody decided to give.
    const owner = await anOwner();
    await app.prisma.page.update({
      where: { id: owner.pageId },
      data: { leadsCaptured: 3, paidUntil: new Date('2026-01-01T00:00:00.000Z') },
    });

    const res = await reset(owner.cookie);

    expect(res.statusCode).toBe(409);
    expect((await pageRow(owner.pageId)).leadsCaptured).toBe(3);
  });

  it('refuses a reset that would give nothing back', async () => {
    // Zero leads captured: resetting would spend the one reset on nothing, and
    // an owner who later needs it would find it gone.
    const owner = await anOwner();

    const res = await reset(owner.cookie);

    expect(res.statusCode).toBe(409);
    expect((await pageRow(owner.pageId)).trialResetAt).toBeNull();
  });

  it('refuses a personal page, which has no trial to reset', async () => {
    const owner = await anOwner('PERSONAL');
    await app.prisma.page.update({ where: { id: owner.pageId }, data: { leadsCaptured: 3 } });

    expect((await reset(owner.cookie)).statusCode).toBe(409);
  });
});
```

`anOwner`, `from` and `SESSION_COOKIE` are already defined in this file.

- [ ] **Step 2: Run them and watch them fail**

Run: `cd apps/api && npx vitest run src/modules/billing/billing.routes.test.ts`
Expected: the six new tests fail — the route does not exist, so every request 404s — and the existing tests in the file still pass.

- [ ] **Step 3: Allow-list the code**

In `apps/api/src/plugins/errors.ts`, directly after the entry `'PASSWORD_ALREADY_SET',`, add:

```ts
  // The one trial reset, already spent -- or asked for by a page that is not
  // entitled to it. 409 rather than 403: nothing is forbidden about the caller,
  // the thing they are asking for is simply gone. The message says which.
  'TRIAL_RESET_USED',
```

- [ ] **Step 4: The service**

In `apps/api/src/modules/billing/billing.service.ts`, directly after the `NotABusinessPageError` class, add:

```ts
export class TrialResetUsedError extends Error {
  readonly statusCode = 409;
  readonly code = 'TRIAL_RESET_USED';
  constructor() {
    super(
      'The free trial can be reset once, and only for a page that has never paid. Pay for a month to keep capturing leads.',
    );
    this.name = 'TrialResetUsedError';
  }
}
```

and at the end of the file add:

```ts
/**
 * Gives an owner their free trial back, once.
 *
 * One conditional update, and no read before it. Two clicks a moment apart both
 * reach the database; the first matches its `where` and the second does not,
 * because the first wrote `trialResetAt`. A read-then-write would let both pass
 * the check and hand out two trials.
 *
 * The conditions are the whole policy, and each is here for its own reason:
 * BUSINESS, because a personal page never captures; `paidUntil` null, because a
 * page that has paid owes a renewal rather than a second trial -- and null is
 * what "never paid" means on this column; `trialResetAt` null, because there is
 * exactly one; and at least one lead captured, because resetting at zero would
 * spend the reset on nothing and leave the owner without it when it mattered.
 *
 * Zero rows changed cannot tell us which condition failed, and deliberately does
 * not try: one message covering all of them is honest, where a read to find out
 * would reintroduce the race this avoids.
 */
export async function resetTrial(
  deps: { prisma: PrismaClient },
  input: { accountId: string; now: Date },
): Promise<void> {
  const reset = await deps.prisma.page.updateMany({
    where: {
      accountId: input.accountId,
      mode: 'BUSINESS',
      paidUntil: null,
      trialResetAt: null,
      leadsCaptured: { gte: 1 },
    },
    data: { leadsCaptured: 0, trialResetAt: input.now },
  });

  if (reset.count === 0) throw new TrialResetUsedError();
}
```

- [ ] **Step 5: The route**

In `apps/api/src/modules/billing/billing.routes.ts`, change the import from `./billing.service.js` to bring in both functions:

```ts
import { createBillForOwner, resetTrial } from './billing.service.js';
```

and inside `ownerBillingRoutes`, directly after the `app.post('/billing/bills', ...)` call, add:

```ts
  app.post(
    '/billing/trial-reset',
    { schema: { response: { 200: z.object({ status: z.string() }), 409: errorSchema } } },
    async (request, reply) => {
      if (!request.account) throw new UnauthenticatedError();

      await resetTrial({ prisma: app.prisma }, { accountId: request.account.id, now: new Date() });
      // The account and the outcome. Which page it was is derivable from the
      // account, and a reset is worth being able to find in the log: it is the
      // one place the product gives something away.
      request.log.info({ accountId: request.account.id }, 'free trial reset by owner');
      return reply.send({ status: 'reset' });
    },
  );
```

It sits inside `ownerBillingRoutes` rather than in a scope of its own, which puts it behind the session hook and the per-account billing limiter already registered around that plugin in `app.ts`. Ten requests an hour is generous for an action that can succeed once, and it costs nothing to have.

- [ ] **Step 6: Run them and watch them pass**

Run: `cd apps/api && npx vitest run src/modules/billing/billing.routes.test.ts`
Expected: 21 passed — the 15 already in the file (plan 1's 13, plus the two its final review added), plus these 6.

- [ ] **Step 7: Prove the tests can fail**

Make each change, run the file, confirm the named test fails, then restore:

1. Remove `trialResetAt: null` from the `where` — `'refuses the second reset'` fails.
2. Remove `paidUntil: null` — `'refuses a page that has paid before'` fails.
3. Remove `leadsCaptured: { gte: 1 }` — `'refuses a reset that would give nothing back'` fails.
4. Remove `mode: 'BUSINESS'` — `'refuses a personal page'` fails.
5. In `errors.ts`, remove `'TRIAL_RESET_USED',` — `'refuses the second reset'` fails on the code, which arrives as `INTERNAL_ERROR`.

Five mutations for five conditions, because each one is a policy decision that a future edit could quietly drop.

- [ ] **Step 8: The whole API suite and gates**

```bash
cd apps/api
npx vitest run; echo "TEST EXIT: $?"
npx tsc --noEmit; echo "TSC EXIT: $?"
npx eslint src/modules/billing src/plugins/errors.ts; echo "LINT EXIT: $?"
```

Expected: all three exit 0, with every existing API test still passing.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/plugins/errors.ts apps/api/src/modules/billing/billing.service.ts apps/api/src/modules/billing/billing.routes.ts apps/api/src/modules/billing/billing.routes.test.ts
git commit -m "feat(api): one supported trial reset, for a page that never paid"
```

---
### Task 6: The reminder, claimed before it is sent

**Files:**
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/index.ts`
- Create: `apps/workers/src/billing/renewal-reminder.ts`
- Create: `apps/workers/src/billing/renewal-reminder.test.ts`
- Modify: `apps/workers/src/billing/pending-check.ts`
- Modify: `apps/workers/src/billing/pending-check.test.ts`
- Modify: `apps/workers/src/main.ts`

**Interfaces:**
- Consumes: `Page.renewalReminderFor` (Task 1); `MailJobData`, `MAIL_QUEUE` and `BILLING_QUEUE` from `@curios/core`; the billing worker and `scheduleBillingJobs` from plan 1.
- Produces:
  - `RENEWAL_REMINDER_JOB = 'renewal-reminder'` in `@curios/core`
  - `REMINDER_WINDOW_MS` (3 days)
  - `buildRenewalReminder(input: { displayName: string; paidUntil: Date; appUrl: string }): { subject: string; text: string }`
  - `runRenewalReminders(deps: { prisma: PrismaClient; mailQueue: MailQueueLike; now: Date; appUrl: string; log?: BillingLog }): Promise<{ reminded: number }>`
  - `createBillingWorker` gains `mailQueue` and `appUrl` dependencies; `scheduleBillingJobs` registers a second schedule.

There is no auto-renew on this rail — FPX cannot auto-charge — so an owner who does nothing simply stops capturing leads. The reminder exists so that is a decision rather than a surprise.

- [ ] **Step 1: The job name**

Append to `packages/core/src/types.ts`, directly after `PENDING_CHECK_JOB`:

```ts
/** The daily reminder that a plan is about to end. Scheduled jobs carry no data. */
export const RENEWAL_REMINDER_JOB = 'renewal-reminder';
```

In `packages/core/src/index.ts`, add `RENEWAL_REMINDER_JOB` to the existing export list from `./types.js`, keeping it alphabetical:

```ts
export {
  BILLING_QUEUE,
  FACT_CATEGORIES,
  INGEST_QUEUE,
  LEAD_QUEUE,
  MAIL_QUEUE,
  PENDING_CHECK_JOB,
  RENEWAL_REMINDER_JOB,
} from './types.js';
```

- [ ] **Step 2: Write the failing tests**

Create `apps/workers/src/billing/renewal-reminder.test.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { buildRenewalReminder, runRenewalReminders, type MailQueueLike } from './renewal-reminder.js';

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });

const NOW = new Date('2026-09-17T02:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60_000;
const APP_URL = 'https://curios.example';
const inDays = (days: number) => new Date(NOW.getTime() + days * DAY_MS);

function aMailQueue() {
  return { add: vi.fn<MailQueueLike['add']>(async () => ({ id: 'queued' })) };
}

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE "Account" CASCADE');
});

async function aPage(options: {
  paidUntil: Date | null;
  mode?: 'BUSINESS' | 'PERSONAL';
  renewalReminderFor?: Date | null;
}) {
  const slug = `rem-${randomUUID().slice(0, 8)}`;
  const account = await prisma.account.create({
    data: {
      email: `renewal-${randomUUID()}@example.com`,
      pages: {
        create: {
          handle: slug,
          skeleton: slug,
          displayName: 'Nadia Bakes',
          mode: options.mode ?? 'BUSINESS',
          paidUntil: options.paidUntil,
          renewalReminderFor: options.renewalReminderFor ?? null,
        },
      },
    },
    select: { email: true, pages: { select: { id: true } } },
  });
  return { email: account.email, pageId: account.pages[0]?.id ?? '' };
}

const reminderMark = async (pageId: string) =>
  (
    await prisma.page.findUniqueOrThrow({
      where: { id: pageId },
      select: { renewalReminderFor: true },
    })
  ).renewalReminderFor;

describe('runRenewalReminders', () => {
  it('emails an owner whose plan ends in two days, and marks the period done', async () => {
    const paidUntil = inDays(2);
    const page = await aPage({ paidUntil });
    const mailQueue = aMailQueue();

    const result = await runRenewalReminders({ prisma, mailQueue, now: NOW, appUrl: APP_URL });

    expect(result).toEqual({ reminded: 1 });
    expect(mailQueue.add).toHaveBeenCalledTimes(1);
    const [, mail] = mailQueue.add.mock.calls[0] ?? [];
    expect(mail?.to).toBe(page.email);
    expect(mail?.text).toContain(`${APP_URL}/app/billing`);
    expect(await reminderMark(page.pageId)).toEqual(paidUntil);
  });

  it('never sends a second reminder for the same period', async () => {
    const paidUntil = inDays(2);
    const page = await aPage({ paidUntil });

    await runRenewalReminders({ prisma, mailQueue: aMailQueue(), now: NOW, appUrl: APP_URL });
    const second = aMailQueue();
    const result = await runRenewalReminders({ prisma, mailQueue: second, now: NOW, appUrl: APP_URL });

    expect(result).toEqual({ reminded: 0 });
    expect(second.add).not.toHaveBeenCalled();
    expect(await reminderMark(page.pageId)).toEqual(paidUntil);
  });

  it('reminds again once the owner has renewed, because the period moved', async () => {
    // No reminders table: the mark is the paidUntil it was for, so paying moves
    // the page back into eligibility by itself.
    const page = await aPage({ paidUntil: inDays(2), renewalReminderFor: inDays(2) });
    await prisma.page.update({ where: { id: page.pageId }, data: { paidUntil: inDays(2.5) } });
    const mailQueue = aMailQueue();

    expect(await runRenewalReminders({ prisma, mailQueue, now: NOW, appUrl: APP_URL })).toEqual({
      reminded: 1,
    });
  });

  it('reminds a plan ending exactly three days out', async () => {
    await aPage({ paidUntil: new Date(NOW.getTime() + 3 * DAY_MS) });
    const mailQueue = aMailQueue();

    await runRenewalReminders({ prisma, mailQueue, now: NOW, appUrl: APP_URL });

    expect(mailQueue.add).toHaveBeenCalledTimes(1);
  });

  it('leaves a plan a minute further out for tomorrow’s run', async () => {
    await aPage({ paidUntil: new Date(NOW.getTime() + 3 * DAY_MS + MINUTE_MS) });
    const mailQueue = aMailQueue();

    await runRenewalReminders({ prisma, mailQueue, now: NOW, appUrl: APP_URL });

    expect(mailQueue.add).not.toHaveBeenCalled();
  });

  it('says nothing to a plan that has already ended', async () => {
    // A lapse is the leads screen's and the billing screen's to explain. An
    // email about it a day late is a reminder of nothing.
    await aPage({ paidUntil: new Date(NOW.getTime() - MINUTE_MS) });
    const mailQueue = aMailQueue();

    await runRenewalReminders({ prisma, mailQueue, now: NOW, appUrl: APP_URL });

    expect(mailQueue.add).not.toHaveBeenCalled();
  });

  it('says nothing to a personal page, which pays nothing', async () => {
    await aPage({ paidUntil: inDays(2), mode: 'PERSONAL' });
    const mailQueue = aMailQueue();

    await runRenewalReminders({ prisma, mailQueue, now: NOW, appUrl: APP_URL });

    expect(mailQueue.add).not.toHaveBeenCalled();
  });

  it('keeps the claim when the email cannot be queued, losing one rather than sending two', async () => {
    // Claimed first, emailed second. If this order were reversed, a queue
    // failure would leave the page unmarked and tomorrow's run would email
    // again -- and a crash between the two would send twice.
    const paidUntil = inDays(2);
    const page = await aPage({ paidUntil });
    const failing = { add: vi.fn<MailQueueLike['add']>(async () => { throw new Error('redis is gone'); }) };

    await expect(
      runRenewalReminders({ prisma, mailQueue: failing, now: NOW, appUrl: APP_URL }),
    ).rejects.toThrow('redis is gone');

    expect(await reminderMark(page.pageId)).toEqual(paidUntil);
  });
});

describe('buildRenewalReminder', () => {
  const mail = buildRenewalReminder({
    displayName: 'Nadia Bakes',
    // 20:00 UTC is already the next day in Kuala Lumpur.
    paidUntil: new Date('2026-09-19T20:00:00.000Z'),
    appUrl: `${APP_URL}/`,
  });

  it('names the shop and the Malaysian calendar day the plan ends', () => {
    expect(mail.subject).toContain('Nadia Bakes');
    expect(mail.subject).toContain('20 September 2026');
    expect(mail.text).toContain('20 September 2026');
  });

  it('links to billing, with no double slash from a trailing one', () => {
    expect(mail.text).toContain(`${APP_URL}/app/billing`);
    expect(mail.text).not.toContain('//app/billing');
  });

  it('does not promise a charge that cannot happen', () => {
    // FPX cannot auto-charge. An email implying money will be taken is both
    // untrue and the fastest way to lose an owner's trust.
    expect(mail.text).toContain('not charge you automatically');
    expect(mail.text.toLowerCase()).not.toContain('will be renewed');
  });

  it('says what keeps working, so nobody reads it as the page going dark', () => {
    expect(mail.text).toContain('Only the capture card stops');
  });
});
```

In `apps/workers/src/billing/pending-check.test.ts`, inside `describe('scheduleBillingJobs')`, add:

```ts
  it('schedules the reminder daily at 10:00 Malaysian time', async () => {
    // Without the zone, BullMQ reads the pattern in the server's own zone, and
    // an email meant for mid-morning arrives at 6pm or at 2am.
    const queue = { upsertJobScheduler: vi.fn<SchedulerQueue['upsertJobScheduler']>(async () => ({})) };

    await scheduleBillingJobs(queue);

    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      'renewal-reminder',
      { pattern: '0 10 * * *', tz: 'Asia/Kuala_Lumpur' },
      { name: 'renewal-reminder' },
    );
  });
```

- [ ] **Step 3: Run them and watch them fail**

Run: `cd apps/workers && npx vitest run src/billing`
Expected: `renewal-reminder.test.ts` fails to load — the module does not exist — and the new scheduling test fails because only the hourly schedule is registered. The eight existing pending-check tests still pass.

If instead every database test fails with `relation "Account" does not exist`, restore the tmpfs test database from the repo root before reading anything into the result:

```bash
DATABASE_URL="$(grep '^DATABASE_URL_TEST=' .env | cut -d= -f2-)" pnpm --filter @curios/db exec prisma migrate deploy
docker exec -i curios-postgres-test psql -U curios -d curios_test < packages/db/prisma/sql/readonly-role.sql
```

- [ ] **Step 4: Implement the reminder**

Create `apps/workers/src/billing/renewal-reminder.ts`:

```ts
import type { MailJobData } from '@curios/core';
import { MAIL_QUEUE } from '@curios/core';
import type { PrismaClient } from '@curios/db';
import type { BillingLog } from './pending-check.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How far ahead an owner is warned. Three days is long enough to act on and
 * short enough that the page is still working when it arrives -- a reminder a
 * fortnight early is filed and forgotten.
 */
export const REMINDER_WINDOW_MS = 3 * DAY_MS;

/**
 * The slice of a BullMQ queue this job needs. Structurally identical to the
 * lead worker's, and deliberately declared again rather than shared: each
 * worker naming the two things it uses is clearer than a queue-shaped module
 * imported across features, and there is no logic here to keep in step.
 */
export interface MailQueueLike {
  add(name: string, data: MailJobData, opts?: unknown): Promise<{ id?: string }>;
}

/** The plan's end date as an owner in Malaysia reads it. */
function malaysianDate(date: Date): string {
  return date.toLocaleDateString('en-MY', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Kuala_Lumpur',
  });
}

/**
 * The reminder itself. Pure, like `buildNotification` in the lead worker, so the
 * wording is testable without a queue or a database.
 *
 * English, because the dashboard is: the lead notification mirrors the visitor's
 * own language because it quotes their conversation back to the owner, and this
 * email quotes nobody.
 *
 * The one thing this email must not do is imply an automatic charge. FPX cannot
 * auto-charge, so nothing will be taken -- and an owner who believes otherwise
 * finds out by losing their capture card.
 */
export function buildRenewalReminder(input: {
  displayName: string;
  paidUntil: Date;
  appUrl: string;
}): { subject: string; text: string } {
  const ends = malaysianDate(input.paidUntil);
  const billing = `${input.appUrl.replace(/\/+$/, '')}/app/billing`;

  return {
    subject: `Your Curios plan for ${input.displayName} ends on ${ends}`,
    text: [
      `Your Curios plan for ${input.displayName} ends on ${ends}.`,
      '',
      'We do not charge you automatically — FPX payments need your approval each time, so nothing will be taken from your account.',
      '',
      'To keep the capture card on your page, pay for another month or year here:',
      billing,
      '',
      'If you do nothing, your page, your FAQ pages and chat all keep working. Only the capture card stops.',
    ].join('\n'),
  };
}

/**
 * Warns owners whose plan ends within the window, once per period.
 *
 * Claimed first, emailed second. The claim is a conditional update writing the
 * page's own `paidUntil` into `renewalReminderFor`, so two runs at once produce
 * one email, and a crash after the claim loses that email rather than sending a
 * second tomorrow. Losing one is the gentler failure: both screens still show
 * the end date, and an owner emailed twice about the same thing stops reading.
 *
 * There is no reminders table because there does not need to be one: paying
 * moves `paidUntil`, and a page whose mark no longer equals its `paidUntil` is
 * eligible again by construction.
 */
export async function runRenewalReminders(deps: {
  prisma: PrismaClient;
  mailQueue: MailQueueLike;
  now: Date;
  appUrl: string;
  log?: BillingLog;
}): Promise<{ reminded: number }> {
  const due = await deps.prisma.page.findMany({
    where: {
      mode: 'BUSINESS',
      paidUntil: { gt: deps.now, lte: new Date(deps.now.getTime() + REMINDER_WINDOW_MS) },
    },
    select: {
      id: true,
      displayName: true,
      paidUntil: true,
      account: { select: { email: true } },
    },
    orderBy: { paidUntil: 'asc' },
  });

  let reminded = 0;
  for (const page of due) {
    const paidUntil = page.paidUntil;
    if (paidUntil === null) continue;

    // The claim, and the only guard. There is deliberately no check of the mark
    // in front of it, so the test that proves one reminder per period is a test
    // of this update rather than of a shortcut before it. A page already
    // reminded costs one update that changes no rows, at most three days running.
    // `paidUntil` is in the `where` too, so an owner who renews between the read
    // above and this write is not marked for a period that is no longer theirs.
    // The explicit null branch is here rather than a bare `not`, so the query
    // does not depend on how NULL compares in an inequality.
    const claim = await deps.prisma.page.updateMany({
      where: {
        id: page.id,
        paidUntil,
        OR: [{ renewalReminderFor: null }, { renewalReminderFor: { not: paidUntil } }],
      },
      data: { renewalReminderFor: paidUntil },
    });
    if (claim.count === 0) continue;

    const mail = buildRenewalReminder({
      displayName: page.displayName,
      paidUntil,
      appUrl: deps.appUrl,
    });
    await deps.mailQueue.add(MAIL_QUEUE, {
      to: page.account.email,
      subject: mail.subject,
      text: mail.text,
    });

    reminded += 1;
    // The page and the period, never the address: an owner's email in a log is
    // an owner's email in every log aggregator downstream of it.
    deps.log?.info({ pageId: page.id, paidUntil: paidUntil.toISOString() }, 'renewal reminder queued');
  }

  return { reminded };
}
```

- [ ] **Step 5: Schedule it, and route the job**

In `apps/workers/src/billing/pending-check.ts`:

1. Change the `@curios/core` import to bring in the new job name:

```ts
import { BILLING_QUEUE, PENDING_CHECK_JOB, RENEWAL_REMINDER_JOB } from '@curios/core';
```

2. Add, after the existing imports:

```ts
import { runRenewalReminders, type MailQueueLike } from './renewal-reminder.js';
```

3. Widen `SchedulerQueue`'s repeat argument so a schedule can name its zone:

```ts
export interface SchedulerQueue {
  upsertJobScheduler(
    id: string,
    repeat: { pattern: string; tz?: string },
    template: { name: string },
  ): Promise<unknown>;
}
```

4. Give the worker the two dependencies the reminder needs, and route by job name:

```ts
export function createBillingWorker(deps: {
  connection: IORedis;
  prisma: PrismaClient;
  client: BillplzClient;
  mailQueue: MailQueueLike;
  appUrl: string;
  log?: BillingLog;
}): Worker {
  return new Worker(
    BILLING_QUEUE,
    async (job) => {
      if (job.name === PENDING_CHECK_JOB) {
        await runPendingCheck({ prisma: deps.prisma, client: deps.client, now: new Date(), log: deps.log });
      }
      if (job.name === RENEWAL_REMINDER_JOB) {
        await runRenewalReminders({
          prisma: deps.prisma,
          mailQueue: deps.mailQueue,
          now: new Date(),
          appUrl: deps.appUrl,
          log: deps.log,
        });
      }
    },
    { connection: deps.connection, concurrency: QUEUE_CONCURRENCY.billing },
  );
}
```

5. Add the second schedule:

```ts
/** Upserted under fixed ids, so a restart replaces the schedules instead of adding more. */
export async function scheduleBillingJobs(queue: SchedulerQueue): Promise<void> {
  await queue.upsertJobScheduler(PENDING_CHECK_JOB, { pattern: '0 * * * *' }, { name: PENDING_CHECK_JOB });
  // 10:00 in Malaysia, named explicitly: without `tz` BullMQ reads the pattern
  // in the server's zone, and a mid-morning email arrives at 2am.
  await queue.upsertJobScheduler(
    RENEWAL_REMINDER_JOB,
    { pattern: '0 10 * * *', tz: 'Asia/Kuala_Lumpur' },
    { name: RENEWAL_REMINDER_JOB },
  );
}
```

- [ ] **Step 6: Wire it into the process**

In `apps/workers/src/main.ts`:

1. Directly after the `BILLPLZ_BASE_URL` check, add:

```ts
const appUrl = process.env.APP_URL;
if (!appUrl) throw new Error('APP_URL is not set');
```

2. Give the billing worker its two new dependencies. The mail queue is the producer this file already builds for the lead worker — one producer, both consumers:

```ts
const billingWorker = createBillingWorker({
  connection: createRedis(),
  prisma,
  client: createBillplzClient({ apiKey: billplzApiKey, baseUrl: billplzBaseUrl }),
  mailQueue: mailProducer,
  appUrl,
  log,
});
```

- [ ] **Step 7: Run them and watch them pass**

Run: `cd apps/workers && npx vitest run src/billing`
Expected: 22 passed — 8 pending-check, 2 scheduling, 8 reminder runs, 4 reminder copy.

- [ ] **Step 8: Prove the tests can fail**

Make each change, run the affected file, confirm the named test fails, then restore:

1. Swap the claim and the send — enqueue the mail before the `updateMany` — `'keeps the claim when the email cannot be queued'` fails, because the page is left unmarked.
2. Remove the `OR` from the claim's `where` — `'never sends a second reminder for the same period'` fails. It can only fail because nothing else stands in front of the claim; if it passes, check that no pre-check of `renewalReminderFor` has crept in before the update.
3. Change `lte` to `lt` in the window — `'reminds a plan ending exactly three days out'` fails.
4. Change `gt: deps.now` to `gte: new Date(0)` — `'says nothing to a plan that has already ended'` fails.
5. Drop `tz` from the daily schedule — `'schedules the reminder daily at 10:00 Malaysian time'` fails.
6. In `buildRenewalReminder`, drop the `replace(/\/+$/, '')` — `'links to billing, with no double slash'` fails.

- [ ] **Step 9: The whole workers suite and gates**

```bash
cd apps/workers
npx vitest run; echo "TEST EXIT: $?"
npx tsc --noEmit; echo "TSC EXIT: $?"
npx eslint src/billing src/main.ts; echo "LINT EXIT: $?"
```

Expected: all three exit 0. `tsc` also proves `main.ts` passes every dependency the widened `createBillingWorker` now requires.

- [ ] **Step 10: Commit**

```bash
git add packages/core/src/types.ts packages/core/src/index.ts apps/workers/src/billing apps/workers/src/main.ts
git commit -m "feat(workers): a daily reminder, claimed before it is sent"
```

---
### Task 7: The billing screen an owner can act on

**Files:**
- Modify: `apps/web/app/app/billing/billing-copy.ts`
- Modify: `apps/web/app/app/billing/billing-copy.test.ts`
- Create: `apps/web/app/app/billing/reset-button.tsx`
- Create: `apps/web/app/app/billing/reset-button.test.tsx`
- Modify: `apps/web/app/app/billing/page.tsx`
- Modify: `apps/web/app/app/billing/page.test.tsx`

**Interfaces:**
- Consumes: `getConversationUsage`, `getRecentPayments`, `ConversationUsage`, `OwnerPayment` and `OwnerPage.trialResetAt` (Task 4); `POST /billing/trial-reset` and its `TRIAL_RESET_USED` code (Task 5); `planState`, `PLAN_PRICES_CENTS`, and plan 1's `PayButtons`, `planSummary`, `paymentBanner`, `ringgit`, `formatDate`.
- Produces: the finished `/app/billing`. Nothing else consumes it.

Plan 1's screen said where the plan stood and offered two buttons. This one adds the three things an owner asks next: how much of the month they have used, what they have paid, and — for a page that has never paid — one way to undo a trial they spent testing their own page.

- [ ] **Step 1: Write the failing tests**

Add to `apps/web/app/app/billing/billing-copy.test.ts`:

```ts
describe('usageSummary', () => {
  it('counts this month against the cap in force', () => {
    expect(usageSummary({ used: 12, cap: 200, period: '2026-09' })).toBe(
      '12 of 200 conversations used this month.',
    );
  });

  it('adds nothing at exactly the cap, where chat still answers normally', () => {
    // The API refuses only above the cap (isOverCap is `>`), so the 200th
    // conversation of 200 was answered by the model like any other.
    expect(usageSummary({ used: 200, cap: 200, period: '2026-09' })).toBe(
      '200 of 200 conversations used this month.',
    );
  });

  it('says what happens past the cap, because chat has already changed', () => {
    // Over the cap the API answers with a fixed reply instead of the model. An
    // owner seeing "201 of 200" without that sentence would think nothing had.
    expect(usageSummary({ used: 201, cap: 200, period: '2026-09' })).toBe(
      '201 of 200 conversations used this month. Chat is answering with a short fixed reply until next month.',
    );
  });
});

describe('planSummary, after a lapse', () => {
  it('tells a page that lapsed with free leads left that its plan ended', () => {
    // The leads screen says both halves of this (trial-notice.tsx). This
    // screen saying only "free trial" would tell the same owner otherwise.
    expect(
      planSummary(stateOf({ paidUntil: new Date('2026-08-01T00:00:00.000Z'), leadsCaptured: 1 })),
    ).toBe(
      `Your plan ended on 1 August 2026. You have ${FREE_LEADS - 1} free leads left before the capture card stops.`,
    );
  });
});

describe('paymentLine', () => {
  const base = {
    id: 'pay-1',
    plan: 'MONTHLY' as const,
    amountCents: 3900,
    status: 'PAID' as const,
    // The two dates fall on different Malaysian calendar days on purpose: 20:00
    // UTC is already the 12th in Kuala Lumpur, 10:00 UTC is still the 11th. With
    // both on one day, the started-date expectation below could never appear and
    // the mutation that dates a paid payment by createdAt could not fail.
    paidAt: new Date('2026-09-11T20:00:00.000Z'),
    grantedUntil: new Date('2026-10-12T00:00:00.000Z'),
    createdAt: new Date('2026-09-11T10:00:00.000Z'),
  };

  it('dates a paid payment by when it was paid, in Malaysian time', () => {
    // 20:00 UTC is already the 12th in Kuala Lumpur.
    expect(paymentLine(base)).toBe('12 September 2026 — RM39 for a month, paid');
  });

  it('dates an unfinished payment by when it was started, and says so', () => {
    expect(paymentLine({ ...base, status: 'PENDING', paidAt: null, grantedUntil: null })).toBe(
      '11 September 2026 — RM39 for a month, not completed',
    );
  });

  it('names the annual plan by its period, not its price', () => {
    expect(paymentLine({ ...base, plan: 'ANNUAL', amountCents: 39000 })).toBe(
      '12 September 2026 — RM390 for a year, paid',
    );
  });
});
```

and extend that file's import to `import { formatDate, paymentBanner, paymentLine, planSummary, ringgit, usageSummary } from './billing-copy.js';`.

Create `apps/web/app/app/billing/reset-button.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../../lib/api.js';
import { ResetTrialForm, resetError } from './reset-button.js';

describe('ResetTrialForm', () => {
  it('resets, then re-reads the screen rather than guessing locally', async () => {
    const onReset = vi.fn(async () => undefined);
    const refresh = vi.fn();
    render(<ResetTrialForm onReset={onReset} refresh={refresh} />);

    await userEvent.click(screen.getByRole('button', { name: 'Reset my free trial' }));

    expect(onReset).toHaveBeenCalledTimes(1);
    // The count lives on the server. Refreshing is how the notice, the summary
    // and the button itself all agree about what just happened.
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('shows the API’s own sentence when the reset is already gone', async () => {
    const onReset = vi.fn(async () => {
      throw new ApiError(
        409,
        'TRIAL_RESET_USED',
        'The free trial can be reset once, and only for a page that has never paid. Pay for a month to keep capturing leads.',
      );
    });
    render(<ResetTrialForm onReset={onReset} refresh={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: 'Reset my free trial' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('can be reset once');
  });

  it('does not refresh when the reset failed', async () => {
    const refresh = vi.fn();
    render(
      <ResetTrialForm
        onReset={vi.fn(async () => {
          throw new ApiError(409, 'TRIAL_RESET_USED', 'Already used.');
        })}
        refresh={refresh}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Reset my free trial' }));

    await screen.findByRole('alert');
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe('resetError', () => {
  it('passes any other API message through unchanged', () => {
    expect(resetError(new ApiError(429, 'RATE_LIMITED', 'Too many payment attempts. Try again in 1 hour.'))).toBe(
      'Too many payment attempts. Try again in 1 hour.',
    );
  });
});
```

In `apps/web/app/app/billing/page.test.tsx`, replace the `@curios/db-read` mock and add the reset-button mock, so the mocks at the top read:

```tsx
const getOwnerPage = vi.fn();
const getConversationUsage = vi.fn();
const getRecentPayments = vi.fn();
vi.mock('@curios/db-read', () => ({ getOwnerPage, getConversationUsage, getRecentPayments }));

// Both client components are recorded rather than rendered: these tests are
// about what the page decides to offer, not about what those two do with it.
const PayButtons = vi.fn((_props: { options: { plan: string; label: string }[] }) => null);
vi.mock('./pay-buttons.js', () => ({ PayButtons }));
const ResetTrial = vi.fn(() => null);
vi.mock('./reset-button.js', () => ({ ResetTrial }));
```

confirm the `page` fixture carries the new column — Task 4 added `trialResetAt: null` to it — so it reads:

```tsx
const page: OwnerPage = {
  id: 'p1',
  handle: 'nadia',
  displayName: 'Nadia Bakes',
  published: true,
  mode: 'BUSINESS',
  paidUntil: null,
  leadsCaptured: 0,
  trialResetAt: null,
};
```

give `renderWith` the two new reads and reset the new mocks in `beforeEach`:

```tsx
async function renderWith(owned: OwnerPage | null, payment?: string) {
  getOwnerPage.mockResolvedValueOnce(owned);
  render(await BillingPage({ searchParams: Promise.resolve({ payment }) }));
}
```

```tsx
  beforeEach(() => {
    getOwnerPage.mockReset();
    resolveOwner.mockReset();
    PayButtons.mockClear();
    ResetTrial.mockClear();
    getConversationUsage.mockReset();
    getRecentPayments.mockReset();
    getConversationUsage.mockResolvedValue({ used: 12, cap: 200, period: '2026-09' });
    getRecentPayments.mockResolvedValue([]);
    resolveOwner.mockResolvedValue({ accountId: 'acc1' });
  });
```

and add these tests to the `describe('BillingPage')` block:

```tsx
  it('shows this month’s usage against the cap', async () => {
    await renderWith(page);

    expect(screen.getByText('12 of 200 conversations used this month.')).toBeInTheDocument();
    expect(getConversationUsage).toHaveBeenCalledWith('p1', expect.any(Date));
  });

  it('lists what has been paid', async () => {
    getRecentPayments.mockResolvedValue([
      {
        id: 'pay-1',
        plan: 'MONTHLY',
        amountCents: 3900,
        status: 'PAID',
        paidAt: new Date('2026-09-11T20:00:00.000Z'),
        grantedUntil: new Date('2026-10-12T00:00:00.000Z'),
        createdAt: new Date('2026-09-11T10:00:00.000Z'),
      },
    ]);

    await renderWith(page);

    expect(screen.getByText('12 September 2026 — RM39 for a month, paid')).toBeInTheDocument();
  });

  it('offers the reset to a page that never paid and spent leads testing itself', async () => {
    await renderWith({ ...page, leadsCaptured: 3 });

    expect(ResetTrial).toHaveBeenCalledTimes(1);
  });

  it('withholds the reset once it has been used', async () => {
    await renderWith({
      ...page,
      leadsCaptured: 3,
      trialResetAt: new Date('2026-09-01T00:00:00.000Z'),
    });

    // Offering a button the API answers 409 to is worse than offering none.
    expect(ResetTrial).not.toHaveBeenCalled();
  });

  it('withholds the reset from a page that has paid before', async () => {
    await renderWith({
      ...page,
      leadsCaptured: 3,
      paidUntil: new Date('2026-01-01T00:00:00.000Z'),
    });

    expect(ResetTrial).not.toHaveBeenCalled();
  });

  it('withholds the reset from a page with nothing to give back', async () => {
    await renderWith({ ...page, leadsCaptured: 0 });

    expect(ResetTrial).not.toHaveBeenCalled();
  });

  it('reads no usage or payments for a personal page', async () => {
    await renderWith({ ...page, mode: 'PERSONAL' });

    // Nothing to show, so nothing to ask the database for.
    expect(getConversationUsage).not.toHaveBeenCalled();
    expect(getRecentPayments).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd apps/web && npx vitest run app/app/billing`
Expected: `billing-copy.test.ts` fails on the two missing exports and on the lapsed wording, `reset-button.test.tsx` fails to load, and `page.test.tsx` fails because the page neither reads usage nor renders a reset.

- [ ] **Step 3: The copy**

Add to `apps/web/app/app/billing/billing-copy.ts`:

```ts
import type { ConversationUsage, OwnerPayment } from '@curios/db-read';
```

at the top, beside the existing `@curios/core` import, and at the end of the file:

```ts
/**
 * Conversations this month against the cap in force.
 *
 * Over the cap, chat answers with a short fixed reply rather than the model --
 * that has already happened by the time an owner reads this, so the number
 * alone would understate it.
 */
export function usageSummary(usage: ConversationUsage): string {
  const counted = `${usage.used} of ${usage.cap} conversations used this month.`;
  return usage.used > usage.cap
    ? `${counted} Chat is answering with a short fixed reply until next month.`
    : counted;
}

/**
 * One line of payment history.
 *
 * A paid payment is dated by when it was paid; one that never completed is
 * dated by when it was started, because it has no payment date and the owner
 * remembers starting it. "Not completed" rather than "failed": most of these
 * are a bill someone opened and closed, not a payment that went wrong.
 */
export function paymentLine(payment: OwnerPayment): string {
  const period = payment.plan === 'ANNUAL' ? 'a year' : 'a month';
  const amount = ringgit(payment.amountCents);

  return payment.status === 'PAID' && payment.paidAt !== null
    ? `${formatDate(payment.paidAt)} — ${amount} for ${period}, paid`
    : `${formatDate(payment.createdAt)} — ${amount} for ${period}, not completed`;
}
```

This file is imported only by `page.tsx`, a Server Component, so a type import from `@curios/db-read` costs the browser nothing.

Then change the `trial` case of the existing `planSummary` from

```ts
    case 'trial':
      return `You are on the free trial: ${state.used} of ${FREE_LEADS} free leads used.`;
```

to

```ts
    case 'trial':
      // A trial can outlive a subscription -- planState's `lapsedOn`. Calling it
      // a plain free trial would tell an owner who has paid that they never did,
      // and the leads screen, which says both halves, would disagree with this.
      return state.lapsedOn
        ? `Your plan ended on ${formatDate(state.lapsedOn)}. You have ${state.remaining} free leads left before the capture card stops.`
        : `You are on the free trial: ${state.used} of ${FREE_LEADS} free leads used.`;
```

- [ ] **Step 4: The reset button**

Create `apps/web/app/app/billing/reset-button.tsx`:

```tsx
'use client';

import { Button, Callout } from '@curios/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ApiError, apiFetch } from '../../../lib/api.js';

/**
 * The API's 409 already says exactly what happened and what to do instead, and
 * it is a 4xx, so `errorsPlugin` leaves the message alone. Anything else falls
 * back to a sentence rather than showing an owner a stack-shaped string.
 */
export function resetError(failure: unknown): string {
  if (failure instanceof ApiError) return failure.message;
  return failure instanceof Error ? failure.message : 'Something failed. Try again.';
}

/**
 * Presentational half of the wrapper split, the shape of `PayButtonsForm` and
 * `AddPasswordForm`. Refreshing is the caller's, so a test can watch for it.
 */
export function ResetTrialForm({
  onReset,
  refresh,
}: {
  onReset: () => Promise<unknown>;
  refresh: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function reset() {
    setError('');
    setBusy(true);
    try {
      await onReset();
      // Re-reads the Server Component, so the count, the plan summary and this
      // button all agree -- the same reason the questions screen refreshes.
      refresh();
    } catch (failure) {
      setError(resetError(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <Button busy={busy} onClick={() => void reset()}>
        Reset my free trial
      </Button>
      {error ? <Callout tone="error">{error}</Callout> : null}
    </div>
  );
}

/** Supplies the real handlers. A Server Component may not pass a function here. */
export function ResetTrial() {
  const router = useRouter();
  return (
    <ResetTrialForm
      onReset={() => apiFetch('/billing/trial-reset', { method: 'POST' })}
      refresh={() => router.refresh()}
    />
  );
}
```

- [ ] **Step 5: The screen**

Replace the body of `apps/web/app/app/billing/page.tsx` with:

```tsx
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { PLAN_PRICES_CENTS, planState, SESSION_COOKIE } from '@curios/core';
import { getConversationUsage, getOwnerPage, getRecentPayments } from '@curios/db-read';
import { Callout, Shell } from '@curios/ui';
import { resolveOwner } from '../session.js';
import { paymentBanner, paymentLine, planSummary, ringgit, usageSummary } from './billing-copy.js';
import { PayButtons } from './pay-buttons.js';
import { ResetTrial } from './reset-button.js';

/**
 * Where the plan stands, what the month has used, what has been paid, and the
 * two things an owner can do about any of it: pay, or -- once, and only for a
 * page that never paid -- take back a trial they spent testing their own page.
 *
 * `searchParams` is a Promise in Next 15 and must be awaited, as in
 * settings/page.tsx.
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

  const now = new Date();
  const state = planState({
    mode: page.mode,
    paidUntil: page.paidUntil,
    leadsCaptured: page.leadsCaptured,
    now,
  });
  const banner = paymentBanner(params.payment);

  // A personal page pays nothing and is capped like any other, but has no
  // billing story to tell -- so it is asked for neither number.
  const usage = state.kind === 'personal' ? null : await getConversationUsage(page.id, now);
  const payments = state.kind === 'personal' ? [] : await getRecentPayments(page.id);

  // Exactly the conditions the API enforces (billing.service.ts, resetTrial).
  // A button that leads to a 409 is worse than no button.
  const canReset =
    page.mode === 'BUSINESS' &&
    page.paidUntil === null &&
    page.trialResetAt === null &&
    page.leadsCaptured >= 1;

  return (
    <Shell title="Billing">
      {banner ? <Callout tone={banner.tone}>{banner.text}</Callout> : null}
      <p>{planSummary(state)}</p>
      {usage ? <p>{usageSummary(usage)}</p> : null}
      {state.kind === 'personal' ? null : (
        <PayButtons
          options={[
            { plan: 'MONTHLY', label: `Pay ${ringgit(PLAN_PRICES_CENTS.MONTHLY)} for a month` },
            { plan: 'ANNUAL', label: `Pay ${ringgit(PLAN_PRICES_CENTS.ANNUAL)} for a year` },
          ]}
        />
      )}
      {canReset ? (
        <section>
          <h2>Spent your trial testing your own page?</h2>
          <p>
            Every lead counts, including the ones you captured yourself. You can put the counter
            back to zero once, and only while the page has never paid.
          </p>
          <ResetTrial />
        </section>
      ) : null}
      {payments.length > 0 ? (
        <section>
          <h2>Recent payments</h2>
          <ul>
            {payments.map((payment) => (
              <li key={payment.id}>{paymentLine(payment)}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </Shell>
  );
}
```

- [ ] **Step 6: Run them and watch them pass**

Run: `cd apps/web && npx vitest run app/app/billing`
Expected: 38 passed — 19 copy, 4 pay buttons, 4 reset, 11 page. If the count differs, report the actual numbers rather than adjusting a test.

- [ ] **Step 7: Prove the tests can fail**

Make each change, run the billing tests, confirm the named test fails, then restore:

1. In `page.tsx`, drop `page.trialResetAt === null` from `canReset` — `'withholds the reset once it has been used'` fails.
2. Drop `page.paidUntil === null` from `canReset` — `'withholds the reset from a page that has paid before'` fails.
3. In `usageSummary`, compare `>=` instead of `>` — `'adds nothing at exactly the cap'` fails, because 200 of 200 would gain the fixed-reply sentence while chat is still answering normally.
4. In `paymentLine`, date a paid payment by `createdAt` — `'dates a paid payment by when it was paid'` fails.
5. In `ResetTrialForm`, call `refresh()` outside the `try` — `'does not refresh when the reset failed'` fails.
6. In `planSummary`, ignore `lapsedOn` — `'tells a page that lapsed with free leads left that its plan ended'` fails.
7. In `page.tsx`, drop `page.leadsCaptured >= 1` from `canReset` — `'withholds the reset from a page with nothing to give back'` fails.
8. In `page.tsx`, remove the personal-page short-circuit so usage and payments are always read — `'reads no usage or payments for a personal page'` fails.

Mutations 7 and 8 exist because those two tests assert an absence, and an absence is true before the code that could break it is written: both passed in the RED run, so only a mutation shows they can fail.

- [ ] **Step 8: The whole web suite and gates**

```bash
cd apps/web
npx vitest run; echo "TEST EXIT: $?"
npx tsc --noEmit; echo "TSC EXIT: $?"
npx eslint app/app/billing; echo "LINT EXIT: $?"
```

Expected: all three exit 0. One existing test in this package, `app/[handle]/budget.test.ts`, reads Next's build manifest from `.next`; if it complains that the manifest lists no files for a route, the build in `.next` is stale — run `pnpm --filter @curios/web build` once and re-run, and say so in your report.

- [ ] **Step 9: Commit**

```bash
git add apps/web/app/app/billing
git commit -m "feat(web): usage, payment history and the one trial reset on /app/billing"
```

---
### Task 8: The documents this slice makes wrong

**Files:**
- Modify: `devDocs/README.md`
- Modify: `devDocs/BACKEND.md`
- Modify: `devDocs/FRONTEND.md`
- Modify: `devDocs/OPERATIONS.md`
- Modify: `devDocs/deferred-findings.md`
- Modify: `devDocs/manual-verification-billing.md`
- Modify: `.env.example`

**Interfaces:**
- Consumes: everything Tasks 1–7 built, and plan 1's money path.
- Produces: documents that describe the product as it now is. Nothing imports these; the reason they are a task rather than an afterthought is that plan 1 deliberately deferred them here, and a reader of these files today would conclude none of slice 9 shipped.

There is no test for prose. What there is instead: every claim added below is one you can check against a named file, and the reviewer of this task is asked to check them.

- [ ] **Step 1: README's settled decisions**

In `devDocs/README.md`, in the Settled decisions table, replace the final sentence of the **Free trial** row — `The trial is spendable by anyone, the owner's own testing included, so the leads screen shows how much is left and \`OPERATIONS.md\` documents a manual reset; a supported reset is still owed to slice 9. See deferred-findings.md.` — with:

```
The trial is spendable by anyone, the owner's own testing included, so the leads screen shows how much is left and the owner can reset it once, on `/app/billing`, while the page has never paid. A page that paid and lapsed owes a renewal instead. `OPERATIONS.md` keeps the `psql` reset for every other case.
```

and add a new row directly after the **Plans** row:

```
| Granting paid time | One step, three callers. Billplz's callback and the browser's redirect both verify an X Signature and go through `grantPayment` (`packages/billing/src/grant.ts`), which binds the bill to the `Payment` row it was raised for, claims that row `PENDING → PAID` with a conditional update, and locks the page before extending `paidUntil`. An hourly check asks Billplz about payments still pending, because Billplz gives up after five callback attempts. Two arrivals for one bill grant once; two payments for one page both count. |
```

- [ ] **Step 2: BACKEND's billing section**

In `devDocs/BACKEND.md`, at the end of the `## Metering and billing` section — directly before `## Abuse and injection` — add:

```markdown
### Granting paid time

Three things can tell us a bill was paid: Billplz's callback, the redirect the
browser follows back, and an hourly check that asks about payments still
pending. All three go through one function, `grantPayment` in
`packages/billing/src/grant.ts`, and nothing else writes `Page.paidUntil`.

**Binding comes before granting.** A bill is looked up by `billplzBillId`, which
is unique, so an arrival for a bill we never raised grants nothing. It must also
match the collection and the exact `amountCents` stored when the bill was raised
-- never today's price, which may have changed -- and, when the evidence came
from fetching the bill rather than from the callback, its `reference_1` must be
that payment's own id.

**Then one transaction.** The payment is claimed with a conditional update from
`PENDING` to `PAID`; a second arrival for the same bill changes no rows and
stops there. The page row is locked with `SELECT ... FOR UPDATE` before
`paidUntil` is read, so two payments landing together for one page both extend
it instead of one overwriting the other. `extendPaidUntil` counts calendar
months from whichever is later, now or the current `paidUntil`.

**Why the hourly check exists.** Billplz retries a failed callback four times
and then stops, about a day after the first attempt. If the API is down for that
long, the owner has paid and nothing has granted it. The check scans `PENDING`
payments with a bill id, created between two hours and seven days ago, fetches
each bill, and grants through the same step.

**What the callback answers.** 400 for a missing or wrong signature, and 200 for
everything else -- an unpaid bill and a mismatched amount are both things no
retry can fix. An unexpected failure is allowed to become a 500 on purpose, so
Billplz retries in fifteen seconds rather than leaving the payment to the hourly
check. The callback body carries the payer's email and mobile, so only the bill
id and the outcome are ever logged.
```

- [ ] **Step 3: FRONTEND's screen list and capture card**

In `devDocs/FRONTEND.md`:

1. In the screen list, change the `/app/billing` line so its description matches what the screen now shows, and align it with the lines above it:

```
/app/billing              plan, usage against cap, payments, trial reset
```

2. Change the sentence ending `paying is slice 9's \`/app/billing\`.` to:

```
paying is `/app/billing`, which also shows the month's usage against the cap, recent payments, and — once, for a page that has never paid — a way to put the trial counter back to zero.
```

- [ ] **Step 4: OPERATIONS' reset runbook**

In `devDocs/OPERATIONS.md`, in `## Resetting a page's free-lead trial`:

1. Replace the paragraph beginning `**The leads screen now shows an owner how much of the trial is left, but nothing stops them spending it on their own tests**` with:

```markdown
**Most of this is now the owner's to do.** `/app/billing` offers a reset while the
page has never paid and has captured at least one lead, and it can be used once
(`Page.trialResetAt`). This procedure is what remains: a page that already used
its reset, a page that paid and lapsed, or anything else where you need to know
what happened before changing it.
```

2. In the table of situations, change the first row's Action from `Reset, if the leads were tests` to:

```
Owner can reset it themselves on /app/billing, unless `trialResetAt` is set
```

and add `\"trialResetAt\"` to the `SELECT` in step 1 so you can see whether they can:

```bash
docker exec -i curios-postgres psql -U curios -d curios -c \
  "SELECT handle, mode, published, \"leadsCaptured\", \"paidUntil\", \"trialResetAt\" FROM \"Page\" WHERE handle = 'HANDLE';"
```

3. In `### 3. Do not reach for \`paidUntil\` instead`, replace `Once slice 9 exists there will be a \`Payment\` table that is supposed to account for every paid page, and this row will not reconcile against it — by then the reason will be a year old and nobody will remember.` with:

```
The `Payment` table now accounts for every paid page, and a hand-written `paidUntil` reconciles against nothing in it — by the time anyone asks, the reason will be a year old and nobody will remember.
```

and replace `Wait for slice 9's billing surface, or write down who authorised it and why alongside the change.` with:

```
Write down who authorised it and why alongside the change, and prefer giving them a bill they do not have to pay over inventing paid time.
```

4. Replace the whole of `### Retire this when` with:

```markdown
### Retire this when

Mostly retired already: the owner's own reset on `/app/billing` covers the case
this was written for — an owner who spent the trial testing their own page and
has never paid. What is left has no owner-facing equivalent and probably should
not have one: a second reset, and anything touching a page that has paid. Retire
the rest if an admin screen ever grows a supported way to do those, with the
record of who did it that a `psql` statement cannot carry.
```

- [ ] **Step 5: deferred-findings**

In `devDocs/deferred-findings.md`:

1. Change the heading `### A page's free trial is spendable by anyone, including its owner — counter and runbook shipped, a supported reset still owed` to:

```
### A page's free trial is spendable by anyone, including its owner — resolved in slice 9
```

2. Replace the paragraph beginning `**Still owed, and slice 9's:** a *supported* reset.` and its following paragraph (`Worth considering there, not required: ...`) with:

```markdown
**Shipped in slice 9's plan 2:** the supported reset. `POST /billing/trial-reset`
(`apps/api/src/modules/billing/billing.service.ts`) is one conditional update —
BUSINESS, `paidUntil` null, `trialResetAt` null, at least one lead captured — and
the button is on `/app/billing`. It can be used once, and a page that paid and
lapsed is refused with `TRIAL_RESET_USED`: that page owes a renewal, not a second
trial.

Still open, and still not required: a per-page limit on `POST /leads` to match
chat's 30/hour, and whether paying should consume the remaining trial — see
`plan.test.ts`'s pay, capture twice, lapse case. Neither blocks anything.
```

3. Move the whole section under the `## Resolved` heading, keeping it in that section's existing order — the same treatment the other resolved findings in this file received.

- [ ] **Step 6: The walkthrough's two new checks**

In `devDocs/manual-verification-billing.md`, add two rows to the coverage table, after row 7:

```
| 8 | The renewal reminder reaches the owner's inbox three days out | `renewal-reminder.test.ts` — 'emails an owner whose plan ends in two days, and marks the period done'; 'never sends a second reminder for the same period' | **Yes** — only a real mail run proves an email arrives |
| 9 | The owner can reset a spent trial once, and only before they have ever paid | `billing.routes.test.ts` — 'gives a spent trial back to a page that never paid'; 'refuses the second reset, and leaves the count where it was'; `page.test.tsx` — 'withholds the reset once it has been used' | **Partly** — the button and the refreshed screen |
```

and add two checks before `## Recording the result`:

````markdown
### 8. The renewal reminder

The schedule fires at 10:00 Malaysian time, which is no use to a walkthrough, so run
the job directly against a page you have set up:

```bash
docker exec -i curios-postgres psql -U curios -d curios -c \
  "UPDATE \"Page\" SET \"paidUntil\" = now() + interval '2 days', \"renewalReminderFor\" = NULL WHERE handle = 'YOURHANDLE';"
```

With the workers running, wait for the next 10:00, or restart them after setting the
schedule's pattern to `'* * * * *'` locally — and put it back afterwards. In the workers'
log, look for `renewal reminder queued` with that page's id, and in Mailpit
(`http://localhost:8075` — `docker-compose.yml` maps Mailpit's web port there, not to 8025) for a message whose subject names the shop and the end date.

The email must **not** say anything will be charged automatically. If it does, the copy
is wrong and this check has failed, whatever else worked: FPX cannot auto-charge, and an
owner who believes otherwise finds out by losing their capture card.

Run the job a second time without changing anything. No second email may appear.

### 9. The trial reset, once

On a business page that has never paid, capture a lead (or set `"leadsCaptured" = 3`
directly), then open `/app/billing`. Press **Reset my free trial**. The count returns to
zero on the leads screen, and the capture card comes back on the public page after a
qualifying conversation.

Press it again — the button should be gone, because the screen reads `trialResetAt`. If
you call the endpoint directly a second time, it must answer 409 `TRIAL_RESET_USED`.

```bash
docker exec -i curios-postgres psql -U curios -d curios -c \
  "SELECT \"leadsCaptured\", \"trialResetAt\" FROM \"Page\" WHERE handle = 'YOURHANDLE';"
```
````

- [ ] **Step 7: `.env.example`**

In `.env.example`:

1. Extend the comment above `CONVERSATION_CAP_PER_MONTH` with a line about the second reader:

```
# Read by the API when a conversation starts and by the web app when it renders
# /app/billing, so give both the same value or leave it unset in both. A screen
# showing a cap the API does not enforce is worse than a screen showing none.
```

2. In the Billplz block, correct the sentence `The API refuses to start without these, and so do the workers (which need the API key and base URL only).` to:

```
# The API refuses to start without these, and so do the workers -- which need
# the API key and base URL, plus APP_URL above, because the renewal reminder
# links back to /app/billing.
```

- [ ] **Step 8: Check every claim you just wrote**

Documents drift because nobody checks them. Before committing, verify each name this task asserts:

```bash
grep -rn "grantPayment" packages/billing/src/grant.ts | head -3
grep -rn "trialResetAt" packages/db/prisma/schema.prisma apps/api/src/modules/billing/billing.service.ts | head -4
grep -rn "TRIAL_RESET_USED" apps/api/src/plugins/errors.ts apps/api/src/modules/billing/billing.service.ts | head -3
grep -rn "renewal reminder queued" apps/workers/src/billing/renewal-reminder.ts
grep -rn "Reset my free trial" apps/web/app/app/billing/reset-button.tsx
grep -rn "emails an owner whose plan ends in two days" apps/workers/src/billing/renewal-reminder.test.ts
grep -rn "gives a spent trial back to a page that never paid" apps/api/src/modules/billing/billing.routes.test.ts
grep -rn "withholds the reset once it has been used" apps/web/app/app/billing/page.test.tsx
```

Every one must print a match. A citation that does not resolve is the defect this step exists to catch — fix the document, not the grep.

- [ ] **Step 9: The workspace gates**

```bash
pnpm turbo run test --concurrency=1 --force > /tmp/p2-test.log 2>&1; echo "TEST EXIT: $?"
grep -E "^\s*(Tasks|Cached|Failed):" /tmp/p2-test.log
pnpm turbo run typecheck --concurrency=1 --force > /tmp/p2-tc.log 2>&1; echo "TYPECHECK EXIT: $?"
pnpm turbo run lint --concurrency=1 --force > /tmp/p2-lint.log 2>&1; echo "LINT EXIT: $?"
```

Expected: all three exit 0, with 9 successful of 9 total and 0 cached. Call turbo directly as written: `pnpm typecheck -- --force` passes `--force` to `tsc`, which fails every package with `TS5093`.

- [ ] **Step 10: Commit**

```bash
git add devDocs .env.example
git commit -m "docs: the reminder, the reset and the grant step, described as built"
```

---

## What plan 2 does not close

- **Plan 1's sandbox round trip.** `devDocs/manual-verification-billing.md` still reads `Status: NOT RUN`, and checks 1–4 need a person with Billplz sandbox credentials and a browser. Nothing in this plan changes that, and no amount of passing tests substitutes for it: they prove we implement the documented signature construction, not that Billplz signs the way its documentation says.
- **Whether the reminder email actually arrives.** Check 8 above is the only thing that can tell you, and it needs a person and a mail run.
- **A second reset, or a reset for a page that has paid.** Deliberately operator-only, in `OPERATIONS.md`.
