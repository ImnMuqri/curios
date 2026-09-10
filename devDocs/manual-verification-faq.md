# Manual verification — FAQ generation

**Status: NOT RUN.** Written down at the end of slice 6 rather than run, for the same
reason `manual-verification-leads.md` was: the four gates are green and the plan is about
to merge, and the checks that need a browser, a stranger's-eye view of `view-source`, or a
deployed URL are not things any gate can run. It is the third document of its kind, after
`manual-verification-google-link.md` and `manual-verification-leads.md`.

Re-run it after any change to `faq-slug.ts`, `faq.query.ts`, either `/[handle]/faq` route,
or `generateMetadata` on `/[handle]`.

## Why it can't be automated here

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
and `faq-slug.test.ts` only proves it works when called directly with a crafted seed —not
that the chat route actually calls it at the right moment for a real, unscripted sequence
of requests. Worth the ten minutes precisely because Task 3's own history shows this path
had no test until one was written for it on purpose.

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

## The six checks

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
   `SELECT "faqSlug" FROM "Question" WHERE id = '<id>'` (or the query in check 6) shows a
   non-null slug.

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

There is no dashboard action that withdraws a pinned answer yet — this exercises the
database state that the read gates were built to handle, standing in for a future "delete
answer" feature. Take the counts **before** you delete anything.

```bash
docker exec -i curios-postgres psql -U curios -d curios -c 'SELECT text, "faqSlug", "askCount", answered FROM "Question" WHERE "faqSlug" IS NOT NULL;'
```

Pick a row with a `faqSlug` and confirm it currently 200s at `/[handle]/faq/[slug]` and
appears in the `/[handle]/faq` list. Then remove the pinned answer directly, joining on the
slug so there is no id to copy by hand:

```bash
docker exec -i curios-postgres psql -U curios -d curios -c '
DELETE FROM "PinnedAnswer" pa
USING "Question" q
WHERE pa."pageId" = q."pageId"
  AND pa."normalizedQuestion" = q."normalizedQuestion"
  AND q."faqSlug" = '"'"'<slug>'"'"';'
```

Run the first `SELECT` again. **The row must be unchanged** — same `faqSlug`, same
`askCount`, and `answered` still `true` (the `Question` row is never told the answer
underneath it was withdrawn; that flag only means the owner once wrote one). What must
change is what the routes do with it:

- `/[handle]/faq/[slug]` now 404s.
- The question is gone from `/[handle]/faq`'s list.

Both routes key off `PinnedAnswer` existing, not off `Question.answered` or
`Question.faqSlug` — this is the check that proves it, and the reason the schema comment
on `faqSlug` says the column is "never cleared."

---

## Recording the result

Note which checks you ran and what you saw, in this file, with the date. Report any not
run rather than leaving them ambiguous — that ambiguity is why this document exists.
