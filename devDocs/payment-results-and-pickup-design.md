# Payment result pages, 30-minute holds, and pickup places and times

Status: draft for the owner's review (2 Nov 2026).

## Why

1. **Payment results.** When an owner pays for their plan, all they see afterwards is a toast. When a
   customer's online payment fails, they see one red line. The design branch
   `design-digital-products` (commit `ea5f60d`, `design/HANDOFF.md` "Payment result pages") replaces
   both with full pages. Peek celebrates or looks puzzled, and every failed page gives a clear next step.
2. **Pickup.** Pickup is a switch plus one free-text note today, and the customer only picks a day.
   Owners want to say *where* (one or more places) and *when* (their own time windows, each with an
   optional limit), and have customers pick both at checkout.

## Owner's decisions (2 Nov 2026)

- **Holds:** unpaid holds shrink to **30 minutes**, as the design says.
- **Failure reason:** "The bank said: …" follows **CHIP's purchase status**, in plain words.
- **No receipt download.** The paid page says CHIP emails the receipt to the owner's inbox.
- **Pickup places:** a shop can have **several**. The customer picks one at checkout.
- **Pickup times:** the owner either keeps **Any time that day** (today's behaviour) or **sets their
  own times** (windows such as 10am–12pm).
- **Limit:** each time window can have an **optional** cap on orders. A full window can't be picked.
- **Pickup only.** Delivery still picks a day only.

## 1. Plan payment result pages (Billing)

- After CHIP, `GET /billing/chip/return` redirects to new pages instead of
  `/app/billing?payment=…`:
  - **`/app/billing/paid?payment=<id>`** when the purchase is paid;
  - **`/app/billing/failed?payment=<id>`** when it failed;
  - a pending result still goes to `/app/billing?payment=pending`, as today.
- Each page reads its own payment row: plan, months, amount, method and reference. The paid page
  also reads the new paid-until date. The failed page reads the current one and CHIP's status.
- **Layout:** follow the board exactly (`Billing.dc.html`, the `.pr` block).
  - **Page:** full page with a grey ground, the logo, and **Back to Billing**.
  - **Desktop:** an 880px split card.
  - **Phone:** the art stacks on top.
  - **Peek** reuses the existing mascot art; only his pose and eyes change.
  - **Animation:** stops under `prefers-reduced-motion`.
- **Paid copy:**
  - Kicker and title: "Payment received / Welcome to Business, {first name}."
  - The keep-answering line, ending "Nothing renews by itself." When auto-renew is on, it says
    "Renews by itself on {date}" instead.
  - Receipt box: plan, "Paid with" and "Reference".
  - **Go to dashboard**, then a small line: "CHIP emails your receipt to {owner email}."
- **Failed copy:**
  - "Not charged / That didn't go through."
  - A line from CHIP's status. If they have a plan, add "Your plan is still fine until {date}."
  - Receipt box: plan, "Tried with" and "What happened".
  - **Try again** and **Pick another bank** both go to `/app/billing` with the pay sheet open.
  - "Need help? Email us" is a `mailto:` to the support address. The help chat isn't built yet.
- **The paid toast** (`paid-toast.tsx`) goes, since the paid page replaces it.

## 2. Shop payment failed page

- This replaces the one-line `onlineFailed` notice on the order page. It shows when the customer
  comes back from CHIP and the order page's check says `failed`.
- **Layout:** the board's `payfail` route (`Public.dc.html`, `/* payment failed (2 Nov) */`).
  - A red ✕ in a soft circle, then "Payment didn't go through".
  - "Nothing was taken. {Shop} has saved your order for **30 minutes**."
  - Grey code tiles, the order lines and the total.
- **Pay {total} again** starts a new CHIP purchase for the same order with the same method, as the
  retry does today.
- **Pay another way:**
  - It puts the order's lines back in the basket and opens checkout.
  - The failed order is cancelled at once, so it doesn't hold anything while a new one is placed.
- **The footer** reads "Tried with {method}. The bank said: {reason}."
- **The success page** ("Paid. Order placed") stays as it is.

### What CHIP's status says (both pages)

| CHIP purchase status | "What happened" / "The bank said" |
|---|---|
| `cancelled` | Cancelled at bank / cancelled |
| `expired` | Took too long / it took too long |
| `error`, `failed`, `blocked` | Bank declined / declined |
| anything else not paid | Didn't finish / it didn't finish |

## 3. Unpaid holds: 30 minutes

- `HOLD_HOURS = 24` becomes a **30-minute** hold, and the housekeeping job runs often enough to keep
  it. It runs every 5 minutes; today it runs hourly.
- **What gets cancelled:** an unpaid order, with no receipt waiting and no CHIP purchase still
  payable, that holds something:
  - a code;
  - a class seat;
  - **a place in a capped pickup window** (new).

  Cancelling it gives those back. Orders that hold nothing, such as a cake by QR with no cap, are
  left alone, as today.
- **CHIP link:** its pay window (`PAY_WINDOW_MS`) also drops from 1 hour to **30 minutes**. A
  purchase the customer could still be paying then can't outlive the hold.

## 4. Pickup places and times

### Owner (Store → Pickup & delivery)

- **Places:** with pickup switched on, the single note becomes a list of **pickup places**. Each has:
  - a name ("Home, Seksyen 7");
  - an address;
  - an optional Google Maps link;
  - an optional note ("Ring the bell").

  Places can be added, edited, reordered and removed, with at least one while pickup is on.
- **Times:** each place has its own setting:
  - **Any time that day:** what pickup does today.
  - **Set times:** a list of windows, each a start, an end, and an optional **limit** ("up to 5
    orders"). Windows can't overlap. They apply on every open day: the existing closed days and
    notice days still decide which days.
- **Existing shops:** a shop with a pickup note gets one place, named "Pickup", with that note as
  its address, set to Any time.

### Customer (checkout)

- **Getting it → Pickup:**
  - Pick a **place**. With one place there's nothing to pick, and it's simply shown.
  - Then the **day**, using the same day pills as today.
  - Then, if that place has set times, a **time**: chips showing "10am–12pm".
- **Full windows:** a window already at its limit that day shows "Full" and can't be picked. The API
  checks again when the order is placed, so two customers can't take the last spot.
- **Shown everywhere an order says "Pickup · Sat 5 Dec":** it becomes "Pickup · Sat 5 Dec,
  10am–12pm · Home, Seksyen 7". That covers:
  - the order page;
  - the owner's Orders list and detail;
  - the order emails;
  - the chat order card;
  - the shop page's "next pickup".

### Data

- A new `PickupPlace` table belongs to the page. It holds name, address, map link, note, position,
  and `anyTime`.
- A new `PickupWindow` table belongs to the place. It holds start and end in minutes after midnight
  (Malaysia time) and an optional limit.
- **The order keeps a snapshot:** the place's name and address, and the window's start and end.
  Renaming or removing a place later doesn't change old orders. It also keeps the window id, used
  only to count the limit.
- `Page.pickupNote` stays until the migration has copied it, then it's no longer read.

## Not in this

- Delivery time slots.
- Different windows on different weekdays.
- A receipt download for plan payments.
- The help chat.
