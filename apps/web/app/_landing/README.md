# The landing page

`curios.my/` (English) and `curios.my/ms` (Bahasa Melayu). Built 2026-10-03 on
branch `slice-16/landing`.

| Route | File |
|---|---|
| `/`, `/ms` | `app/(landing)/page.tsx`, `app/(landing)/ms/page.tsx` → `LandingPage.tsx` |
| Share images | `app/(landing)/opengraph-image.tsx`, `app/(landing)/ms/opengraph-image.tsx` → `og-image.tsx` |
| `robots.txt`, `sitemap.xml` | `app/robots.ts`, `app/sitemap.ts` |
| Favicon, home-screen icon | `app/icon.svg`, `app/apple-icon.tsx` |

Everything else lives here in `app/_landing/`: one component per section, each
with its own CSS module, `landing-tokens.css` for every design value,
`copy.ts` for every word in both languages, and `demo.ts` for the made-up shop.

---

## Direction: "Tanya page ni" (ask this page)

Three directions were proposed: a shop-sign brutalist stack, this one, and a dark
ledger. This one was chosen because the audience's biggest worry is "the AI will
quote a wrong price". The fastest way past that worry is to let them ask a page
and watch it answer. The page doesn't describe the product; it is the product.

Owners don't have much to ask Curios itself, so the demo is a shop instead:
**Kek Lina**, a made-up home bakery in Shah Alam, labelled as a demo wherever it
appears. Every demo on the page belongs to that one shop, so the hero, the
leads story, the trust section and the storm's ending all quote the same facts.

**The positioning promise:** put your prices in your bio link once; it answers
every "berapa harga" after that and sends the ready-to-buy people to you.

**Section order follows the owner's objections, not a template:**

| Section | Job |
|---|---|
| Hero | The promise, the mechanism, one button. The proof is a real Curios page (BentoPage + AskBar) answering. |
| Storm | The problem it removes: as the visitor scrolls, customers' messages (forty ways of asking one price) pop up round a phone one by one, then fly into it, where they are one question, "asked 40×", with the owner's one answer. |
| Leads | Objection 3, "why pay?": what the RM39 buys, played out from 11:42pm question to WhatsApp reply. |
| Trust | Objection 1, "it'll get prices wrong": approved facts, "I'll check with Lina", the waiting question. |
| Setup | Objection 2, "no time": four steps, honest that Instagram can't be read. |
| Pricing | Free vs RM39, the RM95-order maths, FPX with no auto-charge. |
| FAQ | Everything else, also emitted as FAQPage structured data. |

**Type:** Bricolage Grotesque for headings, IBM Plex Sans for reading (loaded
only for the landing page, in `app/(landing)/layout.tsx`). The demo phones
render the real product, so inside them it is still Inter and Plex Mono.
Scale: 1.25 (major third) on a 17px body, fluid between 390px and 1280px.

**Surfaces (Linktree-style pass, 2026-10-03):** each section is a full-width
band of one palette colour, laid out the way linktr.ee's homepage is: a
floating white pill nav, very heavy headlines (Bricolage 800, -0.04em), pill
buttons, 28px cards, two-column sections that alternate sides, and the
`curios.my/` claim field in the hero and the closing band. Colours are only
ours. No shadows: bands and cards separate by colour.

| Section | Band | Headline | Buttons |
|---|---|---|---|
| Hero | `--biru-muda` | `--l-biru-800` | biru pill |
| Storm | `--ink` | `--l-biru-200` | |
| Leads | `--biru` | `--biru-muda` | paper pill, biru text |
| Trust | `--l-kuning-100` (unanswered questions are kuning's job) | `--l-kuning-900` | |
| Setup | `--paper` | ink | |
| Pricing | `--surface`; the Business card takes the biru band's roles | ink / `--biru-muda` | |
| FAQ | `--paper` | ink | |
| Closing + footer | `--l-biru-800`; the footer is a white card on it | `--biru-muda` | biru-muda pill |

A band sets five roles (`--band-head`, `--band-text`, `--band-soft`,
`--band-btn-*`, `--band-line`) in `landing.module.css`, and everything in
it reads them, so headings and buttons are right on any band.

**Motion:** one orchestrated moment, the storm. Everything else answers a
person's action (tapping the ask bar, picking a step) or arrives once (two
small scroll reveals, 280ms, 12px). Reduced motion gets a still storm with the
answer already showing, the leads story at its last step, and no reveals.

**Exemptions from DESIGN.md, decided by the owner on 2026-10-03** and recorded
there: the landing page may use scroll-linked motion, and its own
type scale. The dashboard and public pages keep every original rule.

---

## Colour

The locked palette is `packages/ui/src/tokens.css` (rebranded to biru on
2026-10-03). Nothing on this page changes a locked value. Derived values are in
`landing-tokens.css`, each generated in OKLCH at its parent's hue and listed
with its coordinates.

### Inventory: every colour on the page

| Value | Token | Parent | Where it appears |
|---|---|---|---|
| `#191f2c` | `--ink` | locked | Body text, storm band, Business card, phone bezels, lock screen, step numerals and ticks, current step, header-hint chip |
| `#fafbfc` | `--paper` | locked | Page background, text on ink/biru, inverted buttons |
| `#f0f1f4` | `--surface` | locked | Trust band, count chip, done steps, replay hover |
| `#2340c8` | `--biru` | locked | Primary buttons and the focus ring. Inside the demo phones: the accent tile, ask-bar border, reply button |
| `#eaf0ff` | `--biru-muda` | locked | Answer bubbles (product UI) |
| `#f2a33c` | `--kuning` | locked | Only inside product mockups: the captured-lead card, the lead's number in the email, the waiting question. Money and "a human needs to act" only |
| `#696e7b` | `--muted` | locked | Secondary text on light grounds only (4.9:1 paper, 4.5:1 surface) |
| `#ffffff` | `--card` | locked | Cards, chat bubbles, email |
| `#e4e7eb` | `--line` | locked | Hairlines, outlines |
| `#f5f5f7` | `--soft-page` | locked | Phone screens (the real Soft page background) |
| `#122686` | `--l-biru-800` | biru | Primary button pressed |
| `#1a31a8` | `--l-biru-700` | biru | Primary button hover |
| `#86a2ea` | `--l-biru-300` | biru | Focus ring on ink surfaces (6.6:1) |
| `#bfd1f9` | `--l-biru-200` | biru | Pressed state of the inverted button on the Business card |
| `#dfe8fd` | `--l-biru-100` | biru | Hover state of the outlined and inverted buttons |
| `#ffebd6` | `--l-kuning-100` | kuning | Captured-lead card ground |
| `#8f5c15` | `--l-kuning-700` | kuning | Kuning as small text on paper (5.5:1), in the leads story's email |
| `#b3b7c1` | `--l-ink-300` | ink | Secondary text on ink (storm body, Business per-month, lock-screen date) |
| paper 8%, 16% | `--l-paper-a08/a16` | paper | Fallback storm bubbles and their outline |

The share image and the home-screen icon
can't read CSS, so they use `brand-colors.ts`, a mirror that a test keeps equal
to `tokens.css`. There are no gradients and no glows.

Added in the Linktree-style pass:

| Value | Token | Parent | Where it appears |
|---|---|---|---|
| `#563505` | `--l-kuning-900` | kuning | Trust headline on the kuning-100 band (9.5:1) |
| band text at 7%, 10%, 18%, 30% | `color-mix` in the module | each band's text colour | Photo placeholders (7% fill, 30% dashed edge), step hover (10%), done steps and rules (18%) |

**Untraceable values:** none.

**Where contrast came up in this pass:** `--muted` fails on biru-muda (4.47:1)
and on kuning-100 (4.40:1). The hero's soft text is ink there, and the trust
band's is ink too.

**Semantic colours:** none added. Error (`--merah`) never appears here: the page
has no form and nothing to delete.

### Where contrast came up

Brand colours were never adjusted. Each fix changed the layer instead.

- `--muted` on ink is 3.4:1, so text on ink uses `--l-ink-300` (8.2:1).
- `--biru` on ink is 3.1:1, so the focus ring on ink uses `--l-biru-300` (6.6:1).
- `--kuning` behind white fails (about 2:1), so kuning always carries `--ink` (7.9:1).
- Kuning as small text on paper fails, so it uses `--l-kuning-700` (5.5:1).
- On the ink Business card the primary button inverts to paper with biru text (7.7:1).

---

## Swap in real assets and proof

| What | Where | How |
|---|---|---|
| The demo shop | `demo.ts` | Replace `DEMO_PAGE`, `DEMO_QA`, `DEMO_FACTS`, `DEMO_LEAD` with a real owner's page (with their permission). Nothing else changes. |
| A live ask bar | `HeroDemo.tsx` | The comment there shows how to swap the scripted answer for the real `Ask` component on a seeded page. That costs inference on every visit. |
| Lead email and capture card | `LeadsStory.tsx` | Rebuilt in HTML from the real product strings. Swap for real screenshots if preferred. |
| Social proof | none yet | There are no real owners to quote, so the page has no proof section and invents nothing. When there is one, put it between Leads and Trust. |
| Hero photo | `Hero.tsx` → `PhotoSlot` | A home baker at her counter, holding her phone with her Curios page open. 4:5 on desktop, 4:3 on a phone; the demo phone stands in front of its lower left, so keep the subject upper right. |
| Setup photo | `Setup.tsx` → `PhotoSlot` | An owner pasting her shop's link into Curios on a laptop, phone beside her. 4:5. |
| Share image fonts | `og-image.tsx` | Uses the default sans. Load Bricolage as a TTF into `ImageResponse` for a branded card. |

---

## SEO

**Title / description** (en): "Curios: a link in bio that answers your customers" (49
characters), and a 150-character description naming "berapa harga", Malay or
English, approved prices, and RM39. Malay versions are under 60 and 155. Tests
enforce both limits.

**Structured data:** Organization, WebSite, SoftwareApplication (three MYR
offers), and FAQPage built from the same list the page shows. BreadcrumbList is
left out because a one-crumb breadcrumb on the root page says nothing. Nothing
claims ratings or reviews.

**Keyword map.** These are proposals drawn from how this audience writes, not
from search-volume data, which hasn't been pulled. Check them in Search Console
or Google Keyword Planner before investing in content.

| Kind | Term | Section |
|---|---|---|
| Primary | link in bio Malaysia | Title, hero |
| Primary | link bio untuk bisnes | `/ms` title, hero |
| Secondary | AI jawab soalan pelanggan | Hero sub (ms), storm |
| Secondary | linktree alternative Malaysia | Hero, setup (mentions Linktree as a source) |
| Secondary | auto reply berapa harga | Storm, trust |
| Secondary | dapatkan lead pelanggan WhatsApp | Leads |
| Long tail | cara jawab soalan harga pelanggan Instagram | Storm, FAQ |
| Long tail | link bio kedai kek online | Hero demo (Kek Lina) |
| Long tail | chatbot BM untuk peniaga kecil | FAQ "Does it reply in Malay?" |
| Long tail | page FAQ untuk kedai online | Pricing (Business points) |
| Long tail | bayar FPX bulanan tanpa kad | Pricing, FAQ "How do I pay?" |

---

## Measured (2026-10-03, production build, local)

Lighthouse 12, run on this machine against `next start`.

| Run | Perf | A11y | Best practices | SEO | LCP | CLS | TBT |
|---|---|---|---|---|---|---|---|
| Mobile, simulated throttling (×3) | 96–97 | 100 | 100 | 100 | 2.5 s | 0.035 | 20 ms |
| Mobile, real devtools throttling (×3) | 98 | 100 | 100 | 100 | **1.1 s** | 0.035 | 140–150 ms |
| `/ms`, real devtools throttling (×3) | 87–98 | 100 | 100 | 100 | 0.9–1.2 s | 0.002 | 150–500 ms |
| Desktop | 100 | 100 | 100 | 100 | 0.5 s | 0.008 | 0 ms |

Against the budget:

- **LCP under 2.0s: met in real throttling (1.1s), missed in Lighthouse's simulation (2.5s).** The simulation counts every script requested before the paint, including React's 103 kB baseline. The LCP element is the server-rendered `<h1>`.
- **CLS under 0.05: met (0.035).** The shift comes from the font swap moving the demo phone. See "Font preloading" below.
- **INP under 200ms: not measurable in a lab.** TBT is the stand-in. It's low on `/` but varied from 150 to 500ms on `/ms` because of one long parse-and-hydrate task. Watch real-user INP after launch.
- **JS under 100 kB gzipped on the critical path: missed (111 kB).** 103 kB of that is Next and React shared by every route in the app; the landing page's own code is about 8 kB. three.js has since been removed (see "Ticker and price list"), so the page loads no 3D code at all.
- **Critical CSS inlined:** `experimental.inlineCss` in `next.config.ts`. It applies app-wide, and the stylesheets are small.
- **Images:** there are none. Every visual is HTML, CSS or SVG, so there is nothing to lazy-load or size.
- **The one accessibility audit that doesn't pass:** the demo's AskBar has a fixed `aria-label` while its visible question rotates. That's a deliberate product decision documented in `packages/ui/src/ask-bar/AskBar.tsx`.

---

## Before launch

1. **A native speaker reads the Malay** in `copy.ts`. It was drafted by an AI; DESIGN.md requires a Malay speaker's copy.
2. **Font preloading is broken app-wide** (`devDocs/deferred-findings.md`). Next's font manifest builds empty, so no font is preloaded and no fallback size-adjust is applied. That is the source of the CLS above, and it affects every page, not just this one.
3. **The sitemap lists only the landing page.** Indexable business pages and their FAQ pages need a database read to be added.

---

## Self-critique log (first build → fixed)

A hostile pass on the first build found these. All are fixed.

1. **The CTA disappeared on phones.** The header hid its button below 768px, leaving four screens with no button after the hero. It now always shows "Create page" / "Buat page".
2. **A control looked broken.** While playing, the leads button became a disabled grey "Step 1 of 5" pill. It's now a status line with a pulsing dot, and a real "Play it again" button when idle.
3. **A lazy visual.** The owner's phone said only "You, asleep" on a blank screen. It's now a lock screen showing 11:42.
4. **Rhythm.** The storm was 260svh on a phone, too much scrolling for one idea. It's now 220svh (300svh on desktop, where it has room).
5. **Templated layout.** Four equal "how it works" columns became a stair, each step lower than the last, with the final step's rule in biru.
6. **Weak proof above the fold.** The hero phone opened empty in the middle. It now opens with "Berapa harga kek coklat 1kg?" already answered, scrolled into view.
7. **Noise.** "✓ Approved" repeated four times in the facts card became one line, "Each one approved by you", with a tick per row.
8. **Readability.** FAQ answers were in muted grey; long Malay answers read better in ink.

Fixed during the build, before the critique:

- **Copy and layout.** The leads story on phones moved the phone above the steps, so the autoplay is visible.
- **The 3D scene.** Its field was refitted so no bubble fills the screen or covers the heading.
- **The wordmark.** It was rebuilt in HTML so its mark lands on the i.
- **The demo's ask bar.** It got its stamped biru border back.
- **Head tags and links.** The share-image URL was fixed to `https://curios.my`. The logo and language links got names that contain their visible text.

---

## Deslop pass (2026-10-03)

Layout, section order and components unchanged. What changed:

- **Glow and colour.** The biru glow behind the 3D card (CSS and three.js) is gone, along with the tinted bubbles. The closing band went from solid biru to plain page with a rule. Numerals, ticks, step circles and the wordmark mark went from biru to ink. The RM39 kuning sticker became plain type. The accent is now buttons only.
- **Surfaces.** Every shadow is gone, and borders took their place. Corners went from 14px and pills to 4–6px. The Trust band no longer floats with rounded corners.
- **Type.** Body text went from Inter to IBM Plex Sans.
- **Alignment.** Captions, device labels, step dots, controls and the storm counter are left-aligned.
- **Rhythm.** Section padding varies (96/128, 96/64, 64/128, 96/64, 64/96, 128/96) instead of repeating 128/96.
- **Copy.** Headlines now state what happens ("You answer each question once.", "It only quotes prices you approved."). Each step is one concrete sentence. Buttons say "Create your free page". The demo greeting dropped its em dash. Tests now fail on any em dash or the extended banned-word list.

---

## Linktree-style pass (2026-10-03)

Asked for: linktr.ee's homepage look, in our colours, with placeholders for
photography.

- **Bands:** every section is a full-width colour band (table under "Direction").
- **Nav:** a floating white pill, sticky, with in-page links (How it works, Pricing, FAQ) on wide screens.
- **Claim field:** `curios.my/` in the hero and the closing band. It is a real GET form to `/signup`. The typed handle is kept in browser storage (`apps/web/lib/wanted-handle.ts`) and pre-fills the claim screen after sign-up and email verification (`app/app/onboarding/claim-form.tsx`); with storage blocked it simply starts blank.
- **Type and shape:** Bricolage 800, tighter tracking; pill buttons; 28px cards; numbered pills in Setup.
- **Layout:** sections alternate sides. Trust puts its product pieces left, words right; Setup puts words left, a photo right.
- **Placeholders:** two `PhotoSlot`s, dashed and labelled "Photo to come", listed under "Swap in real assets".

---

## Ticker and price list (2026-10-04)

The owner disliked two sections; both were rebuilt.

- **"You answer each question once"** was a 3D cloud of overlapping bubbles, hard to read and messy. It is now three ticker rows of the forty wordings, white and pale-blue pills sliding sideways at different speeds and directions (`StormStage.tsx`, CSS only). As you scroll, the rows fade (superseded the same day: see "Storm ending" below). The ticker pauses off screen, and stands still with reduced motion. three.js, `storm-scene.ts` and the `three` dependencies are gone, which also removes a 120 kB chunk.
- **"It only quotes prices you approved"** was a collage of small cards that read as AI-made: a coloured-edge card, doubled labels, struck-through chips, orange body text. It is now one picture, Kek Lina's price list set like a printed card with dotted leaders, plus the single exchange where it is asked something not on the list. The never-say list is one sentence in the paragraph. Body text on the kuning band is ink.

---

## Motion pass (2026-10-04)

Asked for: more animation and micro-animation. Every piece below is tied to
something the product does, and every one is off under reduced motion.

| Where | What moves | File |
|---|---|---|
| Hero, on load | The headline rises in a word at a time (55ms apart, never from fully invisible, so it still paints at once), then the paragraph and claim field, then the phone | `Hero.tsx`, `hero.module.css` |
| Hero, typing | The address on the demo page follows what you type into `curios.my/`, in biru, and the phone scrolls up to show it | `ClaimField.tsx` → `HANDLE_TYPED_EVENT` → `HeroDemo.tsx` |
| Hero, asking | Typing dots for 650ms, then the answer streams in a word at a time, the way the real chat streams | `HeroDemo.tsx` |
| Ticker | Pauses on hover so a row can be read | `storm.module.css` |
| Leads story | A ring fills round the playing step for exactly as long as the step lasts; your phone buzzes when the email lands; the captured number pops | `LeadsStory.tsx`, `leads.module.css` |
| Price list | On arrival, once: each line's dots run out to its price, then the question, typing dots, and the answer in the dots' place | `InView.tsx`, `trust.module.css` |
| Pricing | Monthly / Yearly switch; the thumb slides, the figure rolls between RM39 and RM390 | `BusinessPrice.tsx` |
| FAQ | Answers slide open (`::details-content`; browsers without it open at once) | `faq.module.css` |
| Nav | The link for the section you are reading is highlighted; the pill takes a hairline edge once the page scrolls | `SectionLinks.tsx` |
| Headings | Each section heading rises in once, 12px, 280ms | `Reveal.tsx` |
| Buttons | Give slightly when pressed (scale 0.97) | `landing.module.css` |
| Anchors | In-page links glide and land below the nav | `landing-tokens.css` |

## Storm ending (2026-10-04)

The ticker's ending read as AI-made: a white card floating over faded,
see-through pills, two badge chips, and a small counter in the corner. Now the
section plays in two acts that never overlap. First the rows clear away
completely. Then, on the heading's left edge, one large pill with the
question and "asked 40×" beside it (the way the Questions screen counts),
and the owner's answer sliding in under it as a biru reply bubble, with one
line: "Your answer, word for word, every time." The counter, the badges and
the floating card are gone.

## Storm ending, second pass (2026-10-04)

The two-act ending read as static. Now the ticker never stops. As you
scroll: the question comes in ("asked 40×"), then the owner's answer, and
then each wording in the still-moving rows turns pale blue and grows a small
biru **RM95** reply tag, one by one, scattered across the three rows
(`--at` per pill in `StormStage.tsx`, `--on` in `storm.module.css`). On
wide screens the question and answer sit beside the heading and the rows run
full width under both; on a phone they follow the rows. With reduced motion,
every wording is shown already answered.

## Photo section and real phones (2026-10-04)

- **"You answer each question once"** is now composed like a linktr.ee section: the words on the left, a large rounded photo on the right (a `PhotoSlot` until the real one arrives) with the product floating over it. The question pill and "asked 40×" hang off its top left, Kek Lina's answer sits bottom right, and the ticker runs full width underneath, with the RM95 replies attaching pill by pill.
- **Every phone is now one `Device`** (`Device.tsx`): a thin bezel with side buttons, a camera island, a status bar (time, signal, wifi, battery), the app's own top bar (a browser address bar for Curios pages, a mail app bar for the lead email), a home indicator, and real phone proportions (9:19) so content is not cut off. The owner's phone shows a lock screen (date, 11:42) until the lead lands. In the hero, the browser address bar follows what the visitor types in `curios.my/`.
- Fixed on the way: with `aspect-ratio`, a box's minimum size follows its content, which widened the hero past a 390px screen; the frame and the hero's grid items now set `min-width: 0`.

## Sign-in screens (2026-10-04)

Sign in, sign up, forgot, reset and verify now share `app/_auth/AuthShell.tsx`
instead of the dashboard's `Shell`, in the landing page's look: the form on
paper under the wordmark (heavy Bricolage heading, one line under it, pill
fields and buttons, an "or" rule, a "Continue with Google" pill, and a link to
the other way in), and on wide screens a biru band with the demo phone
answering "berapa harga". The product's `Field`, `Button` and `Callout` keep
their behaviour; `auth.module.css` restyles them inside the frame. IBM Plex
Sans now lives in `_landing/plex.ts` so both the landing page and these
screens load it. The sign-up button reads "Create my page", matching every
button that leads to it.
