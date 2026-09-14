# Slice 9 — Getting paid

> Intended path: `devDocs/slice-9-build-spec.md`

Slice 8 created the state "a business page that has not paid" and stopped capture on it.
Nothing can pay yet. This slice takes the money: an owner pays RM39 for a month or RM390 for
a year through a one-off Billplz FPX bill, and `Page.paidUntil` moves forward.

It is the first slice where a bug costs someone money, and almost all of the risk sits in one
route: a callback that anyone on the internet can POST to, and that grants paid time. Most of
this document is about making that route boring.

One spec, two plans, run back to back. **Plan 1** is the money path — a bill, a verified grant,
and the check that catches a payment Billplz stopped telling us about. **Plan 2** is the owner
experience — reminders, the trial reset, the full billing screen, the copy. Neither ships alone,
and slice 8 cannot ship without this: a spent trial with nowhere to pay stops capture for good.

---

## What is in, what is out

| In | Out |
|---|---|
| `POST /billing/bills` — start a payment | An admin surface. Operators keep `OPERATIONS.md`'s `psql` reset |
| `POST /billing/billplz/callback` and `GET /billing/billplz/return` — grant it | Refunds, cancellation, proration. Paying again extends |
| A `Payment` table, and one shared grant step | Card or auto-debit recurring billing |
| An hourly check for payments still pending | Personal pages paying |
| A daily renewal reminder email | E-invoicing — see below |
| `/app/billing` | A per-page rate limit on `POST /leads` |
| An owner's one-time trial reset, for pages that never paid | Logging malformed OAuth callbacks |

**E-invoicing is out, and flagged rather than forgotten.** Malaysian e-invoicing rules may apply
once this takes real money from businesses. That is a question for an accountant, not a code
decision, and this slice relies on the receipt email Billplz sends the payer.

---

## Settled before this slice, and not reopened

- **Rails, plans and price** — README's Settled decisions. One-off FPX bills only; monthly is
  renewed by hand; RM39 a month, RM390 a year, personal free.
- **Paid state is a date.** `Page.paidUntil`, no subscription model — slice 8.
- **The trial rule does not change.** A page that paid, lapsed, and still has unused trial leads
  keeps them. `canCapture` and `planState` keep their OR.

---

## Billplz, verified 2026-09-14 against the official API docs

Checked at `support.billplz.com/api`, not recalled, because a previous Billplz integration's
notes disagreed with each other about the signature.

**Creating a bill.** `POST {BILLPLZ_BASE_URL}/api/v3/bills`, HTTP Basic auth with the API secret
key as the username and no password. Amounts are integers **in cents**. Required: `collection_id`,
`email` (or `mobile`), `name`, `amount`, `callback_url`, `description` (at most 200 characters).
`reference_1_label` (at most 20) and `reference_1` (at most 120) exist to tie a bill to the
merchant's own record. Sandbox is `https://www.billplz-sandbox.com`, production
`https://www.billplz.com`, with separate keys.

**The callback.** A form-encoded POST carrying `id`, `collection_id`, `paid`, `state`, `amount`,
`paid_amount`, `due_at`, `email`, `mobile`, `name`, `url`, `paid_at`, `x_signature`, and — only
sometimes — `transaction_id` and `transaction_status`. It does **not** carry `reference_1`. `state` is
`due`, `deleted` or `paid`; `paid` is `true` only for paid bills. The endpoint must answer
**HTTP 200 within 20 seconds**. Otherwise Billplz retries at 15 seconds, 15 minutes, 15 minutes
and 24 hours, and **after the fifth attempt drops the callback for good**. The callback and the
browser redirect arrive in no fixed order.

**The signature.** HMAC-SHA256, keyed with the collection's X Signature Key, over every parameter
except `x_signature`. Each key is concatenated directly to its value, the pairs are sorted
ascending and case-insensitively, and the pairs are joined with `|`.

**The redirect carries far less than the callback:** only `billplz[id]`, `billplz[paid]`,
`billplz[paid_at]` and `billplz[x_signature]`, plus `billplz[transaction_id]` and
`billplz[transaction_status]` when present. No amount, no collection, no state, no reference. The docs
show its keys hashed with the prefix kept and the brackets dropped — `billplz[id]` becomes `billplzid`.

**The signature covers whatever parameters arrived.** The transaction fields appear only sometimes,
so verification hashes the received set, never a hard-coded field list; a fixed list would reject
every genuine payment that happens to carry them. Payment Orders use HMAC-SHA512, which this
slice does not touch.

**The docs' worked example cannot be a test vector.** The published page obfuscates its example
email address, and nowhere states the signing key. So nothing in the docs lets a test prove we sign
the way Billplz does — see *Done means a real sandbox payment*.

---

## What a previous Billplz integration already learned

Three bugs from the `invoice` project, each now a requirement here rather than a lesson:

1. **A bill must be bound to what it pays for.** That project accepted any bill that was paid, so a
   RM1 bill could mark a RM5000 invoice paid. Here every grant checks the bill against the
   `Payment` we created for it.
2. **The amount is compared against what was billed.** Not against a price computed at callback
   time, which can have changed since the bill was raised.
3. **The signature check has no way around it.** A lookup failure there skipped verification and
   marked the invoice paid anyway. Here a missing or wrong signature always refuses, and the key
   is required at boot.

---

## Data

```prisma
enum BillingPlan {
  MONTHLY
  ANNUAL
}

enum PaymentStatus {
  PENDING
  PAID
}

model Payment {
  id                  String        @id @default(cuid())
  pageId              String
  /// Restrict, not Cascade like every other table here: a payment is a financial
  /// record, and it must not disappear as a side effect of removing a page.
  page                Page          @relation(fields: [pageId], references: [id], onDelete: Restrict)
  plan                BillingPlan
  /// What was billed, fixed at creation. A callback is checked against this --
  /// never against today's price, which may have changed since.
  amountCents         Int
  /// Fixed at creation for the same reason, so a later change of collection
  /// cannot break callbacks for bills already issued.
  billplzCollectionId String
  /// Filled from Billplz's response. Unique, so one bill can never grant twice;
  /// nullable, because a failed call to Billplz leaves a pending row without one.
  billplzBillId       String?       @unique
  status              PaymentStatus @default(PENDING)
  paidAt              DateTime?
  /// The paidUntil this payment produced. An audit trail for every extension.
  grantedUntil        DateTime?
  createdAt           DateTime      @default(now())

  @@index([status, createdAt])
  @@index([pageId, createdAt])
}
```

On `Page`, in plan 2:

- `trialResetAt DateTime?` — set when the owner uses their one reset. **"Never paid" means
  `paidUntil` is null**, the definition slice 8 already wrote on that column; no new flag.
- `renewalReminderFor DateTime?` — the `paidUntil` value last reminded about. Renewing changes
  `paidUntil`, which makes the next period eligible by itself, with no reminders table.

`Page` cascades from `Account`, so with `Restrict` on `Payment`, deleting an account that has paid
fails rather than silently taking its payments. That is the intended consequence: erasing a paying
account becomes a deliberate operator act. Nothing deletes a page or an account today — checked, in
Prisma calls and raw SQL alike — so this breaks no existing path, and the test suites'
`TRUNCATE "Account" CASCADE` is unaffected, because `TRUNCATE` does not apply `ON DELETE` rules.
`Page` gains the `payments Payment[]` relation Prisma requires.

In `@curios/core`:

```ts
export const PLAN_PRICES_CENTS = { MONTHLY: 3900, ANNUAL: 39000 } as const;

export function extendPaidUntil(input: {
  paidUntil: Date | null;
  now: Date;
  plan: 'MONTHLY' | 'ANNUAL';
}): Date;
```

Prices are constants, not env vars, for `FREE_LEADS`'s reason: a promise printed on a pricing page.
`extendPaidUntil` counts from whichever is later — `now` or the current `paidUntil` — and adds one
**calendar** month or year in UTC, clamped to the end of a shorter month: Jan 31 plus a month is
Feb 28, or Feb 29 in a leap year; Feb 29 plus a year is Feb 28. A fixed 30 days would cost a
monthly owner about five days a year. `now` is a parameter, so the boundaries can be tested.

---

## The money path — plan 1

**1. Starting a payment: `POST /billing/bills` with `{ plan: 'MONTHLY' | 'ANNUAL' }`.** It requires
a session and carries a per-account rate limit, `RATE_LIMIT_BILLING_PER_ACCOUNT` (10 an hour by default), keyed exactly as
ingest's per-page limiter keys: on `request.account?.id`, falling back to the caller's address and
never to a constant. An owner with no page yet gets the existing `NoPageError` — `NO_PAGE`, 404, the code every owner route uses (`PAGE_NOT_FOUND`
is the visitor chat's); a personal page is
refused with a new `NOT_A_BUSINESS_PAGE` (400). `request.account` carries only an id, so the route
loads the page and the account's email itself.

It creates the `Payment` as `PENDING` with the amount from `PLAN_PRICES_CENTS` and the configured
collection, then calls Billplz with the account's email, the page's display name as `name`, a `description`
like `Curios Business, 1 month — Nadia Bakes` cut to 200 characters, `reference_1_label: 'Payment'`, `reference_1` set to the
payment's id, `callback_url` from `BILLPLZ_CALLBACK_URL` and `redirect_url` from
`BILLPLZ_REDIRECT_URL`. It stores the returned bill id and responds `{ url }`, and the pay button
sends the browser there. If Billplz fails, it responds 502 with a new `BILLPLZ_UNAVAILABLE` code and a message the owner can act
on, and
the pending row, which has no bill id, is harmless.

**2. The redirect lands on the API, not the web app.** The web app holds a SELECT-only database
connection and cannot grant anything. Billplz sends the browser to `GET /billing/billplz/return`,
which verifies the redirect's signature, then fetches the bill once with `GET /api/v3/bills/{id}` —
the redirect carries no amount or collection to bind against — runs the grant step, and redirects to
`/app/billing?payment=` one of:

- `paid` — the signature verified, the bill was paid, and it is granted (now or already).
- `failed` — the signature verified and the bill was not paid.
- `pending` — anything else: an unverifiable signature, or a bill that does not match.

This is the same shape as the Google OAuth callback, which also finishes on the API and hands the
browser back to the app.

**3. The callback: `POST /billing/billplz/callback`,** in its own route group. The API has no form
parser today, so one is registered **in that group only**, built on `URLSearchParams` so every value
reaches the signature exactly as Billplz sent it, with no dependency added. It has no per-IP rate
limit: every genuine retry comes from Billplz's addresses, and a forged request costs one HMAC to
refuse. It answers quickly:

- **Missing or wrong signature** — 400, logged at error.
- **Verified, but not paid** — 200, no change. Billplz reports failed attempts too.
- **Verified, but unknown or mismatched** — 200 and logged at error. A retry cannot fix it.
- **Verified and paid** — granted, or already granted — 200.

---

## One grant step, three callers

The callback, the redirect and the hourly check all call one function in `@curios/billing`, which
takes a Prisma client so the API and the workers can both use it. The two apps never import each
other.

1. **Proof the bill is from Billplz.** The callback and the redirect verify their signatures, always,
   compared in constant time; a missing key is a boot failure, not a skipped check. The redirect then
   fetches the bill. The hourly check verifies no signature, because it fetched the bill itself over
   HTTPS with our API key.
2. **Binding**, against a bill from one of two places: the callback's own fields, or the `GET`
   response for the redirect and the hourly check.

   | Check | Callback | Redirect and hourly check |
   |---|---|---|
   | The bill id matches exactly one `Payment` (the unique `billplzBillId`) | ✓ | ✓ |
   | `collection_id` and `paid_amount` equal what was stored | ✓ | ✓ |
   | `paid` is true and `state` is `paid` | ✓ | ✓ |
   | `reference_1` is that payment's id | — not carried | ✓ |

   The callback needs no reference: the unique bill id already maps it to exactly one payment, and
   the check is simply made wherever the field exists. Any mismatch refuses, and is logged at error.
3. **One transaction.**
   - Flip that payment from `PENDING` to `PAID` with a conditional update. If it changes zero rows,
     another caller already granted it: stop, successfully.
   - Lock the page row with `SELECT ... FOR UPDATE`.
   - Compute the new date with `extendPaidUntil`, and write `Page.paidUntil` and
     `Payment.grantedUntil` and `paidAt`.

**This race is closed, where slice 8's was accepted.** Two payments for one page landing together
would otherwise both read the old `paidUntil`, and one of those months would silently vanish. Slice 8
accepted at most one extra free lead; losing time somebody paid for is not the same trade. The lock
keeps the date rule in `packages/core` rather than restating it as SQL.

---

## The scheduled job

The repo's first. A `BILLING_QUEUE` name lives in `@curios/core` beside the other queue names, and
the workers create two schedules at startup with BullMQ's `upsertJobScheduler` — upserted under a
fixed id, so a restart cannot pile up duplicate schedules.

**Hourly — the pending check (plan 1),** `pattern: '0 * * * *'`. `Payment` rows that are `PENDING`, have a bill id, and were
created between 2 hours and 7 days ago. Each is fetched with `GET /api/v3/bills/{id}`, bound, and
granted through the same step.

This exists because of the fifth attempt. If every callback fails — the API down for a day — Billplz
stops, and without this the owner has paid and nothing ever grants it. The window needs no
"abandoned" status: an unpaid bill ages out of it, and a callback dropped after its last retry, about
24 hours after the first, is still inside it.

**Daily at 10:00 Malaysia time — reminders (plan 2),** `pattern: '0 10 * * *'` with
`tz: 'Asia/Kuala_Lumpur'`. Business pages whose `paidUntil` is later than
now and at most 3 days away, and whose `renewalReminderFor` is not already that `paidUntil`. Each page
is **claimed first** — a conditional update setting `renewalReminderFor` to its `paidUntil` — and
**emailed second**, onto the existing `mail` queue. A crash between the two loses that one email and
can never send two; the screens still show the end date, so a lost email is the gentler failure.

The email is built by a pure function returning `{ subject, text }`, the way `notify.ts` builds the
lead notification, and links to `{APP_URL}/app/billing`. It is the first worker email that links back
to the app.

---

## What the owner sees

**`/app/billing`, plan 1:** the page's state from `planState`, the paid-through date, the monthly and
annual buttons, and a banner for `?payment=paid`, `pending` or `failed`.

**`/app/billing`, plan 2:** conversation usage this month against the cap, from a new `db-read` query
over `UsageCounter` and `conversationCap()` called server-side; recent payments; and the reset.

`conversationCap()` reads `CONVERSATION_CAP_PER_MONTH` when called, so **the web app and the API must be
given the same value, or both leave it unset.** Otherwise the screen shows a cap the API does not
enforce.

**A Billing link in the nav.** `app-nav.test.tsx` fails until `/app/billing/page.tsx` exists, which is
the check it was written for.

**The reset — `POST /billing/trial-reset`, plan 2,** behind the session guard. One conditional update
sets `leadsCaptured` to 0 and `trialResetAt` to now, and only where the page is `BUSINESS`,
`paidUntil` is null, `trialResetAt` is null, and `leadsCaptured` is at least 1 — a reset at zero would
spend the one reset on nothing. Zero rows changed refuses with a new `TRIAL_RESET_USED` domain code,
a 409, beside `PASSWORD_ALREADY_SET`. With no read before the write, two clicks cannot both reset. The
button is on `/app/billing`, and the trial notice links to it once the trial is spent.

**Copy, plan 2.** "Until you subscribe" gains its link to billing. A page that paid, lapsed, and still
has unused trial leads is told its subscription ended and how many free leads remain: `planState`'s
`trial` result gains an optional `lapsedOn: Date`, set when `paidUntil` is in the past.

---

## Config

**API** — each missing value throws at boot, the way `SESSION_SECRET` does:

| Variable | Notes |
|---|---|
| `BILLPLZ_API_KEY` | Basic-auth username for Billplz |
| `BILLPLZ_COLLECTION_ID` | The collection new bills are raised in |
| `BILLPLZ_X_SIGNATURE_KEY` | Verifies callbacks and redirects |
| `BILLPLZ_BASE_URL` | `https://www.billplz-sandbox.com` in `.env.example` |
| `BILLPLZ_CALLBACK_URL` | Full URL, following `GOOGLE_REDIRECT_URI`'s precedent |
| `BILLPLZ_REDIRECT_URL` | Full URL, likewise |
| `RATE_LIMIT_BILLING_PER_ACCOUNT` | Defaults to 10 an hour; pinned in `vitest.setup.ts` like the others |

**Workers** — `BILLPLZ_API_KEY`, `BILLPLZ_BASE_URL`, `APP_URL`, each required at boot.

`apps/api/vitest.setup.ts` pins dummy Billplz values before anything imports, so the boot check never
fails a test and a developer's `.env` never changes one. The Billplz client reaches the routes through
`AppOverrides`, the way the chat routes take a stub model, so no test calls Billplz.

`.env.example` gains a commented Billplz block in its existing style, including one warning that
matters in development: **Billplz's servers cannot reach `localhost`, so a local callback never
arrives.** The redirect still grants — the browser follows it — and so does the hourly check. A tunnel
is only needed to exercise the callback itself.

---

## Failure modes, in one place

| What happens | Result |
|---|---|
| Billplz is down when a bill is created | 502; a pending row with no bill id |
| A forged or broken signature | 400, logged. A genuine payment refused this way is still granted by the hourly check |
| A misconfigured `BILLPLZ_X_SIGNATURE_KEY` | Every genuine callback fails and is eventually dropped; the hourly check still grants |
| Amount, collection or reference does not match | 200, logged at error, never granted |
| The redirect arrives but Billplz's API cannot be reached for the fetch | The owner sees `pending`; the callback or the hourly check grants |
| The same payment arrives twice, or by callback and redirect together | The second does nothing |
| Two payments for one page land together | Both extend, because of the page lock |
| The API is down for more than a day | Billplz stops retrying; the hourly check grants once it is back |
| The reminder run crashes midway | At most one missed email |
| The reset is clicked twice | 409 `TRIAL_RESET_USED` |

---

## Testing, and its limits

Every test below is proven by a mutation that makes it fail, as the verification sweep did. The table
spans both plans.

| Layer | What is proven |
|---|---|
| `packages/core` | `extendPaidUntil` at Jan 31, Feb 29 and Dec 31, from a future `paidUntil` and from a lapsed one. `planState`'s `lapsedOn`. |
| `@curios/billing` — signature | Against a vector computed with `openssl`, outside our code, over the documented construction. Redirect keys keep their `billplz` prefix. A payload carrying `transaction_id` and `transaction_status` verifies — a hard-coded field list would fail it. A missing signature refuses. |
| `@curios/billing` — binding | Each refusal on its own: wrong amount, wrong collection, unpaid, unknown bill — and a wrong `reference_1` on a fetched bill. |
| `@curios/billing` — the race | Two grants for one page with a test-only pause injected between reading `paidUntil` and writing it, so removing the lock fails **every** run rather than occasionally. A race test that fails only sometimes passes for the wrong reason. |
| `@curios/billing` — idempotency | The same payment granted twice, and by two callers at once, extends once. |
| `apps/api` | The callback over real HTTP with a form body — the path that would be a 415 today. The redirect's three outcomes. Bill creation against a stubbed client, including Billplz failing. The reset's conditions and its 409. |
| `apps/workers` | The pending check's window at both edges. Reminders claimed once per `paidUntil`, and never for a page outside the window. |
| `apps/web` | `/app/billing` renders each plan state and each banner; the nav links to it. |

**What no test covers.** Whether Billplz actually signs the way its docs say — only a real payment
proves that. Real FPX banking. Whether production callbacks can reach the API. Whether the reminder
email arrives. E-invoicing. Whether RM39 and RM390 convert.

---

## Done means a real sandbox payment

**Plan 1 is not complete until one real Billplz sandbox payment has been granted by its callback.**
Tests prove we implement the documented construction; only Billplz can prove the documentation is
right, and a signature check that is wrong refuses every genuine payment.

It needs a sandbox account's API key, X Signature Key and collection id, and a tunnel so the sandbox
can reach a local callback URL. The run checks three things: the callback's signature verifies, the
redirect's signature verifies with its `billplz` prefix, and the `Payment` row and `Page.paidUntil`
move exactly once.

`devDocs/manual-verification-billing.md` is written in plan 1 **with its "what CI proves, and what
still needs a person" table from the start**, not retrofitted, and records that run's result.

---

## Two plans

**Plan 1 — the money path**

1. `@curios/core` — `PLAN_PRICES_CENTS`, `extendPaidUntil`, `BILLING_QUEUE`.
2. `@curios/billing` — the signature, the Billplz client, the grant step with its lock.
3. The schema — the enums and `Payment`, as an additive migration.
4. `apps/api` — `POST /billing/bills`, the callback and the redirect, the scoped form parser, the
   per-account limit, boot-time config.
5. `apps/workers` — the billing queue, the hourly schedule and the pending check.
6. `apps/web` — a basic `/app/billing` and the nav link.
7. The walkthrough, `.env.example`, and the sandbox round trip.

**Plan 2 — the owner experience**

1. The schema — `Page.trialResetAt` and `Page.renewalReminderFor`.
2. `planState`'s `lapsedOn`, and the trial notice's copy and link.
3. The reset route and its button.
4. The reminder schedule, the email builder, and `APP_URL` in the workers.
5. The full `/app/billing`: usage against the cap, recent payments, the reset.
6. Documents.

---

## Documents corrected by this slice

| Document | Correction |
|---|---|
| `README.md` | A Settled-decisions row for how paid time is granted: the callback and the redirect through one verified step, backed by an hourly check. |
| `BACKEND.md` | A billing section: the grant step, the binding rules, the lock. |
| `FRONTEND.md` | `/app/billing` described as built; the capture card's "paying is slice 9's `/app/billing`" now points at a real screen. |
| `OPERATIONS.md` | The trial reset is now the owner's, once, for a page that never paid. The `psql` reset stays for every other case, and its "retire this when" is updated. |
| `deferred-findings.md` | The trial-exhaustion finding: the supported reset shipped for pages that never paid. |
| `.env.example` | The Billplz block and the `localhost` callback warning. |
| `manual-verification-billing.md` | New, with its coverage table from the start. |
