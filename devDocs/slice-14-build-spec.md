# Slice 14 — Knowledge: one place to see and remove what the chat knows

**Goal:** give the owner one screen for everything the chat answers from — sources, facts, pinned
answers and the never-say list — and let them remove any of it. Today there is nowhere to do that.
A source cannot be removed at all, because a fact does not record which ingestion produced it. An
accepted fact never appears on any screen again: Review lists only facts still waiting. Never-say is
read by the chat but has no API and no screen. FRONTEND.md planned `/app/knowledge` from the start;
it was never built.

Designed with the owner on 2026-09-27 and 2026-09-28; the choices below are theirs.

---

## What is in, what is out

**In:**

1. **A Knowledge screen** at `/app/knowledge` with four tabs: Sources, Facts, Pinned answers,
   Never-say. It replaces *Add a source* in the sidebar.
2. **Source tracking.** Every fact an ingestion writes from now on records that ingestion.
3. **Removing a source**, which removes its facts.
4. **Check for new facts** on a link source: re-read it and send what is new to Review.
5. **Facts:** every accepted fact, with edit, remove, and add-your-own.
6. **Pinned answers:** one list of all of them, with edit and withdraw.
7. **Never-say:** its first API and screen.

**Out, and why:**

- **Creating a pinned answer from Knowledge.** A pinned answer fires only on an exact match of the
  normalised question, so a question the owner invents rarely matches what visitors type. New ones
  keep starting from Questions, from real phrasing. Adding a fact is the tool for "the chat should
  know this".
- **Removing facts a re-read no longer finds.** Check for new facts adds; it never takes away.
  Detecting that a site dropped a claim needs a diff of old against new facts, which is a design of
  its own. Remove and re-add the source is the full refresh.
- **Many-to-many fact sources.** A fact is stored once and credited to the source that produced it
  first. See the decisions below.
- **Matching old facts to sources.** Facts written before this slice stay untracked.
- **An output filter for never-say.** It stays a prompt instruction.

---

## Decisions the owner made

1. **Scope is everything FRONTEND.md planned:** sources, facts, pinned answers, never-say.
2. **Facts from before tracking go in their own group**, "Added before sources were tracked",
   removable one at a time, never as a batch. No attempt is made to match them to a source.
3. **Removing a source forgets it; rejecting a fact blocks it.** Removing a source hard-deletes its
   facts, so re-adding the source extracts them afresh. Facts the owner rejected one by one keep
   their tombstone rows and stay blocked.
4. **A fact belongs to one source**, the one that wrote it first. Removing that source removes the
   fact even if another source also states it. Re-reading the other source brings it back. The
   confirmation says so, so the loss is not silent.
5. **Editing a fact makes it the owner's.** It moves to "Added by you", is detached from its
   source, and survives the source's removal. The old wording gets a tombstone so a re-read cannot
   bring it back.
6. **Never-say stays a prompt instruction**, and the screen says so honestly: very reliable, not a
   guarantee. No post-hoc filter, because it would end streaming and catch only literal words.
7. **Pinned answers: list, edit, withdraw.** New ones come from Questions.
8. **The owner can add a fact directly.** It is live at once, in "Added by you", with no Review.
9. **Sidebar:** *My Curios · Review · Knowledge*. Add a source moves into the Sources tab. Review
   stays its own item because it is an inbox, not a list.
10. **Check for new facts is in**, adding new facts only, labelled so it does not claim to refresh.
11. **The source is the existing `Ingestion` row**, not a new table.

---

## The data

One migration.

**`Fact`** gains:

- `ingestionId String?` — relation to `Ingestion`, `onDelete: SetNull`. Set by the worker. Null for
  owner-written and pre-tracking facts, and for tombstones whose source was removed.
- `origin FactOrigin` — `EXTRACTED | OWNER | UNTRACKED`. Column default `EXTRACTED`. The migration
  sets every existing row to `UNTRACKED`, then leaves the default in place for the worker.
- `@@index([ingestionId])`.

**`Ingestion`** gains:

- `tracked Boolean @default(true)`. The migration sets every existing row to `false`. An untracked
  source's old facts are in the Before tracking group, so its row shows "Facts from before tracking
  are listed under Facts" instead of a count, and removing it removes the entry only — the
  confirmation says so.

`ModelCall.ingestionId` is a plain string with no relation, so deleting an `Ingestion` leaves cost
history untouched.

**What each Facts-tab label means:**

| `origin`    | label                          | removed with its source? |
| ----------- | ------------------------------ | ------------------------ |
| `EXTRACTED` | the source's link or first line | yes                    |
| `OWNER`     | Added by you                   | no                       |
| `UNTRACKED` | Before tracking                | no                       |

An **accepted** fact is `verified = true AND rejectedAt IS NULL`, the same rule the public read
paths use.

---

## Behaviour

**Removing a source** — one transaction:

1. Refuse with `SourceBusyError` if the row is `QUEUED` or `RUNNING`. The worker would otherwise
   write facts pointing at a deleted row.
2. Delete facts with this `ingestionId` and `rejectedAt IS NULL`, accepted or still in Review.
   `FactEmbedding` cascades.
3. Delete the `Ingestion`. Rejected facts keep their row and their `normalizedClaim`, so they keep
   blocking; `SetNull` clears their link.
4. Return the number of facts deleted.

**Editing a fact** — `editFact`, extended, in one transaction:

1. Update the claim, set `origin = OWNER`, `ingestionId = null`.
2. If the normalised claim changed, write a tombstone: a new `Fact` with the old `claim` and
   `normalizedClaim`, `rejectedAt = now`, `verified = false`, `origin = OWNER`, same category.
3. Re-embed as today, after the transaction.

This applies wherever the edit is made, including on Review: an owner who rewrote a claim vouches
for it.

**Adding a fact** — a new `Fact` with `origin = OWNER`, `verified = true`, `confidence = 1`, no
source fields, then embedded as `editFact` does (a failed embed deletes the vector and logs; it never
fails the save). A clash on `@@unique([pageId, normalizedClaim])` is `DuplicateFactError`, the same
error an edit gives — including a clash with a tombstone, which the owner fixes by rewording.

**Removing a fact** — the existing `rejectFact`. Removing an accepted fact and rejecting a pending
one are the same act: hidden, and blocked from returning.

**Check for new facts** — sets the row back to `QUEUED`, clears `error` and `extractedCount`, marks
it `tracked = true` and enqueues the same job with the same `ingestionId`. Refused while `QUEUED` or
`RUNNING` (`SourceBusyError`) and for a pasted-text row (`NotRecheckableError`). New facts get this
`ingestionId` and go to Review; wording that already exists, tombstones included, is skipped by
`skipDuplicates` as today. An untracked row that is re-checked shows a count of its new facts from
then on; its older facts stay in Before tracking.

**The worker** writes `ingestionId: job.ingestionId` and `origin: EXTRACTED` on every row.

**Never-say** — a phrase is trimmed, 1–120 characters, no line breaks; at most 50 per page;
duplicates compared case-insensitively after trimming. `prompt.ts` escapes each phrase with
`escapeForPrompt`, as facts already are.

**Withdrawing a pinned answer** — one transaction: delete the `PinnedAnswer` for the question's
`normalizedQuestion`, set `Question.answered = false`. `faqSlug` is kept, as the schema requires, so
the FAQ route 404s and a later answer republishes at the same URL. The question reappears on
Questions as unanswered.

---

## The API

Every route sits in the session-required scope and scopes by `accountId`. An item on another
account is a 404, never a 403.

| route | does | errors |
| ----- | ---- | ------ |
| `DELETE /sources/:id` | removes the source and its facts; returns `{ removedFacts }` | 404, 409 busy |
| `POST /sources/:id/recheck` | Check for new facts | 404, 409 busy, 400 pasted text |
| `POST /facts` | `{ category, claim }` (claim 1–500 chars) adds an owner fact | 409 duplicate |
| `PATCH /facts/:id` | existing edit, now with owner/tombstone rules | 404, 409 duplicate |
| `POST /facts/:id/reject` | existing; the Remove button | 404 |
| `POST /never-say` | `{ phrase }` | 400 invalid, 409 duplicate, 409 limit |
| `DELETE /never-say/:id` | removes one | 404 |
| `POST /questions/:id/answer` | existing; also the pinned-answer edit | 404 |
| `DELETE /questions/:id/answer` | withdraw | 404 |

Adding a source keeps `POST /ingest`. Reads are not API routes: the screen reads through
`@curios/db-read`, as every owner screen does.

---

## The screen

`/app/knowledge?tab=sources|facts|pinned|never-say`, default `facts`. The tab is in the URL so it
can be linked and Back works. It follows the dashboard's existing look and works at 375px.

**Sidebar.** *Your page* becomes My Curios, Review, Knowledge. `/app/onboarding` is unchanged: it is
still where a new owner claims a handle and adds a first source.

**Sources.** An *Add a source* button opens the existing `Ingest` form in place. Each row: the link,
or the first line of the pasted text; date added; fact count (or the untracked line); status. Queued
or running shows "Reading…" and updates live, reusing onboarding's `JobStatus`. Failed shows the
error in plain words. Actions: *Check for new facts* (links only), with "Adds new facts. Doesn't
remove ones the site has dropped." beneath; *Remove*, confirmed inline: "Remove this source and its
12 facts? Facts another source also says are removed too." *Remove* / *Cancel*.

**Facts.** *Add a fact*: category picker, one line, *Add*. Below, accepted facts grouped by
category, each with its label, *Edit* (inline, as on Review) and *Remove* (one-step confirm). A
search box filters the list on the client.

**Pinned answers.** Each row: the visitor's question and the answer, *Edit*, *Remove*. Remove
confirms: "The question goes back to Questions as unanswered." Empty state points to Questions.

**Never-say.** Opens with "The chat is told never to bring these up. It's very reliable, but not a
guarantee — don't put anything here that must never appear." An add box with a live count to 120,
the list with *Remove*, and "12 of 50".

---

## Failure modes, in one place

- **Any action fails:** its own error in place, the owner's text kept, focus kept — the pattern
  from slice 13's My Curios fix round.
- **409s get their own words:** "Already being read", "That's already on the list", "You've reached
  50 — remove one first", "That fact already exists".
- **Source removed mid-read:** refused (409). The row shows "Reading…" and the owner retries after.
- **Embedding fails on add or edit:** the fact is saved; its vector is deleted and the page falls
  back until a backfill runs, as `editFact` already does.
- **A tombstone blocks a fact the owner types:** 409 duplicate; the owner rewords it.

---

## Testing

Against the real test database, as every API slice.

- **Migration:** on a database holding facts and ingestions, every existing fact becomes
  `UNTRACKED` and every existing ingestion `tracked = false`; no other column changes; no row lost.
- **Remove source:** deletes its live and pending facts and their embeddings; keeps its rejected
  facts, unlinked; leaves another source's, `OWNER` and `UNTRACKED` facts alone; returns the count;
  409 while queued or running.
- **Edit:** sets `OWNER` and unlinks; writes the tombstone only when the normalised claim changed;
  a re-run of the source does not bring the old wording back.
- **Add fact:** live at once; duplicate and tombstone clash are 409.
- **Recheck:** 409 while busy, 400 for pasted text, new facts carry the `ingestionId`.
- **Worker:** rows carry `ingestionId` and `EXTRACTED`.
- **Never-say:** length, line break, limit and duplicate rules; a hostile phrase is escaped in the
  prompt.
- **Withdraw:** pinned answer gone, question unanswered, FAQ route 404s, slug kept.
- **Authorisation:** every new route is a 404 for another account's item.
- **Screen:** each tab's list, empty state, confirmations, error-in-place with focus kept, the
  sidebar change, and the tab in the URL. Every component with a hook carries `'use client'`, and a
  dev page is curled once they are added.

**Mutation checks** — each must turn a test red: drop the `rejectedAt IS NULL` filter on source
removal; drop the old-wording tombstone; drop the busy guard; drop the never-say escaping; drop
`answered = false` on withdraw; drop the `accountId` scope on one new route.

---

## Build order

1. Migration, and the worker writing `ingestionId` and `origin`.
2. Fact service: remove source, edit rules, add fact, recheck. Routes.
3. Never-say service, routes and prompt escaping.
4. Withdraw a pinned answer.
5. The Knowledge screen, tab by tab, and the sidebar.
6. Docs.

---

## Done means

The owner can, on a phone and a laptop: remove a source and see its facts go; check a link for new
facts and find them in Review; add, edit and remove a fact; withdraw a pinned answer and find its
question back on Questions; add and remove never-say entries. Facts from before this slice are
listed under Before tracking and removable one by one. The mutation checks each turn a test red, the
workspace gates pass uncached and one at a time with their exit codes checked, and a real-browser
pass has been done on a dev page.

---

## Documents corrected by this slice

- **FRONTEND.md** — `/app/knowledge` becomes real, with its four tabs; the sidebar loses Add a
  source.
- **BACKEND.md** — source tracking (`Fact.ingestionId`, `origin`, `Ingestion.tracked`); the new
  routes; the never-say rules and escaping; withdraw.
- **slice-13-build-spec.md** — the "Removing a source" out-item points here.
- **A manual-verification checklist** for Knowledge, alongside the existing ones.

---

## Revisions during planning (2026-09-28)

1. **An owner's own words override a tombstone.** "Adding a fact" and "Editing a fact" said a clash
   with a tombstone is a 409 the owner fixes by rewording. That made A → B → A impossible and made a
   claim once rejected in Review impossible to type in. Instead a rejected row holding the same
   normalised claim is deleted in the same transaction; the owner's fact then holds the key, so a
   re-read still skips it. Only a live clash is `409 FACT_DUPLICATE`.
2. **Re-check enqueues under a fresh job id** (`<ingestionId>-recheck-<ms>`): the ingest queue keeps
   completed jobs and BullMQ ignores an add whose id it holds. A failed enqueue marks the row
   FAILED so it is not stuck "Reading…".
3. **`POST /facts` is exempt from the `:id` route guard** in `fact.routes.test.ts`, by exact line,
   with a behavioural test that creating a fact verifies no other.
4. **Never-say also refuses control characters** and is flattened to one line in the prompt, which
   covers rows written before the API existed.

5. **The shared Button (`packages/ui`) changed.** A plain `type="button"` Button that is `busy` sets
   `aria-disabled` and ignores clicks instead of going natively disabled, so focus stays where the
   owner pressed; a busy `type="submit"` Button stays natively disabled (forms rely on it against a
   double post). Button also forwards `aria-label`.
6. **Dates on the Sources tab are formatted in Asia/Kuala_Lumpur**, as lead-list does, so the
   server and browser renders agree.
7. **When adding a fact or a never-say entry fails, focus returns to the field** (the natively
   disabled submit button drops it).
8. **The never-say limit message reads "You have reached 50. Remove one first."** — the API's
   no-contraction house style — rather than "You've reached 50 — remove one first".
