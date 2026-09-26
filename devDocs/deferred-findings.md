# Deferred findings

Real problems found by review, deliberately not fixed in the branch that
found them, with the reason. This is not a wishlist — everything here was
verified to exist. Each entry says what it costs to leave alone, so the next
person can rank them against new work rather than rediscovering them.

Opened 2026-09-10, from the whole-branch review of `slice-5/leads`.

Manual checks that no agent can run are not findings and are not listed here. They live
in their own documents: `manual-verification-google-link.md` (slice 2, the Google round
trip), `manual-verification-leads.md` (slice 5, the leads screen — **not run**),
`manual-verification-faq.md` (slice 6, FAQ generation — **not run**), and
`manual-verification-caps.md` (slice 7, the conversation cap — **not run**).

---

## Cross-cutting

### The four owner screens diverge, and the nav now presents them as one

`apps/web/app/app/layout.tsx` wraps children in `Shell`, which renders
`<main>`. `leads/page.tsx` and `questions/page.tsx` then wrap in `Shell`
*again* — so `<main>` inside `<main>`, and `max-width: 560px` with
`padding: 32px 16px 64px` applied twice. Those two screens render a 528px
column starting 32px lower than review and settings.

| Screen | Heading | Landmark |
|---|---|---|
| Review | none | one `<main>` |
| Questions | nested `Shell title` → `<h1>` | two `<main>` |
| Leads | nested `Shell title` → `<h1>` | two `<main>` |
| Settings | `<h2 className={styles.heading}>` | one `<main>` |

`AppNav` also renders *inside* `<main>`, which is the wrong place for a
navigation landmark.

Introduced by the questions screen in slice 5 plan 1, doubled by leads.
Deferred because the fix touches two screens outside the branch that found
it. **Cost of leaving it:** a screen reader announces two mains on half the
dashboard, and the four screens the nav claims are one product are visibly
not. Gets worse at screen five.

### `toMessage` is copied verbatim into three files

Identical three lines in `lead-list.tsx`, `question-list.tsx` and
`review-queue.tsx`. `apps/web/lib/api.ts` already owns `ApiError` and is the
obvious home. Two copies was a coincidence; three is a missing helper.

### The `wa.me` digits-only rule is implemented twice, in two packages

`apps/web/app/app/leads/lead-list.tsx` and `apps/workers/src/leads/notify.ts`,
with near-identical comments. `packages/core` already owns phone form
(`normalizeMalaysianPhone`), and the schema comment on `Lead.phone` says so.
A rule whose stated failure mode is "opens WhatsApp on a broken number"
should have one implementation.

---

## Leads

### The dashboard's WhatsApp link drops the prefilled reply the email has

`apps/workers/src/leads/notify.ts` builds
`https://wa.me/<digits>?text=<greeting>` — a greeting in the customer's own
language, which is the whole point of `replyLanguage()`. The leads screen
builds a bare `https://wa.me/<digits>`. Same lead, same owner, same action,
two different results depending on which surface they came from.

Pointed because the screen deliberately reuses the notification's slot
labels, arguing that "an owner who has seen one has seen the other" — it
unified the cosmetic half and diverged on the half that does the work.

Fix: lift `replyLanguage` and the greeting builder from
`apps/workers/src/leads/notify.ts` into `packages/core`, beside
`normalizeMalaysianPhone`, and use it from both. Deferred because that is a
workers refactor, not a leads-screen edit.

### The transcript fetch is unbounded

`packages/db-read/src/leads.query.ts` selects `messages` with no `take`. 50
leads × every message in each conversation, all serialised into the RSC
payload for `/app/leads`, when at most one transcript is ever visible. The
first query in `db-read` to fetch an unbounded nested collection.

The plan's justification was "a conversation is a handful of short rows."
Nothing enforces that: `MAX_HISTORY_MESSAGES = 10` in `chat.service.ts` bounds
only what goes into the prompt, and persistence has no cap. A `take: 40` on
the messages select, or fetching the transcript on expand, removes the
assumption.

### A lead delete is not a right-to-erasure primitive

Recorded in the docstring on `deleteLead` as of `749165b`, and repeated here
because it is a product question, not a code one: a phone number typed into
the chat itself ("wasap saya 012-345 6789") lands in `Message.content`, which
the transcript drawer renders back verbatim, and `Question.text` keeps
whatever a visitor typed. Deleting the Lead clears neither.

Cascading into Conversation would corrupt the questions screen's ask counts,
so the current behaviour is right. What is missing is a decision about
unstructured PII under the PDPA. **Open question, not a bug.**

### `Lead.conversation` cascades Conversation → Lead

`onDelete: Cascade` on the FK-holding side means any future
conversation-retention or pruning job silently destroys leads — the thing the
product charges for. No such job exists today; the only `deleteMany` calls in
the codebase outside the lead delete are on `Session`. **Latent, not live** —
recorded so whoever writes that job sees it first.

---

## FAQ

Opened 2026-09-11, from Task 4's review of `slice-6/faq`.

### `getFaqIndex` can silently return fewer entries than it should

`packages/db-read/src/faq.query.ts` applies `take` to the has-a-slug set before
filtering for has-an-answer: it reads up to `limit` questions ordered by
`askCount desc`, then drops whichever of those turn out to have no
`PinnedAnswer` behind them. On a page with more than 50 slugged questions,
if one of the top ones by ask count has had its answer withdrawn, the
returned list is shorter than it should be — a lower-ask-count question that
does have an answer, and would otherwise have made the list, is silently
left off rather than filling the gap.

Inherent to the two-query approach the read gates chose over a join (see the
comment above `getFaqIndex`): a join could filter before limiting, a
`findMany` against two unrelated tables cannot. Costs nothing today — no page
has anywhere near 50 FAQ-qualifying questions — and would need either a wider
first read (take some multiple of `limit`, then trim after the join in
memory) or a real join to fix properly.


## Caps

Opened 2026-09-11, from Task 1's review of `slice-7/caps`.

### `conversationCap()` duplicates `limit()`, and the cheap fix is unavailable

`conversationCap()` in `packages/core/src/cap.ts` reproduces the body of `limit()` in
`apps/api/src/plugins/rate-limit.ts` almost line for line — the same undefined-or-empty
short circuit, the same `Number.isInteger || < 1` guard, the same error template —
differing only in a hardcoded env-var name and fallback where `limit()` takes
parameters. The cheap fix is unavailable: `packages/core` cannot import from `apps/api`
without inverting the layering, and `limit()` is not exported anyway. The honest fix is
to lift a generalised `envInteger(name, fallback)` into `packages/core` and have the
rate-limit plugin import it from there — which means editing a wallet control for the
sake of seven lines of stable parsing. Left alone deliberately; the cost is that a third
call site copies the same seven lines before anyone unifies them.


## Tests

### The "clamps the limit" test tests the limit, not the clamp

`packages/db-read/src/leads.query.test.ts` asserts `getLeads(mine, {limit: 1})`
returns one row. Changing `Math.min(options.limit ?? 50, 100)` to
`options.limit ?? 50` keeps it green — the `100` ceiling the name claims is
untested. `questions.query.test.ts` has the same shape, so this is inherited.
Assert `limit: 500` returns fewer than 500.

### `Nav.test.tsx` tests a copy of the nav, not the nav — fixed

`Nav.test.tsx` declared its own `items` fixture duplicating `ITEMS` in
`app-nav.tsx`, and `AppNav` itself had no test, so changing `/app/leads` to
`/app/lead` broke the nav with every test passing.

Fixed by `apps/web/app/app/app-nav.test.tsx`, which renders the real `AppNav` and
reads its links off the page rather than importing `ITEMS` — a second list was
the original problem. It checks every href has a `page.tsx` on disk, then that
exactly the matching link is marked on every screen. Proven by mutation:
mistyping `/app/leads` fails "links only to screens that exist" with
`/app/lead has no page.tsx`, and no longer passing the pathname fails "marks
exactly the link for the screen it is on, for every screen".

---

## Design

### Nav links have a colour transition but no state that triggers it

`Nav.module.css` declares `transition: color 120ms ease`, but the only colour
change is `[aria-current='page']`, which changes on navigation, not on press.
There is no `:hover` or `:active`, so nav links are the only interactive
controls on the dashboard with no press feedback — every `Button` variant has
one, and so does `.whatsapp`. Either add the press state or drop the dead
transition.

### Nav tap targets are well under 44px

`Nav.module.css`: 12.5px text, no padding, 20px gaps. `Button` and `.whatsapp`
both set `min-height: 44px`, so the codebase's own bar is explicit. This is
the primary navigation of a mobile-first product.

### `merah`'s "only here" comment is now false

`Button.module.css` claims merah is "only here… nothing else may borrow it".
`Callout.error` borrowed it first; `.confirm` in `leads.module.css` is the
second. Both borrows are defensible — a destructive confirmation panel is not
decoration — but the comment should say so instead of claiming exclusivity.
Related: an error `Callout` rendered inside `.confirm` is a merah border on
`--paper` inside an identical merah border on `--paper`.

### `.whatsapp` duplicates `.primary` rather than reusing it

`leads.module.css` re-implements Button's primary styling because the control
must render as an `<a>`. The argument for the anchor is right; the copy means
a future change to Button's shape skips this control. An `as`/`href` prop on
`Button` would cost less long-term.

---

## Personal tier

Opened 2026-09-19, from the whole-branch review of `slice-10/personal-tier`.

### `extractedCount` counts rows written, not facts created

`apps/workers/src/ingestion/extract.service.ts` writes `extractedCount: rows.length`,
while `runExtraction` itself returns `created.count` — the number left after
`skipDuplicates` has already thrown duplicates away. The mismatch predates this slice,
but this slice is what made the number load-bearing: `JobStatus` now branches an owner
between the found-facts screen and the nothing-found screen entirely on whether
`extractedCount` is zero. Re-ingesting the same URL writes a non-zero `extractedCount`
with zero new facts, so the owner is sent to a Review queue with nothing new waiting in
it, having just been told the crawl worked.

Not fixed here because the two callers of `runExtraction` disagree about which count
they want, and reconciling them means deciding what the field should mean, not swapping
one property access for another. Worth fixing the day anyone deliberately re-ingests a
source that has already been read — today onboarding only ever calls it once.

### `'PERSONAL' | 'BUSINESS'` is hand-written in about a dozen places, under three names

The same two-value union appears as `mode`, as the bare literal union, and as `Tier` in
`claim-form.tsx` — three names for one type, spread across `packages/core` (where
`shouldIndex`, `planState` and the FAQ helpers all spell it out by hand) and `apps/web`.
A `PageMode` exported from `@curios/core`'s barrel — `import type`-safe for the client
components that may not pull in the rest of the barrel — would let every one of those
sites read the same name and retire `Tier` as a synonym that adds nothing of its own.

Not fixed here because none of the sites are wrong today; the duplication costs nothing
until the two names drift, which is a small, low-urgency cleanup rather than a review
finding with a deadline. Worth its own small commit rather than folding into a fix wave
that touches none of the type's actual behaviour.

### `startIngestion` guards "neither" but not "both"

`apps/api/src/modules/ingest/ingest.service.ts` lets `pastedText` win when a caller
supplies both sources, silently dropping `sourceUrl` rather than refusing the call —
and the database's `Ingestion_one_source` CHECK cannot catch it, because the row it
ends up writing (pastedText, no sourceUrl) is valid on its own terms. No production
path reaches this: the route's own schema already refuses a body carrying both fields,
and refuses one carrying neither, before `startIngestion` is ever called. But the
function's own comment sets a standard — one source, never both, never neither — that
its code only half enforces for a caller that is not the route. The "neither" case it
does guard throws `InvalidSourceUrlError`, whose message is about a URL, to a caller
that sent none of either kind.

Not fixed here because it is unreachable from the one caller that exists, and pinning a
test to behaviour no path can trigger is exactly the shape of test this codebase's own
convention warns against. Worth fixing if `startIngestion` ever gets a second direct
caller — a backfill script, an admin tool — that does not pass through the route's
schema first.

### The text adapter is imported directly, not injected

`extract.service.ts` takes the website adapter through `ExtractDeps.adapter`, the seam
this slice's own tests use to stub a crawl — but it imports `textAdapter` at the top of
the file and calls it directly for the pasted-text path. The seam that exists for one
source does not exist for the other, so a test wanting to stub the text path has to run
the real adapter instead.

Not fixed here because the text adapter is trivial enough — turn a string into one
`SourceDocument` with no URL — that nothing has yet needed to fake it, and the tests
that exist run it for real without friction. Worth fixing in step with `ExtractDeps`
the day the text adapter grows enough behaviour that a test wants it stubbed.

### The two new controls have no stylesheet

The claim form's tier `fieldset` in `claim-form.tsx` and the Settings search-indexing
checkbox are bare markup — no CSS module — on screens where every sibling control
either comes from `@curios/ui` or carries its own module, the pattern `leads.module.css`,
`questions.module.css` and `settings.module.css` all follow. The walkthrough already
marks the claim form as needing a person's eye before launch; this is exactly what that
eye will land on first.

Not fixed here because styling two controls is a design decision, not the kind of
correctness fix this wave was scoped to. Worth a small styling pass before the claim
form or the Settings screen is put in front of a real owner.

### Hand-written CHECK constraints take a validating lock

`ADD CONSTRAINT ... CHECK` without `NOT VALID` — the form used for `Ingestion_one_source`
in this slice's migration — takes `ACCESS EXCLUSIVE` on the table for the length of the
migration and validates every existing row against the new rule before releasing it.
Instant on today's tables, and irrelevant before launch, since there is no traffic to
block. The zero-downtime form is `ADD CONSTRAINT ... CHECK (...) NOT VALID` followed by
a separate `VALIDATE CONSTRAINT`, which takes only a `SHARE UPDATE EXCLUSIVE` lock and
does not block reads or writes while it scans.

Not fixed here because rewriting a migration already applied is not something to do for
its own sake, and the cost today is genuinely zero. Worth adopting as the default the
day `Ingestion` — or any table gaining a hand-written CHECK — is large or live enough
that an `ACCESS EXCLUSIVE` lock would be felt.

---

## Retrieval

Opened 2026-09-26, from the whole-branch review of `slice-12/retrieval`.

### There is no scheduled vector backfill

`scripts/backfill-fact-embeddings.ts` (`pnpm exec tsx scripts/backfill-fact-embeddings.ts`)
only ever runs when someone remembers to run it by hand. Nothing calls
`syncFactEmbeddings(prisma, embedder, {})` on a schedule. A page can be pushed into
fallback in two ordinary ways with nothing wrong on the owner's side: an ingestion whose
batched embedding call fails (`runExtraction`, `apps/workers/src/ingestion/extract.service.ts`)
still writes its facts, and an owner's fact edit whose re-embed fails (`editFact`,
`apps/api/src/modules/facts/fact.service.ts`) still commits the claim — both deliberately,
so a vendor blip never blocks a write that has nothing to do with retrieval. Either one
during an embeddings outage (see OPERATIONS.md's "The embeddings provider is down") leaves
that page's facts short a vector, and unlike the outage itself, that does not clear on its
own once the provider recovers.

**Cost of leaving it.** Answers on the affected page stay entirely correct — every fallback
path here degrades to "send every fact," never to a wrong or missing one — and the only
cost is roughly twice the per-answer token spend until someone runs the backfill by hand.
No owner-visible symptom names this: the page simply looks like a fact list too small to
benefit from retrieval, indistinguishable from `below-minimum` without reading the `chat
retrieval` log's `reason` alongside a `ModelCall` token check.

Not fixed here because it is a new operational job, not a bug in what this slice shipped.
The fix is a periodic workers job — daily is plenty, given the cost is doubled tokens, not
wrong answers — calling `syncFactEmbeddings(prisma, embedder, {})` with no filter, exactly
the backfill script's own call. It is safe to run on a schedule precisely because it is
idempotent: a database with nothing to fix scans every fact and writes nothing.

### `editFact` can 500 after the edit has already committed, and its own cleanup can fail silently

`editFact` (`apps/api/src/modules/facts/fact.service.ts:111`) reads the fact back
(`prisma.fact.findUnique`) after the claim update at line 95-98 has already committed. A
throw from that read — a pool timeout, a dropped connection — propagates straight out of
`editFact` uncaught, and the owner sees a 500 for an edit that, underneath it, actually
saved. Nothing rolls the claim back; nothing tells the owner it worked.

The second half compounds it. Inside the catch that handles a failed re-embed
(`fact.service.ts:124`), the cleanup delete — `prisma.factEmbedding.deleteMany({ where: {
factId } })` — is not itself guarded. If that delete also throws (the same outage that
broke `syncFactEmbeddings` two lines above is a plausible reason it would), the stale
vector from before this edit survives, now matching claim text the fact no longer has —
a wrong vector, not merely a missing one, which is the one failure mode this whole slice's
fallback design exists to avoid.

**Cost of leaving it.** The 500 is a false negative on a save that worked — confusing, but
self-correcting the next time the owner reloads the page and sees their edit. The stale
vector is worse and does not self-correct: a wrong answer via a mismatched vector is a
retrieval failure the "everything or nothing" contract in `packages/core/src/retrieval.ts`
was built specifically to prevent, and this is the one path that can still produce it,
narrowly, only when two independent DB calls fail back to back.

Not fixed here because both fixes are behaviour changes to a function this slice did not
open — the read at line 111 needs its own try/catch deciding what "committed but unreadable"
should return, and the cleanup delete at line 124 needs either a retry or a way to surface
"this fact's vector state is now unknown" that is not simply eating a second exception. Worth
fixing together, since both are the same class of gap: this function assumes its own
best-effort cleanup cannot itself fail.

### Design limit: an edited fact keeps its old question

Recorded in `editFact`'s own docstring NOTE as of this slice, and repeated here because it
is a product question, not a code one. When an owner rewrites a fact's claim, the function
re-embeds only when `fact.question` is null — a fact that already carries a question is
matched on that question, which editing the claim does not change, by design: "this path
cannot change what was embedded." An owner who rewrites a fact to answer a different
question entirely (not just reword the same one) leaves it permanently matched against
whatever it used to be about.

**Cost of leaving it.** A visitor asking the fact's *new* topic will not find it — it is
still keyed on the old question's vector — while a visitor asking about the *old* topic
may still surface a fact that no longer says what it used to. Both are silent: nothing
logs or flags a fact whose question has drifted from its claim. Narrow in practice, since
most edits correct wording rather than swap topics, but the fact stays wrong for that
question until someone re-runs `scripts/backfill-fact-questions.ts` (itself a one-off, see
its header) or edits the fact again after its question is cleared by hand.

Not fixed here because it needs a real edit-the-question path — the NOTE in `editFact` says
explicitly that whoever adds one must re-embed unconditionally, not skip it the way an
unrelated claim edit does — which is new surface area, not a bug in what this slice shipped.

---

## Resolved

### A published question and answer have no way to come down — fixed

Was a launch blocker, opened and closed the same day. Both halves are now closed,
and the fix is deliberately two mechanisms rather than one:

**Suppression, for "this should not be public".** `Question.faqSuppressed` is a fifth
gate in `getFaqIndex` and `getFaqEntry`, set through `POST /questions/:id/suppress`
and reversible from the questions screen. A flag rather than a delete because
`chat.service.ts` upserts questions keyed on `(pageId, normalizedQuestion)` — a
deleted row is recreated the next time anybody asks the same thing, so a
delete-as-hide would quietly undo itself while the owner believed it had worked.
The slug and the answer both survive: the owner said "not public", not "not true".

**Erasure, for when the words themselves are the problem.**
`DELETE /questions/:id` removes the `Question` and its `PinnedAnswer` in one
transaction, both statements independently scoped to the owner's account. Leaving the
answer behind would keep the same content reachable through chat under the same
normalised key — erasure that erases nothing.

**And the latency.** `revalidate` on both FAQ routes dropped from 86400 to 60, so a
takedown is visible within a minute rather than within a day. `revalidatePath` from
the API was rejected: it needs a shared secret and couples two deployables, which is
exactly what choosing ISR over a worker was meant to avoid. Two indexed reads per
minute per page is the whole cost.

**Edit followed immediately**, and closed the last of it: the answered branch now
carries Edit answer alongside suppress and delete, prefilled from what the owner
wrote. `getQuestions` gained the answer text to make that possible, joined from
`PinnedAnswer` the same two-read way `getFaqIndex` does. No API change was needed —
`answerQuestion` already upserts, so a correction takes the path the first answer
took.


Kept here rather than deleted, so a reader who was told about a finding can
see what happened to it.

### The nav appears on `/app/onboarding` — fixed

`AppLayout` now gates `AppNav` on `getOwnerPage`, with
`apps/web/app/app/layout.test.tsx` covering both directions.

Deferring this was the wrong call, and the reason it was deferred was wrong
too: it was filed as touching "a screen this plan does not own", but `AppNav`
did not exist before commit a03fa2f — Task 4 of the same branch — and it was
mounted in `apps/web/app/app/layout.tsx`, a file that task edited. Onboarding
was the screen affected; the cause was a file the plan owned. A regression
belongs to the branch that shipped it.

The entry also offered three fixes as if they were equivalent — a route
group, per-screen rendering, or a `getOwnerPage` gate. They are not. A route
group excluding onboarding drops the nav there unconditionally, and
`onboarding/page.tsx` renders `<Ingest>` once a page exists, so an owner who
came back to add sources would be stranded with no way out. Only the gate
satisfies both states.

### `apps/api` intermittently exits 1 on an ioredis teardown race — fixed

Root cause: the fail-closed test in `rate-limit.test.ts` calls
`rateLimitRedis.disconnect()`, which returns before the socket is actually
down. A limiter command issued inside that window is queued and then rejected
by ioredis's close handler with nothing awaiting it, because the request has
already failed. The escaping rejection is what made the suite exit 1 while all
27 files passed.

Not the two-limiter race it looked like. A probe running the outage scenario
25 times reported 21 escapes, every one `Connection is closed.` thrown from
ioredis's socket-close handler rather than from the request path, which is
what ruled that explanation out.

Fixed by awaiting the client's `end` event after `disconnect()`, so the outage
state is unambiguous before the request is made: 21 escapes in 25 iterations
became 0, and the api suite went 6 for 6. Test-only change — the production
`skipOnError: false` is untouched, and the test was confirmed still
load-bearing by flipping it to `true` and watching exactly that test fail.

### A page's free trial is spendable by anyone, including its owner — resolved in slice 9

Found by slice 8's whole-branch review. Not a defect in slice 8's logic; two
decisions that were each right alone compose into a trap once a meter exists.

`POST /leads` is anonymous and carries `chatPerIpLimit` only — 100/hour per IP,
with no per-page limit, because `chatPerPageLimit` keys on a `handle` route
param that `/leads` does not have. Burning a page's whole trial therefore costs
about nine chat requests and three lead POSTs from one IP: three throwaway
conversations and three phone numbers to clear the 24-hour dedupe.

The likely case is not adversarial. A new owner tests their own page the way
`manual-verification-plan-gate.md` instructs — three visitor turns with a
number, submit a phone, confirm the "Got it" state. That is one of three free
leads gone. Two more checks with different numbers and the trial is over before
a real customer arrives. The card then vanishes with no explanation.

There is no way back. `deleteLead` deliberately never decrements, which is the
anti-farming reason the counter exists rather than `count(leads)`. There is no
page-delete endpoint, no admin app, no reset, and `@@unique([accountId])` stops
the owner starting over with a new page. The only route is manual `psql`, which
no document describes as an operational procedure.

This falsifies the spec's own argument for the trial's shape: "a lead trial ends
only when the product has demonstrably worked, and a page that never captures
anything never pays and never feels cheated." Three fabricated leads demonstrate
nothing, and leave the owner paywalled in front of an empty dashboard.

The review also claimed an amplifier — that `captureLead` never checks
`Page.published`, so testing an unpublished page spends the trial. **Checked,
and it is wrong.** `getPublicPage` (`page.query.ts:45`) and `chat.service.ts:101`
both filter on `published: true`, so an unpublished page has no conversation to
capture against. Reaching it needs publish → visitor chats → owner unpublishes →
capture completes, and a lead from a real conversation is one the owner should
keep. Dropped rather than carried forward.

What makes it likelier than it first looks, in the other direction: the dedupe
window is 24 hours per phone per page (`lead.service.ts:57`), so it does **not**
take three phone numbers. One owner, their own number, three days of poking at
their new page spends the whole trial.

**Shipped in slice 9's plan 2:** the supported reset. `POST /billing/trial-reset`
(`apps/api/src/modules/billing/billing.service.ts`) is one conditional update —
BUSINESS, `paidUntil` null, `trialResetAt` null, at least one lead captured — and
the button is on `/app/billing`. It can be used once, and a page that paid and
lapsed is refused with `TRIAL_RESET_USED`: that page owes a renewal, not a second
trial.

Still open, and still not required: a per-page limit on `POST /leads` to match
chat's 30/hour, and whether paying should consume the remaining trial — see
`plan.test.ts`'s pay, capture twice, lapse case. Neither blocks anything.

Kept here rather than deleted, so a reader who was told about a finding can
see what happened to it.

---

### A malformed OAuth callback is logged as nothing — found by the walkthrough audit

`GET /auth/google/callback` sends anything carrying `error`, or missing `code` or
`state`, straight to `/signin?cancelled=1` and returns — the first branch in
`auth.routes.ts` after the OAuth cookies are cleared. Nothing is logged on that
path. Every other failure falls through to the `catch`, which logs at error level
before redirecting.

That is right for someone who clicked Cancel at Google, which is an ordinary act
and not a fault to diagnose. It is wrong for a callback arriving with no `code`
and no `error` at all. That is not a cancellation but a broken redirect — a
misconfigured redirect URI, a proxy stripping the query string, a client dropping
a parameter — and it looks identical to a cancel and leaves no trace. The failure
an operator would most need to find is the one the log cannot show.

Not fixed here: it is a behaviour change, and this sweep was about verification.
Worth a `request.log.warn` that tells a real `error=` cancel apart from a callback
missing its parameters.

Also not pinned by a test, deliberately. A test asserting the silence would lock
the gap in. The guarantee worth pinning — that every failure reaching the `catch`
logs at error — needs a spy on the log stream, and pino bypasses a
`process.stdout.write` spy unless it is installed before the app is built (see
`lead.logging.test.ts`). The OAuth test files build their app in `beforeAll`, so a
spy bolted on there risks passing without ever seeing a log line.

### The FAQ takedown's "within the minute" is not automated — deferred with a reason

The audit counted FAQ check 7.1 as automatable: hiding a question must 404 both
`/faq` and the entry's own URL within the 60-second revalidate window. The audit
found the data half already covered, by the suppression tests in
`faq.query.test.ts` and the suppress route in `question.routes.test.ts`.

The timing half is the cache, not the query, so it needs `next build && next start`,
a real request, and polling through the revalidate window. No such harness exists
for the Next app — there is no equivalent of Fastify's `app.inject` — and building
one is infrastructure out of proportion to a single check. It stays in the
walkthrough as a manual step.
