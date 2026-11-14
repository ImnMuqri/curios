# Design handoff

This folder is the approved design for Curios. It covers the landing page, auth, onboarding, the
customer side, the account and system pages, owner emails, the dashboard stop states, and every
dashboard module.

Implement **one module at a time** and compare against the screenshots after each one. Where the build departs from a board, it is recorded in `DEVIATIONS.md`.

## Start here: the calm redesign (14 Nov 2026)

The whole product was redesigned in a calmer style, and **these four boards replace the older ones**. Build from them. Where this section and older notes below disagree, this section wins.

| New board | Replaces | Screens |
|---|---|---|
| `Landing2` | `Main`, `TanyaJe` | `Calm-Landing.*.jpg` |
| `Site` (sign in, sign up, check your email, verify, forgot, reset, bad link, 404, error, unavailable, report, terms) | `SignIn`, `SignUp`, `System` | `Calm-Site-<screen>.*.jpg` |
| `Dash` (every app page, plus help, account menu, notifications, plan banners, payment notice, phone menu, dark mode) | `MyCurios`, `Store`, `Orders`, `Questions`, `Leads`, `Review`, `Knowledge`, `Billing`, `Settings`, `Help`, `Alerts`, the 2 Nov payment result pages | `Calm-Dash-<page>[-dark].*.jpg` |
| `More` (onboarding, customer pages, all ten emails) | `Onboarding`, `Public`, `Emails` | `Calm-More-<screen>.*.jpg` |

`Admin` is unchanged. The old boards stay in `boards/` for reference only. On the canvas they sit lower down, titled "Old ·".

These four boards are plain HTML with the behaviour in vanilla JS inside `boot()`. They do not use `{{ }}`, `<sc-if>` or `<sc-for>`. The copy is in the markup. The bottom pill bars on `Site` and `More`, and the "Plan state" picker on `Dash`, are canvas-only switchers. **Do not build them.**

### Style rules

- **Look:** quiet and flat. Warm off-white page, white cards with a 1px line, black pill buttons, little colour. Colour only goes where it carries meaning (status tags, money, stops).
- **Font:** Inter on the landing, auth, onboarding and the app. Headings use weight 600 and -0.045em tracking (big titles), body text 400–500. This replaces IBM Plex Sans from "Rules that apply everywhere", and Bricolage on the landing. Mono is still used for codes and handles.
- **Highlight only words that mean something.** On auth, only "free" is highlighted. No decorative highlights.
- **Corners, one rule everywhere:**
  - Anything you click or type into is a full pill (999px): buttons, inputs, chips, tabs, menu items.
  - Containers are 16px: cards, panels, popovers, sheets, banners, tables.
  - Circles stay circles: avatars, icon buttons, badges.
  - Grouped fields share one box, like Name and Bio on My Curios.
- **Tokens (light):**

  | Token | Value | Use |
  |---|---|---|
  | `--bg` | `#fbfaf7` | page |
  | surface | `#ffffff` | cards, panels |
  | `--ink` | `#1d1d1b` | text, primary buttons |
  | `--mut` | `#6f6d68` | secondary text |
  | `--line` | `#ece9e3` | dividers, card lines |
  | `--soft` | `#f4f2ed` | hover, quiet fills |
  | input ring | `#e2ded6` | inset 1px on inputs and pills |
  | badge | `#b5294e` | counts on the bell, menu and dock |

  Status tags: `t-ok` green, `t-wait` amber, `t-new` blue, `t-grey`, `t-red`.
- **Dark mode** is switched from the account menu and remembered per device. It is built for the app (`Dash`), and the same mapping applies anywhere else later:

  | Light | Dark |
  |---|---|
  | page `#fbfaf7` | `#151514` |
  | surface `#ffffff` | `#1f1f1d` |
  | soft `#f4f2ed` | `#262624` |
  | line `#ece9e3` | `#2e2d2a` |
  | input ring `#e2ded6` | `#3a3936` |
  | ink `#1d1d1b` | `#f2f0ea` |
  | muted `#6f6d68` | `#a3a09a` |
  | primary button: ink bg, white text | `#f2f0ea` bg, `#151514` text |
  | pastel tag fills | the same hue, dark (for example green `#e6f3ec` → `#1f3928`) |

  The live preview of the owner's page, and the customer pages, keep the owner's own theme in dark mode.
- **Motion:** small and springy. Screens fade up 8px. Popovers scale from 0.98. Lists stagger in. Everything respects `prefers-reduced-motion`.
- **Peek** (the mascot) is alive everywhere he appears: his eyes follow the pointer, and every few seconds he does a small habit (blink, tilt, squish, hop, little wave). On auth he covers his eyes with his hands **only while a password is being typed**. Happy or sad Peek goes on result states.

### App frame (`Dash`)

- **Desktop:** a sidebar of pill links. The Kek Lina card at the top of the sidebar opens the **account menu**:
  - name and email
  - conversations used this month, and the plan with a Manage link to Billing
  - Settings, Help & support, Dark mode, Sign out
- **Top bar:** Help, and the bell with a count.
- **Notifications** open from the bell as a popover, or a bottom sheet on phone. They show "Waiting on you" (orders, questions, leads, facts) and "Heads up" (plan alerts). Each row opens its page. "Mark all as read" clears only the badge, and items stay until they are done. The empty state reads "Nothing needs you right now."
- **Phone (under 1100px):** the sidebar hides and a floating pill menu sits at the bottom.
  - Tabs: Page, Store, Orders, Questions, More. Only the active tab shows its label.
  - One spring drives the black pill and the tab widths, and the pill's leading edge moves faster than its trailing edge.
  - The icon shrinks a little on press.
  - More opens a sheet whose items stagger in.
  - The menu hides on scroll down and comes back on scroll up.
- **Help panel:** a 420px panel from the right, or a bottom sheet on phone.
  - It starts with a Peek greeting and common questions, then answers in chat.
  - Each answer shows its source in the guide with a button to that screen, "Did this help?", and "Still stuck? Email support".
  - The behaviour is the same as in the 12 Nov section below.
- **Plan banners:** one slot under the page title, 16px corners, with an icon or count badge, title, one line, one button and a ×. There are three tones: info (blue), warn (amber), stop (red).

  | Plan state | Banner | Page |
  |---|---|---|
  | 1 or 2 of 3 free leads used | info | Leads |
  | free leads used | warn | Leads |
  | near the chat limit | warn | Questions |
  | free orders used | stop | Orders |
  | plan ended | stop | Billing |

- **Payment result (owner pays Curios):** no result page and no modal. They come back to Billing and a black pill notice rises from the bottom.
  - **Paid:** "Paid RM49 · Business runs until 2 Jan 2027" with See receipt. The plan card shows the new date, and the new payment row comes in tinted green.
  - **Failed:** "Payment didn’t go through · Nothing was charged" with Try again.
  - It hides itself after 7 seconds.
  - This replaces the subscription half of "Payment result pages (2 Nov 2026)".
- **Billing usage boxes** take only the height they need. They do not stretch to match the plan card.

### Onboarding, customer pages, emails (`More`)

- **Onboarding:** 4 steps (claim your page, what is this page for, teach it, done reading), centred, in the landing-hero style with a step bar at the top.
- **Customer pages:** the page, Ask chat (with product cards and the "message you back" card), shop, product, checkout, paid, payment failed, and the FAQ page. They always use the owner's theme. Kek Lina's maroon is only the sample.
- **Emails:** one layout for all ten.
  - A white card on a warm background, the logo (or the shop name for emails to customers), a small kicker, the title, a status tag, a short paragraph, an item card or key-value rows, one black pill button, and a small footer.
  - Owner emails: new order, paid order, receipt to check, new lead, digital sale.
  - Customer emails: digital delivery, class reminder.
  - Account emails: confirm email, reset password, already have an account.

## What is in here

| Path | What it is |
|---|---|
| `boards/*.dc.html` | The design source, one file per board. **Reference, not production code** (see below). |
| `boards/canvas.json` | Board order and titles, as they sit on the design canvas. |
| `screens/<Board>[-state].desktop.jpg` | Each board and state at desktop width (1280, or 1440 for the app). |
| `screens/<Board>[-state].phone.jpg` | The same at 390px. |

### How to read a `.dc.html` board

Each board is a template for a small design-canvas runtime, not React. Read it like this:

- Markup is between `<x-dc>` and `</x-dc>`. `{{ a.b }}` is a value from `renderVals()`.
- `<sc-if value="{{ x }}">` is a conditional and `<sc-for list="{{ xs }}" as="x">` is a loop.
- `onClick="{{ fn }}"` and similar attributes are handlers returned from `renderVals()`.
- The `<script type="text/x-dc">` at the bottom holds `class Component extends DCLogic`, with
  `state` and `renderVals()`. This is where the sample data, the states, and the exact copy live.
- The CSS in `<helmet><style>` is the source of truth for spacing, radii, sizes, colours and
  breakpoints.
- Anything with `aria-label="Design preview…"` is a canvas-only switcher (the "Sample data / New
  account" toggle, the route pills, the state pills). **Do not build these.** They exist so the
  canvas can show several states of one screen.
- The boards don't run outside the canvas (they need its runtime). Use the screenshots to see them.

Rebuild every screen in `apps/web` with the existing stack: CSS modules, `packages/ui` tokens,
real data, and the existing i18n. Do not paste the board HTML or its global class names into the
app.

## Rules that apply everywhere

- **Fonts:** IBM Plex Sans for all app and auth UI, including numbers and stats. IBM Plex Mono for
  codes (order code, tokens, phone numbers in emails). Bricolage Grotesque only for the wordmark and
  the landing display headings. The customer-facing checkout and order pages use Inter. No other
  fonts on functional UI.
- **The visitor side always uses the owner's own page theme** (colours, fonts, layout). Kek Lina's
  burgundy and serif name in the boards are just the sample owner's theme. Build the themed parts
  from the page's real theme values.
- **Colours** follow `devDocs/DESIGN.md`:
  - `--ink` #191F2C, `--paper` #FAFBFC, `--biru` #2340C8 (and its pales #EAF0FF / #DFE8FD)
  - `--kuning` #F2A33C, for money and attention only
  - `--merah` #D8452F, for errors and stops only
  - The green used for WhatsApp and paid states is #1D6F5F, with #E8F3EF as its pale.
- **Responsive is required.** Every board was checked at 390, 820, 1024, 1150, 1280 and 1440 with
  no horizontal scroll. Dashboard layouts respond to the **content column width**, not the
  viewport, because the sidebar takes space; the boards use container queries for this.
- **Every list has an empty state.** Each dashboard board has a `-empty` screenshot showing the
  new account version.
- **Copy:** no em dashes. Keep the copy in the boards' `renderVals()` exactly unless it conflicts
  with copy already in the repo. In that case the repo wins and the conflict should be flagged.

## Boards to routes

| Board | Route or place in the code | Status |
|---|---|---|
| `Main` | `app/(landing)/page.tsx` (and `/ms`) | exists, restyle |
| `TanyaJe` | landing "Tanya je" section | exists, restyle |
| `SignIn`, `SignUp` | `/signin`, `/signup` | exists, restyle |
| `Onboarding` (4 steps) | `/app/onboarding` | exists, restyle |
| `Public` route `page` / `ask` | `/[handle]` (Links and Ask tabs) | exists, restyle |
| `Public` route `shop` / `item` | `/[handle]/shop`, `/[handle]/shop/[slug]` (see the 22 Oct update) | restyle / new |
| `Public` route `checkout` | checkout (slice 18, `devDocs/store-design.md`) | new |
| `Public` route `placed` | after placing an order: show the code, tell the visitor to keep it | new |
| `Public` route `order` | `/[handle]/order/<token>` | new |
| `Public` route `faq`, `faqq` | `/[handle]/faq`, `/[handle]/faq/[slug]` | exists, restyle |
| `System` | `/forgot`, `/reset`, `/verify`, `not-found.tsx`, `error.tsx`, plus the over-cap chat reply | mostly exists, restyle |
| `Emails` | owner emails sent by `apps/api` (currently plain text in `auth.service.ts`) | new HTML templates |
| `Alerts` | a banner slot in `app-frame.tsx`, with `leads/trial-notice.tsx` as the copy source | new component |
| `MyCurios` | `/app/curios` | exists, restyle |
| `Store` | `/app/store` | exists, restyle |
| `Orders` | `/app/orders` | new (slice 18) |
| `Questions`, `Leads`, `Review`, `Knowledge`, `Billing`, `Settings` | `/app/<name>` (Knowledge is "Facts & sources") | exists, restyle |

## Notes per area

**Customer side (`Public`)**
- A personal page is the same as a business page without the Shop tab, without checkout, and
  without the lead capture card.
- FAQ entry points:
  - a "People often ask" accordion on the Links tab, with "See all"
  - a "Browse N answered questions" button in Ask
  - a "Questions" link in the footer
- Checkout:
  - order list with steppers
  - "Getting it" radio rows (pickup or delivery)
  - available days as pills, respecting the notice period and closed days
  - name and a `+60` phone field
  - summary
  - a fixed "Place order · RM…" button
- Order page:
  - a progress line: Placed, Paid, Ready, Done
  - the pay box with the DuitNow QR, which has a download button on its corner
  - bank details with copy
  - receipt upload, or the sent state
  - the order lines and total
  - a WhatsApp button
- Chat order lookup: a visitor types their order code. The chat asks for the last 4 digits of
  their phone, then shows a status card (see the `ask` route in the board).

**Emails**
- Subjects come from `store-design.md`: "New order #12 · RM190" and "Receipt uploaded for #12".
- Auth emails keep the existing wording from `auth.service.ts` and gain an HTML layout with one
  button and a plain-link fallback.
- The New lead email delivers the landing promise "every lead emailed with their number and chat".
- Owner emails carry a footer line saying they can be switched off in Settings, under
  Notifications.

**Stop states (`Alerts`)**
- There are six states:
  - trial running
  - trial used up
  - Business lapsed
  - conversation cap near
  - cap reached
  - orders paused
- Banner tone:
  - blue (info) can be dismissed
  - amber (warn) stays
  - red (stop) stays and adds a dot on Billing in the sidebar
- Copy comes from `trial-notice.tsx` where it exists.
- The cap numbers come from `conversationCap()`. Don't hard-code 200, and use the "near" state at
  about 80%.
- When orders aren't allowed, the basket button becomes "Order on WhatsApp", with the basket
  written into the prefilled message (see `store-design.md`).
- The "What a visitor sees" phone and "Where else it shows" list on this board explain each state.
  They are not UI to build.

## Update, 22 Oct 2026: shopfront, AI replies, CHIP

Iman approved these on the canvas. They replace what the boards showed before, so check the
rows in `DEVIATIONS.md` that touch the Shop tab, the item sheet, the preview's tabs and Billplz.

**The shop gets its own page (`Public`)**
- The public page's tabs are **Links and Ask** only, on business pages too. The Shop tab is gone.
- The shop's way in is the **first link** on the Links tab. It's the same pill as other links, in
  the accent colour, with three overlapping product photos and "Shop · N items · next pickup …".
- The shop is its own page at `/[handle]/shop`:
  - top bar: back, the shop's address, share
  - an "Open for orders" sign, the name in the owner's font, the area, pickup or delivery, and the
    next pickup day
  - the owner's note as a chat bubble from them, with their initial, name and date
  - sticky category chips with counts
  - two-column cards with square photos and tags ("Best seller", "Pre-order", "Raya")
  - a + on each photo that turns into the count
  - "Want something not listed? Ask a question" at the end
- A product has its own page at `/[handle]/shop/[slug]`, so owners can share one product:
  - a 4:3 photo
  - tag, name, price, description
  - size choice cards that change the price
  - notice needed, halal line
  - "Ask about this"
  - a bottom bar with − / + and "Add to basket · RM…"

  This replaces the item bottom sheet.
- The basket bar ("N items · RM… · Checkout") shows on the Links tab, the shop and the product
  page whenever the basket has something in it.
- Screens: `Public-page`, `Public-shop`, `Public-product`, `Public-ask`.

**AI replies are not chat bubbles (`Public`, `Main`, `TanyaJe`)**
- The visitor's message is a soft see-through bubble on the right (rgba(250,251,252,.14) on the
  page colour).
- The page's reply has **no bubble**. A small label sits on top: a dot in the accent colour and
  "{Name}'s page". The answer runs full width as plain text, 15px, line-height 1.6.
- When an answer is about a product, a product card follows it, with photo, name, price and "Add
  to basket". It changes to "In your basket" once added, and tapping the photo opens the product
  page. See `Public-ask`.
- On light backgrounds (the landing's floating chat) the reply is a white card with the same label.

**Payments: CHIP Collect plus the owner's own QR**
- Billplz is replaced by **CHIP** everywhere, for both of these:
  - owners paying for Business (`Billing`, landing FAQ and pricing): FPX, e-wallet or card,
    through CHIP, with nothing saved and nothing charged automatically
  - customers paying for orders
- **Store → Payment** has a new "Online payments" section above DuitNow QR, with three states:
  - not connected
  - connecting: the fields are **Brand ID** and **Secret key**, from the CHIP dashboard under
    Developers; check against CHIP before building
  - connected: "Test with RM1" and "Disconnect"

  The money goes to the owner's own CHIP account. Curios never holds it.
- **Checkout** gets a "How you'll pay" section.
  - **With CHIP connected,** four choices:
    - Online banking (FPX), E-wallet, Card: confirmed automatically. **CHIP's own payment page is
      never shown.**
      - Picking Online banking shows "Your bank" (Maybank2u, CIMB Clicks, Public Bank, RHB Now,
        Bank Islam, Hong Leong) right in our checkout.
      - Picking E-wallet shows "Your e-wallet" (Touch 'n Go, GrabPay, Boost, ShopeePay).
      - The button reads "Pay RM215 with Maybank2u" (or the chosen wallet, or "by card").
      - It sends the customer straight to the bank or wallet using the purchase's `checkout_url`
        plus `?preferred=fpx&fpx_bank_code=…` (e.g. `MB2U0227`), or
        `?preferred=razer_tng&razer_bank_code=TNG-EWALLET` and the like.
      - Card uses CHIP's card page, or `direct_post_url`. Check the PCI implications before posting
        card fields from our own form.
      - See CHIP's "Direct Post & Skip Payment Page" doc for the exact codes.
    - DuitNow QR: the owner's **own** QR with a receipt upload, exactly as before. The button reads
      "Place order · RM…". Do not use CHIP's DuitNow here; there must be one QR option, not two.
  - **Without CHIP,** only the owner's QR option shows. Screen: `Public-checkout-qr-only`.
- **After paying online:**
  - the placed screen reads "Paid. Order placed" and "See your order"
  - the order page goes straight to Paid, with a "Paid RM… by FPX · Maybank2u · Ref …" row and
    no QR or upload (`Public-placed`, `Public-order`; the QR version is `Public-order-qr`)
- **Orders:**
  - an online-paid order has the pill "Paid online"
  - its steps are Placed → Paid by FPX → Checked "By the bank" → Completed
  - its Payment card says the bank confirmed it through CHIP, with the reference
  - the only action is "Mark completed" (`Orders-paid-online`)
- **Emails:** a new "New order #14 · RM215 · Paid" email with a "Paid by FPX" tag, no receipt
  to check, and a note that CHIP pays out to the owner's bank (`Emails-paid`).

**The sample owner's look**
- Kek Lina's heading font is now **Outfit**, not Fraunces, on every board. It's her choice in My
  Curios → Heading font, and Fraunces stays in that list as an option.
- Everything a visitor sees follows the owner's background and accent: the page, shop, product,
  checkout and order page.
- Checkout and the order page put the title on the page background, with the form on a white
  sheet with rounded top corners, so forms stay easy to read.

**Elsewhere**
- **Landing, For business:**
  - The customer phone now **starts on Kek Lina's link in bio** (Links tab). The cursor taps
    the Shop link (the first link), the page slides away, and the shop opens. The first step
    runs 5.8s instead of 3.8s to fit this.
  - the customer phone shows the new shop page (two-column cards, + on photos)
  - checkout: "How you'll pay" with FPX picked, then Maybank2u picked under "Your bank", then "Pay
    RM235 with Maybank2u", "Opening Maybank2u…", "Approved in Maybank2u"
  - it never shows a CHIP screen, only "Payment processed by CHIP" in small type
  - the owner's phone mirrors the real Orders screen: "Receipts to check" and "Paid this week"
    figures, the All / To check / Paid / Refunds filter, and rows with status pills
  - the new order #14 arrives as "Paid online", with the green "Paid by FPX. Ready on Sat 17 Oct"
    box and "Mark completed", which changes to "Completed"
  - each step runs on its own timer (about 20s for the loop), with a progress line under the
    active step
  - steps are clickable to jump to them, and hovering the phones pauses
- **Store preview phone:** shows the new shop page, with the shop description as the owner's
  note bubble.

## Update, 22 Oct 2026 (evening): logo, favicon and the mascot

**Wordmark**
- "curios" stays in Bricolage Grotesque 700.
- The **o** is replaced by a brand-blue ring with two eyes (see `design/brand/logo-eyes.png`,
  option 4).
- The eyes slowly look left, right and up, and blink now and then, about every 10s.
- On hover they turn into happy ^^ arcs.
- Reduced motion turns the movement off.
- Every board's `.mark` now uses this. The markup is
  `curi<span class="mo"><svg viewBox="0 0 40 40">…</svg></span>s`, with `.mo-r` (ring),
  `.mo-e` (eyes) and `.mo-h` (happy).

**Favicon and app icon**
- **Updated 24 Oct 2026:** Peek's eyes. Two big white oval eyes with dark pupils (looking a
  little down and right) on a brand blue (#2340c8) rounded square. Replaces the older
  "peeking up" white head, so it matches the new Peek.
- Files are in `design/brand/`:
  - `icon.svg` → `apps/web/app/icon.svg`
  - `apple-icon.png` (180, full bleed) → `apps/web/app/apple-icon.png` (or keep the
    `apple-icon.tsx` and draw the same shape)
  - `favicon.ico` (16/32/48)
  - `icon-512.png`
- The email sender avatar and the landing's notification badge use it too.

**Peek, the mascot** (`design/brand/peek-mascot.png`)
- Brand blue, living **behind an edge** with two small hands holding
  it.
- Build it as two layers: the body (`.pk`, z 0) behind the field, and the hands (`.pk-front`,
  z 3) in front. The edge sits at 64 of 96 in the viewBox.
- The peeking form uses the same flat style as the full body: the top of the round ball, a
  darker crescent (#1b33aa) on the right (no highlight here), big oval eyes,
  and two round hands (#3150dc with a thin #1b33aa outline) resting on the edge. Copy the
  SVG from the boards.
- It slides up once on load. Reduced motion turns this and the eye movement off.
- It appears only on Curios's own pages, never on owners' public pages.
- **Sign in and sign up:** it peeks over the email field.
  - It looks down at the field while you type your email.
  - It **covers its eyes while the password field is focused**.
  - Done in CSS with `form:has(...)`.
- **Landing (Tanya je):**
  - peeking over the hero "curios.my/" claim field
  - peeking over the closing claim field on the dark section
  - it smiles (^^) while the visitor types a handle
- **Landing (as built):** the same, over both claim fields.
- **Sign in and sign up, right panel:** the old sky and phone scene is replaced by one calm
  scene with the full-body Peek on a flat tinted panel, with a short caption under it.
  - Sign in (#eef1fb): Peek reads a phone, tapping, while three small cards pop in above it:
    two questions marked "Answered" and one marked "Number saved". Caption: "While you were
    away / Your page answered 12 questions and saved 2 numbers." Use the owner's real counts.
  - Sign up (#fdf3e3): Peek holds up a sign with the handle being saved
    (curios.my/aisyahdraws) and a green tick pops on. Caption: "We're holding your name".
    Without a handle, show "curios.my/yourname" with no tick.
  - The panel still hides below 980px. Reduced motion stops all of it.
- **Onboarding, right panel:** the phone preview is replaced by Peek, one pose per step, on the
  same #eef1fb panel with a caption (see `design/screens/Onboarding_panel_states.png`):
  - Claim: holds up a sign with the live handle, green tick when it's free ("It's yours").
  - What is it for: Business holds a shopping bag; Personal waves.
  - Teach it: reads a sheet of paper. While reading, a blue scan line moves down the paper.
  - Found facts: happy eyes, both hands cheering, the first 3 facts pop in above it.
  - Nothing found: flat mouth, eyes to the side, hands down.
- **Full body, landing footer:** Peek stands on top of the o in the giant "curios" footer
  wordmark (`.pkf`). Its full-body form is:
  - a **round, slightly wide ball** in flat brand blue
  - one flat darker crescent (#1b33aa) on the bottom right for volume, and a small light
    highlight on the top left (no gradients)
  - **floating** round hands and small feet tucked under the body
  - big oval eyes and a tiny smile

  The right hand waves every couple of seconds, the other limbs bob gently, and it blinks and
  looks around. Size and position are in em, so it scales with the 31vw wordmark.
- The giant footer wordmark uses the same eyes o, in the dark ghost colour (#2a3248).

## Update, 23 Oct 2026: less template, fixed stale copy

A pass to make the product look less AI-generated. Follow these over anything older above.

- **No tinted icon squares** in front of rows or section titles (Settings rows, Store and My
  Curios section titles, Alerts "Where else it shows", Leads list and "What they're after").
  Text only.
- **Stats are one plain line**, not cards: Orders, Questions and Leads show three numbers in a
  row split by thin dividers, with no icon tiles and no sparklines.
- **No gradient blobs or grain** anywhere: landing hero, landing closing section, Store and My
  Curios preview panels, Review, system pages. Flat background colours only.
- **Landing:** no "01/02/03" watermark numbers, no curved "tanya je · just ask" marquee, no
  blur-in or scroll-reveal on headings, no blur on the rotating words. Section labels are plain
  sentence case in Inter 15px semibold (not mono uppercase). The hero has no label above the
  headline.
- **AI replies are plain text everywhere**, with a small "Kek Lina's page" label above, never a
  bubble. This now includes the app previews: Alerts, Leads conversation, Questions, Review,
  Facts & sources tester and My Curios. The customer's question can stay a bubble.
- **No Shop tab** in any preview. The shop is the first link (a Shop card with photo thumbnails).
  In My Curios the toggle is now "Shop link · Shown first in your links".
- Copy fixes: the conversation limit is **200** (Billing said 2,000). The landing's Business card
  says "A shop paid by FPX, e-wallet, card or your own QR". Store's checklist shows "Online
  payments through CHIP" when CHIP is connected.

## Admin (Curios team only), 23 Oct 2026

Board: `design/boards/Admin.dc.html`. Screens: `design/screens/Admin_*`. Not built yet; this is the
design to build from. Desktop first, works on a phone for emergencies.

**Access and safety**
- Separate route group, e.g. `/admin`, behind an allowlist of admin accounts (start with Iman).
  Not visible to owners at all; 404 for anyone else.
- Dark sidebar and a permanent amber "Production" strip so it never looks like the owner app.
- Every action that changes something asks for a **reason** and writes an **audit log** row
  (who, what, page, reason, when). Deleting an account also needs the handle typed out.
- "See it as the owner" opens their dashboard **read-only** and is logged.

**Sections**
- **Overview:** live pages, paying Business, revenue, conversations, answered-from-facts rate,
  AI cost (with cost per conversation), a conversations-per-day chart, "Needs you" (reports,
  failed webhooks, failed reads, pages at the cap, plans ending), new pages, Personal vs Business.
- **Pages:** search by handle, name or owner email; filters All, Business, Personal, Lapsed,
  Hidden or suspended. Side panel: owner, sign-in method, plan, paid until, usage against 200,
  facts. Actions: open page, see as owner, give one month of Business (no charge, not revenue),
  reset this month's conversations, suspend or bring back, delete account.
- **AI & usage:** from `ModelCall`: calls, typical and slow answer time, cost per conversation,
  "I'm not sure" rate, failed calls; cost by job; recent "I'm not sure" answers; pages near 200.
- **Reading sources:** from `Ingestion`: waiting, reading, failed, typical time; table with error
  text; Retry, Retry all failed (walled sources are skipped), Pause the queue.
- **Payments:** Business payments through Curios's own CHIP account, webhook log with Replay,
  and a count of shop orders paid online (owners' money, shown for scale only).
- **Reports:** visitors report a page from a "Report this page" footer link. Dismiss, Email
  owner, Suspend page. 3 reports in a day hides the page from search automatically.
- **Controls:** kill switches (chat answers, sign-ups, reading sources, CHIP payments, owner
  emails), limits and prices (cap 200, free leads 3, free orders 3, RM49, RM490) saved with a
  confirm, and a banner shown on every owner's dashboard.
- **Audit log:** newest first.

**New data this needs** (suggested): `Account.isAdmin` or an `AdminUser` table, `Page.suspendedAt`
and `Page.suspendReason`, a `Report` table, an `AdminAction` audit table, a `SystemSetting`
key-value table for the switches, limits, prices and banner, and a webhook event log.
`Payment` still names Billplz columns; those move to CHIP as already noted.

## Digital products, 24 Oct 2026

Boards: `Store`, `Public`, `Emails`, `Orders`. Screens: `design/screens/Digital_*`.
Sample items in Kek Lina's shop: a recipe e-book (files), a video course (link), a RM50 gift
voucher (codes) and an online Kek batik class (session).

**Store editor**
- New "What it is" switch: **Physical** or **Digital**, above Price. Price and options work the
  same for both.
- Digital asks "How they get it", one of four:
  - **Files:** upload up to 5 files, 200 MB each (PDF, images, ZIP, audio, video). Each buyer
    gets their own download links: 5 downloads per file, valid 30 days, resendable.
  - **A link:** the URL plus an optional note (200 characters). Only shown after payment.
  - **Codes:** paste codes, one per line. Each buyer gets one unused code. Shows how many are
    left; at 0 the item shows Sold out.
  - **A session:** one or more times (date, time, seats), how long, and Online (meeting link)
    or In person (place). Buyers pick a time; a full time can't be picked. Reminder email the
    day before.
- The shop list line reads "Digital · RM25". Store preview shows a "Digital" tag.

**Shop and checkout**
- Digital items get a "Digital" tag on the card and item page, and their own category.
- Item page: instead of "Needs 2 days, earliest pickup", it says how it arrives and the format.
  Sessions show "Pick a time" with seats left; full times are disabled.
- Checkout with **only digital items** skips Getting it (pickup or delivery) and Day entirely,
  shows "By email, right after you pay", and has no delivery fee.
- **Mixed baskets** keep Getting it and Day for the physical items, with a line saying the
  digital ones come by email.
- Any digital item adds a required **Email** field ("where we send your files").
- Summary shows "Digital items · By email".

**Delivery rules**
- Delivered only once paid. CHIP payments: straight away. DuitNow QR: the moment the owner
  marks it paid (their button reads "Mark paid and send").
- Order page: before payment, a locked note ("unlock once you've paid"). After payment, a
  "Your downloads and access" section: Download buttons per file, the course link with the
  owner's note, the code with Copy, and session time with Join and Add to calendar.
- Digital-only orders have a 3-step timeline: Placed, Paid, Sent. Status reads "Sent".
- Placed screen after an online payment: "Paid. It's on its way to your email", and the
  button goes to the downloads.

**Emails**
- New, to the customer, from "Kek Lina via Curios": everything they bought, with download
  buttons, link, code and session, plus "Open your order page".
- New, to the customer: class reminder the day before, with the join link and any files.
- New, to the owner: "New order #15 · RM214 · Paid and sent", nothing to do.

**Owner's Orders**
- Rows say "Digital" instead of pickup or delivery. Status "Sent" once delivered.
- A "Sent by email" card replaces "Getting it to them": who it went to, and per item what
  happened (downloads used, seat booked, code given, link opened), with actions New links,
  Move time, New code, and Resend the email.

**Previews in the dashboard must match the real pages** (fixed 24 Oct, see
`design/screens/Previews_matched.png`). Build them from the same components as the customer
pages, scaled down, rather than separate mock-ups:
- Store "Item" preview is the real item page: photo on top, tag, name, price of the first size,
  Size boxes (or Pick a time), the facts box, Ask about this, and the add bar.
- Store "Pay" preview is the real order page: order code, timeline, Pay with QR and bank,
  Upload your receipt, Your order.
- Store "Shop" preview has the real facts list and the category chips.
- My Curios links preview ends with People often ask, not an ask bar (the ask bar is only on
  the Ask tab).
- Chat previews everywhere: the visitor's question is a translucent bubble, the answer is plain
  text under a "Kek Lina's page" label with the accent dot, and the lead card is "Lina can
  answer this one" with a number field and Send.

**Data this needs** (suggested): `Item.kind` (PHYSICAL or DIGITAL) and `Item.delivery`
(FILES, LINK, CODES, SESSION); `ItemFile` (storage key, name, size); `Item.accessUrl` and
`Item.accessNote`; `ItemCode` (code, orderLineId when given); `ItemSession` (startsAt,
seats, durationMin, where, meetingUrl or place) and a booking per order line; `Order.email`;
a `DownloadGrant` per order line and file (token, uses left, expiresAt); `Order.sentAt`.

## Shop cover, 27 Oct 2026

The shop front (curios.my/handle/shop) now wears the owner's cover photo, **blurred** (about
22px, scaled up 1.3 so the edges don't show) and darkened, fading into the page background over
about 340px. The header, "Open for orders", name, facts and owner's note sit on top of it. The
category bar starts after the fade. Item, checkout, pay and order pages stay plain. The Store
"Shop" preview and the landing's For business phone show the same.

## Open decisions (all three settled; kept for the record)

1. ~~**Price.** The code has RM39 a month (`PLAN_PRICES_CENTS` 3900 / 39000). The landing and Billing
   designs say RM49 / RM490.~~ Settled 2026-10-16: RM49 a month, RM490 a year (`PLAN_PRICES_CENTS` is 4900 / 49000).
2. ~~**New emails not yet in any spec:**~~ Settled 2026-10-16: all four are built in `packages/core/src/plan-mail.ts`.
   - "Your page stopped taking numbers" (trial used up)
   - "Your page reached its monthly limit"
   - plan ending reminders: 3 days before, and on the day
3. ~~**Lapsed plan wording.** The design says a lapse also stops orders. This matches
   `canTakeOrders()`, but confirm the banner copy.~~ Settled 2026-10-16: the lapsed wording is `planEndedSaid` in `packages/core/src/plan-mail.ts`.

## Landing: "What lands in your hands", 27 Oct 2026

A new landing section that shows owners **what they get**, not the features. It goes between
How it works and For business (`How.tsx` → new `WhatLands.tsx` → `Business.tsx`).

**Reference:** open `design/prototypes/what-lands.html` in a browser. It is the approved
design, animation and timing, with both personas and the switch working. Stills:
`design/screens/WhatLands-1-inbox`, `-2-replying`, `-3-leads`, `-4-orders` (desktop) and
`WhatLands.phone.jpg`. Peek at the laptop is `design/brand/peek-laptop.svg`.

**Layout.** Heading "What lands in your hands." and a lede on the left, a two-way switch on
the right: "I offer a service" (Hafiz, property agent) / "I sell products" (Kek Lina). Under it
a bento grid, 3 columns (1.15fr 1fr 1fr), rows 400px and 236px, 16px gap, 26px radius:
1. **Big tile** (left, both rows): the before and after story, below.
2. **Suggestions** (top middle): a chat on the owner's page. The visitor asks, the page types,
   two suggestions slide in, one gets tapped ("✓ Asked" / "✓ Added").
3. **Alerts** (top right): a Curios notification drops in, then a hotter one lands on top and
   pushes the first back.
4. **What buyers keep asking** (bottom, two columns wide): bars grow and counts tick up, then
   the orange row gets a tag ("Demand you're missing" / "Not on your menu yet").
Under 900px everything is one column; the big tile keeps a fixed 640px height.

**Big tile, one loop (~12s).** The words are honest about where chats happen: the "before" is
the owner's own inbox today, and the "after" is chats on their Curios page.
1. *Your inbox today* (light grey tile, red dot tag "Your inbox · 47 unread"): 8 unanswered
   chats pop in one by one, phone number, last message, time and unread count in green. The
   counts keep ticking up. Caption: "Your inbox today / 47 unread, mostly "hi". A real buyer is
   buried in there."
2. *Now your page replies* (tile turns light blue #e9eef8, tag "With Curios · your page
   replies"): each row flips (rotateX) into a chat on the page: the question in quotes,
   "Visitor from Instagram/TikTok/Facebook", no phone number. Peek with the laptop pops up in
   the centre, turned 45°, hands tapping, lines appearing on the screen, "…" and ✓ bubbles
   floating up, with a soft glow behind him. Rows get "Answered ✓" and go grey; the serious
   ones get an outline and "Lead ✓" (products: "Paid ✓"). Caption: "Now your page replies /
   Every chat answered. Serious buyers qualified."
3. *With Curios* (tile turns dark: #16324a for service, #542339 for Kek Lina; tag with a green
   dot "With Curios · 3 worth calling" / "RM346 paid today"): Peek goes, the lead card (or the
   paid order) rises in, then the next two rows. Caption: "Leads, already qualified" / "Orders,
   already paid".

**Motion rules.** Same as the rest of the landing: `useReducedMotion` draws everything on its
finished frame (big tile on step 3, bars full, both alerts, suggestion tapped) on the server
and for reduced motion. Start the loops only when the section is in view
(IntersectionObserver) and pause them when it leaves. Switching persona restarts all loops.
CSS transitions and timeouts only, no animation library.

**Copy (Malay)** to add to `copy.ts` alongside English, in the same shape:
- What lands in your hands. → *Apa yang anda dapat.*
- Every chat on your page ends in one of these. → *Setiap chat di page anda berakhir dengan salah satu daripada ini.*
- I offer a service / I sell products → *Saya beri servis / Saya jual produk*
- Your inbox · 47 unread → *Inbox anda · 47 belum dibaca*
- Your inbox today / 47 unread, mostly "hi". A real buyer is buried in there. → *Inbox anda hari ini / 47 belum dibaca, kebanyakannya "hi". Pembeli sebenar tenggelam di situ.*
- With Curios · your page replies → *Dengan Curios · page anda membalas*
- Now your page replies / Every chat answered. Serious buyers qualified. → *Kini page anda membalas / Setiap chat dijawab. Pembeli serius ditapis.*
- Answered ✓ / Lead ✓ / Paid ✓ → *Dijawab ✓ / Lead ✓ / Dibayar ✓*
- Leads, already qualified / Your page asked budget, area and timing. Just call. → *Lead yang sudah ditapis / Page anda dah tanya bajet, kawasan dan masa. Telefon je.*
- Orders, already paid / Straight from the chat. No "transfer dulu ya". → *Pesanan yang sudah dibayar / Terus dari chat. Tiada "transfer dulu ya".*
- Your listings, suggested / It shows them the units that fit. → *Listing anda dicadangkan / Ia tunjuk unit yang sesuai.*
- Products, suggested / It picks from your shop, at your prices. → *Produk dicadangkan / Ia pilih dari kedai anda, ikut harga anda.*
- Told the moment it matters / Serious buyers ping you. The rest don't. → *Dimaklumkan bila penting / Pembeli serius akan beritahu anda. Yang lain tidak.*
- What buyers keep asking, answered / See it all in one place, and spot what you're missing. → *Soalan yang selalu ditanya, dijawab / Lihat semua di satu tempat, dan nampak apa yang anda terlepas.*
The chat lines ("hi", "berapa sewa?", "kek coklat ada?"…) stay as written in both languages.

**Claims to make true, or soften.** The section shows a few things the product does not do yet.
Before launch either build them or change the tile:
- Lead temperature tags (Hot / Warm / Ready to view) on Leads.
- A push or email alert for a hot lead or a new paid order ("Told the moment it matters").
- "Demand you're missing": questions asked about something the owner doesn't list or sell.
- A "Follow up" lead for a buyer who chatted but didn't buy.
Everything else (answering from approved facts, suggesting listings or items, leads with a
number, paid orders, the Questions list) exists already. The numbers are sample figures.

## Dashboard v2: new frame, calmer pages, 10px corners (29 Oct 2026)

All owner screens (My Curios, Store, Orders, Questions, Leads, Review, Facts & sources, Billing,
Settings, and the Alerts states board) were reworked. The boards in `design/boards/` are the
source of truth; stills are `design/screens/<Board>.desktop.jpg` and `.phone.jpg`, plus
`Knowledge-ask-empty.desktop.jpg`. Each board's changes sit at the end of its `<style>` under
`/* v2 ... */` comments, so they are easy to find.

**The frame (one shared layout component):**
- The page background is soft grey `#edeff4`. The sidebar sits on it with no panel or border:
  248px wide, a search box with a `/` shortcut under the logo, plain-case group names (Page,
  Inbox, Knowledge, Account), 36px rows, 18px icons, light blue `#e2e7fb` for the current page.
  The account block at the bottom is replaced by the plan: "Business plan, 18 days left" and a bar.
- A 64px **top bar** on the grey: breadcrumb (page name / screen), dark mode, notifications bell
  with an unread dot, and the account button (avatar, name, menu).
- The content is one white **sheet** under the top bar, with only its top-left corner rounded
  (16px). It runs to the right and bottom edges.
- Tablet (≤1100px) keeps the 72px icon sidebar; phone (≤760px) keeps the sidebar as the top row
  and hides the top bar.

**Page header:** the title (Bricolage, 30px) with a one-line summary under it, actions on the
right. The three stat cards are gone; their numbers live in the summary sentence, for example
Orders: "2 receipts to check and 5 orders to make. RM612 came in this week." No line under the
header.

**Side panels run full height.** On My Curios, Store, Review and Facts & sources the header
covers only the left column; the phone preview, the review side panel and "Ask your page" start
at the top of the sheet, on white, split by one thin line. Nothing crosses them.

**Rules everywhere:**
- **Corners are 10px** on every box, card, list, field, search bar, chat panel and button.
  Things nested inside a 10px box use 7–8px (selected tab pill 7px, sidebar rows 8px). Pills,
  switches, avatars and the phone mock stay round.
- **Tabs** are one pill style: grey track, the selected tab a white pill. No underlines.
- **List selection** (Orders, Questions, Leads) is a flat `#eef1fd` highlight, no raised card or ring.
- **Chats inside the dashboard** (Questions preview, Leads conversation, Review, Ask your page)
  no longer use the owner's page colour. They look like a normal AI chat: a `#f6f7f9` panel,
  the customer's message in a white bubble with a hairline, the page's reply as plain text
  under a small Peek-eyes icon and "Kek Lina's page". The phone previews still show the owner's
  real colours.

**Per page:**
- **My Curios:** Profile and Appearance are one tab, "Profile" (cover, you, style, background,
  accent, font), plus "Links".
- **Orders:** the order detail is two plain columns, no boxes. "Her receipt" is a file row
  (thumbnail, file name, uploaded time, View) and three rows: Amount ✓ Matches, Paid to ✓ Your
  name, Reference, then "Receipts can be edited. Check RM25 is in your bank before you mark it
  paid." The amount/name/reference come from reading the receipt image, which doesn't exist yet:
  until it does, show what the customer entered and drop the ✓ checks.
- **Facts & sources:** when nothing has been asked, "Ask your page" shows Peek standing and
  whistling (eyes up, "o" mouth, two notes floating up, gentle bob) with "Nothing asked yet".
  The art is inline in the board (`.pw` SVG); respect reduced motion.
- **Settings:** two columns. Left: your page as one card (avatar, address, "Business page,
  always shows up in search", Copy and Change), then Signing in (Google, Password) and This
  device (Sign out). Right: "Email me when" as a list of switches, with a new row, "Your plan is
  ending" (3 days before and on the day), which the plan emails in `plan-mail.ts` already send.
- **Billing:** same content, full width, 10px corners.

Fonts stay as they are (IBM Plex Sans for text, Bricolage for titles).

**Contents brought in line with the approved mockups (29 Oct, second pass).** Nothing that was on
the boards was removed; existing controls were regrouped and restyled:
- **My Curios:** the Profile / Links tabs sit beside the title, with Saved, your link and View page
  on the right. Profile reads You, Cover photo (84px square tiles), **Colours** (page backgrounds and
  button colours as two rows of dots, hex field kept), then **Button style and font** (the two
  button styles as cards and the six heading fonts as a 3×2 grid of tiles). Links: social profiles
  two across, and the Shop link is the first row of the links list, with its switch.
- **Store:** tabs beside the title; the ready checklist, About your shop and the item list follow.
  Payment: the connected CHIP account and the DuitNow QR are single rows with their buttons on the
  right. Pickup & delivery keeps its switch, delivery modes, fee and notice stepper.
- **Orders, Questions, Leads:** a search box above the filters; the detail title is 22px text, not
  a display heading. Orders shows progress as four bars and "What Farah bought". Leads puts the
  New / Contacted / Closed pills next to the number.
- **Facts & sources:** facts are plain rows under plain-case group names; sources are one list with
  "+ Add a source" on the right; pinned answers sit on light grey; never-say topics are soft red
  chips.
- **Billing:** no cards; Monthly and Yearly are rows (radio, name and note, price on the right).

### Top bar, right side: "account forward" (29 Oct 2026)

Replaces the three white bordered boxes on the right of `.v2topb` in all ten dashboard boards (MyCurios, Store, Orders, Questions, Leads, Review, Knowledge, Billing, Settings, Alerts). Look at the CSS block marked `/* top bar right: account forward (29 Oct) */` in each board.

- Left to right: **Help** text link, **dark mode** icon, **bell with a count** (blue `#2340c8` pill with "3", not a red dot), a thin 1px divider, then the **account button**.
- Icons have no box or border; they sit on the grey ground (`#edeff4`). Hover is a soft white fill, 10px radius.
- Account button: round 32px avatar (initial on `#b5294e`), two lines: name (13.5px/600) and "{page name} · {plan}" (12px, `#5b6170`), then a grey chevron.
- The count pill reads the unread alerts count; hide it at 0. The plan label comes from Billing.
- Responsive: ≤1000px hides Help and the second line; ≤860px shows the avatar and chevron only; ≤760px the top bar is hidden as before.

### Account popover: "plan at a glance" (29 Oct 2026)

Opens from the account button in the top bar (boards use `<details class="tb-accw">`; build it as a real menu with focus handling, Esc and click-outside to close). Screen: `design/screens/Account-popover.desktop.jpg`. CSS is in the block marked `/* account popover: plan at a glance (29 Oct) */`.

- 296px wide, white, 10px radius, 1px `#e3e6ec` ring plus a soft shadow, 8px below the button, right-aligned.
- Top: 38px round avatar, name, sign-in email.
- Plan card (`#f5f6fa`, 8px radius): "Conversations this month" with used / limit and a blue bar (same numbers as the Conversations meter in Billing; it resets on the 1st), then "{plan} · paid until {date}" and a **Manage** link to Billing. There is no auto-renew, so say "paid until", never "renews".
- Rows: Settings, Help & support, divider, **Sign out** as a red row (`#c4372d`, hover `#fdf1f0`), not a boxed button.
- Billing is no longer its own row, because the plan card's Manage link goes there.

### Phone: floating pill menu at the bottom (29 Oct 2026)

At ≤760px the old row of icons at the top is gone. CSS is in the block marked `/* phone: floating pill menu at the bottom (29 Oct) */` in all ten dashboard boards. Screens: `design/screens/*.phone.jpg`, plus `Phone-more-sheet.phone.jpg`.

- **Top bar (56px, `#edeff4`):** logo on the left; bell with count and the round avatar on the right. The avatar opens the same account popover as desktop.
- **Bottom pill:** fixed, 12px from the sides and 14px from the bottom (plus safe area), 64px tall, fully rounded, white, 1px `#e3e6ec` ring and a soft shadow. Five tabs, each with an icon and an 11px label: **Page** (My Curios), **Store**, **Inbox**, **Review**, **More**.
- **Selected tab:** just a blue (`#2340c8`) icon and label. No background highlight.
- **Counts:** blue pill badges. Inbox shows Orders + Questions + Leads combined; Review shows facts to check.
- **More:** opens a sheet above the pill with Facts & sources (Knowledge), plus Billing and Settings (Account). The page behind is dimmed (`rgba(25,31,44,.35)`). Close it on tap outside, Esc or picking a page. The current page shows blue in the sheet, and More is blue while you're on one of those pages.
- **Inbox:** on phone, Orders, Questions and Leads show a tab row (`.v2itab`) at the top with their own counts, so the owner switches between them there.
- Content gets 96px of bottom padding so the pill never covers the last row.

## Payment result pages (2 Nov 2026)

### Subscription (owner pays Curios): Peek happy or sad
Board: `Billing.dc.html`. To view it, use the preview bar's **Payment → Paid / Failed** buttons. Paying through the Billing modal also lands on the paid page now; it used to show a toast. CSS is in the block marked `/* payment result pages: Peek happy / sad (2 Nov) */`, and the markup is the `.pr` overlay. Screens: `Billing-paid.*`, `Billing-payment-failed.*`, plus the animation in `Billing-payment-result.peek.gif`.

- Make it a full page at the CHIP return URL, not a modal. Grey ground `#edeff4`, logo on the left, **Back to Billing** on the right.
- **Desktop:** one white card, 880px wide, 16px radius, split in two.
  - Left side (42%) is Peek's art panel: `#e8edff` with falling confetti when paid, `#f1f2f5` when failed.
  - Right side: kicker, a 32px Bricolage title, a short line, a receipt box (`#f5f6fa`), then the buttons.
- **Phone (≤760px):** the art panel stacks on top (240px tall). The buttons go full width and stack.
- **Peek** is the real mascot, with only pose and eyes changed. Don't redraw him.
  - **Paid:** he looks up, both hands raised, and jumps in a loop: squash on landing, shadow shrinks while he's in the air, hands bob.
  - **Failed:** he looks down with a small frown and sways slowly. One hand scratches his head, a sweat drop falls, and a "?" bubble pulses.
  - Under `prefers-reduced-motion`, all of this stops.
- **Copy:**
  - Paid: "Payment received / Welcome to Business, {name}." plus the new paid-until date. "Nothing renews by itself." Buttons: **Go to dashboard** and **Download receipt**.
  - Failed: "Not charged / That didn't go through." plus "your plan is still fine until {current date}". Then what was tried and the bank's reason (map CHIP's status to plain words). Buttons: **Try again** and **Pick another bank** (both reopen the pay flow), plus a "Need help?" link.

### Shop (customer pays the owner)
The success page already exists ("Paid. Order placed" with the order code), so keep it.

The new failed page is in `Public.dc.html` as route `payfail` ("Payment failed" in the preview's route bar). CSS is in the block marked `/* payment failed (2 Nov) */`. Screens: `Shop-payment-failed.*`.

- It uses the same layout as the placed page: a red cross in a soft circle, then "Payment didn't go through".
- "Nothing was taken. {Shop} has saved your order for **30 minutes**." Hold the order (and any stock or slot) for 30 minutes, then release it.
- The order code tiles turn grey (`#6b5a60`), with the order lines and total under them.
- **Pay {total} again** is the main button and goes back to CHIP for the same order. **Pay another way** goes back to checkout with the basket kept.
- At the bottom, a small line: "Tried with {method}. The bank said: {reason}."

## Landing: "No cut, ever" block (8 Nov 2026)
Board: `TanyaJe.dc.html`. It's a new `<section class="nc">` between the For business story and Pricing, on the same pink (`#fbeef1`). CSS is in the block marked `/* no cut, ever (8 Nov) */`. Screens: `Landing-no-cut.*`.
- **Left:** eyebrow "No cut, ever", the title "Every sale is yours. We take 0%." with 0% in `#b5294e`, then "RM49 a month is all you pay us."
- **Right:** a white card showing a RM100 order as two bars.
  - Marketplace: keep about RM89, with a red ~RM11 cut.
  - Curios: keep RM99, with only a sliver for the RM1 FPX fee.
  - The bars grow in once (900ms). Under reduced motion they don't animate.
- **Below:** three tiles: Website and hosting (`curios.my/keklina`), Payments (FPX, TNG, GrabPay, Visa through CHIP) and Found on Google (a search result preview).
- **Small print:** keep it. It shows the fee assumptions and that CHIP fees still apply. Recheck the marketplace numbers before launch, because Shopee changes them often.
- **Phones:** everything stacks, and the ~RM11 label is hidden so only the red bar shows.
- The "usual way vs Curios" checklist (option B) is meant for the pricing page later. It isn't built yet.

## Shop: Ask items and enquiries (8 Nov 2026)
Boards: `Public.dc.html` (customer), `Store.dc.html` and `Leads.dc.html` (owner). CSS is in blocks marked `(8 Nov)`. Screens: `Shop-ask-*.phone.jpg`, `Store-ask-item.desktop.jpg`, `Leads-enquiry.desktop.jpg`.

**Owner (Store item editor)**
- New "How they order" choice on physical items: **Add to basket** (default) or **Ask for a price**.
- Ask items take an optional **Starting price** ("From RM"), which the page uses to answer "how much?".
- A note explains that customers fill in one message plus their name and WhatsApp, and the page picks out the details for Leads.
- Data: `item.ask = true`, `item.price` = the starting price, which can be empty ("Price on request").

**Customer (shop)**
- Ask items show a maroon **Ask** pill instead of **+**, priced "From RM180 · ask" (or "Price on request" with no starting price). They can't go in the basket.
- The item page's bottom bar says **Ask Kek Lina**. The separate "Ask about this" row is hidden on Ask items.
- The enquiry sheet is a bottom sheet with the item at the top, then just **one message box** ("What do you need?", placeholder: the date, how many people, the design, your budget), name and WhatsApp (prefilled if known), **Send enquiry**, and "You don't pay anything yet."
- There are no fixed questions for the owner to set up. The AI picks the date, number of people and budget out of the message for the Leads card ("Picked out of their message"), the same way it already does for chat leads.
- After sending, the customer lands in the page's Ask chat:
  - their enquiry shows as a bubble with the item attached, then a green "Sent to Lina" tag
  - the page replies from facts only: the starting price, whether the date has a slot, and that Lina confirms on WhatsApp
  - **Never invent a price.** With no starting price, say Lina will send one.

**Owner (Leads)**
- Enquiries come in as leads with an **Enquiry** tag in the list, and "Sent an enquiry … from your shop · {name}" in the header.
- A "Their enquiry" card shows the item, When / For / Budget, their note, and **Send a quote**.
- **Send a quote** creates a payment link for a set price. Once paid, it becomes a normal order in Orders.
- The first WhatsApp draft is written for the enquiry.

## Help chat for owners (12 Nov 2026)
This is the follow-up to the support inbox. The full design is in `design/help/help-chat-design.md`, and the guide it answers from is in `design/help/help-faq.md` (58 entries, written from `main` at `88d53a3`). The board is `design/boards/Help.dc.html`, whose preview bar steps through Start, Answer, Didn't help, Not in the guide, Sent and Topics. Screens: `design/screens/Help-*.jpg`.

In short:
- Help (top bar) and "Help & support" (account popover) open a 420px panel instead of `mailto:`.
- It answers only from the guide: the whole file, cached, sent to Haiku. Each answer comes with a button to the screen it talks about.
- Every state leads to **Send to support**, which drops the question straight into the support inbox. The team's reply goes to the owner's email.
