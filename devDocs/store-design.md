# The Store — a business page's own little shop

**Goal:** let a business owner list what they sell on their Curios page and take orders for it,
without Curios ever holding the customer's money. A visitor taps **Visit shop**, fills a basket,
checks out, and pays the owner directly by DuitNow QR or bank transfer at a total that is final
the moment they see it. The owner checks the receipt, marks the order paid, and fulfils it.

Designed with the owner on 2026-10-13; every choice under "Decisions" is theirs. Ships as two
slices, each getting its own build spec: **slice 17, the shelf** and **slice 18, orders**.

---

## What is in, what is out

**In:**

1. **Items**: name, photo, short description, Available toggle, and either one price or one list
   of priced options (1kg RM95 · 2kg RM170).
2. **A shop tile** on the front page whenever the Store is on, opening **`/handle/shop`**.
3. **Shop settings**: pickup and/or delivery (flat fee, or rider paid by the customer), minimum
   days' notice, and the owner's payment details (QR image and/or bank account).
4. **Checkout and an order page** with the payment details and a receipt upload.
5. **An orders screen** for the owner: mark paid, completed, cancelled, refunded.
6. **The chat knows the shelf**: available items are knowledge, and an answer naming an item gets
   an *Order* chip.
7. **Three free orders**, then the page must be paid to keep taking orders.

**Out, and why:**

- **Taking payment through Curios** (FPX checkout, split payouts). Makes Curios a payment
  intermediary: merchant onboarding, payouts, refunds and disputes. The owner's own QR does the job
  (decision 1).
- **Stock counts and multi-group variants** (size × flavour, additive prices). Made-to-order shops
  don't count stock; the order note carries custom requests (decision 3).
- **Delivery zones.** Flat fee or rider-paid covers how small sellers already work (decision 5).
- **Ordering inside the chat.** The model would be handling quantities and totals (decision 6).
- **Customer accounts.** The order link is the customer's only handle on their order.
- **Personal pages.** The Store is business-only.

---

## Decisions the owner made

| # | Question | Decision |
|---|---|---|
| 1 | How does money move? | **Order request plus the owner's own payment details.** The page shows the owner's DuitNow QR or bank account; the customer uploads a receipt; the owner marks it paid. Curios never touches the money. |
| 2 | Gating | **Business pages only. The shelf is free on every business page; orders get their own free allowance**, separate from the three-lead trial. |
| 3 | What is an item? | **One price, or one list of options each with its own price**, plus an order note. No stock. |
| 4 | When does the customer pay? | **Immediately, at the basket total.** If the owner can't fulfil it, they cancel and refund by hand. |
| 5 | Delivery | **Pickup and/or delivery; delivery is a flat fee added to the total, or "rider paid separately"** and kept out of it. |
| 6 | Store and chat | **The shelf is knowledge, and the chat points to it.** Ordering always happens in the shop. |
| 7 | Architecture | **A Store module of its own**, shaped like leads — not orders bolted onto `Lead`, not items stored as `Fact`s. |
| 8 | Front page | **One "Visit shop" tile** by default, not the items on the front page. |

Defaults chosen in design and accepted with it: a minimum days' notice (default 1) rather than a
calendar; the one trial reset resets both the lead and the order counters; the Store can't be
switched on until there is a way to pay.

---

## Data

Money is always integer sen (`Int`, MYR), as `Payment.amountCents` already is.

### `Item`

| Field | Note |
|---|---|
| `pageId` | Cascade with the page. |
| `name`, `description?` | |
| `photoKey?` | Object key in storage, like `avatarKey`. |
| `priceCents?` | Set when the item has no options. |
| `available` | Off hides it from the shop and the chat; existing orders are untouched. |
| `position` | Owner's order. |

**`ItemOption`**: `itemId` (cascade), `label`, `priceCents`, `position`.

An item has **either** `priceCents` **or** at least one option, never both and never neither.
The rule lives in one function in `packages/core` and the API checks it on every write.

### `Page` gains the shop settings

| Field | Note |
|---|---|
| `storeEnabled` | Default false. Can only become true when a way to pay exists. |
| `pickupEnabled`, `pickupNote?` | "Seksyen 7, Shah Alam". |
| `deliveryMode` | `NONE` · `FLAT` · `RIDER`. |
| `deliveryFeeCents?` | Required when `FLAT`. |
| `minNoticeDays` | Default 1. |
| `paymentQrKey?`, `bankName?`, `bankAccountName?`, `bankAccountNumber?` | A way to pay is a QR, or all three bank fields. |
| `ordersPlaced` | Orders ever placed, never decremented — the same reason as `leadsCaptured`: deleting orders must not refund the trial. Also the source of order numbers. |
| `ordersAtTrialReset` | Default 0. The baseline the free allowance counts from after the one trial reset. |

At least one of pickup or delivery must be on for the Store to be on.

### `Order`

| Field | Note |
|---|---|
| `pageId` | Cascade, like `Lead`. |
| `number` | Per page, `ordersPlaced + 1` taken under the page row lock. `@@unique([pageId, number])`. |
| `tokenHash` | The order link's secret, stored only as a hash, as `Session` does. `@unique`. |
| `customerName`, `phone` | Phone in E.164 through `normalizeMalaysianPhone`. |
| `method` | `PICKUP` · `DELIVERY`. |
| `date` | A calendar date, at least `minNoticeDays` from today in Malaysia time. |
| `address?`, `note?` | Address required for delivery. |
| `itemsCents`, `deliveryCents`, `totalCents` | Fixed by the server at creation. |
| `receiptKey?`, `receiptUploadedAt?` | |
| `status` | `PLACED` · `PAID` · `COMPLETED` · `CANCELLED`. |
| `paidAt?`, `completedAt?`, `cancelledAt?`, `refundedAt?` | |
| `createdAt` | `@@index([pageId, createdAt])`. |

**`OrderLine`**: `orderId` (cascade), `itemId?` (`SetNull` on item delete), and a **copy** of
`itemName`, `optionLabel?`, `unitPriceCents`, plus `quantity`. A later price change or deletion
never rewrites a placed order.

### Order states

```
PLACED ──mark paid──▶ PAID ──mark completed──▶ COMPLETED
   │                    │
   └──cancel──▶ CANCELLED ◀──cancel──┘
```

- *Refund owed* is `CANCELLED` with `paidAt` set and `refundedAt` null; **Mark refunded** sets
  `refundedAt`. It is a derived state, not a fifth status.
- Every transition is a conditional update on the expected current status, so a double tap or two
  open tabs change nothing the second time.

### The order allowance

`FREE_ORDERS = 3` in `packages/core/src/plan.ts`, and `orderState()` beside `planState()`, built
the same way so the owner's wording and the enforcement can't drift: personal → none; paid →
unlimited; otherwise `trial` with `used`/`remaining` until `ordersPlaced − ordersAtTrialReset`
reaches three, then `trialSpent` or `lapsed`. `canTakeOrders()` is its enforcement answer.

The trial reset on `/app/billing` resets the order allowance along with the lead one, under the
existing once-only `trialResetAt` rule. It can't zero `ordersPlaced`, because order numbers come
from it and would repeat; it sets `ordersAtTrialReset = ordersPlaced` instead.

Retention: orders are kept 12 months, as leads are (PDPA), and deleted by the same mechanism.

---

## Flows

### Visitor

1. **Front page.** With the Store on, a **shop tile** joins the bento: first by default, sized
   automatically, movable and resizable in My Curios, not deletable — turning the Store off removes
   it. It shows the first available item's photo, "Visit shop", and the item count. It is a new
   tile kind in the bento arrangement, not a `Link` row, so it can't be edited into a broken URL.
2. **`/handle/shop`**, rendered on the server from `db-read`, in the page's own look (cover,
   accent, heading font, background), with a back arrow to the front page as chat mode has. A
   grid of available items; tapping one opens a sheet to choose an option and quantity and add to
   the **basket**. The basket lives in the browser only until checkout. `/handle/shop?item=<id>`
   opens with that item's sheet up.
3. **Checkout**: name, phone, pickup or delivery, date (picker starting at today +
   `minNoticeDays`), address if delivering, note, and the PDPA consent line the lead card uses. It
   shows the total, and "Rider fee paid separately" when delivery is `RIDER`. Submits
   `POST /store/:handle/orders` with item ids, option ids, quantities and the total the visitor
   saw.
4. **The order page**, `/handle/order/<token>`: order number, lines, total; the QR and/or bank
   details with copy buttons; a **receipt upload** (image or PDF, ≤ 5 MB); a "WhatsApp <shop>
   about order #12" button; and the order's status. Bookmarking it is the customer's whole
   account.

When orders aren't allowed (trial spent, or lapsed), the tile and shop stay and the basket's button
becomes **Order on WhatsApp**, with the basket written into the prefilled message.

### Owner

- **`/app/store`**: items (add, edit, reorder, Available, photo) and settings (pickup, delivery,
  notice, payment details, Store on/off). While no way to pay exists, the on switch says what's
  missing.
- **`/app/orders`**: newest first, filters *To check* (receipt uploaded, not paid), *Paid*,
  *Refund owed*. An order shows its lines, the receipt, the actions valid for its state, and a
  `wa.me` link to the customer. Free orders remaining show as they do on the leads screen.
- **Email**, through the existing `mail` queue: "New order #12 · RM190" on placement, "Receipt
  uploaded for #12" on upload.

### Chat

- Available items join the prompt as a compact **Shop** block (`Kek Batik — 1kg RM95 · 2kg
  RM170`), only while the Store is on. The model may quote these prices exactly as it quotes
  verified facts; the never-invent-a-price rule is unchanged.
- After an answer finishes, items named in it get an **Order <item>** chip, at most two, matched in
  code on normalised names — the model can't invent a button. Chips link to
  `/handle/shop?item=<id>`.
- On a turn that shows order chips, the lead capture card is not also offered.

---

## Error handling

| Case | Behaviour |
|---|---|
| Price changed since the visitor loaded the shop | The server recomputes; if its total differs from the one submitted, refuse with *prices changed* and return current prices for the basket to reload. Nobody pays a total they didn't see. |
| Item unavailable, deleted, or option not its own | Refused, naming the item. |
| Date inside the notice period; delivery while off; pickup while off; no address for delivery | Refused, per field. |
| Last free order taken by two visitors at once | The page row is locked while the allowance is checked and `ordersPlaced` incremented, as `grantPayment` locks it; exactly one succeeds, the other gets the WhatsApp fallback. |
| Receipt: wrong type, too big, unknown token | Refused. A second upload replaces the first until the order is `PAID`; then uploads are refused. |
| Owner acts on another page's order | 404, as every owner route already does. |
| Storage not configured | Photo and QR uploads say they're switched off, as avatars do; bank details still work. |
| Personal page | Every Store route refuses; the page never renders a shop. Switching to business makes it available. |
| Abuse | Per-IP and per-page rate limits on order placement and receipt upload, on the existing Redis limiter. |

---

## Testing

- **`packages/core`** (pure): `orderState()`/`canTakeOrders()`, totals (options × quantities, flat
  vs rider delivery), the notice-date check in Malaysia time, the item price-or-options rule.
- **API, on the test database**: placing an order — happy path, each refusal, the race on the last
  free order, the trial reset baseline; owner transitions and their conditional updates; ownership
  checks; token-only receipt upload; personal-page refusal; rate limits.
- **Web**: the shop tile on the front page; `/handle/shop` in English and Malay; the order page in
  each state; the WhatsApp fallback when orders aren't allowed.
- **Chat**: the Shop block present only with the Store on; chips matched from item names; the
  capture card withheld on a chip turn. Goldens: shop prices quoted exactly, never invented.

---

## Slices

**Slice 17 — the shelf.** `Item`, `ItemOption`, the shop settings on `Page` (delivery and payment
fields included, so the settings screen is whole), `/app/store`, the shop tile, `/handle/shop`,
the chat's Shop block. The basket's only button is **Order on WhatsApp**. Useful on its own.

**Slice 18 — orders.** `Order`, `OrderLine`, the allowance, checkout, the order page and receipts,
`/app/orders`, the emails, the order chips, the trial reset change.
