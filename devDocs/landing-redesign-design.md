# Landing redesign — Berkira's calm and motion, on our bands

**Goal:** make `curios.my/` and `/ms` feel like [berkira.com](https://berkira.com/) — calm,
confident, the product shown working — with two scroll-pinned moments that tell the story
as you scroll, a soft smooth scroll, and the shop from slice 17 given its own section.
Curios keeps its own palette, its full-width colour bands, its two languages and its demo
shop, Kek Lina.

Designed with the owner on 2026-10-13; every choice under "Decisions" is theirs.

---

## What Berkira does that we are taking

Read from berkira.com on 2026-10-13 (its HTML, CSS and page script):

- **Calm:** one idea per section, a short plain headline ("Three steps from paper to proof."),
  a short lede, generous space, and a real piece of product on sample data instead of
  decoration. Display type at about 600 weight.
- **Smooth scroll:** Lenis (`lerp: 0.09`, `wheelMultiplier: 0.9`) drives the page; GSAP's
  ticker drives Lenis; ScrollTrigger updates on Lenis's scroll.
- **A pinned hero:** a `460vh` section with a `sticky top-0 h-[100svh]` stage. One object
  (a WebGL receipt) changes as you scroll, scrubbed (`scrub: 0.6`), while three captions
  swap in place: the promise, the problem ("Thermal ink fades within months."), the fix
  ("Snap it once. Berkira reads the rest.").
- **A load-in:** headline lines rise from below a clip (`yPercent: 110`, `expo.out`, 1.3s,
  stagger 0.09); the lede and buttons fade up 16px after them.
- **A sideways section:** "How it works" pins and translates horizontally on large screens,
  with a 3px progress line across the top and phones swinging in.
- **Reduced motion:** no Lenis, no scrub; the finished state shows.

What we are **not** taking: its frosted (`backdrop-blur`) nav — frosted panels are on
DESIGN.md's banned list — its lime accent and grey-only palette, its WebGL, and its film
(we have none; the hero does that job).

---

## Decisions the owner made

| # | Question | Decision |
|---|---|---|
| 1 | What to take from Berkira | **The animation and the look.** |
| 2 | Colour | **Berkira's calm in our colours:** biru the one accent, kuning only where a person must act. |
| 3 | Colour bands | **Keep the full-width bands**, used with more restraint (see the band map). |
| 4 | The hero's moving story | **Forty DMs become one answer**, and **the page answering live** — as two moments. |
| 5 | How to split them | **Two pinned moments:** the hero tells the forty DMs; the paid section tells 11:42pm → WhatsApp. |
| 6 | How to build the motion | **GSAP + ScrollTrigger + Lenis**, landing routes only. |
| 7 | The shop | **Its own section**, with a demo visitors can try, not a tile in a grid. |

Defaults chosen in design and accepted with it: Bricolage Grotesque drops from 800 to
600–700 with tighter tracking; IBM Plex Sans stays the body face and Plex Mono the data
face; no third pinned moment.

---

## The page

| # | Section | Band | Motion |
|---|---|---|---|
| — | Nav | solid `--paper`, hairline `--line` after 8px of scroll | none |
| 1 | Hero: forty DMs become one answer | `--biru-muda` | **pinned**, load-in |
| 2 | How it works | `--surface` | reveal |
| 3 | The paid moment: 11:42pm → WhatsApp | `--biru` | **pinned**, progress line |
| 4 | A little shop, right on your page | `--paper` | reveal; the demo answers taps |
| 5 | It won't make up a price | `--l-kuning-100` | reveal |
| 6 | The quiet parts | `--surface` | reveal |
| 7 | Pricing | `--paper`, the Business card on `--biru` | reveal |
| 8 | FAQ | `--surface` | the existing disclosure |
| 9 | Closing + footer | `--ink`; the footer a `--card` panel on it | none |

Three strong bands — biru, kuning-100, ink — sit between pale ones, so colour lands where
the story turns. Bands separate by colour only: no shadows, no frosted surfaces. The band
role variables in `landing.module.css` (`--band-head`, `--band-text`, `--band-soft`,
`--band-btn-*`, `--band-line`) carry over; every section reads them.

**Removed:** the Storm section (folded into the hero), the Leads story (replaced by the
paid moment), the four-step Setup (replaced by How it works).

**The nav:** wordmark · *How it works · Pricing · FAQ* · EN/BM switch · *Log in* · *Start
free* (biru pill). On a phone, a Menu button opens the links as a panel on `--paper`.
Section links scroll smoothly through Lenis when motion is allowed, natively otherwise.

---

## 1. The hero (pinned)

A `400vh` section; its stage is `position: sticky; top: 0; height: 100svh`. Kek Lina's real
page (`BentoPage` in a `Device`, with the **Visit shop** tile showing) is the object;
captions sit beside it on large screens and below it on phones, at the stage's bottom.

**Load-in** (once, when motion is allowed): the headline's lines rise from a clip
(`yPercent: 110 → 0`, `expo.out`, 1.3s, stagger 0.09, delay 0.15); the lede, claim field
and "Scroll" cue fade up 16px (`power3.out`, 1s, delay 0.7, stagger 0.08).

**Scroll timeline** (progress 0 → 1 across the section, `scrub: 0.6`):

| Progress | What happens |
|---|---|
| 0.00–0.12 | Caption 1: the promise and the `curios.my/` claim field. The phone is idle. |
| 0.12–0.18 | Caption 1 lifts away (−40px, fade); caption 2 rises in. |
| 0.12–0.45 | Twelve DM bubbles pop up round the phone, alternating sides, one by one. |
| 0.45–0.70 | They fly into the phone and become one question; its count ticks to "asked 40×". |
| 0.68–0.74 | Caption 2 lifts away; caption 3 rises in. |
| 0.70–0.85 | Lina's one answer arrives under the question. |
| 0.85–1.00 | Holds, then the section releases into How it works. |

The bubbles use the demo's `storm` wordings in the page's language; the count's labels come
from the copy (`askedLabels`), as today. All of it is one `HERO_TIMELINE` constant.

**Captions:**

| | English | Bahasa Melayu |
|---|---|---|
| 1 | *the promise, unchanged from today's hero headline and lede* | *same, from `COPY.ms`* |
| 2 | Forty people. One question. | Empat puluh orang. Satu soalan. |
| 3 | Answer it once. Your page answers the rest. | Jawab sekali. Page anda jawab selebihnya. |

A "Scroll to see it answer" / "Scroll untuk tengok ia jawab" cue sits at the bottom of the
stage on large screens.

---

## 2. How it works

Three cards in a row (stacked on a phone), each a step number in Plex Mono, a short
heading, one or two sentences, and a small product snippet:

1. **Paste your link, or your price list.** It reads your website, or the text you paste.
   Instagram can't be read; paste what's on it instead. *(snippet: the source card)*
2. **Tick what's right.** Every fact it found waits for you. Nothing is said until you
   approve it. *(snippet: three facts with tick boxes, one ticked)*
3. **Put one link in your bio.** `curios.my/keklina` answers from then on. *(snippet: the
   claim field, filled)*

Malay versions are written in `copy.ts` by the same standard as today's (written, not
translated). Section heading: "Three steps from your price list to answers." /
"Tiga langkah dari senarai harga ke jawapan."

---

## 3. The paid moment (pinned)

On the biru band, a pinned section with a 3px `--biru-muda` progress line across its top.
One phone, five steps, each with its caption:

1. *11:42pm.* "berapa harga kek 1kg?" arrives on Kek Lina's page.
2. The page answers from her facts.
3. "nak satu untuk Sabtu" — the page offers the number card.
4. The number card fills in.
5. The WhatsApp lands on Lina's phone: the customer's number, what they want, when, and
   the whole conversation.

Closing caption: "That's what RM39 pays for." / "Itulah yang RM39 bayar."

**Large screens:** the five captions sit in a horizontal track that translates left as you
scroll (`pin: true`, `scrub: 0.8`, the length of the track); the phone stays put and
changes state at each step. **Phones:** the phone pins and the captions advance vertically
beneath it. One `PAID_TIMELINE` constant holds the step boundaries.

The conversation, number and slots are today's `LeadsStory` demo data, kept.

---

## 4. A little shop, right on your page

Heading: "Your prices on a shelf. Their order in your WhatsApp." /
"Harga anda di rak. Tempahan mereka di WhatsApp anda."

**The demo** is Kek Lina's shop rendered by the real `/handle/shop` components (`ShopView`
and its item sheet and basket) with demo items added to `demo.ts`:

| Item | Price |
|---|---|
| Kek Batik — Nutella, tahan 5 hari | 1kg RM95 · 2kg RM170 |
| Cookies balang | RM25 |
| Brownies kotak | RM38.50 |

A visitor can tap an item, choose a size, add it, and see the basket and **the exact
WhatsApp message** it would send. The demo's button never leaves the page: it reveals that
message in a panel ("This is what Lina would get"). The demo's basket uses its own storage
key, so it never mixes with a real shop's.

Beside it, three short points: one price, or sizes with their own prices · the chat quotes
your shelf's prices · the basket arrives as a WhatsApp message.

It says nothing about paying by DuitNow QR or an orders screen: those are slice 18, and the
page states only what exists.

---

## 5. It won't make up a price

Today's Trust section, in the calm layout: Lina's approved facts with ticks; a question it
can't answer getting "I'll check with Lina"; that question waiting in her dashboard in
kuning, the one place a person must act.

## 6. The quiet parts

Three tiles: answers in Malay, English or rojak · FAQ pages built from real questions ·
works with any bio link.

## 7. Pricing

Two cards, Free and Business (RM39 a month or RM390 a year), restyled. Their lists keep
today's wording in `copy.ts` exactly, with one addition to Business: **"Your own shop on
your page"** / Malay in `copy.ts`. FPX with no auto-charge and the RM95-order line stay.

## 8. FAQ

Today's questions, plus: **"Can I sell on my page?"** — "Yes, on a business page. Add your
items with their prices, and a Visit shop tile appears on your page. Customers fill a basket
and send it to your WhatsApp." / Malay in `copy.ts`. Still emitted as FAQPage structured
data.

## 9. Closing

One line, the claim field, *Log in*, then the footer card.

---

## Type and surfaces

- **Display:** Bricolage Grotesque **600–700** (was 800), tracking −0.03em at display sizes.
- **Body:** IBM Plex Sans; **data:** IBM Plex Mono (step numbers, counts, prices in snippets).
- The 1.25 scale and fluid sizes from today's landing carry over.
- Cards: 20px radius on `--card`, hairline `--line`, no shadows. Pill buttons stay.

## How it's built

| Unit | Job |
|---|---|
| `SmoothScroll.tsx` (client) | Starts Lenis on landing routes when motion is allowed; wires it to GSAP's ticker and ScrollTrigger; exposes a `scrollToSection(id)` the nav uses. Destroys itself on unmount. |
| `motion.ts` | `prefersReducedMotion()`, and `loadMotion()` — a dynamic import of `gsap`, `gsap/ScrollTrigger` and `lenis` — so none of them is in the first paint. |
| `HeroScene.tsx` (client) | The pinned hero; reads `HERO_TIMELINE`. |
| `PaidMoment.tsx` (client) | The pinned paid section; reads `PAID_TIMELINE`. |
| `ShopDemo.tsx` (client) | Kek Lina's shelf from the real shop components, with a demo basket key and a message panel in place of WhatsApp. Needs one optional prop on `ShopView` (e.g. `onOrder(message)`) that, when given, replaces the WhatsApp link with a button calling it; the public shop never passes it, so its behaviour is unchanged. |
| `HowItWorks.tsx`, `QuietParts.tsx` | New static sections. |
| `timeline.ts` | `HERO_TIMELINE`, `PAID_TIMELINE`, and the pure helpers that read them. |

Removed: `Storm.tsx`, `StormStage.tsx`, `Leads.tsx`, `LeadsStory.tsx`, `Setup.tsx`, and
their CSS modules (their demo data and copy move to the new sections). `Hero.tsx`,
`HeroDemo.tsx`, `Trust.tsx`, `Pricing.tsx`, `Faq.tsx`, `Closing.tsx`, `Header.tsx` are
restyled.

**Rendering rule:** every section renders its **finished** state on the server — readable
without JavaScript, for search engines, and for reduced motion. The client scenes enhance it
only after `loadMotion()` resolves and motion is allowed. All captions are in the DOM in
reading order; the scroll changes which is visible, not what a screen reader hears.

**Dependencies** (`apps/web`): `gsap` and `lenis`. Imported only from `app/_landing/`.

## Reduced motion and no JavaScript

No Lenis, no pinning, no load-in. The hero shows caption 1 beside the finished phone (one
question, asked 40×, answered) with captions 2 and 3 as plain lines under it. The paid
moment shows its five steps as a numbered list beside the final WhatsApp. Reveals show
their content immediately. The shop demo still works (it is interactive, not animated).

## Testing

- **Server render:** every caption, heading, the claim field, the shop demo's items and the
  new FAQ entry are in the HTML, in both languages, in reading order. The existing
  `landing.test.tsx` assertions carry over or are rewritten for the new sections.
- **Reduced motion:** with `matchMedia('(prefers-reduced-motion: reduce)')` true, neither
  `loadMotion` nor Lenis is called and both scenes keep their finished state.
- **Timelines:** acts are in order and do not overlap where they must not; the hero's count
  reaches 40 exactly at its act's end; the paid moment has five steps.
- **Shop demo:** adding an item updates the basket; the demo's button shows the message
  panel and never navigates; the demo's storage key differs from any real shop's.
- **Containment:** no file outside `app/_landing/` imports `gsap` or `lenis`.
- **Design rules:** the existing "no hex outside tokens" check passes; no `backdrop-filter`
  in landing CSS.
- **Size:** the landing route's first-load JS before and after, from `next build`, reported
  in the PR.
- **By hand (the owner):** iPhone Safari and Android Chrome — the pinned hero, the sideways
  paid moment, smooth scroll, the collapsing address bar, reduced motion on, and the shop
  demo. Over HTTP: `/` and `/ms` answer 200 with every caption in the HTML.

## Docs

- `app/_landing/README.md` rewritten for this direction.
- `DESIGN.md`'s landing exemption amended: Bricolage 600–700 on the landing; two pinned
  scroll moments and a smooth scroll, landing only; frosted surfaces still banned; motion
  still yields to reduced motion.
