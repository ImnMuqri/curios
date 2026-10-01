# Slice 15 — Question topics: one row and one answer per thing visitors ask

**Goal:** stop the owner answering the same question once per wording. Today a question is clustered
only by its normalised text, so "What is his full name" and "What is Iman's full name" are two rows
on Questions, need two answers, and a pinned answer fires only for its exact wording — which is
why, on 2026-10-01, the owner saw the chat answer one wording with their pinned "Iman Muqri" and
hedge on the other. This slice groups wordings into **topics** by meaning, gives each topic one
answer that covers every wording, one FAQ page, and a Questions screen laid out for working
through them.

Designed with the owner on 2026-10-01, with a layout mockup; the choices below are theirs.

---

## What is in, what is out

**In:**

1. **Topics.** Every visitor question (a *wording*) belongs to exactly one topic.
2. **AI grouping**, in the background, after the visitor's reply: embeddings shortlist candidate
   topics, Haiku confirms or rejects the match.
3. **One answer per topic**, used word for word by the chat for every grouped wording.
4. **One FAQ page per topic**; old wording addresses redirect.
5. **Owner corrections:** *Not the same question* (split) and *Same as…* (merge).
6. **A one-off grouping** of every existing question.
7. **The Questions screen in layout A:** compact rows, count and action on the right, wordings folded
   underneath.

**Out, and why:**

- **Instant matching in the chat.** A new wording's first ask goes to the model; it is covered from
  its next ask, once grouped. Matching in the request path on embeddings alone could send a pinned
  price to the wrong question before anything checks it (owner decision 5).
- **Suggested answers drafted by AI.** A separate idea; not needed to remove the duplicate work.
- **"Answer as a fact" from Questions.** Worth doing; its own small change after this.
- **Ignoring noise questions.** Same.

---

## Decisions the owner made

1. **One answer covers every wording in a topic.** Answering a topic answers all its wordings in
   the chat, including wordings grouped into it later.
2. **AI does the grouping:** embeddings to shortlist, a language model to judge, in the background.
3. **Existing questions are grouped once when this ships.** If two answered questions merge, the
   most-asked one's answer is kept and the other is kept beside it, flagged "Two answers — pick one".
4. **One FAQ page per topic.** Other wordings' existing pages 301 to it.
5. **A new wording's first ask goes to the AI**; later asks get the owner's answer.
6. **Split and merge.** A split-out wording is never auto-grouped again; merging two answered
   topics asks which answer to keep.
7. **Layout A** on Questions.
8. **A `Topic` table**, rather than a lead-question pointer or display-only grouping.

---

## The data

One migration.

**`Topic`** (new):

| column | meaning |
| --- | --- |
| `id`, `pageId` (cascade) | |
| `title` | the wording shown on Questions and the FAQ page. Starts as the first wording; follows the most-asked wording unless `titleSetByOwner`. |
| `titleSetByOwner` | true once the owner renames it. |
| `answer`, `answeredAt` | the one pinned answer. Null when unanswered. |
| `conflictAnswer` | set only by the one-off grouping when two answered topics merge; drives the "pick one" flag. |
| `askCount` | the sum of its wordings' `askCount`. Ranking and the FAQ threshold read it. |
| `faqSlug` | unique per page; never changed or cleared once set. |
| `faqSuppressed` | the owner took the FAQ page down. |
| `createdAt`, `lastAskedAt` | |

Indexes: `@@unique([pageId, faqSlug])`, `@@index([pageId, askCount])`.

**`Question`** gains `topicId` (required, relation, cascade from Topic), `groupedAt DateTime?` (null
until the grouping job has decided), and `pinnedByOwner Boolean @default(false)` (set by a split;
the job never moves it). `answered`, `faqSlug` and `faqSuppressed` move to `Topic` and are dropped
from `Question` after the backfill.

**`PinnedAnswer`** is dropped after its rows are copied onto their topics.

**`FaqRedirect`** (new): `pageId`, `slug` (unique per page), `topicId` (nullable, `onDelete:
SetNull`). A merge writes the losing topic's slug here and the FAQ route 301s from it; a deleted
topic leaves its slug here with no target, so the address 404s and is never handed to another
topic — the same "a URL that has begun to rank must not move" rule `faqSlug` already follows.

**The migration** creates one topic per existing question, copying `text` → `title`, the pinned
answer for its `(pageId, normalizedQuestion)`, `faqSlug`, `faqSuppressed`, `askCount`, and
`lastAskedAt`; sets `topicId`; then drops the moved columns and `PinnedAnswer`. `groupedAt` stays
null for every existing question, which is what makes the one-off grouping pick them all up.
Nothing visible changes until that runs.

**Fingerprints** reuse `QuestionEmbedding` (keyed by a SHA-256 of the normalised wording), so a
wording the chat already embedded costs nothing to group.

---

## The grouping job

**Trigger.** When the chat creates a `Question` it has never seen on the page, it creates its
one-wording topic in the same transaction, sends the reply, and enqueues a `group-question` job
with the question id. A repeat wording enqueues nothing.

**The job** (apps/workers, its own queue, `attempts: 3` with exponential backoff):

1. Load the question. Stop if `groupedAt` is set, `pinnedByOwner` is true, or it is gone.
2. Get its embedding: the `QuestionEmbedding` cache, else embed and store.
3. Shortlist: every other topic on the same page that has at least one grouped wording; score each
   by the best cosine similarity between this wording and that topic's wordings; keep at most
   `GROUP_CANDIDATES` (3) at or above `GROUP_SHORTLIST_MIN`.
4. No candidates → set `groupedAt`; the wording stays its own topic. No model call.
5. Otherwise ask Haiku (through the gateway, recorded in `ModelCall`). The prompt carries the
   page's display name and mode, the new wording, and for each candidate its id, title and up to
   three wordings. (`GROUP_SHORTLIST_MIN` starts at **0.70** cosine — deliberately loose, because
   Haiku is the real judge; the goldens are the place to tune it.) "The same question" means **one answer would be correct for both** — "Kek 1kg
   berapa?" and "Kek 2kg berapa?" are not the same. Visitor text is escaped and declared data, never
   instructions. The model returns one candidate id or `none`; anything else is treated as `none`.
6. A match moves the wording in one transaction: `topicId` to the match, the wording's `askCount`
   added to the topic's, `lastAskedAt` maxed, the title recomputed unless `titleSetByOwner`, the
   now-empty source topic deleted, `groupedAt` set. If the source topic had an answer (only possible
   in the one-off grouping), the conflict rule below applies.
7. `none` → set `groupedAt`.

**Failures.** After the last retry the wording stays its own topic with `groupedAt` null; re-running
the grouping script picks it up. Nothing is ever half-moved: step 6 is one transaction.

**Cost.** At most one Haiku call per *new* wording, and new wordings only come from chats, which are
already capped per page.

**The one-off grouping** is a script (`scripts/group-questions.ts`) that runs the same job function
over every `groupedAt IS NULL` question, per page, oldest first, one at a time. When it merges two
answered topics, the topic with the higher `askCount` keeps its `answer`; the other answer goes to
`conflictAnswer`. The merge's slug rule (below) applies.

---

## The chat

`chat.service.ts` upserts the wording as today; a new wording also creates its topic in the same
transaction and the job is enqueued after the reply. The pinned lookup becomes: the wording's topic
has an `answer` → stream it, word for word, at zero tokens. Otherwise the model answers. Both the
wording's and the topic's `askCount` increment.

---

## The API

All routes in the session-required owner scope, scoped by `page: { accountId }` in the statement;
another owner's id is `404 NOT_FOUND`.

| route | does |
| --- | --- |
| `POST /topics/:id/answer` `{ answer }` | set or edit the answer; clears `conflictAnswer` |
| `DELETE /topics/:id/answer` | withdraw; the FAQ page 404s, the slug is kept |
| `POST /topics/:id/suppress` `{ suppressed }` | hide or show the FAQ page |
| `PATCH /topics/:id` `{ title }` | rename; sets `titleSetByOwner` |
| `POST /topics/:id/merge` `{ intoTopicId, keepAnswer: 'this' \| 'into' }` | move every wording into the other topic |
| `POST /topics/:id/resolve` `{ keep: 'answer' \| 'conflict' }` | settle "two answers" |
| `DELETE /topics/:id` | erase the topic, all its wordings and its answer; its slug is kept in `FaqRedirect` pointing nowhere, so the page 404s rather than being reissued |
| `POST /questions/:id/split` | wording → its own new topic, `pinnedByOwner = true` |
| `DELETE /questions/:id` | erase a wording (right to erasure, as today) |

**Merge.** Counts add; the surviving topic keeps its `faqSlug` (or takes the other's if it had none);
a losing slug goes to `FaqRedirect`; the kept answer is the one named; the losing topic is deleted.
Merging a topic into itself or into another page's topic is a 404.

**Split.** The wording leaves with no answer and no slug — any page belonged to the topic. A topic
left with no wordings is deleted. Splitting a topic's only wording is refused (`400`, it is already
alone).

**Delete a wording.** Removes the row. A topic left empty is deleted with its answer; deleting the
title wording moves the title to the most-asked remaining one (unless `titleSetByOwner`).

`POST /questions/:id/answer`, `/suppress` and `DELETE /questions/:id/answer` are removed; their web
callers move to the topic routes.

---

## The FAQ

`getFaqIndex` and `getFaqEntry` read `Topic`: published business page, `faqSlug` set, `answer` set,
not suppressed. A topic earns its slug when its total `askCount` reaches `FAQ_MIN_ASKS` (3) and it
is answered — the slug is assigned on the topic, with the same collision handling as today. An
unknown slug that is in `FaqRedirect` returns a `301` to its topic's slug; otherwise `404`.

---

## The Questions screen (layout A)

- One row per topic, ranked by `askCount` then `lastAskedAt`. Left: the title, and a subline —
  "+N other wordings · Answered: "…"" or "Not answered yet". Right: the count pill and one action —
  **Answer** (unanswered) or **Edit** (answered).
- "+N other wordings" folds out the wordings, each with its own count, **Not the same question**,
  and **Delete**.
- A row's **⋯** menu: **Same as…** (a picker of the page's other topics), **Rename**, **Hide from
  FAQ** / **Show on FAQ** (business pages with a slug), **Delete topic**.
- A topic with `conflictAnswer` shows "Two answers — pick one" with both answers and a **Keep this**
  on each.
- Answering opens an inline editor under the row. Every action's error shows in place, keeping the
  owner's input and focus — the slice 13/14 pattern.

**Knowledge → Pinned answers** lists answered topics (title, answer) with edit and withdraw.

---

## Failure modes, in one place

- **Grouping job fails:** the wording stays its own topic, undecided; the script re-runs it.
- **Haiku returns something unexpected:** treated as `none`.
- **A wrong grouping:** the owner splits it; it never regroups.
- **A missed grouping:** the owner merges.
- **Merge of two answered topics:** the owner chose which answer survives in the request.
- **A published wording address after a merge:** 301 to the surviving page.
- **Embedding provider down:** the job retries; the chat is unaffected.

---

## Testing

Against the real test database, with a fake embedder and a fake Haiku whose verdict each test sets.

- **Migration:** on a database with questions, pinned answers, slugs and suppressed pages, every
  question gets its own topic; every answer, slug and suppressed flag lands on the right topic; no
  answer or slug is lost; no topic is empty.
- **Job:** nothing close → no model call, stays alone; match → moves, counts add, empty topic
  deleted; `none` → nothing moves; a reply that is not an offered id → `none`; a `pinnedByOwner`
  wording is never touched; another page's topic is never a candidate; a failure leaves it
  undecided and a re-run does not double-count.
- **One-off grouping:** two answered topics merge with the most-asked answer kept and the other in
  `conflictAnswer`.
- **API:** every new route 404s for another owner; merge keeps the slug and redirects the other;
  split marks `pinnedByOwner` and takes no slug; deleting the last wording deletes the topic;
  deleting the title wording moves the title.
- **Chat:** a grouped wording streams the topic's answer verbatim; an ungrouped new wording goes to
  the model and enqueues one job; a repeat enqueues none.
- **FAQ:** one page per topic; a redirect slug 301s; a suppressed topic 404s.
- **Screen:** layout A rows, fold-out wordings, the ⋯ menu, the pick-one flag, error-in-place with
  focus kept.
- **Goldens** (real model, on demand): must group "What is his full name" with "What is Iman's full
  name", and "FPX boleh?" with "Do you take FPX?"; must not group "Kek 1kg berapa?" with "Kek 2kg
  berapa?", nor a delivery question with a pickup one.

**Mutation checks** — each must turn a test red: drop the offered-ids-only check; drop the
`pinnedByOwner` guard; drop the redirect write on merge; drop the topic-answer lookup in the chat;
drop the empty-topic delete.

---

## Rollout

1. Drain the ingest and new grouping queues; deploy the migration together with the API and workers.
2. Run `scripts/group-questions.ts` for each page.
3. Gates uncached and one at a time; a real-browser pass on Questions and on a redirected FAQ address.

---

## Done means

On a phone and a laptop the owner sees one row per topic with its total asks; answers a topic once
and finds every wording answered word for word in the chat; splits and merges; picks between two
answers after the one-off grouping; and an old FAQ wording address 301s to its topic's page. The
mutation checks each turn a test red, the goldens pass, the workspace gates pass uncached and one at
a time with exit codes checked, and a real-browser pass has been done.

---

## Documents corrected by this slice

- **BACKEND.md** — Topic, the grouping job and queue, the pinned lookup by topic, the new routes,
  FaqRedirect; PinnedAnswer removed.
- **FRONTEND.md** — the Questions screen's layout and actions; Knowledge's Pinned tab lists topics.
- **slice-5-build-spec.md** — the "matching is exact" limit points here.
- **A manual-verification checklist** for topics.

---

## Revisions during planning (2026-10-01)

Where the plan refined this spec, and where building it changed what the spec said. The code is the
authority; this section says why it differs.

**From planning**

1. **A job moves only its own wording.** If the wording is alone in its topic, the whole topic merges
   into the match; if its topic has other wordings (possible during the one-off grouping), only this
   wording moves. A wording the owner split out (`pinnedByOwner`) never moves, because only its own
   job could move it and that job skips it.
2. **Topic aggregates are recomputed from members, never incremented**, inside every mutation
   (`refreshTopic`). A chat ask racing a merge cannot lose or double a count.
3. **Haiku sees candidates as letters (A, B, C), not ids**, and the parser maps the letter back. A
   model echoes a letter far more reliably than a cuid.
4. **Retired slugs are never reissued**: slug assignment treats `FaqRedirect` slugs as taken.
5. **New domain codes**: `INVALID_ANSWER`, `INVALID_TITLE`, `ALREADY_ALONE`, `NO_CONFLICT`.

**From execution**

6. **`refreshTopic` and `mergeTopics` take row locks** (`SELECT ... FOR UPDATE`, topic ids in sorted
   order), so a chat ask racing a merge cannot leave a short count. Both must run inside a
   transaction.
7. **The grouping verdict parser accepts only a clean letter**: bare, with a full stop, bracket or
   dash tail, or "Option X". Anything else is `none`. Text reaching the grouping prompt is
   whitespace-flattened and escaped, and the page name is tagged as data.
8. **The grouping job re-reads and locks the wording inside its final transaction** and skips cleanly
   if the owner split, moved or deleted it meanwhile. A target that vanished marks the wording
   decided without moving it.
9. **The chat uses the wording's topic as it stands after locking**, and queues a new wording's
   grouping in a `finally`, so a failed reply still groups it.
10. **Retired FAQ addresses use Next's `permanentRedirect` (HTTP 308)** where this spec said 301:
    permanent, cacheable and ranking-transferring, with the method preserved, which is irrelevant
    for a GET.
11. **The Questions screen's ⋯ control is a disclosure list, not an ARIA menu** (no arrow-key
    navigation; Tab works). Opening a panel focuses its field, and double taps are guarded.
