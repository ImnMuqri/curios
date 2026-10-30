# Vouchers and plan discount codes: design

Written 30 Oct 2026 from a conversation with the owner. Two features that share an idea, discounts,
but touch different money: **shop vouchers** take money off a customer's order with a shop, which
is paid to the shop owner; **plan codes** take money off an owner's Curios Business plan, which is
paid to Curios. They are built and shipped separately (part A, then part B), but read together.

Where this says *(builder's call)*, the owner did not decide it; it is the designer's recommendation
and can be changed without asking them again.

---

## Part A: Shop vouchers

### Why

Owners run promotions the way small Malaysian shops do on Instagram and WhatsApp: "Raya 10% off",
"RM5 off over RM50", "RM5 off with code INSTA5". Today there is no way to do any of that in a
Curios shop. The owner wants each voucher to be flexible (what it takes off, what it applies to) and,
for promotions everyone should get, to apply itself at checkout without the customer doing anything.

### What an owner can make

A **voucher** belongs to one shop. Vouchers are part of the shop (Business plan), like the shop
itself. Each has:

- **How customers get it:**
  - **Automatic:** applies by itself whenever the basket meets its requirement. It is public: the
    shop shows it as a promotion (it sells as well as discounts).
  - **Code:** applies only when the customer types its code at checkout. Secret; the owner shares it
    (Instagram, WhatsApp) and can tell where a sale came from.
- **What it takes off** (one of):
  - a **percentage** (1-100%),
  - a **fixed amount** (RM).
- **What it applies to:** **the whole order** (all items), or **one item** (all of that item's
  lines, whatever option).
- **Requirement:** an optional **minimum spend** (RM, on items, before discounts).
- **Limits:** an optional **end date**, an optional **cap on uses** ("first 50 orders"), and an
  **on/off switch**.
- **A code** for a Code voucher (owner types it; letters and digits, case doesn't matter). An
  Automatic voucher has a short **name** customers see ("Raya promo") instead *(builder's call: a
  name, not a code, so nothing secret-looking is shown publicly)*.

The owner sees, for each voucher, how many times it has been used.

### How it applies at checkout

The rules, all decided by the owner except where marked:

1. **The best Automatic voucher that fits is applied**, and the customer sees it ("Raya promo
   applied, −RM9.50"). "Fits" means: switched on, not past its end date, under its cap, the
   minimum spend is met, and for a one-item voucher, that item is in the basket.
2. **A customer can type a code.** If it fits and saves more than the Automatic one, it replaces it.
   If it saves less, the customer is told it was not applied because a better one already is
   *(builder's call on the wording)*.
3. **One discount per order.** Two vouchers never stack.
4. **Delivery is never discounted.** Vouchers come off items only; the delivery fee is charged as
   it is today. (A "free delivery" voucher was considered and dropped by the owner, 30 Oct 2026.)
5. **A total can't go below RM0.** A fixed amount larger than what it applies to takes that off and
   no more. With delivery, the total is then the delivery fee alone.
6. **A free order (RM0 total) is paid at once.** It goes straight to paid with nothing to pay
   (and a digital order is delivered right away), as any paid order is.

*(Builder's call)* "Best" means the larger saving in RM against this basket; a tie goes to the Code
voucher the customer typed (they meant it). A one-item fixed amount comes off that item's lines once
per order, not once per unit. A one-item percentage applies to that item's lines only.

### Where customers see it

- **Shop and item pages:** live Automatic vouchers show as promotions, e.g. a line on the shop
  ("10% off everything over RM50 · Raya promo") and on a one-item voucher's item page ("RM5 off this
  item"). *(Builder's call on exact placement and wording; it should read as the shop's own sign,
  in the existing style, not a banner ad.)*
- **Basket sheet and checkout:** the applied voucher as its own line with the saving, the new
  total, and a "Have a code?" field.
- **Order page, owner's Orders screen, owner and customer emails:** the voucher's name or code and
  what it took off, so everyone sees the same numbers. The total the customer pays (QR, bank
  transfer, online) is the discounted total.

### Where owners manage it

A new **Vouchers** tab in Store (beside Items, Payment, Pickup & delivery): the list of vouchers with
each one's kind, saving, state (on, off, ended, used up) and use count; adding and editing one; the
on/off switch; deleting one. The phone preview shows the shop as customers see it, promotions
included.

### Rules that keep the money right (constraints)

- **The server decides the discount.** The customer's browser shows the same numbers, computed by the
  same pure function in `@curios/core` (so they agree), but placing the order recomputes everything
  from the database: prices, delivery, vouchers, limits. The existing `seenTotalCents` check
  (place.service.ts) compares against the discounted total, so a voucher that ended or ran out
  between showing and placing comes back as "prices changed", as a price change does today.
- **Uses are counted when the order is placed,** inside the same locked transaction that numbers the
  order (`placeOrder`, which already locks the page row), so a cap of 50 can't be overrun by two
  customers at once. *(Builder's call)* An order cancelled before it was paid gives its use back.
- **The order keeps a snapshot:** which voucher, its code or name, and how much it took off, on the
  Order row. Editing or deleting a voucher later never changes an existing order.
- **Online payment (the owner's CHIP):** the purchase amount is the discounted total. CHIP's product
  lines must still add up to the total (`startOnlinePayment` checks this); how the discount is shown
  there (a reduced price per line, or one combined line) is the builder's call, as long as the sum
  holds and settling (`settleChipPurchase`, which checks the total) still matches.
- **A free order** has no payment step: no CHIP purchase, no QR, no receipt. It needs a way to be
  recorded as paid that is not CHIP, a receipt or the owner marking it (a new "paid by voucher"
  value alongside `OrderPaidVia`, *builder's call on the name*).
- **The free-order trial still counts a free order** like any other order (it is still an order the
  shop took).
- **A paused shop** sends baskets to WhatsApp today, with no order placed. Vouchers do not apply
  there *(builder's call: no order is placed, so nothing could hold the discount)*.

### Non-goals (part A)

- Free delivery, and any discount on the delivery fee.
- Stacking more than one discount, "buy one get one", bundles, gifts.
- Limits per customer ("once per person"): shop customers have no accounts.
- Vouchers on a shop that is not Business, or made by Curios for a shop.

---

## Part B: Plan discount codes (Curios admin)

### Why

The owner (Curios's) wants to market the Business plan with codes: "100% off your first month",
"50% off". They hand the codes out the marketing way; an owner types one in Billing before paying.

### What admin can make

A **plan code**, made in the admin app:

- a **code** (unique across Curios; letters and digits, case doesn't matter),
- a **percentage off**: from 1% to 90%, or exactly 100%. Nothing between: CHIP's payment methods
  have minimum amounts, and 95% off a RM49 month leaves too little for some, or all, of them to
  take (owner's choice, 30 Oct 2026). The API refuses 91-99% too, not only the form.
- **which plan(s)** it works for: monthly, yearly, or both,
- an optional **end date**, an optional **cap on uses**, and an **on/off switch**.

Admin sees each code's uses: how many, and which pages used it.

### How an owner uses one

- In **Billing**, before paying, the owner types the code and sees the new price for the plan they
  chose. Then they pay as usual.
- **Below 100%:** they pay the reduced price through CHIP, as today.
- **At 100%:** nothing is charged and no card is asked for. They get the time (one month for a
  monthly code, a year for yearly), and when it ends they are asked to pay like anyone else.
- **A code works once per owner** (per page), **on one payment.** If the owner turned on auto-renew
  with a discounted payment, only that first payment is discounted; renewals charge the full price.
- A code that does not fit (switched off, ended, used up, wrong plan, already used by this owner) is
  refused with a reason the owner can act on.

### Rules that keep the money right (constraints)

- **Prices stay where they are** (`settings.prices`); the discounted amount is worked out on the
  server when the purchase is created (`createPurchaseForOwner`) and stored on the Payment as its
  `amountCents`, so `grantPayment`'s existing amount check keeps holding. The Payment also records
  which code and how much it took off.
- **A 100% code makes no CHIP purchase.** It grants the time directly, the way admin's "grant a
  month" does (`grantMonth`: lock the page, `extendPaidUntil`, a PAID Payment of RM0), in one
  transaction, recorded so it is told apart from an admin grant *(builder's call on how: a provider
  value or a field)*. It never saves a card or turns on auto-renew.
- **Once per owner and the cap hold under a race.** Checked when the purchase is created and again
  when it is granted (the moment the time is given), so two tabs or a slow CHIP payment can't use a
  code twice. *(Builder's call)* A pending, unpaid purchase holds its use for the hour the CHIP
  purchase stays open (its `dueAt`); an expired one gives it back.
- **Auto-renewals** (`apps/workers` `renewPage`) are untouched: they always charge the price in
  force.
- **Admin actions are audited** (`writeAudit`), as every admin change is: creating, editing,
  switching off.

### Where admin manages it

A new **Plan codes** screen in the admin nav (beside Payments and Controls), following the existing
pattern: a server page reading through `@curios/db-read/admin`, client actions through `/admin/*`
API routes, a service that writes an audit row.

### Non-goals (part B)

- Codes that discount every renewal, or a set number of months.
- Fixed RM amounts off the plan (percentages only, as the owner said).
- Codes for anything but the Business plan.

---

## Anti-goals (both parts)

It would be a failure, even working, if:

- a customer is charged, or shown, a different total from the one the owner's records keep;
- a voucher or code can be used past its cap, its end date, or (plan codes) twice by one owner;
- changing or deleting a voucher rewrites an order already placed;
- a free order or a 100% plan code leaves anything half-done: an order stuck "waiting for payment",
  a CHIP purchase for RM0, a card saved with no payment.

## What already exists to build on

- Order pricing: `placeOrder` and `priceLines` (`apps/api/src/modules/orders/place.service.ts`),
  `orderTotals` (`packages/core/src/orders.ts`). Order money fields: `itemsCents`, `deliveryCents`,
  `totalCents`.
- Online order payment: `startOnlinePayment` and `settleChipPurchase`
  (`apps/api/src/modules/orders/pay-online.service.ts`).
- Checkout and basket: `checkout.tsx`, `basket.ts`, `basket-bar.tsx` (the basket sheet) in
  `apps/web/app/[handle]/shop/`.
- Plan payments: `createPurchaseForOwner` (`apps/api/src/modules/billing/billing.service.ts`),
  `grantPayment` (`packages/billing/src/grant.ts`), admin `grantMonth`
  (`apps/api/src/modules/admin/admin-pages.service.ts`).
- Admin screens: `apps/admin/app/(admin)/*`, nav in `shell.tsx`, audit in
  `apps/api/src/modules/admin/audit.ts`.
- Store tabs: `TABS` in `apps/web/app/app/store/store-editor.tsx`, `TAB_NAMES` in `store/page.tsx`.

## Left to the builder

Table and field names; the exact screens' layout within the existing design language; copy (in
English and Malay, as every shop string is); how CHIP's product lines show a discount; whether the
voucher function lives in `orders.ts` or its own core module; the order of tasks within each part.
