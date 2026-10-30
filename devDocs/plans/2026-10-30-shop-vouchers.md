# Shop Vouchers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Shop owners make vouchers (a percentage or a fixed amount off, the whole order or one item, applied automatically or by code) and customers get them at checkout, with the server deciding every discount.

**Architecture:** One pure module in `@curios/core` (`vouchers.ts`) decides what a voucher saves on a basket; the browser uses it to show numbers and `placeOrder` uses it to charge them. Vouchers are a `ShopVoucher` table; an order keeps a snapshot (`discountCents`, `voucherId`, `voucherLabel`). Uses are counted from orders, so a cancelled unpaid order gives its use back with no counter to keep.

**Tech Stack:** TypeScript, Prisma/Postgres, Fastify (apps/api), Next.js (apps/web), vitest.

**Spec:** `devDocs/vouchers-design.md`, Part A. Read it first; this plan argues from it.

## Global Constraints

- Money is integer sen everywhere (`*Cents`); `formatRinggit` for display.
- A voucher takes off **a percentage (1-100)** or **a fixed amount (RM, above RM0)**, on **the whole order** or **one item**. No free delivery; delivery is never discounted.
- **One discount per order.** The best live Automatic voucher that fits applies; a typed Code voucher replaces it only if it saves more in RM; a tie goes to the typed code.
- A one-item fixed amount comes off that item's lines **once per order**; a one-item percentage applies to that item's lines only.
- A saving never exceeds what it applies to; an order total never goes below RM0.
- A voucher **fits** when: switched on, not past its end date, under its cap, minimum spend met (on items, before discount), and for a one-item voucher, the item is in the basket.
- An order total of RM0 is **paid at once**: `status PAID`, `paidVia VOUCHER`, `paidAt` now, delivered as any paid order; no CHIP purchase, QR or receipt.
- Uses = orders with the voucher, **not counting orders cancelled before they were paid** (`status CANCELLED and paidAt null`).
- Vouchers are Business-only (as the shop). A paused shop's WhatsApp basket gets no voucher.
- Codes: trimmed, uppercased, `^[A-Z0-9]{3,20}$`, unique per shop. Automatic vouchers have a **name** (1-40 characters) shown to customers instead.
- An end date is a calendar day: the voucher works through the end of that day, Malaysia time (stored as the next day 00:00 `+08:00`).
- Every shop string is in English and Malay (`apps/web/app/[handle]/shop/copy.ts`; `ShopCopy` type, `en` and `ms`).
- Migrations are hand-written SQL in `packages/db/prisma/migrations/<timestamp>_<name>/migration.sql`; run Prisma generate from `packages/db`; apply to dev and test DBs (`DATABASE_URL_TEST` from `.env`). The test DB is wiped by a container restart: restore with `prisma migrate deploy` plus `packages/db/prisma/sql/readonly-role.sql`.
- Never use the test DB as a migrate shadow database.

## Review Focus

1. **A voucher that ended or ran out between checkout showing it and the order being placed** -> 409 `PRICES_CHANGED` with the live vouchers, checkout reloads and shows the new total; never a charge at the old discount. (Test in Task 4.)
2. **Two customers taking the last use of a capped voucher at once** -> exactly one gets it; the other's order is refused as prices changed. (Test in Task 4, two concurrent `placeOrder` calls, cap 1.)
3. **A discounted online (CHIP) payment** -> the purchase amount equals the discounted total and settling still matches it. (Test in Task 4.)
4. **An item deleted, or made unavailable, while a one-item voucher points at it** -> the voucher stops fitting (saves RM0); deleting the item deletes its vouchers; existing orders keep their snapshot. (Test in Tasks 1 and 3.)
5. **The code field given junk** (lower case, spaces, an unknown, ended or switched-off code) -> normalised before lookup, and one generic "That code doesn't work here" answer for unknown, ended, off and used-up alike. (Test in Task 3.)

---

### Task 1: The voucher rules in `@curios/core`

**Files:**
- Create: `packages/core/src/vouchers.ts`, `packages/core/src/vouchers.test.ts`
- Modify: `packages/core/src/orders.ts` (`orderTotals`), `packages/core/package.json` (export `./vouchers`), `packages/core/src/orders.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type VoucherMode = 'AUTO' | 'CODE';
  export type VoucherKind = 'PERCENT' | 'AMOUNT';
  export const VOUCHER_CODE = /^[A-Z0-9]{3,20}$/;
  export const VOUCHER_NAME_MAX = 40;
  /** A live voucher's terms, as the server sends them and the basket judges them. `label` is the code or the name. */
  export interface VoucherTerms { id: string; mode: VoucherMode; kind: VoucherKind; percent: number | null; amountCents: number | null; itemId: string | null; minSpendCents: number | null; label: string }
  export type VoucherLine = { itemId: string; unitCents: number; quantity: number };
  export function normalizeVoucherCode(raw: string): string;          // trim + uppercase
  export function voucherSaving(v: VoucherTerms, lines: VoucherLine[]): number; // sen; 0 when it does not fit
  export function pickVoucher(candidates: VoucherTerms[], lines: VoucherLine[], typedId?: string | null): { voucher: VoucherTerms; savingCents: number } | null;
  export interface VoucherInput { mode: VoucherMode; code: string | null; name: string | null; kind: VoucherKind; percent: number | null; amountCents: number | null; itemId: string | null; minSpendCents: number | null; endsOn: string | null; maxUses: number | null }
  export function checkVoucherInput(input: VoucherInput): string | null; // the owner-facing error, or null
  export function voucherEndsAt(endsOn: string): Date;               // 'YYYY-MM-DD' -> next day 00:00 +08:00
  ```
  `orderTotals(lines, delivery, discountCents = 0)` now returns `{ itemsCents, discountCents, deliveryCents, totalCents }` with `totalCents = itemsCents - discountCents + deliveryCents`.

- [ ] **Step 1: Write the failing tests** in `vouchers.test.ts`:
  - `voucherSaving`: 10% of items RM45.00 + RM25.00x2 is `950`; percent saving is floored to the sen (10% of 1999 is `199`); 100% of an order equals its items; AMOUNT 1000 on items 700 is `700` (never more than it applies to); one-item PERCENT 50 on item `cake` lines `{cake, 9500, 2}` + `{cookie, 2500, 1}` is `9500`; one-item AMOUNT 500 on `cake` with `cake` x3 is `500` (once per order); a one-item voucher with its item absent is `0`; `minSpendCents: 5000` with items 4999 is `0` and with 5000 is not `0`.
  - `pickVoucher`: returns the larger saving; a typed code saving equal to the best AUTO wins the tie; a typed code saving less loses; candidates all saving `0` return `null`; a typed id not among candidates is ignored.
  - `checkVoucherInput`: CODE needs a code matching `VOUCHER_CODE` after normalising; AUTO needs a name of 1-40 characters; PERCENT needs `percent` 1-100 and no amount; AMOUNT needs `amountCents` above 0 and no percent; `maxUses` if given is an integer 1-100000; `minSpendCents` if given is above 0; `endsOn` if given is a valid `YYYY-MM-DD`.
  - `voucherEndsAt('2026-11-30')` equals `new Date('2026-12-01T00:00:00+08:00')`.
  In `orders.test.ts`: `orderTotals(lines, delivery, 950)` gives `totalCents = items - 950 + delivery` and returns `discountCents: 950`; without the argument `discountCents` is `0`.

- [ ] **Step 2: Run them to see them fail**
  Run: `pnpm --filter @curios/core exec vitest run src/vouchers.test.ts src/orders.test.ts`
  Expected: FAIL (module not found / `discountCents` undefined).

- [ ] **Step 3: Implement** the signatures above in `vouchers.ts`, change `orderTotals` in `orders.ts`, and add `"./vouchers": "./src/vouchers.ts"` to `packages/core/package.json` exports. The base a voucher applies to is the sum of `unitCents * quantity` over the lines it covers (all lines, or the lines whose `itemId` is the voucher's); minimum spend is judged on all items.

- [ ] **Step 4: Run them to see them pass**, then `pnpm --filter @curios/core exec tsc --noEmit -p .`
  Expected: PASS; tsc exit 0. Then `pnpm -r exec tsc --noEmit -p .` to see who else reads `orderTotals` (callers spreading `...totals` into `order.create` will fail until Task 2 adds the column; note them, fix in Task 2).

- [ ] **Step 5: Commit** `feat(core): voucher rules -- what a voucher saves on a basket, which one wins, what an owner may make`

### Task 2: Schema and reads

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/20261031010000_shop_vouchers/migration.sql`
- Modify: `packages/db-read/src/orders.query.ts` (`PublicOrder`, owner order type and selects), `packages/db-read/src/shop.query.ts` (`getCheckout` / `Checkout`), every fixture that builds those types (grep `coverBottom: null` in tests for where shop/order fixtures live)
- Test: `packages/db-read/src/vouchers.query.test.ts` (new), `packages/db-read/src/orders.query.test.ts`

**Interfaces:**
- Consumes: `VoucherTerms` (Task 1).
- Produces:
  - Prisma: `enum VoucherMode { AUTO CODE }`, `enum VoucherKind { PERCENT AMOUNT }`, `OrderPaidVia` gains `VOUCHER`; `model ShopVoucher { id, pageId (Cascade), mode, code String?, name String?, kind, percent Int?, amountCents Int?, itemId String? (relation to Item, onDelete Cascade), minSpendCents Int?, endsAt DateTime?, maxUses Int?, active Boolean @default(true), createdAt, orders Order[], @@unique([pageId, code]), @@index([pageId]) }`; `Order` gains `discountCents Int @default(0)`, `voucherId String?` (relation, onDelete SetNull), `voucherLabel String?`.
  - db-read: `export function liveVoucherWhere(now: Date)` (Prisma where: active, endsAt null or > now); `export async function voucherUses(db, voucherIds: string[]): Promise<Map<string, number>>` (orders with the voucher, excluding `status CANCELLED and paidAt null`); `export async function getOwnerVouchers(accountId: string, now = new Date()): Promise<OwnerVoucher[]>` with `OwnerVoucher = VoucherTerms & { code, name, endsAt, maxUses, active, uses, state: 'on' | 'off' | 'ended' | 'usedUp', itemName: string | null }`; `Checkout` gains `vouchers: VoucherTerms[]` (live **AUTO** vouchers under their cap only); `PublicOrder` and the owner order type gain `discountCents`, `voucherLabel`; `paidVia` unions gain `'VOUCHER'`.

- [ ] **Step 1: Write the failing tests**: `getOwnerVouchers` returns each voucher with `uses` counting a PLACED and a PAID order but not an order CANCELLED with `paidAt` null, and `state` `usedUp` when `uses >= maxUses`, `ended` when `endsAt <= now`, `off` when `active` false; `getCheckout(...).vouchers` lists a live AUTO voucher, leaves out CODE vouchers, a switched-off one, an ended one and a used-up one; `getOrderByToken` returns `discountCents` and `voucherLabel`.
- [ ] **Step 2: Run to see them fail**: `pnpm --filter @curios/db-read exec vitest run src/vouchers.query.test.ts` -> FAIL.
- [ ] **Step 3: Schema + migration** (SQL matching the Prisma model: two enums, `ALTER TYPE "OrderPaidVia" ADD VALUE 'VOUCHER'`, the table with its FKs and unique/index, three `Order` columns). Apply to dev and test DBs, `npx prisma generate` from `packages/db`. New tables are readable by `curios_readonly` through the default privileges in `readonly-role.sql`; verify with a db-read test (the reads above run as that role).
- [ ] **Step 4: Implement the reads**; fix every fixture `tsc` flags (`discountCents: 0, voucherLabel: null`, `vouchers: []`).
- [ ] **Step 5: Run** the new tests, the db-read suite, and `pnpm -r exec tsc --noEmit -p .` -> PASS / exit 0.
- [ ] **Step 6: Commit** `feat(db): shop vouchers, and an order's discount snapshot`

### Task 3: Owner voucher API, and checking a code

**Files:**
- Create: `apps/api/src/modules/store/voucher.service.ts`, `apps/api/src/modules/store/voucher.routes.test.ts`
- Modify: `apps/api/src/modules/store/store.routes.ts` (register routes), `apps/api/src/app.ts` (rate limit for the public check, as `POST /store/:handle/orders` is limited)

**Interfaces:**
- Consumes: `checkVoucherInput`, `normalizeVoucherCode`, `voucherEndsAt` (Task 1); `voucherUses`, `liveVoucherWhere` (Task 2).
- Produces (all under the owner's session, Business-only like the other `/store` routes):
  - `GET /store/vouchers` -> `{ vouchers: OwnerVoucher[] }`
  - `POST /store/vouchers` body `VoucherInput` -> 201 `{ voucher: OwnerVoucher }`; 400 `VOUCHER_INVALID` with the `checkVoucherInput` message; 409 `VOUCHER_CODE_TAKEN` for a code the shop already has; 400 when `itemId` is not this shop's item.
  - `PATCH /store/vouchers/:id` body `Partial<VoucherInput> & { active?: boolean }` -> `{ voucher }` (the merged voucher is judged whole by `checkVoucherInput`)
  - `DELETE /store/vouchers/:id` -> 204. Orders that used it keep their snapshot (`voucherId` set null).
  - Public: `POST /store/:handle/vouchers/check` body `{ code: string }` -> 200 `{ voucher: VoucherTerms }` for a live CODE voucher under its cap; otherwise 404 `VOUCHER_UNKNOWN` with "That code doesn't work here." (one answer for unknown, off, ended and used up).

- [ ] **Step 1: Write the failing tests**: create/list/edit/switch off/delete round trip; a second voucher with code `raya10` when `RAYA10` exists is 409; a PERCENT of 0 or 101 is 400; an item from another shop is 400; a personal page is refused like other store routes; deleting a voucher leaves an order's `voucherLabel` and `discountCents` and sets `voucherId` null; deleting the item deletes its one-item voucher (Review Focus 4); `check` with `" raya10 "` finds `RAYA10`; `check` for an off, ended, used-up and unknown code all return the same 404 body (Review Focus 5); `check` never returns an AUTO voucher.
- [ ] **Step 2: Run to see them fail**: `pnpm --filter @curios/api exec vitest run src/modules/store/voucher.routes.test.ts` -> FAIL.
- [ ] **Step 3: Implement** the service and routes, following `item.service.ts` / `store.routes.ts` patterns (zod bodies, `storePageFor`, the store's error classes).
- [ ] **Step 4: Run** the new tests and `pnpm --filter @curios/api exec tsc --noEmit -p .` -> PASS / exit 0.
- [ ] **Step 5: Commit** `feat(store): owners make, change and switch off vouchers; a customer's code is checked`

### Task 4: Placing an order with a voucher

**Files:**
- Modify: `apps/api/src/modules/orders/place.service.ts`, `apps/api/src/modules/orders/order.routes.ts` (body gains `voucherCode?: string`), `apps/api/src/modules/orders/order.errors.ts` (`PricesChangedError` gains `vouchers: VoucherTerms[]`), `apps/api/src/modules/orders/pay-online.service.ts` (CHIP product lines), `packages/core/src/order-mail.ts` (`newOrderMail`, `paidOrderMail`: a discount line)
- Test: `apps/api/src/modules/orders/place.vouchers.test.ts` (new), `apps/api/src/modules/orders/pay-online.service.test.ts`, `packages/core/src/order-mail.test.ts`

**Interfaces:**
- Consumes: `pickVoucher`, `orderTotals(…, discountCents)`, `normalizeVoucherCode` (Task 1); `liveVoucherWhere`, `voucherUses` (Task 2).
- Produces: `PlaceInput.voucherCode?: string | null`; an order row with `discountCents`, `voucherId`, `voucherLabel`; a RM0 order placed as `PAID`/`VOUCHER`; `PricesChangedError.vouchers` (live AUTO vouchers), sent in the 409 body as `vouchers`.

- [ ] **Step 1: Write the failing tests**:
  - A live AUTO 10% voucher applies with no code: the order's `discountCents` is 10% of items, `totalCents` is items - discount + delivery, `voucherLabel` is its name.
  - A typed code that saves more replaces the AUTO one; one that saves less does not (the order carries the AUTO one).
  - `seenTotalCents` computed with a voucher that was switched off since -> 409 `PRICES_CHANGED` whose body has `vouchers` without it (Review Focus 1).
  - Cap 1, two `placeOrder` calls at once with the same code -> one order has the discount, the other call throws `PricesChangedError` (Review Focus 2).
  - A 100% voucher -> `totalCents` 0, `status` `PAID`, `paidVia` `VOUCHER`, `paidAt` set, a digital line delivered (`deliverOrder` ran); the trial count (`ordersPlaced`) still went up.
  - A cancelled-unpaid order using a cap-1 voucher frees it for the next order.
  - `startOnlinePayment` on a discounted order creates a CHIP purchase of `totalCents` and its product lines sum to it; `settleChipPurchase` for that purchase marks it paid (Review Focus 3).
  - `newOrderMail` with `discountCents: 950, voucherLabel: 'RAYA10'` shows a discount line `−RM9.50` and the discounted total.
- [ ] **Step 2: Run to see them fail**: `pnpm --filter @curios/api exec vitest run src/modules/orders/place.vouchers.test.ts` -> FAIL.
- [ ] **Step 3: Implement**: under the existing page lock in `placeOrder`, after `priceLines`, load the live AUTO vouchers plus the typed CODE voucher (normalised), drop any at its cap (`voucherUses` inside the same transaction), `pickVoucher`, then `orderTotals(lines, delivery, saving)`. Compare to `seenTotalCents` as today (a mismatch throws `PricesChangedError(shelf, delivery, liveAutoVouchers)`). Write the snapshot fields on `order.create`. For `totalCents === 0`, create the order `PAID`/`VOUCHER`/`paidAt: now` and call `deliverOrder(tx, order.id, now)` inside the transaction. In `startOnlinePayment`, make the products add up to the discounted total (e.g. scale each line's price down so the sum is exact, or one line "Order #N"; keep the existing sum check).
- [ ] **Step 4: Run** the new tests, the orders test folder, `pnpm --filter @curios/api exec tsc --noEmit -p .`, core's order-mail tests -> PASS / exit 0.
- [ ] **Step 5: Commit** `feat(orders): a voucher comes off the order on the server; a free order is paid at once`

### Task 5: Checkout and the basket sheet

**Files:**
- Modify: `apps/web/app/[handle]/shop/checkout/checkout.tsx`, `apps/web/app/[handle]/shop/checkout/page.tsx` (pass `checkout.vouchers`), `apps/web/app/[handle]/shop/basket-bar.tsx` (the sheet shows the applied AUTO voucher), `apps/web/app/[handle]/shop/copy.ts`, `apps/web/app/[handle]/shop/checkout/checkout.module.css`
- Test: `apps/web/app/[handle]/shop/checkout/checkout.vouchers.test.tsx` (new), `apps/web/app/[handle]/shop/basket-bar.test.tsx`

**Interfaces:**
- Consumes: `Checkout.vouchers` (Task 2); `pickVoucher`, `orderTotals(…, discountCents)` (Task 1); `POST /store/:handle/vouchers/check` (Task 3); `voucherCode` on `POST /store/:handle/orders` and the 409 body's `vouchers` (Task 4).
- Produces: checkout sends `voucherCode` (the typed one, if any) and `seenTotalCents` including the discount.

- [ ] **Step 1: Write the failing tests**: with a live AUTO 10% voucher, the summary shows a line "Raya promo −RM9.50" and the total is discounted, and the placed request carries the discounted `seenTotalCents`; typing `insta15` calls the check endpoint with `INSTA15` and, saving more, replaces the line; a code saving less shows "A better voucher is already applied"; a refused code shows "That code doesn't work here."; a 409 with `vouchers: []` reloads to the undiscounted total with the prices-changed notice; a RM0 total shows a "Place order" button with no payment choice, and the placed screen says it is paid; the basket sheet shows the AUTO voucher line and the discounted total.
- [ ] **Step 2: Run to see them fail**: `pnpm --filter @curios/web exec vitest run "app/[handle]/shop"` -> FAIL.
- [ ] **Step 3: Implement**; copy in `en` and `ms`: `voucherApplied(label, saving)`, `haveACode`, `applyCode`, `codeUnknown`, `betterVoucherApplied`, `removeCode`, `freeOrderPaid`.
- [ ] **Step 4: Run** the shop tests and `pnpm --filter @curios/web exec tsc --noEmit -p .` -> PASS / exit 0. Load `/<handle>/shop/checkout` on `pnpm dev` with a voucher in place and check it renders (curl 200 and a look in the browser).
- [ ] **Step 5: Commit** `feat(checkout): vouchers apply themselves, a code can be typed, and a free order is placed paid`

### Task 6: Where a discount is shown after the order

**Files:**
- Modify: `apps/web/app/[handle]/order/[token]/order-view.tsx` and `page.tsx` (summary line, paid-by-voucher state with no pay box), `apps/web/app/app/orders/order-detail.tsx` (discount line; "Paid with a voucher"), `apps/web/app/app/store/pay-preview.tsx` (type only), `apps/web/app/[handle]/shop/copy.ts`
- Test: `apps/web/app/[handle]/order/[token]/order.test.tsx`, `apps/web/app/app/orders/order-detail.test.tsx` (or the orders screen test that renders the detail)

**Interfaces:**
- Consumes: `PublicOrder.discountCents`, `voucherLabel`, `paidVia 'VOUCHER'` (Task 2).

- [ ] **Step 1: Write the failing tests**: an order with `discountCents: 950, voucherLabel: 'RAYA10'` shows "RAYA10 −RM9.50" in the order page summary and the owner's order detail, with `Pay RM…` stating the discounted total; a `VOUCHER`-paid RM0 order shows as paid with no QR, bank or receipt box, and the owner detail says "Paid with a voucher".
- [ ] **Step 2: Run to see them fail** -> FAIL.
- [ ] **Step 3: Implement**; copy in `en` and `ms`.
- [ ] **Step 4: Run** the order and orders tests and web tsc -> PASS / exit 0.
- [ ] **Step 5: Commit** `feat(order): the order page and the owner's order show the voucher and what it took off`

### Task 7: Promotions on the shop and item pages

**Files:**
- Modify: `apps/web/app/[handle]/shop/shop-page.tsx`, `apps/web/app/[handle]/shop/page.tsx`, `apps/web/app/[handle]/shop/[slug]/product-view.tsx` and `page.tsx`, `packages/db-read/src/shop.query.ts` (`getShopItem` carries the same live AUTO vouchers), `apps/web/app/[handle]/shop/copy.ts`, the two CSS modules
- Test: `apps/web/app/[handle]/shop/shop-page.test.tsx`, `apps/web/app/[handle]/shop/[slug]/product-view.test.tsx`

**Interfaces:**
- Consumes: live AUTO `VoucherTerms[]` (Task 2).

- [ ] **Step 1: Write the failing tests**: a whole-order AUTO voucher shows on the shop as one line in the shop's sign area, e.g. "10% off · Raya promo" or "RM5 off over RM50 · Raya promo"; a one-item AUTO voucher shows on that item's page ("RM5 off this item") and as a small tag on its shelf card; no line when there are none; CODE vouchers never show.
- [ ] **Step 2: Run to see them fail** -> FAIL.
- [ ] **Step 3: Implement** in the shop's existing visual language (the sign's frosted pill or facts row; no banner). Copy in `en` and `ms`: `promoOff(percentOrAmount, minSpend?)`, `promoThisItem(…)`.
- [ ] **Step 4: Run** the tests and web tsc -> PASS. Load `/<handle>/shop` and an item page on `pnpm dev` at 393px wide and look at them.
- [ ] **Step 5: Commit** `feat(shop): live automatic vouchers show on the shop and the item they're for`

### Task 8: The Vouchers tab in Store

**Files:**
- Create: `apps/web/app/app/store/vouchers-tab.tsx`, `apps/web/app/app/store/vouchers-tab.test.tsx`
- Modify: `apps/web/app/app/store/store-editor.tsx` (`TABS`, `previewFor`, a panel), `apps/web/app/app/store/page.tsx` (`TAB_NAMES`, `getOwnerVouchers`), `apps/web/app/app/store/store-screen.tsx` (a `VouchersApi` over the Task 3 routes), `apps/web/app/app/store/store-types.ts`, `apps/web/app/app/store/store.module.css`

**Interfaces:**
- Consumes: `OwnerVoucher`, `getOwnerVouchers` (Task 2); the `/store/vouchers` routes (Task 3); `checkVoucherInput` (Task 1) for the form's own messages.
- Produces: `VouchersApi = { add(input: VoucherInput): Promise<OwnerVoucher>; update(id: string, patch: Partial<VoucherInput> & { active?: boolean }): Promise<OwnerVoucher>; remove(id: string): Promise<void> }`.

- [ ] **Step 1: Write the failing tests**: the tab lists each voucher with its saving ("10% off everything", "RM5 off Kek Batik"), how customers get it ("Automatic" / "Code INSTA15"), its state and uses ("12 of 50 used", "Ended 30 Nov", "Off"); adding a Code voucher calls `add` with a normalised code; the form refuses PERCENT 0 with the `checkVoucherInput` message before calling the API; the switch calls `update(id, { active: false })`; delete asks for confirmation inside the page (no `confirm()`), then calls `remove`; `?tab=vouchers` opens it.
- [ ] **Step 2: Run to see them fail** -> FAIL.
- [ ] **Step 3: Implement**, matching the Items and Payment tabs' editor style (`editor.module.css` floating fields, `SectionHead`, `SaveState`); the preview shows the Shop screen.
- [ ] **Step 4: Run** the store tests and web tsc -> PASS. Load `/app/store?tab=vouchers` on `pnpm dev` (light and dark, desktop and 393px) and look at it.
- [ ] **Step 5: Commit** `feat(store): a Vouchers tab to make, switch off and follow vouchers`

### Task 9: Whole-branch check

- [ ] Run every suite: `pnpm --filter @curios/core exec vitest run`, `pnpm --filter @curios/db-read exec vitest run`, `pnpm --filter @curios/api exec vitest run`, `pnpm --filter @curios/web exec vitest run`, and `pnpm -r exec tsc --noEmit -p .` (never piped in a way that hides the exit code).
- [ ] On `pnpm dev`: make an AUTO 10% voucher and a CODE voucher in Store, place an order with each (QR path), then a 100% CODE order for a digital item, and check the order page, the owner's Orders screen and the new-order email in Mailpit agree on every number.
