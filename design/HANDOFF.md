# Design handoff

This folder is the approved design for Curios. It covers the landing page, auth, onboarding, the
customer side, the account and system pages, owner emails, the dashboard stop states, and every
dashboard module.

Implement **one module at a time** and compare against the screenshots after each one.

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
| `Public` route `page` / `shop` / `ask` | `/[handle]`, `/[handle]/shop`, the ask sheet | exists, restyle |
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

## Open decisions (ask Iman before building these)

1. **Price.** The code has RM39 a month (`PLAN_PRICES_CENTS` 3900 / 39000). The landing and Billing
   designs say RM49 / RM490.
2. **New emails not yet in any spec:**
   - "Your page stopped taking numbers" (trial used up)
   - "Your page reached its monthly limit"
   - plan ending reminders: 3 days before, and on the day
3. **Lapsed plan wording.** The design says a lapse also stops orders. This matches
   `canTakeOrders()`, but confirm the banner copy.
