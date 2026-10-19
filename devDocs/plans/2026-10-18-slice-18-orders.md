# Slice 18 — Orders: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a visitor checks out the basket on a business page, pays the owner directly by their QR or bank transfer, uploads a receipt on their order page and can ask the chat where the order is; the owner checks receipts and moves orders on from `/app/orders`, and is emailed at each step.

**Architecture:** pure rules in `packages/core` (`plan.ts` gains the order allowance; a client-safe `@curios/core/orders` holds totals, dates, codes and the order's views); `Order`/`OrderLine` tables and new `Page` columns; a public order API (placement, receipt) and an owner order API (transitions) in `apps/api/src/modules/orders`, shaped like `leads`; reads in `packages/db-read`; checkout, the placed screen and the order page under `apps/web/app/[handle]/`; `/app/orders` in the dashboard; order emails through the existing `mail` queue; order chips and an order lookup in the chat.

**Tech Stack:** TypeScript, Prisma 6 / Postgres 16, Fastify 5 + zod, BullMQ, Next.js 15 App Router + React 19, CSS Modules, Vitest + Testing Library.

**Spec:** [`devDocs/store-design.md`](../store-design.md) (the decisions and data), and the design handoff boards it is drawn from: `design/boards/Orders.dc.html`, `Public.dc.html` (routes `checkout`, `placed`, `order`, `ask`), `Emails.dc.html` (`order`, `receipt`), `Alerts.dc.html` (`paused`), with screenshots in `design/screens/`. Read both before starting; every screen is built from its board, as the rest of the design pass was (`design/HANDOFF.md`).

## Global Constraints

- **Follow the boards** (owner, 2026-10-17): where a board's copy differs from the repo, the board's wins; every departure gets a row in `design/DEVIATIONS.md` (next free number: 101).
- Money is integer sen (`Int`) everywhere, in storage and on the wire. The server computes every total; a client total is only ever compared, never stored.
- Business pages only: every order route refuses a personal page with `STORE_BUSINESS_ONLY` (reuse `storePageFor`'s rule); the shop never offers checkout on one.
- Orders are allowed by `canTakeOrders()` alone (Task 1). Nothing else decides it, so the shop, the API, Alerts and Billing cannot disagree.
- Every owner transition is a conditional `updateMany` on the expected current status (a double tap changes nothing the second time); owner routes 404 another owner's order.
- The order link's secret is 32 random bytes, base64url; only `hashSessionValue(token)` is stored (`Order.tokenHash`).
- The order code is 4 characters from `23456789ABCDEFGHJKMNPQRSTUVWXYZ` (no 0/O/1/I/L), unique per page; it is what a customer says to the chat, never a secret on its own (the chat also asks the last 4 phone digits).
- Dates are calendar days in Malaysia (`Asia/Kuala_Lumpur`), stored as `@db.Date`.
- Receipts: JPEG, PNG, WebP or PDF, at most 5 MB, checked by first bytes (`decodeImage`'s approach); stored under `receipts/<pageId>/<32 random hex>.<ext>` so the URL cannot be guessed. A second upload replaces the first until the order is `PAID`.
- New error codes go in `DOMAIN_ERROR_CODES` (`apps/api/src/plugins/errors.ts`) or the client sees `INTERNAL_ERROR`.
- Client components never import the `@curios/core` barrel at runtime; they use subpaths (`@curios/core/orders`, `@curios/core/store`).
- CSS modules: every selector carries a local class (`next dev` refuses otherwise; gates do not catch it — load the page). Hex colours only in `packages/ui/src/tokens.css`.
- Owner decisions for this slice (2026-10-18), each also a DEVIATIONS row in Task 13:
  1. **Closed days and a delivery note** are added to Store settings (checkout draws them; the Store board does not).
  2. The placed screen's "We also sent the order link to your WhatsApp" becomes a **"Send the link to my WhatsApp"** button (`wa.me/<their number>?text=<order link>`); Curios sends no WhatsApp.
  3. **Not received**: beside Mark paid while a receipt is in; clears the receipt (`receiptRejectedAt` set) and the order page asks the customer to pay and upload again.
  4. The customer's **Ready** step lights when the order is `PAID` and its day (Malaysia) has come; **Done** when `COMPLETED`.
- Verification: `pnpm turbo run typecheck lint test --concurrency=1 --force`, read by exit status, never piped. After any change under `apps/web`, load the affected page in `pnpm dev`.

## Review Focus

1. **Two visitors take the last free order at once.** Exactly one order is placed; the other gets `ORDERS_PAUSED` and the shop's WhatsApp fallback. Pinned in Task 4 (`places one of two simultaneous last orders`).
2. **A price changes between loading the shop and checking out.** Refused with `PRICES_CHANGED` and the current shelf; nothing is stored. Pinned in Task 4.
3. **A checkout date the shop can't do** (inside the notice period, a closed weekday, the past, more than 60 days out). Refused per field with `ORDER_DATE`. Pinned in Task 1 (`isOrderDay`) and Task 4.
4. **Receipt upload after the owner marked the order paid, or with a PDF renamed .jpg.** Refused (`ORDER_ALREADY_PAID`, `INVALID_RECEIPT`); the stored receipt is untouched. Pinned in Task 5.
5. **"Where's my order 7Q4M?" with the wrong last 4 digits, or a code from another page.** Says the digits don't match / that code isn't one of this shop's; never shows the order. Pinned in Task 11.

---

## File map

| File | Responsibility |
|---|---|
| `packages/core/src/plan.ts` (+ test) | `FREE_ORDERS`, `orderState`, `canTakeOrders` |
| `packages/core/src/orders.ts` (+ test), `package.json` `./orders` | Totals, order days, codes, the order's views and the customer's steps |
| `packages/core/src/order-mail.ts` (+ test) | "New order #12 · RM190" and "Receipt uploaded for #12" |
| `packages/db/prisma/schema.prisma`, `migrations/20261019090000_orders/` | `Order`, `OrderLine`, enums, Page columns |
| `apps/api/src/modules/store/settings.service.ts`, `store.routes.ts` | Closed days, delivery note |
| `apps/api/src/modules/orders/order.errors.ts` | The slice's error classes |
| `apps/api/src/modules/orders/place.service.ts` (+ test) | Placing an order |
| `apps/api/src/modules/orders/receipt.service.ts` (+ test) | Receipt upload by token |
| `apps/api/src/modules/orders/owner.service.ts` (+ test) | Owner transitions |
| `apps/api/src/modules/orders/order.routes.ts` (+ `order.routes.test.ts`) | Public and owner HTTP |
| `apps/api/src/plugins/rate-limit.ts`, `app.ts`, `.env.example` | Order and receipt limits, registration |
| `apps/api/src/modules/billing/billing.service.ts` | Trial reset covers orders |
| `packages/db-read/src/orders.query.ts` (+ test) | Owner list, stats, badge count; the order by token; the shop's checkout data |
| `apps/web/app/[handle]/shop/*` | Basket's Checkout button |
| `apps/web/app/[handle]/shop/checkout/*` | Checkout and the placed screen |
| `apps/web/app/[handle]/order/[token]/*` | The order page and receipt upload |
| `apps/web/app/app/orders/*`, `app-frame.tsx`, `layout.tsx` | `/app/orders`, nav item and badge |
| `apps/web/app/app/alerts.ts`, `store/*`, `billing/*`, `settings/*` | Paused banner, Store reason, Billing meter, email switches |
| `apps/api/src/modules/chat/*`, `packages/ui/src/chat/*` | Order chips, the order lookup and its card |
| `apps/workers/src/housekeeping/retention.ts` (+ test) | Orders past 12 months, and their receipts |
| `apps/web/app/_landing/*`, `_auth/AuthFilm.tsx` | Rows 1 and 3: the promises, now true |

---

### Task 1: The order rules

**Files:**
- Modify: `packages/core/src/plan.ts`, `packages/core/src/plan.test.ts`
- Create: `packages/core/src/orders.ts`, `packages/core/src/orders.test.ts`
- Modify: `packages/core/package.json` (`"./orders"` export, as `./store`), `packages/core/src/index.ts`

**Interfaces:**
- Produces (plan.ts):
  - `FREE_ORDERS = 3`
  - `interface OrderInput { mode: 'PERSONAL' | 'BUSINESS'; paidUntil: Date | null; ordersPlaced: number; ordersAtTrialReset: number; now: Date }`
  - `type OrderState = { kind: 'personal' } | { kind: 'paid'; paidUntil: Date } | { kind: 'trial'; used: number; remaining: number } | { kind: 'trialSpent' } | { kind: 'lapsed'; paidUntil: Date }` — built like `planState`, counting `ordersPlaced - ordersAtTrialReset`.
  - `orderState(input: OrderInput): OrderState`; `canTakeOrders(input: OrderInput): boolean` (paid or trial).
- Produces (orders.ts, imports nothing outside itself):
  - `ORDER_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'`, `orderCode(random: () => number = Math.random): string` (4 chars).
  - `ORDER_DAYS_AHEAD = 60`, `NAME_MAX = 60`, `ADDRESS_MAX = 240`, `ORDER_NOTE_MAX = 280`, `RECEIPT_MAX_BYTES = 5_242_880`.
  - `malaysiaToday(now: Date): string` (`YYYY-MM-DD`).
  - `isOrderDay(day: string, s: { now: Date; minNoticeDays: number; closedDays: number[] }): boolean` — `closedDays` are weekdays, 0 = Sunday.
  - `openDays(s: { now: Date; minNoticeDays: number; closedDays: number[] }, count: number): string[]` — the next `count` days `isOrderDay` accepts.
  - `orderTotals(lines: { unitCents: number; quantity: number }[], delivery: { method: 'PICKUP' | 'DELIVERY'; mode: 'NONE' | 'FLAT' | 'RIDER'; feeCents: number | null }): { itemsCents: number; deliveryCents: number; totalCents: number }` — rider and pickup add 0.
  - `type OrderView = 'awaitingPayment' | 'toCheck' | 'paid' | 'completed' | 'refundOwed' | 'refunded' | 'cancelled'`; `orderView(o: { status: OrderStatus; receiptUploadedAt: Date | null; paidAt: Date | null; refundedAt: Date | null }): OrderView` (the Orders board's `view()`).
  - `customerSteps(o: { status: OrderStatus; paidAt: Date | null; day: string }, now: Date): { placed: true; paid: boolean; ready: boolean; done: boolean }` — decision 4.

- [ ] **Step 1: Write the failing tests** — `plan.test.ts`: `orderState` walks personal, paid, trial (0, 2 used), trialSpent, lapsed, and after a reset (`ordersPlaced 5, ordersAtTrialReset 3` → trial, used 2); `canTakeOrders` agrees with `orderState` for every case. `orders.test.ts`:
  - `orderCode` with a fixed `random` returns 4 chars, all in the alphabet.
  - `isOrderDay`: at 2026-10-18 23:30 Malaysia (15:30Z), `minNoticeDays 2`, closed `[0]`: `'2026-10-19'` false (notice), `'2026-10-20'` true, `'2026-10-25'` false (a Sunday), `'2026-12-31'` false (past 60 days), `'2026-10-17'` false.
  - `openDays(..., 5)` returns five accepted days in order.
  - `orderTotals`: options × quantities; FLAT 1000 adds 1000 on DELIVERY, 0 on PICKUP; RIDER adds 0.
  - `orderView` for each of the board's six badges ("Awaiting payment", "To check", "Paid", "Completed", "Refund owed", "Cancelled") plus refunded.
  - `customerSteps`: PAID with today before the day → ready false; on the day → ready true; COMPLETED → done.
- [ ] **Step 2: Run** `pnpm --filter @curios/core exec vitest run src/plan.test.ts src/orders.test.ts` — expect failures (not defined).
- [ ] **Step 3: Implement** the signatures above. `malaysiaToday` uses `Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' })`.
- [ ] **Step 4: Run** the same command — expect PASS.
- [ ] **Step 5: Commit** `feat(orders): the order rules -- allowance, days, totals, codes, views`.

### Task 2: The data

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/20261019090000_orders/migration.sql` (hand-written; never `migrate diff` against the test DB)

**Interfaces:**
- Produces:
  - `enum OrderStatus { PLACED PAID COMPLETED CANCELLED }`, `enum OrderMethod { PICKUP DELIVERY }`.
  - `model Order { id, pageId (cascade), number Int, code String, tokenHash String @unique, customerName, phone, method OrderMethod, day DateTime @db.Date, address String?, note String?, itemsCents, deliveryCents, totalCents, receiptKey String?, receiptType String?, receiptUploadedAt DateTime?, receiptRejectedAt DateTime?, status OrderStatus @default(PLACED), paidAt?, completedAt?, cancelledAt?, refundedAt?, createdAt; lines OrderLine[]; @@unique([pageId, number]); @@unique([pageId, code]); @@index([pageId, createdAt]) }`.
  - `model OrderLine { id, orderId (cascade), itemId String? (Item, SetNull), itemName, optionLabel String?, unitPriceCents Int, quantity Int, position Int }`.
  - `Page`: `ordersPlaced Int @default(0)`, `ordersAtTrialReset Int @default(0)`, `closedDays Int[] @default([])`, `deliveryNote String?`, `notifyOrders Boolean @default(true)`, `notifyReceipts Boolean @default(true)`.
  - `Conversation.pendingOrderId String?` (Task 11's lookup waits on it; `SetNull` when the order goes).
- [ ] **Step 1:** Write the schema and the SQL. Comment each new column in the schema's voice (why, not what).
- [ ] **Step 2:** Apply: `DATABASE_URL=<dev> pnpm --filter @curios/db exec prisma migrate deploy`, the same with the test URL, then `prisma generate`.
- [ ] **Step 3:** Run `pnpm turbo run typecheck --concurrency=1 --force` — expect PASS (nothing reads the columns yet).
- [ ] **Step 4: Commit** `feat(orders): Order and OrderLine, and the page's order settings`.

### Task 3: Closed days and a delivery note (decision 1)

**Files:**
- Modify: `apps/api/src/modules/store/settings.service.ts`, `store.routes.ts`, `store.routes.test.ts`
- Modify: `packages/db-read/src/shop.query.ts` (`getOwnerStore` and `getPublicShop` carry `closedDays`, `deliveryNote`)
- Modify: `apps/web/app/app/store/delivery-tab.tsx` (+ test), `store-types.ts`
- Modify: `packages/core/src/store.ts`: `DELIVERY_NOTE_MAX = 120` (as `PICKUP_NOTE_MAX`)

**Interfaces:**
- Produces: `PATCH /store` accepts `closedDays: number[]` (each 0–6, unique, at most 6 — a shop open no day is refused with `STORE_NOT_READY`, "Leave at least one day open.") and `deliveryNote: string | null`.

- [ ] **Step 1: Failing tests** — `store.routes.test.ts`: `saves the closed days and the delivery note`; `refuses closing all seven days`; `refuses a weekday outside 0 to 6`. `delivery-tab.test.tsx`: `toggles a closed day and saves it`; `saves the delivery note as typed`.
- [ ] **Step 2:** Run them — expect FAIL.
- [ ] **Step 3: Implement.** In the Delivery tab: a row of seven day pills under "Closed on" (Mon first), and a "Delivery note" field under the delivery mode, styled exactly as the pickup note (placeholder "Around Shah Alam · 2pm to 6pm"). Autosave as the tab's other fields do.
- [ ] **Step 4:** Run — PASS. Load `/app/store` in dev at 1440 and 390.
- [ ] **Step 5: Commit** `feat(store): closed days and a delivery note, for checkout`.

### Task 4: Placing an order

**Files:**
- Create: `apps/api/src/modules/orders/order.errors.ts`, `place.service.ts`, `order.routes.ts`, `order.routes.test.ts`
- Modify: `apps/api/src/plugins/rate-limit.ts`, `errors.ts`, `app.ts`, `.env.example`
- Create: `packages/core/src/order-mail.ts` (+ test) — only `newOrderMail` here; `receiptMail` is Task 5

**Interfaces:**
- Consumes: Task 1 (`canTakeOrders`, `isOrderDay`, `orderTotals`, `orderCode`), Task 2 schema, `normalizeMalaysianPhone`, `hashSessionValue`, `renderMailHtml`, `OWNER_MAIL_FOOTER`, the API's `mailQueue`.
- Produces:
  - `POST /store/:handle/orders`, body `{ lines: { itemId: string; optionId: string | null; quantity: number }[]; method: 'PICKUP' | 'DELIVERY'; day: string; customerName: string; phone: string; address: string | null; note: string | null; consent: true; seenTotalCents: number }` → `201 { number: number; code: string; token: string; totalCents: number }`.
  - Errors (codes and sentences): `ORDERS_PAUSED` 409 "This shop isn't taking orders right now. Send your basket on WhatsApp instead."; `PRICES_CHANGED` 409 with `{ items }` (the current shelf, `getPublicShop`'s shape) "Prices changed since you opened the shop. Check your basket and try again."; `ITEM_UNAVAILABLE` 409 "<name> isn't available any more."; `ORDER_DATE` 400 "Pick one of the days shown."; `METHOD_OFF` 400 "<Pickup|Delivery> isn't offered right now."; `ADDRESS_REQUIRED` 400 "Add the address for delivery."; `INVALID_PHONE` (existing); `STORE_CLOSED` 404 when the Store is off.
  - `newOrderMail(o: { number: number; totalCents: number; customerName: string; phone: string; method: 'PICKUP' | 'DELIVERY'; day: string; note: string | null; lines: { itemName: string; optionLabel: string | null; quantity: number; lineCents: number }[]; url: string }): Mail` — subject `New order #12 · RM190`; heading `<Name> ordered RM190 from your shop`; body line `They pay you directly, by your QR or bank transfer. We’ll email you again when their receipt comes in.` (DEVIATIONS: the board's "She's paying by DuitNow QR" names a method and a pronoun we do not know); the lines box, "Getting it", "Customer", "Note", button `Open order #12` → `/app/orders?order=<id>`; footer `OWNER_MAIL_FOOTER`.
  - `orderPerIpLimit` (`RATE_LIMIT_ORDER_PER_IP`, 10/hour) and `orderPerPageLimit` (`RATE_LIMIT_ORDER_PER_PAGE`, 100/day, keyed on the `handle` param), each in `.env.example` with a one-line comment.
- Placement, in one transaction: lock the page row (`SELECT … FOR UPDATE`, as `grantPayment` does); refuse unless `storeEnabled`, business, `canTakeOrders`; validate lines against available items and their own options; recompute with `orderTotals` and refuse `PRICES_CHANGED` when it differs from `seenTotalCents`; check method, day, address; `number = ordersPlaced + 1`; increment `ordersPlaced`; code by `orderCode()`, retrying on the `[pageId, code]` unique up to 5 times; write `Order` and its `OrderLine` copies. After commit, queue the email when `notifyOrders`.

- [ ] **Step 1: Failing tests** (`order.routes.test.ts`, test DB, a stub mail queue): `places an order and fixes its total on the server`; `copies each line, so a later price change rewrites nothing`; `numbers orders per page, 1 then 2`; `refuses a total the visitor did not see, returning the shelf`; `refuses an item taken down, naming it`; `refuses an option that is not the item's own`; `refuses a closed day, a day inside the notice, and delivery while delivery is off`; `refuses delivery without an address`; `refuses a personal page`; `places one of two simultaneous last orders` (two `Promise.all` placements at `ordersPlaced 2`: one 201, one `ORDERS_PAUSED`, `ordersPlaced` 3); `emails the owner, unless they switched it off`; `limits placements per address`. `order-mail.test.ts`: subject, heading, the lines and total, the button link, every value escaped.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `pnpm --filter @curios/api exec vitest run src/modules/orders` and the core test — PASS.
- [ ] **Step 5: Commit** `feat(orders): place an order, priced by the server, under the page lock`.

### Task 5: The receipt

**Files:**
- Create: `apps/api/src/modules/orders/receipt.service.ts`
- Modify: `order.routes.ts`, `order.routes.test.ts`, `apps/api/src/modules/pages/avatar.ts` (a `decodeReceipt` beside `decodeImage`, adding the PDF signature `%PDF-`), `order-mail.ts` (+ test)

**Interfaces:**
- Produces:
  - `POST /store/orders/:token/receipt` body `{ contentType: string; data: string }` (base64, `bodyLimit` 7 MB) → `200 { receiptUploadedAt: string }`. Errors: `ORDER_NOT_FOUND` 404 (unknown token), `INVALID_RECEIPT` 400 "Upload a photo or PDF of your receipt, up to 5 MB.", `ORDER_ALREADY_PAID` 409 "This order is already paid.", `ORDER_CANCELLED` 409, `STORAGE_NOT_CONFIGURED` 503 (reuse).
  - `receiptPerIpLimit` (`RATE_LIMIT_RECEIPT_PER_IP`, 20/hour).
  - `receiptMail(o: { number: number; totalCents: number; customerName: string; uploadedAt: Date; fileName: string; url: string }): Mail` — subject `Receipt uploaded for #12`; heading `<Name> sent a receipt for order #12`; the board's body and its small line, now true because of decision 3: `Didn’t get the money? Open the order and mark it as not received. <Name> will be asked to try again.`; button `Check the receipt`.
- Behaviour: a new upload stores the new file, sets `receiptKey`, `receiptType`, `receiptUploadedAt`, clears `receiptRejectedAt`, then removes the old object; queues the email when `notifyReceipts`.

- [ ] **Step 1: Failing tests:** `takes a receipt by the order's link alone`; `replaces an earlier receipt and removes its file`; `refuses once the order is paid, keeping the stored receipt`; `refuses a PDF renamed as an image, and a file over 5 MB`; `refuses an unknown link`; `emails the owner`; mail test for `receiptMail`.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** Run — PASS.
- [ ] **Step 5: Commit** `feat(orders): a receipt upload on the order link, and its email`.

### Task 6: The owner's transitions

**Files:**
- Create: `apps/api/src/modules/orders/owner.service.ts`
- Modify: `order.routes.ts`, `order.routes.test.ts`; `apps/api/src/modules/billing/billing.service.ts` (+ its test)

**Interfaces:**
- Produces (signed in, owner-scoped, each `204`; `ORDER_NOT_FOUND` 404 for another owner's; `ORDER_STATE` 409 "This order has already moved on. Refresh to see where it is." when the conditional update matches nothing):
  - `POST /orders/:id/paid` — `PLACED` → `PAID`, sets `paidAt`.
  - `POST /orders/:id/not-received` — `PLACED` with a receipt → clears `receiptKey`/`receiptType`/`receiptUploadedAt`, sets `receiptRejectedAt` (decision 3), removes the file.
  - `POST /orders/:id/completed` — `PAID` → `COMPLETED`.
  - `POST /orders/:id/cancel` — `PLACED` or `PAID` → `CANCELLED`.
  - `POST /orders/:id/refunded` — `CANCELLED` with `paidAt` and no `refundedAt` → sets `refundedAt`.
- `resetTrial` resets the order allowance too: the reset is allowed when `leadsCaptured ≥ 1` **or** `ordersPlaced > ordersAtTrialReset`, and sets `ordersAtTrialReset = ordersPlaced` (never zeroes `ordersPlaced`: order numbers come from it).

- [ ] **Step 1: Failing tests:** one per transition's happy path; `changes nothing the second time` (two `paid` → 204 then 409, `paidAt` unchanged); `404s another owner's order`; `clears a receipt not received, and lets the customer upload again`; billing: `resets the order allowance once, keeping order numbers`.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** Run — PASS.
- [ ] **Step 5: Commit** `feat(orders): mark paid, not received, completed, cancelled, refunded`.

### Task 7: The reads

**Files:**
- Create: `packages/db-read/src/orders.query.ts` (+ test); modify `index.ts`
- Modify: `packages/db-read/src/my-curios.query.ts` (`countNavBadges` gains `orders`: orders `toCheck`)

**Interfaces:**
- Produces:
  - `getOwnerOrders(accountId: string, opts?: { limit?: number }): Promise<OwnerOrder[]>` — newest first, at most 100; `OwnerOrder = { id; number; code; customerName; phone; method; day: string; address; note; itemsCents; deliveryCents; totalCents; status; receiptUrl: string | null; receiptType: string | null; receiptUploadedAt; receiptRejectedAt; paidAt; completedAt; cancelledAt; refundedAt; createdAt; lines: { itemName; optionLabel; unitPriceCents; quantity; photoKey: string | null }[] }` (`receiptUrl` joined from `STORAGE_PUBLIC_URL` at the web layer, as avatars are — keep `receiptKey` here).
  - `getOrderStats(accountId: string, now?: Date): Promise<{ toCheck: number; toMake: number; paidThisWeekCents: number; week: number[] }>` — the board's three figures; `week` is paid sen per day, oldest first.
  - `getOrderByToken(token: string): Promise<PublicOrder | null>` — the order, its page's handle/displayName/look, payment details (QR key, bank fields) and WhatsApp-able links; null for an unknown token.
  - `getCheckout(handle: string, now?: Date): Promise<Checkout | null>` — the shop (as `getPublicShop`) plus `pickupEnabled`, `pickupNote`, `deliveryMode`, `deliveryFeeCents`, `deliveryNote`, `minNoticeDays`, `closedDays`, `canTakeOrders: boolean`; null for a personal page or a closed Store.
  - `NavBadges` gains `orders: number`.
- [ ] **Step 1: Failing tests** for each function on the test DB (scoping: another owner's orders never appear; an unknown token is null; `toCheck` counts only `PLACED` with a receipt; `paidThisWeekCents` leaves cancelled orders out).
- [ ] **Step 2–4:** FAIL, implement, PASS.
- [ ] **Step 5: Commit** `feat(orders): the reads for the owner, the order page and checkout`.

### Task 8: Checkout and the placed screen

**Files:**
- Create: `apps/web/app/[handle]/shop/checkout/page.tsx`, `checkout.tsx` (client), `checkout.module.css`, `checkout.test.tsx`, `placed.tsx`
- Modify: `apps/web/app/[handle]/shop/shop-view.tsx` (+ test), `copy.ts` (+ test; Malay copy beside English, as the shop has)

**Interfaces:**
- Consumes: Task 7 `getCheckout`, Task 4's endpoint and errors, Task 1 `openDays`, `orderTotals`, the basket's localStorage key (`defaultStorageKey(handle)` in shop-view).
- Produces: `/[handle]/shop/checkout` (`notFound()` when `getCheckout` is null; when `!canTakeOrders` it sends the visitor back to the shop, whose bar is the WhatsApp fallback).

- [ ] **Step 1: Failing tests** — `shop-view.test.tsx`: `offers Checkout when orders are allowed, and Order on WhatsApp when they are not` (the Alerts board's paused phone: "Checkout is paused. Send your basket to <Name> on WhatsApp instead."). `checkout.test.tsx`: `lists the basket with steppers and the total`; `shows pickup and delivery as the shop offers them, with their notes and the fee`; `offers only open days, with the notice and closed days said` (`2 days’ notice · closed Sundays`); `holds Place order until name, phone, a day and (for delivery) the address are in`; `sends what the visitor saw and shows the placed screen with the code`; `reloads the basket when prices changed, saying so`; `falls back to WhatsApp when the shop has just paused`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implement from the Public board's `checkout` and `placed` routes.** The placed screen: the check, "Order placed", "<Name> has it. Pay on the next screen to confirm it.", the code chips with "Copy code", "Keep this code. Ask <Name>’s page “where is my order 7Q4M?” any time and it shows you the status.", the button `Pay RM215 now` → `/[handle]/order/<token>`, and under it **decision 2**: a quiet button `Send the link to my WhatsApp` → `https://wa.me/<their number, digits>?text=<encoded order link>`. The basket is emptied once the order is placed.
- [ ] **Step 4:** PASS; load both screens in dev at 1440 and 390 against the board's screenshots.
- [ ] **Step 5: Commit** `feat(shop): checkout, and the placed screen with its code`.

### Task 9: The order page

**Files:**
- Create: `apps/web/app/[handle]/order/[token]/page.tsx`, `order-view.tsx` (client), `receipt-upload.tsx`, `order.module.css`, `order.test.tsx`

**Interfaces:**
- Consumes: Task 7 `getOrderByToken`, Task 5's endpoint, Task 1 `customerSteps`, `orderView`.
- Produces: `/[handle]/order/[token]` — `notFound()` when the token is unknown or belongs to another handle; `robots: { index: false }`.

- [ ] **Step 1: Failing tests:** `shows the order, its code and its total`; `waiting for payment: the QR (with a download button on its corner), the bank details with Copy, and Upload your receipt`; `after upload: Receipt sent, checking`; `not received: asks to pay and upload again` (decision 3, copy "<Name> didn’t receive your payment. Pay again and upload the new receipt."); `paid: the pay box goes, and Ready lights on the day` (decision 4); `cancelled, and refunded`; `WhatsApp <Name> about this order` opens a prefilled message naming the order number and code; `refuses a receipt over 5 MB before sending it`.
- [ ] **Step 2:** FAIL. **Step 3: Implement from the Public board's `order` route.** The status pill words: "Waiting for payment", "Receipt sent · <Name> is checking", "Paid · <Name> is getting it ready" (DEVIATIONS: the board's "baking it" is Kek Lina's trade), "Ready", "Done", "Cancelled", "Refunded". The QR download fetches the image and saves it (a cross-origin `download` attribute is ignored).
- [ ] **Step 4:** PASS; load in dev in each state at both widths.
- [ ] **Step 5: Commit** `feat(orders): the order page, with the receipt upload`.

### Task 10: `/app/orders`

**Files:**
- Create: `apps/web/app/app/orders/page.tsx`, `orders-screen.tsx`, `order-detail.tsx`, `orders.module.css`, tests beside each
- Modify: `apps/web/app/app/app-frame.tsx` (+ test), `layout.tsx`; `apps/web/app/app/alerts.ts` (+ test)

**Interfaces:**
- Consumes: Task 7 reads, Task 6 endpoints, `useToast`, `CountUp`, `alertsFor`.
- Produces:
  - Nav: **Orders** first in the Inbox group, business only, badge = `NavBadges.orders`.
  - `alertsFor` gains the `paused` stop state, shown on Orders: when the Store is on and `!canTakeOrders` — title "Your shop can’t take orders right now", text "Your 3 free orders are used. Customers can still see your shop, and their basket comes to you on WhatsApp instead." (lapsed: "Your Business plan ended on <date>. …"), button "Pay to take orders" → `/app/billing`.
  - On a trial, the free orders left show as the leads' trial does (the spec's "Free orders remaining show as they do on the leads screen"): the dismissible info banner "<used> of your 3 free orders used", text "After 3, checkout pauses and baskets come to you on WhatsApp until you subscribe.", button "See plans".

- [ ] **Step 1: Failing tests** — the board's behaviour: the three figures ("Receipts to check", "Paid, to make", "Paid this week" with the 7-day spark); filters All / To check / Paid / Refunds with counts; each row's badge; the detail's four steps and its action box per state (the board's `ab` copy, word for word, including the `Not received` button beside `Mark paid` while a receipt is in — decision 3); cancel confirm ("Cancel #13? You will owe Mira RM235." once paid); toasts in the board's words ("#13 marked paid. Mira can see it on their order page." etc.); the receipt opens large; the empty state ("No orders yet / They show up here the moment someone checks out."); the paused banner; the trial banner with the free orders used; the nav item and badge for a business page only.
- [ ] **Step 2:** FAIL. **Step 3: Implement from `design/boards/Orders.dc.html`.** `?order=<id>` selects that order (the email's link).
- [ ] **Step 4:** PASS; load at 1440 and 390 against `Orders.*.jpg`, `Orders-empty.*.jpg`, `Alerts-paused.*.jpg`.
- [ ] **Step 5: Commit** `feat(orders): the Orders screen from the design handoff`.

### Task 11: The chat — order chips and the order lookup

**Files:**
- Modify: `apps/api/src/modules/chat/chat.service.ts`, `prompt.ts`, tests; create `order-lookup.ts` (+ test)
- Modify: `packages/ui/src/chat/ChatMode.tsx`, `ChatMode.module.css`, `ChatMode.test.tsx`; create `OrderCard.tsx`

**Interfaces:**
- Produces:
  - `AnswerEvent` gains `{ type: 'order'; card: OrderCard }` and `done` gains `orderChips?: { itemId: string; label: string }[]`.
  - `OrderCard = { number: number; code: string; status: string; pill: string; steps: { placed: boolean; paid: boolean; ready: boolean; done: boolean }; summary: string; when: string; totalCents: number; url: string; button: 'Pay now' | 'Open order page' }` (the Public board's `ocard`).
  - `findOrderCode(text: string): string | null` (a 4-character word from the alphabet, case-insensitive).
- Lookup, before any model call and spending no conversation: a message naming a code of this page sets `Conversation.pendingOrderId` and replies "Found order 7Q4M. To keep it private, what are the last 4 digits of the WhatsApp number on it?"; the next message, if its digits end with the phone's last 4, yields "Thanks. Here’s order 7Q4M:" and the `order` card, else "Those digits don’t match the number on order 7Q4M. Try again, or message <Name> on WhatsApp."; a code not on this page: "I can’t find an order 7Q4M with this shop. Check the code on your order page." `prompt.ts` adds one line: asked about an order's status without a code, ask for the 4-character order code on their order page.
- Chips: after an answer from the model, items of an open Store named in it (normalised names, at most two) → `orderChips` (`Order <name>`, linking to `/<handle>/shop?item=<id>`); on such a turn `intent.qualified` is false (the design doc: the capture card is not also offered).

- [ ] **Step 1: Failing tests:** `asks for the last 4 digits, then shows the card`; `never shows an order to the wrong digits`; `says a code is not this shop's`; `spends no model call or conversation on a lookup`; `offers at most two order chips, matched from item names, and withholds the capture card on that turn`; `offers no chips while the Store is off`; ChatMode: `renders the order card and its button`; `renders order chips as links`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement; the card from the Public board's `ocard` markup. **Step 4:** PASS; ask a real question in dev.
- [ ] **Step 5: Commit** `feat(chat): order chips, and "where is my order" by code`.

### Task 12: Everything else that changes with orders

**Files:**
- Modify: `apps/web/app/app/billing/page.tsx` (+ test) — row 2's feature list and row 60's meter: "Orders <n> no limit · Take as many as you get." when paid; on a trial, "<used> of 3 free orders used"
- Modify: `apps/web/app/app/store/*` (+ tests) — rows 26–29: the preview's Pay screen (the order page's pay box), the basket bar "Basket is empty · Checkout", the board's payment and notice words, "Added to the total"; row 77: "Open for orders" says why it is off when orders are paused
- Modify: `apps/web/app/app/settings/notify-leads.tsx` (+ test) → the "Email me when" section gains "A new order comes in" and "A receipt is uploaded" (`notifyOrders`, `notifyReceipts`; a `PATCH /pages/notifications` extension); row 84
- Modify: `apps/workers/src/housekeeping/retention.ts` (+ test) — orders past `LEAD_RETENTION_MONTHS` are deleted, and their receipt objects removed (add `@aws-sdk/client-s3` to workers; a small `removeObjects(keys)` built from the same `STORAGE_*` env as the API, skipped when storage is off)
- Modify: `apps/web/app/_landing/*`, `apps/web/app/_auth/AuthFilm.tsx` — rows 1 and 3: remove the `SLICE 18` markers; the sign-in film's scenes 2 and 3 as drawn ("New order #1042 · Paid by QR, proof attached", then confirming it in Orders)
- [ ] **Step 1: Failing tests** for each: the Billing meter and list; the Store preview's Pay screen and words; the two new email switches; `deletes orders past 12 months, and their receipts`; the film's scenes.
- [ ] **Step 2–4:** FAIL, implement, PASS; load Billing, Store, Settings, `/signin` in dev.
- [ ] **Step 5: Commit** one per area (billing, store, settings, retention, landing and film).

### Task 13: Close the rows

**Files:** `design/DEVIATIONS.md`
- [ ] **Step 1:** Mark rows 1, 2, 3, 26, 27, 28, 29, 60, 74, 77, 80, 84 **Resolved** with what was built.
- [ ] **Step 2:** Add rows from 101: the four owner decisions (closed days and delivery note in Store; the WhatsApp send-to-self button; Not received; Ready on the day); order chips (not drawn; the design doc's decision 6); "They pay you directly…" in the order email; "getting it ready" in the order page's pill; receipts at unguessable public keys; anything else the tasks departed from.
- [ ] **Step 3:** Run the full gates: `pnpm turbo run typecheck lint test --concurrency=1 --force` — 0 failed, 0 cached.
- [ ] **Step 4: Commit** `docs(design): slice 18 closes its rows`.
