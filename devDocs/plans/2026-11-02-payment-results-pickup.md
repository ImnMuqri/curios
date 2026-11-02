# Payment results, 30-minute holds, and pickup places and times: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** this plan builds four things.
- Full pages for a paid or failed plan payment.
- A full page when a customer's shop payment fails.
- Unpaid holds that last 30 minutes.
- Pickup places and time windows that owners set up and customers pick at checkout.

**Architecture:**
- **Shared helpers in `@curios/core`:** CHIP status to plain words, and the pickup time label. The API, workers, emails and both web apps all use these.
- **Database:** pickup places and windows are new Prisma tables owned by the page. An order keeps a snapshot of the place and window it was placed with.
- **Payment failures:** the API's existing return and pay-status paths say why a payment failed.
- **Web pages:** the new pages are server components that read through `@curios/db-read`, as the billing and order pages already do.

**Tech stack:** Fastify and Zod (API), Prisma and Postgres (a hand-written migration), BullMQ (the workers' scheduler), Next 15 app router (web), and Vitest with Testing Library.

**Spec:** `devDocs/payment-results-and-pickup-design.md` (approved 2 Nov 2026). Design boards are on branch `origin/design-digital-products`, commit `ea5f60d`:
- `design/boards/Billing.dc.html`, the `.pr` block marked `/* payment result pages: Peek happy / sad (2 Nov) */`;
- `design/boards/Public.dc.html`, route `payfail`, marked `/* payment failed (2 Nov) */`;
- `design/HANDOFF.md`, section "Payment result pages";
- screens `design/screens/Billing-paid.*`, `Billing-payment-failed.*` and `Shop-payment-failed.*`.

Read them with `git show origin/design-digital-products:<path>`.

## Global Constraints

- **Worktree:** `C:\Users\User\Desktop\Projects\curios-chip-min`, branch `feat/payment-results-pickup`. Never edit `C:\Users\User\Desktop\Projects\curios`.
- **Hold:** an unpaid order's hold is **30 minutes** (`HOLD_MINUTES = 30`), and so is CHIP's pay window (`PAY_WINDOW_MS = 30 * 60 * 1000`).
- **Hold job:** the expire-holds job runs every 5 minutes, with pattern `'*/5 * * * *'`.
- **CHIP status words:** use this table exactly, in both the billing and shop pages:

  | status | `reason` | What happened (billing) | The bank said (shop) |
  |---|---|---|---|
  | `cancelled` | `cancelled` | `Cancelled at bank` | `cancelled` |
  | `expired` | `expired` | `Took too long` | `it took too long` |
  | `error`, `failed`, `blocked` | `declined` | `Bank declined` | `declined` |
  | any other unpaid | `unfinished` | `Didn't finish` | `it didn't finish` |
- **Paid page receipt line:** `CHIP emails your receipt to {email}.` There is no Download receipt button.
- **Failed page help link:** `Need help? Email us`, a `mailto:` to the support address (`supportAddress()` from `@curios/core/support`).
- **Peek:** reuse the existing body art. Change only pose, eyes and mouth. Every animation stops under `prefers-reduced-motion: reduce`.
- **Pickup windows:** minutes after midnight in Malaysia time, `0 <= from < to <= 1440`. Windows in one place may not overlap. A limit, when given, is `1..999`.
- **Pickup time label:** a window shows as `10am–12pm` (an en dash; minutes only when not `:00`, as in `9:30am–11am`).
- **Pickup on an order:** shown as `Pickup · {day}, {window} · {place name}`, each part only when present. Delivery lines stay as they are.
- **Repo traps:** read `.superpowers/sdd/<plan dir>/repo-notes.md` if it exists; otherwise these:
  - Prisma generate runs from `packages/db`.
  - The test DB is tmpfs. Restore it with `migrate deploy` and `readonly-role.sql`.
  - Vitest does not typecheck, so run `tsc --noEmit` too.
  - Never pipe a gate's output.
  - Python writes use `newline=''`.
  - Git Bash needs `MSYS_NO_PATHCONV=1` for `/app` paths.
- **Commits:** end every commit with a blank line, then the Co-Authored-By trailer of the model that wrote it.

## Review Focus

1. **Two customers taking the last spot in a capped window at once:** exactly one order succeeds, and the other gets `PICKUP_TIME_FULL`. The count must happen inside `placeOrder`'s existing per-page lock. *(Task 4 test.)*
2. **The owner removes a place or window while orders still point at it:** old orders still show their snapshot. Removing a window sets `pickupWindowId` to null, and checkout no longer offers it. *(Task 3 and Task 9 tests.)*
3. **A window on a closed day, or one inside the notice period:** it can't be picked, because the day can't be. Times are only asked for once a valid day is picked. *(Task 9 test.)*
4. **The customer comes back from CHIP to a failed order, then taps "Pay another way" twice:** the second tap doesn't fail. The order is already cancelled, and the same lines come back. *(Task 5 test.)*
5. **A billing return for a payment id that isn't the owner's:** the result page shows nothing of it and redirects to `/app/billing`. *(Task 6 test.)*

---

### Task 1: Core helpers for CHIP status and pickup labels

**Files:**
- Create: `packages/core/src/chip-status.ts`, `packages/core/src/chip-status.test.ts`
- Create: `packages/core/src/pickup.ts`, `packages/core/src/pickup.test.ts`
- Modify: `packages/core/package.json` (exports `./chip-status` and `./pickup`, as the existing subpath exports are written)

**Interfaces:**
- **Produces, from `chip-status.ts`:**
  - `type FailReason = 'cancelled' | 'expired' | 'declined' | 'unfinished'`
  - `failReason(status: string): FailReason`
  - `FAIL_WHAT_HAPPENED: Record<FailReason, string>` (the billing words)
  - `FAIL_BANK_SAID: Record<FailReason, string>` (the shop words)
- **Produces, from `pickup.ts`:**
  - `PICKUP_LIMIT_MAX = 999`, `PICKUP_PLACE_NAME_MAX = 60`, `PICKUP_ADDRESS_MAX = 160`, `PICKUP_NOTE_MAX` (re-exported from `./store`), `PICKUP_PLACES_MAX = 10`, `PICKUP_WINDOWS_MAX = 12`
  - `windowLabel(from: number, to: number): string`
  - `windowProblem(windows: { from: number; to: number; limit: number | null }[]): string | null`, which returns plain English or null
  - `pickupLine(o: { method: 'PICKUP' | 'DELIVERY' | null; dayLabel: string | null; pickupFrom: number | null; pickupTo: number | null; pickupPlaceName: string | null }): string | null`

- [ ] **Step 1: Write the failing tests**

```ts
// chip-status.test.ts
expect(failReason('cancelled')).toBe('cancelled');
expect(failReason('expired')).toBe('expired');
for (const s of ['error', 'failed', 'blocked']) expect(failReason(s)).toBe('declined');
expect(failReason('overdue')).toBe('unfinished');
expect(FAIL_WHAT_HAPPENED.cancelled).toBe('Cancelled at bank');
expect(FAIL_BANK_SAID.expired).toBe('it took too long');

// pickup.test.ts
expect(windowLabel(600, 720)).toBe('10am–12pm');
expect(windowLabel(570, 660)).toBe('9:30am–11am');
expect(windowLabel(720, 780)).toBe('12pm–1pm');
expect(windowLabel(0, 1440)).toBe('12am–12am');
expect(windowProblem([{ from: 600, to: 720, limit: null }, { from: 700, to: 800, limit: 5 }])).toBe('Two pickup times overlap: 10am–12pm and 11:40am–1:20pm.');
expect(windowProblem([{ from: 720, to: 600, limit: null }])).toBe('A pickup time has to end after it starts.');
expect(windowProblem([{ from: 600, to: 720, limit: 0 }])).toBe('A limit is 1 to 999 orders, or none.');
expect(windowProblem([{ from: 600, to: 720, limit: null }])).toBeNull();
expect(pickupLine({ method: 'PICKUP', dayLabel: 'Sat 5 Dec', pickupFrom: 600, pickupTo: 720, pickupPlaceName: 'Home, Seksyen 7' })).toBe('Pickup · Sat 5 Dec, 10am–12pm · Home, Seksyen 7');
expect(pickupLine({ method: 'PICKUP', dayLabel: 'Sat 5 Dec', pickupFrom: null, pickupTo: null, pickupPlaceName: null })).toBe('Pickup · Sat 5 Dec');
expect(pickupLine({ method: 'DELIVERY', dayLabel: 'Sat 5 Dec', pickupFrom: null, pickupTo: null, pickupPlaceName: null })).toBeNull();
```

- [ ] **Step 2:** Run `pnpm --filter @curios/core exec vitest run src/chip-status.test.ts src/pickup.test.ts`. Expect FAIL, because the modules don't exist yet.
- [ ] **Step 3: Implement both modules.**
  - `pickupLine` returns null for anything that isn't `PICKUP`. Callers keep their own delivery wording.
  - The overlap check sorts by `from`.
- [ ] **Step 4:** Re-run the tests and expect PASS. Then run `pnpm --filter @curios/core exec tsc --noEmit`.
- [ ] **Step 5: Commit** with message `feat(core): CHIP failure reasons in plain words, and pickup time labels`.

---

### Task 2: Schema for pickup places, windows, order snapshot and tried method

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/20261102120000_pickup_places/migration.sql`
- Test: `packages/db/src/pickup-migration.test.ts`. Follow the existing migration tests in `packages/db/src` if there are any; otherwise test against the test DB after `migrate deploy`.

**Interfaces:**
- **Produces, Prisma models:**
  - `PickupPlace { id, pageId → Page (Cascade), name, address, mapUrl?, note?, anyTime Boolean @default(true), position Int, createdAt, windows PickupWindow[] }` with `@@index([pageId, position])`.
  - `PickupWindow { id, placeId → PickupPlace (Cascade), fromMinute Int, toMinute Int, limit Int?, position Int }`.
- **Produces, new `Order` columns:**
  - `pickupPlaceId String?` → PickupPlace, SetNull
  - `pickupPlaceName String?`, `pickupPlaceAddress String?`
  - `pickupWindowId String?` → PickupWindow, SetNull
  - `pickupFrom Int?`, `pickupTo Int?`
  - `chipTriedMethod String?`
  - and `@@index([pickupWindowId, day])`

- [ ] **Step 1: Write the failing test.** After migrate, a page with `pickupEnabled = true` and `pickupNote = 'Seksyen 7'` has exactly one `PickupPlace`: `{ name: 'Pickup', address: 'Seksyen 7', anyTime: true, position: 0 }`. A page with no note gets no place. A pickup page with a null note gets `{ name: 'Pickup', address: '' }`.
- [ ] **Step 2: Write the migration.**
  - Write the `CREATE TABLE`s, foreign keys and indexes by hand, in the style of `20261031120000_support_inbox`.
  - The data copy is `INSERT INTO "PickupPlace" (id, "pageId", name, address, "anyTime", position, "createdAt") SELECT gen_random_uuid()::text, id, 'Pickup', COALESCE("pickupNote", ''), true, 0, now() FROM "Page" WHERE "pickupEnabled" OR "pickupNote" IS NOT NULL;`
  - Never use the test DB as a shadow.
- [ ] **Step 3:** Apply the migration to the test DB (`DATABASE_URL=$DATABASE_URL_TEST pnpm --filter @curios/db exec prisma migrate deploy`). Then run `cd packages/db && pnpm exec prisma generate`.
- [ ] **Step 4:** Run the test and expect PASS. Then run `pnpm turbo run typecheck --concurrency=1 --force` and expect it clean.
- [ ] **Step 5: Commit** with message `feat(db): pickup places and windows, the order's pickup snapshot, and the CHIP method a customer tried`.

---

### Task 3: Owner API for pickup places

**Files:**
- Create: `apps/api/src/modules/store/pickup.service.ts`, `pickup.routes.ts` and `pickup.routes.test.ts`
- Modify: `apps/api/src/app.ts` to register the routes beside the other store routes, behind the same owner session hook
- Modify: `apps/api/src/modules/store/store.errors.ts`

**Interfaces:**
- **Consumes:** `windowProblem` and the `PICKUP_*` limits from Task 1, and the Task 2 models.
- **Produces these routes**, each answering with the page's whole list (`{ places: PickupPlaceView[] }`) so the client never merges:
  - `GET /store/pickup-places`
  - `POST /store/pickup-places`, body `PlaceInput`
  - `PUT /store/pickup-places/:id`, body `PlaceInput`
  - `DELETE /store/pickup-places/:id`
  - `POST /store/pickup-places/order`, body `{ ids: string[] }`
- **Produces the types:**
  - `PlaceInput = { name: string; address: string; mapUrl: string | null; note: string | null; anyTime: boolean; windows: { from: number; to: number; limit: number | null }[] }`
  - `PickupPlaceView = { id; name; address; mapUrl; note; anyTime; windows: { id; from; to; limit }[] }`
- **Errors (400):**
  - `PICKUP_PLACE_INVALID`, with the plain message from `windowProblem` or from a field check;
  - `PICKUP_PLACES_FULL`, "A shop has up to 10 pickup places.";
  - `PICKUP_LAST_PLACE`, "Pickup needs at least one place. Turn pickup off instead.", when deleting the last place while `pickupEnabled`.

- [ ] **Step 1: Write the failing route tests**, using the existing store route test harness:
  - create, then list;
  - `PUT` replaces the windows: an old window id that isn't sent is deleted, so orders pointing at it get a null `pickupWindowId`;
  - overlapping windows give `PICKUP_PLACE_INVALID` with the overlap message;
  - `anyTime: true` with windows sent stores no windows;
  - an 11th place gives `PICKUP_PLACES_FULL`;
  - deleting the only place with pickup on gives `PICKUP_LAST_PLACE`;
  - another page's place id gives 404;
  - `mapUrl` must be `https:`, or it's `PICKUP_PLACE_INVALID`.
- [ ] **Step 2:** Run `pnpm --filter @curios/api exec vitest run src/modules/store/pickup.routes.test.ts` and expect FAIL.
- [ ] **Step 3: Implement.**
  - Each write is one transaction.
  - Keep window ids stable when `from`, `to` and `limit` are unchanged and in the same position. The client sends `id` on an existing window, and the service updates it instead of recreating it.
  - So the type is `windows: { id?: string; from; to; limit }[]`.
- [ ] **Step 4:** Re-run the tests and expect PASS. Then run `pnpm --filter @curios/api exec tsc --noEmit` and lint.
- [ ] **Step 5: Commit** with message `feat(api): owners set pickup places, each with any time or their own time windows`.

---

### Task 4: Placing an order with a pickup place and time, and checkout's time availability

**Files:**
- Modify: `apps/api/src/modules/orders/place.service.ts`
- Modify: the orders route file that registers `POST /store/:handle/orders` (find it with `grep -rn "'/store/:handle/orders'" apps/api/src`)
- Modify: `apps/api/src/modules/orders/order.errors.ts`
- Create: `apps/api/src/modules/orders/pickup-times.routes.ts` and its test
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/src/modules/orders/place.service.test.ts` (extend it)

**Interfaces:**
- **Consumes:** the Task 2 models.
- **Produces:**
  - `PlaceInput` gains `pickupPlaceId?: string | null` and `pickupWindowId?: string | null`.
  - New errors, each a 400 except one 409:
    - `PICKUP_PLACE_REQUIRED`, "Pick where to collect it.";
    - `PICKUP_TIME_REQUIRED`, "Pick a pickup time.";
    - `PICKUP_TIME_FULL` (409), "That pickup time just filled up. Pick another.";
    - `PICKUP_TIME_GONE`, "That pickup time isn't offered any more. Pick another."
  - A new anonymous route, `GET /store/:handle/pickup-times?place=<id>&day=YYYY-MM-DD`, answering `{ windows: { id: string; from: number; to: number; full: boolean }[] }`. It uses the per-IP budget pattern of `shop-pay-methods-ip` in `plugins/rate-limit.ts` (namespace `shop-pickup-times-ip:`).

- [ ] **Step 1: Write the failing tests** in `place.service.test.ts`:
  - a pickup order with places must send a valid `pickupPlaceId`;
  - a place with windows must send a `pickupWindowId` of that place;
  - the order row snapshots `pickupPlaceName`, `pickupPlaceAddress`, `pickupFrom` and `pickupTo`;
  - an `anyTime` place takes no window, and one sent is ignored;
  - a window of another place gives `PICKUP_TIME_GONE`;
  - **the capped window race:** a window with `limit: 1` and two `placeOrder` calls run with `Promise.all` give one success and one `PICKUP_TIME_FULL`;
  - counting ignores `CANCELLED` orders;
  - a delivery order ignores the pickup fields.

  In `pickup-times.routes.test.ts`: `full` is true when non-cancelled orders on that window and day reach the limit, and an uncapped window is never full.
- [ ] **Step 2:** Run both files and expect FAIL.
- [ ] **Step 3: Implement.**
  - Do the window count inside the transaction that already takes the page's lock in `placeOrder` (the same place stock is checked), using `count where { pickupWindowId, day, status: { not: 'CANCELLED' } }`.
  - Validate the day with the existing `isOrderDay` before looking at windows.
- [ ] **Step 4:** Re-run the tests and expect PASS. Then run tsc and lint for the API.
- [ ] **Step 5: Commit** with message `feat(api): orders take a pickup place and time, a capped time takes no more than its limit, and checkout can ask which times are full`.

---

### Task 5: 30-minute holds, the tried method, failure reasons, and "Pay another way"

**Files:**
- Modify: `apps/workers/src/housekeeping/expire-holds.ts` and its test
- Modify: `apps/workers/src/housekeeping/retention.ts`, line ~197, the scheduler pattern
- Modify: `apps/api/src/modules/orders/pay-online.service.ts`: `PAY_WINDOW_MS`, `startOnlinePayment`, `checkWithChip` and `PayStatus`
- Modify: `apps/api/src/modules/orders/pay-online.routes.ts`, for the pay-status response schema and a new route
- Test: the existing `pay-online` service and route tests, and `expire-holds.test.ts`

**Interfaces:**
- **Consumes:** `failReason` and `FailReason` from Task 1, and `Order.chipTriedMethod` and `pickupWindowId` from Task 2.
- **Produces:**
  - `HOLD_MINUTES = 30`, which replaces `HOLD_HOURS`.
  - `PayStatus` failed becomes `{ state: 'failed'; reason: FailReason; method: string | null }`. A purchase past due is `reason: 'expired'`.
  - `chipTriedMethod` is set when a purchase starts. Its value is `FPX · {bank name}` (the bank name from `FPX_BANKS`), the wallet's `paid` name from `WALLETS`, or `Card`.
  - A new route, `POST /store/orders/:token/pay-another-way`, answering `{ lines: { itemId: string; optionId: string | null; quantity: number; sessionId: string | null }[] }`. It cancels the order (status `CANCELLED`, `cancelledAt`) and calls `releaseOrderStock` in one transaction, but only when the order is `PLACED`, unpaid, with no receipt, and has no CHIP purchase still payable (the expire-holds `stale` rule without the age limit). An order that's already cancelled answers the same lines (200). A paid one answers `409 ORDER_ALREADY_PAID`.

- [ ] **Step 1: Write the failing tests:**
  - **expire-holds:**
    - an unpaid order 31 minutes old holding a code is cancelled, and one 29 minutes old isn't;
    - an unpaid order 31 minutes old with a `pickupWindowId` whose window has `limit: 3` is cancelled;
    - the same with `limit: null` isn't;
    - an order with a receipt is never cancelled.
  - **retention:** the scheduler is upserted with `{ pattern: '*/5 * * * *' }`.
  - **pay-online:**
    - `startOnlinePayment` with `{ method: 'fpx', bank: 'maybank' }` stores `chipTriedMethod: 'FPX · Maybank2u'`;
    - the purchase `dueAt` is `now + 30 min`;
    - `payStatus` on a `cancelled` purchase returns `{ state: 'failed', reason: 'cancelled', method: 'FPX · Maybank2u' }`;
    - a past-due pending purchase returns `reason: 'expired'`.
  - **pay-another-way:**
    - returns the lines and cancels the order;
    - a second call returns the same lines and doesn't error;
    - a paid order gives 409;
    - a code held by the order is free again afterwards.
- [ ] **Step 2:** Run them and expect FAIL.
- [ ] **Step 3: Implement.**
  - The holds query adds `{ pickupWindow: { limit: { not: null } } }` to the existing `lines: { some: … }` OR, lifted into an `OR` at order level.
  - The pay-status route's 200 schema gains the failed shape.
- [ ] **Step 4:** Re-run the tests and expect PASS. Then run tsc and lint for the API and workers.
- [ ] **Step 5: Commit** with message `feat(orders): unpaid holds last 30 minutes, a failed payment says why and how it was tried, and "pay another way" frees the order`.

---

### Task 6: Plan payment result pages

**Files:**
- Modify: `apps/api/src/modules/billing/billing.routes.ts`, the `/billing/chip/return` route's `back()`. Test it in `billing.routes.test.ts`.
- Create: `packages/db-read/src/payment-result.query.ts`, exported from the package index, with a test
- Create: `apps/web/app/app/_ui/peek.tsx`. This moves `PeekBody` out of `apps/web/app/app/onboarding/onboarding.tsx` (line ~690) so onboarding and the result pages share it. Onboarding imports it back.
- Create: `apps/web/app/app/billing/paid/page.tsx`, `apps/web/app/app/billing/failed/page.tsx`, `apps/web/app/app/billing/result.module.css`, `apps/web/app/app/billing/result-art.tsx`, and tests `result.test.tsx`
- Modify: `apps/web/app/app/billing/pay-buttons.tsx`, so `PlanPay` and `PayButtons` take `initialOpen?: boolean`
- Modify: `apps/web/app/app/billing/page.tsx`, to pass `initialOpen={params.pay === '1'}` and to stop rendering `PaidToast`
- Delete: `apps/web/app/app/billing/paid-toast.tsx`, and its uses and tests

**Interfaces:**
- **Consumes:** `failReason`, `FailReason` and `FAIL_WHAT_HAPPENED` from Task 1, and `supportAddress()`.
- **Produces:**
  - **Return redirects:** paid goes to `${appUrl}/app/billing/paid?payment=<paymentId>${cardOff ? '&card=off' : ''}`, and failed goes to `${appUrl}/app/billing/failed?payment=<paymentId>&reason=<FailReason>`. Pending is unchanged.
  - `getPaymentResult(pageId: string, paymentId: string): Promise<PaymentResult | null>`, where `PaymentResult = { plan: 'MONTHLY' | 'ANNUAL'; amountCents: number; status: PaymentStatus; paidVia: string | null; reference: string | null; grantedUntil: Date | null; autoRenew: boolean }`. It returns null when the payment isn't that page's. `reference` is the first 8 characters of `providerRef`, uppercased.

- [ ] **Step 1: Write the failing tests:**
  - **The billing route test:**
    - a paid return redirects to `/app/billing/paid?payment=pay_1`;
    - a `cancelled` purchase redirects to `/app/billing/failed?payment=pay_1&reason=cancelled`;
    - an `error` purchase gets `reason=declined`.
  - **`getPaymentResult`:** returns null for another page's payment.
  - **The result page tests,** rendering the page components with mocked db-read:
    - **Paid:** the paid page shows `Payment received`, `Welcome to Business, Lina.`, the paid-until date, `Nothing renews by itself.` (or `Renews by itself on 14 Dec 2026.` when `autoRenew`), a receipt box with `Business, 1 month`, `RM49.00`, `Paid with` and `FPX · Maybank2u`, a **Go to dashboard** link to `/app`, and `CHIP emails your receipt to lina@example.com.`
    - **Failed:** the failed page with `reason=cancelled` shows `Not charged`, `That didn't go through.`, `What happened` / `Cancelled at bank`, **Try again** and **Pick another bank** both linking to `/app/billing?pay=1`, and `Need help? Email us` as `mailto:support@curios.my`.
    - **Bad reason:** an unknown `reason` in the query reads as `unfinished`.
    - **Wrong owner:** a `payment` id that isn't the owner's redirects to `/app/billing`.
    - **Pay sheet:** `PayButtons` with `initialOpen` renders its dialog open.
- [ ] **Step 2:** Run them and expect FAIL.
- [ ] **Step 3: Implement.**
  - Follow the board's `.pr` CSS: grey ground `#edeff4`, an 880px card with 16px radius, art 42% wide (`#e8edff` paid, `#f1f2f5` failed), and a 32px Bricolage title. On phones (≤760px) the art stacks on top at 240px, and the buttons go full width.
  - Peek's poses come from the board, with reduced motion respected.
  - The page reads the owner via `resolveOwner` as `billing/page.tsx` does.
- [ ] **Step 4:** Re-run the tests and expect PASS. Then run tsc and lint for web, API and db-read. **Load `/app/billing/paid?payment=<a real dev id>` in `pnpm dev`** to catch RSC and CSS-module errors the gates miss.
- [ ] **Step 5: Commit** with message `feat(billing): Peek's paid and failed pages after CHIP, in place of the toast`.

---

### Task 7: Shop payment failed page

**Files:**
- Create: `apps/web/app/[handle]/order/[token]/pay-failed.tsx` and `pay-failed.test.tsx`
- Modify: `apps/web/app/[handle]/order/[token]/order-view.tsx`, which renders `PayFailed` in place of the `onlineFailed` paragraph and the section around it, when `check === 'failed'`
- Modify: `apps/web/app/[handle]/order/[token]/order.module.css`, adding the board's `payfail` block
- Modify: `apps/web/app/[handle]/shop/copy.ts`, adding keys in English and Malay

**Interfaces:**
- **Consumes:**
  - the Task 5 pay-status `{ state: 'failed', reason, method }`;
  - `POST /store/orders/:token/pay-another-way`;
  - `FAIL_BANK_SAID`;
  - the existing `RetryPay` for **Pay {total} again**, which starts a new purchase with the same method.
- **Produces these copy keys:**
  - `payFailedTitle`: "Payment didn't go through"
  - `payFailedHeld(name)`: "Nothing was taken. {name} has saved your order for **30 minutes**." (the bold is markup in the component)
  - `payAgain(total)`: "Pay {total} again"
  - `payAnotherWay`: "Pay another way"
  - `triedWith(method, said)`: "Tried with {method}. The bank said: {said}."

  Malay versions:
  - "Bayaran tidak berjaya"
  - "Tiada wang diambil. {name} menyimpan pesanan anda selama **30 minit**."
  - "Bayar {total} sekali lagi"
  - "Bayar cara lain"
  - "Dicuba dengan {method}. Bank berkata: {said}." The words in `said` stay English (CHIP's) in this version.

- [ ] **Step 1: Write the failing tests:**
  - With a failed status `{ reason: 'cancelled', method: 'FPX · Maybank2u' }`:
    - the page shows the title and the 30-minute line with the shop name;
    - the code tiles are marked `data-tone="failed"`;
    - the lines and total show;
    - the footer reads `Tried with FPX · Maybank2u. The bank said: cancelled.`
  - **Pay another way:**
    - it posts to `/pay-another-way`;
    - it writes the returned lines to the basket through the same helper checkout reads (`changeLines` / the basket storage in `apps/web/app/[handle]/shop/`);
    - it navigates to `/{handle}/shop/checkout`.
  - **Method unknown:** with `method: null`, the footer reads `The bank said: cancelled.` alone.
- [ ] **Step 2:** Run them and expect FAIL.
- [ ] **Step 3: Implement.** Follow the board's `payfail` markup and CSS: a red ✕ in a soft circle, code tiles in `#6b5a60`, the main button, and an outline button.
- [ ] **Step 4:** Re-run the tests and expect PASS. Then run tsc and lint for web, and load a dev order page.
- [ ] **Step 5: Commit** with message `feat(web): a failed online payment gets its own page: nothing taken, the order held 30 minutes, pay again or another way`.

---

### Task 8: Owner UI for pickup places and times

**Files:**
- Create: `apps/web/app/app/store/pickup-places.tsx` and `pickup-places.test.tsx`
- Modify: `apps/web/app/app/store/delivery-tab.tsx` (lines ~123–145). The pickup note field is replaced by `<PickupPlaces>` while pickup is on.
- Modify: `apps/web/app/app/store/store-screen.tsx`, `store-editor.tsx`, `store-types.ts` and the store `page.tsx`, to load the places (add `getPickupPlaces(pageId)` to `packages/db-read/src/shop.query.ts`) and pass a `PickupApi`
- Modify: `apps/web/app/app/store/store.module.css`

**Interfaces:**
- **Consumes:** the Task 3 routes and types, and `windowLabel` and `windowProblem` from Task 1.
- **Produces:** `PickupApi = { list(): Promise<PickupPlaceView[]>; add(p: PlaceInput): Promise<PickupPlaceView[]>; save(id: string, p: PlaceInput): Promise<PickupPlaceView[]>; remove(id: string): Promise<PickupPlaceView[]>; reorder(ids: string[]): Promise<PickupPlaceView[]> }`.

- [ ] **Step 1: Write the failing tests:**
  - **Places:** each place lists as a row showing its name, address, and its times (`Any time` or `10am–12pm · 2pm–4pm (up to 5)`).
  - **Edit form:** **+ Add pickup place** opens an inline form with Name, Address, Map link (optional) and Note (optional). Then comes a **When** choice: **Any time that day** or **Set times**.
  - **Set times:** a list of rows, each with a start and end `<input type="time">` and a Limit (optional, placeholder `No limit`), plus **+ Add a time**.
  - **Validation:** saving with overlapping times shows `windowProblem`'s message and doesn't call the API.
  - **Saving** calls `add` or `save` with minutes, e.g. `10:00` becomes `600`.
  - **Remove** asks to confirm, then calls `remove`. The API's `PICKUP_LAST_PLACE` message shows in an error callout.
  - **Reordering** with the move up and down buttons calls `reorder`.
- [ ] **Step 2:** Run them and expect FAIL.
- [ ] **Step 3: Implement it in the store's existing style.**
  - The places list and inline editor follow `vouchers-tab.tsx`.
  - The form controls use `ui.float` and `ui.primaryButton`.
  - Mark the component and any file with hooks `'use client'`.
- [ ] **Step 4:** Re-run the tests and expect PASS. Then run tsc and lint for web, and load `/app/store?tab=delivery` (or the tab's real query) in dev.
- [ ] **Step 5: Commit** with message `feat(store): owners add pickup places, each open any time or at their own times with an optional limit`.

---

### Task 9: Customer picks the place and time, and orders show them everywhere

**Files:**
- Modify: `packages/db-read/src/shop.query.ts`, so the shop and checkout reads return `pickupPlaces: { id; name; address; mapUrl; note; anyTime; windows: { id; from; to }[] }[]` (not `pickupNote`)
- Create: `apps/web/app/[handle]/shop/checkout/pickup-picker.tsx` and its test
- Modify: `apps/web/app/[handle]/shop/checkout/checkout.tsx` and `page.tsx`, the Getting it section at line ~620 and the place call
- Modify: `apps/web/app/[handle]/shop/shop-view.tsx` (line ~94, `copy.pickup(...)` shows the first place's name, plus "+N more" when there are several), `shop-page.tsx` and `page.tsx`
- Modify, the order displays:
  - `packages/db-read/src/orders.query.ts`, whose public and owner order reads return the snapshot fields;
  - `apps/web/app/[handle]/order/[token]/order-view.tsx`;
  - `apps/web/app/app/orders/order-detail.tsx` and `orders-screen.tsx`;
  - `packages/core/src/order-mail.ts` (lines ~88 and ~162);
  - `apps/api/src/modules/chat/order-lookup.ts` (`when`).
- Modify: `apps/web/app/[handle]/shop/copy.ts`, adding English and Malay keys

**Interfaces:**
- **Consumes:**
  - `pickupLine` and `windowLabel` from Task 1;
  - `GET /store/:handle/pickup-times` and the `placeOrder` fields from Task 4;
  - the errors `PICKUP_TIME_FULL` and `PICKUP_TIME_GONE`.
- **Produces these copy keys:**
  - `pickupWhere`: "Where"
  - `pickupTime`: "Time"
  - `pickupFull`: "Full"
  - `pickupAnyTime`: "Any time that day"
  - `pickupTimeFull`: "That pickup time just filled up. Pick another."

  Malay versions: "Di mana", "Masa", "Penuh", "Bila-bila masa hari itu", "Masa ambil itu baru penuh. Pilih yang lain."

- [ ] **Step 1: Write the failing tests:**
  - **The picker:**
    - **Several places:** a radio group labelled `Where` lists each place's name and address, with a map link when given.
    - **One place:** there's no radio, and the place shows as text.
    - **Set times:** after a day is picked, it fetches `/pickup-times?place=…&day=…` and shows chips such as `10am–12pm`. A `full` window is disabled and reads `10am–12pm · Full`.
    - **Any time:** an anyTime place shows `Any time that day` and fetches nothing.
    - **Changing the day** clears the picked time.
  - **checkout.test:**
    - **Can't place yet:** placing is disabled until a time is picked for a set-times place.
    - **The order request** sends `pickupPlaceId` and `pickupWindowId`.
    - **The full race:** a `409 PICKUP_TIME_FULL` reply shows `pickupTimeFull`, re-fetches the times, and keeps the form.
  - **order-mail and order-lookup tests:** a pickup order with a snapshot reads `Pickup · Sat 5 Dec, 10am–12pm · Home, Seksyen 7`, and an old order with no snapshot still reads `Pickup · Sat 5 Dec`.
  - **The owner order detail test** shows the place address under the line.
- [ ] **Step 2:** Run them and expect FAIL.
- [ ] **Step 3: Implement.**
  - Put the picker in its own file. Checkout only holds `placeId` and `windowId` state and passes them through.
  - Every "Pickup · …" line goes through `pickupLine`, so the wording lives in one place.
- [ ] **Step 4:** Re-run the tests and expect PASS. Then run all the gates:
  - `pnpm turbo run typecheck lint --concurrency=1 --force`
  - `pnpm turbo run test --concurrency=1 --force`

  Load a dev shop's checkout with two places, one with set times.
- [ ] **Step 5: Commit** with message `feat(shop): customers pick where and when to collect, and every order shows the place and time`.
