# Manual verification — the capture gate

**Status: NOT RUN.** Written down at the end of slice 8 rather than run, for the same
reason the four documents before it were: the four gates are green and the branch is
about to be reviewed, and the checks that need a real browser watching a capture card
actually appear and disappear, or a real server refusing a real POST over the network,
are not things any gate can run. It is the fifth document of its kind, after
`manual-verification-google-link.md`, `manual-verification-leads.md`,
`manual-verification-faq.md`, and `manual-verification-caps.md`.

Re-run it after any change to `packages/core/src/plan.ts`, the plan-gate check in
`apps/api/src/modules/leads/lead.service.ts`, or `canCapture`'s wiring in
`apps/web/app/[handle]/page.tsx` or `apps/web/app/[handle]/ask.tsx`.

## Why it can't be automated here

`packages/core/src/plan.test.ts` already proves `canCapture` itself against every
combination of mode, `paidUntil`, and `leadsCaptured` the rule cares about, as a pure
function with no server in front of it. `apps/api/src/modules/leads/lead.service.test.ts`
proves the endpoint half — that `captureLead` calls `canCapture` with the stored page's
real fields and throws `NotQualifiedError` when it disagrees — but does it by calling the
service function directly against a stubbed Prisma client, never through Fastify.
`apps/api/src/modules/leads/lead.routes.test.ts` exercises the real HTTP route, but only
for `DELETE /leads/:id`; nothing sends a real `POST /leads` over the network in the whole
suite. `apps/web/app/[handle]/page.test.tsx` proves `page.tsx` reads the same two fields
and hands the right boolean to a *mocked* `Ask`. `apps/web/app/[handle]/ask.test.tsx`
proves the last mile — that `Ask` turns that boolean into whether `onCapture` exists at
all — against a stubbed `fetch`, never a real one.

What none of that reaches: a real browser, watching the actual `CaptureCard` physically
appear when a conversation qualifies and physically vanish when the page's plan lapses,
with nothing on screen explaining why. And a real `POST /leads`, reached the way the
deployed `Ask` component reaches it — over the network, past Fastify's schema and error
handler — refusing with the exact status and body a real `fetch` call would have to parse.

Checks 1, 2, 4, 5 and 6 need a browser rendering `@curios/ui/sheet`'s `AskSheet` and
`CaptureCard`, and this repo has no Playwright, Puppeteer, or other browser driver to
open one with. Check 3 is plain HTTP — a `curl` and a look at the response — and check 7
is plain SQL; neither needs a browser at all.

## Before you start

```bash
docker compose up -d                 # postgres + redis
pnpm --filter @curios/api dev        # 3001
pnpm --filter @curios/web dev        # 3000
```

Check nothing already holds those ports — an orphaned dev server answers instead, and you
will be testing old code without knowing it:

```bash
netstat -ano | grep -E ":(3000|3001)\s.*LISTENING"
```

You need one published `BUSINESS` page (called `YOURHANDLE` below) with at least one link
and one fact. Qualifying a conversation needs at least three visitor turns, one of them
carrying a specificity marker — a quantity, a count, a date ("2kg", "20 Mac"); see
`packages/core/src/qualify.ts` — the same shape `manual-verification-caps.md`'s check 5
already spells out. Capture itself is guarded by dedupe: one attempt per conversation, and
one phone number per page per 24 hours (`lead.service.ts`'s `DEDUPE_WINDOW_MS`), so each
check below that expects a *successful* capture needs its own fresh conversation and a
phone number not already captured on that page today.

## The three page states, and how to reach each by hand

### 1. Personal — capture never offered

No setup beyond `mode = 'PERSONAL'`. `paidUntil` and `leadsCaptured` never get read —
`canCapture`'s first line returns `false` before looking at either.

### 2. Business, unpaid

Two sub-phases live under this one label, and the gate treats them oppositely.

**Still inside the trial** (`leadsCaptured < 3`) is the default for a freshly seeded
Business page — no SQL needed. **Trial spent** (`leadsCaptured >= 3`, no active
`paidUntil`) is reached without actually capturing three leads:

```bash
# spend the trial without capturing three leads
docker exec -i curios-postgres psql -U curios -d curios -c \
  "UPDATE \"Page\" SET \"leadsCaptured\" = 3, \"paidUntil\" = NULL WHERE handle = 'YOURHANDLE';"
```

### 3. Business, paid

`paidUntil` in the future makes capture unconditional, whatever `leadsCaptured` holds:

```bash
# make it paid
docker exec -i curios-postgres psql -U curios -d curios -c \
  "UPDATE \"Page\" SET \"paidUntil\" = now() + interval '30 days' WHERE handle = 'YOURHANDLE';"
```

To put a page back to a fresh trial for a repeat run:

```bash
docker exec -i curios-postgres psql -U curios -d curios -c \
  "UPDATE \"Page\" SET \"leadsCaptured\" = 0, \"paidUntil\" = NULL WHERE handle = 'YOURHANDLE';"
```

Confirm which state a page is actually in before reading its behaviour as a result —
this is the query every check below leans on:

```bash
docker exec -i curios-postgres psql -U curios -d curios -c \
  "SELECT handle, mode, \"paidUntil\", \"leadsCaptured\" FROM \"Page\" WHERE handle = 'YOURHANDLE';"
```

---

## The seven checks

Note the baseline count in check 7 **before** running check 1 — that check reads before
and after two other checks, and the "before" half is only available once, at the start.

### 1. A page inside its trial offers the card, and a real capture succeeds

Confirm the page is in state 2's trial-active default (or reset it with the command
above). On the public page, hold a qualifying conversation. Confirm the capture card
renders with its consent line naming the shop, submit a real Malaysian mobile number, and
confirm the card replaces itself with "Got it. `<shop display name>` will message you on
WhatsApp." — `CaptureCard`'s own success state.

### 2. The trial's boundary, spent: the card simply vanishes

**This is the check that matters most in this document.** Run the "trial spent" SQL
above, reload the same public page — no restart needed; `page.tsx`'s own comment records
that the route carries `no-store` on every response and picks up a live `UPDATE`
immediately — hold another qualifying conversation, and confirm no capture card appears
anywhere in the sheet. Not a disabled one, not a message explaining why: nothing.

A lapsed page's visitor sees an ordinary answer and no path to leave a number, and
nothing on screen tells them the shop has a billing problem — that is `/app/billing`'s
job in slice 9, which does not exist yet. Whoever runs this walkthrough should judge for
themselves how bad that silence is. It is the strongest argument for shipping slice 9
close behind this one.

### 3. The server refuses the same conversation over HTTP, indistinguishably from an unqualified one

With the page still in the trial-spent state, take the `conversationId` from check 2's
attempt — the browser's network tab, or:

```bash
docker exec -i curios-postgres psql -U curios -d curios -c \
  "SELECT id FROM \"Conversation\" WHERE \"pageId\" = (SELECT id FROM \"Page\" WHERE handle = 'YOURHANDLE') ORDER BY \"createdAt\" DESC LIMIT 1;"
```

— and POST directly to the API, bypassing the sheet entirely:

```bash
curl -s -i -X POST http://localhost:3001/leads \
  -H 'content-type: application/json' \
  -d '{"conversationId":"CONVERSATION_ID","phone":"0123456789","consent":true}'
```

Confirm the response is `400` with `"code":"NOT_QUALIFIED"` and the same message an
unqualified conversation gets ("Keep chatting first, then we can pass your number on.").
That sameness is deliberate — `lead.service.ts`'s own comment says a distinguishable
"you have not paid" would tell an anonymous caller whether this owner is paying, which is
the owner's business and nobody else's. Nothing in the automated suite sends this request
over real HTTP: `lead.service.test.ts` calls `captureLead` directly against a stubbed
Prisma client, and `lead.routes.test.ts` only exercises `DELETE /leads/:id`.

### 4. Paid makes it unconditional, even with the trial already spent

Run the "make it paid" SQL above without resetting `leadsCaptured` — leave it at 3 from
check 2. Reload the public page, hold a fresh qualifying conversation, and confirm the
card is back and a capture succeeds. This is the "Business paid, always" half of the
rule: a live `paidUntil` overrides an exhausted trial entirely, matching `canCapture`'s
own order of checks — it looks at `paidUntil` before it ever looks at `leadsCaptured`.

### 5. A personal page never offers the card, in any state

Using a page with `mode = 'PERSONAL'`, qualify a conversation the same way as check 1 and
confirm the card never appears. Try it once with `leadsCaptured = 0` and once with
`paidUntil` set to the future, to confirm neither the trial nor a live payment ever
matters once mode fails first.

### 6. Everything but capture is untouched on the lapsed page from check 2

Reload `/[handle]` and `/[handle]/faq` directly and confirm every link, fact, and FAQ
entry still renders exactly as before. Ask an ordinary question in the sheet and confirm
chat still answers normally. The conversation cap (`FREE_CONVERSATIONS_PER_MONTH = 200`)
is a separate counter from `leadsCaptured`, and this slice does not touch it —
`manual-verification-caps.md`'s check 3 makes the equivalent claim about the conversation
cap; this is the same claim about the plan gate. The thing that stops on a lapsed page is
capture, and only capture.

### 7. `leadsCaptured` only increments on an actual capture

Before check 1, note the count:

```bash
docker exec -i curios-postgres psql -U curios -d curios -c \
  "SELECT \"leadsCaptured\" FROM \"Page\" WHERE handle = 'YOURHANDLE';"
```

Run it again right after check 1's successful capture — it should read one higher than
the baseline. Check 2's SQL then overwrites the count to 3 directly, which is Postgres
doing the writing, not the code path this check is about. The comparison that matters is
around check 3: read the count once right before that check's `curl` (it should be the 3
check 2 just set) and once right after (it must still read 3, unchanged). `lead.service.ts`
increments `leadsCaptured` in the same `$transaction` as the `Lead` row it creates,
specifically so a refusal can never spend the trial without a lead to show for it, and a
stored lead can never go uncounted. This check watches for either half of that guarantee
failing silently on a refusal.

---

## Recording the result

Note which checks you ran and what you saw, in this file, with the date. Report any not
run rather than leaving them ambiguous — that ambiguity is why this document exists.
