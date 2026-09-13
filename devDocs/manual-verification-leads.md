# Manual verification — the leads screen

**Status: NOT RUN.** Written down because slice 5 plan 2 shipped without it, and the
ledger that recorded that fact lives in `.superpowers/`, which is gitignored.

Slice 5 plan 2's Task 5 Step 2 is a browser walkthrough of `/app/leads`. Every automated
gate passed and the plan is merged; this is the half nobody has done. It is the second
document of its kind, after `manual-verification-google-link.md`.

Re-run it after any change to `leads.query.ts`, `lead-list.tsx`, `lead.service.ts`'s
delete, or the dashboard nav.

## What CI proves, and what still needs a person

Every test named below was checked to exist, by name, before this table was written. **No**
means tests that run on every change prove the check. **Partly** means the logic underneath
is proven, but not the thing a person would actually see.

| # | Check | Proven by | Still needs a person |
|---|---|---|---|
| 1 | Newest first, with at least two leads present | `leads.query.test.ts` — 'returns the newest first, because a cold lead is a lost one' | **No** |
| 2 | The transcript opens and closes | `lead-list.test.tsx` — 'keeps the transcript closed until asked'; 'opens the transcript on request' | **No** |
| 3 | The WhatsApp link points at the number with no `+` | `lead-list.test.tsx` — 'offers a WhatsApp link that opens on the right number' | **No** |
| 4 | Delete asks first, and Cancel during a delete removes nothing | `lead-list.test.tsx` — 'asks before deleting'; 'shuts Cancel too while a delete is in flight'; `lead.routes.test.ts` — 'deletes a lead the owner owns, called the way the browser actually calls it' | **No** |
| 5 | The nav moves between screens and marks the current one | `Nav.test.tsx` — its `aria-current` assertions; `layout.test.tsx` — 'hides the nav from an owner who has not claimed a handle yet'; 'keeps the nav for an owner revisiting onboarding to add sources' | **Partly** — `app-nav.tsx`, which feeds the real pathname to the marker, is untested |
| 6 | Deleting a lead leaves its conversation | `lead.delete.test.ts` — 'leaves the conversation alone' | **No** |
| 7 | No phone number reaches the API log | `lead.logging.test.ts` — 'does not appear in any log line around POST /leads or DELETE /leads/:id' | **No** |

Six checks need no person, and the seventh has one untested component inside it.

## What still needs a person, and why

**Almost nothing.** All seven checks are proven by tests that run on every change — see the
table below — and none needs a browser: the client-side ones run under jsdom via Testing
Library. Check 7, that a phone number never reaches the logs, was the last one uncovered.
`apps/api/src/modules/leads/lead.logging.test.ts` now asserts it against every line pino
emits around a real capture and a real delete, after first proving it can see those lines
at all — an empty capture would otherwise pass.

One real gap is left, inside check 5. `packages/ui/src/nav/Nav.test.tsx` proves
`aria-current` lands on the link it is told is current, and
`apps/web/app/app/layout.test.tsx` proves when the nav is shown. But
`apps/web/app/app/app-nav.tsx`, the component that feeds the real pathname into that marker,
has no test, and `layout.test.tsx` mocks `usePathname` to a constant. A change that broke the
pathname-to-link mapping would stay green.

So this document is a sanity pass against real data — a wrong column, or a serialisation
problem the fixtures happen not to hit — not the safety net it was written as.

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

**Check the page's plan columns first.** Since slice 8 a page must be `BUSINESS` and
either have `paidUntil` in the future or `leadsCaptured < 3`, or the capture card never
renders at all -- not disabled, not an error, simply absent, which is deliberate. A dev
page reused across slices 4, 5 and 8 has very likely spent its three:

```bash
docker exec -i curios-postgres psql -U curios -d curios -c   "SELECT handle, mode, \"leadsCaptured\", \"paidUntil\" FROM \"Page\" WHERE handle = 'nadia';"
docker exec -i curios-postgres psql -U curios -d curios -c   "UPDATE \"Page\" SET \"leadsCaptured\" = 0 WHERE handle = 'nadia';"
```

See `devDocs/OPERATIONS.md` for why the reset sets zero rather than subtracting.

---

## The seven checks

Take the counts in check 6 **before** you delete anything.

1. **`/app/leads` lists the lead, newest first.** Not just that a row appears — that the
   order is newest-first with at least two leads present. One lead cannot fail an
   ordering check.
2. **The transcript opens and closes.** Already automated -- `lead-list.test.tsx` drives
   it with `userEvent.click` under jsdom. Kept here only as a sanity check that it also
   works against real data; skip it if you are short of time.
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
