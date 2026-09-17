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

**The leads screen now shows an owner how much of the trial is left, but nothing
stops them spending it on their own tests** — so expect this to happen anyway.

### 1. Confirm the state before changing anything

```bash
docker exec -i curios-postgres psql -U curios -d curios -c \
  "SELECT handle, mode, published, \"leadsCaptured\", \"paidUntil\" FROM \"Page\" WHERE handle = 'HANDLE';"
```

Read it before deciding. Three different situations look the same to an owner:

| What you see | What actually happened | Action |
|---|---|---|
| `leadsCaptured >= 3`, `paidUntil` null | Trial spent | Reset, if the leads were tests |
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
creates a page that is paid with no payment behind it. Once slice 9 exists there
will be a `Payment` table that is supposed to account for every paid page, and
this row will not reconcile against it — by then the reason will be a year old
and nobody will remember.

If someone genuinely needs to be given paid time — a goodwill gesture, an outage
— that is a decision with a record attached, not a `psql` statement. Wait for
slice 9's billing surface, or write down who authorised it and why alongside the
change.

### 4. Verify

Re-run the query from step 1 and confirm `leadsCaptured` is `0`. Then load the
page and confirm the capture card is back after a qualifying conversation. The
public page renders per request (`export const dynamic = 'force-dynamic'` in
`apps/web/app/[handle]/page.tsx`), so there is no cache to wait out — the next
request shows it.

### Retire this when

When there is a supported way to reset a trial — an admin or billing screen, not a
`psql` statement. The owner-visible counter this procedure was waiting on has
shipped on the leads screen, which should make the need rarer but not zero: an
owner who reads "3 of 3" still cannot get their trial back without you. See
`deferred-findings.md`.

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

## An orphaned Billplz bill

**Why this exists.** `createBillForOwner` (`apps/api/src/modules/billing/billing.service.ts`)
creates a `Payment` row, then asks Billplz for a bill, then writes the bill's id onto that
row. If the app crashes or the database is briefly unreachable between the second and third
steps, Billplz is left holding a real, payable bill, but the row that should resolve it keeps
`billplzBillId` null. The hourly check only ever looks at `PENDING` rows with a
`billplzBillId` set, so it skips this one by construction, and a callback that names this
bill finds no matching row and reports `unknown-bill`. Nothing in the system reconciles this
by itself.

**Recognise it** by a `PENDING` `Payment` with `billplzBillId` null and `createdAt` more than
a few minutes old — the update should be near-instant, so anything older did not merely lose
a race — paired with an owner reporting a bill they could not pay, or a payment that never
registered:

```bash
docker exec -i curios-postgres psql -U curios -d curios -c \
  "SELECT id, \"pageId\", plan, \"amountCents\", \"createdAt\" FROM \"Payment\" WHERE status = 'PENDING' AND \"billplzBillId\" IS NULL AND \"createdAt\" < now() - interval '5 minutes';"
```

**Resolve it.** The bill Billplz raised carries `reference_1` equal to that `Payment.id` --
that is what correlates the two sides. Look the bill up in the Billplz dashboard (or via its
API) by searching for a bill whose reference matches one of the `id`s above. If the bill was
genuinely paid, write its id onto the row so the hourly check grants it on the next pass:

```bash
docker exec -i curios-postgres psql -U curios -d curios -c \
  "UPDATE \"Payment\" SET \"billplzBillId\" = 'BILL_ID' WHERE id = 'PAYMENT_ID' AND status = 'PENDING' AND \"billplzBillId\" IS NULL;"
```

Expect `UPDATE 1`. If the bill was never paid, or none matches, leave the row alone; it ages
out like any other unpaid bill.

### Retire this when

When the create-bill request is made idempotent against Billplz -- so a retry after this
exact failure re-uses the same bill instead of the owner needing a human to find it -- or
when a scheduled sweep looks for exactly this shape (`PENDING`, `billplzBillId` null, old)
and either recovers or flags it without a person going looking first.
