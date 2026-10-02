# Manual verification — FAQ generation

**Status: NOT RUN.** Written down at the end of slice 6 rather than run, for the same
reason `manual-verification-leads.md` was: the four gates are green and the plan is about
to merge, and the checks that need a browser, a stranger's-eye view of `view-source`, or a
deployed URL are not things any gate can run. It is the third document of its kind, after
`manual-verification-google-link.md` and `manual-verification-leads.md`.

Re-run it after any change to `faq-slug.ts`, `faq.query.ts`, either `/[handle]/faq` route,
or `generateMetadata` on `/[handle]`.

## What CI proves, and what still needs a person

Every test named below was checked to exist, by name, before this table was written. **No**
means tests that run on every change prove the check. **Partly** means the logic underneath
is proven, but not the thing a person would actually see. **Yes** means only a real browser,
server or third party can confirm it. Check 7 is split into its five steps.

| # | Check | Proven by | Still needs a person |
|---|---|---|---|
| 1 | The third ask, arriving last, with no owner in the loop | `chat.service.test.ts` — 'assigns a faq slug when a third ask is the last condition to arrive' | **Partly** — over HTTP, from two real browser sessions |
| 2 | The entry page renders the owner's exact words | `faq.query.test.ts` — 'returns the question and the owner exact answer'; `[slug]/page.test.tsx` — 'renders the question as the heading and the owner exact answer' | **No** |
| 3 | Google's Rich Results Test | — | **Yes** — a system this repo does not own |
| 4 | `noindex` on personal, not on business | `[handle]/page.test.tsx` — 'asks crawlers to skip a personal page'; 'leaves a business page indexable' | **No** |
| 5 | A closing script tag renders as text, not as a tag | `faq.test.ts` — 'leaves no character that could close the script element'; `[slug]/page.test.tsx` — 'cannot be made to close its own script element' | **No** |
| 6 | Withdrawing the answer 404s the page and keeps the slug | `faq.query.test.ts` — 'omits a question whose answer the owner has withdrawn'; 'returns null once the answer is withdrawn, though the slug remains' | **No** |
| 7.1 | Hiding a question 404s both routes within the minute | `faq.query.test.ts` — 'drops a suppressed question from the index'; `question.routes.test.ts` — 'suppresses for the owner, and the row shows it' | **Partly** — the 60-second cache timing; see `deferred-findings.md` |
| 7.2 | Unsuppressing serves it again at the same URL | `faq.query.test.ts` — 'serves it again once the owner unsuppresses'; `question.takedown.test.ts` — 'puts it back' | **No** |
| 7.3 | Editing a published answer updates the public page | `question-list.test.tsx` — 'opens the editor with what the owner wrote, rather than blank'; 'saves the correction through the same writeback' | **Partly** — seeing the live page change |
| 7.4 | Erasing removes the question and its answer | `question.takedown.test.ts` — 'erases the question and the answer together'; `question.routes.test.ts` — 'erases the question for its owner'; `question-list.test.tsx` — 'asks before erasing, because a customer wrote those words' | **No** |
| 7.5 | An erased question asked again comes back a stranger | `chat.service.test.ts` — 'comes back as a stranger: no answer, no slug, and the model answers it' | **No** |

Seven of the eleven need no person, three are proven underneath but not on screen, and one —
Google's own test — never can be.

## What still needs a person, and why

Three different kinds of gap live in this one document, and they are worth telling apart
because they call for different amounts of trust in what follows.

Checks 2, 4, 5 and 6 are HTTP-shaped — a GET request and a look at the response body — and
this repo has no Playwright, Puppeteer, or other browser driver to send them with, even
though nothing about them strictly needs a human. The unit and integration tests already
cover the pieces: `packages/core/src/faq.test.ts` proves `serialiseJsonLd` escapes `<`,
`packages/db-read/src/faq.query.test.ts` proves the four read gates in isolation against
fixtures, and `apps/web/app/[handle]/faq/[slug]/page.test.tsx` proves the route calls
`getFaqEntry` and 404s on `null`. What no test covers is all of it wired together against a
real running server and a real Postgres row — where a mismatched column name, a caching
layer that serves stale HTML, or an escape that works in a unit test but not through
Next's actual script-tag renderer would show up.

Check 1 is different: it is fully reachable over HTTP, but it is listed here rather than
inferred from the unit tests because it is the one path with no owner action in it at all,
and it is the seam between the chat path and slug assignment.

**Corrected after an audit:** this used to say `faq-slug.test.ts` "only proves it works
when called directly with a crafted seed". That was already untrue when it was written.
`chat.service.test.ts`'s `faq slug assignment` block drives the real `answer()` for a
third ask and asserts the slug appears -- added in the very commit that introduced
`faq-slug.ts`. What is actually left unproven here is the HTTP layer and two distinct
real browser sessions, which is a much smaller claim than this section used to make.

Check 3 is the one nothing here can ever automate, no matter how good the browser driver
gets: the tests can prove the JSON is well-formed and safe, not that Google's crawler reads
it as intended or that it changes anything about the page's ranking. That is a question
about a system this repo does not own.

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

You need one published `BUSINESS` page and, for check 4, one published `PERSONAL` page.
Checks 1 and 6 write and delete rows directly, so use a page you do not mind leaving with
extra test questions on it rather than a real demo account.

---

## The eight checks

### 1. The third ask, arriving last, with no owner in the loop

This is the case `assignFaqSlug` exists to catch: a question the owner answered while it
still had only two asks, then asked a third time by a stranger who never touches the
dashboard. `faq-slug.test.ts` proves the function handles this shape of input; this proves
the chat route actually reaches it at the right moment on a live server.

1. On the business page's public chat, ask the same question **twice**, each time as a
   fresh visitor (a new incognito window, or clear the widget's stored conversation between
   asks — the count is per page and per normalised question, not per conversation, but
   using two genuinely separate sessions is closer to what "asked three times" means and
   removes any doubt about how the widget persists a conversation id). Use a phrasing with
   real content, e.g. "Ada delivery ke Klang?" — two asks that normalise to the same
   question is the point.
2. Confirm in the dashboard (`/app/questions`) that the question now shows **askCount 2**
   and is unanswered.
3. As the owner, write an answer to it. This alone must **not** create a FAQ page —
   `askCount` is still one short of `FAQ_MIN_ASKS`.
4. As a **third**, different visitor, ask the identical question again. Nothing about this
   step involves the owner or the dashboard.
5. Confirm the question now appears at `/[handle]/faq`, and that
   `SELECT "faqSlug" FROM "Topic" WHERE id = '<topicId>'` (or the query in check 6) shows a
   non-null slug. (The slug lives on the topic, not on the wording; the topic id is the
   `topicId` of the `Question` row.)

If step 3 already produced the FAQ page, something is wrong — it would mean the count check
is being skipped, not just satisfied.

### 2. The entry page renders the owner's exact words

Click through from `/[handle]/faq` to `/[handle]/faq/[slug]`. The answer text on the page
must match what the owner typed in the dashboard character for character — no truncation,
no markdown rendering, no re-wrapping. `getFaqEntry` returns `pinned.answer` untouched, so
any difference here is the route, not the read.

### 3. Google's Rich Results Test

The check nothing automated can do: the tests prove the JSON is well-formed and safe, not
that Google reads it as intended. This needs a deployed URL — `localhost` is not fetchable
by Google's crawler, so this waits for a staging or production deploy.

1. Deploy (or wait for the next deploy of) a business page with at least one FAQ entry.
2. Paste the entry page's public URL into
   [search.google.com/test/rich-results](https://search.google.com/test/rich-results).
3. Confirm it detects an `FAQPage` item with no errors. Warnings about eligibility for the
   rich-result carousel are not failures; Google changes what it shows for FAQ snippets
   independently of markup validity, and that is exactly the part this repo does not
   control.

### 4. `noindex` on personal, not on business

```
view-source:http://localhost:3000/<personal-handle>
view-source:http://localhost:3000/<business-handle>
```

The personal page's `<head>` must contain a `robots` meta tag disallowing indexing; the
business page's must not contain one at all. This is `generateMetadata` on `/[handle]`,
not the FAQ routes, but it belongs in this document because slice 6 is what made the
sentence in `FRONTEND.md` true rather than aspirational, and the FAQ pages are the reason
a business page being indexable actually matters.

### 5. A closing script tag renders as text, not as a tag

The one check that must be done in `view-source` and not devtools — devtools shows the
*parsed* DOM, where the browser has already turned escaped text back into the same tree
either way, hiding the difference this check exists to find.

1. As the owner, write a pinned answer containing a literal closing script tag, e.g.:

   ```
   RM95 sekotak.</script><script>alert(1)</script>
   ```

   on a question with `askCount >= FAQ_MIN_ASKS`, so it has a `faqSlug`.
2. Open `view-source:` (not devtools) on `/[handle]/faq/[slug]`.
3. In the `<script type="application/ld+json">` block, confirm the sequence reads
   `</script>...<script>`, not a literal `</script><script>`. That is
   `serialiseJsonLd` having done its job — the script element the browser sees ends where
   the JSON-LD actually ends, not wherever the owner's text happened to put a closing tag.
4. In the visible answer paragraph below it, confirm the same text appears as ordinary
   escaped HTML (`&lt;/script&gt;...`), rendering on the page as plain text the owner
   typed — not as a second, executed script element.

### 6. Withdrawing the answer 404s the page and keeps the slug

Withdrawing an answer from the Knowledge screen does this; this exercises the database
state directly, so the read gates are proved independently of the UI. Take the counts
**before** you change anything.

```bash
docker exec -i curios-postgres psql -U curios -d curios -c 'SELECT title, "faqSlug", "askCount", answer IS NOT NULL AS answered FROM "Topic" WHERE "faqSlug" IS NOT NULL;'
```

Pick a row with a `faqSlug` and confirm it currently 200s at `/[handle]/faq/[slug]` and
appears in the `/[handle]/faq` list. Then clear the topic's answer directly, scoped to the
page by handle (a slug is unique only within a page):

```bash
docker exec -i curios-postgres psql -U curios -d curios -c '
UPDATE "Topic" SET answer = NULL, "answeredAt" = NULL
WHERE "faqSlug" = '"'"'<slug>'"'"'
  AND "pageId" = (SELECT id FROM "Page" WHERE handle = '"'"'<handle>'"'"');'
```

Run the first `SELECT` again. **The row must be unchanged except `answered`** — same
`faqSlug`, same `askCount`, and `answered` now `false`. The slug stays on the topic
(it is never cleared). What must change is what the routes do with it:

- `/[handle]/faq/[slug]` now 404s.
- The topic is gone from `/[handle]/faq`'s list.

Both routes key off `Topic.answer` being set, not off `Topic.faqSlug` alone — this is the
check that proves it, and the reason the schema comment on `faqSlug` says the column is
"never changed or cleared once set."

---

### 7. The takedown actually takes it down

Added after the six above, when suppression, erasure and correction landed. This is
the check that matters most to a person who is not the owner: it is the only way a
customer's own words come back off a public page.

With a question live at `/[handle]/faq/[slug]`, open the questions screen and:

1. **Hide it.** The row should say it is hidden. Within a minute — `revalidate` is 60
   seconds, not the 24 hours this document first described — both `/[handle]/faq` and
   the question's own URL must 404. Check the **direct URL**, not only the index: a
   takedown that removes the link but leaves the page resolving is not a takedown,
   because the URL is what got indexed.
2. **Show it again.** It should come back, at the same URL. Suppression is reversible
   on purpose, and the slug is deliberately never reassigned.
3. **Fix the answer.** Edit answer opens prefilled with what you wrote. Change a word,
   save, and confirm the public page shows the new text within the minute.
4. **Erase it.** Delete asks first. After confirming, the question and its answer are
   both gone:

```bash
docker exec -i curios-postgres psql -U curios -d curios -c   'SELECT title, "faqSuppressed", answer FROM "Topic" WHERE "faqSlug" IS NOT NULL;'
```

5. **Then ask it again in chat, once.** This is the part worth doing by hand: an
   erased question is re-logged the next time somebody asks, because the chat path
   upserts on the normalised text. It must come back as a *fresh* topic — ask count 1,
   unanswered, no slug — and must **not** reappear on `/faq`. If the old answer comes
   back with it, the erasure did not erase. (This said "twice more" until an audit caught
   the arithmetic: the upsert increments on every ask after the create, so two asks give
   ask count 2 and a careful reader would think the erasure was broken.)

### 8. A merged-away address redirects to the survivor

Added with topics (slice 15). Needs two topics on a business page that each have a FAQ
page (three asks and an answer each). Note both addresses from `/[handle]/faq`.

1. On the Questions screen, merge one topic into the other ("Same as…"), keeping either
   answer.
2. Load the **merged-away** address, `/[handle]/faq/[old-slug]`. It must redirect
   (permanently) to the survivor's `/[handle]/faq/[survivor-slug]` and show its answer.
   The survivor's own address is unchanged.
3. Confirm the retired slug is recorded against the survivor:

```bash
docker exec -i curios-postgres psql -U curios -d curios -c 'SELECT r.slug, t."faqSlug" AS survivor FROM "FaqRedirect" r JOIN "Topic" t ON t.id = r."topicId" WHERE r.slug = '"'"'<old-slug>'"'"';'
```

4. Delete the survivor topic, then reload the old address: with no target the redirect
   row's `topicId` is NULL and the address must 404, never redirect.

## Recording the result

Note which checks you ran and what you saw, in this file, with the date. Report any not
run rather than leaving them ambiguous — that ambiguity is why this document exists.
