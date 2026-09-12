# Slice 8 — The three leads that make the case

> Intended path: `devDocs/slice-8-build-spec.md`

Roadmap item 7 is "billing and caps". Slice 7 did the caps. This is the first half of what
is left, and it takes no money.

Every page today is `mode BUSINESS` by default and gets everything: the capture card, lead
qualification, FAQ generation, indexing. There is no such state as *a business page that
has not paid*, so there is nothing for a price to attach to. This slice creates that state
and gates exactly one thing on it.

Collection — Billplz bills, the signed callback, `/app/billing` — is slice 9. The split is
deliberate: everything here is testable with no third party, no secrets, and no webhook,
and slice 9 cannot silently break a gate that already works.

---

## What is in, what is out

| In | Out (and where it goes) |
|---|---|
| `Page.paidUntil` and `Page.leadsCaptured` | Billplz, bills, callbacks, `/app/billing` — slice 9 |
| `canCapture` in `packages/core`, the one rule | A `Subscription` model. There isn't one; see below |
| The gate enforced on the page **and** at the endpoint | Branding on free pages — named in README, still unbuilt |
| Three free leads, then capture stops | A lower conversation cap for unpaid pages — deliberately not doing this |

**The price is already settled** and does not belong in code yet: RM39/month, RM390/year,
personal free. Nothing in this slice reads a price, because nothing here takes money.

---

## Why there is no subscription object

Both plans are one-off FPX bills — that decision is recorded in README's Settled decisions,
and it followed from Billplz having no e-Mandate and FPX being unable to auto-charge. A
one-off bill has no lifecycle to model. So paid state is a date:

```prisma
/// Paid through this instant. Null means never paid. A one-off bill extends it;
/// there is no subscription to activate, suspend, or reconcile.
paidUntil      DateTime?
/// Leads ever captured. Never decremented -- see below.
leadsCaptured  Int      @default(0)
```

Lapsed is `paidUntil < now`. There is no lapse event to fire, no state to drift out of sync
with the processor, and nothing to reconcile nightly. A `Subscription` table here would be
modelling a lifecycle the payment rail does not have.

**`leadsCaptured` is a counter, not `count(leads)`.** Slice 5 gave owners a lead delete, so
counting rows would let somebody delete their three trial leads and get three more. The
counter only goes up.

---

## The rule

`packages/core/src/plan.ts`, beside `qualify.ts`, `faq.ts` and `cap.ts` — the fourth
product rule expressed as a pure function rather than as scattered conditionals:

```ts
export const FREE_LEADS = 3;

export function canCapture(input: {
  mode: 'PERSONAL' | 'BUSINESS';
  paidUntil: Date | null;
  leadsCaptured: number;
  now: Date;
}): boolean;
```

True when the page is `BUSINESS` **and** either `paidUntil` is in the future or
`leadsCaptured < FREE_LEADS`.

**Three leads, not fourteen days.** A time trial can expire having produced nothing, which
teaches an owner the product does not work and spends the model budget proving it. A lead
trial ends only when the product has demonstrably worked, and a page that never captures
anything never pays and never feels cheated. It is also the honest unit: README says what a
business pays for is knowing who asked.

**`now` is a parameter.** The same reasoning as everywhere else in `packages/core` — a rule
that reads the clock itself cannot be tested at its boundary.

---

## Where it is enforced, and why twice

Two places, and both are required:

| Site | What it does | Why it is not enough alone |
|---|---|---|
| `apps/web/app/[handle]/page.tsx` | `canCapture` prop that hides the card | Hiding UI is not enforcement. `POST /leads` is anonymous and reachable with curl |
| `apps/api/src/modules/leads/lead.service.ts` | Refuses the capture | Without the page half, a lapsed owner still sees a card that will fail |

The endpoint already gates on `qualifies({ mode, visitorMessages })` and throws
`NotQualifiedError` — a 400 that deliberately does not confirm which conversation ids exist.
The plan check composes with it and reuses the same error, for the same reason: a distinct
"you have not paid" error would make the endpoint an oracle for the owner's billing status.

**This does not make that status private, and this slice cannot.** Hiding the card *is* the
signal. `canCapture` is a prop on a client component, so it rides in the page's RSC payload
and one anonymous `GET /handle` reads it -- less work than the endpoint oracle this closes,
which needs a three-turn qualifying conversation first. `noindex` marks personal pages, so
its absence separates a business page from a personal one. Any UI that changes with payment
status reveals payment status; the only alternative the spec considered -- render the card
and fail on submit -- is worse for the visitor and rejected below.

So the endpoint's discipline is worth keeping for what it actually buys: the API adds no
second channel, and no clearer one than the page already is.

This is the same discipline slice 6 needed for `faqSlug`, and it failed a review there for
being half-wired. Both sites or neither.

---

## The counter, and the race it does not close

`leadsCaptured` increments **in the same transaction as the lead insert**. Two statements
that can partially fail would either lose a count — giving away a fourth free lead — or
count a lead that was never stored.

It does not close a check-then-create race: two captures arriving together on a page at two
leads both pass the gate and both insert, yielding four free leads instead of three.

Accepted, with the reasoning stated so nobody has to re-derive it. `Lead.conversationId` is
unique, so the race needs two *different* conversations completing capture in the same
instant on the same page — and the cost of losing it is one lead, once, on a page that has
just proved the product works and is the likeliest to convert anyway. A conditional
increment that closed it would have to express "paid or under the limit" as a single
`updateMany` predicate, which pushes the rule out of `packages/core` and into a Prisma
`where` clause where it cannot be unit-tested at its boundary. That is a worse trade than
one lead.

---

## What an unpaid page keeps

Everything except capture.

The FAQ pages stay generated and indexed, the public page stays indexed, chat keeps
answering, and the conversation cap is unchanged at 200. Only the capture card goes.

This is the whole of the lapse behaviour and it is deliberately narrow. Withdrawing FAQ
generation would 404 URLs Google has already indexed — URLs the owner earned — and rankings
do not return the moment a bill is paid. That is a punishment which outlives the lapse and
is visible to searchers who have no idea a payment was missed. Capture is what README says
they pay for, so capture is what stops.

**And the cap stays the same for unpaid pages.** A free page costs at most ~RM4.50 a month
and typically under a ringgit (see BACKEND.md's metering section). A second cap would put a
plan lookup on the SSE chat path, which currently makes no such read, and would degrade the
busiest free pages — the ones with the most engaged audiences and the best chance of
converting — in front of exactly the people worth impressing.

---

## Testing, and its limits

| Layer | What is proven |
|---|---|
| `packages/core` | Each arm of the rule with a negative case: personal refused however paid; expired `paidUntil` refused once the trial is spent; `null` `paidUntil` allowed while under the trial; the trial boundary at exactly `FREE_LEADS - 1`, `FREE_LEADS`, and one past it. |
| `apps/api` | The endpoint refuses a capture on a lapsed page that has spent its trial, and refuses it with `NotQualifiedError` rather than a distinguishable billing error. `leadsCaptured` increments exactly once per stored lead, and does not increment when the capture is refused. |
| `apps/web` | The card is absent for a lapsed page and present for a paid one and for a page still inside its trial. |
| Load-bearing | Removing either enforcement site must fail a test. Slice 6 shipped a half-wired two-site rule and a review caught it; a suite that passes with one site removed has not encoded this. |

**What no test covers.** Whether three is the right number. It is a judgement about how many
leads it takes for an owner to believe the product works, and the only thing that answers it
is watching real owners convert or not. `leadsCaptured` is the column that will answer it —
it keeps counting past three, so the distribution of leads-at-conversion is recoverable
later without a migration.

Nor does anything here prove an owner understands *why* capture stopped. The card simply
disappears. Telling them is `/app/billing`'s job in slice 9, and until that exists a lapsed
owner sees a card vanish with no explanation — which is the strongest argument for keeping
these two slices close together.

---

## One plan

1. **The rule** — `packages/core/src/plan.ts`: `FREE_LEADS`, `canCapture`, with tests. No
   consumers.
2. **The columns** — `Page.paidUntil` and `Page.leadsCaptured`, additive migration.
3. **The endpoint** — the check in `lead.service.ts`, and the increment inside the insert's
   transaction.
4. **The page** — `canCapture` on the public page, which needs both columns in
   `getPublicPage`.
5. **Gates and a walkthrough** — the four gates, and the manual checks: a page mid-trial, a
   page that has spent it, and a page whose `paidUntil` is in the past.

---

## Documents corrected by this slice

| Document | Correction |
|---|---|
| `README.md` | **This row was wrong.** There is no tier table in README — no root `README.md` exists at all, and `devDocs/README.md` holds Settled decisions, not tiers. The table described here is BACKEND.md's, so the correction below covers it. README instead gained a Settled-decisions row for the trial, which no document recorded. Found by Task 5's implementer, which correctly declined to invent a passage to fix. |
| `BACKEND.md` | The capture-card rule is described as gating on mode alone. It now also gates on plan. |
