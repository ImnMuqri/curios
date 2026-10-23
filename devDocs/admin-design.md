# Admin (Curios team only): design

Status: design, 23 Oct 2026. Build source: `design/boards/Admin.dc.html` and HANDOFF "Admin
(Curios team only), 23 Oct 2026" (on `origin/design-update-shopfront`, commit 0ae6f37). Where
this document and the board disagree on behaviour, this document wins; on look and copy, the
board wins. It supersedes `devDocs/ADMIN.md` where the two disagree (listed under "Changes to
ADMIN.md").

## Why

Iman runs Curios alone today and has no way to see how it is doing or act on a problem without
opening the database: a page reported as a scam, a CHIP webhook that failed, sources that could
not be read, AI cost creeping up, a price that needs to change. Admin is the place to do that, and
to have a record of what was done and why.

Success: Iman signs in at the admin site, sees what needs him on the Overview, and can suspend a
page, give a month of Business, change a price or turn off chat during an outage, with every
change written to an audit log with his name and his reason.

## Decided (by Iman)

- **Its own site.** A separate app in this repo, deployed later to its own subdomain (e.g.
  `admin.curios.my`). Run locally on its own port until then. Owners never receive admin code
  and there is no `/admin` on curios.my.
- **Its own sign-in.** Admin users are their own table, not a flag on owner accounts. Email and
  password, not Google. No sign-up: admins are added by a command, never self-registered. One
  admin today (Iman); a teammate later is a new row, not a code change.
- **No authenticator code for now.** Email and password only. Leave room to add TOTP later
  (a nullable column is fine), but do not build it.
- **Every change asks for a reason and writes an audit row** (who, what, which page, reason,
  when). Deleting an account also needs the handle typed out. (From the board.)
- **Prices and limits are live and adjustable from admin**: monthly and yearly price, the
  conversation cap (200), free leads (3), free orders (3). A change shows everywhere: landing,
  Billing, Terms, Refund, emails, the API's enforcement.
- **A price change applies to the next payment, including card auto-renewals, with no warning
  email.** The Terms (EN and MS) get a line saying prices can change and that auto-renew
  charges the price at the time of renewal.
- **Built in four parts**, each usable on its own, in this order:
  1. Sign-in, the shell, Overview, Pages (with suspend, delete, a month of Business, reset
     conversations), and the Audit log.
  2. Reports, including the public "Report this page" link.
  3. Controls: kill switches, live prices and limits, the owner banner.
  4. AI & usage, Reading sources, Payments (with the webhook log).

## Builder's calls already made (by the controller; Iman can overrule)

- A change to a price or limit takes effect for the next payment or the next month. Anyone
  already paid keeps what they paid for until their period ends.
- Lowering a free allowance never takes back what was already used: an owner who used 3 free
  leads is not marked over the limit after the fact.
- Admin sessions: their own cookie name, their own table, 8 hours, no sliding refresh. Owner
  routes never accept an admin session and admin routes never accept an owner session.
- Sign-in says the same thing for an unknown email and a wrong password, and is rate limited.
- Passwords hashed with the same argon2id helper the owner app uses
  (`apps/api/src/modules/auth/password.service.ts`).

- **Delete account deletes the whole `Account`** (login, identities, sessions, password, its
  page). An account has one page (`Page @@unique([accountId])`), so the handle typed is that
  page's. The same email can sign up again afterwards.
- **A granted month is its own `Payment` row**: provider `GRANT` (new enum value), amount 0,
  status PAID, `grantedUntil` set the same way a real payment sets it, so later real payments
  extend from the right base. Revenue and "Paying for Business" exclude `GRANT`; a page is
  "paying" when a non-grant PAID payment covers now.
- **Suspended means nothing public works** for that page: the page, chat, lead and order forms,
  FAQ pages, shop, sitemap and search. A customer's existing order page (`/[handle]/order/[token]`)
  stays reachable, so people who paid can still see their order.
- **"CHIP payments" off also pauses the auto-renew job** (it skips and tries again when the switch
  is back on). "Reading sources" off also blocks owner-started re-reads and admin retries.
- **Prices are entered in whole RM, stored in sen.** Monthly and yearly are separate settings, as on
  the board. The confirm shows old → new. No scheduling. A price over RM999 or a change of more
  than half asks a second time ("That's a big change. Save it anyway?").
- **Pages that print prices or limits read them per request** through the API's cached accessor
  (short TTL), not at build time.
- **Answered-from-facts and the unsure rate count from when they are first stored.** If the unsure
  marker is not stored today, part 1 adds a column and the figures show "—" for periods before it.
  No backfill.
- **The admin app reads and writes the way `apps/web` does**: reads through `@curios/db-read` (a
  separate `@curios/db-read/admin` entry the owner app never imports, on the read-only role),
  writes through the API. (Changed from "API only" while planning, to match the codebase.)
- **IP and rate limits mirror the owner API** (`resolveTrustProxy` and `@fastify/rate-limit` in
  `apps/api/src/app.ts`).

## Architecture

- **`apps/admin`**: a new Next.js 15 / React 19 app (same stack, CSS Modules, Vitest), port
  3002 in dev, added to `pnpm dev` and the turbo pipeline (typecheck, lint, test, build).
  It reuses `@curios/core` and `@curios/ui` tokens where they fit; the board's own look (dark
  sidebar, amber "Production" strip) is admin-only CSS in the admin app.
- **The API stays one API.** Admin routes live in `apps/api/src/modules/admin`, under
  `/admin/*`, each behind the admin-session guard. Business rules stay in one place (e.g.
  "suspended pages don't chat" is enforced in the chat module, not in admin).
- **Admin routes are not registered unless `ADMIN_ORIGIN` is set**, so a deployment that forgets
  its env exposes nothing. CORS allows `ADMIN_ORIGIN` for `/admin/*` only.
- **Session transport is the builder's call**, within these limits: the admin cookie is
  httpOnly, Secure in production, SameSite strict, never sent to or read by owner routes,
  and must reach the admin app's server components (as the owner cookie reaches `apps/web`'s).
  Check how `apps/web` forwards `curios_session` and mirror it.
- **The audit row is written by the service layer, in the same transaction as the change.** No
  route writes to the audit table directly; there is no update or delete route for it.
- New env: `ADMIN_ORIGIN`, plus whatever the admin app needs to reach the API. Add to
  `.env.example`. (Memory: a stale `.env` crashes the API silently, so the API must start
  cleanly when `ADMIN_ORIGIN` is missing.)

## Data (new and changed)

- `AdminUser`: id, email (unique), name, passwordHash, role (enum, only `OWNER` for now),
  disabledAt, lastLoginAt, createdAt.
- `AdminSession`: id (random, hashed or opaque like `Session`), adminUserId, expiresAt,
  createdAt, ip.
- `AdminAction` (the audit log): id, adminUserId, action (string or enum), targetType,
  targetId, targetLabel (e.g. the handle, kept so a deleted page's rows still read), reason
  (required for every change), metadata (Json), ip, createdAt. Append only.
- `Page.suspendedAt`, `Page.suspendReason` (part 1).
- `Report` (part 2): id, pageId, reason category, details, reporter IP hash, createdAt,
  status (open / dismissed / acted), decidedBy, decidedAt. Flagged is derived from the open
  count, not stored.
- `SystemSetting` (part 3): key/value (Json), updatedAt, updatedBy. Holds the switches, prices,
  limits and banner.
- A webhook event log (part 4): provider, event id, purchase id, raw body or the fields needed
  to replay, received at, outcome, error, attempts.
- **Payment and account deletion.** `Payment.pageId` is `onDelete: Restrict` today, so deleting
  a page with payments fails. Deletion must keep payments as financial records: make the
  relation nullable with `SetNull` and snapshot what a payment needs to stay readable (handle,
  owner email) on the payment row. Migration hand-written, like the others.
- A command to create an admin: `pnpm --filter @curios/api admin:create <email> <name>`, reading
  the password from a prompt (not an argument).

## The sections

Copy, layout and states from the board. Behaviour:

### Part 1

- **Sign-in page.** Email, password, one generic error. No "forgot password" (an admin resets by
  running the command again with a new password; say so in the command's help, not on the page).
- **Shell.** Dark sidebar (Look: Overview, Pages, AI & usage; Run: Reading sources, Payments,
  Reports; Change: Controls, Audit log), the amber "Production" strip on every screen, the
  signed-in admin's name at the bottom. Sections from later parts are absent until built, not
  shown disabled. Works on a phone (the board's 390 screen).
- **Overview.** Period: Today, 7 days, 30 days. Figures:
  - Live pages: published and not suspended. "+N this period" counts new ones.
  - Paying for Business: pages whose plan is active through a real payment, not a granted month.
  - Business revenue: sum of paid plan payments in the period (RM).
  - Conversations: count in the period, and the change against the period before.
  - Answered from facts: share of the page's replies that cited at least one fact; the board's
    "N% got 'I'm not sure'" from the unsure marker (`apps/api/src/modules/chat/unsure.ts`). How
    an unsure reply is recognised after the fact is the builder's to find; if it is not stored,
    store it going forward and say so.
  - AI cost: sum of `ModelCall.costMilliCents` in the period, and cost per conversation. Check
    the unit (USD or RM) and label it truthfully.
  - Conversations a day chart (7 bars, today highlighted).
  - "Needs you": only items whose part is built (part 1: failed reads, pages at the cap, plans
    ending this week; reports and webhooks join in parts 2 and 4). Each links to its section.
  - New pages (newest first), Pages by kind (Personal vs Business).
- **Pages.** Search by handle, name or owner email; filters All, Business, Personal, Lapsed,
  Hidden or suspended. Side panel: owner email, sign-in method (Google / password), plan, paid
  until, conversations this month against the cap, fact count. Actions:
  - Open page (the public URL, new tab).
  - Give one month of Business: extends `paidUntil` by a month from the later of now and the
    current `paidUntil`. Not a payment, not revenue; recorded as an audit row (and marked so
    "Paying for Business" does not count it).
  - Reset this month's conversations: the current period's `UsageCounter` to 0, and its cap
    mail flag cleared so a later cap mail can go again.
  - Suspend / bring back: public page shows "This page is unavailable" (EN and MS), chat stops
    (the API refuses chat for a suspended page), the page is not indexed, the owner can still
    sign in, sees why on their dashboard, and is emailed the reason. Bringing back undoes all of
    it straight away.
  - Delete account: type the handle to confirm; page, facts, leads, orders and stored files go
    (files best-effort after the transaction); payments stay. A stored CHIP renewal card is
    forgotten. Sessions end.
  - See it as the owner (decided by Iman): opens the owner's dashboard read-only in the admin
    app, logged with a reason. Personal details are masked: leads' and orders' phone numbers as
    `+60••••••89`, customer names to initials, conversations as counts and times only, no
    receipts. Facts, links, items, settings and plan show as the owner sees them. Every action
    button is absent or disabled; the API refuses writes from this view.
- **Audit log.** Newest first: when, who, what, target, reason. Read only, no export.

### Part 2: Reports

- A "Report this page" link in the public page footer (EN and MS), opening a short form: a reason
  (categories from the board if it lists them; otherwise scam, wrong or misleading, offensive,
  something else) and optional details. No sign-in. Rate limited by IP; the IP is stored hashed.
- Admin list: open / done filter, each report with the page, reason, count today. Actions:
  Dismiss, Email owner (a fixed template with the reason, logged), Suspend page (the part 1 flow).
- **Nothing happens to a page automatically (decided by Iman).** More than 5 open reports for one
  page flags it: it shows as Flagged in Pages and Reports and in "Needs you". The page stays live
  and indexed until an admin suspends it by hand. Dismissing its reports clears the flag. The
  board's "3 reports in a day hides the page from search" is not built (record in DEVIATIONS).

### Part 3: Controls

- **Switches**, each logged, off asks for a reason:
  - Chat answers: every page gives the short fixed reply (the one used past the cap).
  - Sign-ups: new owner sign-ups closed with a plain message; existing owners sign in as usual.
  - Reading sources: new reads are not started; queued ones wait.
  - CHIP payments: plan payments and shop online payments are not offered; shops' QR and bank
    transfer still work.
  - Owner emails: notification emails to owners stop. Sign-in, verification and password reset
    emails always go.
- **Limits and prices**: cap, free leads, free orders, monthly, yearly; saved with a confirm and a
  reason. Read through one cached accessor in the API (short TTL, cleared on save) and passed to
  the web pages that print them (landing EN/MS, Billing, Terms, Refund, plan emails). The
  constants in `packages/core` become the defaults when no setting exists.
- **Banner**: up to 160 characters, shown on every owner's dashboard until taken down.

### Part 4: AI & usage, Reading sources, Payments

- **AI & usage** (from `ModelCall`): calls, typical and slow answer time (median, p95), cost per
  conversation, "I'm not sure" rate, failed calls; cost by job (chat vs reading vs grouping,
  from which id the call carries); recent "I'm not sure" answers (the visitor's question and the
  page, no visitor identity); pages near the cap.
- **Reading sources** (from `Ingestion`): waiting, reading, failed, typical time; table with the
  error text; Retry, Retry all failed (sources that are walled, e.g. Instagram, are skipped),
  Pause / resume the queue (BullMQ pause).
- **Payments**: plan payments through Curios's own CHIP account; the webhook log with Replay
  (re-runs the stored event through the same handler, which is already idempotent); a count of
  shop orders paid online (owners' money, for scale only, never summed into revenue).

## Non-goals

- Roles beyond `OWNER`, an admin-management screen, TOTP.
- SSM verification and trademark-handle queues from the old ADMIN.md.
- Editing an owner's facts, links, items or answers.
- Exporting leads, transcripts or anything else to a file.
- Real-time updates; a refresh is fine.
- Showing visitors' phone numbers or transcripts in admin, including in See it as the owner.

## Anti-goals (would make it a failure even if it works)

- Any way for an owner session to reach an admin route, or an admin session to act as an owner.
- A change that leaves no audit row, or an audit row that can be edited.
- A suspended page that still chats, or a deleted account whose payments vanish.
- A price shown on the landing or Terms that differs from what CHIP is asked to charge.

## Changes to ADMIN.md

When part 1 lands, update `devDocs/ADMIN.md` to match: separate app, not `apps/web/app/admin`;
TOTP deferred; one role for now; Reports in place of takedowns; the board's sections in place of
the margin-first screen list; See it as the owner allowed read-only with personal details masked.

## Decided after the first draft

- See it as the owner: built, with personal details masked (above).
- One reason box for suspend and "Email owner", written so the owner can read it: it goes in the
  audit log, the owner's email and their dashboard. The dialog says so under the box ("The owner
  sees this").
- Reports never suspend or hide a page by themselves (above).
