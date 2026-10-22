# CHIP payments: design

2026-10-22. Owner decisions are marked **(owner)**; everything else is a call made in
this document, marked **(call)**, and can be overruled before the plan is written.

The CHIP API reference is `devDocs/vendor/chip-collect.v1.yaml` (CHIP Collect OpenAPI,
`info.version: v1`, downloaded 2026-10-22). Trust it over CHIP's blog posts and its AI
skill, which disagree with it in places (`failure_callback`, a `failed` status, payloads
wrapped in `object`: none of those exist).

## Why

Two things, built as two separate parts, in this order:

1. **Plan billing.** Owners pay Curios for the Business plan through CHIP instead of
   Billplz **(owner)**, and can choose to have it renew automatically on their card
   **(owner)**. Billplz goes away entirely **(owner)**.
2. **Shops on CHIP.** An owner can connect their own CHIP account so their customers
   pay at checkout by FPX, card, DuitNow QR or e-wallet, and the order is marked paid
   by itself **(owner)**. Paying the owner's DuitNow QR or bank account and uploading
   a receipt stays, and stays the default **(owner)**: a CHIP account needs SSM
   registration and a business bank account, which many owners do not have.

Part 2 is built with an open question outside the code: CHIP's guidance says not to
share API keys with third parties, and Part 2 has owners paste theirs into Curios. The
owner will ask CHIP in writing; the code goes ahead first **(owner)**.

## Goals

- An owner pays for a month or a year by any method CHIP offers, and comes back to a
  Billing screen that says they are paid, exactly as Billplz does today.
- An owner paying by card can tick "Renew automatically", and is then charged on the day
  their paid time ends, every period, until they turn it off.
- A failed renewal never silently ends a plan: the owner is emailed, retried, and offered
  the pay-by-hand button.
- A connected shop's customer pays on CHIP's page and comes back to an order page that
  says "Paid"; the owner never checks a receipt for that order.
- Every claim in the product stays true: the landing, the Terms and Privacy pages,
  Billing, the plan emails.

## Non-goals

- No other gateway, and no provider abstraction beyond what CHIP needs: a `provider`
  column, not a plugin system **(call)**.
- No auto-renew by FPX or DuitNow: CHIP documents recurring for cards only.
- Curios never collects a shop's money and pays it out (CHIP Send is not used).
- No automatic payouts, split payments, or Curios fee on shop orders.
- No migration of anyone off a Billplz bill already paid: old Payment rows stay as they
  are, as history.

## Anti-goals

- Taking money without a clear, recorded opt-in. Auto-renew is off unless the owner
  ticked it on that payment; a renewal is never attempted without a saved card.
- Marking an order or a plan paid from anything but a verified CHIP signature followed by
  our own `GET /purchases/{id}/` with the right key. A redirect is never evidence.
- An owner's CHIP secret key readable anywhere but the one server function that calls
  CHIP for that shop: not in logs, not in an API response, not in a routinely selected
  row, never in the web app.

## Part 1: plan billing

### Money flow

1. Billing → Pay (Monthly RM49 / Yearly RM490), with a "Renew automatically by card"
   checkbox under the buttons, off by default **(call)**.
2. `POST /billing/purchases { plan, autoRenew }` → creates the `Payment` row first (as
   today), then a CHIP purchase on Curios's brand:
   - `client.email` = the account email, `client.full_name` = the page's displayName;
   - one product, the plan's name and `PLAN_PRICES_CENTS` price, `currency: "MYR"`;
   - `reference` = the Payment id;
   - `success_callback` = `${API}/billing/chip/callback`;
   - `success_redirect` / `failure_redirect` / `cancel_redirect` =
     `${API}/billing/chip/return?payment=<id>`;
   - `due` = now + 1 hour, `due_strict: true` **(call)**, so an abandoned purchase
     expires instead of being payable for ever;
   - `send_receipt: true` **(call)**: CHIP emails the owner a receipt.
   - With `autoRenew`: `force_recurring: true` and
     `payment_method_whitelist: ["visa", "mastercard", "maestro"]`. The checkout then
     offers cards only; the UI says so beside the checkbox.
   Returns `{ url: checkout_url }`; the web redirects.
3. CHIP calls `success_callback` (paid only). The API verifies `X-Signature` (RSA
   PKCS#1 v1.5 over SHA-256 of the **raw body**, Curios's public key from
   `GET /public_key/`, fetched once and cached; `CHIP_PUBLIC_KEY` in env may pin it),
   then fetches `GET /purchases/{id}/` and hands that to the grant.
4. The return URL fetches the purchase too and grants if paid, then redirects to
   `/app/billing?payment=paid|pending|failed`, as the Billplz return does today.
5. The hourly pending check fetches PENDING CHIP payments 2h–7d old, as it does Billplz
   bills.

### The grant

`grantPayment` stays the single writer of `Page.paidUntil`. Its evidence becomes
provider-neutral: `{ providerRef, paid, amountCents, reference }`. It looks the payment up
by `providerRef`, checks amount and reference (the Payment id), claims PENDING → PAID,
locks the page, extends. CHIP has no collection, so that check goes **(call)**; the
brand is bound by the key that fetched the purchase.

If the paid purchase has `is_recurring_token: true` and the payment asked for auto-renew,
the same transaction saves the renewal card on the page (below). A paid purchase without
the token flag saves nothing: the owner sees "Auto-renew couldn't be turned on" on Billing
**(call)**.

### Auto-renew

Stored on a new `RenewalCard` row, one per page **(call)**, kept out of `Page` the way
`PasswordCredential` is kept out of `Account`:

- `token` (the paid purchase's id, which CHIP uses as the recurring token);
- `plan` (what to renew: the plan of the payment that saved it);
- `cardLabel` (brand and last four, if the purchase carries them; otherwise null and the
  UI says "your card");
- `failedAttempts`, `lastFailedAt`.

A daily job at 10:00 KL (next to the renewal reminder) **(call)** renews every page with
a `RenewalCard` whose `paidUntil` is within the next 24 hours, or has passed by at most
3 days:

1. Create a PENDING `Payment` (`autoRenewal: true`) and a CHIP purchase for the card's
   plan, with no redirects and the same callback.
2. `POST /purchases/{new}/charge/ { recurring_token }`.
3. `paid` → grant now. `pending_charge` → wait for the callback or webhook.
   `invalid_recurring_token` (400) → delete the `RenewalCard` and email "auto-renew
   stopped". Any other failure, or a `purchase.payment_failure` webhook → count a
   failure.
4. One failure: email "we couldn't charge your card; we'll try again tomorrow; or pay
   now" with the Billing link. Three failures, or paidUntil 3 days past: delete the
   `RenewalCard`, email "auto-renew is off", and the plan lapses normally **(call)**.

A page is never charged twice for one period: the job claims the period by writing
`renewalAttemptFor = paidUntil` with a conditional update before charging, the same way
`renewalReminderFor` claims a reminder **(call)**.

Failures need CHIP's **webhook** (the purchase's `success_callback` fires on success
only). One webhook on Curios's brand, subscribed to `purchase.paid` and
`purchase.payment_failure`, at `${API}/billing/chip/webhook`, verified with that
webhook's own public key (`CHIP_WEBHOOK_PUBLIC_KEY`). It is registered by hand in CHIP's
portal; `devDocs/OPERATIONS.md` says how **(call)**.

Turning it off: Billing → "Turn off auto-renew" calls
`POST /purchases/{token}/delete_recurring_token/` and deletes the row. Turning it on later
means paying again with the box ticked **(call)**: there is no "save a card without
paying" step.

The renewal reminder 3 days before the end changes its words for a page with a card: "We'll
charge RM49 to your card on 25 November. Turn off auto-renew on Billing if you don't want
that." The plan-ended email is not sent while a renewal is still being retried.

### Schema

- `enum PaymentProvider { BILLPLZ CHIP }`. `Payment.provider` (default `CHIP` for new
  rows; existing rows migrated to `BILLPLZ`).
- `Payment.billplzBillId` → `providerRef String? @unique` (renamed, so old rows keep
  their bill id); `billplzCollectionId` becomes nullable and is no longer written.
- `Payment.autoRenew Boolean @default(false)` (asked for a card to be saved) and
  `Payment.autoRenewal Boolean @default(false)` (raised by the renewal job).
- `PaymentStatus` gains `FAILED` (a renewal charge that failed) and `EXPIRED` (the
  pending check found the purchase expired or cancelled) **(call)**.
- `RenewalCard` as above; `Page.renewalAttemptFor DateTime?`.
- The `Page.paidUntil` comment stops saying "there is no subscription".

### Removing Billplz

`packages/billing` keeps its name and becomes CHIP's: `createChipClient` (create, get,
charge, delete token, public key, refund), `verifyChipSignature`, the config (`CHIP_*`
env), the neutral grant. The Billplz client, signature, form parser, routes, env and error
codes are deleted. `billingDisabled()` keeps its meaning with the new env names.

Env: `CHIP_SECRET_KEY`, `CHIP_BRAND_ID`, `CHIP_BASE_URL`
(`https://gate.chip-in.asia/api/v1`), `CHIP_PUBLIC_KEY` (optional pin),
`CHIP_WEBHOOK_PUBLIC_KEY`, `CHIP_CALLBACK_BASE_URL` (the API's public origin, no port:
CHIP refuses one). `.env.example` gets each with a one-line comment.

Error codes: `CHIP_UNAVAILABLE` (502), `BILLING_NOT_CONFIGURED` (kept).

The Billing screen's receipt link: CHIP sends the receipt by email, so the payments list
shows date, plan, amount and "Paid by card / FPX" with no link **(call)**.

### Copy

Board copy wins where a board speaks; the Billing board names Billplz, so every Billplz
mention becomes CHIP and each departure gets a DEVIATIONS row:

- Billing: "FPX, card or e-wallet, through CHIP." "You'll go to CHIP to pay, then come
  straight back here." "Continue to CHIP." "Waiting for CHIP…". The "No auto-renew, so
  nothing is charged without you." line becomes "Renews only if you turn on auto-renew."
- The auto-renew checkbox: "Renew automatically by card" / "We'll charge your card when
  this period ends. Turn it off any time."
- Landing (`copy.ts`, both languages): "Business is paid by FPX online banking. No card
  and no automatic charge, so nothing renews without you." → "Pay by FPX, card or
  e-wallet. Nothing renews unless you turn on auto-renew by card." "Free. No card." stays
  (it is about the free page).
- Terms "Plans and payment": CHIP instead of Billplz; FPX, cards, e-wallets; auto-renew by
  card if chosen, charged when the paid time ends, cancel any time on Billing, and a
  failed charge is retried for 3 days. Refund Policy: a renewal charge counts as a
  "later payment" (not refunded) unless it was made after the owner turned auto-renew
  off. Privacy: CHIP replaces Billplz as a processor; card details go to CHIP, not us;
  CHIP keeps a card token for auto-renew. Both languages, and `UPDATED` moves.
- `plan-mail.ts`: the reminder's "We do not charge you automatically" sentence is only
  for pages without a card; new mails for a failed renewal and for auto-renew stopping.
- `README.md` and `devDocs/README.md`: the Billplz rows; `manual-verification-billing.md`
  rewritten for CHIP's test mode (cards 4444 3333 2222 1111 and 5555 5555 5555 4444).

## Part 2: shops on CHIP

### Connecting

Store → Payment tab gets a third section under the QR and the bank account: "Take FPX,
cards and e-wallets with CHIP". Two fields, Brand ID and Secret Key, a link to where CHIP
shows them, and Connect **(call)**.

`POST /store/chip { brandId, secretKey }`:

1. Calls `GET /payment_methods/?brand_id=…&currency=MYR&amount=1000` with the key. A 401
   or 403 → "That key or Brand ID didn't work." A key in test mode is refused in
   production **(call)** ("This is a test key").
2. Fetches `GET /public_key/` with the key and stores the PEM.
3. Stores the key encrypted (below), the brand id, the methods list (for the checkout
   label), `connectedAt`.

Shown once connected: "Connected to CHIP · Brand ending 1a2b" and Disconnect, which
deletes the row. The key is never sent back to the browser.

`storeGaps`: a CHIP connection counts as a way to pay. Removing the QR is allowed when CHIP
is connected.

### The secret key at rest

New `ShopPaymentAccount` table, one row per page **(call)**: `pageId @id`, `provider
(CHIP)`, `brandId`, `secretKeyCiphertext`, `publicKeyPem`, `methods String[]`,
`connectedAt`, `lastErrorAt`. It is never included in a page select; only
`packages/billing`'s shop functions read it.

Encryption: AES-256-GCM in a new `packages/core/src/secret-box.ts` (Node `crypto`),
`base64(version | iv | tag | ciphertext)`, key from `PAYMENT_SECRETS_KEY` (32 bytes,
base64) **(call)**. Missing key in production → the API refuses to start; in dev → Connect
says it is not configured. A version byte lets the key rotate later.

### Paying for an order

Checkout is unchanged up to "Place order" **(call)**: the order is placed first, so stock,
price checks and the order number work exactly as now.

The order page, for a shop with CHIP, while the order is `awaitingPayment`:

- First, "Pay online" with the methods ("FPX, card, DuitNow QR or e-wallet"), an
  **email field** ("For your receipt"), and Pay **(call)**. CHIP requires a client email
  on every purchase (`ClientDetails.required: [email]`), and checkout collects none.
- Below, "Or pay by QR or bank transfer" with today's QR, bank and receipt upload, when
  the owner has set them.

`POST /store/orders/:token/chip { email }` → a CHIP purchase on the **owner's** brand with
the owner's key:

- products = the order's lines (name, quantity, unit price) plus delivery as its own line;
  the total must equal `order.totalCents`, or the API refuses;
- `reference` = the order number; `client.email`, `client.full_name` = customerName,
  `client.phone`;
- `success_callback` = `${API}/store/chip/callback/<orderId>` (the order id, never the
  token, so the token stays out of CHIP's logs);
- redirects = `${WEB}/<handle>/order/<token>?paid=1` (and `?paid=0`): the token is in the
  URL the customer already holds;
- `due` = now + 1 hour, `due_strict: true`;
- `send_receipt: true`.

The order stores `chipPurchaseId` (latest) and the email. Pressing Pay again creates a new
purchase and cancels the old one with `POST /purchases/{id}/cancel/` **(call)**.

Callback: look the order up by id → its page's `ShopPaymentAccount` → verify the signature
with that account's stored public key → `GET /purchases/{id}/` with that account's key →
require `status: paid`, `reference` = the order number, `purchase.total` =
`order.totalCents`, and the id = `order.chipPurchaseId` → `PLACED → PAID` with
`paidAt`, `paidVia: CHIP` (a conditional update, so a repeat changes nothing). Clears a
pending receipt if one was uploaded. Emails the owner "Order #1042 is paid" under the
existing order email switch **(call)**.

The order page, on `?paid=1`, fetches the purchase itself if the callback has not landed
yet, and shows "Checking your payment…" until it has **(call)**.

### Owner side

- Orders: a CHIP-paid order shows "Paid online · CHIP" instead of a receipt, and no Mark
  paid or Not received.
- Cancelling a CHIP-paid order: "Refund through CHIP" calls `POST /purchases/{id}/refund/`
  with the owner's key, then sets `refundedAt` on success (or when the `payment.refunded`
  arrives, if CHIP answers `pending_refund`) **(call)**. "Mark refunded" by hand stays
  for receipt-paid orders.
- A connected shop's key failing (401 at payment time) → the order page hides "Pay
  online" and shows the QR route; the owner gets an alert "CHIP disconnected: reconnect in
  Store" **(call)**.

### Schema

- `ShopPaymentAccount` as above.
- `Order.paidVia enum OrderPaidVia { RECEIPT MANUAL CHIP }?`, `Order.chipPurchaseId
  String? @unique`, `Order.payerEmail String?` (deleted with the order by the 12-month
  sweep, which already deletes orders).

### Copy

- Shop copy, both languages: `payNote` "You pay {name} directly by DuitNow QR or bank
  transfer on the next step." becomes, for a CHIP shop, "You pay {name} online by FPX,
  card or e-wallet, or by QR, on the next step." New strings for the pay-online block.
- Payment tab: "Money goes straight to you. Curios never holds it." stays true (it settles
  to the owner's CHIP account).
- New-order email: "They pay you directly, by your QR or bank transfer." gets a CHIP
  variant.
- Terms "Shops and orders": customers may pay through the owner's own CHIP account; the
  owner gives Curios their CHIP keys, which we store encrypted and use only to take and
  refund payments for their shop; the owner is responsible for their CHIP account. Privacy:
  CHIP as a processor for shop payments; the customer's email for a CHIP payment. Both
  languages.

## Shared infrastructure

- **Raw body.** A Fastify plugin, encapsulated to the CHIP routes, adds a JSON parser with
  `parseAs: 'string'` that keeps the string on the request before `JSON.parse`, so the
  signature is checked against the exact bytes.
- **Signature.** `verifyChipSignature(rawBody, signatureBase64, publicKeyPem)` with
  `crypto.verify('sha256', …, RSA_PKCS1_PADDING)`, false on anything malformed.
- **Replies.** Callback and webhook answer 200 for every verified outcome (granted,
  already granted, unknown), 400 for a bad signature, and let unexpected errors become
  500 so CHIP retries (it retries up to 8 times over 36 hours, as the Billplz route
  assumes today).
- **Locks.** Every grant and every order transition is a conditional update, so the
  callback, webhook, redirect and pending check can all arrive in any order and any
  number of times.
- **Logging.** CHIP route logs carry the purchase id and outcome only; the order-page
  return URL with its token is masked like `/store/orders/<token>` already is.
- **Local dev.** CHIP refuses callback URLs with a port, so callbacks need a tunnel
  (`cloudflared` or similar) on 443; without one, the return redirect and the pending check
  still complete a test payment. `devDocs/OPERATIONS.md` says how.
- **Tests.** The CHIP client is tested against recorded responses shaped by the spec; the
  signature with a key pair generated in the test; the routes with Fastify `inject` and a
  fake client, as the Billplz tests do now.

## Left to the builder

- Module and file names inside `packages/billing` and `apps/api`.
- Whether the CHIP client is hand-written (recommended: about six calls) or generated from
  the spec.
- The exact UI layout of the auto-renew checkbox and the pay-online block, within the
  Billing and Public boards' style.
- Retry and timeout values for calls to CHIP (Billplz's are a fair start).
