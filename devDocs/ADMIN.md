# ADMIN.md

> Screens in `apps/admin`, routes in `apps/api/src/modules/admin`, reads in `packages/db-read/src/admin`.
> The design and the decisions behind it are in `devDocs/admin-design.md`; this is the standing rule
> book. Where the two disagree, `admin-design.md` wins.

The operator surface. Not a product, not a dashboard, and not for customers.
It exists because Curios is run by one person who should not have to open the
database to see how it is doing, or to act on a page reported as a scam, a
payment that failed, or a price that has to change, and because every one of
those actions has to leave a record of who did it and why.

Built in four parts, all of them now: Overview, Pages and the Audit log, then
Reports, Controls, AI & usage, Reading sources and Payments. A section that is
not built is absent from the nav, not shown disabled.

---

## The one rule

**Reading a person is an event.**

Aggregates are free. Cost, counts, queue depth, cache hit rate: look at those
all day. But a phone number, a transcript, or a customer's name is a person, and
every time admin renders one it writes a row saying who looked, at what, and
why.

In part 1 the only screen that shows anything about a person's customers is See
it as the owner, and it shows them masked (see PII). Its row, `VIEWED_AS_OWNER`,
carries the reason, and the view renders only while that row is less than 15
minutes old. Committed first, not alongside: a crash mid-view should leave a
record that someone looked, not a gap. A direct visit to the address with no
recent row shows nothing and goes back to the page's panel.

Corollary for engineering: there is no screen that shows personal details
without a logged reason in front of it, and no code path that shows them before
its audit row is committed. If you find a path that does otherwise, it is a bug,
not a shortcut.

---

## The admin app

A separate Next.js app, `apps/admin`, deployed to its own subdomain
(`admin.curios.my`) and run locally on port 3002 as part of `pnpm dev`. There is
no `/admin` on curios.my and owners never receive admin code.

- **Reads** go through `@curios/db-read/admin`, an entry the owner app never
  imports, on the read-only database role. The admin app cannot write to the
  database.
- **Writes** go through the API's `/admin` routes. They are registered only when
  `ADMIN_ORIGIN` is set, and CORS allows that origin for `/admin` alone, so a
  deployment that forgets its env exposes nothing rather than everything.
- The pages' `requireAdmin()` is the real gate. The middleware only checks that
  the cookie is present.

---

## Operators

Named accounts, not a shared token.

Do not "simplify" this to a shared bearer token in an env var. That is a
reasonable design for an admin surface guarding cost metrics, where the worst
case is someone reading a number. This one can suspend a page, delete an account
and give away a month of a paid plan. *Who did this* stops being a nicety the
moment that is true, and retrofitting attribution after an incident is not
possible: the rows you needed were never written.

```prisma
model AdminUser {
  id           String    @id @default(cuid())
  email        String    @unique
  name         String
  passwordHash String
  role         AdminRole // OWNER, the only value for now
  disabledAt   DateTime?
  lastLoginAt  DateTime?
  createdAt    DateTime  @default(now())
}

model AdminSession { /* id, adminUserId, expiresAt, createdAt, ip */ }
```

One role, `OWNER`, for now. A teammate later is a new row, not a code change; a
reviewer or support role comes when there is a second person to give it to.

**Separate from customer auth.** `AdminUser` is its own table, not a column on
`Account`. A role flag on the customer model means a privilege escalation path
runs through the same login every visitor's owner uses. The admin session is its
own cookie (`curios_admin`), its own table, its own TTL (8 hours, absolute, no
sliding refresh), httpOnly, SameSite strict, Secure in production. Owner routes
ignore it and admin routes ignore the owner's `curios_session`.

Owners sign in with Google. Admins do not, and that is the point: admin shares
no identity provider, no cookie, and no code path with the customer flow, so a
failure or compromise in either one cannot reach the other. Admin sign-in is
email and password with argon2id (the owner app's helper), rate limited, and one
message, `Wrong email or password.`, for a wrong password, an unknown address and
a disabled admin, so the form cannot be used to discover who has an account.

**TOTP is deferred.** Part 1 is email and password only. `AdminUser` has room to
grow a secret later; nothing is built for it yet, and adding it is the first
thing to do before a second admin is added.

**No sign-up.** Admins are created by a command, never self-registered. The same
command resets a password (see OPERATIONS.md).

---

## The audit log

`AdminAction`: id, adminUserId, action, targetType, targetId, `targetLabel` (the
handle, kept so a deleted page's rows still read), `reason`, metadata, ip,
createdAt. The actions are `SIGNED_IN`, `SUSPENDED_PAGE`, `UNSUSPENDED_PAGE`,
`GRANTED_MONTH`, `RESET_CONVERSATIONS`, `DELETED_ACCOUNT` and `VIEWED_AS_OWNER`;
later parts add `DISMISSED_REPORTS`, `EMAILED_OWNER`, `TURNED_OFF`, `TURNED_ON`,
`CHANGED_LIMITS`, `SHOWED_BANNER`, `TOOK_BANNER_DOWN`, `REPLAYED_WEBHOOK`,
`RETRIED_SOURCE` and `RETRIED_FAILED_SOURCES`.

Every action that changes something takes a reason, 1 to 500 characters,
required. Deleting an account also takes the page's handle, typed out.

Append only. No update route, no delete route, no admin screen that offers
either. **Written by the service layer in the same transaction as the change**,
never by a route and never by a caller who might forget; a change that rolls
back leaves no row, and a row never exists for a change that did not happen.

The screen shows when (Malaysia time), who, what, which page (or `everyone`) and
the reason, newest first, 100 at a time with an Older link. No export.

**Retention is 24 months, not 12.** BACKEND.md keeps `Lead` and `Message` for
twelve. The record of who looked at those rows has to outlive the rows
themselves, or a breach discovered in month thirteen is uninvestigable. Audit
data is not customer data and does not expire with it.

---

## Screens

```
Look     Overview        the figures, what needs you, new pages
         Pages           search and filter, a side panel, the actions
         AI & usage      cost, speed and what the chat could not answer
Run      Reading sources what was read, what failed, retry, pause
         Payments        plan payments, and the CHIP webhook log
         Reports         pages visitors reported
Change   Controls        the five switches, limits and prices, the banner
         Audit log       the record. read only.
```

Overview and Pages come from the board (`design/boards/Admin.dc.html`); the
places the build departs from it are in `design/DEVIATIONS.md`. The board's
sections took the place of this document's earlier margin-first screen list: the
question the margin screen asked, which pages cost more than they pay, comes
back as cost in AI & usage, from `ModelCall`, which has to be written from the
first model call or that screen has no history.

**Reports** replace the earlier takedown queue. A public "Report this page" link
in a page's footer opens a form (five reasons and an optional note, EN and MS),
rate limited by IP with the IP stored hashed. The list is one row per page, not
per report: its number of open reports, the most common reason, the newest
note, and Dismiss, Email owner and Suspend page, each acting on all of that
page's open reports at once. **Reports never act on a page by themselves.** More
than 5 open reports (6 or more) flag a page, in Reports, Pages, "Needs you" and
the nav count; it stays live and indexed until an admin suspends it by hand.
Dismissing its reports clears the flag. Suspending does not delete; deletion
destroys the evidence for the decision that was just made. The owner is never
told who reported.

**Controls** holds five switches, the limits and prices, and the banner. Every
change asks for a reason and writes an audit row. Turning a switch off is a
decision to stop, not to hold: nothing is queued to send later.

| Switch | Off stops | Off does not stop |
|---|---|---|
| Chat answers | Every page gives the short fixed reply (the one used past the cap), the owner's Ask your page tester included, and the order lookup in chat gives the same reply. No conversation is counted against the cap while it is off | Grouping questions: it is owner-side housekeeping, keeps running and retries on failure |
| Sign-ups | New owner sign-ups: the sign-up screen says Curios is full for now | Existing owners signing in |
| Reading new sources | New reads: the ingest queue is paused, owners can still add sources and those wait, and owner re-reads and admin retries are refused. Reading sources' Pause / Resume the queue is this same switch | Reads already running; adding sources |
| CHIP payments | Every CHIP purchase Curios would raise: plan payments, shop online payments, the shop connection's RM1 "Curios test", and auto-renew, which is re-checked before each charge. Billing shows "Online payments are paused for a moment" | Shops' own QR and bank transfer |
| Emails to owners | Notification emails to owners. They are dropped, not held | Admin's own mails (suspend, bring back, report warning), which go because the admin chose to send them, and sign-in, verification and password reset mail |

The switches are read again where they apply, including inside a running job,
so a switch changed mid-run takes effect without a restart.

Limits (the cap, free leads, free orders) and prices (monthly, yearly) are saved
with a confirm and a reason. They are live within about 30 seconds: the API
caches settings for 30 seconds and clears the cache on save, and the web reads
them per request, with the landing and legal pages revalidating every 30
seconds, so a changed price reaches every page within a minute at the
outside. The constants in `packages/core` are only the defaults for a setting
that has never been saved. The yearly saving ("two months free") and Business's
"One RM95 order pays for it" tag are worked out from the prices in force and
drop out when they would no longer be true. The Terms promise that a change
never takes away time already paid for, and no warning email goes out.
**The Controls page will not show a form if it cannot read the stored settings.**
A form full of defaults would look saved, and saving it would overwrite the
real prices; it shows an error instead.

The banner is up to 160 characters, shown first on every owner's dashboard
until taken down.

**AI & usage** is read from `ModelCall`: calls, typical and slow answer time,
cost per conversation, the "I'm not sure" rate, failed calls, cost by job
(Answering visitors, Reading sources into facts, Grouping questions; embeddings
and lead summaries write no rows, so they are not listed), recent "I'm not sure"
questions with the page and the time but no reply and no visitor, and pages near
the cap. Cost is in US dollars, as on the Overview.

**Reading sources** is read from `Ingestion`: waiting, reading, failed and
typical time, with the error text on each failed source. Retry, and Retry all
failed (sources that are walled, such as Instagram, are skipped). The count in
the nav is sources that failed today.

**Payments** shows plan payments through Curios's own CHIP account, in RM, with
how each was paid (`Payment.paidVia`, stored from now on, "—" before). No refund
is recorded anywhere, so there is no refunded figure. Shop orders paid online
are owners' money: a count for scale, never summed into revenue. The webhook log
records CHIP's callback and webhook messages, one row per message and purchase
with its attempts counted, and the nav count is failed messages in the last 24
hours. **Replay** re-runs the stored message through the same handler, which is
idempotent, without re-checking a signature that already passed when the row was
stored. A replay's grant cannot share the audit row's transaction, because the
handler asks CHIP about the purchase over the network before it grants: the
grant commits first, then the attempt and the `REPLAYED_WEBHOOK` row together,
and if that second write fails the API logs the event, purchase and payment ids
at error level. The body of a message holds the payer's name and email, so the
read-only role cannot read `ChipWebhookEvent.body`.

The SSM verification and trademark-handle queues this document once described
are not part of this design. If the badge or the trademark gate comes back it
comes back as its own section with its own rules.

---

## PII

Default state everywhere: `+60••••••89`, customer and lead names to initials
(`Aisyah Rahman` is `A. R.`), a conversation as a count and times with no
message text, no receipts, no addresses, no customer emails. A lead has no name
to show, only the masked phone, the time and which slots it filled.

See it as the owner is the one place this matters in part 1: a read-only summary
of the owner's page, with a reason, masked as above. It reveals nothing the
masking hides, and there is no "show more" and no session-wide unlock.

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

- **Log in as an owner, or act as one.** The most requested support feature and
  the worst one. It makes every action in that session unattributable and every
  reassurance about privacy false. The allowed version is See it as the owner: a
  read-only summary, personal details masked, a reason logged first, no button
  that changes anything, and an API that refuses writes from it. If you need
  more than that, ask the owner.
- Edit a customer's facts, links, or answers on their behalf. Support explains.
  Enforcement suspends. Neither reaches into someone's page and types.
- A big number on a card with no action attached to it. Total signups is not a
  decision.
- A chart nobody has acted on in a month.
- Bulk anything on items that are each a person's.
- A route that writes to `AdminAction` directly, or one that deletes from it.
- Real time updates. This is a tool someone opens deliberately, not a wall
  display.
- Exporting leads, transcripts or the audit log to CSV. There is no legitimate
  operator need and it converts a PDPA-scoped table into a file on a laptop.

---

## Design

DESIGN.md's discipline applies: same type scale, same motion budget, same banned
list. Admin is not exempt from being a good screen. Its look is the board's, not
the owner app's: a dark sidebar, an amber "Production" strip on every screen,
the admin's name at the bottom. It is admin-only CSS in `apps/admin`.

Every number is mono or tabular. Empty states are stated as such, plainly:
"Nothing needs you." Not an illustration, not a celebration. English only.

---

## Definition of done

An admin signs in with their own email and password, sees what needs them,
suspends a page, gives a month of Business or deletes an account with a reason,
and the audit log can tell you six months later exactly who did it, when, to
which page, and why, with no way for that row to have been edited or to have been
missing.
