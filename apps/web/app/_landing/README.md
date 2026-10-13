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

## Direction: Berkira's calm, on our bands (2026-10-13)

Spec and the owner's decisions: `devDocs/landing-redesign-design.md`. In short:
[berkira.com](https://berkira.com/)'s calm and motion (one idea per section, a
short plain headline, a real piece of product on sample data, a pinned hero, a
soft smooth scroll), in Curios's own palette, with the full-width colour bands
kept but used with more restraint. Biru is the one accent; kuning only where a
person must act.

The audience's biggest worry is "the AI will quote a wrong price", so the page
shows the product working rather than describing it. The demo is a shop:
**Kek Lina**, a made-up home bakery in Shah Alam, labelled as a demo wherever it
appears. Every demo belongs to that one shop, so the hero, the paid moment, the
shop and the trust section quote the same facts (`demo.ts`).

**The positioning promise:** put your prices in your bio link once; it answers
every "berapa harga" after that and sends the ready-to-buy people to you.

**Section order follows the owner's objections, not a template:**

| # | Section | File | Band | Job | Motion |
|---|---|---|---|---|---|
| 1 | Hero: forty DMs become one answer | `HeroScene.tsx`, `HeroStage.tsx` | `--biru-muda` | The promise, then the problem (twelve DM bubbles fly into Kek Lina's page and become one question, "asked 40x"), then the fix (her one answer). | **Pinned** (400vh), load-in |
| 2 | How it works | `HowItWorks.tsx` | `--surface` | Objection 2, "no time": three steps, honest that Instagram can't be read. | Reveal |
| 3 | The paid moment: 11:42pm to WhatsApp | `PaidMoment.tsx`, `PaidStage.tsx`, `LeadPhones.tsx` | `--biru` | Objection 3, "why pay?": five steps from the question to the WhatsApp reply. | **Pinned**, progress line |
| 4 | A little shop, right on your page | `ShopSection.tsx`, `ShopDemo.tsx` | `--paper` | The shop: a shelf visitors can try, ending in the exact WhatsApp message. | Reveal; the demo answers taps |
| 5 | It won't make up a price | `Trust.tsx` | `--l-kuning-100` | Objection 1, "it'll get prices wrong": approved facts, "I'll check with Lina", the waiting question. | Reveal |
| 6 | The quiet parts | `QuietParts.tsx` | `--surface` | Malay/English/rojak, FAQ pages, works with any bio link. | Reveal |
| 7 | Pricing | `Pricing.tsx`, `BusinessPrice.tsx` | `--paper`, Business card on `--biru` | Free vs RM39, the RM95-order maths, FPX with no auto-charge. | Reveal |
| 8 | FAQ | `Faq.tsx` | `--surface` | Everything else, also emitted as FAQPage structured data. | The disclosure |
| 9 | Closing + footer | `Closing.tsx` | `--ink` | One line, the claim field, log in; the footer is a card on it. | none |

The nav (`Header.tsx`, `SectionLinks.tsx`) is solid `--paper` with a hairline
after 8px of scroll. No frosted surfaces anywhere.

**Rendering rule:** every section renders its finished state on the server, so
it reads without JavaScript, for search engines and for reduced motion. The
client scenes only enhance it once `loadMotion()` resolves and motion is
allowed. All captions are in the DOM in reading order.

**Type:** Bricolage Grotesque for headings at **600-700** (was 800), tracking
-0.03em at display sizes; IBM Plex Sans for reading; IBM Plex Mono for data
(step numbers, counts, prices in snippets). Loaded only for the landing page, in
`app/(landing)/layout.tsx`. The demo phones render the real product, so inside
them it is still Inter and Plex Mono. Scale: 1.25 (major third) on a 17px body,
fluid between 390px and 1280px.

**Surfaces:** full-width bands of one palette colour (map above), 20px cards on
`--card` with a hairline `--line`, pill buttons, no shadows. Three strong bands
(biru, kuning-100, ink) sit between pale ones, so colour lands where the story
turns. A band sets five roles (`--band-head`, `--band-text`, `--band-soft`,
`--band-btn-*`, `--band-line`) in `landing.module.css`, and everything in it
reads them, so headings and buttons are right on any band.

**Motion:** two pinned scroll moments (the hero, the paid moment) and a Lenis
smooth scroll, landing only.

| Unit | Job |
|---|---|
| `motion.ts` | `prefersReducedMotion()` and `loadMotion()`, a dynamic import of `gsap`, `gsap/ScrollTrigger` and `lenis`, so none of them is in the first paint. |
| `SmoothScroll.tsx` | Starts Lenis when motion is allowed, drives it from GSAP's ticker, and exposes `scrollToSection(id)` for the nav. |
| `timeline.ts` | `HERO_TIMELINE`, `PAID_TIMELINE` and the pure helpers that read them. The one place to tune pace. |
| `useScrub.ts` | Binds a section's scroll progress to a scene through ScrollTrigger. |
| `Reveal.tsx`, `InView.tsx` | One-off arrivals (12px, 280ms). |

Only files in `app/_landing/` may import `gsap` or `lenis` (`containment.test.ts`
enforces it). **Reduced motion, or no JavaScript:** no Lenis, no pinning, no
load-in. The hero shows the finished phone (one question, asked 40x, answered)
with its three captions as plain lines; the paid moment shows its five steps as
a list beside the final WhatsApp; reveals show at once. The shop demo still
works, since it is interactive rather than animated.

**Exemptions from DESIGN.md**, decided by the owner (2026-10-03, amended
2026-10-13) and recorded there: scroll-linked motion with two pins and a smooth
scroll, and the landing's own type scale. The dashboard and public pages keep
every original rule.

### Files

`LandingPage.tsx` (composition and metadata), `Header.tsx`, `SectionLinks.tsx`,
`Wordmark.tsx`, `ClaimField.tsx`, `Device.tsx`, `PhotoSlot.tsx`, the sections
above, `copy.ts` (every word, both languages), `demo.ts`, `structured-data.ts`,
`og-image.tsx`, `brand-colors.ts`, `plex.ts`, `landing-tokens.css` and one CSS
module per section.

---

## Colour

The locked palette is `packages/ui/src/tokens.css` (rebranded to biru on
2026-10-03). Nothing on this page changes a locked value. Derived values are in
`landing-tokens.css`, each generated in OKLCH at its parent's hue and listed
with its coordinates.

### Inventory: every colour on the page

| Value | Token | Parent | Where it appears |
|---|---|---|---|
| `#191f2c` | `--ink` | locked | Body text, the closing band, phone bezels, lock screen, mono step numbers |
| `#fafbfc` | `--paper` | locked | Page background, text on ink/biru, inverted buttons |
| `#f0f1f4` | `--surface` | locked | How it works and quiet-parts bands, count chip |
| `#2340c8` | `--biru` | locked | Primary buttons, the paid band and the focus ring. Inside the demo phones: the accent tile, ask-bar border, reply button |
| `#eaf0ff` | `--biru-muda` | locked | Answer bubbles (product UI) |
| `#f2a33c` | `--kuning` | locked | The trust band, and inside product mockups: the captured-lead card, the lead's number in the email, the waiting question. Money and "a human needs to act" only |
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
| `#8f5c15` | `--l-kuning-700` | kuning | Kuning as small text on paper (5.5:1), in the paid moment's email |
| `#b3b7c1` | `--l-ink-300` | ink | Secondary text on ink (closing band, lock-screen date) |
| paper 8%, 16% | `--l-paper-a08/a16` | paper | Unused since the storm was removed; safe to delete |

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
| A live ask bar | `HeroStage.tsx` | The hero's phone plays a scripted exchange. Swapping in the real `Ask` component on a seeded page costs inference on every visit. |
| Lead email and capture card | `LeadPhones.tsx` | Rebuilt in HTML from the real product strings. Swap for real screenshots if preferred. |
| Social proof | none yet | There are no real owners to quote, so the page has no proof section and invents nothing. When there is one, put it between the shop and Trust. |
| Hero photo | `HeroScene.tsx` → `PhotoSlot` | `public/landing/hero-baker.webp`, supplied by the owner on 2026-10-08. A home baker at her counter, smiling at her phone beside a chocolate cake; cropped round `focus`. |
| How it works photo | `HowItWorks.tsx` → `PhotoSlot` | `public/landing/setup-laptop.webp`, supplied by the owner on 2026-10-08. An owner at her kitchen table on a laptop, phone and teh tarik beside her. |
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
| Secondary | AI jawab soalan pelanggan | Hero sub (ms) |
| Secondary | linktree alternative Malaysia | Hero, How it works (mentions Linktree as a source) |
| Secondary | auto reply berapa harga | Hero, trust |
| Secondary | dapatkan lead pelanggan WhatsApp | Paid moment |
| Long tail | cara jawab soalan harga pelanggan Instagram | Hero, FAQ |
| Long tail | link bio kedai kek online | Hero (Kek Lina) |
| Long tail | chatbot BM untuk peniaga kecil | FAQ "Does it reply in Malay?" |
| Long tail | page FAQ untuk kedai online | Pricing (Business points) |
| Long tail | bayar FPX bulanan tanpa kad | Pricing, FAQ "How do I pay?" |

---

## Measured (2026-10-03, production build, local; before the 2026-10-13 redesign)

The redesign adds GSAP and Lenis as on-demand chunks and has not been re-measured with Lighthouse. Treat the table as the old page.

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
- **JS under 100 kB gzipped on the critical path: missed (111 kB).** 103 kB of that is Next and React shared by every route in the app; the landing page's own code is about 8 kB. three.js has since been removed, so the page loads no 3D code at all.
- **Critical CSS inlined:** `experimental.inlineCss` in `next.config.ts`. It applies app-wide, and the stylesheets are small.
- **Images:** there are none. Every visual is HTML, CSS or SVG, so there is nothing to lazy-load or size.
- **The one accessibility audit that doesn't pass:** the demo's AskBar has a fixed `aria-label` while its visible question rotates. That's a deliberate product decision documented in `packages/ui/src/ask-bar/AskBar.tsx`.

---

## Before launch

1. **A native speaker reads the Malay** in `copy.ts`, including the redesign's new strings (the hero captions, How it works, the paid moment, the shop section, the quiet parts, the "Can I sell on my page?" FAQ entry and the Business shop line). It was drafted by an AI; DESIGN.md requires a Malay speaker's copy.
2. **Font preloading is broken app-wide** (`devDocs/deferred-findings.md`). Next's font manifest builds empty, so no font is preloaded and no fallback size-adjust is applied. That is the source of the CLS above, and it affects every page, not just this one.
3. **The sitemap lists only the landing page.** Indexable business pages and their FAQ pages need a database read to be added.

---

## History

The page was first built on 2026-10-03 as "Tanya page ni" (ask this page), then
reworked in passes: a deslop pass, a Linktree-style band layout, a ticker and
price list, a motion pass, and phone devices. On 2026-10-13 it was redesigned
as above. The Storm, Leads, Setup and Hero demo sections, three.js and the
typed-address echo between the claim field and the hero are gone. What survives
from those passes: the band roles, the `Device` phone, `ClaimField` (a real GET
form to `/signup` that keeps the typed handle in browser storage,
`apps/web/lib/wanted-handle.ts`, to pre-fill the claim screen after sign-up),
the price-list picture in Trust, and the rule that every demo is Kek Lina's.

---

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
