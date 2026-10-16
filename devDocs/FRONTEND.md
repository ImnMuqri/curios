# FRONTEND.md

> Intended path: `apps/web/FRONTEND.md`

Two audiences that share zero mental models.
**Visitors** are strangers on 4G who did not choose to be here. **Owners** are shop
people, not operators. Build them as two different products in one codebase.

---

## Routes

```
/[handle]                 public page          SSR, edge, cached
/[handle]/faq             question index       ISR, revalidate 60s
/[handle]/faq/[slug]      single answer        ISR, revalidate 60s
/[handle]/shop            the shop (slice 17)  SSR, live, business pages with the shop open
/app                      dashboard shell      client, authed
/app/onboarding           choose personal or business, paste a link or text, review facts
/app/knowledge            Knowledge: four tabs (Facts, Sources, Pinned answers, Never say); the tab is in `?tab=`
/app/curios               My Curios: profile, links, appearance, live preview
/app/leads                table + transcript drawer
/app/store                the shop: settings and items (business pages)
/app/questions            topics, most asked first; answer, merge, split, rename
/app/billing              plan, usage against cap, payments, trial reset
/app/settings             sign-in methods, the search-engine switch
```

**The sidebar groups the modules as *Page* (My Curios, Store), *Inbox* (Questions, Leads),
*Knowledge* (Review, Facts & sources) and *Account* (Billing, Settings)** (amended 2026-10-16;
sign-out lives in Settings). Add a source lives on the
Knowledge screen's Sources tab, not in the sidebar. `/app/onboarding` remains the first-run
claim-and-first-source screen. `?tab=` is `facts` (the default), `sources`, `pinned` or
`never-say`. Dates on the Sources tab are formatted in Asia/Kuala_Lumpur, so the server and
browser renders agree. The shared Button (`packages/ui`) treats `busy` by type: a plain
`type="button"` sets `aria-disabled` and ignores clicks, so focus stays where the owner pressed;
a `type="submit"` goes natively disabled, which forms rely on against a double post. It forwards
`aria-label`.

### Questions (slice 15)

`/app/questions` lists **topics**, not wordings: one row per topic, most asked first, then most
recent (the order `getTopics` returns; the client does not re-sort). Left, the topic's title and a
subline: "+N other wordings" and "Answered: ..." or "Not answered yet". Right, the total ask count
and one action, **Answer** (unanswered) or **Edit** (answered), which opens an inline editor under
the row.

- **"+N other wordings"** folds out the topic's wordings, each with its own count, **Not the same
  question** (splits it into its own topic; it never regroups) and **Delete**.
- **The ⋯ control** is a disclosure list, not an ARIA menu: a button with `aria-expanded` opens a
  list of plain buttons, so Tab moves through it and there is no arrow-key navigation. It holds
  **Same as...** (a picker of the page's other topics), **Rename**, **Hide from FAQ** / **Show on
  FAQ** (only for a business page's topic with a slug) and **Delete topic**, whose confirm names how
  many wordings go.
- **Same as...** merges into the chosen topic. If both topics have an answer the owner must pick
  one to keep (**pick-one**), with the other topic's answer shown beside "Keep theirs".
- **A topic with a `conflictAnswer`** (two answers, left by the one-off grouping) shows "Two answers
  - pick one", both answers, and a **Keep this** on each.
- Opening a panel (answer, rename, same-as, delete) focuses its field; double taps are guarded, and
  every action's error shows in place, keeping the owner's input and focus.

**Knowledge's Pinned answers tab** lists answered topics (title, answer) with edit and remove; it
calls the `/topics/:id/answer` routes. Removing one returns the topic to Questions as unanswered.

**`/app` lands in My Curios.** A signed-in owner with a page is sent straight to
`/app/curios`; one without a page yet goes to onboarding instead. It is the only screen
that decides this.

**One flat namespace.** `curios.my/nadia` is the URL for a person and for a bakery
alike, and it never changes shape on upgrade. Mode is a property of the page, so this
one route renders both and the difference is in what the page shows, not where it
lives.

**Personal pages are `noindex` by default.** A privacy default, not an SEO setting: most
people do not want an AI page about themselves ranking for their own name. The switch
lives in Settings, off until they turn it on. Business pages index by default and emit
`FAQPage` structured data.

**Handles are a reserved namespace.** Claim-time validation rejects app, api, faq,
admin, about, pricing, help, support, blog, login, signup, settings, static, plus
profanity and trademark blocks. Publishing is gated on phone OTP only, so a page can
go live in two minutes. Verification is separate: a bio code for personal pages, an
SSM document upload for business pages. It earns the badge and nothing else: an
unverified Pro page keeps every feature, including lead capture. The badge renders the
registration number and registered name, never a bare tick. Upload sits in
`/app/curios`, not in the payment flow, and states plainly that the file is
deleted after checking. *Amended by slice 13, which folded profile and appearance into
My Curios; this document upload is still unbuilt.*

---

## Rendering

**Public page is the product's reputation.** Server render the shell, links, and the
FAQ content into real DOM. Hydrate chat on top. If JS fails, the page is still a
working link list with readable answers. That fallback is also the SEO artifact and
the over-cap degraded state, so it is one build serving three jobs.

*Amended by slice 13, which built the links half of the product and, with it, removed
the fact list this sentence promised.* The public page server-renders a bento grid of
the owner's links (`BentoPage`, shared with the editor's live preview), not a list, and
carries no fact list at all. "Readable answers" no longer live on the page itself: they
live on the FAQ pages, still indexed for business pages (personal pages stay `noindex`
by default), which the public page links to when any exist. Without JavaScript the grid
is still plain server-rendered anchors, so the page keeps working as a link page; only
the ask bar needs JS.

Budget. *Amended by slice 3, which measured this for the first time and found the
original sentence could not be true.*

**As enforced:** the public route's own chunk stays under **40KB**, asserted in
`apps/web/app/[handle]/budget.test.ts` against the manifest Next emits after a build. It
is 7.2KB today. That is the number this codebase moves when someone adds a dependency or
statically imports something meant to be lazy.

**Originally written:** *"under 40KB JS before chat opens"*, and it said "enforced in CI"
from the day it was written, when nothing measured it at all. First Load JS for
`/[handle]` is 105KB, of which 102KB is the shared React and Next runtime. React alone is
roughly 50KB gzipped, so no amount of care in this codebase brings first load under 40KB
while React is in the page. The budget was unmeetable, not merely unmet.

**LCP under 1.5s on a Moto G** stays the target and is not machine-checked. Nothing here
measures it, and claiming otherwise is what got the line above rewritten.

Chat bundle loads on first interaction with the ask bar, never before. *Also not yet true:*
chat mode (`ChatMode`, formerly the sheet) is behind a `next/dynamic` import that does not
currently produce a separate chunk, because `AskBar` is imported from the same
`@curios/ui` barrel and webpack has nothing left to defer. It costs about 4KB of a 7KB
chunk. See the comment in `apps/web/app/[handle]/ask.tsx`, which says so rather than
describing a split that does not happen.

---

## The Store

*Added by slice 17.* Business pages only; the API side is in `BACKEND.md`.

**The shop tile.** With the shop open, the public page gains one tile in the bento, labelled
**Visit shop** (**Lawati kedai** on a Malay page) with the item count under it ("3 items" /
"3 barang") and the first available item's photo, if any item has one. It opens
`/[handle]/shop`. It is a new kind of entry in the arrangement, not a link: `withShopTile`
(core) puts it at the page's saved position and `arrangeTiles` sizes it like any tile, so it
shows up first by default and takes an automatic size until the owner picks one. The words are
passed to `BentoPage` ready-made (`shopCopy`), so the renderer stays language-free.

**`/[handle]/shop`** is rendered on the server from `getPublicShop`, read live
(`force-dynamic`) so an item turned off leaves the shelf on the next request, in the page's own
look with the bio and tiles folded away (`BentoPage mode="shop"`) and a back arrow to the front
page. It 404s when there is no shop to show: unpublished, personal or closed. A card per
available item, "from RM95" when it has options; tapping one opens a sheet to choose an option
and a quantity, and `?item=<id>` opens with that item's sheet up. The pickup, delivery and
notice lines come from the owner's settings, in English or Malay (any other page language
reads English).

**The basket** holds ids, options and counts, never prices, in `sessionStorage` per handle, and
is priced against the shelf as it is read now (`priceBasket`): an item taken down or an option
removed since is dropped rather than priced at a number the shop no longer offers. Where
`sessionStorage` is blocked it lives in memory only. The basket bar shows the count and the
total, and its one button is **Order on WhatsApp**, which opens
`wa.me/<number>?text=...` with the basket written into the message:

```
Hi <shop>, I'd like to order:
• 2 × Kek Batik (1kg) — RM190
Total: RM190
```

**That is the whole of ordering in slice 17.** The message is the order; Curios stores nothing
about it, and slice 18 adds real orders. The number is read from the page's links, from a
`wa.me` link or an `api.whatsapp.com/send?phone=` link. **A page with neither shows a line
instead of the button** ("To order, contact <name> through the links on their page."), and an
open shop with no available items still shows its "0 items" tile and an empty shelf ("Nothing
for sale right now. Check back soon.").

**`/app/store`** (the sidebar's *Store*, after My Curios, shown only to business owners; a
personal owner who reaches it sees a line saying shops are part of business pages) has two
parts. *Settings* is one explicit-Save form: open the shop, how customers pay (the DuitNow QR
image, or bank, account name and account number), pickup and its note, delivery (none, a flat
fee, or "rider paid separately"), and minimum notice in days. It sends only what changed, and
the API's refusals appear in the owner's words; the open switch is disabled, with the missing
pieces named, while the shop is closed and has no way to pay or hand over. *Items* is the
editor beneath: add an item with one price or a list of priced options, edit it, give it a
photo, toggle **Available** (which hides it from the shop and the chat at once), remove it, and
reorder by drag or the up/down buttons. Available, order, removal and photos save the moment
they are used. With storage off, photo and QR uploads say they are switched off and everything
else still works.

**The shop row in My Curios.** With the shop open, the links list carries a **Shop** row:
draggable and sizable like a link, with a note to turn the shop off in Store to remove it. The
row moves in the same list as the links, and the one reorder request sends it as `'shop'`.

---

## The ask bar

The signature component. Read DESIGN.md before touching it.

States: `idle` (cycling a real question from this page's facts) → `focused` →
`sheet-open` → `thinking` → `answering` (streamed) → `capture` (conditional).

Rules:
- It never presents an empty prompt with no suggestion. This is the founding
  constraint: the visitor should never have to invent the question.
- Chips come from the knowledge base at build time, not from a model call on page load.
- The sheet covers roughly 74% of the viewport. Links stay visible behind it. The AI
  pushes people back to links, it does not replace them.
- Answers can render a `LinkCard`. That is the whole point.

*Amended by slice 13.* The sheet is gone. Tapping the bar now switches the whole page
into **chat mode** (`ChatMode`, `packages/ui/src/chat`) -- a state of this same page,
not a layer over it. The first version was a full-screen overlay, the claude.ai
treatment; the owner's own read of it was "it looks like it opened another page", so it
was reworked to transition the page in place instead. The header (picture, name,
`curios.my/:handle`) stays exactly where BentoPage already renders it, with a small back
arrow beside it (labelled "Back to links" for a screen reader); the bio and the bento
grid fold upward to make room, and the freed space becomes the conversation. The ask bar
itself becomes the composer, settling into the same sticky-bottom spot rather than a new
control appearing elsewhere. Escape or the phone's own back gesture also returns to the
bento; entering pushes one history entry so the gesture has something of chat mode's own
to consume rather than leaving the page outright. States: `idle` → `chat-mode` (`empty`
-- the same "What do you want to know?" prompt as the greeting, plus up to four chips,
nothing sent yet -- or `thread`) → `thinking` → `answering` (streamed) → `capture`
(conditional). The old `sheet-open` state sent the bar's rotating suggestion immediately
on tap; chat mode sends nothing until the visitor taps a chip or submits the composer
themselves. The thread is kept, not thrown away, while chat mode is closed -- the
component stays mounted, hidden, so tapping the bar again resumes the same conversation
rather than starting a new one. `BentoPage` is a server component and holds none of this
state itself: `ChatMode` reaches its root through `closest('[data-bento-page]')` and
toggles `data-mode`/`data-has-turns` on it directly, which is what the fold, the hidden
ask bar and the hidden prompt are all keyed on in Bento.module.css.

---

## Capture card

Renders inside the message stream only when the API returns `intent.qualified = true`
**and** the page is allowed to capture at all. The client never decides either half. One
field: phone. Everything else is extracted server side from the transcript.

The second half is the plan gate, added in slice 8. `canCapture`
(`packages/core/src/plan.ts`) needs mode and plan together -- a Business page's first
three leads are free, and after that it needs `paidUntil` in the future.
`apps/web/app/[handle]/page.tsx` computes it and `Ask` passes `onCapture` only when it
holds, so on a lapsed page the card never appears however qualified the conversation is.
The visitor is told nothing here, deliberately. The owner is told on their own leads
screen, which counts the trial down and names a spent trial or a lapsed payment
(`apps/web/app/app/leads/trial-notice.tsx`); paying is `/app/billing`, which also shows the month's usage against the cap, recent payments, and — once, for a page that has never paid — a way to put the trial counter back to zero.

Carries a consent line in the visitor's language, above the field, not hidden in a
tooltip. It names who receives the number: the owner, not us.

If it fires on someone who only asked about opening hours, that is a backend bug and
it gets filed as one.

---

## Dashboard rules

1. **No blank prompt boxes.** Anywhere. Every input is a control with a fixed set of
   answers, except the two places a human writes real prose: a pinned answer, and a
   fact correction.
2. **One primary action per screen.** Questions has "Answer" on each topic row. Leads has "WhatsApp
   them". Everything else is secondary.
3. **Empty states are instructions, not moods.** "No leads yet. Share your link and
   they will land here." Not "Nothing to see!"
4. **Numbers link to their source.** Every count is clickable through to the rows
   behind it. An unverifiable metric on a dashboard is decoration.

---

## Onboarding

One field. A URL or an `@handle`. Then a progress view while the worker runs, then a
review screen.

The review screen is the highest leverage surface in the product. Facts arrive as
editable cards, each with its source line. The owner accepts, edits, or deletes.
Never auto-publish an unreviewed price. Getting a price wrong in public is the single
failure that loses a customer permanently.

Poll the job: the ingest request returns 202 with a job id, and the review screen
polls that id until the job resolves. Nothing generative ever blocks an HTTP request.

---

## My Curios

*Added by slice 13.* One screen, at `/app/curios`, where `/app` sends every owner who
already has a page. Profile (picture, display name, bio), links, and appearance sit
together with a live preview that never leaves the screen — the same `BentoPage`
visitors see, so the preview cannot disagree with the published page.

**No Save button.** Every control saves itself: name, bio and an inline link's label or
address debounce 600ms after the owner stops typing; a tile size saves the instant it is
clicked. The preview updates from local state on every keystroke or click, before the
save round-trip returns. Each of those shows its own brief "Saved", and a failed save
keeps what the owner typed or chose and offers a Retry right beside that field or
button, never a page-wide banner. Appearance (style, accent, heading font) is the one
exception: those three save as a matched set on the same click, so a failure shows one
Retry in the Appearance section rather than three that would all resend the same patch.

**Reorder** is drag (`@dnd-kit/sortable`) or the up/down buttons, which is how the
keyboard and a screen reader reach it too. A failed reorder — most often a second tab
having changed the list first — snaps the list back to the last saved order and says
so, rather than leaving the two tabs disagreeing.

**The 30-link limit** (`MAX_LINKS`) is enforced in the editor and the API alike: past
it, "+ Add a link" is replaced by a line naming the limit instead of a rejected request.

---

## State

- Server state: TanStack Query. No global store for it.
- Chat session: local component state, one instance per `ChatMode` (`useState`,
  not `useReducer` -- *amended by slice 13*, which is also when the instance
  moved from the sheet to chat mode).
- Auth: httpOnly cookie. The API issues and refreshes it; middleware only
  redirects. `apps/web` holds a SELECT-only connection and cannot write, so it
  cannot extend a session even if it wanted to.
- No client state library. If you reach for one, the dashboard has gotten too clever.

---

## i18n

Malay and English at minimum, Mandarin later. Interface strings live in
`packages/core/i18n`. The public page defaults to the owner's chosen language, but
**the AI always answers in the language it was asked in**, including Manglish and
rojak. That behaviour lives in the prompt, not in a locale switch.

Never machine-translate owner-written content. If Nadia wrote it in Malay, it ships
in Malay.

---

## Accessibility floor

Keyboard reachable ask bar, focus trap in chat mode (*amended by slice 13*; was
the sheet), escape closes, visible focus rings, `prefers-reduced-motion`
respected, chat announces new messages politely. Not negotiable and not a
phase two.
