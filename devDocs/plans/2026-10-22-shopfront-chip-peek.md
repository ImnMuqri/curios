# Shopfront, CHIP for shops, and Peek: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** build the 22 Oct 2026 design update: the eyes wordmark, new favicons and Peek the mascot on Curios's own pages; a shop page and product pages with plain AI replies and product cards; and owners connecting their own CHIP account so customers pay at checkout straight from their bank or e-wallet, with orders marked paid by themselves.

**Architecture:** six areas, built in order, one commit (or more) per area, never mixing areas. Visual work copies markup, SVG, CSS and copy from the boards. CHIP for shops reuses `packages/billing`'s CHIP client with each owner's own key (stored encrypted, server only), and a per-shop callback verified with that owner's public key.

**Tech Stack:** TypeScript, Next.js 15 + React 19, CSS Modules, Fastify 5 + zod, Prisma 6 / Postgres 16, BullMQ, Vitest + Testing Library; Node `crypto` (AES-256-GCM, RSA verify).

**Spec:** `design/HANDOFF.md` sections "Update, 22 Oct 2026: shopfront, AI replies, CHIP" and "Update, 22 Oct 2026 (evening): logo, favicon and the mascot"; the boards in `design/boards` (the source of truth for markup, CSS and copy; `TanyaJe.dc.html` is the landing, `Main.dc.html` is the older as-built landing, ignore `Landing2`/`Hero*`); the owner's answers in this plan's Global Constraints; and, for CHIP mechanics only, `devDocs/chip-payments-design.md` Part 2 and `devDocs/vendor/chip-collect.v1.yaml`. Where Part 2 and the boards disagree, the boards win.

## Global Constraints

- **Copy SVGs, colours, spacing and copy exactly from the boards. Don't redesign.** Every departure gets a row in `design/DEVIATIONS.md` (next free number: **143**).
- **Owner's answers (2026-10-22), binding:**
  1. Business billing keeps the **opt-in** card auto-renew already built. Record as a deviation from "nothing saved and nothing charged automatically" (Billing board, TanyaJe pricing, HANDOFF).
  2. Checkout asks for an **email only when an online method is picked**, labelled "For your receipt" (CHIP requires `client.email`).
  3. **Boost is dropped** from the e-wallet list (CHIP has no online Boost).
  4. "Test with RM1" stays; the test purchase offers **card or e-wallet only** (`payment_method_whitelist`), never FPX.
  5. Item fields: **category** free text with suggestions from the owner's other items; **one tag** from Best seller / Pre-order / New, or a custom word (max 20 chars); **halal** is a shop-wide switch; the product **slug** is made from the name at creation, **frozen on rename**, unique per page (`-2`, `-3`…); `?item=<id>` links redirect to the slug.
  6. Sign-in panel shows the board's **sample counts** (no session before login).
  7. Sign-up caption is reworded because handles aren't held: title "We'll save this name for you", line "Finish signing up to claim curios.my/{handle}."
  8. Onboarding panel **follows the board** (no streaming facts while reading, no step-3 phone preview).
  9. Product cards appear for items **named in the answer** (the existing `orderChips` matcher), at most one card per answer.
  10. Email wordmark: a **hosted 2x PNG** of the eyes wordmark with `alt="curios"`.
  11. Peek looks down while the email field has **focus** and covers its eyes while the password field has **focus**; on the landing it smiles once the claim field **has text** (`:focus:not(:placeholder-shown)`).
- HANDOFF "Open decisions" 1–3 are already settled (RM49; the four plan emails; lapsed wording). Strike them in Area 1's commit; don't ask again.
- **Peek appears only on Curios's own pages, never under `apps/web/app/[handle]`.**
- **CHIP:** never `direct_post_url`. Card payments use CHIP's own card page. FPX and e-wallet skip CHIP's page with `checkout_url?preferred=…` params (codes below). There is exactly **one** QR option: the owner's own DuitNow QR with receipt upload; never CHIP's `duitnow_qr`.
- **The owner's CHIP secret key never reaches the client**: stored AES-256-GCM-encrypted in its own table, never selected by page queries, never in an API response, never logged.
- Every shop callback is verified (RSA PKCS#1 v1.5 / SHA-256 over the raw body, `X-Signature`) with **that owner's** public key, then the purchase is fetched with that owner's key before anything is marked paid. Reuse `apps/api/src/plugins/raw-json.ts` and `@curios/billing`'s `verifyChipSignature`.
- Money is integer sen. Client components never import the `@curios/core` barrel at runtime. Every CSS selector carries a local class (`next dev` refuses otherwise). Colours only through tokens (`packages/ui/src/tokens.css`), adding tokens for board hex values.
- Reduced motion turns off every animation added here.
- **Before each area's commit:** `pnpm turbo run typecheck lint test --concurrency=1 --force` (read the exit status, never pipe; 0 failed, 0 cached) **and** `pnpm --filter @curios/web build` (exit 0). Then load the changed pages in `pnpm dev` at 390px and desktop (memories: `next dev` must be restarted after a schema change; `CDP full-page capture freezes animations`).
- Test DB is tmpfs: if many db suites fail at once, restore with `prisma migrate deploy` against `DATABASE_URL_TEST` plus `packages/db/prisma/sql/readonly-role.sql`.

## CHIP codes (from CHIP's "Direct Post & Skip Payment Page" docs, 2026-10-22; spot-check in test mode)

| Board choice | `preferred` | extra param |
|---|---|---|
| Maybank2u | `fpx` | `fpx_bank_code=MB2U0227` |
| CIMB Clicks | `fpx` | `fpx_bank_code=BCBB0235` |
| Public Bank | `fpx` | `fpx_bank_code=PBB0233` |
| RHB Now | `fpx` | `fpx_bank_code=RHB0218` |
| Bank Islam | `fpx` | `fpx_bank_code=BIMB0340` |
| Hong Leong | `fpx` | `fpx_bank_code=HLB0224` |
| Touch 'n Go | `razer_tng` | `razer_bank_code=TNG-EWALLET` |
| GrabPay | `razer_grabpay` | `razer_bank_code=GrabPay` |
| ShopeePay | `shopee_pay` (fall back to `razer_shopeepay` if that is what `GET /payment_methods/` offers) | none |
| Card | `visa` (CHIP's card page) | none |

Only offer a method if `GET /payment_methods/?brand_id=…&currency=MYR&amount=<order total>` (owner's key) lists it.

## Review Focus

1. **A forged or replayed shop callback** (signed with Curios's key, another shop's key, or unsigned) never marks an order paid. Pinned in Task 13.
2. **The customer pays, then closes the tab before coming back.** The order still becomes Paid (callback), and the order page shows Paid when reopened. Pinned in Task 13.
3. **The owner disconnects CHIP or their key stops working mid-checkout.** Checkout falls back to the QR option, says so, and the order is never stuck. Pinned in Task 12 and 13.
4. **An item renamed after its link was shared.** The old link still opens the product (slug frozen; `?item=` redirects). Pinned in Task 7.
5. **Two Peeks on one page** (landing hero and closing) or a Peek next to the eyes wordmark: SVG ids never collide (`useId`). Pinned in Task 2.

---

## Area 1: Logo wordmark, favicon set, peeking Peek

### Task 1: The eyes wordmark, favicons and the email wordmark

**Files:** `apps/web/app/_landing/Wordmark.tsx`, `wordmark.module.css` (+ test); `apps/web/app/icon.svg`, `apple-icon.png` (replacing `apple-icon.tsx`), `favicon.ico`; `apps/web/app/_landing/Business.tsx` (notification badge); `apps/web/public/email/wordmark@2x.png`; `packages/core/src/mail.ts` (header); `design/HANDOFF.md` (strike Open decisions 1–3); `design/DEVIATIONS.md` (row 83 updated).

**Interfaces:**
- Produces: `Wordmark({ className?, tone?: 'ink' | 'ghost', children? })` — `children` renders inside the `.mo` span (Task 5's footer Peek); the o's colours come from CSS custom properties `--mo-ring` / `--mo-eye` (default `--biru`; ghost `#2a3248` via a token).

- [ ] **Step 1: Tests.** `renders curi, the eyes o and s, with "curios" as its accessible name`; `the o carries the ring, eyes and happy arcs`; `two wordmarks on one page have no duplicate ids`; mail: `the header is the hosted wordmark image with alt "curios"`.
- [ ] **Step 2: Run** `pnpm --filter @curios/web test -- Wordmark` and `pnpm --filter @curios/core test -- mail` → FAIL.
- [ ] **Step 3: Implement.** Markup from `SignIn.dc.html:222`; CSS from `SignIn.dc.html:69-78` (`.mo`, `.mo-r`, `.mo-e` with `moLook 10s`, `.mo-h`, hover swap via `a:hover > .mark`, reduced motion). Do not port the old `.i::before` rules. Favicons: copy `design/brand/icon.svg` → `apps/web/app/icon.svg`, `apple-icon.png`, `favicon.ico` (delete `apple-icon.tsx`). Notification badge: the 30px icon SVG from `TanyaJe.dc.html:926-930`. Email: render the wordmark to `public/email/wordmark@2x.png` (height 56px for a 28px display) and reference it by absolute `APP_URL` in `mail.ts` with `width`/`height` attributes and `alt="curios"`; DEVIATIONS 83 updated to say so.
- [ ] **Step 4: Run** → PASS; gates + build; load `/`, `/signin`, `/app` in dev.
- [ ] **Step 5: Commit** `feat(brand): the eyes wordmark and the peeking favicon`.

### Task 2: Peek, peeking over the fields

**Files:** Create `apps/web/app/_peek/Peek.tsx`, `peek.module.css` (+ test). Modify `packages/ui/src/field/Field.tsx` (+ test) for an `adornment` slot; `apps/web/app/signin/signin-form.tsx`, `apps/web/app/signup/signup-form.tsx`, `apps/web/app/_landing/Claim.tsx`, `tanya.module.css`.

**Interfaces:**
- Produces: `Peek({ width, right, top, variant: 'auth' | 'claim' })` rendering the body layer (`.pk`, z 0) and the hands layer (`.pk-front`, z 3) around a field whose input sits at z 1; SVG from `SignIn.dc.html:229`, CSS from `SignIn.dc.html:40-67` (auth) and `TanyaJe.dc.html:14-38` (claim). `Field` gains `adornment?: ReactNode` rendered inside the field wrapper, with the input lifted to z 1.

- [ ] **Step 1: Tests.** `Peek's two layers sit behind and in front of the field`; `two Peeks on one page have unique clip ids`; sign in: `the email field carries Peek`; landing: `both claim fields carry Peek`; `no file under app/[handle] imports Peek` (a test that globs the directory).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Behaviour in CSS with `form:has()`: email `:focus` → pupils down; `#password:focus` → cover hands; landing `#claim-hero` / `#claim-end` `:focus:not(:placeholder-shown)` → happy arcs. `pkUp` slide-up once; reduced motion off. Positions from the boards (sign in 84/18/-18.8, landing hero 78/26/-41.6, closing 104/40/-55.5).
- [ ] **Step 4: Run** → PASS; gates + build; load `/signin`, `/signup`, `/`, `/ms` in dev and focus each field.
- [ ] **Step 5: Commit** `feat(brand): Peek peeks over sign in, sign up and the claim fields`.

## Area 2: Sign in, sign up and onboarding panels

### Task 3: The sign in and sign up panels

**Files:** Replace `apps/web/app/_auth/AuthFilm.tsx` + `film.module.css` with `AuthScene.tsx` + `scene.module.css` (+ test); modify `AuthShell.tsx`, `signup-form.tsx` (pass the handle); `design/DEVIATIONS.md` (rows 3 superseded; new rows for the sample counts and the sign-up caption).

- [ ] **Step 1: Tests.** `sign in shows Peek with a phone, three cards and "While you were away"`; `sign up shows the handle on Peek's sign with a tick and the reworded caption`; `without a handle, the sign reads curios.my/yourname with no tick`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Sign in: `SignIn.dc.html:14-38` CSS, `:236-246` markup, panel `#eef1fb`, the board's cards and caption ("While you were away" / "Your page answered 12 questions and saved 2 numbers."). Sign up: `SignUp.dc.html:247-260`, panel `#fdf3e3`, caption per Global Constraint 7. Panel hidden at ≤980px; reduced motion stops all of it.
- [ ] **Step 4: Run** → PASS; gates + build; load both pages at 1280px.
- [ ] **Step 5: Commit** `feat(auth): Peek on the sign in and sign up panels`.

### Task 4: The onboarding panel

**Files:** Modify `apps/web/app/app/onboarding/onboarding.tsx` (`OnboardingArt` and its caption), `onboarding.module.css` (+ tests); `design/DEVIATIONS.md` (rows 88, 92 superseded; row 89's failed read uses the Nothing-found pose).

- [ ] **Step 1: Tests.** One per state from `Onboarding.dc.html:318-323` and `design/screens/Onboarding_panel_states.png`: claim with tick ("It's yours") and without ("Pick an address"); Business bag ("A page that sells") / Personal wave ("A page about you"); reading paper ("Give it something to read"); scan line while reading ("Reading it now"); cheering with the first 3 facts ("Found N facts"); nothing found ("Nothing to read there"), also used for a failed read.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** from `Onboarding.dc.html:14-49` (CSS), `:174`, `:214`, `:279` (markup); remove the phone, pill, satellites and list.
- [ ] **Step 4: Run** → PASS; gates + build; walk onboarding in dev.
- [ ] **Step 5: Commit** `feat(onboarding): Peek on the onboarding panel`.

## Area 3: Landing footer and For business

### Task 5: The footer's full-body Peek

**Files:** `apps/web/app/_landing/Footer.tsx`, `tanya.module.css`, `landing-tokens.css` (+ landing test).

- [ ] **Step 1: Test** `the footer wordmark carries the full-body Peek on its o`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** from `TanyaJe.dc.html:460-482` and `:1104`: `.ft-mark` Bricolage 800, 31vw, the shine, the ghost o `#2a3248`, `.pkf` on the o in em units with the wave, bob, blink and look-around; fix `.footMark`'s `overflow:hidden` so Peek isn't clipped (clip horizontally only).
- [ ] **Step 4: Run** → PASS; gates + build; load `/` at 390 and 1440.
- [ ] **Step 5: Commit** `feat(landing): Peek stands on the footer's o`.

### Task 6: For business

**Files:** `apps/web/app/_landing/Business.tsx`, `order-scene.ts` (+ tests), `copy.ts` (EN + MS), `tanya.module.css`; `design/DEVIATIONS.md` (row 1 refreshed).

- [ ] **Step 1: Tests.** `order-scene` frames: the shop grid with a tag and a + count; "How you'll pay" with FPX picked, then Maybank2u under "Your bank"; "Pay RM235 with Maybank2u" from p ≥ .55; "Opening Maybank2u…" then "Approved in Maybank2u"; "Payment processed by CHIP"; the owner's Orders mirror with #14 "Paid online", the green "Paid by FPX. Ready on Sat 17 Oct" box and "Mark completed" → "Completed". Component: `a step can be clicked to jump to it`; `hovering the phones pauses`; `each step has its own duration and a progress line`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** from `TanyaJe.dc.html:235-380` (CSS), `:814-935` (markup), `:1216-1299` (`ofVals`) and `:1302-1335` (timer: boundaries `[0,.24,.5,.64,.76,1]`, durations `[3800,4600,4800,2600,4000]`, 2.6 s hold, start at ≥30% in view). Fix the stale stage aria-label. Malay copy mirrors the English (the owner reads new Malay).
- [ ] **Step 4: Run** → PASS; gates + build; watch the loop in dev.
- [ ] **Step 5: Commit** `feat(landing): For business pays through CHIP`.

## Area 4: Public page

### Task 7: Item slugs, categories, tags and the shop's halal switch

**Files:** `packages/db/prisma/schema.prisma` + migration `2026102300000_shop_item_fields` (Item.slug String with `@@unique([pageId, slug])`, Item.category String?, Item.tag String?, Page.shopHalal Boolean @default(false)); slug backfill in the migration (from names, de-duplicated); `packages/core/src/slug.ts` (`itemSlug(name, taken)`); `apps/api/src/modules/store/item.service.ts`, `store.routes.ts`, `settings.service.ts` (+ tests); `apps/web/app/app/store/item-editor.tsx`, the Store settings (halal switch) (+ tests); `design/DEVIATIONS.md` (rows for the item fields, not drawn).

- [ ] **Step 1: Tests.** `a new item gets a slug from its name`; `a clashing name gets -2`; `renaming an item keeps its slug`; `category and tag are saved and trimmed; a tag over 20 characters is refused`; `the category field suggests the owner's other categories`; `the halal switch saves`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Hand-written migration (never `migrate diff` with the test DB as shadow).
- [ ] **Step 4: Run** → PASS; gates + build; regenerate Prisma and restart dev; edit an item in Store.
- [ ] **Step 5: Commit** `feat(store): items get a link, a category and a tag; shops can say halal`.

### Task 8: Links and Ask only, the shop pill and the basket bar

**Files:** `apps/web/app/_bento/BentoPage.tsx`, `Bento.module.css`; `apps/web/app/[handle]/page.tsx`; `packages/db-read/src/shop.query.ts`, `page.query` (three photos, next pickup day, basket pricing data); create `apps/web/app/[handle]/shop/basket-bar.tsx` (+ tests); `apps/web/app/app/curios/my-curios.tsx` and the Store preview; `design/DEVIATIONS.md` (row 18 superseded).

- [ ] **Step 1: Tests.** `a business page has Links and Ask tabs only`; `the shop is the first link: accent pill, three photos, "Shop · N items · next pickup …"`; `no shop pill without items`; `the basket bar shows on Links when the basket has something`; `the preview switch has no Shop tab`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** from `Public.dc.html:518-523`, `:88-98`, `.bar` `:64`. Next pickup day from `openDays()` in `packages/core/src/orders.ts`; delivery-only shops read "next delivery …"; a paused shop drops the day.
- [ ] **Step 4: Run** → PASS; gates + build; load a business page in dev.
- [ ] **Step 5: Commit** `feat(public): the shop is the first link, and the basket follows you`.

### Task 9: The shop page

**Files:** `apps/web/app/[handle]/shop/page.tsx`, `shop-view.tsx`, `shop.module.css`, `copy.ts` (+ tests).

- [ ] **Step 1: Tests** for every element in HANDOFF's shop list against `Public.dc.html:541-556`: top bar (back, `curios.my/{h}/shop`, share via Web Share with a copy-link fallback); "Open for orders" sign (paused wording when orders are paused); name in the owner's heading font; area (`pickupNote`); pickup/delivery; next pickup day; the owner's note as a bubble with the page's initial and name (no date: Page has none; DEVIATIONS row); sticky category chips with counts (hidden when no item has a category); two-column cards with square photos and tags; + on the photo turning into the count (adds the first option); "Want something not listed? Ask a question" → `/{h}#ask`; empty state.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** from `Public.dc.html:99-131`; the item sheet goes in Task 10.
- [ ] **Step 4: Run** → PASS; gates + build; load the shop at 390 and desktop.
- [ ] **Step 5: Commit** `feat(public): the shop gets its own page`.

### Task 10: The product page

**Files:** create `apps/web/app/[handle]/shop/[slug]/page.tsx`, `product-view.tsx`, `product.module.css` (+ tests); `packages/db-read` `getShopItem(handle, slug)`; `shop/page.tsx` (`?item=<id>` → redirect to the slug); `apps/web/app/[handle]/ask.tsx` (`?q=` prefill); remove `ItemSheet`; the Store preview's item screen.

- [ ] **Step 1: Tests.** `the product page shows the 4:3 photo, tag, name, price, description`; `size cards change the price`; `notice line "Needs N days. Earliest pickup …"`; `halal line only when the shop says halal`; `"Ask about this" opens Ask with the question prefilled`; `−/+ and "Add to basket · RM…" adds and returns to the shop`; `?item=<id> redirects to the product's slug`; `an unknown slug is a 404`; metadata title and image.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** from `Public.dc.html:558-571`, `:132-157`.
- [ ] **Step 4: Run** → PASS; gates + build; load a product page and a shared `?item=` link.
- [ ] **Step 5: Commit** `feat(public): every product has its own page`.

### Task 11: Plain AI replies and product cards

**Files:** `packages/ui/src/chat/ChatMode.tsx`, `ChatMode.module.css`, `AnswerBubble.*` (+ tests); `apps/api/src/modules/chat/order-lookup.ts`, `chat.service.ts` (the `done` event carries `productCard: { slug, name, fromPriceCents, photoUrl, firstOptionId } | null`, at most one); `apps/web/app/[handle]/ask.tsx`; `apps/web/app/_landing/PageCard.tsx`, `Who.tsx`, `tanya.module.css` (light version).

- [ ] **Step 1: Tests.** `the visitor's message is a see-through bubble`; `the reply has no bubble, a dot and "{Name}'s page" label, 15px/1.6`; `an answer naming an item is followed by one product card`; `Add to basket adds the first option and turns into "In your basket"`; `the card's photo opens the product page`; `no card when the shop is closed`; landing: `the floating chat's reply is a white card with the label`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** from `Public.dc.html:47-49`, `:158-165`, `:527-530`; `Main.dc.html:201,231`; `TanyaJe.dc.html:109-111,704`. The opening line becomes "Hi! I'm {Name}'s page…" as drawn.
- [ ] **Step 4: Run** → PASS; gates + build; ask a product question in dev.
- [ ] **Step 5: Commit** `feat(chat): replies read as plain text, with a product card when they name one`.

### Task 12: Themed checkout and order page

**Files:** `apps/web/app/[handle]/shop/checkout/checkout.module.css`, `checkout.tsx`; `apps/web/app/[handle]/order/[token]/order.module.css`, `order-view.tsx` (+ tests).

- [ ] **Step 1: Tests.** `checkout's title sits on the page background and the form on a white sheet`; `the order page's number and status sit on the background`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** from `Public.dc.html:392-400`, `:573-610`, `:628-651`; text on the background uses the page's light/dark check.
- [ ] **Step 4: Run** → PASS; gates + build; load checkout and an order on a dark and a light page.
- [ ] **Step 5: Commit** `feat(public): checkout and the order page follow the page's colours`.

## Area 5: CHIP for shops

### Task 13: Connecting CHIP in Store, and paying online at checkout

**Files:**
- `packages/core/src/secret-box.ts` (+ test): `sealSecret(plain, key)` / `openSecret(sealed, key)`, AES-256-GCM, `base64(version | iv | tag | ciphertext)`, key from `PAYMENT_SECRETS_KEY` (32 bytes base64); the API refuses to start in production without it.
- Schema + migration: `ShopPaymentAccount { pageId @id, provider CHIP, brandId, secretKeyCiphertext, publicKeyPem, brandName, methods String[], connectedAt, checkedAt, lastErrorAt? }`; `Order.paidVia OrderPaidVia? (RECEIPT | MANUAL | CHIP)`, `Order.chipPurchaseId String? @unique`, `Order.payerEmail String?`, `Order.paidMethodLabel String?` (e.g. "FPX · Maybank2u"), `Order.paidRef String?`.
- `packages/billing`: `createPurchaseInput` accepts several products (order lines + delivery); `listPaymentMethods(amountCents)`.
- `apps/api/src/modules/store/chip.service.ts`, `chip.routes.ts` (+ tests): `POST /store/chip` (check with `GET /payment_methods/` and `GET /public_key/`, refuse a test key in production with "This is a test key", "That key or Brand ID didn't work."), `DELETE /store/chip`, `POST /store/chip/test` (an RM1 purchase on the owner's brand, card/e-wallet only, returns the checkout URL).
- `apps/api/src/modules/orders/pay-online.service.ts`, routes (+ tests): `POST /store/orders/:token/pay { method, bank?, email }` → a purchase on the owner's brand (lines, `reference` = order number, `client.email`, success callback `${API}/store/chip/callback/<orderId>`, redirects to `${WEB}/<handle>/order/<token>`, `due` +1 h `due_strict`), returns the `checkout_url` with the `preferred` params from the codes table; `POST /store/chip/callback/:orderId` verified with that shop's stored public key, then `GET /purchases/{id}/` with that shop's key, binding order number, total and `chipPurchaseId`, then PLACED → PAID (`paidVia CHIP`) conditionally.
- `packages/core/src/store.ts` `storeGaps`: a CHIP connection counts as a way to pay.
- Web: `apps/web/app/app/store/payment-tab.tsx` (+ tests) "Online payments" above DuitNow QR with the three states (`Store.dc.html:674-697`, logic `:936-939`); checkout "How you'll pay" (`Public.dc.html:600-604`, `:812-816`) with the email field (Global Constraint 2), banks and wallets (no Boost), button copy per choice, the QR-only variant; placed screen "Paid. Order placed" / "See your order" (`:612-626`, `:818-820`); order page Paid row "Paid RM… by {method} · {date} · Ref {ref}" with no QR (`:628-651`, `:644`, `:817`), plus "Checking your payment…" while the callback is pending on the return.
- Legal (`apps/web/app/_legal/content.ts`, EN + MS): Terms "Shops and orders" (customers may pay through the owner's own CHIP account; the owner gives Curios their CHIP keys, stored encrypted, used only to take payments for their shop), Privacy (CHIP processes shop payments; the customer's email for an online payment).
- `.env.example` (`PAYMENT_SECRETS_KEY`), `devDocs/OPERATIONS.md` (generating it), `design/DEVIATIONS.md` rows (Boost, the email field, Test with RM1 card/e-wallet only, the auto-renew deviation, the "Checking your payment…" state).

- [ ] **Step 1: Tests**, including Review Focus 1–3: `the secret key round-trips and a tampered box refuses to open`; `connecting checks the key and brand with CHIP and stores the key sealed`; `no API response ever contains the secret key`; `a test key is refused in production`; `disconnect deletes the account`; `checkout offers FPX, e-wallet, card and QR when connected, QR only when not`; `Boost is not offered`; `an online choice asks for an email`; `the pay URL carries preferred=fpx&fpx_bank_code=MB2U0227 for Maybank2u`; `a callback signed with Curios's key, another shop's key, or unsigned changes nothing`; `a verified callback marks the order paid once`; `the order page shows Paid after a callback even if the customer never came back`; `a CHIP failure when paying falls back to the QR with a message`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; gates + build; in dev with the owner's CHIP test keys: connect, pay an order by FPX test, see it Paid.
- [ ] **Step 5: Commit** `feat(store): owners connect CHIP, and customers pay straight from their bank`.

## Area 6: Orders, the paid email, Alerts

### Task 14: "Paid online" in Orders, the paid-order email, and the CHIP alert

**Files:** `apps/web/app/app/orders/order-detail.tsx`, `orders-screen.tsx` (+ tests); `packages/core/src/orders.ts` (`orderView` gains the online-paid state), `order-mail.ts` (`paidOrderMail`), `apps/api/src/modules/orders/place.service.ts` / the callback (send the paid email instead of the waiting one for an online-paid order); `apps/web/app/app/alerts.ts` ("CHIP disconnected: reconnect in Store" when `ShopPaymentAccount.lastErrorAt` is set); `design/DEVIATIONS.md`.

- [ ] **Step 1: Tests.** `an online-paid order's pill reads "Paid online"`; `its steps are Placed → Paid by FPX → Checked "By the bank" → Completed`; `its Payment card says the bank confirmed it through CHIP, with the reference`; `its only action is Mark completed` (cancelling a paid-online order keeps the hand "Mark refunded", as the board draws); `the paid email: subject "New order #14 · RM215 · Paid", tag "Paid by FPX", no receipt line, the CHIP payout note` (`Emails.dc.html:151-163`); `an online-paid order sends the paid email and not the waiting one`; `the CHIP alert shows when the key failed`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** from `Orders.dc.html:726,763,784,836,843` and `Emails.dc.html:151-163,238`. Alerts copy already matches the board (200 conversations, 3 free orders); only the CHIP alert is new.
- [ ] **Step 4: Run** → PASS; gates + build; load Orders with a paid-online order.
- [ ] **Step 5: Commit** `feat(orders): online-paid orders, and the email that says they are paid`.

---

## Not in this plan

- The email sender avatar (BIMI or the provider's profile photo): an ops task for the owner.
- Writing to CHIP about platforms storing merchants' keys: the owner, separately.
- Running `devDocs/manual-verification-billing.md` against CHIP test mode for plan billing.
