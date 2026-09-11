# Manual verification — the conversation cap

**Status: NOT RUN.** Written down at the end of slice 7 rather than run, for the same
reason the three documents before it were: the four gates are green and the plan is
about to merge, and the checks that need a browser rendering the actual ask sheet, or a
question asked from a real dev server rather than a fixture, are not things any gate can
run. It is the fourth document of its kind, after `manual-verification-google-link.md`,
`manual-verification-leads.md`, and `manual-verification-faq.md`.

Re-run it after any change to `packages/core/src/cap.ts`, the cap branch in
`apps/api/src/modules/chat/chat.service.ts`, or the `CONVERSATION_CAP_PER_MONTH` env var.

## Why it can't be automated here

Three different kinds of check live in this one document, and they call for different
amounts of trust in what follows.

Checks 2, 4 and 5 need an actual browser rendering `@curios/ui/sheet`'s `AskSheet` and
`CaptureCard`, and this repo has no Playwright, Puppeteer, or other browser driver to
open one with. `apps/api/src/modules/chat/chat.service.test.ts` already proves, against
a stubbed gateway, that the over-cap branch yields the right *events* — a `text` and a
`done`, with `intent` untouched — and `packages/core/src/qualify.test.ts` proves the
capture-card rule in isolation. What no test covers is what those events look like once
`AskSheet` actually renders them: whether the degraded reply lands as an ordinary answer
bubble or trips whatever branch the sheet uses for a transport error, and whether the
card the visitor actually sees still appears when chat has stopped answering.

Checks 1, 6 and 7 are plain SQL against the dev database and need no browser at all —
they exist here rather than in the test suite because the point is to drive the real
`answer()` generator end to end against a real running API, not a mocked gateway, and to
read back what it actually wrote. Check 1 is the shortcut that makes the rest of this
document possible without holding 200 real conversations open; checks 6 and 7 are the
proof, at the end, of the two claims the slice makes about money — that the counter kept
counting, and that nothing was spent doing it.

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

---

## The seven checks

### 1. Put the page over the cap by hand

The whole point of this step is to walk the degrade path without driving 200 real
conversations. `count = 500` is comfortably clear of the default cap
(`FREE_CONVERSATIONS_PER_MONTH = 200`) whichever period key `currentPeriod()` computes,
so there is no need to compute the period yourself:

```bash
docker exec -i curios-postgres psql -U curios -d curios -c \
  "UPDATE \"UsageCounter\" SET count = 500 WHERE \"pageId\" = (SELECT id FROM \"Page\" WHERE handle = 'YOURHANDLE');"
```

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

Ask, in the same over-cap sheet, the exact question you have a `PinnedAnswer` for.
Confirm the reply is the owner's pinned text, not the degraded sentence from check 2 —
this is the slice's central argument made visible: a pinned answer costs no tokens, so
the cap must never intercept it.

### 5. The capture card still appears when the visitor qualifies

Still over cap, hold a conversation of at least three visitor turns on the `BUSINESS`
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
