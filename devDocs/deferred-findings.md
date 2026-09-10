# Deferred findings

Real problems found by review, deliberately not fixed in the branch that
found them, with the reason. This is not a wishlist — everything here was
verified to exist. Each entry says what it costs to leave alone, so the next
person can rank them against new work rather than rediscovering them.

Opened 2026-09-10, from the whole-branch review of `slice-5/leads`.

Manual checks that no agent can run are not findings and are not listed here. They live
in their own documents: `manual-verification-google-link.md` (slice 2, the Google round
trip) and `manual-verification-leads.md` (slice 5, the leads screen — **not run**).

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

## Tests

### The "clamps the limit" test tests the limit, not the clamp

`packages/db-read/src/leads.query.test.ts` asserts `getLeads(mine, {limit: 1})`
returns one row. Changing `Math.min(options.limit ?? 50, 100)` to
`options.limit ?? 50` keeps it green — the `100` ceiling the name claims is
untested. `questions.query.test.ts` has the same shape, so this is inherited.
Assert `limit: 500` returns fewer than 500.

### `Nav.test.tsx` tests a copy of the nav, not the nav

`Nav.test.tsx` declares its own `items` fixture duplicating `ITEMS` in
`app-nav.tsx`, and `AppNav` itself has no test. Change `/app/leads` to
`/app/lead` in `app-nav.tsx` and the nav 404s with every test passing.
Importing `ITEMS` into a small `app-nav.test.tsx` closes it.

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

## Resolved

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
