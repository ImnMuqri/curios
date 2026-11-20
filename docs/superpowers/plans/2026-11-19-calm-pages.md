# Calm redesign, page phase: implementation plan

> **For agentic workers:** use superpowers:subagent-driven-development, one implementer subagent per task, each followed by a reviewer. Steps use `- [ ]`.
> Suggested homes: plan at `docs/superpowers/plans/2026-11-19-calm-pages.md`, ledger at `.superpowers/sdd/2026-11-19-calm-pages/progress.md`.

**Goal.** Bring every dashboard page's own content to the 19 Nov `Dash` board. Then do the same for the customer order page, the FAQ index and the legal pages, from `More` and `Site`. The calm foundation (tokens, Inter, dark mode, frame, shared buttons and fields, laptop scale) is already done and is not re-planned here.

**Spec.**
- `.superpowers/calm/2026-11-19/HANDOFF.md`:
  - lines 9–99: base rules
  - 101–133: audit refinements
  - 135–171: sub pages
  - 173–232: Orders, Leads, empty states, order page
  - 964: Peek ids
  - 984–988: banners on a phone, no left accent bars, outlines
- Boards: `Dash.html`, `Dash.diff`, `More.html`, `Site.html`.
- Screens: `git show origin/design-digital-products:design/screens/<name>`.

---

## 0. Where the board lives (line hints for every task)

Each board line holds one or two screens. Strip the SVGs to read them. A greedy regex over these 30 KB lines hangs, so use `perl -pe 's/<svg.*?<\/svg>//g'`.

| Screen | `Dash.html` markup | Key CSS |
|---|---|---|
| My Curios | 1497–1531 | `.cv/.sw/.hex/.fonts/.bc2` dark at 1172; button styles at 1514 |
| Links | 1532–1563 | `.lr`, `.lsep` |
| Store (all four tabs) | 1564, first `data-s="store"` | `.items/.it/.ft` 827–830, 1460; sub-page kit 1174–1320 |
| Orders | 1564, `data-s="orders"` | `.split/.list/.li/.det/.kv2/.rcpt` 807–824; `.xfbar/.xsrch/.xold/.xnomatch/.xcf2/.xcfb/.xgo/.xnote/.xtwice` 1322–1337 |
| Questions | 1576 | `.qa/.qc/.ways/.ans` |
| Leads | 1588 | `.xstat/.xring/.xconv/.xwa` 1345–1352 |
| Review | 1600–1635 | `.xpub` 1361; `.xprog/.xsh3/.xmd/.xkeys` 1468–1474 |
| Facts & sources | 1636, first half | `.tbl/.tr` 851–852, 956; `.xmore` 1480, 1486 |
| Billing | 1636, `data-s="billing"` | `.plan2/.pc2/.opts2/.op/.tbl`; amounts at 1427–1428 |
| Settings | 1648, `data-s="settings"` | `.sec2/.setl/.srow` |
| Item editor, digital item, topic | 1648 (`item`, `itemd`, `topic`) | `.xsplit/.xprev/.xrow/.xback` 1174–1320 |
| Sheets and dialogs (receipt viewer, conversation, Adjust photo, voucher, pickup place) | 1648, tail | `.xscrim/.xsh/.xshf/.xmod` 1284–1304; closed sheets hidden 1432–1433 |

Shared CSS blocks in `Dash.html`:
- Stat strip: 801–803 and 1405–1418; phone at 1441–1443.
- Type: 1398–1402. Muted AA: 1403–1404. Lists: 1419–1426. Outlines: 1447–1450.
- Phone own-view: 1371–1381.
- Banners on a phone: 1382–1396.
- Empty states: 1354–1360 (Peek `.xek` is 110px wide).

Customer boards:
- `More.html`: order page and FAQ index CSS at 1067+, markup at 1154 (`co-*`, `cfaq`, `cfaqi`).
- `Site.html`: legal CSS 670–688 and 716, markup 979–998.

Board screenshots per page. All are `Calm-Dash-*` unless marked.

| Page | Screenshots |
|---|---|
| Orders | `orders`, `orders-dark`, `orders-paid(-dark)`, `orders-awaiting`, `orders-refund`, `o-receipt`, `o-notreceived`, `o-notrec-state`, `o-cancel`, `o-cancelled`, `o-delivery(-dark)`, `o-voucher`, `o-twice`, `o-nomatch`, `o-allclear`, `o-empty` |
| Questions | `questions(-dark)`, `q-empty`, `topic(-dark)` |
| Leads | `leads(-dark)`, `l-chat`, `l-enquiry(-dark)`, `l-contacted`, `l-conv`, `l-delete`, `l-empty` |
| Review | `review(-dark)`, `r-empty`, `r-done` |
| Facts & sources | `facts(-dark)`, `facts-sources(-dark)`, `facts-pinned`, `facts-never`, `facts-ask` |
| Store | `store(-dark)`, `store-items`, `store-payment(-dark)`, `store-payment-connect`, `store-delivery(-dark)`, `store-place`, `store-discounts(-dark)`, `store-voucher(-dark)` |
| Item editor | `item(-dark)`, `item-ask`, `item-crop`, `itemd-files`, `itemd-codes`, `itemd-session(-dark)` |
| My Curios | `mycurios(-dark)`, `links(-dark)`, `mc-buttons` |
| Billing | `billing(-dark)`, `billing-pay`, `billing-renew(-dark)`, `billing-renewfail`, `billing-personal` |
| Settings | `settings(-dark)`, `settings-password`, `set-push` |
| Banners | `banner-shopoff/near/leadsout/ended(-dark)`, `banner-leads2.phone.png` |
| Customer order page | `Calm-More-co_wait/co_check/co_paid/co_ready/co_done/co_refund/co_digital/co_failed`, `Calm-More-cpaid` |
| FAQ | `Calm-More-cfaq`, `Calm-More-cfaqi` |
| Legal | `Calm-Site-terms/privacy/refunds/returns` |

---

## 1. Gap analysis per page

Legend:
- **(a)** pure restyle.
- **(b)** new UI over data the screen already has, or can read with the existing API.
- **(c-read)** a new read-only query in `packages/db-read`. No schema, no API, no migration.
- **(c-api)** needs a schema, API or worker change. **Kept out of the restyle batches (Batch 6).**

### Shared, used by every page (`apps/web/app/app/_ui/*`)

| Board | Code now | Kind |
|---|---|---|
| Kicker above the title ("Inbox", "Knowledge", "Your shop", "Your page", "Account"), `.kick` 12.5px/600/.06em uppercase `#737069` | `PageHead` has no kicker | (b) |
| Title 40px / -0.04em (34px at 1100 or less, 32px at 760 or less); sub 15.5px, 8px top margin | `page-head.module.css` `.title` is 48px; summary 15px | (a) |
| Subtitles are one instruction; the numbers move into stat cards | Orders, Leads and Questions pass a numbers sentence as `summary` | (b) |
| Stat strip (3 cards, urgent first, sparkline or progress, click to filter, swipe row on phone) | none (`inbox.module.css` notes the figures were folded into the sentence) | (b) shell; the week series are (c-read) |
| Filter bar: chips plus search on one row; bordered list card; row fill `#f1eee7` with a 700 name; hover fill; sticky 420px detail card | `inbox.module.css`: full-height two-column board, list on page ground, 430px list, search above pill-tab filters, selected = `--pick` tint | (a)/(b) restructure |
| Inline confirm under its trigger on a soft panel, one black pill and one white pill | Orders and Leads have their own confirm markup | (b) shared component |
| Empty state: centred live Peek, title, one line, buttons | ghost rows plus badge (`ui.emptyArt`), per page | (b) use `app/_peek/LivePeek` |
| Side sheet: 460px from the right, scrim, footer with a black pill and a red text action, bottom sheet under 1100px, hides the phone menu, `visibility:hidden` when closed | none (pickup, voucher and Ask forms are inline; `ask-panel.tsx` is a panel) | (b) new primitive |
| Centred dialog (receipt viewer, Add a month, Adjust photo) | ad-hoc `role="dialog"` in `order-detail.tsx`, `pay-buttons.tsx` and `photo-cropper.tsx` | (b) shared primitive, then migrate |
| Switch: off track `#8f8b83`, 44px hit area, `role="switch"`, `aria-checked`, focus ring | `_ui/editor.module.css .switch`; 13 hand-rolled `role="switch"` buttons in 11 files | (a)/(b) one `Switch` component |
| Plan banner on a phone: two-column grid, button under the text, × as a 44px target top-right (`Dash.html` 1382–1396) | `alert-slot.module.css` at 760px only wraps flex | (a) |
| Muted AA: read text uses muted, `--calm-faint` only for decoration | page modules still use `--faint` and `--hint` for read text | (a) |
| `tabular-nums` on every column number | partial | (a) |
| No left accent bars; lists and tables use a 1px border, never an inset shadow | inset `box-shadow` outlines throughout the page modules | (a) |

### Orders (`orders/orders-screen.tsx`, `order-detail.tsx`, `orders.module.css`, `page.tsx`)

What the data already supports, all in `OwnerOrder` in `packages/db-read/src/orders.query.ts`:
- every detail state: `receiptRejectedAt`, `chipPaidTwiceAt`, `secondRefundedAt`, `paidVia='VOUCHER'`, `refundedAt`, `cancelledAt`, delivery `address`, `deliveryCents`, `note`;
- the four steps;
- the not-received and cancel confirms;
- the receipt viewer;
- filters, search and paging.

So Orders is mostly (a)/(b).

| Board | Code now | Kind |
|---|---|---|
| Stat cards: "Receipt to check" (urgent, "Check it →"), "Paid, to make" ("See them →"), "This week RM480 · +RM235 today" with a sparkline | `getOrderStats` → `{toCheck, toMake, paidThisWeekCents}`, used in the sentence | cards (b); per-day series and today's cents (c-read) |
| Chips `All / To check 1 / Paid 3 / Refunds 1` beside "Search name or order"; the empty-filter lines are already the board's | the copy exists | (a) |
| Board's no-match line: "No match / Try a name or an order number, like 14." | "No order here matches “…”." | (a) copy, board wins |
| "Older orders" label inside the list | the `?before=` pager link "Older orders" | (b), see Q3 |
| List tags (board): Paid → `t-ok` green; To check `t-wait`; Awaiting payment `t-grey`; Refund owed `t-red`; **Paid twice `t-red`** in the list | `BADGES.paid` is biru; a paid-twice order shows Paid or Paid online | (b) |
| Detail: `.k` "Order #16 · Today 11:42", h2 26px, status tag, `xsteps2` (3px top bar per step), `kv2` rows, receipt tile, "Sent by email" soft card, full-width black pill, "WhatsApp Farah" white pill, red text action with an in-place confirm | all the logic exists; the visuals and confirm placement differ | (a)/(b) |
| Paid twice: `.xtwice` panel `#fdf3f2` / ring `#f3d4d0` | `.paidOnline` with `--hijau-wash`, **unreadable in dark (parked P6)** | (a) + P6 |
| Receipt not received: amber `.xsent.xwarn` | `waitText` exists | (a) |
| Delivery block "Getting it to them" with a Note box | data exists | (b) |
| Empty "Your first order lands here" with a centred Peek, Copy your link, Set up your shop | copy exists, ghost-rows art | (b) |
| Phone: picking an order opens its own view with "‹ All orders"; list, stats and the title's sub and actions hide | none | (b) |
| Parity: the badge (`countNavBadges.orders` = PLACED with a receipt) must equal the "To check" chip and the urgent card | the chip counts from `ownerView==='toCheck'` over the loaded list (same rule) | test it |

### Questions (`questions/questions-screen.tsx`, `topic-detail.tsx`, `page.tsx`)

| Board | Code now | Kind |
|---|---|---|
| Stat cards: "Needs your answer" (urgent, "Answer it →"); "Answered by your page 86%, 34 of 39 this week" with a progress bar; "Asked this week 39, +12 on last week" with a sparkline | `getAnswerRate` (**30-day window**), `countQuestionsThisWeek`, `getTopicTotals` | cards (b); 7-day rate, last-week count and per-day series (c-read) |
| The list is **topic cards** (`.qc`): title link → topic screen, tag, "14 asks · 3 ways", wording chips, and an inline "Write your answer once…" + **Save answer** for Needs (or the answer text) | inbox list/detail with the topic on the right | (b) restructure |
| Topic is **its own screen**: "‹ Questions", kicker "Questions · Topic", title, "14 asks this month, in 3 ways.", rows How people ask / Your answer / How the chat replies / Same question as… / Delete topic | `topic-detail.tsx` holds every action (split, delete wording, answer, merge, delete) | (b) re-layout |
| Chips: All / Needs you / Answered | 4 shows: all, needs, chat, answered | Q5 |
| Empty "No questions yet" with "Try asking your page" | exists | (b) Peek |
| Parity: the badge (`countTopicsNeedingOwner`) and `totals.topics.needs` share `showWhere('needs')` | ok | test it |

### Leads (`leads/leads-screen.tsx`, `lead-detail.tsx`, `leads.module.css`)

| Board | Code now | Kind |
|---|---|---|
| Stat cards: "New, not contacted" (urgent, "Reply to them →"); "Left a number this week 9, +3 on last week" with a sparkline; "Became sales 3, 33% of this week’s leads" with a bar | `getLeadStats` → `{waiting, thisWeek, sold}` (sold is all-time) | cards (b); last week, per day and sold-of-this-week (c-read) |
| Status: 4-way pill segment `.xstat` | a pill-tabs radiogroup exists | (a) |
| Ring "N of 4 details known" with Start with hello / Ask a little more / Almost there / Ready to quote | ring "score of 3", same four labels indexed 0–3 | (b), see Q2 |
| Picked out: chat Wants/When/Where; enquiry item card ("Ask for a price · from RM450") plus When/For/Budget plus "Their message" plus "Name: Aisyah" | `slots` (product, date, location, people, budget) and `enquiry` exist | (a)/(b) |
| The conversation sits behind a "See the conversation" row ("4 messages · left their number at 9:16am") and opens a side sheet | transcript printed inline | (b) needs SideSheet |
| Editable first message, then Send on WhatsApp (New becomes Contacted) | exists | (a) |
| Delete confirms in place | exists | (a) via InlineConfirm |
| Phone own view "‹ All leads" | none | (b) |
| No-match line: "Try part of a number, or what they wanted." | check the repo copy | (a) |
| Parked P7: `.newDot` ring biru mix | | (a) |

### Store (`store/store-editor.tsx`, `items-list.tsx`, the tabs, `item-editor.tsx`, `photo-cropper.tsx`)

| Board | Code now | Kind |
|---|---|---|
| Tabs as chips under the title, with counts ("Items 7", "Discounts 3") | `PillTabs` beside the title | (a) |
| No phone preview beside the Store tabs; the preview lives only in the item editor at 1250px and up | `PreviewFrame` shop/pay preview beside every tab | Q4 |
| "Shop open" card with a switch plus a 3-step checklist (Switch an item on / A way to pay / Getting it to them, each linking to its tab) | `storeGaps` readiness exists | (b) |
| Filter bar: All / In your shop / Hidden / Digital plus "Search your items"; live counts; "No items match. Try another word, or add an item." | none | (b) |
| Item **card grid** (3, then 2, then 1 columns) with a footer: "12 sold in 30 days" / "4 enquiries in 30 days" / "6 of 12 seats taken", and the switch; switched off goes grey with "Hidden from your shop"; "+ Add an item" tile | a vertical list with move up/down and edit | grid (b); sold and enquiry counts (c-read); seats from `sessions[].booked` (b) |
| Payment: `xrow` 240px heading column; CHIP connected card (Test with RM1, Disconnect) or the five connect steps; QR card (Change, Remove); bank grouped fields "Saved"; "Money goes straight to you. Curios never holds it." | functionally present | (a) |
| Pickup & delivery: Allow pickup switch, place list; **side sheet** for a place; choice cards; days stepper; closed days | inline form | (b) SideSheet |
| Discounts: voucher list; **side sheet** with Automatic or Code, Percent or Amount, applies to, min spend, last day, uses | inline form | (b) |
| Item editor as its own screen ("‹ All items", rows of heading plus note | fields, live preview at 1250px and up) | rendered in place via the `editing` state | (b) |
| Adjust photo as a centred dialog | `photo-cropper.tsx` | (a) via Dialog |

### Facts & sources (`knowledge/*`)

| Board | Code now | Kind |
|---|---|---|
| Header actions "Try your page" (opens the Ask side sheet) and "+ Add a fact"; tab chips with counts | tabs plus panel | (a)/(b) |
| Facts: one-line add field "One line, like: Eggless available for kek coklat" + Add, and the hint "Facts you add are trusted straight away. No review needed."; topic chips with counts plus search; **table** Topic / Fact / From / ···; source names are links; "You wrote this"; "No facts match. Try another word."; ··· is 32px (44px on a phone) with `aria-label="More actions for this fact"` | search and category chips exist, grouped sections, edit and remove icon buttons | (a)/(b); topics = `FactCategory` (PRICE, HOURS, LOCATION, POLICY, PRODUCT, PERSON, MISC). The board's "Delivery" is not a category: show real categories, no schema change |
| Fix: the count on the chosen "Facts" chip is a biru box in dark (laptop-scale report) | | (a) |
| Sources: "Add a source" card with the A link / Paste text / A file segment, list rows (Link/Text/File key, Read/Reading tag, Read again, ✕), Instagram hint | functionally present | (a) |
| Pinned answers and Never say: list rows plus lead lines | present | (a) |
| Ask your page as a side sheet, each answer showing where it came from | `ask-panel.tsx` | (b) migrate to SideSheet |

### Review (`review/review-queue.tsx`, `fact-card.tsx`, `publish-button.tsx`)

| Board | Code now | Kind |
|---|---|---|
| Top: "**2 left** to check", one bar (`role=progressbar`), "1 of 3 done" | segmented bar, "N facts to check" | (a)/(b) |
| Card actions Fix it / Skip / Accept, with hints F / S / A (A accepts) | Edit / Reject / Accept; no keys | (b) keys; Skip semantics are Q1 |
| Side column: "Up next 2" (Next, Then) and "Done 1"; done items keep full contrast with a green "Accepted" label | "What this changes" panel plus a log | (b) |
| Publish card at the top of the main column: "Your page is live" or "Your page is not public yet" + Publish | Publish in the side panel | (b); update help `faq.md:46` |
| Empty "Nothing to review yet", all-done "Nothing left to review" with Peek | exist, different art | (b) |
| 3px overflow at 1366×768 (771/768) | | (a) |

### My Curios (`curios/*`)

| Board | Code now | Kind |
|---|---|---|
| Button styles **Soft, High contrast, Outlined, Glass**, with notes "Light pills, gentle edges" / "Solid pills, bold edges" / "Outlined, with a hard shadow" / "See-through, coloured edge" | `STYLES`: Soft, High contrast, **Chunky**, **Outline** (same notes) | (a) label rename only: CHUNKY → "Outlined", OUTLINE → "Glass". **No enum change.** Update `faq.md:60` |
| Font chips set in their own font; selected swatch gets a tick; every swatch named; hex chip reads `#b5294e` (no space); tapping the hex opens the custom colour field | partly present (`ACCENT_NAMES`, a `Tick`) | (a)/(b) |
| Grouped Name + Bio box; cover; links tab "Your links · drag to reorder" | present | (a) |

### Billing (`billing/*`)

Everything functional exists: plan card, yearly "2 months free", Add a month with "Renew automatically by card" and Continue to CHIP, auto-renew on and off with a confirm, renewal failed, personal → business two-step, payment notice.
- (a): plan card, monthly/yearly option cards, usage boxes at natural height, the payments table (amounts ink 600, right-aligned, tabular), the `.xst` state cards, Add a month in the shared Dialog.

### Settings (`settings/*`)

- (a): the rows match the board: Your page, Signing in (Google Connected or Connect Google, Add password in place, Notifications on this device, Search engines on a personal page only, This device Sign out), Email me when.
- **"A question is asked 3 times"** switch: no `notifyQuestions` field, no mail, no trigger. **(c-api), Batch 6 / Q6.**
- "Your plan is ending" stays the locked-on row (deliberate, documented in `notify-emails.tsx`; keep it and log a DEVIATIONS row).
- P16: Notify card never seen rendered. Screenshot it with VAPID keys set in dev.

### Customer order page (`app/[handle]/order/[token]/*`)

All states exist in `order-view.tsx`, `pay-box.tsx`, `pay-failed.tsx`, `receipt-upload.tsx` and `digital-section.tsx`. Copy comes from `shop/copy.ts`, including "saved your order for **30 minutes**".
- (a): status pill, the 4-step bar (3 steps for digital), state blocks, "What you ordered", WhatsApp, "Keep this page", in the owner's theme.
- **Pickup "Add to calendar" on every pickup line:** the calendar route serves SESSION lines of paid orders only (`calendar/route.ts`). Extending it to the pickup day and window reads existing order data, so it is a web route change, no schema (own task, Q7).
- Imports today: nothing from `app/app/_ui` or `_peek`. Keep it that way and add a guard test.

### FAQ index (`app/[handle]/faq/page.tsx`, `faq-list.tsx`)

- "Questions about Kek Lina" exists, and "All questions" exists on the entry page.
- New: each question shows the start of its answer. `getFaqIndex` already returns `answer`, so this is (b) UI only.
- Keep no FAQPage JSON-LD on the index: an excerpt is not the full answer. Update the comment.

### Legal (`app/_legal/LegalPage.tsx`, `legal.module.css`, routes under `(landing)`)

- All four docs and the doc tabs exist, but the styling is still Plex/old (`font-family: var(--font-plex-sans)`, a 36px display title).
- (a): restyle to the Site Terms layout:
  - calm landing nav;
  - "Legal" kicker;
  - title 56px (38px on a phone);
  - meta "Last updated …" with the English / Bahasa Melayu pill toggle;
  - lead 18px;
  - doc pills (`.lg-docs a.on` soft fill);
  - a 240px TOC column plus numbered sections (h2 24px with a mono `01`, p 16.5px/1.65 `#3e3c38`, sections split by a 1px line).

### Onboarding (`app/app/onboarding/*`)

- Board `More` ob1–ob4. Not in the requested batch list; listed as an optional Batch 4 task.
- Fields stay pills here (DEVIATIONS 347 exempts onboarding).

---

## 2. Global constraints (hand to every implementer and reviewer)

1. **Owner overrides beat the board. Never reintroduce:**
   - a hairline or shadow on the current sidebar item (DEVIATIONS 346);
   - pill-shaped dashboard fields: every dashboard field, single-line, search and the one-line add fields included, uses `var(--field-radius)` / `--r-box` 16px. Buttons, chips, tabs and segments stay pills (347);
   - a rounded main sheet corner (348).
2. **Copy:**
   - Board copy wins over repo copy for wording. Take it verbatim from the board markup.
   - Where behaviour differs (Skip vs Reject, the locked plan-ending row), follow the plan's decision and add a DEVIATIONS row.
   - No em dashes.
   - When a visible label the help guide quotes changes, edit `packages/core/src/help/faq.md`, run `pnpm --filter @curios/core gen:help`, and keep `guide.test.ts` green.
3. **Corners:**
   - Clickables are `var(--r-pill)`; containers `var(--r-box)` (16px); circles 50%.
   - Side sheets and dialogs use the same radius as the Help panel already built. Do not invent 20px.
   - When a page module is restyled, add it to `shared` in `packages/ui/src/design-rules.test.ts` ("Page modules join the corner check one by one").
4. **Colour:**
   - Hex literals live only in `packages/ui/src/tokens.css` (`design-rules.test.ts`).
   - New values go in as `--calm-*` tokens with a dark twin, and the frame's dark scope maps them. Preview islands (`[data-island]`) take the light value back.
   - Primary actions use `--action`, never `--biru` (the BIRU_FILL test).
   - Colour only where it carries meaning.
5. **Muted text:** anything a person reads uses `--muted` (≥4.5:1). `--calm-faint` / `#a19e97` is for decoration only.
6. **Numbers** that line up in a column get `font-variant-numeric: tabular-nums`.
7. **Lists:**
   - Selected row: fill `--calm-pick` (`#f1eee7`, dark `#232321`) and the name at 700. Hover: `--calm-bg` light, `#1b1b1a` dark.
   - **No left accent bars.**
   - Lists and tables are outlined with `border: 1px solid var(--calm-ring)`, never an inset box-shadow.
8. **Motion:** screens fade up 8px, popovers scale from 0.98, lists stagger. The detail pane switches instantly. Everything is off under `prefers-reduced-motion`.
9. **Peek:** every SVG gets its own clip id via `useId()` (`LivePeek` already does). Dashboard empty states use `app/_peek/LivePeek` with `follow`, 110px wide.
10. **Customer pages** (`app/[handle]/**`):
    - Never import from `app/app/**` or `app/_peek/**`.
    - They keep the owner's theme (`PageTheme`) in light and dark, use Inter, and do not opt into the laptop scale (`laptop-scale.test.ts`).
11. **Do not build** the canvas-only switchers: "Plan state", "With data / New account / All reviewed", the state pills.
12. **Layout:** layouts respond to the content column (container queries) where the board does. Phone below 1100px (frame); stack below 760px. No horizontal scroll at 390, 820, 1024, 1366 or 1440.
13. **One count everywhere:** sidebar badge, phone badge, chip, urgent stat card and notification row show the same number (`countNavBadges`). Never compute a second, different rule.
14. **Data:**
    - Web pages read via `@curios/db-read` server-side and write via `apiFetch`.
    - Never pass functions across the RSC boundary.
    - (c-read) tasks add queries only: no Prisma schema change, no migration, no API route.
15. **Project traps:**
    - vitest does not typecheck: run `pnpm --filter <pkg> typecheck` and read the exit code directly, never piped into `tail` or `head`.
    - vitest stubs CSS modules: an attribute selector with no local class breaks `next dev`. Scope as `.x[data-y]` or `:global(...) .x`.
    - A shared component with hooks needs `'use client'`.
    - On Windows, write files with the Edit/Write tools, never CRLF writes.
16. **Gates per task:**
    - `pnpm --filter @curios/web test`, `typecheck` and `lint`.
    - `pnpm --filter @curios/ui test` (design rules).
    - Plus `@curios/db-read` / `@curios/core` / `@curios/api` when touched.
    - Known failures to ignore: `order.digital` and host-guard (`.env INGEST_ALLOW_PRIVATE_ADDRESSES`).
17. **Screenshot check (every UI task's definition of done):**
    - Headless Chrome over CDP against the dev server, as signed-in `nadia@example.com`. Insert one Session row and delete it afterwards by its exact id.
    - Set the `curios_theme` cookie to `light` and to `dark`, and emulate `prefers-color-scheme`.
    - Viewport captures (no `captureBeyondViewport`) at **1366×768**, where the laptop 90% applies (compare composition and proportion, not pixels: the board shots are 1440 at 100%), and **390×844** with touch emulation. Add 820×1180 where a `.tablet.jpg` exists.
    - Extract the board shot with `git show origin/design-digital-products:design/screens/<name> > .superpowers/sdd/2026-11-19-calm-pages/board/<name>` and view both.
    - Save to `.superpowers/sdd/2026-11-19-calm-pages/shots/<task>/`.
    - List matches and differences in the report. Each difference is fixed, logged in DEVIATIONS, or parked with an id.
    - Empty states: if a fresh account is not at hand, render-test them and let the controller take the shot.
18. Every departure from the board gets a row in `design/DEVIATIONS.md` (next free number after 348).

---

## 3. Batches

Each batch ships to production on its own. Within a batch, data and shared tasks go first.

### Batch 1: Inbox (Orders, Questions, Leads) and the shared kit they need

**T1.1 Shared head, tokens, switch, banner on a phone** (a/b)
- Files:
  - `packages/ui/src/tokens.css`
  - `apps/web/app/app/app-frame.module.css` (dark mapping and island give-back)
  - `_ui/page-head.tsx`, `.module.css`
  - new `_ui/switch.tsx` and `.module.css`
  - `_ui/editor.module.css` (`.switch`)
  - `_ui/alert-slot.module.css`
  - `packages/ui/src/design-rules.test.ts`
- Tokens, verbatim:

  | Token | Light | Dark |
  |---|---|---|
  | `--calm-pick` | `#f1eee7` | `#232321` |
  | `--calm-row-hover` | `#fbfaf7` | `#1b1b1a` |
  | `--calm-urgent` | `#fdf6e7` | `#33291a` |
  | `--calm-urgent-ring` | `#f1dfb4` | `#4d3b1d` |
  | `--calm-urgent-label` | `#7a4b06` | `#f2c46b` |
  | `--calm-urgent-ink` | `#5c3804` | `#f2c46b` |
  | `--calm-spark` | `#d8d4cb` | `#3a3936` |
  | `--calm-spark-today` | `#1d7a4c` | `#7fd3a5` |
  | `--calm-hover-ring` | `#c9c4b8` | — |
  | `--calm-switch-off` | `#8f8b83` | — |
  | `--calm-danger` | `#b3261e` | `#ff8a80` |
  | `--calm-twice` | `#fdf3f2` | pick a dark twin in the tag-red family and log it |
  | `--calm-twice-ring` | `#f3d4d0` | pick a dark twin in the tag-red family and log it |

- PageHead:
  - optional `kicker` prop (12.5px/600, .06em, uppercase, muted);
  - title 40px, -0.04em (34px at 1100 or less, 32px at 760 or less);
  - summary 15.5px with an 8px top margin;
  - actions get `padding-top` to align as `.hrow .acts` (`Dash.html` 798 and 950).
  - Every page gets its kicker in its own task. Here only the prop and the size change land.
- `Switch`:
  - `<button role="switch" aria-checked>` inside a 44px hit area;
  - off track `--calm-switch-off`;
  - focus ring;
  - native button, so Space and Enter work.
  - Do not migrate pages here, except the shared `.switch`.
- Banner on a phone per `Dash.html` 1382–1396:
  - grid `40px minmax(0,1fr)`, gaps 12;
  - padding `14px 48px 14px 14px`;
  - button in column 2, left-aligned, min-height 40;
  - × absolute top 8 / right 8, 44×44.
  - Fold in parked P12: shoot each banner tone in dark.
- Tests:
  - PageHead renders the kicker; CSS asserts 40/34/32;
  - Switch toggles on click, Space and Enter, with `aria-checked`;
  - tokens exist with a dark mapping (extend `dark-mode.test.ts`);
  - an `alert-slot` CSS contract for the 760 grid.
- Done: all gates green; screenshots of any page head, light and dark, at both sizes; Calm-Dash-banner-* light and dark plus `banner-leads2.phone.png`.

**T1.2 Data: week series (c-read, no schema, no API)**
- Files: `packages/db-read/src/orders.query.ts`, `leads.query.ts`, `topics.query.ts`, `index.ts`, and their `*.query.test.ts`.
- Extend:
  - `OrderStats`: `paidDaysCents: number[7]` (oldest first, today last; Malaysian days, the slot loop already exists) and `paidTodayCents`.
  - `LeadStats`: `lastWeek`, `days: number[7]`, `soldThisWeek` (status SOLD among leads created in the last 7 days).
  - Add `getQuestionWeek(accountId, now)` → `{ thisWeek, lastWeek, days: number[7] }` over USER messages. Use one grouped query (`$queryRaw` with a Malaysian-day bucket is acceptable; `topics.query.ts` already uses `queryRaw`), not N counts.
  - `getAnswerRate` takes `days = 30`; Questions passes 7.
- Tests (test DB):
  - boundaries at Malaysian midnight (UTC+8);
  - cancelled orders excluded;
  - a 7-element array with today last;
  - zero weeks;
  - scope by `accountId`, with another owner's rows ignored;
  - parity: `countNavBadges(...).orders === getOrderStats(...).toCheck` and `.leads === getLeadStats(...).waiting` on the same fixture.
- Done: `pnpm --filter @curios/db-read test` and typecheck green. Nothing reads the new fields yet.

**T1.3 Shared inbox kit: StatStrip, Spark, filter bar, list/detail, InlineConfirm, EmptyPeek, phone own-view** (b)
- Files: new `_ui/stat-strip.tsx` and `.module.css` (with `Spark`), new `_ui/inline-confirm.tsx`, new `_ui/empty-peek.tsx`; rewrite `_ui/inbox.module.css`.
- **StatStrip.** Cards with `{label, value, line?, go?, urgent?, filter?, spark?: number[7], rate?: 0..1}`. A card with `filter` is a `<button aria-pressed>`; a second click clears it. Values, verbatim from `Dash.html` 1405–1418 and 1441–1443:
  - strip: margin-top 24, gap 12;
  - card: min-height 112, padding `16px 18px`, radius `--r-box`, ring `inset 0 0 0 1px var(--calm-ring)`;
  - label 13px/500 muted; value 28px/600 lh 1.1 tabular; line 12.5px/600 `--tag-ok-ink`; go line 13px/600 ink, `margin-top:auto`, `padding-top:8px`;
  - urgent: `--calm-urgent` fill, its ring, label and ink tokens;
  - pressed: `inset 0 0 0 2px var(--ink)`;
  - hover: `inset 0 0 0 1px var(--calm-hover-ring), 0 8px 20px -14px rgba(40,30,10,.3)` (put the shadow in a token);
  - active: `scale(.99)`;
  - rate bar: 6px, radius 3, `--soft` track, `--tag-ok-ink` fill, margin-top 10.
- **Spark.** `aria-hidden` SVG 84×28 at top 18 / right 18. Seven rects 8 wide at x = 0, 12, …, 72, `rx="2"`. Height = `max(4, round(26 * v / max))`, bottom-aligned. Fill `--calm-spark`; today `--calm-spark-today`. Hidden at 760 or less.
- **Phone (760 or less):** the strip is `display:flex; overflow-x:auto; scroll-snap-type:x mandatory`, cards `flex:0 0 72%; min-height:104px`, right bleed `margin-right:-18px; padding-right:18px`.
- **inbox.module.css:**
  - `.fbar`: flex, gap 12, wrap; chips 40px (44 at 760 or less), padding `0 15px`, 14px/500, chip "on" = `--action`;
  - search: 40px, `--field-radius`;
  - `.split`: grid `minmax(0,1fr) 420px`, gap 20, margin-top 16, `align-items:start`;
  - `.list`: `--card`, `border:1px solid var(--calm-ring)`, radius `--r-box`, `overflow:hidden`;
  - row: padding `16px 20px`, min-height 64, `border-top:1px solid var(--line)` (first none), selected `--calm-pick` and name 700, hover `--calm-row-hover`;
  - avatar: 40px circle, 15px/700;
  - tag: 24px pill, 12px/600, with a 6px `currentColor` dot;
  - `.det`: card, padding 24, ring; sticky `top:24px` at 1101 and up;
  - `.k`: 12.5px/600 muted; `h2`: 26px/600/-.03em; `kv2` rows 11px, 14.5px, lined.
- **Phone own-view:** `data-open` on the split.
  - Below 1100px the detail shows only when open. The list, the strip, the filter bar, the page sub and the actions hide.
  - Desktop keeps the first row auto-selected without `data-open`.
  - Back link "‹ All {noun}" (`Dash.html` 1371–1381): 36px pill, 14px/500 muted.
- **InlineConfirm.** `{trigger, question, yes, no, onYes, tone}`: opens under its trigger on a `--soft` panel (`.xcfb`), one `--action` pill and one white pill; Escape closes and focus returns.
- **EmptyPeek.** `LivePeek width={110} follow`, title 22px/600/-.03em, one line, buttons. Max-width 440, margin `60px auto 0`, centred.
- Tests:
  - the strip renders buttons only for cards with a filter, toggles `aria-pressed` and calls back;
  - Spark marks the last rect today and scales;
  - InlineConfirm keyboard and focus;
  - EmptyPeek has a unique clip id per instance (render two);
  - `inbox` joins the corner check (it is already on `shared`; keep it green);
  - a CSS contract: the list uses `border`, not an inset shadow, and has no `border-left` on rows.

**T1.4 SideSheet and Dialog primitives** (b)
- Files: new `_ui/side-sheet.tsx` / `.module.css` and `_ui/dialog.tsx` / `.module.css`; `app-frame.tsx` and `_ui/phone-menu.tsx` (hide while a sheet is open: an `OverlayContext` from AppFrame, or reuse `announceOverlay` / `OVERLAY_OPENS` from `_ui/popover.tsx`).
- Sheet (`Dash.html` 1284–1304):
  - fixed `top:12 right:12 bottom:12`, width 460, `--calm-bg` surface;
  - scrim `--calm-scrim`;
  - header with title, line and a 44px ✕; body scrolls; footer `.xshf` (one `--action` pill, one red text action, or a hint);
  - below 1100px: bottom sheet `left:8 right:8 bottom:8`, `height:min(720px, calc(100dvh/var(--page-zoom) - 40px))`;
  - closed: `visibility:hidden` and no shadow (`Dash.html` 1432–1433);
  - `role="dialog" aria-modal="true"`, focus trap, Escape, focus back to the opener, scroll lock.
- Dialog: centred, `width:min(440px, calc(100vw - 24px))`, padding 26, scale .97 → 1. Same a11y rules.
- Both announce as overlays so popovers, Help and the phone menu step aside. The phone menu hides while either is open.
- Tests: open and close, Escape, focus return, trap; the phone menu is hidden while open (render AppFrame with a sheet open); reduced motion; `visibility:hidden` when closed (CSS contract).
- Done: a story-like render in a test only. Pages adopt them in their own tasks.

**T1.5 Orders page** (a/b). Depends on T1.1–T1.4.
- Files: `orders/page.tsx`, `orders-screen.tsx`, `order-detail.tsx`, `orders.module.css` (rewrite, 1092 lines today; add to the corner check), and both tests.
- Head:
  - kicker "Inbox";
  - sub "Check receipts first. Everything else waits for you below.";
  - action "See your shop" as a white pill.
- Strip:
  - "Receipt to check" = `stats.toCheck`, urgent, "Check it →", filter `check`;
  - "Paid, to make" = `stats.toMake`, "See them →", filter `paid`;
  - "This week" = `formatRinggit(paidThisWeekCents)`, line `+{formatRinggit(paidTodayCents)} today` (omit at 0), spark `paidDaysCents`.
- Filter bar:
  - chips `All / To check {n} / Paid {n} / Refunds {n}`, counts as plain `<u>`-style numbers (no tone boxes);
  - search placeholder "Search name or order";
  - no-match "No match" / "Try a name or an order number, like 14.";
  - empty-filter copy as now.
- List:
  - avatar, name, `#14 · 3 items · Pickup Sat`, amount (tabular), tag;
  - tags per the board: Paid = `t-ok`, Paid online = `t-ok`, To check `t-wait`, Awaiting payment `t-grey`, Refund owed / **Paid twice** `t-red` (paid twice when `chipPaidTwiceAt && !secondRefundedAt`), Cancelled `t-grey`;
  - the "Older orders" label per Q3; the `?before=` pager stays at the foot.
- Detail:
  - `Order #N · {when}`, h2, tag, `xsteps2` (four spans, 3px top border, `.on` ink);
  - `kv2` rows: Item(s), Total ("RM180 + RM10 delivery"), Paid by, Pickup or Delivery, WhatsApp;
  - receipt tile opens the viewer in **Dialog** ("Receipt for order #16", with "Make sure RM25 reached your account before you mark it paid.");
  - soft cards: "Sent by email", "Paid with a voucher" / "The voucher took the whole order off, so there is no receipt to check.";
  - amber "Receipt not received" card;
  - `.xtwice` "Paid twice" panel with the second receipt and InlineConfirm "Marked the second payment refunded?" (Yes, refunded / Not yet);
  - "Getting it to them" block (lab2, Delivery · day, address, Note box);
  - hints via `.xhint`;
  - a full-width primary pill, then the "WhatsApp {first}" white pill;
  - red text actions with InlineConfirm: "Not received" → "Mark the receipt not received? {First} will be asked to pay again." Yes, not received / Keep it. "Cancel order" → "Cancel #14? You will owe Mira RM235." (or "Cancel #13?" when unpaid) Yes, cancel / Keep it.
- Remove the `--hijau-wash` `.paidOnline` (P6). Paid-online uses the hint "Paid through CHIP, so there’s nothing to check."
- Empty: EmptyPeek "Your first order lands here", the existing line, Copy your link, Set up your shop. The page head sub stays visible.
- Phone own-view: "‹ All orders".
- Tests:
  - the strip click filters, and a second click clears;
  - the chip "To check" count equals `stats.toCheck` equals the urgent card;
  - the paid-twice tag;
  - each confirm text verbatim;
  - the voucher, delivery and not-received blocks;
  - the phone back link toggles `data-open`;
  - the receipt Dialog focus;
  - **dark: no `--hijau-wash` in `orders.module.css`**.
- Screens: `orders`, `orders-dark`, `o-receipt`, `o-twice`, `o-delivery-dark`, `o-notreceived`, `o-empty`, `o-nomatch`, `orders.phone`, `o-delivery.phone`, plus the `banner-shopoff` placement.

**T1.6 Leads page** (a/b). Depends on T1.1–T1.4.
- Files: `leads/page.tsx`, `leads-screen.tsx`, `lead-detail.tsx`, `leads.module.css`, tests.
- Head:
  - kicker "Inbox";
  - sub "People your page couldn’t answer, with what they asked.".
- Strip:
  - "New, not contacted" = `waiting`, urgent, "Reply to them →", filter `new`;
  - "Left a number this week" = `thisWeek`, line `+{thisWeek-lastWeek} on last week` (signed; at 0 "Same as last week" per Q, or omit), spark `days`;
  - "Became sales" = `soldThisWeek`, line `{pct}% of this week’s leads`, rate bar.
- List rows: "#" avatar, phone (tabular), summary, an "Enquiry" mini-label, tag (New `t-new`, Contacted `t-grey`, Sold `t-ok`, Closed `t-grey`). No-match "No match" / "Try part of a number, or what they wanted."
- Detail:
  - `.k` "From the chat · Today 9:14am" / "Enquiry from the shop · …";
  - status `.xstat` 4-way segment (`role=radiogroup`);
  - ring per Q2 (label and "N of 4 details known");
  - "Picked out of the conversation" kv (Wants/When/Where with an italic "Not mentioned"), or for an enquiry "Their enquiry" with the item card (gradient or photo, name, "Ask for a price · from RM450"), When/For/Budget, "Their message" note, "Name: Aisyah";
  - the "See the conversation" row (`.xconv`: icon, "N messages · left their number at 9:16am", ›) opens a **SideSheet** "The conversation" (`{phone} · {when} on your page`), with the transcript as chat bubbles, the "Left their number · 9:16am" marker, footer hint "Only you see this." and a Close pill;
  - "First message / Edit it before you send" textarea and "Send on WhatsApp";
  - hint "They agreed to be contacted when they left it. Delete it once you are done.";
  - Delete via InlineConfirm: "Delete this number and the conversation with it? It cannot be brought back." Yes, delete / Keep it.
  - Contacted, Sold and Closed leads show "Open WhatsApp" white.
- Drop the biru `newDot` (P7).
- Empty: EmptyPeek "No numbers yet" plus the existing line.
- Phone "‹ All leads".
- Tests: the strip filter; ring labels at 1–4; the conversation opens in the sheet, not inline; send flips NEW to CONTACTED; delete confirm copy; the phone back link.
- Screens: `leads(-dark)`, `l-enquiry(-dark)`, `l-conv`, `l-delete`, `l-empty`, phone, plus `banner-leadsout`.

**T1.7 Questions page and topic screen** (b). Depends on T1.1–T1.3.
- Files: `questions/page.tsx`, `questions-screen.tsx`, `topic-detail.tsx`, `questions.module.css`, tests.
- Head:
  - kicker "Inbox";
  - sub "Answer a topic once and your page uses it for every way people ask.";
  - action "See your FAQ" (business pages).
- Strip:
  - "Needs your answer" = `totals.topics.needs`, urgent, "Answer it →" → `?show=needs`;
  - "Answered by your page" = rate % over 7 days, line "{answered} of {recorded} this week", bar;
  - "Asked this week" = `thisWeek`, line "+N on last week", spark.
- List of topic cards `.qc`:
  - title as a link to `?topic=<id>`;
  - tag `t-wait` "Needs your answer" or `t-ok` "Answered";
  - "N asks · M ways";
  - wording chips;
  - Needs: inline answer box ("Write your answer once. The page uses it every time.") with a Save answer pill, reusing the existing answer action. Answered: the answer on a soft block.
- Chips per Q5. The pager stays.
- Topic screen when `?topic` is set:
  - "‹ Questions" back, kicker "Questions · Topic", title, "{n} asks this month, in {m} ways.", tag;
  - `xrow` rows (240px heading column):
    - "How people ask / Hover a wording to split it into its own topic, or delete it." with `.xwords` chips (count, ⇱ split, ✕ delete; icons show on hover and always on touch);
    - "Your answer / The chat uses it for every wording above." with a textarea and Save answer;
    - "How the chat replies / On your page, right now." with a `.xchat` preview (the existing `ChatReply`) and a hint;
    - "Same question as… / Both have an answer? The one you merge into keeps its answer." with the Merge into select;
    - red "Delete topic".
  - The sidebar keeps Questions current.
- Empty: EmptyPeek "No questions yet" with "Try asking your page".
- Tests: a card answer saves; the title link sets `?topic`; the back link; the topic rows render the existing actions; the strip counts equal the totals.
- Screens: `questions(-dark)`, `topic(-dark)`, `q-empty`, phone, plus `banner-near`.

Batch 1 done: all seven tasks reviewed. One-count parity tests pass. Screens light and dark at 1366×768 and 390×844 match the listed board shots.

### Batch 2: Store and the item editor

**T2.0 Data: per-item 30-day figures (c-read)**
- `packages/db-read`: `getItemStats(accountId, now)` → `Map<itemId, {sold30: number; enquiries30: number}>`.
  - Sold: sum of `OrderLine.quantity` where the order is PAID or COMPLETED with `paidAt` in the last 30 days.
  - Enquiries: `Lead` count with `itemId` and `createdAt` in the last 30 days.
- Two grouped queries. Tests for scope, the window and cancelled orders excluded.

**T2.1 Store shell and Items tab** (a/b)
- Files: `store/page.tsx`, `store-editor.tsx`, `items-list.tsx` (becomes a grid), `store.module.css` (add to the corner check), tests.
- Head:
  - kicker "Your shop";
  - sub "What you sell, how people pay, and how it reaches them.";
  - actions "See your shop" (white) and "+ Add item" (primary).
- Tab chips with counts (Items n, Discounts n); the `?tab=` URL kept.
- "Shop open" card `.xready`:
  - title "Shop open" / "Customers can order from your shop now." (closed or paused copy from the existing `storeGapMessage`);
  - Switch;
  - a `.xchk` 3-column checklist from `storeGaps`: "Switch an item on" / "{n} items in your shop", "A way to pay" / "CHIP and DuitNow QR", "Getting it to them" / "Pickup & delivery", each a link to its tab, with a green tick when done.
- Filter bar:
  - chips All / In your shop / Hidden / Digital with live counts;
  - search "Search your items";
  - "No items match. Try another word, or add an item.".
- Grid `.items` (3, then 2 at 1100 or less per `Dash.html` 935, then 1 at 760 or less per 954), `.it` cards:
  - photo or tint;
  - name and price line (`ownerPriceLine`; digital adds "· Digital, sent by email", a session shows the next time);
  - footer `.ft` (min-height 32) with "{n} sold in 30 days" / "{n} enquiries in 30 days" (Ask items) / "{booked} of {seats} seats taken" (next session), and the Switch `aria-label="Show {name} in your shop"`;
  - off: the card greys and the footer reads "Hidden from your shop";
  - hover lift (`Dash.html` 57 in the diff);
  - a "+ Add an item" tile.
- Reordering per Q4.
- "About your shop" grouped field and the "Halal shop" switch row stay under the grid.
- Phone preview per Q4.
- Tests: the filters, search and counts; footer wording for each kind; hidden state; switch labels; checklist links switch tabs.

**T2.2 Payment tab** (a)
- Files: `payment-tab.tsx`, `pay-preview.tsx` (if kept), `bank-picker.tsx`, `store.module.css`.
- Layout: `xrow` (240px heading and note | fields).
- Online payments:
  - connected: `.xcard` with a green `.xok`, "Connected to CHIP", the brand and checked line, Test with RM1, Disconnect;
  - not connected: "Let customers pay online" with the four green-dot bullets and "Connect CHIP" with the five steps verbatim, Brand ID and Live key fields (16px box), "Check and connect", and "No account yet? Sign up".
- DuitNow QR: a card with the QR image, "Your QR is ready", Change and Remove.
- Bank account: a grouped `fg` box of three rows with a green "Saved" each, then "Money goes straight to you. Curios never holds it." with a shield.
- Tests: the existing behaviour stays green, and the step copy is verbatim.
- Screens: `store-payment(-dark)`, `store-payment-connect`, tablet.

**T2.3 Pickup & delivery tab with the place side sheet** (b)
- Files: `delivery-tab.tsx`, `pickup-places.tsx`.
- Pickup row: Allow pickup Switch; place list `.xli`; "Edit" and "+ Add a pickup place" (`.xadd`) open the **SideSheet**:
  - fields name, address, map link, note;
  - choice cards Any time or Set times;
  - time rows (day, from, to, limit);
  - footer: primary pill and red "Remove place".
- Delivery: choice cards (radio dot, bold label, one line; 1.5px ink ring selected) No delivery / Flat fee / Rider, then the fee and the note.
- Notice: `.xstep` stepper (40px round buttons, 80px value) and `.xdays` closed-day pills.
- Choice cards, grids and time rows stack on a phone.
- Tests: the sheet opens, saves and removes; choice cards have radio semantics.
- Screens: `store-delivery(-dark)`, `store-place`, tablet, phone.

**T2.4 Discounts with the voucher side sheet** (b)
- Files: `vouchers-tab.tsx`.
- List rows; "+ Add voucher" or a tap opens the SideSheet "New voucher / Take money off an order.":
  - How customers get it: Automatic or Code choice cards;
  - Code field with the "3 to 20 letters and numbers…" hint;
  - What it takes off: Percent or Amount;
  - amount with an "RM" prefix;
  - Applies to: day-style pills (Whole order plus items);
  - minimum spend, last day, uses.
- Footer: primary pill and red "Delete voucher".
- Tests: the existing form rules held inside the sheet.
- Screens: `store-discounts(-dark)`, `store-voucher(-dark)`, tablet.

**T2.5 Item editor screen and Adjust photo** (a/b)
- Files: `item-editor.tsx`, `digital-fields.tsx`, `item-photos.tsx`, `photo-cropper.tsx`, `store-editor.tsx` (render the editor as a full screen with "‹ All items"; add `?item=<id|new>` so the browser back button works; Store stays current in the nav).
- Layout: `.xsplit` (`minmax(0,1fr) 300px`, gap 40); rows `200px | fields`; sticky preview at 1250px and up (`.xprev`: "PREVIEW" label, the item card in the owner's theme, reusing the existing preview item).
- Physical rows: photos (96px tiles, a "Cover" badge, an add tile), name and about, category and code, how they order (choice cards; "Ask for a price" reveals the starting price), price (segment One price / Options, with option rows and ✕), the in-your-shop Switch, red "Delete item".
- Digital: "What it is" choice cards (Files / A link / Codes / A session), each with its fields. Session: length, seats, Online or In person segment, meeting link, time rows `.xslot` with a seats bar.
- Adjust photo in the shared **Dialog**: "Drag or use the arrow keys to move it. Your shop shows the square.", zoom − / slider / +, Remove photo (red), Replace picture (link), Use photo.
- Tests: the back link and URL; the Ask reveal; options add and remove; the cropper keys inside Dialog.
- Screens: `item(-dark)`, `item-ask`, `item-crop`, `itemd-files/codes/session(-dark)`, tablet, phone.

### Batch 3: Facts & sources, and Review

**T3.1 Facts tab** (a/b)
- Files: `knowledge/page.tsx`, `tabs.tsx`, `facts-tab.tsx`, `knowledge.module.css` (1602 lines; add to the corner check), tests.
- Head:
  - kicker "Knowledge";
  - sub "Everything your page knows, and where it learned it.";
  - actions "Try your page" (white, opens the Ask sheet from T3.2) and "+ Add a fact" (primary, focuses the add field).
- Tab chips with counts.
- One-line add: field "One line, like: Eggless available for kek coklat", Add, hint "Facts you add are trusted straight away. No review needed.". Keep the existing category pick, as compact chips after the field.
- Filter bar: category chips with counts, search "Search your facts".
- Table `.tbl`:
  - grid `110px minmax(0,1fr) 170px 40px`, rows min-height 52;
  - header row `.tr.h` muted;
  - category `t-grey` tag;
  - fact at 500;
  - From: a source link (`sourceUrl`) or "You wrote this";
  - ··· `.xmore` 32px (44px at 760 or less), `aria-label="More actions for this fact"`, opening a small Popover with Edit and Remove (the existing actions and confirm);
  - "No facts match. Try another word.".
- Fix the dark biru count box.
- Tests: chips filter; search no-match; source links; ··· size and label; edit and remove still work.
- Screens: `facts(-dark)`, phone.

**T3.2 Sources, Pinned, Never say, and the Ask sheet** (a/b)
- Files: `sources-tab.tsx`, `pinned-tab.tsx`, `never-say-tab.tsx`, `ask-panel.tsx`.
- Sources: "Add a source" `.xcard` ("Links and text Curios reads to learn about you. New facts go to Review first.", the `.xseg` A link / Paste text / A file, the field and "Read it"); list rows `.xli` with a Link/Text/File key, "Read Mon 2 Nov · 8 facts", `t-ok` Read or `t-wait` Reading, "Read again", ✕; hint "Some sites, Instagram and TikTok especially, do not let us read them. Paste the text instead.".
- Pinned: lead "Your answers from Questions. The chat repeats your words exactly, every time." and rows with Edit (to `/app/questions?topic=`) and ✕.
- Never say: the board lead verbatim.
- Ask your page moves into the **SideSheet**. Each answer shows its source line (`.xa em` green "From your facts" / "From your answer").
- Screens: `facts-sources(-dark)`, `facts-pinned`, `facts-never`, `facts-ask`, tablet.

**T3.3 Review** (b)
- Files: `review/page.tsx`, `review-queue.tsx`, `fact-card.tsx`, `publish-button.tsx`, `review.module.css` (corner check), `packages/core/src/help/faq.md` (line 46) plus `gen:help`.
- Head:
  - kicker "Knowledge";
  - sub as now;
  - action "+ Add another source".
- Publish card `.xpub` at the top of the main column:
  - live: green `.xok`, "Your page is live / Accepted facts show up on it straight away. There is nothing to publish.";
  - not public: amber "!", "Your page is not public yet / Publish it when you are ready. After that, facts you accept show up on it straight away." with a Publish pill.
- Progress `.xprog`: "**{n} left** to check", a single bar (`role=progressbar`, `aria-valuenow` = done), "{done} of {total} done" (hidden at 760 or less).
- Card `.fact2`: category tag, "from {source}", claim h2, the reason line, a "A customer might ask" quote block, buttons Fix it (white) / Skip (white) / Accept (primary); `.xkeys` "F Fix it · S Skip · A Accept" (hidden on a phone).
- Keyboard: F opens edit, S skips (Q1), A accepts; ignored while typing in a field.
- Side `.side3`: "Up next {n}" with mini cards "Next" / "Then", and "Done {n}" with mini cards labelled green "Accepted", or "Skipped" / "Removed" per Q1, claim at full contrast.
- Empty: EmptyPeek "Nothing to review yet", the existing line, Add a source, Write a fact yourself; plus the not-public card.
- All done: EmptyPeek "Nothing left to review" / "Everything you accepted is already live on your page." with "See your facts".
- Fix the 3px overflow at 1366×768 and verify `scrollHeight <= innerHeight`.
- Tests: the keys (and not when focus is in a textarea); counts; done label contrast; publish states; empty and done states.
- Screens: `review(-dark)`, `r-empty`, `r-done`, phone.

### Batch 4: My Curios, Billing, Settings (and optionally Onboarding)

**T4.1 My Curios profile and appearance** (a/b)
- Files: `curios/my-curios.tsx`, `profile-editor.tsx`, `cover-editor.tsx`, `appearance-editor.tsx`, `curios.module.css` (18 biru; corner check), `faq.md:60` plus `gen:help`.
- Head:
  - kicker "Your page";
  - sub "How your page looks to everyone who taps your link.";
  - the `curios.my/ keklina` address, View page, Saved.
- Profile and Links tabs.
- Grouped Name + Bio box with the 61/160 counter.
- Cover tiles.
- Colours:
  - Page / Buttons swatch rows; each swatch named (`aria-label`), and the selected one gets a tick (not only a ring);
  - the hex chip reads `#b5294e`, no space; tapping it opens the custom colour field;
  - error "Type a colour as six-digit hex, like #eaf0ff.".
- Buttons and font:
  - the four style cards relabelled Soft / High contrast / **Outlined** (CHUNKY) / **Glass** (OUTLINE); values unchanged; DEVIATIONS row for the name mapping;
  - font chips each set in their own font.
- The preview keeps the owner's theme in dark.
- Tests: names, ticks, hex text, the font-family style on chips, style labels.
- Screens: `mycurios(-dark)`, `mc-buttons`, phone.

**T4.2 Links tab** (a)
- `links-editor.tsx`, `socials-editor.tsx`: "Your links · drag to reorder" `.lr` rows, socials `.sp` rows.
- Screens: `links(-dark)`.

**T4.3 Billing** (a)
- Files: `billing/page.tsx`, `pay-buttons.tsx` (Add a month in the shared Dialog), `auto-renew.tsx`, `upgrade-button.tsx`, `billing.module.css` (14 biru; corner check).
- Head:
  - kicker "Account";
  - sub "Your plan, this month’s usage and what you have paid.".
- State cards `.xcard.xst`, copy verbatim from 1636: Auto-renew is on / Turn off with its confirm; renewal failed with Pay another way and Turn off auto-renew; Selling something? → two-step "Yes, switch. This can’t be undone" / "Keep it personal".
- Plan card `.pc2`: "18 days left. Paid until 2 Dec 2026.", the no-auto-renew or renews line, bar.
- Option cards Monthly RM49 / Yearly "2 months free" RM490.
- "Pay RM49" row with "FPX, e-wallet or card, through CHIP. It adds to the time you already have.".
- Usage boxes at natural height.
- Payments table: amounts in ink 600, right-aligned, tabular; the new row tinted.
- Tests: the existing ones green; amounts tabular (CSS contract).
- Screens: `billing(-dark)`, `billing-pay`, `billing-renew(-dark)`, `billing-renewfail`, `billing-personal`, `payment-paid/failed`, phone, plus `banner-ended`.

**T4.4 Settings** (a)
- Files: `settings/*.tsx`, `settings.module.css`.
- Head:
  - kicker "Account";
  - sub "Your address, how you sign in, and what we email you about.".
- Sections `.sec2` / `.setl`, copy verbatim from 1648. Switches move to the shared Switch.
- "Add password" opens its field in place.
- "Search engines" only on a personal page.
- "Connect Google" only when Google is not connected.
- Keep the locked "Your plan is ending" row and log a DEVIATIONS row against the board's movable switch.
- The "A question is asked 3 times" row is **not built here** (Batch 6).
- Render the push card with dev VAPID keys for the shot (P16).
- Screens: `settings(-dark)`, `settings-password`, `set-push`, phone.

**T4.5 (optional) Onboarding** (a): `onboarding/*` against `Calm-More-ob1..ob4`. Fields stay pills.

### Batch 5: Customer-facing (order page, FAQ index, legal)

**T5.1 Customer order page** (a)
- Files: `app/[handle]/order/[token]/order-view.tsx`, `pay-box.tsx`, `receipt-upload.tsx`, `pay-failed.tsx`, `digital-section.tsx`, `order.module.css`; `shop/checkout/placed.tsx` ("See your order").
- Follow More 1067+ CSS and the 1154 markup. Layout:
  - status pill (`co-pill`: wait, ok, red);
  - 4-step bar (3 for digital);
  - state block;
  - "What you ordered";
  - WhatsApp;
  - "Keep this page".
- All states from `shop/copy.ts` (EN and MS):
  - wait: QR with "Save the QR to your phone", bank with Copy, Upload your receipt;
  - checking: "Upload a different receipt";
  - paid with Ref;
  - ready;
  - done;
  - refund due;
  - digital: files with downloads left, Join the class with Add to calendar, code with Copy;
  - failed: the 30-minute hold with Pay again and Pay another way.
- Owner's theme only: no calm tokens, no `app/app/**` or `_peek` imports.
- Tests:
  - the existing `order.test.tsx` and `order.digital.test.tsx` green;
  - **a new guard test**: no file under `app/[handle]/**` imports `app/app/` or `_peek/`.
- Screens: every `Calm-More-co_*`, desktop and phone, in two owner themes (Kek Lina-like maroon and the seed page's), with dark OS emulated to prove the owner's theme holds.

**T5.2 Pickup "Add to calendar"** (web route change, no schema; see Q7)
- Files: `order/[token]/calendar/route.ts`, `ics.ts`, `order-view.tsx`.
- `?pickup=1` builds an .ics from `day`, `pickupFrom`, `pickupTo`, `pickupPlaceName` and `pickupPlaceAddress`. Same token credential, `private, no-store`, 404 otherwise.
- Tests: route tests for paid and unpaid per Q7, wrong handle, no window.

**T5.3 FAQ index** (b)
- Files: `[handle]/faq/page.tsx`, `faq-list.tsx`, `faq.module.css`.
- "Questions about {name}". Each row is the question plus the first line of its answer (clamp 2 lines, server-side excerpt about 140 chars on a word boundary), linking to the entry.
- Keep no FAQPage JSON-LD; update the comment.
- Owner theme.
- Screens: `Calm-More-cfaqi`, `Calm-More-cfaq`.

**T5.4 Legal pages** (a)
- Files: `_legal/LegalPage.tsx`, `legal.module.css`; reuse the calm landing nav and footer from `_landing`.
- Values per `Site.html` 670–688 and 716:
  - `.lg-h` max-width 1100, padding `56px 24px 40px`, title 56px (38px on a phone);
  - meta 14px muted plus the language pill toggle;
  - lead 18px, 40em max;
  - doc pills 14px/500, on = soft fill and 600;
  - `.lg` grid `240px minmax(0,1fr)`, gap 60;
  - sections lined, padding 28 0;
  - h2 24px/600/-.025em with a mono 13px number;
  - p 16.5px/1.65;
  - links underlined, offset 3.
- The faint number colour becomes a decoration token. Body `#3e3c38` is `--cl-text-3`.
- Laptop-scale marker stays.
- Tests: `legal.test.tsx` green; the doc pills `aria-current`.
- Screens: `Calm-Site-terms/privacy/refunds/returns`.

### Batch 6: Needs schema, API or worker (not a restyle; only if the owner says yes)

- **6.1 "A question is asked 3 times" email** (Q6):
  - Prisma `Page.notifyQuestions Boolean @default(false)` plus a migration;
  - the read in `notifications.query.ts`;
  - the settings PATCH in `apps/api`;
  - a trigger where the third ask lands (`apps/api/src/modules/chat/chat.service.ts` ~677 already detects the third ask for FAQ slugs);
  - a mail template in `@curios/core` (Emails board layout);
  - the Settings row (Switch, default off as on the board).
  - Tests at each layer.
- **6.2 (only if Q1 is answered "Skip is remembered")**: `Fact.skippedAt` plus a migration, an API `POST /facts/:id/skip`, and a review query that orders skipped facts last.

---

## 4. Order and dependencies

- **Batch 1:** T1.1 and T1.2 in parallel; then T1.3 and T1.4 in parallel; then T1.5, T1.6 and T1.7 (parallel is safe: separate folders).
  - Shared-file conflict watch: `inbox.module.css`, `page-head`, `tokens.css`, `design-rules.test.ts`. One owner each; later tasks only append.
- **Batch 2:** T2.0, then T2.1; T2.2, T2.3 and T2.4 in parallel; then T2.5.
- **Batch 3:** T3.1, T3.2 and T3.3 in parallel (T3.2 owns `ask-panel`, T3.1 owns `facts-tab` and `tabs`).
- **Batch 4:** all parallel.
- **Batch 5:** T5.1, then T5.2; T5.3 and T5.4 in parallel.
- **Batch 6:** only after the owner's answers.
- Each batch ends with a whole-batch review, a full gate run, and the controller's screenshot pass before the owner ships.

---

## 5. Open questions for the owner

1. **Review "Skip".** The board has Fix it / Skip / Accept and no Reject.
   - Recommended: Skip leaves the fact pending and moves it to the back of the queue (client-only, it comes back next visit), and "Remove this fact" (today's Reject) moves into Fix it.
   - Or should Skip be remembered across visits (Batch 6.2)?
2. **Lead ring "of 4 details".** Recommended: the number counts as the first detail, plus the three picked-out ones (chat: Wants/When/Where; enquiry: When/For/Budget). A new lead starts at 1 "Start with hello" and reaches 4 "Ready to quote". OK?
3. **Orders "Older orders" label.** What splits the list? Recommended: orders placed before the last 7 days (the same week as the "This week" card), with the existing "Older orders" pager kept at the foot for the 100+ case.
4. **Store layout.**
   - The board drops the phone preview beside Store's tabs (it stays in the item editor at 1250px and up). Drop it?
   - The card grid has no move up/down. Keep reordering (for example a "Reorder" mode), or drop it?
5. **Questions filters.** The board has All / Needs you / Answered. Drop the repo's "Chat answers" filter (old links keep working)?
6. **"A question is asked 3 times" email** (board Settings). Build it (Batch 6.1: schema, API, mail), or leave the row out?
7. **Pickup "Add to calendar"** says "always". Also before the order is paid?

### Critical Files for Implementation
- C:\Users\User\Desktop\Projects\curios\apps\web\app\app\_ui\inbox.module.css
- C:\Users\User\Desktop\Projects\curios\apps\web\app\app\_ui\page-head.tsx
- C:\Users\User\Desktop\Projects\curios\packages\db-read\src\orders.query.ts
- C:\Users\User\Desktop\Projects\curios\apps\web\app\app\orders\order-detail.tsx
- C:\Users\User\Desktop\Projects\curios\packages\ui\src\tokens.css

## 6. Owner answers (19 Nov 2026)

- Q1 Review Skip: back of the queue for this visit, client-only; "Remove this fact" moves inside Fix it. Batch 6.2 is dropped.
- Q2 Lead ring: the number is detail 1, plus the three picked-out ones (chat: Wants/When/Where; enquiry: When/For/Budget). 1 "Start with hello" → 4 "Ready to quote".
- Q3 Orders "Older orders": orders placed before the last 7 days; the existing pager stays at the foot.
- Q5 Questions filters: drop "Chat answers"; old links still open the page.
- Q4a Store phone preview (20 Nov): keep it beside Store's tabs, a departure from the board (log it in DEVIATIONS in Batch 2).
- Q4b Reordering (20 Nov): add a "Reorder" mode; the default view stays the board's grid, Reorder turns it into a list with move up/down.
- Still open (ask before their batch): Q6 the "asked 3 times" email, Q7 pickup Add to calendar before payment.
