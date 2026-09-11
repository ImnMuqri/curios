# Slice 7 — The cap that was counted but never checked

> Intended path: `devDocs/slice-7-build-spec.md`

`UsageCounter` has incremented on every conversation since slice 1. Nothing has ever read
it.

Slice 1 stubbed the over-cap branch and said why: "devDocs names no cap number and there
is no FAQ page to degrade to yet." Slice 6 built the FAQ pages. This slice supplies the
number and closes the branch.

---

## What is in, what is out

| In | Out (and where it goes) |
|---|---|
| A monthly conversation cap, read where the counter is already written | Billplz, subscriptions, webhooks — their own slice, and see below |
| Degrading chat over cap, without the page going dark | A `Plan` model or paid tiers — invented once, with billing, not twice |
| Pinned answers continuing to work over cap | `/app/billing` — an owner-facing usage screen |
| The pipeline order BACKEND.md gets wrong | Per-account caps, since an account has exactly one page today |

**Billing is not deferred out of laziness.** README's Pay row reads "Billplz — verify
recurring support before building monthly," and nobody has verified it. Designing
subscriptions on an unchecked assumption about what the processor can do is how you
build the wrong thing twice. That verification is an hour of reading and belongs before
any billing spec, not inside this one.

The cap is worth having on its own regardless: it bounds what a single page can cost,
which is true whether or not anyone is paying yet.

---

## The number, and why it is a constant with an env override

```ts
export const FREE_CONVERSATIONS_PER_MONTH = 200;
```

`packages/core/src/cap.ts`, beside `qualify.ts` and `faq.ts`, with an env override that
mirrors `limit()` in `apps/api/src/plugins/rate-limit.ts` — same validation, same
rejection of a non-integer or a value below 1, same reasoning: this is a product default
that operations must be able to tune without a deploy.

**200, and it is a guess.** Roughly seven conversations a day. High enough that an
ordinary bakery never notices; low enough that a popular page will actually reach it,
which is the only way anybody learns whether the degrade path works before it matters.
Slice 1 was right that a cap cannot be *chosen* without volume data. It was wrong to
conclude that nothing could be built: the mechanism does not need the data, only the
number does, and the env override is what makes the number cheap to be wrong about.

**No `Plan` model.** Every page gets the same cap until billing exists to differentiate
them. A tier table written now would be written again when the processor's capabilities
are known.

---

## Where the check goes, and why not where BACKEND.md says

BACKEND.md's pipeline puts the cap at step 1:

```
1  check UsageCounter. over cap → return the static FAQ payload, HTTP 200, no model call.
...
3  exact match against PinnedAnswer. hit → return it. zero tokens, zero risk.
```

That order is wrong, and it was written before pinned answers and FAQ pages existed in
their present form. A pinned answer makes **no model call and costs nothing**. The cap
exists to bound model spend. Refusing a free answer because a page has spent too much is
punishing an owner for having answered the question well — on the question they answered
best, since a pinned answer is by definition one somebody asked before.

So the check moves to sit **immediately after the pinned-answer branch, before the
system prompt is built and the gateway is called**.

Worth being exact, because the obvious phrasing is wrong: there is no separate fact load
to sit above. `chat.service.ts` selects the page's verified facts inside the same
`findUnique` that resolves the page, and the later `const facts = page.facts` is a local
alias, not a query. So the only thing below the boundary is `buildSystemPrompt` and
`gateway.chat`.

That line is not arbitrary. Everything above it is database work that has already
happened — the conversation row, the message, the question upsert, the slug assignment,
the pinned lookup — and the gateway call below it is the only thing that costs money.
The boundary belongs exactly where the spend starts, and here that is one call.

The corrected order:

```
1  resolve the page -- verified facts come back with it, in the same query
2  conversation: create or continue; increment UsageCounter on create
3  log the question, assign a faq slug if it now qualifies
4  exact match against PinnedAnswer. hit → return it, capped or not
5  CHECK THE CAP. over → the degraded reply, and no gateway call
6  build the system prompt, one Haiku call, then stream
```

BACKEND.md's list has the fact load as its own numbered step. That describes intent
rather than the code, which folds it into step 1 — noted here so the corrected list and
the source agree.

---

## The off-by-one, stated because it is easy to get backwards

The counter increments at conversation creation, which is **above** the check. So on the
Nth conversation of a month, `used` is already N when the check reads it.

Testing `used >= cap` would refuse the 200th conversation and deliver 199. The condition
is `used > cap`, and the boundary belongs in a test at exactly 200 and 201 — not at a
comfortable 500 that would pass under either comparison.

```ts
export function isOverCap(input: { used: number; cap: number }): boolean {
  return input.used > input.cap;
}
```

---

## What the visitor sees

A normal answer event in the transcript. **No new client state**, no new panel in the ask
sheet, and therefore no new client JavaScript on the page whose bundle is under test.

Concretely, the branch mirrors the pinned-answer branch exactly — the same two events, in
the same order:

```ts
yield { type: 'text', text: /* the degraded reply */ };
yield { type: 'done', conversationId, intent };
```

That shape is what makes the no-new-client-state claim checkable rather than hopeful: the
stream parser lives in `@curios/ui/sheet` and already renders precisely this pair for a
pinned answer, so an over-cap reply reaches the visitor through a path that is already
tested.

The text says the page has reached this month's question limit and that answers to the
most-asked questions are linked on this page. **It does not build a URL.** The public
page already links to `/[handle]/faq`, gated on entries actually existing — slice 6 added
that gate — so constructing a link here would duplicate a conditional that is already
correct elsewhere, and would point at a 404 in the case where every answer has since been
withdrawn.

**"The page never goes dark" is about the page, not the chat.** BACKEND.md's sentence is
ambiguous and has been read both ways. The links, the facts, and the FAQ pages all render
exactly as before when a page is over cap. What degrades is one answer in one sheet. No
part of this slice changes what an unaided visitor sees on `/[handle]`.

---

## Every turn, not every conversation

The counter increments only when a conversation is created. The **check runs on every
turn**, and the difference is not an oversight.

Checking only on new conversations leaves a hole. A conversation created while the page
is over cap would get the degraded reply on its first turn, then reach the model on its
second — the counter does not increment for a continuing turn, so nothing would stop it.
One refusal followed by unlimited free answers is not a cap.

The cost is that a conversation can be cut off at the boundary: it begins under the cap,
somebody else's new conversation crosses it, and the next turn degrades mid-thread. That
is rare, it is honest, and it is better than the hole.

This does not contradict "the meter counts conversations, not messages." That sentence is
about the **unit of metering** — what an owner is charged for. The check is about the
**moment of spending**, and every turn is one of those. A chatty visitor still costs one
unit; they simply cannot keep spending after the page has run out.

**The intent block is unchanged.** A capped page still offers the capture card when the
visitor qualifies. Cutting off lead capture at the cap would be exactly backwards: the
lead is the thing the owner is here for, and it is worth more when chat has stopped
answering. Lead extraction has its own queue and its own budget; it is not this cap's
business.

---

## What still counts

The counter keeps incrementing over cap, at the point it already does.

This is deliberate and worth stating, because the opposite is the obvious implementation:
stop counting once you stop serving. But refused demand is the only volume data this
product will ever have about pages that outgrew the free tier, and it is precisely the
data slice 1 said the cap number needs. A page sitting at 340 in a 200 cap is the
argument for what the paid tier should cost. A page recorded as 200 forever tells you
nothing.

---

## Testing, and its limits

| Layer | What is proven |
|---|---|
| `packages/core` | `isOverCap` at exactly the cap and one past it. The env override accepting a valid integer, and rejecting zero, a negative, and a non-numeric string — the same three the rate-limit override rejects. |
| `apps/api` | Under cap, a normal answer. Over cap, **no gateway call at all** — asserted against the stub, not inferred from the reply text. Over cap with a pinned answer, the pinned answer, unchanged and still free. The counter still incrementing while over. |
| Load-bearing | Two, because this slice makes two claims. Moving the check above the pinned branch must fail a test — that is the slice's whole argument, and a suite that passes under both orders has not encoded it. And gating the check on `isNew` must fail a test: a second turn in a conversation created over cap must not reach the gateway, which is the hole that ordering would open. |
| `apps/web` | Nothing. No component changes, and the over-cap reply renders through the existing transcript path. |

**What no test covers.** Whether 200 is the right number. It is a guess by construction,
and the env override exists because it is. The first real answer comes from a deployed
page reaching it, which is why the counter keeps climbing past the cap rather than
stopping.

Nor does anything here prove the degraded reply reads well to a stranger who has just
been refused. That is a copy judgement on the one surface where the product is saying no
to a customer, and it belongs in the manual walkthrough.

---

## One plan

1. **The rule** — `packages/core/src/cap.ts`: the constant, the env override, `isOverCap`,
   with tests. No consumers yet.
2. **The check** — the cap read in `chat.service.ts`, placed below the pinned branch, and
   the degraded reply. Two load-bearing tests: one that fails if the check moves above the
   pinned branch, and one that fails if it runs only on new conversations — a second turn
   in a conversation created over cap must not reach the gateway.
3. **Documents and a walkthrough** — BACKEND.md's pipeline order and its "never goes
   dark" sentence, and the manual checks that need a real page at 200 conversations.

---

## Documents corrected by this slice

| Document | Correction |
|---|---|
| `BACKEND.md` | The pipeline's step order: the cap check moves below the `PinnedAnswer` match, because a pinned answer makes no model call and the cap bounds model spend. |
| `BACKEND.md` | "Over cap degrades to the FAQ view. The page never goes dark." Clarified: the page is unchanged, chat is what degrades, and a pinned answer is still served. |
| `slice-1-build-spec.md` | Its stub table says the over-cap branch is stubbed because there is no cap number and no FAQ page. Both are now false; the row is closed with a pointer here. |
