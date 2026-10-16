# The landing page

`curios.my/` (English) and `curios.my/ms` (Bahasa Melayu).

| Route | File |
|---|---|
| `/`, `/ms` | `app/(landing)/page.tsx`, `app/(landing)/ms/page.tsx` → `LandingPage.tsx` |
| Share images | `app/(landing)/opengraph-image.tsx`, `app/(landing)/ms/opengraph-image.tsx` → `og-image.tsx` |
| `robots.txt`, `sitemap.xml` | `app/robots.ts`, `app/sitemap.ts` |
| Favicon, home-screen icon | `app/icon.svg`, `app/apple-icon.tsx` |

## Direction: Tanya je (2026-10-16)

Rebuilt from the design handoff's TanyaJe board (`design/boards/TanyaJe.dc.html`,
`design/screens/TanyaJe.*.jpg`), which replaced the shop-first landing: Curios is
"a link in bio people can ask", for anyone, and a shop for those selling.

| Section | File | What it does |
|---|---|---|
| Nav | `Nav.tsx` | A frosted pill over the page, as the board draws it: the one frosted surface DESIGN.md allows. Opaque where a browser cannot blur. |
| Hero | `Hero.tsx`, `PageCard.tsx` | "Don't read the bio. Ask Aisyah." The name rolls to the front page of a deck of five sample pages; a cursor taps Ask and the answer types out. Pressing the deck moves it on. |
| What people ask | `AskStrip.tsx` | "Ask about my rates, services…", one word in focus at a time. |
| The loop | `Loop.tsx` | "curious? just ask" along a curve (SVG `textPath`), scaled, never stretched. |
| Who it's for | `Who.tsx` | Five kinds of owner; pointing at one slides its band in and shows its page. |
| How it works | `How.tsx`, `HowParts.tsx` | Three rooms. Where the browser has scroll-driven animations they slide sideways as the page scrolls; elsewhere they are a row to swipe. |
| For business | `Business.tsx`, `order-scene.ts` | The order played out between two phones, from the board's frame function, plays once the stage is fully in view. |
| Pricing | `Pricing.tsx` | Personal free, Business from `PLAN_PRICES_CENTS`, monthly or yearly, and a "will it pay for itself" calculator. |
| FAQ | `Faq.tsx` | The same items feed the FAQPage structured data. |
| Close and footer | `Closing.tsx`, `Footer.tsx` | "Tanya je." rising letter by letter, the claim field again, the wordmark at full width. |

Every word is in `copy.ts`, both languages in one shape; the sample owners' looks
are in `personas.ts`. Styles are one module, `tanya.module.css`, reading the
product tokens and `landing-tokens.css` (the board's extra colours are at its top).

**Motion.** The landing keeps its exemption from the dashboard's no-motion rule
(DESIGN.md). `useReducedMotion` answers "reduced" on the server and on the first
render, so the page is drawn with every scene on its finished frame, which is
also what a visitor without JavaScript gets; motion starts only once the browser
says it may. GSAP and Lenis are gone: what moves is CSS, `requestAnimationFrame`
and native scroll-driven animations.

**Photos.** Each persona's card shows `photo` (in `personas.ts`) across its top
half, fading into the owner's colour, with the name dropped below the face; a
persona without one is drawn in the colour alone. They are in
`public/landing/personas/` (WebP, 700 wide; supplied by the owner on
2026-10-16), and Kek Lina uses `/landing/hero-baker.webp`. `face` is a square
head-and-shoulders for the small round faces (How it works, the pricing chip);
only Aisyah has one. All are made-up people, as the footer says.

**Claims that wait on slice 18.** The For business section and two Business
pricing lines show checkout, paying by the owner's QR with proof, and Orders.
None of it is built yet (`devDocs/store-design.md`). They are marked `SLICE 18`
in `copy.ts` and `order-scene.ts`; a test counts the markers. Until slice 18
ships, the page promises something the product does not do.

## SEO

**Title / description** (en): "Curios: a link in bio people can ask", and a
description naming Malay or English and approved facts. Malay versions are under
the same limits. Tests enforce them.

**Structured data:** Organization, WebSite, SoftwareApplication (three MYR offers,
priced from `PLAN_PRICES_CENTS`), and FAQPage from the list the page shows.
Nothing claims ratings or reviews.

## Before launch

1. **A native speaker reads the Malay** in `copy.ts`. It was drafted by an AI;
   DESIGN.md requires a Malay speaker's copy.
2. **Slice 18, or the copy changes.** See above.
3. **Font preloading is broken app-wide** (`devDocs/deferred-findings.md`).
4. **The sitemap lists only the landing page.**
5. **Not re-measured.** The 2026-10-03 Lighthouse figures were for a different
   page. Measure this one before launch.

## History

Built 2026-10-03 as "Tanya page ni", reworked through a band layout, a motion
pass and the 2026-10-13 Berkira pass (pinned hero, the paid moment, GSAP and
Lenis), then replaced on 2026-10-16 by the TanyaJe board. What survives: the
claim field's behaviour (a real GET form to `/signup` that keeps the typed handle
for the claim screen, `apps/web/lib/wanted-handle.ts`), the `Device` phone and
`demo.ts` (still used by the sign-in screens and My Curios), the wordmark, and
the structured data.

## Sign-in screens (2026-10-04)

Sign in, sign up, forgot, reset and verify share `app/_auth/AuthShell.tsx`, which
still reads `landing.module.css`, `Device` and `demo.ts` from here.
