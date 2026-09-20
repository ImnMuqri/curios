# Slice 12 — Only the facts the question needs

**Goal:** stop sending a page's entire fact list on every question. Match the visitor's question
against the question each fact already carries, send the best few, and fall back to sending
everything whenever the match is weak or anything is missing.

Measured on the 114-fact development page: the prompt is 5,994 tokens, of which about 96% of an
answer's cost is re-reading facts the model has read hundreds of times before. Retrieval takes that
to roughly 900 tokens — **about 85% off every answer** — without changing the model, the wording of
the prompt's instructions, or what an answer is allowed to say.

This is the third attempt at the idea and the first with evidence behind it. `prompt.ts` records why
the first one was removed: bag-of-words matching shares no token between "berapa harga" and "Kek 1kg
butter starts at RM95", so the product's flagship question came back with no price. Two things have
changed since. Every fact now stores the question it answers, so the match is question-to-question
rather than question-to-claim. And slice 11's golden set can prove, for five cents a run, that no
price went missing.

---

## What is in, what is out

| In | Out |
|---|---|
| A hosted embeddings API, behind one package | Anything self-hosted, and any model running in the API process |
| Matching on `Fact.question`, falling back to `Fact.claim` when it is null | Changing how extraction writes facts |
| One vector per fact, stored in Postgres and read per question | pgvector, a vector database, or an index of any kind |
| A character budget of facts per question | Reranking, chunking, or a second retrieval pass |
| Falling back to every fact whenever the match is weak or anything is missing | Letting a visitor's question go unanswered because retrieval failed |
| A fourth golden fixture page, big enough to cross the retrieval floor | Growing the three existing fixture pages, whose baselines would move |
| Dropping the `id` attribute from each fact in the prompt | Changing the prompt's instructions, refusal rules or NeverSay handling |
| Prompt caching switched off in retrieval mode | Removing caching from the fallback path, where the prompt is stable |
| Reusing a stored embedding for a repeated question | Reusing a stored **answer** — that is its own slice |
| The golden set as the gate, plus two new cross-language questions | Model-graded scoring of any kind |

**The model does not change.** Chat stays on `CHAT_MODEL` (Haiku 4.5) with the same instructions,
the same refusal rules and the same answer shape. This slice changes only which facts reach it.

---

## Settled before this slice, and not reopened

- **Facts are data, never instructions.** Each fact still goes into the prompt inside its own
  escaped tag. Retrieval changes how many tags there are, not what they are.
- **Never invent a price.** The prompt's rule stands: a price, date, address or policy may only be
  stated if it appears in a fact. Retrieval must never be the reason a fact is absent when the page
  holds it — hence the fallbacks below.
- **The cached prefix is no longer sacred.** `prompt.ts` sends every fact partly to keep the prefix
  byte-stable for caching. Measurement retired that argument: Haiku 4.5 will not cache a prefix under
  4,096 tokens at all, the cache expires after five minutes, and a small shop's visitors arrive hours
  apart — so the cache is written at a 25% premium and almost never read.

---

## The data

**One new table, `FactEmbedding`**, one row per fact:

| Column | Why |
|---|---|
| `factId` | Unique, cascading with the fact |
| `vector` | `Bytes` — the embedding, little-endian `Float32` |
| `model` | The embedding model that produced it, by name |
| `dims` | Its length, so a malformed row is detectable without decoding it |
| `createdAt` | When it was written |

A separate table rather than columns on `Fact`, so re-embedding never rewrites a fact, and so every
read of a fact does not drag a vector along with it.

**What is embedded:** the fact's `question` — "Berapa harga kek butter 1kg?" — falling back to its
`claim` where the question is null. Matching a question against other questions is the change that
makes this work at all.

**When:** in the worker, as extraction writes facts, one batched call per ingestion. Nothing is
embedded inside an owner's request, and an ingestion that fails to embed still writes its facts —
the page simply stays in fallback until a backfill catches it.

**When a fact is edited**, the API re-embeds that one fact on save. If that call fails, the row is
deleted rather than left stale, which puts the page in fallback — correct by construction.

**A backfill script** covers facts that already exist, in the shape of `scripts/backfill-fact-questions.ts`.

**The provider** is chosen against three criteria: strong multilingual quality (Malay, Manglish and
English in one page), a batch endpoint, and the smallest dimension count that holds quality —
256 to 512, because every question reads every vector on the page. Voyage AI's multilingual model is
the candidate; the exact model id and dimension count are confirmed against the provider's current
lineup when the plan is written, and the name is stored on every row so a later change is detectable
rather than silent. The provider sits behind `packages/embeddings`, the shape `packages/gateway`
already sets: one interface, one implementation, swappable without touching the chat path.

**A second table, `QuestionEmbedding`**, stores the vector for a normalized visitor question, keyed
by that normalized text and carrying the same `model` and `dims` columns. Question text is
page-independent, so one row serves every page that is ever asked the same thing. It is a cache of a
pure function, so it needs no invalidation: a row whose model does not match the current one is
ignored and rewritten.

---

## What happens when a visitor asks

1. Load the page's verified facts, exactly as today.
2. If the page has **fewer than `RETRIEVAL_MIN_FACTS` (25) verified facts**, send them all. There is
   nothing to save on a small page, and no reason to carry the risk. Every personal page lands here.
3. Load that page's vectors — about 1KB per fact, a few milliseconds. **They are read per question
   and never cached in process.** A cache would need invalidating on every fact write, and a stale
   vector is a wrong answer; two milliseconds is not worth that class of bug.
4. If **any** verified fact has no vector, or has one from a different model, send them all.
5. Embed the visitor's question. For a follow-up, the previous user turn is embedded with it, so
   "how about the chocolate one?" carries what it is about. A repeated question reuses its stored
   vector. If the provider fails or exceeds `EMBEDDING_TIMEOUT_MS` (1,000), send them all.
6. Score every fact by cosine similarity, highest first.
7. If the best score is below `RETRIEVAL_FLOOR` (0.35 to start, tuned against the golden set), send
   them all.
8. Otherwise take facts in score order until `FACT_BUDGET_CHARS` (4,000, roughly 1,200 tokens) is
   full, and send those. A fact that would overflow the budget ends the selection rather than being
   skipped over, so the set is always the top N by score.

The prompt is built as it is today, minus the `id` attribute on each fact, which nothing has ever
read back.

**Prompt caching is switched off in retrieval mode** and stays on in fallback mode. A prompt that
differs per question would otherwise write a fresh cache entry every time, at a 25% premium, that
nothing ever reads.

---

## Failure modes, in one place

| What happens | Result |
|---|---|
| The embeddings provider is down, erroring, or slower than 1s | Every fact is sent; the answer is never blocked on retrieval |
| A verified fact has no vector, or one from an older model | Every fact is sent for that page until the backfill catches up |
| The best match scores below the floor | Every fact is sent |
| The page has fewer than 25 verified facts | Every fact is sent |
| A fact is edited and re-embedding fails | Its row is deleted, so the page falls back until it succeeds |
| The visitor asks a follow-up | The previous user turn is embedded with the question |
| Retrieval succeeds | About 900 tokens instead of 5,994, and no cache write |

Every path ends in a correct answer. The only thing at stake in this slice is how much it costs.

---

## Testing, and its limits

**The selection is pure** — vectors, scores, a budget and a floor in; a list of facts out — and lives
in `@curios/core` beside the other rules the product is made of. It is unit-tested against synthetic
vectors: the budget is respected, the order is by score, a fact that would overflow ends the
selection, a score below the floor asks for fallback, and a page under the minimum asks for fallback.
Every test is proven by a mutation, as every test in this repo is.

**The golden set is the gate, and it needs a fourth page to be one.** The three existing fixtures
hold 7, 5 and 4 facts — all under the 25-fact floor, so every one of their sixty questions would run
in fallback mode and prove nothing about retrieval. They still run, unchanged, as the proof that
small pages are untouched.

Retrieval is proven by a new fixture, `catalog`: a business page with **at least 40 facts** and
twenty questions that only retrieval can satisfy — a fact sitting far down the list by score, an
English question against a Malay-worded fact, a Malay question against an English-worded one, a
question whose answer needs two facts at once, and a question about something the page genuinely
does not cover, which must still refuse. The suite goes from sixty questions to eighty, and a run
from about five cents to about seven.

**The golden runner writes embeddings when it seeds.** A fixture page whose facts have no vectors
falls back by rule, so without this the new page would prove as little as the old ones. One batched
call per run, at seeding time, using the same package the worker uses.

**The fallback rate is free to measure.** A retrieved answer carries a ~900-token prompt and a
fallback carries ~6,000, and `ModelCall` already records prompt size per call. No new tracking, and
the first real run's numbers go in `manual-verification-goldens.md`.

**What no test covers.** Whether retrieval picks well for a question nobody wrote a fixture for.
Sixty questions across three pages is a net, not a proof, and the honest signal after launch is the
fallback rate plus the questions owners see on their Questions screen.

---

## Done means

The golden set passes with retrieval on -- the `catalog` page exercising it and the other three proving small pages are untouched -- the prompt on a 114-fact page drops from ~6,000 tokens to
under 1,200 in retrieval mode, the fallback path is proven by a test for each of its four triggers —
a page under the minimum, a missing or outdated vector, a provider failure or timeout, and a best
score below the floor — and the three workspace gates pass. `devDocs/manual-verification-goldens.md` carries a row for the
run that proved it.

---

## Documents corrected by this slice

| Document | Correction |
|---|---|
| `BACKEND.md` | The ingestion and chat sections say facts are retrieved per question, with the fallbacks named. The claim that every fact is sent on every question goes. |
| `README.md` | A Settled decisions row: retrieval by embedding the question each fact answers, with fallback to everything; and the correction that prompt caching does not pay on a small shop's traffic. |
| `OPERATIONS.md` | Running the backfill; what to do when the embeddings provider is down (nothing — pages fall back); how to tell retrieval from fallback in `ModelCall`. |
| `prompt.ts` | Its own doc comment, which argues for sending every fact. It should say what is true now, including why the caching argument was retired. |
