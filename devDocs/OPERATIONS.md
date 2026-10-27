# Operations

Procedures that touch live data by hand. Each one exists because something can
go wrong that the product cannot yet fix by itself, and improvising a `psql`
statement while an owner waits is how the wrong row gets updated.

Every procedure here is a stopgap. Each names the slice that should make it
unnecessary, and that reference is the point: a procedure that has been here for
three slices is a feature nobody built.

---

## Resetting a page's free-lead trial

**Why this exists.** A business page gets three free leads
(`FREE_LEADS`, `packages/core/src/plan.ts`), after which the capture card
disappears until `paidUntil` is in the future. The counter only ever goes up —
deleting a lead does not give it back, deliberately, so nobody can farm free
leads by deleting them.

The trap is that the trial can be spent without a single real customer. Lead
dedupe is 24 hours per phone per page, so an owner testing their own page on
three different days with their own number spends all three. They then hit a
paywall with an empty dashboard, having seen the product work only for
themselves.

**Most of this is now the owner's to do.** `/app/billing` offers a reset while the
page has never paid and has captured at least one lead, and it can be used once
(`Page.trialResetAt`). This procedure is what remains: a page that already used
its reset, a page that paid and lapsed, or anything else where you need to know
what happened before changing it.

### 1. Confirm the state before changing anything

```bash
docker exec -i curios-postgres psql -U curios -d curios -c \
  "SELECT handle, mode, published, \"leadsCaptured\", \"paidUntil\", \"trialResetAt\" FROM \"Page\" WHERE handle = 'HANDLE';"
```

Read it before deciding. Three different situations look the same to an owner:

| What you see | What actually happened | Action |
|---|---|---|
| `leadsCaptured >= 3`, `paidUntil` null | Trial spent | Owner can reset it themselves on /app/billing, unless `trialResetAt` is set |
| `leadsCaptured >= 3`, `paidUntil` in the past | Paid once, lapsed | **Do not reset.** They owe a renewal |
| `mode = PERSONAL` | Never had capture at all | Nothing to reset; explain the tier |

Then look at whether the leads were real:

```bash
docker exec -i curios-postgres psql -U curios -d curios -c \
  "SELECT l.phone, l.\"createdAt\" FROM \"Lead\" l JOIN \"Page\" p ON p.id = l.\"pageId\" WHERE p.handle = 'HANDLE' ORDER BY l.\"createdAt\";"
```

Three leads sharing one phone number, spaced roughly a day apart, is the
signature of an owner testing their own page. Three different numbers is more
likely real customers, and resetting would be giving away leads they should be
paying for.

### 2. Reset

```bash
docker exec -i curios-postgres psql -U curios -d curios -c \
  "UPDATE \"Page\" SET \"leadsCaptured\" = 0 WHERE handle = 'HANDLE';"
```

Expect `UPDATE 1`. **`UPDATE 0` means the handle was wrong** — handles are stored
lowercase, so check the case before retrying. Anything above 1 means the `WHERE`
was wrong and you should stop and work out what you just changed.

Setting it to `0` rather than subtracting is deliberate: this is "give them their
trial back", not arithmetic against a number you would have to trust.

### 3. Do not reach for `paidUntil` instead

It looks like the same fix and it is not. Writing a future `paidUntil` by hand
creates a page that is paid with no payment behind it. The `Payment` table now
accounts for every paid page, and a hand-written `paidUntil` reconciles against
nothing in it — by the time anyone asks, the reason will be a year old and
nobody will remember.

If someone genuinely needs to be given paid time — a goodwill gesture, an outage
— that is a decision with a record attached, not a `psql` statement. Write down
who authorised it and why alongside the change, and prefer giving them a bill
they do not have to pay over inventing paid time.

### 4. Verify

Re-run the query from step 1 and confirm `leadsCaptured` is `0`. Then load the
page and confirm the capture card is back after a qualifying conversation. The
public page renders per request (`export const dynamic = 'force-dynamic'` in
`apps/web/app/[handle]/page.tsx`), so there is no cache to wait out — the next
request shows it.

### Retire this when

Mostly retired already: the owner's own reset on `/app/billing` covers the case
this was written for — an owner who spent the trial testing their own page and
has never paid. What is left has no owner-facing equivalent and probably should
not have one: a second reset, and anything touching a page that has paid. Retire
the rest if an admin screen ever grows a supported way to do those, with the
record of who did it that a `psql` statement cannot carry.

---

## Restoring the test database

Not a live-data procedure, but the one most often needed and most often
rediscovered from scratch.

`curios-postgres-test` runs on `tmpfs`, so a container restart wipes the schema
**and** the `curios_readonly` role. Symptoms are every database-touching test
failing at once, across packages, usually right after a reboot.

```bash
pnpm --filter @curios/db exec prisma migrate deploy   # needs DATABASE_URL_TEST
docker exec -i curios-postgres-test psql -U curios -d curios_test \
  < packages/db/prisma/sql/readonly-role.sql
```

Both are required. Migrating alone leaves the role missing, and the read-only
package's tests fail in a way that looks like a permissions bug in the code.

---

## Running the golden set

```bash
pnpm goldens
```

Eighty questions across four fixture pages, real model calls on `claude-haiku-4-5`. A run
costs about eight cents ($0.0761 on the 2026-09-26 run) and takes a few minutes, most of it
re-asking whatever failed. Three of the four pages — `business`, `personal`, `hostile` —
stay under `RETRIEVAL_MIN_FACTS` on purpose, proof that a small page is untouched by
retrieval; the fourth, `catalog`, is the only one big enough to exercise it.

It needs `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` — the fixture pages need vectors before
their questions can retrieve anything, or every one of them runs in fallback and proves
nothing about retrieval — and a reachable test database, and refuses to start without any
of the three rather than failing halfway through. If it reports the test database is gone,
restore it with the two commands in the section above and run it again.

It writes only to the test database: four pages under `golden-` handles, deleted again when
the run ends. It never reads or writes the development database. The full transcript of every
answer lands in `.goldens/`, which is git-ignored.

Run it before a change that touches the chat prompt, and after one. The record of past runs,
and what to do when one fails, is in `manual-verification-goldens.md`.

---

## Backfilling fact vectors

**Why this exists.** Chat retrieves by matching a visitor's question against the vector
stored on each fact (`FactEmbedding`). A fact with no vector, or one from an older
embedding model, cannot be scored, and `packages/core/src/retrieval.ts`'s rule is every
fact or none — so one stale vector puts its whole page into fallback, sending everything,
until this is run.

```bash
pnpm exec tsx scripts/backfill-fact-embeddings.ts
```

It needs `OPENAI_API_KEY` and runs against whatever `DATABASE_URL` points at — check that
first. It embeds every non-rejected fact that has no vector or one from a different model
or dimension count, in batches, and prints how many facts needed one and how many it
wrote.

**What it costs.** `text-embedding-3-small` is $0.02 per million tokens, and a fact's
question runs roughly 10-20 tokens. A thousand facts is 10,000-20,000 tokens, so
$0.0002-$0.0004 — at RM4.4-4.7 to the dollar, call it a tenth of a sen per thousand facts,
not a figure worth budgeting around.

**Safe to re-run.** It only ever selects facts that need a vector, so running it against
an already-backfilled database scans everything and writes nothing.

**The workers run it every night**, at 04:00 Kuala Lumpur (`embeddings-backfill` on the
housekeeping queue), so a page left short a vector by an embeddings outage is mended by
the next morning with nobody remembering to. Run it by hand when you cannot wait for that:
after the migration that added `FactEmbedding`, after an outage you want cleared now, and
every time `EMBEDDING_MODEL` changes — a fact whose stored vector came from an older model
is re-embedded, not skipped.

---

## The embeddings provider is down

**During the outage: nothing.** `packages/core/src/retrieval.ts`'s own contract is that every
failure sends every fact instead of a chosen few. An embeddings outage is one of those
failures: every page falls back to sending everything it has, answers stay exactly as
correct as they were before this slice, and the only consequence is that the bill goes
back up to what it cost before retrieval, until the provider recovers. Do not disable
retrieval and do not restart anything — there is nothing broken to restart.

**Confirm it's this.** Every chat turn logs one `chat retrieval` line (`pageId`, `mode`,
`reason`, `bestScore`, and both fact counts — never the visitor's question). During a
provider outage or timeout, `reason` reads `"provider-failed"` on every line. Any other
fallback reason (`"below-minimum"`, `"missing-vectors"`, `"below-floor"`) is a different
page shape behaving correctly, not an outage.

**"Nothing" covers the outage itself, not what happened underneath it.** Two writes re-embed
inline and both swallow a failure to embed rather than fail the request that triggered it:
`runExtraction` (`apps/workers/src/ingestion/extract.service.ts`) still writes an ingestion's
facts when the batched embedding call fails, and `editFact`
(`apps/api/src/modules/facts/fact.service.ts`) still commits an owner's claim edit when
re-embedding it fails. An ingestion or a fact edit landing during the outage leaves that page
with one or more facts carrying no vector — and unlike the outage itself, that does not resolve
on its own when the provider comes back. The page stays in fallback, sending everything, until
the backfill is run by hand.

**Check for this once the provider recovers.** Both paths log a `warn` with an id and the error,
never a claim or a question — grep for the exact lines:

```bash
grep -F 'facts written but not embedded; this page falls back until a backfill runs' <log>
grep -F 'fact edited but its vector could not be refreshed; this page falls back until a backfill runs' <log>
```

A hit on either from during the outage window means run the backfill, the same command as
"Backfilling fact vectors" above:

```bash
pnpm exec tsx scripts/backfill-fact-embeddings.ts
```

It costs nothing to run speculatively even without a log hit — it only ever selects facts with
no vector or one from a different model or width, so a database with nothing to fix scans
everything and writes nothing.

**The same residue shows up in `chat retrieval` without touching a log.**
`reason: "missing-vectors"` on a page that was retrieving normally before, especially a large
one, appearing only after an outage has already passed, means exactly this: an edit or an
ingestion wrote a fact with no vector while the provider was down, and the page has been paying
roughly twice per answer in fallback ever since, waiting for the backfill above.

---

## Telling retrieval from fallback

Two ways, neither needing a code change.

**The `chat retrieval` log line**, written by `selectForQuestion`
(`apps/api/src/modules/chat/retrieval.ts`) on every question: `pageId`, `mode`
(`"retrieved"` or `"fallback"`), `reason` (null when retrieved), `bestScore`, and both
`factCount` and `selectedCount`. Never the question itself.

**`ModelCall`'s token columns.** A retrieved prompt is smaller than a fallback's on the
same page by construction — on the 114-fact development page, retrieval measured
1,494-1,709 tokens against 3,824-3,830 for that page's fallback prompt, about 40-45%.
Caching can move tokens between `inputTokens`, `cacheReadTokens` and `cacheWriteTokens`
call to call, so compare their sum, not `inputTokens` alone. Filter to rows with a
`conversationId`: extraction calls carry the same `pageId` and would land in the
fallback cluster.

```bash
docker exec -i curios-postgres psql -U curios -d curios -c \
  "SELECT (\"inputTokens\" + \"cacheReadTokens\" + \"cacheWriteTokens\") AS prompt_tokens, count(*) \
   FROM \"ModelCall\" WHERE \"pageId\" = 'PAGE_ID' AND \"conversationId\" IS NOT NULL AND ok = true \
   GROUP BY 1 ORDER BY 1;"
```

A page that mixes both modes shows two clusters: a lower one where retrieval fired and a
higher one, roughly twice as large on the development page, where it fell back. One tight cluster near the higher
number on a large page is worth checking against `RETRIEVAL_MIN_FACTS` and the `chat
retrieval` log before assuming retrieval is broken.

---

## An orphaned CHIP purchase

**Why this exists.** `createPurchaseForOwner` (`apps/api/src/modules/billing/billing.service.ts`)
creates a `Payment` row, then asks CHIP for a purchase, then writes the purchase's id onto that
row as `providerRef`. If the app crashes or the database is briefly unreachable between the second
and third steps, CHIP is left holding a real, payable purchase, but the row that should resolve it
keeps `providerRef` null. The hourly check only ever looks at `PENDING` rows with a `providerRef`
set, so it skips this one by construction, and a webhook that names this purchase finds no matching
row. Nothing in the system reconciles this by itself.

**Recognise it** by a `PENDING` `Payment` with `providerRef` null and `createdAt` more than a few
minutes old — the update should be near-instant, so anything older did not merely lose a race —
paired with an owner reporting a payment that never registered:

```bash
docker exec -i curios-postgres psql -U curios -d curios -c \
  "SELECT id, \"pageId\", plan, \"amountCents\", \"createdAt\" FROM \"Payment\" WHERE status = 'PENDING' AND provider = 'CHIP' AND \"providerRef\" IS NULL AND \"createdAt\" < now() - interval '5 minutes';"
```

**Resolve it.** The purchase CHIP raised carries a `reference` equal to that `Payment.id` -- that is
what correlates the two sides. Look the purchase up in the CHIP portal (or via its API) by searching
for a purchase whose reference matches one of the `id`s above. If it was genuinely paid, write its id
onto the row so the hourly check grants it on the next pass:

```bash
docker exec -i curios-postgres psql -U curios -d curios -c \
  "UPDATE \"Payment\" SET \"providerRef\" = 'PURCHASE_ID' WHERE id = 'PAYMENT_ID' AND status = 'PENDING' AND \"providerRef\" IS NULL;"
```

Expect `UPDATE 1`. If the purchase was never paid, or none matches, leave the row alone; it ages out
like any other unpaid purchase.

### Retire this when

When the create-purchase request is made idempotent against CHIP -- so a retry after this exact
failure re-uses the same purchase instead of the owner needing a human to find it -- or when a
scheduled sweep looks for exactly this shape (`PENDING`, `providerRef` null, old) and either recovers
or flags it without a person going looking first.

---

## Cutting over from Billplz

**Why this exists.** Once CHIP is deployed nothing asks Billplz about a payment any more: its
callback route is gone, and the hourly check only asks CHIP. A Billplz bill an owner opened before
the deploy and pays after it takes their money and gives them no time. The hourly check names any
such row at error level (`billplz payments still pending since the cutover`, payment ids only)
while it is under seven days old, but it settles none of them.

**Before deploying**, list the Billplz payments that could still be paid:

```bash
docker exec -i curios-postgres psql -U curios -d curios <<'SQL'
SELECT id, "pageId", plan, "amountCents", "providerRef", "createdAt"
FROM "Payment"
WHERE provider = 'BILLPLZ' AND status = 'PENDING' AND "createdAt" > now() - interval '7 days'
ORDER BY "createdAt";
SQL
```

Look each `providerRef` (the Billplz bill id) up in Billplz's dashboard, before the deploy and again
for a day or so after, as long as the error line keeps naming rows.

- **Paid at Billplz.** Grant it by hand, in one transaction. `INTERVAL` is `'1 month'` for
  `MONTHLY` and `'1 year'` for `ANNUAL`; the time stacks on any paid time still left, as
  `grantPayment` does:

  ```bash
  docker exec -i curios-postgres psql -U curios -d curios <<'SQL'
  BEGIN;
  UPDATE "Payment" SET status = 'PAID', "paidAt" = now()
    WHERE id = 'PAYMENT_ID' AND provider = 'BILLPLZ' AND status = 'PENDING';
  UPDATE "Page" SET "paidUntil" = GREATEST(COALESCE("paidUntil", now()), now()) + interval 'INTERVAL'
    WHERE id = 'PAGE_ID';
  UPDATE "Payment" SET "grantedUntil" = (SELECT "paidUntil" FROM "Page" WHERE id = 'PAGE_ID')
    WHERE id = 'PAYMENT_ID';
  COMMIT;
  SQL
  ```

  Expect `UPDATE 1` three times. If the first says `UPDATE 0`, the row was already settled:
  `ROLLBACK` and grant nothing.
- **Not paid.** Cancel the bill in Billplz's dashboard so it can no longer be paid, then mark the row
  so it stops being named:

  ```bash
  docker exec -i curios-postgres psql -U curios -d curios <<'SQL'
  UPDATE "Payment" SET status = 'EXPIRED' WHERE id = 'PAYMENT_ID' AND provider = 'BILLPLZ' AND status = 'PENDING';
  SQL
  ```

  An owner who still wants the plan pays again on Billing, through CHIP.

### Retire this when

Seven days after the deploy, when no Billplz row is young enough to be named and the error line has
stopped. Then the Billplz branch of the hourly check can go too.

---

## CHIP setup

**Test and live keys.** CHIP gives a test secret key and a live one, under the same Brand ID. A test
key never moves real money; going live is swapping `CHIP_SECRET_KEY` and the webhook public key
below, nothing else. `CHIP_BASE_URL` is the same for both.

**Register the webhook** in CHIP's portal (Developers, then Webhooks). Subscribe to the events
`purchase.paid` and `purchase.payment_failure`, with the URL
`{CHIP_CALLBACK_BASE_URL}/billing/chip/webhook`. Copy the public key CHIP shows for that webhook into
`CHIP_WEBHOOK_PUBLIC_KEY`. In production the API refuses to start without it, and without it every
webhook would be refused.

**Pasting a PEM key** (`CHIP_WEBHOOK_PUBLIC_KEY`, and `CHIP_PUBLIC_KEY` if you pin it). Either keep
its line breaks, as a quoted multi-line value:

```
CHIP_WEBHOOK_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA...
-----END PUBLIC KEY-----"
```

or put it on one line with each line break written as the two characters `\n`, which is what most
hosting dashboards need:

```
CHIP_WEBHOOK_PUBLIC_KEY=-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA...\n-----END PUBLIC KEY-----
```

The API turns each `\n` back into a line break when it reads the key, so both read the same. A key
pasted on one line with the breaks simply dropped does not parse: every message would be refused.

**Auto-renew needs recurring card payments enabled on the CHIP account.** Without that, a purchase
that asks to keep the card is paid but keeps no token, the owner sees the "auto-renew couldn't be
turned on" line, and no renewal is ever charged. Ask CHIP to switch it on before launch.

**Callbacks can't carry a port.** CHIP refuses a callback or return address with a port, so
`http://localhost:3001` cannot be called back. Locally the return redirect and the workers' hourly
check still grant a payment. To exercise the webhook and callback themselves, run a tunnel on 443
(`cloudflared tunnel --url http://localhost:3001`) and point `CHIP_CALLBACK_BASE_URL` at it. See
`devDocs/manual-verification-billing.md`.

---

## Shop CHIP keys

A shop owner connects their own CHIP account in Store → Payment. Their secret key is stored only
sealed (AES-256-GCM, `packages/core/src/secret-box.ts`) in `ShopPaymentAccount.secretKeyCiphertext`,
with `PAYMENT_SECRETS_KEY` as the key. The web app's read-only role cannot read that column at all.

**Generating `PAYMENT_SECRETS_KEY`.** The base64 of 32 random bytes:

```
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Set it on the API. Production refuses to start without it, and any value that is not the base64 of
32 bytes refuses to start everywhere. In development, leaving it blank switches connecting CHIP off
("Connecting CHIP is switched off here"). Keep it as secret as the database password, and never
in the same place: someone holding a database dump and this key holds every shop's CHIP key.

**Rotating it** is re-connecting. A sealed key opens only with the `PAYMENT_SECRETS_KEY` it was
sealed with, so after changing the variable every connected shop's key stops opening: their "Test
with RM1" and customers' online payments fail until they connect again. A customer paying
online then gets the shop's QR at checkout instead (or its WhatsApp, for a shop with no QR or
bank details), and the key is marked (`lastErrorAt`), so checkout stops offering CHIP for that
shop until its owner reconnects. To rotate:

1. Find the open shops whose **only** way to pay is CHIP. Deleting their connection would leave
   them open with nothing a customer can pay by:

   ```sql
   SELECT p."id", p."handle" FROM "Page" p
   JOIN "ShopPaymentAccount" a ON a."pageId" = p."id"
   WHERE p."storeEnabled" AND COALESCE(p."paymentQrKey", '') = ''
     AND (COALESCE(p."bankName", '') = '' OR COALESCE(p."bankAccountName", '') = ''
          OR COALESCE(p."bankAccountNumber", '') = '');
   ```

   An empty string counts as missing, as it does for the shop itself (`storeGaps`).

   **Close every one of those shops** (`UPDATE "Page" SET "storeEnabled" = false WHERE "id" IN (…)`)
   or have its owner add a QR or bank details first, and tell those owners why. Do not go on while
   that query returns a row.
2. Generate a new value and deploy it.
3. Clear the old connections, and have each owner reconnect in Store → Payment (their Brand ID and
   secret key from CHIP's dashboard, under Developers):

   ```sql
   DELETE FROM "ShopPaymentAccount";
   ```

The box carries a version byte (`0x01` today), so a later change can open old boxes with the old
key and seal new ones with a new key, rotating without re-connecting. That is not built: until it
is, rotation is the procedure above. Rotate if the key may have leaked, not on a schedule.

**A test key in production.** CHIP's payment methods and public key look the same for a test key
and a live one, so connecting starts an RM1 purchase on the owner's brand, reads its `is_test`, and
cancels it at once (nobody pays it; no money moves; it shows in the owner's CHIP dashboard as a
cancelled "Curios key check"). In production a test key is refused there, "This is a test key",
before anything is stored. If "Test with RM1" ever finds a test key later, it refuses too, and
removes the connection only when the shop has another way to pay or is closed; otherwise it keeps
it with `lastErrorAt` set.
A customer's order purchase is refused the same way: in production a purchase CHIP calls a test is
cancelled at once and the customer is offered the QR, and a test purchase never marks an order paid.

**Customers paying a shop online.** The order is placed first, as for the QR; paying creates a
purchase on the owner's own brand with their key, reference = the order number. CHIP calls back at
`${CHIP_CALLBACK_BASE_URL}/store/chip/callback/<orderId>` (left out when that URL has a port, as on
localhost), verified with **that shop's** stored public key, and the purchase is then fetched with
that shop's key before the order is marked paid. The order page asks the API too
(`GET /store/orders/:token/pay-status`), so an order is marked paid even if the callback is lost or,
in development, never sent. Logs carry order and purchase ids and outcomes only: "order purchase
handled" (callback), "order purchase checked" (order page), "online payment not available" (with a
reason; the customer was offered the QR), "order paid online after it was cancelled" (recorded on the
cancelled order, which shows as a refund owed: the money is in the owner's CHIP account, theirs to
refund), and "chip message about a purchase this order does not hold" (a signed callback for an
earlier try's purchase; ignored).

A second try at paying never leaves a paid purchase behind: it makes a new purchase only once the
earlier one is known to be dead or has been cancelled, and if cancelling fails because it was paid,
the order is marked paid instead. While a placed order's purchase can still be paid (an hour from
creation, `Order.chipPurchaseDueAt`), the owner cannot disconnect CHIP or swap in another CHIP
account, and cancelling the order, or marking it paid by hand, cancels the purchase first. A
purchase CHIP reports as `paid`, `cleared` or `settled` (or refunded or charged back since) was
paid. If CHIP takes a payment for an order already paid by QR or by hand, the order records
`Order.chipPaidTwiceAt`, a warning is logged with the order and purchase ids, and the owner is
emailed once ("Order #N was paid twice"); Orders lists it under Refunds. Budgets: asking what a
shop takes has `RATE_LIMIT_SHOP_PAY_METHODS_PER_IP` (per visitor and shop); starting a payment has
`RATE_LIMIT_SHOP_PAY_PER_IP` and is also limited per order (`RATE_LIMIT_SHOP_PAY_PER_ORDER`); the
order page's checks have their own per-order budget (`RATE_LIMIT_SHOP_PAY_STATUS_PER_ORDER`), and
CHIP is asked about one order at most every 5 seconds.

---

## Digital products

Digital items (files, a private link, codes, class sessions) add storage, one secret use and two jobs.

**`STORAGE_PRIVATE_BUCKET`.** The private bucket that holds the files owners upload for sale. It is
separate from `STORAGE_BUCKET` (public pictures) and must never be public: a customer reaches a file
only through the API's download route, which checks the order's link and counts the use. Production
needs it (with the same `STORAGE_ENDPOINT` and keys as the public bucket). Left unset in
development, files are kept under `apps/api/.files/` instead; that folder is gitignored and safe to
delete, and the files in it go with it.

**`PAYMENT_SECRETS_KEY` also seals order links.** A digital order keeps its token sealed with this
key, so the delivery email can carry the order link and the file links. If the key has changed since
the order was placed, the token no longer opens: the API logs "order link could not be opened
(PAYMENT_SECRETS_KEY changed?)" and the email goes out without links. Rotating the key (see Shop CHIP
keys) therefore also affects digital orders paid before the change but not yet delivered.

**`NEXT_PUBLIC_API_URL` for the API and the workers.** It is the API's public origin; delivery and reminder emails build download links from it. Both processes refuse to start in production without it (development falls back to `http://localhost:3001`).

**Jobs.** Both run in the workers app with the housekeeping jobs:

- `expire-holds`, hourly at :20. An unpaid order holding codes or class seats is cancelled after 24
  hours, which frees them. Paid orders are never touched.
- `session-reminders`, daily at 09:00 Malaysia time. Each customer with a class booked for the next
  day gets the reminder email. An order paid after that day's run gets no reminder.

---

## An owner says the renewal reminder never arrived

```bash
docker exec -i curios-postgres psql -U curios -d curios -c \
  "SELECT handle, \"paidUntil\", \"renewalReminderFor\" FROM \"Page\" WHERE handle = 'HANDLE';"
```

Compare the two columns. If `renewalReminderFor` equals the page's current
`paidUntil`, the reminder for this period was already claimed and enqueued --
the problem is downstream of the billing code, so look in the mail worker's
logs and the mail provider rather than here. If it is null or an older value
than `paidUntil`, the page has not been reminded for this period yet, and the
daily run at 10:00 Malaysia time is the next chance.

---

## Error tracking

Sentry, switched on by `SENTRY_DSN` (API, workers, web and admin servers) and
`NEXT_PUBLIC_SENTRY_DSN` (the browser, built in at `next build`). Unset, nothing is
reported and the browser never loads the SDK; in production the API and workers warn at
startup.

**What is reported.** Every line logged at error level or above, through a pino hook
(`errorReportingHook` in `@curios/core/error-report`): a failed job, "renewal paid at CHIP
but not granted", a 500. Plus what nothing logged: uncaught exceptions and unhandled
rejections, server render errors (`onRequestError` in each app's `instrumentation.ts`), and
client render errors caught by `app/error.tsx`. Errors only; tracing is off.

**What is not.** Order tokens are masked everywhere in an event (they are an order's only
credential and ride in the URL), only a log line's flat fields travel, and no cookies,
headers, request bodies or query strings are sent (`scrubEvent`, `scrubBreadcrumb`).

**Turbo passes `SENTRY_DSN` and `SENTRY_ENVIRONMENT` through** (`globalPassThroughEnv` in
`turbo.json`); its strict mode would otherwise drop them for any process started with
`turbo run`. `NEXT_PUBLIC_*` passes on its own.

Worth setting up in Sentry: an alert on any event whose message is "renewal paid at CHIP
but not granted" or "auto-renew could not finish a page", since each means money taken
with no time given until someone looks.

---

## Deploying on Railway

Six Railway services in one project, all in the Singapore region, deployed from the
`production` branch. Cloudflare only holds the domain: DNS, proxy and TLS in front of Railway.

Railway's config files (Config as Code) take no new services since 2026-08-28, so each app
service is set up in its dashboard, once. For every one: Source is this repository on branch
`production`, Root Directory left empty (every Dockerfile builds from the repository root),
region Singapore. `RAILWAY_DOCKERFILE_PATH` (a service variable) makes Railway build that
Dockerfile instead of guessing with Railpack, which fails on this workspace with "No start
command detected".

| Service | What | `RAILWAY_DOCKERFILE_PATH` | Custom Start Command | Pre-deploy Command | Healthcheck | Restart |
|---|---|---|---|---|---|---|
| Postgres | Railway's Postgres | | | | | |
| Redis | Railway's Redis | | | | | |
| `api` | `apps/api`, at `api.curios.my` | `Dockerfile.server` | `node --import tsx apps/api/src/server.ts` | `node --import tsx scripts/prepare-database.ts` | `/health` | On failure |
| `workers` | `apps/workers`, no public address | `Dockerfile.server` | `node --import tsx apps/workers/src/main.ts` | — | — | Always |
| `web` | `apps/web`, at `curios.my` | `Dockerfile.web` | — (the Dockerfile's) | — | `/` | On failure |
| `admin` | `apps/admin`, at `admin.curios.my` | `Dockerfile.admin` | — (the Dockerfile's) | — | `/signin` | On failure |

Service variables can copy another service's: `${{<service name>.<VARIABLE>}}`, with the name
exactly as the project shows it (`${{Curios-Api.APP_URL}}`). Typing `${{` in a value lists them.

**What each one does on deploy.**

- `api` and `workers` share `Dockerfile.server` and run their TypeScript through tsx, no build
  step. `api` runs `scripts/prepare-database.ts` before it takes traffic: migrations, the
  read-only role and its grants, and that role's password (from `DATABASE_URL_READONLY`). A
  failure there stops the deploy and the running one stays up.
- `web` is built by `Dockerfile.web`, on Linux, so the font preloads survive (a Windows build
  drops them). `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_SENTRY_DSN` are written into the browser
  code at build time: changing either needs a redeploy, not a restart.
- `admin` is built by `Dockerfile.admin` the same way, with `NEXT_PUBLIC_ADMIN_API_URL` written in
  at build time. Its own service and address, never a path under `curios.my`: owners are never
  served admin code.
- `api` and `workers` finish in-flight work on a deploy's SIGTERM (node is the container's
  process, not pnpm). Settings → Deploy → draining time: give them 30 s and 60 s.

### Variables

`.env.example` explains every variable; this is which service needs which. `${{Postgres.…}}` and
`${{Redis.…}}` are Railway references, typed as shown.

**Everywhere it appears, the same value.** `APP_URL=https://curios.my`,
`NEXT_PUBLIC_API_URL=https://api.curios.my`, `SENTRY_DSN`, `SENTRY_ENVIRONMENT=production`,
`STORAGE_PUBLIC_URL`, `CONVERSATION_CAP_PER_MONTH` (only to override; web and api must agree).

**The read-only URL** (`api` and `web`). Make a password: `openssl rand -hex 24` (hex needs no
URL escaping). Then:

```
DATABASE_URL_READONLY=postgresql://curios_readonly:<that password>@${{Postgres.PGHOST}}:${{Postgres.PGPORT}}/${{Postgres.PGDATABASE}}
```

The pre-deploy sets the role to this password and refuses the development one.

| | api | workers | web |
|---|---|---|---|
| `DATABASE_URL=${{Postgres.DATABASE_URL}}` | ✓ | ✓ | |
| `DATABASE_URL_READONLY` (above) | ✓ | | ✓ |
| `REDIS_URL=${{Redis.REDIS_URL}}` | ✓ | ✓ | |
| `APP_URL`, `NEXT_PUBLIC_API_URL`, `SENTRY_DSN`, `SENTRY_ENVIRONMENT` | ✓ | ✓ | ✓ |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` | ✓ | ✓ | |
| `STORAGE_ENDPOINT`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY` | ✓ | ✓ | |
| `STORAGE_PRIVATE_BUCKET` (digital products' files) | ✓ | | |
| `STORAGE_PUBLIC_URL` | ✓ | ✓ | ✓ |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM` | ✓ | ✓ | |
| `PAYMENT_SECRETS_KEY` | ✓ | ✓ | |
| `CHIP_SECRET_KEY`, `CHIP_BRAND_ID`, `CHIP_BASE_URL`, `CHIP_PUBLIC_KEY`, `CHIP_WEBHOOK_PUBLIC_KEY` | ✓ | ✓ | |
| `CHIP_CALLBACK_BASE_URL=https://api.curios.my` | ✓ | ✓ | |
| `SESSION_SECRET` (`openssl rand -hex 32`) | ✓ | | |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI=https://api.curios.my/auth/google/callback` | ✓ | | |
| `COOKIE_DOMAIN=.curios.my` | ✓ | | |
| `TRUST_PROXY` (below) | ✓ | | |
| `NEXT_PUBLIC_SENTRY_DSN` | | | ✓ |

**`admin`** takes `DATABASE_URL_READONLY`, `APP_URL`, `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` and
`SENTRY_ENVIRONMENT` as `web` does, plus `NEXT_PUBLIC_ADMIN_API_URL=https://api.curios.my` (built
in, like `web`'s `NEXT_PUBLIC_*`). It needs the API to have `ADMIN_ORIGIN=https://admin.curios.my`:
unset, the API registers no `/admin` routes and the admin app can sign nobody in.

Production refuses to start without storage, the private bucket and the CHIP keys: there is no
local fallback for any of them, by design. `CHIP_WEBHOOK_PUBLIC_KEY` goes on one line with each
break written `\n` (see CHIP setup). Never set `INGEST_ALLOW_PRIVATE_ADDRESSES` here. Leave
`RATE_LIMIT_*` unset: the defaults are the production values.

**`TRUST_PROXY`.** A visitor reaches the API through Cloudflare and then Railway's edge, so the
rate limits must take the address from `X-Forwarded-For`, trusting only those two. Fastify will
not take a hop count (it fails closed), so it is a list: private ranges for Railway's edge, then
Cloudflare's published ranges (https://www.cloudflare.com/ips/, current at 2026-10-27):

```
TRUST_PROXY=uniquelocal,100.64.0.0/10,173.245.48.0/20,103.21.244.0/22,103.22.200.0/22,103.31.4.0/22,141.101.64.0/18,108.162.192.0/18,190.93.240.0/20,188.114.96.0/20,197.234.240.0/22,198.41.128.0/17,162.158.0.0/15,104.16.0.0/13,104.24.0.0/14,172.64.0.0/13,131.0.72.0/22,2400:cb00::/32,2606:4700::/32,2803:f800::/32,2405:b500::/32,2405:8100::/32,2a06:98c0::/29,2c0f:f248::/32
```

Railway does not document its edge's addresses, so check it once deployed: sign in from your own
connection, then find that request in the `api` logs. Its `remoteAddress` must be your own public
address (search "what is my IP"). A Cloudflare or `100.x`/`10.x` address there means a proxy is
missing from the list, and every visitor would share one rate-limit budget: add the address
shown and redeploy. `true` is not the answer: Cloudflare appends to `X-Forwarded-For` rather than
replacing it, so `true` lets a caller write their own address and dodge every limit.

### Order, the first time

1. Create Postgres and Redis.
2. Create `api` with its variables, then deploy. Its pre-deploy builds the schema and the role.
   Check `https://<its railway domain>/health` answers `{"ok":true}`.
3. Create `workers`; its logs say "workers up".
4. Create `web`. Its `NEXT_PUBLIC_*` must be set before this first build.
5. Domains, below.
6. Admin: set `ADMIN_ORIGIN` on `api` and redeploy it, create `admin`, add its domain, then
   create the first admin account (below).

### Domains through Cloudflare

In Railway, add `curios.my` to `web`, `api.curios.my` to `api` and `admin.curios.my` to `admin`
(Settings → Networking → Custom Domain); each shows a CNAME target. In Cloudflare DNS add those
CNAMEs, proxied (orange cloud), and set SSL/TLS to **Full (strict)**: Flexible sends Railway plain
HTTP and loops on its redirect. If Railway's domain check stays pending, turn the record's proxy
off until Railway shows it verified, then on again.

### The first admin account, in production

`admin:create` asks for the password at a prompt, so it needs a terminal on the production
database. Either way, the email and name are arguments and the password is typed at the prompt.

- **Inside the `api` service** (Railway CLI: `railway link`, then `railway ssh` and pick the api
  service): `node --import tsx apps/api/scripts/admin-create.ts <email> "<name>"`. Not
  `pnpm --filter @curios/api admin:create`, whose script wants a `.env` file the container has not.
- **From your own machine**, against Postgres's public address (Postgres → Variables →
  `DATABASE_PUBLIC_URL`; it needs the service's TCP proxy turned on):
  `DATABASE_URL="<that url>" pnpm --filter @curios/api exec tsx scripts/admin-create.ts <email> "<name>"`.
  Turn the proxy off again afterwards if nothing else uses it.

Then sign in at `https://admin.curios.my`.

Chat replies stream (server-sent events) and pass through Cloudflare's proxy as they are.

### After a deploy

`api.curios.my/health`; sign in (cookies on `.curios.my`); ask a page a question (chat streams,
API and Redis up); open `/app/store`. A release goes out by moving `production` to the commit:
`git push origin main:production`.

---

## Admin

The admin app (`apps/admin`) and its `/admin` API routes. What it is and the rules it keeps are in
`devDocs/ADMIN.md`.

### Creating an admin, or resetting one

There is no sign-up. Run, from the repo root:

```bash
pnpm --filter @curios/api admin:create <email> "<name>"
```

It asks for the password twice at a prompt that does not echo (at least the minimum length it
names, at most 200); the password is never an argument, so it never reaches a shell history or a process list. A
new email creates the admin. An email that already exists is a reset: the password is replaced, a
disabled admin is enabled again, and **that admin's sessions are ended**, so anyone holding the old
one is signed out. It uses `DATABASE_URL` from `.env`, so check which database that is before you
run it against production.

There is no "forgot password" on the page. A reset is this command again with a new password.

FAQ pages are cached for 60 seconds (`revalidate = 60`), so suspending or bringing back a page reaches
its FAQ pages within that window; every other surface changes on the next request.

### What each switch does during an outage

Controls has five switches. Each writes an audit row and asks for a reason when you turn it off
(turning one back on is recorded as "Turned back on"); the banner asks for no reason, its text is
recorded instead. Each switch is read again where it applies, and every process caches the settings
for 30 seconds, so a switch takes effect within about 30 seconds and a running job notices it too.
Reading new sources pauses the ingest queue before it saves: if Redis can't be reached, Controls
says "Couldn't reach the reading queue. Nothing was changed. Try again." and nothing changed. Off means
stop, not hold: nothing is queued to be sent when it comes back. Turn it back on when the outage is
over; the audit log says who turned it off and why.

| Outage | Switch | What happens | What still works |
|---|---|---|---|
| The model provider is down or slow | Chat answers | Every page gives the short fixed reply, including the owner's tester and the order lookup in chat. No conversation is counted against anyone's cap | Pages, Store, leads. Grouping questions keeps running and retries its failed model calls |
| Sources are being read badly, or Redis is struggling | Reading new sources | The ingest queue pauses. Owners can add sources and those wait; owner re-reads and admin retries are refused | Everything else. Reading sources shows "Queue paused" |
| CHIP is down | CHIP payments | Billing shows "Online payments are paused for a moment"; checkouts offer only the owner's own QR or bank transfer; connecting a shop's own CHIP account and its RM1 "Curios test" are refused; auto-renew is skipped, checked again before each charge, and a card whose plan ended meanwhile is still tried once the switch is back on, up to 7 days after its plan ended (past that, auto-renew is turned off and the owner told) | QR and bank transfer orders; pages already paid for |
| Mail is failing or being abused | Emails to owners | Owner notification emails are dropped, not held | Sign-in, verification and password reset mail; admin's own mails (suspend, bring back, report warning) |
| Something is wrong with sign-up | Sign-ups | The sign-up screen says Curios is full for now | Existing owners sign in as usual |

A webhook CHIP could not deliver during the outage shows in Payments' webhook log as failed. Replay it
once CHIP is back: the stored message goes through the same handler, which asks CHIP about the purchase
before it grants, so a replay of a payment that was never made grants nothing.

### Changing a price

Monthly and yearly prices, the cap and the free limits are saved in Controls and are live within about
30 seconds: each process (API, workers, web, admin) caches settings for 30 seconds, and the API that
saved clears its cache at once. The landing and legal pages are regenerated in the background at most
every 30 seconds after a request (the FAQ pages every 60), so the first visit after a quiet stretch
may still show the previous price once; the next shows the new one. Allow a minute before telling
anyone it is changed. The next CHIP purchase is raised at the new price; a plan someone has already
paid for keeps its period.

A build with no database prerenders the landing and legal pages at the default prices, until their
first regeneration. **The production web build is one:** `Dockerfile.web` declares no
`DATABASE_URL_READONLY` build argument (Railway hands a service variable to a Docker build only as a
declared `ARG`), so after every deploy the first visitor to the landing or legal pages sees the
default prices, and the regeneration that visit starts shows the stored ones.

If the database cannot be reached the web falls back to the default prices rather than failing, so a
page showing the old price during a database outage is that fallback, not a failed save. **Nothing is
charged at that fallback:** while the API cannot read the settings, a plan purchase answers "Online
payments are paused for a moment. Try again soon." and the auto-renew run is skipped, to try again on
its next run. A shop's own online checkout is unaffected, since its prices are the owner's.

### The read-only role after a deploy

Production re-runs `packages/db/prisma/sql/readonly-role.sql` after `migrate deploy`, as part of
`scripts/prepare-database.ts` (see "Deploying on Railway"). That is what keeps `ChipWebhookEvent.body`
hidden from the read-only role: the body holds the payer's name and email, so the role is granted the
table's other columns only (and `Report.reporterIpHash` is withheld the same way). Admin's Payments
log therefore never shows a body. If you ever grant the role the table by hand, run the script again.

### Environment

| Variable | Where | What it does |
|---|---|---|
| `ADMIN_ORIGIN` | API | The admin app's address (`http://localhost:3002` locally, `https://admin.curios.my` in production). **Unset, the `/admin` routes are not registered and CORS is unchanged**; the API still starts. Set, CORS allows this origin for `/admin` only. |
| `NEXT_PUBLIC_ADMIN_API_URL` | admin app | Where the admin app calls the API (`http://localhost:3001` locally). |
| `COOKIE_DOMAIN` | API | Blank locally. In production `.curios.my`, so the admin cookie the API sets is shared with the admin subdomain. The `curios_admin` cookie is httpOnly, SameSite strict and Secure in production, 8 hours, no refresh. |
| `TRUST_PROXY` | API | Admin sign-in is rate limited per caller address (10 per 15 minutes). Behind a load balancer this must be set, or every visitor is throttled as one caller. Prefer the proxy's address over `true`. |

`.env` lags `.env.example`: after pulling, diff the variable names. An admin app with no
`NEXT_PUBLIC_ADMIN_API_URL` cannot sign anyone in.

### Running it locally

`pnpm dev` starts it with the rest, on port 3002. Sign in at `http://localhost:3002` with an admin
made by the command above. It needs the API on 3001, which needs Docker (Postgres and Redis) up.
Its reads use the read-only role, so a restored or reset test database needs
`packages/db/prisma/sql/readonly-role.sql` run again (see "Restoring the test database").

### Deploying to a subdomain

When admin goes live:

1. Point `admin.curios.my` at `apps/admin` (`pnpm --filter @curios/admin build`, then `start`, port
   3002 by default).
2. Set the API's `ADMIN_ORIGIN` to `https://admin.curios.my`, the admin app's
   `NEXT_PUBLIC_ADMIN_API_URL` to the API's public address, and `COOKIE_DOMAIN` to `.curios.my`.
3. Set `TRUST_PROXY` so the sign-in limit sees real addresses.
4. Consider Cloudflare Access (or any identity-aware proxy) in front of the whole subdomain. The
   app's own sign-in does not need it, but a second door costs nothing while there is one admin and
   TOTP is not built.
5. Create the first admin on the production database with the command above.

Owners must never be served admin code: do not route `curios.my/admin` anywhere.
