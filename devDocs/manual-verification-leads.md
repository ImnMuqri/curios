# Manual verification — the leads screen

**Status: NOT RUN.** Written down because slice 5 plan 2 shipped without it, and the
ledger that recorded that fact lives in `.superpowers/`, which is gitignored.

Slice 5 plan 2's Task 5 Step 2 is a browser walkthrough of `/app/leads`. Every automated
gate passed and the plan is merged; this is the half nobody has done. It is the second
document of its kind, after `manual-verification-google-link.md`.

Re-run it after any change to `leads.query.ts`, `lead-list.tsx`, `lead.service.ts`'s
delete, or the dashboard nav.

## Why it can't be automated here

Two of the seven checks are client-side interactions in a browser, and this repo has no
Playwright, Puppeteer, or any other browser driver. The rest *can* be reached over HTTP
against a real server, which no test currently does — every existing test runs against
fixtures and mocks.

That distinction is the point. The unit tests already cover the transcript toggle and the
delete confirm (`apps/web/app/app/leads/lead-list.test.tsx`) and `aria-current`
(`packages/ui/src/nav/Nav.test.tsx`). What no test covers is the screen running against
the actual database with the actual lead captured in slice 4 — where a wrong column, a
serialisation problem, or a phone number reaching a log would show up.

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

You need a signed-in owner whose account has the lead captured during slice 4. If that
lead is gone from the dev database, capture a fresh one by asking a question on the
public page and leaving a phone number, then wait for the worker to fill the slots.

---

## The seven checks

Take the counts in check 6 **before** you delete anything.

1. **`/app/leads` lists the lead, newest first.** Not just that a row appears — that the
   order is newest-first with at least two leads present. One lead cannot fail an
   ordering check.
2. **The transcript opens and closes.** Browser only.
3. **The WhatsApp link points at `60123456789` with no `+`.** `wa.me` silently fails on a
   plus. Check the real `href`, not the label.
4. **Delete asks first, then removes the row.** Both halves: the confirm appears, and
   Cancel while a delete is already in flight does not remove anything. That second part
   was a real bug found in review — see the branch history for `a27f8c5`.
5. **The nav moves between review, questions, leads and settings, and marks where you
   are.** Also confirm it is **absent** on `/app/onboarding` for an owner with no page,
   and **present** there for an owner who has one. That gate is newer than the plan.
6. **Deleting a lead must not destroy the conversation behind it.**

```bash
docker exec -i curios-postgres psql -U curios -d curios -c 'SELECT count(*) AS conversations FROM "Conversation";'
docker exec -i curios-postgres psql -U curios -d curios -c 'SELECT sum("askCount") AS asks FROM "Question";'
```

Run both before and after the delete. **Neither number may change.** A delete that takes
the conversation with it also takes the questions screen's ask counts, and that is
silent — the leads screen would look correct.

7. **No phone number in the API log.** Watch the API terminal through the whole
   walkthrough. A lead's phone number appearing in a log line is a PDPA problem, not a
   tidiness one.

---

## Recording the result

Note which checks you ran and what you saw, in this file, with the date. Report any not
run rather than leaving them ambiguous — that ambiguity is why this document exists.
