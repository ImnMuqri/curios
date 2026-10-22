# CHIP plan billing: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** owners pay for the Business plan through CHIP instead of Billplz, by FPX, card or e-wallet, and can opt in to have their card charged automatically when each paid period ends.

**Architecture:** `packages/billing` becomes CHIP's: a hand-written client for six CHIP Collect calls, an RSA signature check over the raw body, and the existing grant made provider-neutral (it also saves the renewal card). The API swaps Billplz's routes for CHIP's purchase, callback, webhook and return routes; the workers swap the pending check to CHIP and add a daily auto-renew job beside the renewal reminder. Billing gains an auto-renew checkbox and a "Turn off auto-renew" control; every Billplz word in the product, the legal pages and the docs becomes CHIP's.

**Tech Stack:** TypeScript, Prisma 6 / Postgres 16, Fastify 5 + zod, BullMQ, Next.js 15 + React 19, Vitest; Node `crypto` for RSA verification. No new dependencies.

**Spec:** [`devDocs/chip-payments-design.md`](../chip-payments-design.md), Part 1 and "Shared infrastructure". CHIP's API: [`devDocs/vendor/chip-collect.v1.yaml`](../vendor/chip-collect.v1.yaml) (trust it over CHIP's blog and AI skill). Part 2 (shops on CHIP) is a separate plan.

## Global Constraints

- Money is integer sen everywhere; CHIP's `price`/`total` are sen too. `PLAN_PRICES_CENTS = { MONTHLY: 4900, ANNUAL: 49000 }` stays the only price source.
- `grantPayment` stays the single writer of `Page.paidUntil`, and every grant is a conditional PENDING → PAID claim plus a `FOR UPDATE` lock on the page row.
- Nothing is granted from a redirect or a callback body alone: every grant comes from our own `GET /purchases/{id}/` (callback and webhook verify the signature first, then fetch).
- Signatures are verified over the exact raw request body: RSA PKCS#1 v1.5, SHA-256, `X-Signature` header base64. `GET /public_key/` returns a JSON-encoded PEM string; `JSON.parse` it.
- Callback and webhook answer 200 for every verified outcome, 400 for a bad signature, and let unexpected errors become 500 (CHIP retries 8 times over 36 hours).
- Callback URLs carry no port (CHIP refuses one: `webhooks_callback_port`).
- Auto-renew is cards only (`payment_method_whitelist: ["visa", "mastercard", "maestro"]`, `force_recurring: true`), opt-in per payment, off by default. A card is saved only when the paid purchase has `is_recurring_token: true` and the payment asked for it.
- Logs carry purchase ids, payment ids, page ids and outcomes, never an email, name or card number.
- New error codes go in `DOMAIN_ERROR_CODES` (`apps/api/src/plugins/errors.ts`).
- Board copy wins where a board speaks (owner, 2026-10-17); every departure gets a row in `design/DEVIATIONS.md`, next free number **139**.
- Client components never import the `@curios/core` barrel at runtime.
- Verification: `pnpm turbo run typecheck lint test --concurrency=1 --force`, read by exit status, never piped. After any change under `apps/web`, load the page in `pnpm dev`. If many db-touching suites fail at once, the test DB was wiped: restore it (memory: test-db-is-ephemeral) before suspecting the code.
- Migrations are written by hand (never `migrate diff` with the test DB as shadow).

## Review Focus

1. **The callback, the webhook, the return redirect and the hourly check all arrive for one purchase, in any order, at once.** Exactly one grant, one card saved, paidUntil extended once. Pinned in Task 3 (`grants once when four sources race`).
2. **A body that is re-serialised before verification** (whitespace or key order changed by a JSON parser). The signature must be checked on the raw string, so a genuine callback verifies and an altered one does not. Pinned in Task 5 (`verifies the raw body, not a re-serialised one`).
3. **The owner turns auto-renew off while a renewal is due that day, or between the job's read and its charge.** No charge after the card row is gone. Pinned in Task 7 (`does not charge a card deleted after the read`).
4. **A purchase asked for auto-renew but was paid without a token** (CHIP account has recurring disabled). The plan is granted, no card is saved, and Billing says auto-renew couldn't be turned on. Pinned in Task 3 and Task 8.
5. **A renewal answered `pending_charge` is still in flight on the next day's run.** No second charge for the same page. Pinned in Task 7 (`skips a page with a renewal still pending`).

---

## File map

| File | Responsibility |
|---|---|
| `packages/db/prisma/schema.prisma`, `migrations/20261022120000_chip_billing/migration.sql` | `PaymentProvider`, `Payment.provider/providerRef/autoRenew/autoRenewal`, `PaymentStatus` FAILED/EXPIRED, `RenewalCard` |
| `packages/billing/src/config.ts` | `CHIP_ENV`, `billingDisabled` |
| `packages/billing/src/client.ts` | `createChipClient`, `ChipPurchase`, `ChipUnavailableError` |
| `packages/billing/src/signature.ts` | `verifyChipSignature`, `parsePublicKey` |
| `packages/billing/src/grant.ts` | `evidenceFromPurchase`, `grantPayment`, `recordRenewalFailure` |
| `apps/api/src/modules/billing/billing.service.ts` | `createPurchaseForOwner`, `turnOffAutoRenew`, `resetTrial` |
| `apps/api/src/modules/billing/billing.routes.ts` | owner routes, `chipRoutes` (callback, webhook, return) |
| `apps/api/src/plugins/raw-json.ts` | JSON parser that keeps the raw body |
| `apps/workers/src/billing/pending-check.ts` | CHIP pending check, worker wiring |
| `apps/workers/src/billing/auto-renew.ts` | the daily renewal job |
| `packages/core/src/plan-mail.ts` | reminder variant, renewal-failed and auto-renew-stopped mails |
| `packages/db-read/src/payments.query.ts` | payments with provider and method; `getRenewalCard` |
| `apps/web/app/app/billing/*` | checkbox, auto-renew block, CHIP copy, no receipt link |
| copy, legal, docs | landing `copy.ts`, `_legal/content.ts`, README, devDocs, DEVIATIONS |

---

### Task 1: Schema

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (`enum PaymentStatus`, `model Payment`, `model Page` comment on `paidUntil`, `payments` relation area)
- Create: `packages/db/prisma/migrations/20261022120000_chip_billing/migration.sql`
- Test: `packages/db/src/schema.test.ts` (the Payment block, lines ~310-420)

**Interfaces:**
- Produces:
  - `enum PaymentProvider { BILLPLZ CHIP }`
  - `enum PaymentStatus { PENDING PAID FAILED EXPIRED }`
  - `Payment { provider PaymentProvider @default(CHIP); providerRef String? @unique; billplzCollectionId String?; autoRenew Boolean @default(false); autoRenewal Boolean @default(false); … }` (`billplzBillId` is gone: renamed to `providerRef`)
  - `model RenewalCard { pageId String @id; page Page @relation(onDelete: Cascade); token String @unique; plan BillingPlan; cardLabel String?; failedAttempts Int @default(0); lastFailedAt DateTime?; lastAttemptAt DateTime?; createdAt DateTime @default(now()) }`, and `Page.renewalCard RenewalCard?`

- [ ] **Step 1: Write the failing tests** in `schema.test.ts`, replacing the Billplz-named ones:
  - `creates a CHIP payment pending, with no reference yet` → `{ provider: 'CHIP', status: 'PENDING', providerRef: null, autoRenew: false, autoRenewal: false }`
  - `refuses a second payment carrying the same provider reference` → second create with the same `providerRef` rejects with Prisma `P2002`
  - `allows any number of payments with no reference yet` (the existing one, renamed fields)
  - `keeps one renewal card per page, deleted with the page` → second `renewalCard.create` for the same `pageId` rejects `P2002`; deleting the page (with no payments) deletes the card.
- [ ] **Step 2: Run** `pnpm --filter @curios/db test` → FAIL (unknown fields).
- [ ] **Step 3: Edit the schema and write `migration.sql` by hand:** create both enum values (`ALTER TYPE "PaymentStatus" ADD VALUE 'FAILED'`, `'EXPIRED'`), `CREATE TYPE "PaymentProvider"`, add `provider` with default `'CHIP'` then `UPDATE "Payment" SET "provider" = 'BILLPLZ'` for every existing row, `RENAME COLUMN "billplzBillId" TO "providerRef"` and rename its unique index to `Payment_providerRef_key`, `ALTER COLUMN "billplzCollectionId" DROP NOT NULL`, add the two booleans, create `RenewalCard` with its FK (cascade) and unique `token`. Rewrite the `paidUntil` comment: paid time comes from one-off CHIP purchases or, with auto-renew, from a saved card charged by the renewal job.
- [ ] **Step 4: Apply and run:** `pnpm --filter @curios/db exec prisma migrate dev` against the dev DB, `migrate deploy` against the test DB (memory: test-db-is-ephemeral has the command), then `pnpm --filter @curios/db test` → PASS.
- [ ] **Step 5: Commit** `feat(db): payments name their provider; a page can keep a renewal card`.

### Task 2: The CHIP client, signature and config

**Files:**
- Rewrite: `packages/billing/src/client.ts`, `signature.ts`, `config.ts`, `index.ts`
- Rewrite tests: `client.test.ts`, `signature.test.ts`, `config.test.ts`

**Interfaces:**
- Produces:
  - `CHIP_ENV = ['CHIP_SECRET_KEY', 'CHIP_BRAND_ID', 'CHIP_BASE_URL', 'CHIP_WEBHOOK_PUBLIC_KEY', 'CHIP_CALLBACK_BASE_URL'] as const` (`CHIP_PUBLIC_KEY` is optional and not in the list); `billingDisabled(env?)` unchanged in meaning.
  - `interface ChipPurchase { id: string; status: string; reference: string; totalCents: number; checkoutUrl: string; isRecurringToken: boolean; isTest: boolean; paymentMethod: string | null; maskedPan: string | null }`
  - `interface CreatePurchaseInput { email: string; fullName: string; productName: string; amountCents: number; reference: string; successCallback?: string; redirectUrl?: string; dueAt: Date; sendReceipt: boolean; cardsOnlyRecurring: boolean }`
  - `type ChargeResult = { kind: 'paid' | 'pending'; purchase: ChipPurchase } | { kind: 'invalid-token' } | { kind: 'declined' }`
  - `interface ChipClient { createPurchase(i: CreatePurchaseInput): Promise<ChipPurchase>; getPurchase(id: string): Promise<ChipPurchase>; chargePurchase(id: string, recurringToken: string): Promise<ChargeResult>; deleteRecurringToken(id: string): Promise<void>; cancelPurchase(id: string): Promise<void>; getPublicKey(): Promise<string> }`
  - `createChipClient(options: { secretKey: string; brandId: string; baseUrl: string; fetch?: FetchLike; timeoutMs?: number }): ChipClient`
  - `class ChipUnavailableError` (statusCode 502, code `'CHIP_UNAVAILABLE'`)
  - `verifyChipSignature(rawBody: string, signature: string | undefined, publicKeyPem: string): boolean`
  - `parsePublicKey(body: string): string` (JSON-decodes `/public_key/`'s body; throws if not a PEM)

- [ ] **Step 1: Write the failing tests.**
  - client: `creates a purchase with the brand, sen products, reference and due_strict` (asserts the POST to `${base}/purchases/` with `Authorization: Bearer <key>` and body containing `brand_id`, `client.email`, `client.full_name`, `purchase.products[0] = { name, price: 4900, quantity: 1 }`, `purchase.currency: 'MYR'`, `purchase.due_strict: true`, `due` = unix seconds, `reference`, `success_callback`, `success_redirect`/`failure_redirect`/`cancel_redirect` all = `redirectUrl`, `send_receipt`); `asks for a card token, cards only, when cardsOnlyRecurring` (`force_recurring: true`, `payment_method_whitelist: ['visa','mastercard','maestro']`); `narrows a paid purchase` (from the spec's example with `status: 'paid'`, `transaction_data.payment_method: 'visa'`, `extra.masked_pan: '411111******1111'` → `maskedPan`, `paymentMethod`); `refuses a purchase in a shape it does not recognise`; `charges with a token: paid / pending_charge`; `charge answers invalid-token on 400 invalid_recurring_token`; `charge answers declined on 400 purchase_charge_error`; `throws ChipUnavailableError on network failure and 5xx`; `throws a plain error on another 4xx`.
  - signature: generate an RSA key pair in the test (`crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })`), sign a body with `crypto.sign('sha256', body, privateKey)`: `verifies a genuine signature`; `refuses a changed body`; `refuses a missing, empty or non-base64 signature`; `refuses a signature from another key`; `parsePublicKey decodes the JSON-quoted PEM and refuses anything else`.
  - config: `billing is off in development only when every CHIP_* setting is unset`; `a partial set is not off`; `production is never off`.
- [ ] **Step 2: Run** `pnpm --filter @curios/billing test` → FAIL.
- [ ] **Step 3: Implement** the three files to the interfaces above, keeping the Billplz client's structure (injectable `fetch`, `AbortSignal.timeout`, 10 s default, `toPurchase` that refuses unknown shapes). Delete every Billplz export; `index.ts` exports exactly the names above plus Task 3's.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(billing): a CHIP client, its signature check, and its settings`.

### Task 3: The provider-neutral grant, and the renewal card

**Files:**
- Rewrite: `packages/billing/src/grant.ts`, `grant.test.ts`

**Interfaces:**
- Consumes: `ChipPurchase` (Task 2), the Task 1 schema.
- Produces:
  - `interface PaymentEvidence { providerRef: string; paid: boolean; amountCents: number; reference: string; card: { token: string; label: string | null } | null }`
  - `evidenceFromPurchase(p: ChipPurchase): PaymentEvidence` (`paid` = `status === 'paid'`; `card` only when `isRecurringToken`; label like `"Visa ending 1111"` from `paymentMethod` + last four of `maskedPan`, else null)
  - `type GrantOutcome = { kind: 'granted'; paidUntil: Date; cardSaved: boolean } | { kind: 'already-granted' } | { kind: 'not-paid' } | { kind: 'unknown-payment' } | { kind: 'mismatch'; reason: 'amount' | 'reference' }`
  - `grantPayment(prisma, evidence: PaymentEvidence, options: GrantOptions): Promise<GrantOutcome>` (looks up by `providerRef`; checks `amountCents` and `reference === payment.id`; in the transaction, after extending: if `payment.autoRenew && evidence.card` upsert `RenewalCard { token, plan: payment.plan, cardLabel, failedAttempts: 0, lastFailedAt: null }`; if `payment.autoRenewal`, reset the existing card's `failedAttempts` to 0)
  - `recordRenewalFailure(prisma, paymentId: string, now: Date): Promise<{ kind: 'retry'; attempts: number } | { kind: 'stopped'; reason: 'attempts' | 'lapsed' } | { kind: 'ignored' }>` (claims the payment PENDING → FAILED; increments the page's card `failedAttempts` and sets `lastFailedAt`; deletes the card and answers `stopped` when attempts reach 3 or `paidUntil` is more than 3 days past; `ignored` when the claim changes nothing)

- [ ] **Step 1: Write the failing tests** (real test DB, as today's `grant.test.ts`): `grants a paid purchase and extends paidUntil`; `refuses an amount or reference that does not match`; `answers unknown-payment for a reference we never created`; `grants once when four sources race` (four concurrent `grantPayment` calls with the same evidence → one `granted`, three `already-granted`, paidUntil extended once); `saves the renewal card when the payment asked for auto-renew and the purchase carries a token`; `saves no card when auto-renew was asked but the purchase has no token` (`cardSaved: false`); `saves no card when auto-renew was not asked`; `a renewal grant resets the card's failures`; `recordRenewalFailure counts, then stops at three` (third call deletes the card, answers `stopped`); `recordRenewalFailure stops once paidUntil is more than 3 days past`; `recordRenewalFailure ignores a payment already failed or paid`; keep the existing lock test (`a second payment reads the first's paidUntil`) with the new names.
- [ ] **Step 2: Run** `pnpm --filter @curios/billing test` → FAIL.
- [ ] **Step 3: Implement** to the interfaces above.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(billing): one grant for CHIP purchases, saving the card for auto-renew`.

### Task 4: Starting a payment, and coming back

**Files:**
- Modify: `apps/api/src/modules/billing/billing.service.ts`, `billing.routes.ts`, `billing.routes.test.ts`
- Modify: `apps/api/src/plugins/errors.ts` (`BILLPLZ_UNAVAILABLE` → `CHIP_UNAVAILABLE`), `apps/api/src/plugins/rate-limit.ts` (comment), `apps/api/vitest.setup.ts` (CHIP dummies), `apps/api/src/modules/pages/storage.registration.test.ts` and `storage.ts` (comment) to use `CHIP_ENV`, `.env.example` (replace the Billplz block with a CHIP block: each `CHIP_*` with a one-line comment, test keys by default, the no-port rule, the tunnel note)

**Interfaces:**
- Consumes: `ChipClient`, `createChipClient`, `CHIP_ENV`, `billingDisabled`, `grantPayment`, `evidenceFromPurchase`.
- Produces:
  - `createPurchaseForOwner(deps: { prisma; client: ChipClient; callbackBaseUrl: string; log? }, input: { accountId: string; plan: BillingPlan; autoRenew: boolean; now: Date }): Promise<{ url: string }>` (creates the Payment with `provider: 'CHIP'`, `autoRenew`; then the purchase with `productName` = `billDescription(plan, displayName)`, `reference` = payment id, `successCallback` = `${callbackBaseUrl}/billing/chip/callback`, `redirectUrl` = `${callbackBaseUrl}/billing/chip/return?payment=<id>`, `dueAt` = now + 1 h, `sendReceipt: true`, `cardsOnlyRecurring: autoRenew`; writes `providerRef`; the orphan rule and its log stay as they are)
  - `POST /billing/purchases` body `{ plan: 'MONTHLY' | 'ANNUAL'; autoRenew?: boolean }` (default false) → `201 { url }`. `/billing/bills` is removed.
  - `GET /billing/chip/return?payment=<paymentId>` → finds the Payment (unknown → `pending`), `getPurchase(providerRef)`, `grantPayment`; redirects to `${APP_URL}/app/billing?payment=paid|pending|failed` (`failed` when the purchase is `expired`, `cancelled`, `error` or `blocked`; `paid` on granted/already-granted; `pending` otherwise or on any error); adds `&card=off` when the grant was `granted` with `autoRenew` asked and `cardSaved: false`.
  - The settings reader `chipSettings(options)` → `{ client, callbackBaseUrl, webhookPublicKey, publicKey?: string } | null` (null when switched off), shared by every CHIP route.

- [ ] **Step 1: Write the failing route tests** (Fastify `inject`, stub `ChipClient` through `overrides.billing`, as the Billplz tests do): `starts a purchase for a business page and answers its checkout URL`; `asks CHIP for a card token only when autoRenew is ticked`; `refuses a personal page with NOT_A_BUSINESS_PAGE`; `answers CHIP_UNAVAILABLE when CHIP is down`; `answers BILLING_NOT_CONFIGURED with billing switched off`; `the return grants a paid purchase and redirects with payment=paid`; `the return says failed for an expired purchase`; `the return says pending when CHIP cannot be reached`; `the return adds card=off when auto-renew was asked but no token came back`; `the return says pending for a payment id we never created`.
- [ ] **Step 2: Run** `pnpm --filter @curios/api test -- billing` → FAIL.
- [ ] **Step 3: Implement.** Remove `billplzRoutes`, the form parser and `/billing/bills`; register the return route inside `chipRoutes` (Task 5 adds the callback and webhook there). Update the `app.ts` comment and registration names.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(billing): pay for a plan through CHIP, and come back to Billing`.

### Task 5: The callback and the webhook

**Files:**
- Create: `apps/api/src/plugins/raw-json.ts` (+ `raw-json.test.ts`)
- Modify: `apps/api/src/modules/billing/billing.routes.ts`, `billing.routes.test.ts`

**Interfaces:**
- Consumes: `verifyChipSignature`, `parsePublicKey`, `grantPayment`, `recordRenewalFailure`, `chipSettings`.
- Produces:
  - `rawJson: FastifyPluginAsync` — registered inside an encapsulated scope; adds an `application/json` parser with `parseAs: 'string'` that sets `request.rawBody: string` then `JSON.parse`s (a bad body → 400). Declares `rawBody?: string` on `FastifyRequest`.
  - `POST /billing/chip/callback`: verify `X-Signature` over `rawBody` with `publicKey` (from `CHIP_PUBLIC_KEY`, else `parsePublicKey(await client.getPublicKey())` fetched once per process and cached) → 400 if not; else `getPurchase(body.id)` → `grantPayment` → 200 `{ status: outcome.kind }`.
  - `POST /billing/chip/webhook`: verify with `CHIP_WEBHOOK_PUBLIC_KEY`; on `event_type: 'purchase.paid'` do what the callback does; on `'purchase.payment_failure'` find the Payment by `providerRef = body.id` and, if it is an `autoRenewal` payment, `recordRenewalFailure` and queue the matching mail (Task 6 defines the mails; until then the route takes an injectable `onRenewalFailure(pageId, result)` and Task 7 wires it); any other event → 200 `{ status: 'ignored' }`.

- [ ] **Step 1: Write the failing tests:** raw-json: `keeps the exact bytes of the body`; `answers 400 for a body that is not JSON`. Routes (sign bodies with a test key pair; inject `CHIP_PUBLIC_KEY` and `CHIP_WEBHOOK_PUBLIC_KEY` from it): `verifies the raw body, not a re-serialised one` (a body with extra whitespace and unusual key order, signed as sent, is accepted; the same body re-serialised is refused); `refuses a callback without a valid signature with 400 and grants nothing`; `grants on a verified callback after fetching the purchase`; `answers 200 already-granted to a repeat`; `answers 500 when the database fails, so CHIP retries`; `the webhook grants on purchase.paid`; `the webhook records a renewal failure on purchase.payment_failure`; `the webhook ignores a failure for a payment that was not a renewal`; `the webhook refuses a callback-key signature` (keys are not interchangeable); `fetches CHIP's public key once when CHIP_PUBLIC_KEY is unset`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Log only purchase id, source and outcome (as `logOutcome` does now).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(billing): CHIP's callback and webhook, verified over the raw body`.

### Task 6: The pending check, and the plan mails

**Files:**
- Modify: `apps/workers/src/billing/pending-check.ts` (+ test), `apps/workers/src/main.ts`
- Modify: `packages/core/src/plan-mail.ts` (+ `plan-mail.test.ts`), `packages/core/src/index.ts` exports
- Modify: `apps/workers/src/billing/renewal-reminder.ts` (+ test)

**Interfaces:**
- Consumes: `createChipClient`, `CHIP_ENV`, `grantPayment`, `evidenceFromPurchase`.
- Produces:
  - `runPendingCheck({ prisma, client: ChipClient, now, log })`: PENDING, `provider: 'CHIP'`, `providerRef` not null, 2 h–7 d old, `autoRenewal: false` → `getPurchase` → grant if paid; `expired`/`cancelled`/`error`/`blocked` → conditional PENDING → `EXPIRED`. Returns `{ checked, granted, expired }`.
  - `planEndingMail(input: { displayName; paidUntil; appUrl; card: { label: string | null; amountCents: number } | null })`: with a card, says `We'll charge ${ringgit} to ${label ?? 'your card'} on ${day}. Turn off auto-renew on Billing if you don't want that.`; without one, today's words, with "FPX payments need your approval each time" changed to "You pay each time, by FPX, card or e-wallet".
  - `renewalFailedMail(input: { displayName; paidUntil; appUrl; attempts: number })` (subject `We couldn't renew your Curios plan`; says the card was declined, that we'll try again tomorrow, and offers Pay now → Billing)
  - `autoRenewStoppedMail(input: { displayName; paidUntil; appUrl; reason: 'attempts' | 'lapsed' | 'card-removed' })` (subject `Auto-renew is off for ${displayName}`; says when the plan ends or ended, and that paying on Billing switches the capture card and shop back on)
  - `runRenewalReminders` passes `card` from the page's `renewalCard`; `runPlanEndedMails` skips pages that still have a `RenewalCard` (a renewal is still being tried).

- [ ] **Step 1: Write the failing tests:** pending check: `grants a paid purchase`; `marks an expired purchase EXPIRED`; `leaves a purchase still open alone`; `skips renewal payments` (the auto-renew job owns those); `one purchase failing does not stop the rest`. Mails: `the reminder names the card and the charge when auto-renew is on`; `the reminder without a card says you pay each time`; `the renewal-failed mail says we'll try again tomorrow and links Billing`; `the stopped mail says when the plan ends`. Reminders: `skips the plan-ended mail while a renewal card exists`.
- [ ] **Step 2: Run** `pnpm --filter @curios/workers test` and `pnpm --filter @curios/core test` → FAIL.
- [ ] **Step 3: Implement.** In `main.ts`, build `createChipClient` from `CHIP_SECRET_KEY`, `CHIP_BRAND_ID`, `CHIP_BASE_URL`; the "switched off" warning names `CHIP_*`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(billing): the hourly check asks CHIP; reminders know about auto-renew`.

### Task 7: The auto-renew job, and turning it off

**Files:**
- Create: `apps/workers/src/billing/auto-renew.ts` (+ `auto-renew.test.ts`)
- Modify: `apps/workers/src/billing/pending-check.ts` (`createBillingWorker` runs it in the `RENEWAL_REMINDER_JOB` branch, before the reminders)
- Create: `packages/billing/src/renewal-mail.ts` (+ test)
- Modify: `apps/api/src/modules/billing/billing.service.ts`, `billing.routes.ts` (+ tests): the off route, and wiring the webhook's `onRenewalFailure` to `notifyRenewalFailure` with `app.mailQueue`

**Interfaces:**
- Consumes: `ChipClient.createPurchase/chargePurchase/deleteRecurringToken`, `grantPayment`, `evidenceFromPurchase`, `recordRenewalFailure`, `renewalFailedMail`, `autoRenewStoppedMail`.
- Produces:
  - `notifyRenewalFailure(deps: { prisma; mailQueue: { add(name: string, data: MailJobData, opts?: unknown): Promise<unknown> }; appUrl: string }, pageId: string, result: Awaited<ReturnType<typeof recordRenewalFailure>>): Promise<void>` — `retry` → `renewalFailedMail`, `stopped` → `autoRenewStoppedMail({ reason: result.reason })`, `ignored` → nothing; to the account's email. Used by the job and the webhook alike.
  - `runAutoRenewals(deps: { prisma; client: ChipClient; mailQueue: MailQueueLike; now: Date; appUrl: string; callbackBaseUrl: string; log? }): Promise<{ charged: number; pending: number; failed: number; stopped: number }>`. For each `RenewalCard` whose page is BUSINESS with `paidUntil` in `(now − 3 days, now + 24 h]`:
    1. skip if the page has a PENDING `autoRenewal` payment;
    2. claim: `renewalCard.updateMany({ where: { pageId, token, OR: [{ lastAttemptAt: null }, { lastAttemptAt: { lt: now − 20 h } }] }, data: { lastAttemptAt: now } })`, skip on 0;
    3. create the Payment (`autoRenewal: true`, plan from the card) and a purchase (`sendReceipt: true`, `successCallback`, no redirect, `dueAt` now + 1 h, `cardsOnlyRecurring: false`), write `providerRef`;
    4. `chargePurchase(purchase.id, card.token)`: `paid` → `grantPayment(evidenceFromPurchase(result.purchase))`; `pending` → leave PENDING (the webhook settles it); `declined` → `recordRenewalFailure` + mail; `invalid-token` → delete the card, mark the payment FAILED, mail `autoRenewStoppedMail({ reason: 'card-removed' })`. A `ChipUnavailableError` leaves the payment PENDING and the day claimed (tomorrow retries).
  - `turnOffAutoRenew(deps: { prisma; client: ChipClient }, input: { accountId }): Promise<void>` — deletes the `RenewalCard` row first, then `deleteRecurringToken(token)`; a CHIP failure after the delete is logged, not thrown (the row is what the job reads).
  - `POST /billing/auto-renew/off` → `200 { status: 'off' }` (behind the session and the per-account limit).

- [ ] **Step 1: Write the failing tests:** `charges a card the day before paidUntil and grants`; `charges up to 3 days after paidUntil`; `leaves a card alone a week before`; `charges once when two runs race` (two concurrent runs → one `chargePurchase`); `skips a page with a renewal still pending`; `does not charge a card deleted after the read` (delete the card between the find and the claim via a test hook → no `createPurchase`, no charge); `a decline counts a failure and mails "we'll try again tomorrow"`; `a third decline stops auto-renew and mails it`; `an invalid token deletes the card and mails card-removed`; `CHIP down leaves the payment pending and claims the day`. API: `turning auto-renew off deletes the card and the token`; `turning it off still deletes the card when CHIP is down`; `the webhook's renewal failure mails the owner`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(billing): auto-renew charges the saved card when a plan ends`.

### Task 8: Billing screen

**Files:**
- Modify: `apps/web/app/app/billing/pay-buttons.tsx` (+ test), `page.tsx` (+ test), `billing-copy.ts` (+ test), `paid-toast.tsx`, `billing.module.css`
- Create: `apps/web/app/app/billing/auto-renew.tsx` (+ test)
- Modify: `packages/db-read/src/payments.query.ts` (+ test), its index export

**Interfaces:**
- Consumes: `POST /billing/purchases { plan, autoRenew }`, `POST /billing/auto-renew/off`, `?payment=` and `?card=off`.
- Produces:
  - `OwnerPayment` loses `billplzBillId`, gains `provider: 'BILLPLZ' | 'CHIP'`, `autoRenewal: boolean`, and `status` adds `'FAILED' | 'EXPIRED'`.
  - `getRenewalCard(pageId): Promise<{ cardLabel: string | null; plan: BillingPlan; failedAttempts: number } | null>`
  - `PlanPay` gains a checkbox "Renew automatically by card" with the line "We'll charge your card when this period ends. Turn it off any time."; `onPay(plan, autoRenew)`. When ticked, the dialog says "You'll go to CHIP to pay by card, then come straight back here." Otherwise "You'll go to CHIP to pay by FPX, card or e-wallet, then come straight back here." Busy: "Opening CHIP…" / "CHIP's payment page opens next." Button "Continue to CHIP". Under Pay: "FPX, card or e-wallet, through CHIP."
  - `payError`: `CHIP_UNAVAILABLE` → "CHIP is not answering right now. Try again in a few minutes."; `BILLING_NOT_CONFIGURED` → "Payments are switched off here: no CHIP settings in this environment."
  - `AutoRenew({ card })` client component, shown on the plan card when a card is saved: "Auto-renew is on. We'll charge {label ?? 'your card'} {price} on {paidUntil}." (after a failure: "Your last renewal didn't go through. We'll try again tomorrow."), and "Turn off auto-renew" → confirm → POST → refresh. The paid plan's line "No auto-renew, so nothing is charged without you." becomes, without a card, "Renews only if you turn on auto-renew."
  - `paymentBanner('pending')` names CHIP; `?card=off` adds an info banner "Your plan is paid, but auto-renew couldn't be turned on for this payment. Pay by card with the box ticked next time to turn it on."
  - Payments table: no Receipt column (CHIP emails it); status "Paid", "Not completed" (PENDING, EXPIRED) or "Declined" (FAILED); "What for" says "Auto-renewal" for `autoRenewal` rows.

- [ ] **Step 1: Write the failing tests** for each bullet: `pays with auto-renew when the box is ticked` (onPay called with `('MONTHLY', true)`); `says the card-only route when ticked`; `names CHIP in the dialog and the busy state`; `shows auto-renew and turns it off`; `says the last renewal failed`; `shows the card=off banner`; `lists a declined renewal as Declined`; `has no receipt link`; db-read `getRenewalCard answers the page's card or null`.
- [ ] **Step 2: Run** `pnpm --filter @curios/web test -- billing` and `pnpm --filter @curios/db-read test` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; then load `/app/billing` in `pnpm dev` (signed in, business page) at 390 px and desktop, with and without a `RenewalCard` row.
- [ ] **Step 5: Commit** `feat(billing): Billing pays through CHIP and can renew automatically`.

### Task 9: The words everywhere else

**Files:**
- Modify: `apps/web/app/_landing/copy.ts` (lines ~371 and ~592), `apps/web/app/_legal/content.ts` (Terms "Plans and payment", Refund Policy "The Business plan", Privacy "What we collect", "Who else sees it", both languages; `UPDATED`), their tests if a string is asserted
- Modify: `packages/core/src/billing.ts`, `packages/core/src/types.ts` (comments), `README.md`, `devDocs/README.md` (the Pay row and the 2026-09-12 note: superseded 2026-10-22), `devDocs/OPERATIONS.md` (the orphan note; registering the webhook in CHIP's portal; the tunnel), `devDocs/manual-verification-billing.md` (rewritten for CHIP test mode: cards 4444 3333 2222 1111 and 5555 5555 5555 4444, CVC 123, any future expiry; FPX is simulated)
- Modify: `design/DEVIATIONS.md` (rows from 139)

**Interfaces:**
- Consumes: nothing new.

- [ ] **Step 1: Write the copy** — landing: "Pay by FPX, card or e-wallet. Nothing renews unless you turn on auto-renew by card." (Malay: "Bayar dengan FPX, kad atau e-dompet. Tiada pembaharuan automatik melainkan anda hidupkan auto-renew dengan kad."). Terms "Plans and payment" second paragraph: "You pay through CHIP, by FPX online banking, card or e-wallet. Each payment adds a month or a year to your plan, counted from when your paid time would otherwise end. Nothing renews by itself unless you turn on auto-renew, which is for cards only: we then charge your card the same amount when each paid period ends, until you turn it off on your Billing screen. If a renewal charge fails, we try again for up to 3 days, then turn auto-renew off." Refund Policy: "A renewal charged by auto-renew counts as a later payment, unless you had already turned auto-renew off, in which case we refund it in full." Privacy: CHIP replaces Billplz in both lists ("CHIP (Malaysia): takes Business plan payments, and receives your email address, your page's name and the amount. Your card details go to CHIP, never to us; for auto-renew, CHIP keeps a token of your card that only works for Curios's charges."). Malay mirrors with the same structure (the parity test in `legal.test.tsx` checks it). `UPDATED` moves to the commit day.
- [ ] **Step 2: DEVIATIONS rows** — 139 Billing: "FPX or card, through Billplz" / "Continue to Billplz" / "Waiting for Billplz…" → CHIP (owner, 2026-10-22: CHIP replaces Billplz); 140 Billing: "No auto-renew, so nothing is charged without you." → auto-renew checkbox, the auto-renew block, and "Renews only if you turn on auto-renew." (owner, 2026-10-22); 141 Billing: the payments table's Receipt link removed (CHIP emails receipts); 142 Emails: the plan-ending reminder's auto-renew variant, and the renewal-failed and auto-renew-off emails (not drawn).
- [ ] **Step 3: Grep** `rg -i "billplz" --glob '!devDocs/plans/**' --glob '!devDocs/slice-*' --glob '!.superpowers/**' --glob '!design/boards/**' --glob '!devDocs/vendor/**'` → only the migration, the `BILLPLZ` enum value and its comments, and the DEVIATIONS rows remain.
- [ ] **Step 4: Run the full gates** `pnpm turbo run typecheck lint test --concurrency=1 --force` → 0 failed, 0 cached; load `/`, `/ms`, `/terms`, `/ms/terms`, `/refunds`, `/privacy` in dev.
- [ ] **Step 5: Commit** `docs(billing): CHIP and auto-renew, in the landing, the legal pages and the docs`.

---

## Not in this plan

- Shops on CHIP (design Part 2): its own plan, after this one lands.
- Registering the CHIP webhook in CHIP's portal and the live keys: owner, at launch (`OPERATIONS.md` says how).
