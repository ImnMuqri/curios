# Slice 6 — The page that answers before anyone asks

> Intended path: `devDocs/slice-6-build-spec.md`

Slice 5 gave owners somewhere to look: every question a visitor has asked, ranked by how
often, with a box to answer it once. What it did not do is let that answer reach anybody
who is not already on the page.

Right now an owner's answer is worth exactly one thing — the next visitor who asks the
same question gets it back from `PinnedAnswer` for zero tokens. That is the cheap half.
The expensive half is that the same answer, on a URL Google can index, brings people who
would never have found the page at all.

This slice turns answered questions into public pages. It is roadmap item 6, and it is the
first slice whose output is aimed at a stranger who has not arrived yet.

---

## What is in, what is out

| In | Out (and where it goes) |
|---|---|
| `Question.faqSlug` — a stable public URL per question | Wiring the over-cap fallback to serve this payload (needs a cap, which is slice 7) |
| The qualifying rule: asked 3+ times, answered, business | `/app/knowledge` — pinned answer and never-say management |
| `/[handle]/faq` — the question index | An owner control to suppress a specific FAQ page |
| `/[handle]/faq/[slug]` — one question, one answer | Sitemap generation |
| `FAQPage` structured data, and the escaping that makes it safe | Voice or tone scoring of answers |
| `noindex` on personal pages, which was documented and never built | Cloud API replies, still on the roadmap |

The over-cap exclusion is worth stating plainly, because BACKEND.md has carried a stub
since slice 1 that points here. This slice makes the artifact exist. Pointing the switch at
it needs a cap number, and the slice that owns cap numbers is 7. Building half a billing
decision here would mean inventing the cap twice.

---

## The rule, and why it is a number in a function

A question becomes a public page when all three hold:

```
page.mode === 'BUSINESS'    &&    askCount >= 3    &&    answered
```

`packages/core/src/faq.ts`, next to `qualify.ts`, which settled the same argument for lead
capture in slice 4: a rule you can unit-test in a function beats a rule you tune in a
prompt or a config table.

**Three, not one.** BACKEND.md's line is "do not generate FAQ pages for questions nobody
asked, that is content farm behaviour and it will read as one." One ask is somebody asking,
so a threshold of one is not indefensible — but it produces a page per stray question, and
a hundred thin pages is the shape of the thing that rule forbids.

**Three, not five.** These are small shops. A bakery gets a handful of distinct questions a
week, and a threshold that generates nothing for two months is a feature that dies before
anyone sees it work.

**`answered` is doing separate work from the count.** It means the owner wrote the answer
themselves — see slice 5's spec for why it does not mean the model coped. So the count is
evidence of demand and `answered` is evidence of intent, and a public page wants both. A
page carrying an answer the owner never wrote is the failure mode this product cannot
afford, because the whole premise is that it does not invent.

**Business only**, per README's tier table. Personal pages are not indexed by default and
do not generate FAQ pages, and both halves of that are the same privacy decision.

---

## `faqSlug`: stored, not derived

`Question` gains `faqSlug String?`, with `@@unique([pageId, faqSlug])`.

Derived-on-read would be less schema, and it is the wrong trade. Two reasons, and the
second is the one that matters:

1. The route resolves a slug back to a question. Deriving means either scanning every
   question on the page and slugifying each to compare, or storing it anyway.
2. **URL stability.** The moment the slug function is refined — a better truncation, a
   Unicode fix — every derived URL changes. A page that had begun to rank loses what it
   earned, and the old URL 404s. A stored slug is a promise that the URL outlives the
   function that made it.

Nullable because most questions never qualify, and null is the honest representation of
"no public page" rather than a slug that exists but resolves to nothing.

### Where it gets assigned, and why it is two places

`apps/web` holds a SELECT-only connection. The route cannot mint a slug on first request
even though that is where the need appears. It has to be written by code that already
writes, and the two qualifying conditions can be completed in either order:

| The last condition to arrive | Where that write happens |
|---|---|
| Owner answers a question already asked 5 times | the answer-writeback in `apps/api` |
| A question already answered gets its 3rd ask | question logging in the chat path |

Both call one helper, which assigns a slug only if the question qualifies and has none.
Implement one site and not the other and FAQ pages appear for some questions and never for
others, decided entirely by the order in which an owner and a stranger happened to act.
That is a bug that reads as randomness, and it would be found months later by an owner
asking why one of their answers "went public" and another did not.

Collisions are resolved per page with a numeric suffix, and long questions truncate before
the suffix is applied so the suffix survives.

---

## The reads

`packages/db-read` gains two queries. Every gate lives here, not in the route, so a new
caller cannot forget one:

```
getFaqIndex(handle)       -> { handle, displayName, entries: { slug, question }[] } | null
getFaqEntry(handle, slug) -> { handle, displayName, question, answer }              | null
```

Gates, all four: `published`, `mode === 'BUSINESS'`, `faqSlug` present, and a
`PinnedAnswer` that still exists for that `normalizedQuestion`.

`Question` and `PinnedAnswer` have no Prisma relation, but both carry a unique
`(pageId, normalizedQuestion)`. So this is two indexed lookups joined in memory, not raw
SQL and not a new foreign key. The index query orders `askCount desc, lastAskedAt desc` —
the same ordering the owner sees on `/app/questions`, so the public page and the dashboard
agree about which question matters most — and clamps its limit like every other query in
this package.

The fourth gate is the interesting one. An owner who deletes a pinned answer has withdrawn
the answer, and the public page must stop serving it immediately rather than at the next
revalidation. Reading through `PinnedAnswer` rather than caching the text on `Question`
makes that automatic instead of a second thing to remember.

---

## The routes, and how static they actually are

```
/[handle]/faq          question index    revalidate 86400
/[handle]/faq/[slug]   single answer     revalidate 86400
```

`runtime = 'nodejs'` on both, like `/[handle]` — these read Postgres through the read-only
role.

**No `generateStaticParams`.** FRONTEND.md's route table says "static, revalidate 24h" and
that is what this produces, but not by enumerating anything at build time. Without
`generateStaticParams`, the first visitor to a URL triggers the render and every visitor
after that gets cached HTML until the window expires.

Enumerating instead would mean walking every published business page and every qualifying
question at build time, which grows with the product, and — the deciding reason — it would
make `pnpm build` require a live database. It does not today, and the build gate depends on
that. One fewer moving part, and a build that still runs on a laptop with no Postgres.

`notFound()` on all four failure shapes: no such handle, personal page, unpublished page,
and a slug whose answer has been withdrawn. `faqSlug` is deliberately **not** cleared when
an answer is deleted, so if the owner answers again the same URL comes back rather than a
second one being minted beside a dead first.

`faq` is already on the reserved handle list from slice 2, so no page can be claimed at a
handle that would sit oddly beside these routes.

---

## `FAQPage`, and the injection it invites

Both routes emit `FAQPage` structured data — the index carrying every pair, the slug page
carrying its one.

This is the first JSON-LD in the codebase, and it arrives with a real vulnerability rather
than a theoretical one. The payload goes inside a `application/ld+json` script element and
contains **owner-written answer text**. An answer containing a literal closing script tag
ends that element early, and everything after it is parsed as HTML — script injection into
a public page, reachable by any owner, on the one surface the product describes as its
reputation.

`JSON.stringify` does not prevent this. It escapes quotes and backslashes; `<` is a legal
character in a JSON string and comes through untouched. The fix is to replace every `<` in
the serialised output with its unicode escape:

```ts
JSON.stringify(payload).replaceAll('<', '\\u003c')
```

The result is still valid JSON and parses back to exactly the same object, so consumers
see the original text — but there is no longer a `<` in the document that could close a
tag.

So the helper and its test are part of this slice's first task, not a detail of the route
that renders it. The test must put a literal closing script tag inside an answer and assert
it does not appear as markup — asserting only that the JSON parses would pass against the
broken version.

---

## `noindex` on personal pages

FRONTEND.md has said since slice 1 that personal pages are `noindex` by default, and it is
a privacy decision rather than an SEO one: most people do not want an AI page about
themselves ranking for their own name. Nothing implements it. There is no
`generateMetadata` anywhere in `apps/web` and never has been.

This slice builds the metadata layer, so it fixes it: `/[handle]` emits
`robots: { index: false, follow: false }` when `mode === 'PERSONAL'`.

Included rather than deferred because the alternative is shipping the first metadata layer
in the product's history while stepping over a documented privacy default that belongs in
it. The toggle that lets an owner opt in lives in `/app/appearance`, which does not exist
yet; until it does, personal means not indexed, which is the safe direction.

---

## Testing, and its limits

| Layer | What is proven |
|---|---|
| `packages/core` | Each of the three gates rejects, with a negative case each. The slug function on Malay text, on collisions, and on a question long enough to truncate. The JSON-LD escape against a literal closing script tag. |
| `packages/db-read` | Both queries against the real database, each of the four gates proven by the row it excludes — an unpublished page, a personal page, an unslugged question, a withdrawn answer. |
| `apps/api` | A slug is assigned when the answer is the last condition to arrive, and when the third ask is. The second is the one an implementation is likely to miss. |
| `apps/web` | Both routes rendered as Server Components, per `review/page.test.tsx`. The JSON-LD parses and contains the pair. All four `notFound()` shapes. `noindex` present for personal, absent for business. |
| Budget | Neither FAQ route ships client JS — neither renders `Ask` — asserted against the build manifest the way `[handle]/budget.test.ts` already does. |

**What no test covers.** Whether these pages rank, or whether the answers read well enough
to be worth landing on. The first needs months and a live domain. The second is the same
open question slice 5 left about ranking questions by ask count: it needs a real owner with
real customers, and no assertion substitutes for that.

Nor does anything here prove Google parses the structured data as intended. That needs the
Rich Results Test against a deployed URL, and it belongs in a manual verification document
alongside the Google round trip and the leads walkthrough.

---

## One plan

Small enough for one, unlike slice 5. Ordered so each task's output is the next one's
input:

1. **The rule and the slug** — `packages/core`: `qualifiesForFaq`, the slug function, and
   the JSON-LD escape helper, with tests. No consumers yet.
2. **The column** — `Question.faqSlug` and its migration.
3. **Assignment** — both write sites in `apps/api`, sharing one helper.
4. **The reads** — `getFaqIndex` and `getFaqEntry`, with all four gates.
5. **The routes** — both pages, `FAQPage`, `generateMetadata`, and `noindex` on
   `/[handle]`.
6. **Gates and a walkthrough** — the four gates, and the manual checks that need a browser
   and a deployed URL, written up rather than skipped.

---

## Documents corrected by this slice

| Document | Correction |
|---|---|
| `BACKEND.md` | FAQ generation: "a worker writes a static page and revalidates" becomes Next ISR with a 24h window. No BullMQ job exists or is planned; the worker sentence predates the choice of ISR. |
| `README.md` | The BullMQ row lists "FAQ builds" among its jobs. Removed — ingestion and digest emails remain. |
| `BACKEND.md` | The schema note "faqSlug waits for the FAQ slice" is closed: it exists, nullable, unique per page. |
| `FRONTEND.md` | The `noindex` default for personal pages stops being aspirational. The sentence stands; this slice makes it true. |
