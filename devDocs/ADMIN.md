# ADMIN.md

> Intended path: repo root. Screens in `apps/web/app/admin`, routes in `apps/api/src/modules/admin`.

The operator surface. Not a product, not a dashboard, and not for customers.
It exists because three things in BACKEND.md require a human and were never
given anywhere to stand: SSM documents that fail auto-approval, takedown
reports, and handle claims that hit the trademark list.

---

## The one rule

**Reading a person is an event.**

Aggregates are free. Cost, counts, queue depth, cache hit rate — look at those
all day. But a phone number, a transcript, or an SSM document is a person, and
every time admin renders one it writes a row saying who looked, at what, and
why.

Corollary for engineering: there is no screen that shows PII without a reveal
action in front of it, and no code path that reveals before its audit row is
committed. Committed first, not alongside — a crash mid-reveal should leave a
record that someone looked, not a gap. If you find a path that does otherwise,
it is a bug, not a shortcut.

---

## Operators

Named accounts with roles, not a shared token.

This diverges from the post generator deliberately, so do not "simplify" it
back. That product's admin guards cost metrics and job replay, where one
operator and an env var is proportionate. This one opens documents carrying an
IC number and a home address. *Who looked at this* stops being a nicety the
moment that is true, and retrofitting attribution after an incident is not
possible — the rows you needed were never written.

```prisma
model AdminUser {
  id          String     @id @default(cuid())
  email       String     @unique
  name        String
  role        AdminRole
  totpSecret  String?                  // required before first privileged action
  disabledAt  DateTime?
  lastLoginAt DateTime?
  createdAt   DateTime   @default(now())
}

enum AdminRole { OWNER REVIEWER SUPPORT }
```

| Role | Sees | Can do | Lands on |
|---|---|---|---|
| `OWNER` | everything | everything, plus manages `AdminUser` rows | `/admin` |
| `REVIEWER` | the three queues | approve, reject, uphold, dismiss. no margin, no lead PII | `/admin/verification` |
| `SUPPORT` | pages, conversations, leads | reveal with a reason. cannot decide a queue | `/admin/pages` |

The landing column is not a detail. `/admin` is the margin screen and a
`REVIEWER` cannot see it, so a role-blind redirect after login sends two of
three roles to a 403 on every sign-in.

The split is the point. Someone reviewing SSM documents has no business reading
lead phone numbers, and someone answering "my lead never arrived" has no
business approving a badge.

**Separate from customer auth.** `AdminUser` is its own table, not a column on
`Account`. A role flag on the customer model means a privilege escalation path
runs through the same login every visitor's owner uses. Admin sessions are their
own cookie, their own TTL (8 hours, no refresh), and 2FA is not optional.

Routes stay unregistered when admin is not configured, so a deployment that
forgets its env exposes nothing rather than everything.

---

## The audit log

```prisma
model AuditLog {
  id          String      @id @default(cuid())
  adminUserId String
  action      AuditAction
  targetType  String       // "Page" | "Lead" | "Message" | "VerificationRequest"
  targetId    String
  reason      String?      // required, and enforced, for every REVEAL_*
  metadata    Json?
  ip          String
  createdAt   DateTime     @default(now())

  @@index([targetType, targetId])
  @@index([adminUserId, createdAt])
}

enum AuditAction {
  REVEAL_LEAD_PHONE
  REVEAL_TRANSCRIPT
  REVEAL_VERIFICATION_DOCUMENT
  VERIFICATION_APPROVE
  VERIFICATION_REJECT
  TAKEDOWN_UPHOLD
  TAKEDOWN_DISMISS
  HANDLE_APPROVE
  HANDLE_REJECT
  PAGE_UNPUBLISH
  ADMIN_CREATE
  ADMIN_DISABLE
  ADMIN_ROLE_CHANGE
}
```

The three queues get three tables — `VerificationRequest`, `TakedownRequest`,
`HandleReview` — each carrying its own status enum, the deciding `adminUserId`,
a decision timestamp, and a reason string that is required on every terminal
state. They are listed rather than specified here for the same reason
BACKEND.md names most of its models and only writes out `Fact`: the shape is
ordinary, and the constraints below are what actually matter.

Append only. No update route, no delete route, no admin screen that offers
either. Written by the service layer as a side effect of the action, never by a
caller who might forget.

**Retention is 24 months, not 12.** BACKEND.md keeps `Lead` and `Message` for
twelve. The record of who accessed those rows has to outlive the rows
themselves, or a breach discovered in month thirteen is uninvestigable. Audit
data is not customer data and does not expire with it.

---

## Screens

```
/admin                  margin. the landing screen, because it is the question.
/admin/pages            page list, searchable, sorted by margin ascending
/admin/pages/[id]       one page: facts, conversations, cost, enforcement actions
/admin/verification     SSM queue
/admin/takedowns        takedown queue
/admin/handles          trademark-blocked handle claims
/admin/audit            the log. read only.
/admin/staff            AdminUser management. OWNER only.
```

`admin` is already on BACKEND.md's reserved handle list, so the path is claimed
and cannot collide with a page.

---

## Margin

One question: **which pages cost more than they pay.**

At Curios' margins that is not a vanity metric. README commits to inference as a
cost of acquisition, with free pages getting a real AI. That model works right
up until a handful of pages make it not work, and `ModelCall` is the only place
that shows it.

| Column | Source | Why it is here |
|---|---|---|
| handle, plan | `Page`, `Account` | who |
| conversations | `UsageCounter` | volume against cap |
| cost | `sum(ModelCall.costMilliCents)` | what they actually cost |
| margin | plan price − cost | the answer |
| cache hit rate | `cacheReadTokens / inputTokens` | the fixable one |

Sorted worst margin first. A page at the bottom of this list is either priced
wrong, being abused, or missing prompt cache — and cache hit rate tells you
which without opening anything.

Cache hit rate earns its column because of a specific trap: prompt caching has a
~1024 token minimum prefix. A page with 30 facts can fall under it and silently
cache nothing, so its cost per conversation is several times a comparable page's
for a reason invisible everywhere else in the product.

Costs are stored in milli-cents and rounded once, at render.

---

## Queue: SSM verification

BACKEND.md: auto-approve on a high-confidence name match, queue the rest for a
human. Because the badge gates nothing, the queue only ever contains people who
opted in, so it stays small by construction.

**The sharp edge.** BACKEND.md says delete the document once extracted, and says
it is not optional. A human reviewer has to see it. Both are correct, so the
rule is time, not exemption:

1. The R2 object survives only until a decision, never past it.
2. A hard **7 day TTL**. On expiry the request auto-rejects with a plain reason
   and the object is deleted regardless of queue depth. An unreviewed cert does
   not sit in a bucket because someone was on leave.
3. The reviewer sees it through a signed URL, five minute expiry, rendered
   inline. No download, no proxy that caches, no attachment in an email.
4. Opening it writes `REVEAL_VERIFICATION_DOCUMENT` with a reason.
5. On decision, keep the number, the registered name, and a timestamp. Delete
   everything else.

**Deletion cannot be transactional, so do not write it as if it were.** R2 is a
network call and Postgres cannot roll it back. The order is: null `documentKey`
and record the outcome in one database transaction, then enqueue the object
delete. The row stops pointing at the file before the file goes, so a crash
between the two leaves an orphan rather than a live reference to a document the
system believes is gone.

That orphan is the failure this design accepts, so it needs a sweeper: a daily
job deletes R2 objects under the verification prefix with no `documentKey`
referencing them. Without it, "we delete the file" is true of the happy path
only, and the happy path is not what a PDPA question is about.

Rejections carry one plain reason and permit a retry. Never a queue with no
feedback.

The badge renders `SSM 20XXXXXXXXXX` with the registered name. Approving does
not mean we verified a company exists — it means a human read a document that
said so. The wording has to stay true to that, and a bare tick is not.

---

## Queue: takedowns

Every page footer links a public takedown form, so this endpoint is
unauthenticated and writes to a table. Rate limit it by IP, and expect it to be
used as a weapon between competing shops in the same market.

Outcomes are `UPHELD` or `DISMISSED`, both requiring a reason, and upheld
unpublishes the page rather than deleting it. Deletion destroys the evidence for
the decision that was just made.

The owner is told what happened and on what ground. A page that goes dark with
no explanation produces a support thread that costs more than the review did.

---

## Queue: trademark handles

The only hard gate in the product. BACKEND.md is explicit that verification
gates nothing functional and a paying customer with no SSM keeps every feature —
but a handle matching the trademark seed list stays blocked until reviewed,
paid or not.

Approve releases the handle to the claimant. Reject releases it back to the
namespace. Neither is reversible once someone else claims it, which is the
reason this is a queue and not a heuristic.

---

## PII

Default state everywhere: `+60••••••89`, transcript collapsed to turn count and
timestamps, lead slots shown as filled-or-not rather than as values.

Revealing is an action with a reason field that is required and stored. It
reveals one record, not a page of them, and it expires with the screen — there
is no "show all" and no session-wide unlock.

BACKEND.md already forbids full phone numbers in application logs. That
principle was never about logs specifically; the screen is the larger exposure,
because a log is read by machines and a screen is read by whoever is standing
behind someone at a coffee shop.

Curios is a processor here. These numbers belong to the page owner's customers,
and the owner is the controller. Admin's access to them is a support capability,
not an entitlement.

---

## What admin must never do

Delete on sight, same as DESIGN.md's list:

- **Log in as an owner.** The most requested support feature and the worst one.
  It makes every action in that session unattributable and every reassurance
  about privacy false. If you need to see what they see, ask them.
- Edit a customer's facts, links, or answers on their behalf. Support explains.
  Enforcement unpublishes. Neither reaches into someone's page and types.
- A big number on a card with no action attached to it. Total signups is not a
  decision.
- A chart nobody has acted on in a month.
- Bulk approve, bulk reject, bulk anything on a queue where each item is a
  person's document.
- A route that writes to `AuditLog` directly, or one that deletes from it.
- Real time updates. This is a tool someone opens deliberately, not a wall
  display.
- Exporting leads or transcripts to CSV. There is no legitimate operator need
  and it converts a PDPA-scoped table into a file on a laptop.

---

## Design

DESIGN.md applies unchanged. Same tokens, same type scale, same motion budget,
same banned list. Admin is not exempt from being a good screen.

The accent mapping carries over cleanly: `kuning` means a human needs to act, so
in admin it means exactly one thing — a queue item waiting on a decision. Queue
depth is the only place it appears. `merah` stays destructive-only, which here
means reject, uphold a takedown, and disable an admin.

Every number is mono. Costs, counts, timestamps, queue depths.

Empty queues are the goal, so state them as such: "No pending verifications."
Not an illustration, not a celebration.

No dark mode. Same reasoning as everywhere else, and no operator asked either.

---

## Definition of done

An SSM document that fails auto-approval reaches a named reviewer, is opened
under a signed URL that expires, is approved or rejected with a reason, stops
being referenced the moment that decision is recorded, is gone from R2 shortly
after, and the audit log can tell you six months later exactly who read it.

Margin is second. Everything else on this page is third.

---

## Not slice 1

This surface is specced now because BACKEND.md created the obligation and left
it homeless, not because it is next. Nothing here ships before the ingest →
page → chat slice does. The one thing that reaches back into that slice is
`ModelCall`, which has to be written from the first Haiku call or the margin
screen has no history to show when it arrives.
