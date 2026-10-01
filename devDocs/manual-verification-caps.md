# Manual verification — the conversation cap

> **Slice 15 note:** `PinnedAnswer`, `Question.answered`, `Question.faqSlug` and `Question.faqSuppressed` no longer exist; the answer, slug and suppression live on `Topic`. SQL and wording below that names them is out of date, so read it against `Topic` (see `manual-verification-topics.md`).

**Status: NOT RUN.** Written down at the end of slice 7 rather than run. It is the fourth
document of its kind, after `manual-verification-google-link.md`,
`manual-verification-leads.md`, and `manual-verification-faq.md`.

**Three of its seven checks no longer need a person.** A later sweep moved checks 1, 6 and
7 — the counter, and that a refused conversation costs nothing — into a test that drives the
real chat route; see the table below. The other four need a browser rendering the actual ask
sheet.

Re-run it after any change to `packages/core/src/cap.ts`, the cap branch in
`apps/api/src/modules/chat/chat.service.ts`, or the `CONVERSATION_CAP_PER_MONTH` env var.

## What CI proves, and what still needs a person

Every test named below was checked to exist, by name, before this table was written. **No**
means tests that run on every change prove the check. **Partly** means the logic underneath
is proven, but not the thing a person would actually see. **Yes** means only a real browser
can confirm it.

| # | Check | Proven by | Still needs a person |
|---|---|---|---|
| 1 | Put the page over the cap by hand | `chat.routes.test.ts` — 'degrades over real HTTP, counts a new conversation but not a continued one, and calls the model for neither', which seeds the counter itself | **No** — kept as the setup the browser checks need |
| 2 | The degraded reply is an ordinary answer bubble, not an error | `chat.service.test.ts` — 'spends nothing at all once over the cap'; 'answers in Malay first, then English, and persists that reply as an assistant message' | **Partly** — how `AskSheet` renders it |
| 3 | The page itself is unchanged | — | **Yes** |
| 4 | A pinned answer still answers properly over the cap | `chat.service.test.ts` — 'still serves a pinned answer over the cap, because it costs nothing' | **Partly** — in the sheet |
| 5 | The capture card still appears when the visitor qualifies | — | **Yes** — and the page needs `leadsCaptured` below 3 first |
| 6 | The counter kept climbing | `chat.routes.test.ts` — the test in row 1; `chat.service.test.ts` — 'keeps counting while refusing, because refused demand is the data' | **No** |
| 7 | No `ModelCall` row for the refused question | `chat.routes.test.ts` — the test in row 1 | **No** |

Three checks need no person, two are proven underneath but not on screen, and two have
nothing automated at all.

## What still needs a person, and why

Three different kinds of check live in this one document, and they call for different
amounts of trust in what follows.

Checks 2, 4 and 5 need an actual browser rendering `@curios/ui/sheet`'s `AskSheet` and
`CaptureCard`, and this repo has no Playwright, Puppeteer, or other browser driver to
open one with. `apps/api/src/modules/chat/chat.service.test.ts`'s `describe('the monthly
cap', ...)` block already proves, against a stubbed gateway, that the over-cap branch
yields the right *events* — a `text` and a `done`. It does not assert anything about
`intent` for that path — the file's `intent` assertions live entirely inside an unrelated
`describe('threading a conversation', ...)` block that never sets the page over cap. That
the same `intent` reaches the over-cap `done` event as any other branch is true from
reading `chat.service.ts`: `intent` is computed once, above every branch, and reused by
all of them — an argument from the code, not a check this test file performs.
`packages/core/src/qualify.test.ts` proves the capture-card rule itself in isolation.
What no test covers is what those events look like once
`AskSheet` actually renders them: whether the degraded reply lands as an ordinary answer
bubble or trips whatever branch the sheet uses for a transport error, and whether the
card the visitor actually sees still appears when chat has stopped answering.

Checks 1, 6 and 7 were here because nothing drove the cap through the real route and read
back what it wrote. `apps/api/src/modules/chat/chat.routes.test.ts` now does: it seeds a page
over the cap, posts to `/chat/:handle` through Fastify, and asserts the reply is
`CAP_REACHED_REPLY`, that a new conversation counts and a continued one does not, and that no
`ModelCall` row is written. The gateway there is a stub, deliberately — a refused
conversation must never reach the model, and a stub that records a row whenever it is
called is the right instrument for proving it was not. The three checks stay below as the
shortcut that makes the browser checks reachable without holding 200 real conversations
open, not as the proof of the money claims, which CI now holds.

Check 3 sits between the two: it is reachable over plain HTTP (a GET and a look at the
response), so a browser is not strictly required, but nothing today exercises it against
a real over-cap page. It is listed on its own because it is the check a reader is most
likely to assume rather than verify — see below.

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

You need one published `BUSINESS` page with at least one link, one verified fact, and one
`PinnedAnswer` already written for some question (for check 4) — a page with a couple of
FAQ entries already generated makes check 3 worth more, since it exercises
`/[handle]/faq` rather than an empty index. Use a page you do not mind leaving with an
inflated `UsageCounter` rather than a real demo account; check 1 sets it to a number no
real page should reach by hand.

**Check the page's plan columns before check 5.** Since slice 8 the capture card also
needs `leadsCaptured < 3` or a future `paidUntil`, and a page kept around for manual QA
has very likely spent its three. If it has, check 5 fails with the card simply absent --
which is exactly the symptom check 5 exists to catch, for a cause that has nothing to do
with the cap. Reset it first:

```bash
docker exec -i curios-postgres psql -U curios -d curios -c   "UPDATE \"Page\" SET \"leadsCaptured\" = 0 WHERE handle = 'HANDLE';"
```

---

## The seven checks

### 1. Put the page over the cap by hand

The whole point of this step is to walk the degrade path without driving 200 real
conversations. `count = 500` is comfortably clear of the default cap
(`FREE_CONVERSATIONS_PER_MONTH = 200`):

```bash
docker exec -i curios-postgres psql -U curios -d curios -c \
  "UPDATE \"UsageCounter\" SET count = 500 WHERE \"pageId\" = (SELECT id FROM \"Page\" WHERE handle = 'YOURHANDLE') AND period = to_char(now(), 'YYYY-MM');"
```

The `period` clause is not decoration — leave it in. Without it this `UPDATE` matches
every row for the page regardless of month, silently setting every past period's count to
500 as well as the current one, and those historical counts are the only volume data this
product has. `to_char(now(), 'YYYY-MM')` computes the same key `currentPeriod()` does
(`now.toISOString().slice(0, 7)`), so there is still nothing to work out or paste by hand.

If the page has never had a conversation, this updates zero rows — ask one question first
so the row exists, then run the update.

### 2. The degraded reply is an ordinary answer bubble, not an error

On the page's public chat, ask any question. Confirm the reply — the fixed sentence about
having reached this month's limit — renders in the sheet exactly like a normal answer:
same bubble style, same position, no error styling, no toast, nothing that reads as the
request having failed. `chat.service.ts` yields the same `{ type: 'text' }` /
`{ type: 'done' }` pair the pinned-answer branch does, precisely so the sheet renders it
through a path it already has — this is the check that the sheet actually takes that
path rather than one that only looks the same on paper.

### 3. The page itself is unchanged

**This is the check a reader is most likely to assume rather than verify.** "The page
never goes dark" is a claim about the page, not about chat, so confirm it directly rather
than inferring it from check 2:

- Reload `/[handle]` itself (not the sheet) and confirm every link and fact still
  renders, unchanged from before the page went over cap.
- Load `/[handle]/faq` and confirm the FAQ index still renders whatever entries existed
  before.
- If the page has a `faqSlug`'d question, load `/[handle]/faq/[slug]` directly and
  confirm the entry page still 200s.

Nothing in this slice touches any of these three routes — they are `apps/web`, and the
cap check lives entirely in `apps/api`'s chat service — so this check is really asking
whether that separation actually holds, not whether it was intended to.

### 4. A pinned answer still answers properly over the cap

Close the sheet and reopen it, then ask the exact question you have a `PinnedAnswer` for.
Reopening matters: `AskSheet` holds one `conversationId` per open sheet, and
`chat.service.ts` only increments `UsageCounter` for a *new* conversation. Continuing the
same sheet from check 2 would add turns to that conversation instead, and check 6 would
then show one increment where it says three.
Confirm the reply is the owner's pinned text, not the degraded sentence from check 2 —
this is the slice's central argument made visible: a pinned answer costs no tokens, so
the cap must never intercept it.

### 5. The capture card still appears when the visitor qualifies

Still over cap, and again in a freshly reopened sheet, hold a conversation of at least
three visitor turns on the `BUSINESS`
page, with at least one visitor message containing a standalone number (a quantity, a
count, a date — "2kg", "20 Mac"; see `packages/core/src/qualify.ts`). Confirm the capture
card still offers itself. `intent` is computed from the conversation history before the
cap branch runs and is untouched by it, so a capped page qualifying a visitor and then
failing to show the card would mean the two are wired together somewhere they should not
be.

### 6. The counter kept climbing

```bash
docker exec -i curios-postgres psql -U curios -d curios -c \
  'SELECT "pageId", period, count FROM "UsageCounter" ORDER BY count DESC;'
```

The row you set to 500 in check 1 should now read higher — one increment per new
conversation created in checks 2, 4 and 5. Refused demand is the only volume data this
product will ever have about pages that outgrew the free tier, which is why counting
never stops at the cap.

### 7. No `ModelCall` row for the refused question

The check nothing in the browser can show — a bubble rendering correctly proves nothing
about whether a model was actually called to produce it:

```bash
docker exec -i curios-postgres psql -U curios -d curios -c \
  'SELECT count(*) FROM "ModelCall" WHERE "createdAt" > now() - interval '"'"'5 minutes'"'"';'
```

Run this once right after check 2's question (before asking the pinned or
capture-card questions in checks 4 and 5, so the count is unambiguous), and confirm it is
zero. This is the proof that the money was actually saved, not merely that the refusal
was hidden from the visitor after the call had already been made.

---

**The number 200 is unproven.** It is a guess by construction — `packages/core/src/cap.ts`
says so — and nothing in this document or in the test suite can settle whether it is
right. Only a real page reaching it will. That is the entire reason check 6 matters and
the counter is never allowed to stop climbing past the cap: a page sitting at 340 against
a 200 cap is the only argument anyone will ever have for what the paid tier should cost.

## Recording the result

Note which checks you ran and what you saw, in this file, with the date. Report any not
run rather than leaving them ambiguous — that ambiguity is why this document exists.
