# The landing page

`curios.my/` (English) and `curios.my/ms` (Bahasa Melayu).

| Route | File |
|---|---|
| `/`, `/ms` | `app/(landing)/page.tsx`, `app/(landing)/ms/page.tsx` → `LandingPage.tsx` |
| Share images | `app/(landing)/opengraph-image.tsx`, `app/(landing)/ms/opengraph-image.tsx` → `og-image.tsx` |
| `robots.txt`, `sitemap.xml` | `app/robots.ts`, `app/sitemap.ts` |
| Favicon, home-screen icon | `app/icon.svg`, `app/apple-icon.png` |

## Direction: the calm landing (2026-11-17)

Rebuilt from the calm `Landing2` board (`design/HANDOFF.md`, "Start here: the
calm redesign", 14 Nov 2026; screens `Calm-Landing.desktop.jpg` and
`.phone.jpg`), which replaced the TanyaJe board: warm neutrals, Inter, black
pill buttons, a living Peek, and nine sections.

| Section | File | What it does |
|---|---|---|
| Page scope | `LandingPage.tsx`, `calm.module.css`, `Reveal.tsx`, `scene.ts` | `.page` maps the calm tokens onto the base ones (as the app frame does) and holds the shared pieces (`.wrap`, `.sec`, `.lbl`, `.h2`, `.s2`, `.hl`, `.btn`, `.dotbg`, `.caret`, `.tdots`, `.rv`). |
| Nav | `Nav.tsx`, `nav.module.css` | Sticky, clear over the hero, frosted once the page has scrolled (the one frosted surface). |
| Hero | `Hero.tsx`, `PageCard.tsx`, `Claim.tsx` (+ modules) | "Don’t read the bio. Ask Aisyah." The name pill rolls to the front page of a deck of three; the front page is asked and types its answer, then the deck moves on. A side page is a button that brings it forward. The claim field has a live Peek that ducks while you type. |
| Ask strip | `AskStrip.tsx`, `ask.module.css` | One word lit every 1.7s. |
| Who it's for | `Who.tsx`, `who.module.css` | One question typed into an ask bar, five pages answering in their own words; the chips jump to a question and hold it 15s. |
| How it works | `How.tsx`, `how-scenes.tsx`, `how.module.css` | Three cards that play: the paste with its facts marked, the facts approved one by one, the link in the bio tapped and the page answering. |
| For business | `Lands.tsx`, `LandsCheckout.tsx`, `lands-script.ts`, `lands.module.css` | What lands in your hands: one chat in the owner's own look, four zones (the lead or paid order, suggestions, the ping, what people keep asking) landing along dashed connectors. A service side (Studio Hana, with the capture card) and a products side (Kek Lina: basket, checkout and FPX payment inside the phone, in the real checkout's own words via `shopCopy`). Left alone the sides take turns; a visitor's pick stays. |
| No cut, ever | `NoCut.tsx`, `nocut.module.css` | Two receipts for the same RM100 cake print in turn; the marketplace one loses three fees and dims, the Curios one is stamped 0%. Fixed sample figures (`keepAfter`), never PlanTerms. |
| Pricing | `Pricing.tsx`, `pricing.module.css` | Personal free; Business at the prices in force (`pricingCopy(locale, terms)`), monthly or yearly; the calculator. "One more order and it pays for itself" shows only when it is true. |
| FAQ | `Faq.tsx`, `faq.module.css` | One open at a time; every answer stays in the page, so FAQPage structured data matches it. |
| Closing, footer | `Closing.tsx`, `Footer.tsx` (+ modules) | "Tanya je." over "One page for …" with a word pill rolling every 2s while in view, the claim again (no Peek). The footer keeps the legal links and the operator line (DEVIATIONS 138). |

Every word is in `copy.ts`, both languages in one shape; the sample owners'
looks (and their product swatches) are in `personas.ts`, the one place outside
`packages/ui/src/tokens.css` with hex. The landing's own values are the
`--cl-*` block in `tokens.css`. Mock pages, phones, receipts and the bio keep
the board's corners through `--mock-radius-*` properties; Curios's own
containers are 16px and controls are pills (`findOffRuleRadii`, checked over
every module in `calm.test.tsx`). Light only.

**Scenes.** Every scripted scene is a `Scene` (`scene.ts`): a finished frame
(`still`), a first frame (`start`) and a `run` that sets state between `wait`s.
`useScene` plays it only while its element is in view, resets on leaving, and
restarts on a changed key; `play`'s stopped waits never resolve, so a switch
cannot leave a timer or a stale line behind. `useReducedMotion` answers
"reduced" on the server and the first render, so the HTML is every scene's
finished frame.

**Reveal contract.** A revealed block carries `className={calm.rv}`,
`data-rv=""` and an optional `--d` delay. The server never hides anything;
`RevealWatcher` holds only blocks below the fold after mount
(`data-rv="wait"`) and releases each as it comes into view. Reduced motion, or
no IntersectionObserver, holds nothing.

**Peek.** `_peek/LivePeek.tsx` with `_peek/peek-life.ts`: every live Peek shares
one pointer listener (pupils follow the pointer) and one habit clock (look,
tilt, squish, blink, wave, hands, hop). Nothing is added under reduced motion.
The auth screens keep `_peek/Peek.tsx`.

**Photos.** In `public/landing/personas/` (WebP, supplied by the owner on
2026-10-16; not from Unsplash, so the footer note does not credit it), with
smaller copies listed in `photos.ts`. `/landing/*` is cached for 30 days, so a
redrawn photo takes a new file name. Daniel's and Farah's photos are not shown
anywhere now (Who draws an initial for every page), though they stay in
`public/` and `photos.ts`.

**Claims to make true, or soften** (DEVIATIONS 249 still applies). What lands
in your hands shows the Hot tag on a lead, the ping on the owner's phone, and
"Not in your services yet" on a question the page could not answer. None is
built yet. Before launch each is built or its zone changed.

## SEO

**Title / description** (en): "Curios: a link in bio people can ask", and a
description naming Malay or English and approved facts. Malay versions are under
the same limits. Tests enforce them.

**Structured data:** Organization, WebSite, SoftwareApplication (three MYR offers,
priced from the prices in force, which `structuredData` takes as an argument),
and FAQPage from the list the page shows.
Nothing claims ratings or reviews.

## Before launch

1. **A native speaker reads the Malay** in `copy.ts`. The owner read the
   earlier landing's Malay on 2026-10-22 (DEVIATIONS 10), but the calm
   sections (Who, How, What lands, No cut, Pricing, the closing) are drafted
   by an AI and still need that read (DEVIATIONS 313).
2. ~~**Font preloading is broken app-wide**~~ Resolved 2026-10-26: only a Windows
   build loses it; a Linux build preloads (`devDocs/deferred-findings.md`).
3. ~~**The sitemap lists only the landing page** and the Terms, Privacy and
   Refund pages, not business pages.~~ Done 2026-10-26: it lists every
   indexable page with its shop and FAQ entries (`getSitemapPages`).
4. Measured the calm landing 2026-11-18 on a Linux production build
   (`Dockerfile.web`), Lighthouse 13.5.0 mobile, three runs: 83 / 85 / 87,
   CLS 0, LCP 3.7–3.9 s, TBT 50–160 ms, FCP 1.2 s (the TanyaJe build: 84, CLS
   0, LCP 4.0 s). The first run found CLS 0.004 from the hero's name pill
   (sized only after measuring) and a deck card's name on the font swap; the
   pill now sizes itself from a hidden copy of the front name, and the name box
   is full width.

## History

Built 2026-10-03 as "Tanya page ni", reworked through a band layout, a motion
pass and the 2026-10-13 Berkira pass (pinned hero, the paid moment, GSAP and
Lenis), then replaced on 2026-10-16 by the TanyaJe board, and on 2026-11-17 by the calm Landing2 board (`tanya.module.css` and the TanyaJe sections are gone). What survives: the
claim field's behaviour (a real GET form to `/signup` that keeps the typed handle
for the claim screen, `apps/web/lib/wanted-handle.ts`), the wordmark, and the
structured data. The old `Device` phone, `demo.ts` and `landing.module.css` went
once the sign-in screens and My Curios were rebuilt from their own boards.

## Sign-in screens (2026-10-04)

Sign in, sign up, forgot, reset and verify share `app/_auth/AuthShell.tsx`, which
reads the wordmark, `landing-tokens.css`, the personas and `useReducedMotion`
from here.
