# Slice 5 — The dashboard an owner opens at 11pm

> Intended path: `devDocs/slice-5-build-spec.md`

Slice 4 closed README's definition of done: an owner receives a message carrying a phone
number and a transcript. What it did not do is give them anywhere to *look*.

Right now a Curios owner has two screens — review and settings — and everything the product
learns about their customers lives in an inbox and a database. Every question a visitor has
ever asked is sitting in `Message` rows that nothing reads. Every lead is a row nobody can
see.

This slice makes both visible, and adds the one write path that turns looking into acting.

---

## What is in, what is out

| In | Out (and where it goes) |
|---|---|
| `Question`: clustered text, ask count, answered flag | `/app/knowledge` — facts, pinned answers, never-say management |
| Logging every visitor question, clustered by `normalizeClaim` | `/app/links` — "the boring part that pays the rent" (its own slice) |
| `/app/questions`, ranked by ask count, with answer-writeback | `faqSlug` and static FAQ generation (roadmap 6) |
| `/app/leads`: table plus transcript drawer | Refusal detection (see below) |
| `DELETE /leads/:id` — the PDPA obligation slice 4 had nowhere to put | Web push, still deferred |
| A minimal dashboard nav | Lead status transitions beyond the default `NEW` |

---

## The Question model, and the sentence it does not implement

BACKEND.md's schema list has always included:

> `Question` — clustered text, ask count, answered flag, faqSlug

and its refusal rule says:

> Everything else gets the honest answer plus a handoff: *"Tak pasti, biar saya tanya
> Nadia."* Then notify the owner and log it as an unanswered Question.

**The model has never existed.** This slice creates it, and implements the first half of
that sentence rather than the second.

### Why no refusal detection

The system prompt tells the model to *"say honestly that you are not sure and will check
with the owner."* It does not mandate a phrase, and it cannot easily: the same prompt
instructs the model to answer in the language it was asked in, *"including Malay, Manglish,
or a mix."* There is nothing machine-readable to look for.

Three ways to get one, and why each was refused:

**A marker in the answer.** The prompt could require every refusal to end in a fixed token,
stripped server-side before the visitor sees it. This is the sentinel approach slice 4
rejected for the intent block, and the reason has not changed: the failure mode is a
visitor watching a marker appear mid-sentence. It would also change the cached prefix every
page in the product shares.

**Phrase-matching the answer.** Cheap and invisible, and wrong across three languages. It
would miss real refusals and flag confident answers that happen to contain *"tak pasti"*.
A gap list that lies is worse than one that only counts.

**A second model call.** Rejected on the same ground as slice 4's: it taxes every
conversation to serve the rare one, on an architecture whose margin is Haiku-for-chat.

### So `answered` means the owner answered

Every visitor question is logged and clustered. The tab ranks by **ask count**, which is
the signal that actually tells an owner where their page is thin — a question asked nine
times is a gap whether the model refused it or answered it badly. `answered` becomes true
when the owner writes an answer, which is the writeback below.

**What this gives up, stated rather than buried:** the list mixes questions the AI handled
well with ones it fluffed, so the owner scans instead of being handed a gap list. Refusal
detection would sharpen the ranking, and it can be added later without changing the model —
it would set `answered` at write time instead of leaving it false. BACKEND.md's line is
amended to say so.

### The cluster key

`normalizeClaim` from `packages/core`, which already keys the fact dedupe
(`@@unique([pageId, normalizedClaim])`) and the pinned-answer lookup
(`@@unique([pageId, normalizedQuestion])`).

Using the same function for a third time is the point: a question, its pinned answer, and
the fact that might cover it agree on what "the same question" means **by construction**
rather than by three implementations happening to match. When someone improves
`normalizeClaim`, all three improve together.

---

## The writeback

The questions screen's one primary action is "Answer this". It writes a `PinnedAnswer` on
the same normalized key and marks the `Question` answered.

`chat.service.ts` already checks `PinnedAnswer` before calling the model — *"A pinned
answer wins over model output. Zero tokens, zero risk."* So the next person to ask gets the
owner's exact words, immediately and free.

**The limitation, written down rather than discovered.** Matching is exact on the
normalized form. Answering *"berapa harga kek 1kg"* does not cover *"harga kek 1kg
berapa"*; that variant falls through to the model, which still has the facts. This is
acceptable because the owner is answering a question a real customer really typed, and that
exact phrasing is the one most likely to recur — but it means the questions list will
sometimes show two rows an owner considers the same question, and nothing here merges them.

**Rejected: writing a verified fact instead.** A fact covers every phrasing, which is
better, and it routes the owner's careful sentence through a model that paraphrases it,
costs tokens on every ask, and can still refuse — a strange outcome for a question the
owner just answered by hand. Adding a fact belongs to the knowledge screen, where an owner
is thinking about their knowledge base rather than about one customer's question.

---

## Leads

A table through `packages/db-read`, newest first: phone, score, slots, status, and when.
The transcript opens in a drawer rather than a page, because the point is to read it
against the number rather than navigate away from it.

`DELETE /leads/:id` ships here. BACKEND.md requires an owner-facing delete per lead, slice 4
deferred it for want of a screen to host it, and deferring twice would start to look like
avoidance rather than sequencing.

**Not in scope:** status transitions. `Lead.status` exists with `NEW | CONTACTED | CLOSED`
and this slice only ever shows `NEW`. Marking a lead contacted is a workflow, and a workflow
nobody has used yet is a guess.

---

## The dashboard has no nav

Slice 3 styled eight screens and left `/app` a bare router. With review, questions, leads
and settings, four routes are reachable only by typing a URL.

A minimal nav lands here: a row of links in the `/app` layout, using the `Shell` that
already exists. Not a shell redesign — enough that an owner can move between the screens
they now have. This is scope the roadmap does not name, and it is recorded here so that is
a decision rather than a drift.

---

## Testing, and its limits

- The cluster key: two phrasings that normalize the same increment one row; two that do not
  make two rows. Asserted against the database, because the unique constraint is the thing
  doing the work.
- The ask count survives a second conversation, which is the whole point of clustering.
- The writeback creates a `PinnedAnswer` the chat path then actually hits — asserted through
  `answer()` rather than by reading the row, because a pinned answer that does not win is
  worth nothing.
- A lead delete removes the row and is scoped to the owner, tested the way every other
  ownership check in this codebase is: by having a stranger try it.
- Ranking is by ask count, descending, and a tie does not vary between requests.

**Not covered:** whether a real owner looks at this list and knows what to do. That is the
question the whole slice exists to answer and no test can reach it. It needs someone with a
page and real visitors, which is also the only thing that will show whether ask-count
ranking is the right ranking.

---

## Two plans

1. **Questions.** The `Question` model, logging in the chat path, `/app/questions`, and the
   writeback into `PinnedAnswer`.
2. **Leads and the nav.** `/app/leads` with its transcript drawer, `DELETE /leads/:id`, and
   the dashboard nav.

---

## Documents corrected by this slice

| Document | Correction |
|---|---|
| `BACKEND.md` | The refusal rule: amended to say questions are logged and clustered regardless, that `answered` means the owner answered, and that refusal detection is deliberately absent with the reasons |
| `BACKEND.md` | The schema list: `Question` exists now, without `faqSlug`, which waits for the FAQ slice |
