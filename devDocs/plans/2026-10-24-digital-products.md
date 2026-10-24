# Digital products: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** shops sell digital items (files, a link, codes, or a session) alongside physical ones, delivered by email and on the order page once paid; plus the new Peek's-eyes favicon.

**Architecture:** items gain a kind (physical or digital) and, for digital, one of four deliveries. Codes and session seats are reserved when the order is placed and released when it is cancelled. Delivery happens at one place in the API, the moment an order becomes paid (CHIP settle or the owner's mark-paid): it creates the download grants, stamps `sentAt` and queues the emails. Digital files live in private storage (a private R2 bucket in production, local disk in development) and are only reached through a counted download route.

**Tech Stack:** Prisma 6 / Postgres 16, Fastify 5 + zod, Next.js 15 / React 19, CSS Modules, BullMQ workers, `@aws-sdk/client-s3` (+ `@aws-sdk/s3-request-presigner`), Vitest.

**Spec:** `design/HANDOFF.md` "Digital products, 24 Oct 2026"; the boards Store, Public, Emails, Orders. **What changed is exactly `git diff 09cea98 6c490e2 -- design/`** — read that diff for the board you touch; screens are in `design/screens/Digital_*`. Decisions from Iman that override the board: **files are at most 100 MB each** (the board says 200 MB); everything else as drawn, including 5 downloads per file per buyer, valid 30 days, resendable.

## Global Constraints

- Copy, colours, spacing and copy exactly from the boards. Every departure gets a row in `design/DEVIATIONS.md` (next free number: 206). Row 206 is the 100 MB limit.
- Files: up to 5 per item, at most 100 MB each (104 857 600 bytes), types PDF, images, ZIP, audio, video (the board's list). Download grants: one per order line per file, 5 uses, expire 30 days after they are made; "New links" makes fresh grants (5 uses, 30 days) and leaves old ones to expire.
- Link: URL (https only) plus an optional note of at most 200 characters; never shown before payment.
- Codes: one per line, trimmed, blanks and duplicates dropped; each buyer gets one unused code per unit bought; at 0 left the item is Sold out.
- Sessions: one or more times (date, time, seats ≥ 1), a duration in minutes, and Online (meeting URL) or In person (place). A full time can't be picked. Reminder email the day before (Malaysia time).
- Delivery only once paid. A digital-only order has no method and no day (both null); an order with any physical line keeps both required.
- Any digital line makes the customer's email required at checkout ("where we send your files").
- Digital items are Business-shop items like any other: same plan gate, same free-orders count.
- The order token is the customer's only credential, as now; download routes key off it.
- Bilingual: the public shop, checkout, order page and customer emails are EN and MS (follow the existing `copy.ts` pattern). The dashboard is English.
- Every CSS selector carries a local class; colours only through tokens; client hooks need `'use client'`.
- Never run Prettier over whole files; keep each file's style and line endings.
- Before each commit: `pnpm turbo run typecheck lint test --concurrency=1 --force` (exit status read, never piped; 0 failed, 0 cached) and `NEXT_DIST_DIR=.next-build pnpm --filter @curios/web build` plus `... --filter @curios/admin build` (exit 0), then `git checkout -- apps/web/next-env.d.ts apps/web/tsconfig.json apps/admin/next-env.d.ts apps/admin/tsconfig.json`. After a migration: `pnpm --filter @curios/db generate`, migrate dev and test DBs, re-run `packages/db/prisma/sql/readonly-role.sql` on both. Never use the test DB as a shadow DB.

## Review Focus

1. **Two buyers racing for the last code or the last seat** must not both get it: one order places, the other gets a clear "sold out / time full" error. Pinned in Task 4 by a concurrent placement test.
2. **A cancelled or refunded order** releases its reserved codes and seats, and its download grants stop working (the download route refuses a cancelled order). Pinned in Tasks 4 and 5.
3. **Delivery happens once**: a CHIP callback and the owner's mark-paid racing, or a webhook replayed, never makes two sets of grants or two delivery emails. Pinned in Task 5.
4. **A download past 5 uses or 30 days** is refused with a clear message pointing to the order page, never a broken file; the customer can still see everything else on the order page. Pinned in Task 5.
5. **An item switched from digital to physical (or its delivery changed) after it was sold** must not break existing orders: what was sold is snapshotted on the order line. Pinned in Task 1 (snapshot columns) and Task 4.

---

### Task 1: Data

**Files:** `packages/db/prisma/schema.prisma`, `packages/db/prisma/migrations/20261024000000_digital_products/migration.sql`, `packages/core/src/digital.ts` (+ index export and a `./digital` subpath), tests.

**Interfaces — Produces (Prisma):**
- `enum ItemKind { PHYSICAL DIGITAL }`, `enum DigitalDelivery { FILES LINK CODES SESSION }`, `enum SessionPlace { ONLINE IN_PERSON }`.
- `Item.kind ItemKind @default(PHYSICAL)`, `Item.delivery DigitalDelivery?`, `Item.accessUrl String?`, `Item.accessNote String?`, `Item.sessionMinutes Int?`, `Item.sessionPlace SessionPlace?`, `Item.sessionWhere String?` (meeting URL or place).
- `ItemFile { id, itemId → Item Cascade, key, name, sizeBytes Int, contentType, position Int, createdAt }`.
- `ItemCode { id, itemId → Item Cascade, code, orderLineId String? → OrderLine SetNull, givenAt DateTime?, createdAt; @@unique([itemId, code]); @@index([itemId, orderLineId]) }`.
- `ItemSession { id, itemId → Item Cascade, startsAt DateTime, seats Int, createdAt; @@index([itemId, startsAt]) }`.
- `SessionBooking { id, sessionId → ItemSession Restrict, orderLineId → OrderLine Cascade, seats Int, createdAt; @@unique([orderLineId]) }`.
- `DownloadGrant { id, token String @unique (hashed like order tokens), orderLineId → OrderLine Cascade, fileId → ItemFile SetNull (nullable), fileName, usesLeft Int, expiresAt, createdAt, lastUsedAt? }`.
- `OrderLine` snapshots: `kind ItemKind @default(PHYSICAL)`, `delivery DigitalDelivery?`.
- `Order.method` and `Order.day` become nullable; `Order.email String?`; `Order.sentAt DateTime?`; `SessionBooking.remindedAt DateTime?`; `OrderLine.linkOpenedAt DateTime?`.

**Interfaces — Produces (core `digital.ts`):** `MAX_DIGITAL_FILES = 5`, `MAX_DIGITAL_FILE_BYTES = 104_857_600`, `DOWNLOAD_USES = 5`, `DOWNLOAD_DAYS = 30`, `ACCESS_NOTE_MAX = 200`, `DIGITAL_FILE_TYPES` (MIME list: application/pdf, image/*, application/zip, audio/*, video/*), `parseCodes(text: string): string[]` (trim, drop blanks, dedupe, keep order), `isDigitalOnly(lines: { kind: ItemKind }[]): boolean`, `seatsLeft(session: { seats: number }, booked: number): number`.

- [ ] **Step 1: Tests** — `parseCodes(' A1 \n\nA1\nB2 ')` → `['A1','B2']`; `isDigitalOnly` true/false/empty(false); `seatsLeft({seats:10},10)` → 0; schema test: deleting an item with a given code keeps the order line (code row cascades with the item, order line untouched); an OrderLine keeps `kind`/`delivery` after the item changes.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement**; fix every typecheck fallout of nullable `Order.method`/`day` (treat null as digital-only; behaviour for physical orders unchanged). **Step 4: Run** → PASS; gates. **Step 5: Commit** `feat(digital): items can be digital, and orders can have no day`.

### Task 2: Private file storage

**Files:** `apps/api/src/modules/store/private-files.ts` (+ test), `apps/api/package.json` (`@aws-sdk/s3-request-presigner`), `.env.example` (`STORAGE_PRIVATE_BUCKET`), `.gitignore` (`apps/api/.files/`).

**Interfaces — Produces:** `interface PrivateFiles { put(key: string, body: NodeJS.ReadableStream | Buffer, contentType: string, sizeBytes: number): Promise<void>; remove(key: string): Promise<void>; deliver(key: string, fileName: string): Promise<{ redirect: string } | { stream: NodeJS.ReadableStream; contentType: string }> }`; `resolvePrivateFiles(option?: PrivateFiles | null): PrivateFiles | null` — S3 against `STORAGE_PRIVATE_BUCKET` (presigned GET, 5 minutes, `Content-Disposition: attachment; filename*=…`) when storage is configured; a local-disk store under `apps/api/.files/` when storage is disabled in development; `null` never in development (disk always works), and production requires the private bucket (fail at boot, as `resolveStore` does).

- [ ] **Step 1: Tests** — disk store round trip (put, deliver stream equals bytes, remove); S3 store `deliver` returns a presigned URL containing the key and a 300-second expiry and the attachment filename (mock the client); production without `STORAGE_PRIVATE_BUCKET` throws at resolve.
- [ ] **Step 2–4.** **Step 5: Commit** `feat(digital): private storage for files`.

### Task 3: Store API for digital items

**Files:** `apps/api/src/modules/store/item.service.ts`, `store.routes.ts`, `store.errors.ts`, new `digital-item.service.ts` (+ tests).

**Interfaces — Consumes:** Tasks 1–2. **Produces (all owner-only, under the existing store session scope):**
- Item create/update accept `kind`, `delivery`, `accessUrl`, `accessNote`, `sessionMinutes`, `sessionPlace`, `sessionWhere` with zod rules from the constraints (switching to PHYSICAL clears digital fields; DIGITAL requires `delivery`; LINK requires an https `accessUrl`; SESSION requires minutes > 0 and `sessionWhere`).
- `POST /store/items/:id/files` (raw body upload, `bodyLimit` 100 MB, header `x-file-name`, content type checked against `DIGITAL_FILE_TYPES`, 409 `TOO_MANY_FILES` at 5, 413 `FILE_TOO_BIG`) → `{ id, name, sizeBytes }`; `DELETE /store/items/:id/files/:fileId`; reorder optional.
- `PUT /store/items/:id/codes` body `{ text }` → adds parsed codes, returns `{ added, left }`; `DELETE /store/items/:id/codes/:codeId` (unused only).
- `POST /store/items/:id/sessions` `{ startsAt, seats }`, `PATCH …/sessions/:sessionId` (seats can't go below booked: 409 `SEATS_BOOKED`), `DELETE` (only with no bookings: 409).
- The owner store read (`packages/db-read` `getOwnerStore`) returns, per digital item: files (name, size), codes left, sessions with seats left.

- [ ] **Step 1: Tests** for each rule and route (including 401 without a session and another owner's item → 404), a 101 MB upload → 413, a 6th file → 409, codes added/deduped/left count, seats below booked → 409.
- [ ] **Steps 2–5.** Commit `feat(digital): the store API for files, links, codes and sessions`.

### Task 4: Shop, checkout and placing an order

**Files:** `packages/db-read/src/shop.query.ts` (+ orders `getCheckout`/`getShopItem`), `apps/web/app/[handle]/shop/**` (cards, item page, basket, checkout, copy EN+MS), `apps/api/src/modules/orders/place.service.ts` + routes, tests.

**Interfaces:** public shop items carry `kind`, `delivery`, a `format` line (e.g. "PDF · 2 files"), `soldOut` (codes left 0, or every session time full), and sessions `{ id, startsAt, seatsLeft }`. `PlaceInput` gains `email?: string` and per line `sessionId?: string`; `method`/`day` become optional and must be absent for a digital-only basket and present otherwise. Placement, inside the existing transaction: lock each CODES item's free codes (`SELECT … FOR UPDATE SKIP LOCKED` or a row lock on the item) and set `orderLineId` on `quantity` codes, else 409 `SOLD_OUT`; lock each chosen session row and create a `SessionBooking` (`seats = quantity`) if `seats − booked ≥ quantity`, else 409 `TIME_FULL`; snapshot `kind`/`delivery` on lines; store `Order.email`. Cancel / not-received / CHIP expiry paths that end an unpaid order release codes (`orderLineId = null`) and delete bookings.

Shop UI from the Public board diff: "Digital" tag on card and item page and its own category; item page arrival text and format instead of notice days; sessions "Pick a time" with seats left and full times disabled; checkout digital-only skips Getting it and Day and shows "By email, right after you pay", no delivery fee; mixed keeps them with the line about digital coming by email; the required Email field; summary "Digital items · By email".

- [ ] **Step 1: Tests** — digital-only order with no method/day places; mixed without a day → 400; digital without email → 400; two concurrent orders for the last code → one 201, one 409 `SOLD_OUT`; same for the last seat → `TIME_FULL`; cancelling releases both; shop shows Sold out at 0 codes; checkout renders the digital-only and mixed variants (EN and MS strings).
- [ ] **Steps 2–5.** Commit `feat(digital): the shop sells digital items, and checkout needs no day for them`.

### Task 5: Delivery and downloads

**Files:** `apps/api/src/modules/orders/deliver.service.ts` (+ test), hooks in `owner.service.ts` `markPaid` and `pay-online.service.ts` settle, `apps/api/src/modules/orders/download.routes.ts` (+ test), owner routes for resend/new links/new code/move time.

**Interfaces — Produces:** `deliverOrder(tx, orderId, now): Promise<boolean>` — a conditional update `sentAt: null → now` on a PAID order that has digital lines; when it wins, creates one `DownloadGrant` per FILES line per file (5 uses, 30 days), stamps `ItemCode.givenAt`, and returns true so the caller queues the delivery email (Task 6) after commit. Called from both paid paths inside their transactions. `GET /store/orders/:token/files/:grantToken` → checks the order is PAID/COMPLETED (not cancelled), the grant belongs to it, `usesLeft > 0`, not expired; decrements atomically; responds with the private store's redirect or stream; otherwise 410 with `DOWNLOAD_USED_UP` / `DOWNLOAD_EXPIRED` / `ORDER_NOT_PAID`. `GET /store/orders/:token/link/:lineId` → for a paid LINK line, stamps `OrderLine.linkOpenedAt` if null and redirects to the item's `accessUrl` (the order page and email use it, so Orders can say "link opened"). Owner actions (`/store/orders/:id/…`): `resend` (re-queue the delivery email), `new-links` (fresh grants for every file), `new-code` (give another unused code to a line, `SOLD_OUT` if none), `move-time` `{ sessionId }` (rebook the line if the new time has room). Each owner action is scoped to the owner and logs nothing new.

- [ ] **Step 1: Tests** — CHIP settle and markPaid both deliver once even when raced (Promise.all) and when the webhook is replayed; a physical-only order is not "sent"; download 5 times OK, 6th → 410 `DOWNLOAD_USED_UP`; expired → 410; cancelled order → 410; another order's grant token → 404; new-links resets; move-time respects seats.
- [ ] **Steps 2–5.** Commit `feat(digital): paid orders deliver once, and downloads are counted`.

### Task 6: Emails

**Files:** `packages/core/src/digital-mail.ts` (+ test), the API/worker call sites that queue them, `apps/workers/src/` daily reminder job (+ test).

**Interfaces — Produces:** `digitalDeliveryMail(input)` to the customer from "{Shop} via Curios": everything bought with download buttons (grant URLs), link and note, code, session time with Join / place and Add to calendar, plus "Open your order page" (EN/MS by page language); `sessionReminderMail(input)` the day before; `paidAndSentOwnerMail(input)` "New order #15 · RM214 · Paid and sent". Copy and layout from the Emails board diff; built with the existing `renderMailHtml`. Reminder job: daily, finds `SessionBooking` for PAID orders whose session starts tomorrow (Malaysia) and `remindedAt` null, claims with a conditional update, queues the reminder.

- [ ] **Step 1: Tests** — each mail's subject and key lines; HTML escapes owner-entered text; reminder job sends once per booking and skips cancelled orders. **Steps 2–5.** Commit `feat(digital): the delivery, reminder and paid-and-sent emails`.

### Task 7: The customer's order page

**Files:** `apps/web/app/[handle]/order/[token]/**`, `packages/db-read` `getOrderByToken`, `apps/web/app/[handle]/order/[token]/calendar/route.ts` (an `.ics` for a session), copy EN+MS, tests.

Before payment: the locked note. After: "Your downloads and access" (Download per file with uses left, link with note, code with Copy, session time with Join and Add to calendar). Digital-only orders: the 3-step timeline Placed, Paid, Sent, status "Sent". The placed screen after an online payment: "Paid. It's on its way to your email" with the button to the downloads. Suspended pages keep their current behaviour (no pay box), and the downloads section still shows for a paid order. From the Public board diff.

- [ ] **Step 1: Tests** — locked before paid, each delivery type rendered after paid, used-up file shows "0 left" and no button, `.ics` has the right times. **Steps 2–5.** Commit `feat(digital): the order page hands over what was bought`.

### Task 8: The Store editor

**Files:** `apps/web/app/app/store/item-editor.tsx` and new `digital-fields.tsx` (+ tests), `items-list.tsx`, preview, `store-types.ts`, CSS.

From the Store board diff: the "What it is" Physical / Digital switch above Price; "How they get it" with the four panels (file upload with progress and the 100 MB / 5-file limits, link + note with a 200 counter, codes textarea with "N left", sessions list with add/edit/remove and duration and Online/In person); list line "Digital · RM25"; preview "Digital" tag. Uses Task 3's routes.

- [ ] **Step 1: Tests** — switching kind shows/hides panels; a 101 MB file is refused before upload; codes left updates; a session with bookings can't be deleted (button disabled with the reason). **Steps 2–5.** Load `/app/store` on the dev server. Commit `feat(digital): the store editor sells files, links, codes and sessions`.

### Task 9: The owner's Orders

**Files:** `apps/web/app/app/orders/**`, `packages/db-read/src/orders.query.ts`, tests.

From the Orders board diff: rows say "Digital" instead of pickup/delivery; status "Sent" once delivered; QR orders' button reads "Mark paid and send" when the order has digital lines; the "Sent by email" card replaces "Getting it to them" for digital-only orders (and sits beside it for mixed): who it went to, per item what happened (downloads used, seat booked, code given, link opened from `OrderLine.linkOpenedAt`), and the actions New links, Move time, New code, Resend the email (Task 5 routes).

- [ ] **Step 1: Tests** for each element and action call. **Steps 2–5.** Commit `feat(digital): Orders shows what was sent, with its actions`.

### Task 10: Favicon, and the record

**Files:** `apps/web/app/icon.svg`, `apple-icon.png`, `favicon.ico`, the email avatar asset and the landing badge if they use the old icon (copy from `design/brand/` per HANDOFF), `apps/admin/app/` icons if admin has any; `design/DEVIATIONS.md` (row 206: 100 MB; plus anything earlier tasks logged); `devDocs/OPERATIONS.md` (`STORAGE_PRIVATE_BUCKET`, the dev `.files` folder, the reminder job).

- [ ] **Step 1:** a test that `apps/web/app/icon.svg` equals `design/brand/icon.svg`. **Steps 2–5.** Commit `feat(brand): Peek's eyes favicon, and the docs for digital products`.
