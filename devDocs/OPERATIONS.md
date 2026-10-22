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

Run it twice in this slice's life: once after the migration that added `FactEmbedding`,
and again every time `EMBEDDING_MODEL` changes — a fact whose stored vector came from an
older model is re-embedded, not skipped.

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

## CHIP setup

**Test and live keys.** CHIP gives a test secret key and a live one, under the same Brand ID. A test
key never moves real money; going live is swapping `CHIP_SECRET_KEY` and the webhook public key
below, nothing else. `CHIP_BASE_URL` is the same for both.

**Register the webhook** in CHIP's portal (Developers, then Webhooks). Subscribe to the events
`purchase.paid` and `purchase.payment_failure`, with the URL
`{CHIP_CALLBACK_BASE_URL}/billing/chip/webhook`. Copy the public key CHIP shows for that webhook into
`CHIP_WEBHOOK_PUBLIC_KEY`. In production the API refuses to start without it, and without it every
webhook would be refused.

**Auto-renew needs recurring card payments enabled on the CHIP account.** Without that, a purchase
that asks to keep the card is paid but keeps no token, the owner sees the "auto-renew couldn't be
turned on" line, and no renewal is ever charged. Ask CHIP to switch it on before launch.

**Callbacks can't carry a port.** CHIP refuses a callback or return address with a port, so
`http://localhost:3001` cannot be called back. Locally the return redirect and the workers' hourly
check still grant a payment. To exercise the webhook and callback themselves, run a tunnel on 443
(`cloudflared tunnel --url http://localhost:3001`) and point `CHIP_CALLBACK_BASE_URL` at it. See
`devDocs/manual-verification-billing.md`.

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
