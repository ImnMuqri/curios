# Calm Landing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the landing page at `/` and `/ms` from the calm `Landing2` board: warm neutrals, Inter, black pill buttons, a living Peek, and the board's nine sections (hero deck, ask strip, "Same question. Their own answer.", three How cards, What lands in your hands, two receipts, pricing, FAQ, closing), in English and Malay.

**Architecture:** `LandingPage.tsx` stays the one entry for both routes, and `copy.ts` stays the one place for every word, both languages in one shape (pricing still built from the admin's `PlanTerms`). The 5,302-line `tanya.module.css` is replaced section by section by small modules. `calm.module.css` holds the page scope (calm tokens mapped onto the base tokens, as the app frame does) and the shared pieces. Each section restyle or rewrite is one commit, and `tanya.module.css` is deleted once nothing imports it. Scripted scenes share one runner (`scene.ts`, the existing `play` moved out of `WhatLands.tsx`), and every Peek shares one controller (`_peek/peek-life.ts`). Every scene renders its finished frame on the server, under reduced motion and without JavaScript.

**Tech Stack:** Next.js 15 app router, React 19, CSS modules, `next/font` (Inter is already loaded), vitest + Testing Library (jsdom), `packages/ui` design rules.

**Spec:** `.superpowers/landing-spec/calm-section.md` (the calm rules from `design/HANDOFF.md`, 14 Nov 2026), `.superpowers/landing-spec/HANDOFF.md` (the earlier landing sections, for behaviour that still applies), the board `.superpowers/landing-spec/Landing2.html` (markup and copy; behaviour in `boot()`), and the screens `.superpowers/landing-spec/screens/Calm-Landing.desktop.jpg` (1440×8042) and `.phone.jpg` (390×12559). `.superpowers/` is git-ignored: the files exist only in this worktree. The committed `design/boards/Landing2.dc.html` is an **older** draft, so do not build from it. Line numbers like `L2:996` refer to `Landing2.html`.

## Global Constraints

- **Words:** where the board's words and the repo's differ, the board's words win. Every other departure from the board is a row in `design/DEVIATIONS.md`. No em dashes. Highlight only words that mean something: the hero name pill, "Their own", the active ask-strip word and the closing word pill. Nothing else.
- **Prices are never literal.** Every RM49 / RM490 / "−2 months" / "3 free leads" / "One RM95 order" on the board is built by `pricingCopy(locale, terms)` from `PlanTerms`. DEVIATIONS 225 and 226 keep applying.
- **Font:** Inter (`var(--font-inter)`, already in `apps/web/lib/fonts.ts`) for every landing word. Big titles weight 600 with `letter-spacing: -0.045em` (h1) or `-0.04em` (h2), body 400–500. Mono is `var(--font-plex-mono)` for handles and codes. The wordmark stays exactly as it is (`Wordmark.tsx`, Bricolage, nav size `--l-wordmark: 28px`). Sample owners' page names keep their own fonts (`personas.ts`), and Kek Lina's becomes `var(--font-outfit)` as on the board (L2:933).
- **Do not touch `apps/web/lib/fonts.ts`.** Inter is already there as `--font-inter`. The foundation branch's Task 3 edits that file, and the landing reuses whatever it leaves.
- **Calm tokens** (light only, already in `tokens.css`): page `--calm-bg` #fbfaf7, surface `--calm-surface` #fff, ink `--calm-ink` #1d1d1b, hover ink `--calm-ink-deep` #000, muted `--calm-muted` #6f6d68, line `--calm-line` #ece9e3, soft `--calm-soft` #f4f2ed, ring `--calm-ring` #e2ded6. Blue highlight = `--tag-new`/`--tag-new-ink` (#e5ecff/#2340c8). Green ticks and paid = `--tag-ok-ink` #1d7a4c on `--tag-ok` #e3f3ea. Amber = `--tag-wait`/`--tag-wait-ink`. Peek's blue = `--biru` #2340c8.
- **New landing tokens** go in `packages/ui/src/tokens.css` under one comment block "The calm landing (Landing2 board)" (Task 1). These are the exact board values: `--cl-text-2` #55534e, `--cl-text-3` #3e3c38, `--cl-faint` #a19e97, `--cl-hint` #9b9891, `--cl-placeholder` #c2bfb8, `--cl-ghost` #cdc9c1, `--cl-ring-hover` #cfcac0, `--cl-dot` #e7e3da, `--cl-hl-green` #dcefe5, `--cl-hl-green-ink` #14523d, `--cl-hl-rose` #f8e3ea, `--cl-hl-rose-ink` #9b2347, `--cl-art-blue` #eef2ff, `--cl-art-peach` #fff1ea, `--cl-art-mint` #ecf6f0, `--cl-mark` #dfe6ff, `--cl-mark-ink` #1d2f99, `--cl-fact-next` #fbf7f4, `--cl-amber-ink` #b4541b, `--cl-paid-wash` #eaf6ef, `--cl-mint-on-ink` #9fe3bd, `--cl-hot` #fde6dc, `--cl-hot-ink` #c2410c, `--cl-miss` #e8a33a, `--cl-sys` #d9f2e3, `--cl-sent` #e9eefc, `--cl-zone-key` #8d8a83, `--cl-zone-empty` #b3afa7, `--cl-receipt-rule` #e4e0d8, `--cl-mock-line` #e3e6ec, `--cl-mock-soft` #f2f3f6, `--cl-mock-hair` #eef0f3, `--cl-mock-ring` #d9dce3, `--cl-mock-radio` #b9bec9, `--cl-mock-text-2` #3f4552, `--cl-ig-a` #f6c39f, `--cl-ig-b` #e98f7b, `--cl-ig-ring` #f0a07c, `--cl-ig-ink` #5a2416, and the closing word pairs `--cl-word-1..6` / `--cl-word-1..6-ink`: #dcefe5/#14523d, #f8e3ea/#9b2347, #f6efe6/#8a5a2b, #e5ecff/#2340c8, #fdefe6/#c2410c, #f8f1dc/#8a6410 (L2:1232).
- **Hex literals live only in `tokens.css`.** The one exception is the sample owners' theme data in `personas.ts` (accent, deep, warm, plus a new `tint`), which plays the part of an owner's theme read from a database, as it does today. Mock owner pages read `--light-ink` (#191f2c), `--light-paper` (#fafbfc) and `--light-muted` (#696e7b), "as on the pages themselves". Transparent tints use `color-mix(in srgb, <token> N%, transparent)`, never OKLCH mixed with white. Masks and shadows say `black`/`white`/`transparent` or `rgba()`, never `#000`/`#fff`.
- **Font sizes stay on `SCALE`** (`packages/ui/src/design-rules.ts`). The board's only off-scale literal is 15.5px (buttons, plan ticks, Who answers), and it becomes 15px (DEVIATIONS row). Headings use the board's `clamp()`s: h1 `clamp(44px,5.6vw,82px)`, `.h2` `clamp(34px,4vw,56px)`, ask strip `clamp(34px,4.4vw,62px)`, lede `clamp(17px,1.5vw,20px)`, `.s2` `clamp(16px,1.4vw,19px)`, price `clamp(60px,6vw,84px)`, calculator total `clamp(44px,5vw,64px)`.
- **Corners:** anything clicked or typed into is `var(--r-pill)` (999px). Curios's own containers (How cards, Who cards, zones, the What lands band, plans, calculator, closing card, popover-like chips) are `var(--r-box)` (16px), where the board draws 18–30px (DEVIATIONS row). Circles are `50%`, and bars and tracks are 999px. Depictions (the owner page cards, the chat phone and its checkout, the Instagram bio, the receipts) keep the board's radii through custom properties named `--mock-r-*` declared at the top of the module that uses them (`--mock-r-page: 36px`, `--mock-r-chat: 30px`, `--mock-r-bio: 20px`, `--mock-r-receipt: 6px`, `--mock-r-s: 10px`, `--mock-r-m: 12px`, `--mock-r-l: 14px`, `--mock-r-xl: 18px`). `findOffRuleRadii` must return `[]` for every new landing module.
- **Layout:** `.wrap` max-width 1248px, padding 0 24px; sections `padding-top: 150px` (96px ≤900px); nav 72px tall, sticky. Breakpoints are the board's: 1100, 900, 700, 640 and 560px.
- **Buttons:** 52px tall, padding 0 26px, 600 weight (`.sm` 40px/0 18px/14.5px, `.xs` 34px/0 14px/13px). Dark is `--calm-ink`/white, hovering to `--calm-ink-deep` with `translateY(-1px)` and `0 10px 20px -10px rgba(0,0,0,.45)`. Lite is white with an `inset 0 0 0 1px var(--calm-ring)` ring that turns `--cl-ring-hover` on hover. `:active` is `scale(.96)` over `.18s cubic-bezier(.3,1.5,.5,1)`.
- **Section label** (`.lbl`): 13px/600, `letter-spacing: .06em`, uppercase through CSS, `--cl-faint`, centred, 16px below. Copy stays in sentence case.
- **Motion** (the board's, all of it off under `prefers-reduced-motion: reduce`, and every `infinite` animation inside `@media (prefers-reduced-motion: no-preference)`):
  - Reveal: opacity .7s ease, transform .8s `cubic-bezier(.2,.8,.2,1)` from `translateY(22px)`, with a stagger delay `--d` (0/100/120/160/200/220/240/300/380ms as marked on the board), triggered by IntersectionObserver with `rootMargin: 0px 0px -8% 0px`.
  - Springs: `cubic-bezier(.34,1.4,.64,1)` (pops), `cubic-bezier(.34,1.2,.64,1)` (name pill), `cubic-bezier(.34,1.15,.64,1)` (deck, .75s), `cubic-bezier(.34,1.3,.64,1)` (toggle thumbs, .4s).
  - Peek: bob 3s, blink 5.2s, hop .5s, happy jump 1s, wave 3.6s; habits every 3.2–7.4s (first after 1.5–5.5s); pupils move at most 4.5px × 3.5px.
- **Server and no-JS frame:** `useReducedMotion()` answers "reduced" on the server and on the first render, so the HTML is every scene's finished frame, fully visible. Motion and reveals start only after mount.
- **Canvas-only switchers:** none on this board. Build nothing that is not in its markup or `boot()`. The `.biz/.bs/.bart/.ph/.wr/.wart/.pl` rules in the board's CSS are leftovers with no markup, so leave them out.
- **SEO and metadata:** unchanged (`landingMetadata`, structured data, the OG image and hreflang). The board does not change them.
- **Shared things the app uses stay put:** `Wordmark.tsx`, `wordmark.module.css`, `structured-data.ts`, `copy.ts`'s `Locale`, `_peek/Peek.tsx` (auth), `landing-tokens.css` (imported by `_auth/AuthShell.tsx`), and everything in `_bento/` (the public page). Delete a landing file only after a grep shows no importer.
- **Dev storage buckets are production R2.** No seeding, no uploads, no `--write`. The landing reads only `getSettings()`.

## Review Focus

- **A visitor without JavaScript, or a crawler:** every section's words and finished frame are in the server HTML, and nothing is held at `opacity: 0`. Test: Task 1 renders `LandingPage` with `renderToString` and expects no `data-rv="wait"`, and expects each section's heading text.
- **The admin changes the price** (RM59 a month, a yearly price with no months free, one free lead): no board figure survives as a literal. Test: Task 10 renders pricing at `raisedSettings()` and at a one-lead, no-months-free `PlanTerms`, in both locales, and expects no "RM49", "−2 months", "Two months free" or "3 free leads".
- **Reduced motion:** every scripted scene shows its finished frame, no timer or pointer listener starts, and Peek's eyes stay put. Test: each scene task has a `reduceMotion()` case that expects the finished frame and `vi.getTimerCount() === 0` after mount, and Task 2 expects no `pointermove` listener.
- **Switching What lands to "I sell products" mid-run:** the service run stops at once and writes nothing into the products chat. Test: Task 8 switches while the service chat is typing, advances 20s of fake time, and expects no Studio Hana message in the log.
- **A long Malay string at 390px** (the Who switcher, the What lands toggle and steps, the claim button): nothing is clipped or pushed past the right edge. Test: Task 13 captures `/ms` at 390 wide and checks every section band by eye. Task 8 also expects the steps row to wrap (`flex-wrap: wrap` ≤640px) in the stylesheet.

---

## Before you start (once)

1. **Worktree.** Work only in `C:/Users/User/Desktop/Projects/curios-calm-landing` on `feat/calm-landing`. Never open, run or kill anything in `C:/Users/User/Desktop/Projects/curios`.
2. **Install and generate:** run `pnpm install`, then `cd packages/db && pnpm prisma generate` (from `packages/db`, never the root).
3. **.env:** diff the variable names of `.env` against `.env.example` and add any that are missing. A stale `.env` makes the server die silently.
4. **Dev server, ports 3100+** (the main folder's servers hold 3000/3001). The landing needs only the web app, because it reads `getSettings()` from the shared dev database: `cd apps/web && node --env-file=../../.env node_modules/next/dist/bin/next dev -p 3100`, run in the background. To stop it, kill only processes whose command line contains `Projects\curios-calm-landing\` (never a bare `curios`), then check that port 3100 is free.
5. **Gates (G).** Run each one alone, never piped, and read the printed exit code:
   ```bash
   pnpm turbo run test --concurrency=1 --force; echo "exit $?"
   pnpm turbo run typecheck --force; echo "exit $?"
   pnpm turbo run lint --force; echo "exit $?"
   ```
   vitest neither typechecks nor loads CSS modules (it stubs them), so the typecheck and the page load below are not optional. Run the web typecheck again after the page has loaded in `next dev`, because page types appear only then.
6. **Screen check (S).** This is a procedure every task runs; set `CHROME="/c/Program Files/Google/Chrome/Application/chrome.exe"` and `SHOTS=<your scratchpad>/shots`.
   1. Load both pages from the running server: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3100/` and the same for `/ms`. Expect `200` twice, and **read the dev server's log** for CSS module errors ("is not pure", "Syntax error"). A `.module.css` selector without a local class (`[data-x] {…}`) passes every gate but breaks `next dev`.
   2. Capture finished frames at the screens' own sizes: `"$CHROME" --headless=new --hide-scrollbars --force-prefers-reduced-motion --virtual-time-budget=5000 --window-size=1440,8042 --screenshot="$SHOTS/desk.png" http://localhost:3100/`, then the same with `--window-size=390,12559` to `phone.png`.
   3. Crop the task's section band from your capture and from `Calm-Landing.desktop.jpg` / `.phone.jpg` (`python -I` with PIL, reading into scratch), and look at the two side by side. Fix whatever the task owns. A deliberate difference gets a DEVIATIONS row. A difference that belongs to another section waits for that section's task.
   4. Check motion in a **viewport** capture without `--force-prefers-reduced-motion` at 1440×900 and 390×844, opened on the section's anchor (`/#who`). A tall capture is fine for finished frames, but entrance animations should be judged only in a viewport capture.
   5. At 390 wide, nothing may be cut at the right edge (the root has `overflow-x: clip`, so overflow hides rather than scrolls).

## Rebase onto `feat/calm-foundation`

This branch starts at 6e67753. When the foundation's Task 3 lands (`git log feat/calm-foundation --oneline` shows "Inter, black pill actions and the calm corners on the shared pieces"), rebase at the next task boundary with a clean tree: `git rebase feat/calm-foundation`. Expect conflicts in these files:

- `packages/ui/src/tokens.css`: both sides add after the calm block. Keep the foundation's lines first and the landing's `--cl-*` block after them. If the foundation declared a name the landing also declares, keep one declaration (the "defines every calm token" test counts them).
- `packages/ui/src/design-rules.test.ts`: both sides add `describe` blocks at the end. Keep both.
- `design/DEVIATIONS.md`: both sides append rows from 313. Keep the foundation's numbers and renumber the landing's rows after them. Then grep `DEVIATIONS [0-9]` and "row [0-9]" in `apps/web/app/_landing` and update the references.
- `apps/web/lib/fonts.ts` should not conflict, because the landing never edits it. After the rebase, grep `font-plex-sans` under `apps/web/app/_landing`: the calm modules must not use it (the foundation may have removed it). If the foundation renamed `--font-inter`, follow the rename in `calm.module.css`.

After the rebase, run `pnpm install`, the gates (G) and the screen check (S) on `/` and `/ms` before the next task. If the foundation has not landed Task 3 by Task 14, finish anyway: the landing needs nothing from it.

## File map

| Board section | Today | Verdict | After |
|---|---|---|---|
| Page scope, shared pieces | `LandingPage.tsx`, `tanya.module.css`, `landing-tokens.css` | restyle / replace | `LandingPage.tsx`, `calm.module.css`, `Reveal.tsx`, `scene.ts`; `tanya.module.css` deleted in Task 14; `landing-tokens.css` trimmed to what auth still reads |
| Peek, alive | `_peek/Peek.tsx` (peeking, auth) | reuse for auth; **new** for landing | `_peek/LivePeek.tsx`, `_peek/live-peek.module.css`, `_peek/peek-life.ts` |
| Nav | `Nav.tsx` (frosted pill) | restyle | `Nav.tsx` ('use client', sticky, frosted when stuck), `nav.module.css` |
| Hero | `Hero.tsx`, `PageCard.tsx`, `Claim.tsx` | restyle | same files, `hero.module.css`, `page-card.module.css`, `claim.module.css`; deck of 3 |
| Ask strip | `AskStrip.tsx` | restyle | `AskStrip.tsx`, `ask.module.css` |
| Who it's for | `Who.tsx` (kinds of owner) | **replace** | `Who.tsx` (same question, five answers), `who.module.css` |
| How it works | `How.tsx`, `HowParts.tsx` (scroll rooms) | **replace** | `How.tsx` (three cards), `how-scenes.tsx` (Paste, Facts, Bio), `how.module.css` |
| What lands in your hands | `WhatLands.tsx`, `Business.tsx`, `order-scene.ts` | **replace** | `Lands.tsx`, `lands-script.ts`, `LandsCheckout.tsx`, `lands.module.css`; the three old files deleted |
| No cut, ever | `NoCut.tsx` (bars) | **replace** | `NoCut.tsx` (two receipts), `nocut.module.css` |
| Pricing | `Pricing.tsx` | restyle | `Pricing.tsx`, `pricing.module.css`; `payback` kept |
| FAQ | `Faq.tsx` | restyle | `Faq.tsx` ('use client', one open at a time), `faq.module.css` |
| Closing | `Closing.tsx` | restyle | `Closing.tsx`, `closing.module.css` |
| Footer | `Footer.tsx`, `FooterPeek.tsx` (giant wordmark) | restyle / delete | `Footer.tsx`, `footer.module.css`; `FooterPeek.tsx` deleted |
| Copy, personas, photos | `copy.ts`, `personas.ts`, `photos.ts` | reuse, reshape | same files; `aina` removed once unused |
| Tests | `landing.test.tsx` (917 lines) | split | page-level stays in `landing.test.tsx`; each section gets its own `<section>.test.tsx`, and old blocks are deleted with their sections |
| Public page helpers | `_bento/*` | untouched | the landing does not import them |

---

### Task 1: The calm page scope, shared pieces, reveal and the scene runner

**Files:**
- Modify: `packages/ui/src/tokens.css` (the `--cl-*` block from Global Constraints)
- Create: `apps/web/app/_landing/calm.module.css`, `apps/web/app/_landing/Reveal.tsx`, `apps/web/app/_landing/scene.ts`
- Modify: `apps/web/app/_landing/LandingPage.tsx`, `apps/web/app/_landing/WhatLands.tsx` (import `play` from `scene.ts`)
- Test: `apps/web/app/_landing/calm.test.tsx`

**Interfaces:**
- Produces (CSS, `calm.module.css`):
  - `.page` is the scope. It sets `--paper: var(--calm-bg); --card: var(--calm-surface); --ink: var(--calm-ink); --muted: var(--calm-muted); --line: var(--calm-line); --surface: var(--calm-soft); --edge: var(--calm-ring); --action: var(--calm-ink); --action-fg: var(--calm-surface); --action-hover: var(--calm-ink-deep)`, plus `background: var(--calm-bg); color: var(--calm-ink); font-family: var(--font-inter), system-ui, sans-serif; font-size: 16px; line-height: 1.5; overflow-x: clip; -webkit-font-smoothing: antialiased`.
  - Shared classes: `.wrap`, `.sec`, `.lbl`, `.h2`, `.s2`, `.hl`, `.btn`, `.dark`, `.lite`, `.sm`, `.xs`, `.wide`, `.fine`, `.srOnly`, `.dotbg` (the dot grid: `radial-gradient(var(--cl-dot) 1.6px, transparent 1.7px)` 22px, masked `linear-gradient(#000, transparent 92%)`; write `#000` as `black` to stay hex-free), `.caret`, `.tdots`, `.rv`.
- Produces (TS):
  - `scene.ts`: `export type Wait = (ms: number) => Promise<void>`; `export function play(run: (wait: Wait) => Promise<void>): () => void` (moved as is); `export interface Scene<S, P> { still(p: P): S; start(p: P): S; run(p: P, set: (s: S | ((prev: S) => S)) => void, wait: Wait): Promise<void> }`; `export function useScene<S, P>(scene: Scene<S, P>, p: P, ref: RefObject<Element | null>, key?: unknown): S`. `useScene` returns `still` when reduced motion is on or IntersectionObserver is missing. Otherwise it returns `start` until the element is in view, plays while in view, and on leaving stops and resets to `start`. A changed `key` stops the current run and starts again.
  - `Reveal.tsx` ('use client'): `export function RevealWatcher(): null`. On mount, if motion is allowed and IntersectionObserver exists, it sets `data-rv="wait"` on every `[data-rv]` element inside `[data-landing]` whose top is below the viewport, then sets `data-rv="in"` when each one intersects. Elements already in view are left alone.
  - Markup contract: a revealed element carries `className={calm.rv}`, `data-rv=""` and optional `style={{ '--d': '120ms' }}`. The CSS rule is `.rv[data-rv='wait']` (with a local class, never bare `[data-rv]`).

- [ ] **Step 1: Write the failing tests** in `calm.test.tsx`:
  ```tsx
  it('maps the calm values onto the base tokens on the landing root', () => {
    const css = read('calm.module.css');
    const page = rule(css, '.page');
    for (const [k, v] of [['--paper','--calm-bg'],['--ink','--calm-ink'],['--line','--calm-line'],['--action','--calm-ink'],['--action-fg','--calm-surface']])
      expect(page).toMatch(new RegExp(`${k}:\\s*var\\(${v}\\)`));
    expect(page).toMatch(/font-family:\s*var\(--font-inter\)/);
  });
  it('defines every calm landing token once', () => { /* each --cl-* name from Global Constraints matches /^\s*NAME:/m exactly once in tokens.css */ });
  it('keeps every calm landing module on the corner rule', () => {
    for (const f of CALM_MODULES) expect(findOffRuleRadii(read(f)), f).toEqual([]);
  });  // CALM_MODULES = ['calm.module.css']; every later task appends its module
  it('draws everything on the server, nothing held for a reveal', () => {
    const html = renderToString(<LandingPage locale="en" terms={TERMS} />);
    expect(html).not.toContain('data-rv="wait"');
  });
  it('holds below-the-fold blocks for their reveal, and shows them in view', () => { /* mock IntersectionObserver; element with top > innerHeight gets data-rv="wait", then "in" after the observer callback fires */ });
  it('reveals nothing when the visitor asks for less motion', () => { /* reduceMotion(); mount; no element gets data-rv="wait" */ });
  it('a stopped scene runs nothing after its pending wait', async () => { /* the existing test, now importing play from ./scene.js */ });
  it('runs every looping animation only for visitors who have not asked for less motion', () => {
    for (const f of CALM_MODULES) expect(read(f).replace(/@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?\n\}/g, '')).not.toMatch(/animation:[^;]*infinite/);
  });
  ```
- [ ] **Step 2: Run** `cd apps/web && npx vitest run app/_landing/calm.test.tsx`. Expect FAIL (no module, tokens or watcher).
- [ ] **Step 3: Implement.** Add the token block. Write `calm.module.css` with the Global Constraints values. Move `play`/`Wait` into `scene.ts` and re-export from `WhatLands.tsx` until Task 8 deletes it. In `LandingPage.tsx`, put `calm.page` on the root next to the existing class, keep `data-landing` and `lang`, and render `<RevealWatcher />` last.
- [ ] **Step 4: Run** the test file. Expect PASS. Then run the gates (G).
- [ ] **Step 5: Screen check (S).** The page now has the warm page colour and Inter everywhere `tanya.module.css` does not override them. Expect no section to have lost content.
- [ ] **Step 6: Commit** `feat(landing): the calm page scope, shared pieces, reveal and one scene runner`.

### Task 2: Peek, alive

**Files:**
- Create: `apps/web/app/_peek/LivePeek.tsx`, `apps/web/app/_peek/live-peek.module.css`, `apps/web/app/_peek/peek-life.ts`
- Test: `apps/web/app/_peek/live-peek.test.tsx`

**Interfaces:**
- Produces (TS, `peek-life.ts`, framework-free):
  - `export type PeekPose = 'idle' | 'whistle' | 'wave'`; `export type PeekMood = 'happy' | 'hop' | 'tilt' | 'squish' | 'blink2' | 'wave2' | 'hands'`.
  - `export function pupilOffset(dx: number, dy: number): { x: number; y: number }`: with `d = hypot(dx,dy) || 1` and `k = min(1, d/260)`, return `x = dx/d*4.5*k` and `y = dy/d*3.5*k - 1`, each rounded to 2 places.
  - `export const HABITS = ['look','tilt','squish','blink2','wave2','hands','look','tilt','hop'] as const`.
  - `export function pickHabit(rand: number, pose: PeekPose): PeekMood | 'look'` returns `HABITS[floor(rand*9)]`, with `wave2` becoming `tilt` when the pose is `whistle`.
  - `export function habitMs(m: PeekMood): number` returns `hop` 520, `wave2` 1900, `tilt` 1500, `happy` 1900, and everything else 800.
  - `export function nextHabitAt(now: number, rand: number, first: boolean): number` returns `now + 1500 + rand*4000` the first time and `now + 3200 + rand*4200` after that.
  - `export function enlist(peek: LivePeekHandle): () => void`. Every live Peek shares one `pointermove` listener (pupils follow the pointer for Peeks within 200px of the viewport, using `pupilOffset` from the eye centre at 50% × 55%) and one 400ms interval for habits. A Peek that is busy (any mood class set) or out of view is skipped. A `look` habit runs the look-around path `[-4.5,0,650],[4.5,-1,700],[0,2.5,500],[0,0]` only if the pointer has been still for 1.5s. The last Peek to leave removes both. Nothing is added under reduced motion.
- Produces (React, `LivePeek.tsx`, **'use client'**): `export interface LivePeekHandle { mood(m: PeekMood, ms?: number): void; look(at: { x: number; y: number } | null): void; el(): SVGSVGElement | null }` and `export function LivePeek(props: { width: number; pose?: PeekPose; follow?: boolean; held?: PeekMood | null; className?: string; ref?: Ref<LivePeekHandle> })`. The full-body SVG uses `viewBox="0 0 160 150"` (L2:593–604), with a unique clip id from `useId`, colours `--biru` and `--light-ink`, and `aria-hidden`. `held` keeps a mood class on while it is set (the pricing card hover).
- CSS (`live-peek.module.css`): `.pk`, `.j`, `.sh`, `.hl`, `.hr`, `.e`, `.p`, `.m`, `.o`, `.n`, the pose classes `.whistle` and `.wave`, and the mood classes `.happy`, `.hop`, `.tilt`, `.squish`, `.blink2`, `.wave2`, `.hands`, with keyframes from L2:46–72 and L2:136–146. Bob, blink, whistle and wave loops go inside `@media (prefers-reduced-motion: no-preference)`.

- [ ] **Step 1: Write the failing tests:**
  ```ts
  expect(pupilOffset(260, 0)).toEqual({ x: 4.5, y: -1 });
  expect(pupilOffset(0, 0)).toEqual({ x: 0, y: -1 });
  expect(pupilOffset(0, 130)).toEqual({ x: 0, y: 0.75 });
  expect(pickHabit(4 / 9, 'whistle')).toBe('tilt');       // index 4 is wave2
  expect(pickHabit(4 / 9, 'idle')).toBe('wave2');
  expect(habitMs('hop')).toBe(520); expect(habitMs('squish')).toBe(800);
  expect(nextHabitAt(0, 0, true)).toBe(1500); expect(nextHabitAt(0, 1, false)).toBe(7400);
  ```
  Then the component cases: `it('two live Peeks on one page have unique clip ids')`; `it('a mood is a class for its time, then gone')` (fake timers: `mood('hop')` adds the class, and it is gone after 520ms); `it('adds no pointer listener and no timer under reduced motion')` (spy on `window.addEventListener`, expect no `'pointermove'`, and `vi.getTimerCount()` is 0); `it('shares one pointer listener between many Peeks')` (render 3, expect 1 `pointermove` registration); `it('moves the pupils toward the pointer')` (fire `pointermove` at 260px right of the centre, expect the `.p` group's `transform` to be `translate(4.50px,-1.00px)`); `it('runs looping animations only without reduced motion')` (the stylesheet check from Task 1); `it('stays on the corner rule')`.
- [ ] **Step 2: Run** `cd apps/web && npx vitest run app/_peek/live-peek.test.tsx`. Expect FAIL.
- [ ] **Step 3: Implement** the three files.
- [ ] **Step 4: Run** the test file and `npx vitest run app/_peek`. Expect PASS (the auth `Peek` tests are untouched). Run the gates (G).
- [ ] **Step 5: Screen check (S), step 1 only.** Nothing renders a LivePeek yet. Load `/` and `/signin` and confirm both are 200 with a clean dev log.
- [ ] **Step 6: Commit** `feat(peek): Peek alive, with eyes on the pointer and small habits`.

### Task 3: Nav and footer

**Files:**
- Modify: `apps/web/app/_landing/Nav.tsx` (becomes 'use client'), `apps/web/app/_landing/Footer.tsx`, `apps/web/app/_landing/copy.ts` (`footer.note`)
- Create: `apps/web/app/_landing/nav.module.css`, `apps/web/app/_landing/footer.module.css`
- Delete: `apps/web/app/_landing/FooterPeek.tsx`
- Test: `apps/web/app/_landing/chrome.test.tsx`; remove the moved and obsolete cases from `landing.test.tsx` ("the footer wordmark carries the full-body Peek", and "frosts the nav pill" from 'the stylesheet')

**Interfaces:**
- Consumes: `calm.module.css` (`.wrap`, `.btn`, `.dark`, `.sm`), `Wordmark`, `LEGAL_DOCS`/`LEGAL_PATH`/`OPERATOR`/`SUPPORT_EMAIL` from `_legal/content.ts`.
- Produces: `Nav({ copy, home })`, the same signature. `<header class="nav">` is sticky with a 72px inner row and gets `data-stuck` once `scrollY > 12` (passive listener, read once on mount). `.nav[data-stuck]` uses `background: color-mix(in srgb, var(--calm-bg) 86%, transparent); backdrop-filter: blur(12px); box-shadow: 0 1px 0 var(--calm-line)` over `.3s`. Links are 15px `--cl-text-2` with a 1.5px ink underline that scales from the left in `.3s cubic-bezier(.2,.8,.2,1)`. On the right: the other language (`BM`/`EN`), Sign in, and `Make your page` (dark `.sm`). Links hide ≤900px, and BM and Sign in hide ≤560px.
- Produces: `Footer({ copy, locale })`. Its grid is `auto 1fr auto`, gap 40px, padding `56px 0 70px`: the wordmark, the section links, then Sign in and the other language's full name (`Bahasa Melayu`/`English`). The note spans the full width (13px `--cl-faint`). Below it, kept from today: the legal links (DEVIATIONS 138) and the operator line from `_legal/content.ts`.

- [ ] **Step 1: Write the failing tests:** `it('sticks the nav and frosts it only once the page has scrolled')` (fire `scroll` with `scrollY` 0 then 40, and expect `data-stuck` absent then present); `it('frosts .nav[data-stuck] and nothing else')` (the backdrop-filter selector list over all `CALM_MODULES` is `['.nav[data-stuck]']`); `it.each(LOCALES)('%s: links the five sections, the other language, sign in and sign up')`; `it.each(LOCALES)('%s: the footer has the wordmark, the sections, sign in, the other language by name, and the note')` (expect the board's note `Every person, shop and order on this page is a made-up sample.`); `it('keeps the Terms, Privacy, Refund and Return links and the operator line')` (the existing assertions moved); `it('stays on the corner rule')` (append both modules to `CALM_MODULES`).
- [ ] **Step 2: Run** `cd apps/web && npx vitest run app/_landing/chrome.test.tsx`. Expect FAIL.
- [ ] **Step 3: Implement.** Grep `FooterPeek` and delete the file once nothing imports it.
- [ ] **Step 4: Run** the test file and `npx vitest run app/_landing`. Expect PASS. Run the gates (G).
- [ ] **Step 5: Screen check (S):** the nav band (top 72px) and the footer band at 1440 and 390. Check stuck frosting in a viewport capture of `/#pricing`.
- [ ] **Step 6: Commit** `feat(landing): the calm nav and footer`.

### Task 4: Hero: the name pill, the deck and the claim field

**Files:**
- Modify: `apps/web/app/_landing/Hero.tsx`, `PageCard.tsx`, `Claim.tsx`, `personas.ts` (`DECK`, Kek Lina's font), `copy.ts` (only if a hero word differs)
- Create: `apps/web/app/_landing/hero.module.css`, `page-card.module.css`, `claim.module.css`
- Modify: `apps/web/app/_peek/peek.test.tsx` (claim fields now carry `LivePeek`)
- Test: `apps/web/app/_landing/hero.test.tsx`; move "reads the rolling name once", "claims an address with a plain GET", "types the answer out" and "moves the deck on" out of `landing.test.tsx` and rewrite them for the new markup

**Interfaces:**
- Consumes: `LivePeek`, `useScene`/`Scene` from `scene.ts`, `PERSONAS`, `photo()`.
- Produces:
  - `DECK: PersonaKey[] = ['aisyah', 'lina', 'hana']` (L2:962).
  - `PageCard({ persona, words, kind, ask, answer, labels })`, restyled to L2:110–142. The card is 300×590 with `--mock-r-page` corners and the owner's `deep` background. The photo covers the top 66% and fades out. The kind chip sits top right. The name is 36px/800 in the owner's font, with the handle in mono 11px under it. Below come the icons, the Links/Ask tab with a sliding thumb (`.35s cubic-bezier(.34,1.3,.64,1)`), the links or the chat (question bubble and answer with a `data-who` label and accent dot), and the ask bar with the accent send button.
  - `heroScene: Scene<HeroState, { reduced: boolean }>` with `HeroState = { front: number; asking: boolean; q: boolean; answer: string; typing: boolean }`. `still` is the front card Aisyah, asked and fully answered. Its `run` (L2:982–989) waits 1700ms (a click on a side card jumps to it), adds `ask`, waits 450 for the question and 650 for the dots, waits 900, types the answer 22ms per character, waits 500 and drops the caret, makes Peek happy for 1900, holds 2300, moves to the next card and waits 500.
  - Deck slots via `data-s` (-2…2): `0` is `translateX(-50%) scale(.84)` at z 3. `±1` is `translateX(calc(-50% ± 252px)) scale(.7)` at z 2 with `saturate(.9) brightness(.97)`. `±2` is `±500px` at scale .7 and opacity 0. At ≤900px the `±1` slots are `±170px` at scale .66 and opacity .5. Transition `.75s cubic-bezier(.34,1.15,.64,1)`. The stage is 560px tall (540 ≤560px). The two stage Peeks (132px; left `whistle`, right `follow`) hide ≤1100px.
  - The name pill: inline-flex, `height: 1.14em`, a vertical column of the three short names, width measured per name plus `.44em`, `background`/`color` set to the front persona's `warm`/`accent`, width `.55s cubic-bezier(.34,1.2,.64,1)`, column `.6s`. The column is `aria-hidden`, and a visually hidden span holds the first name, so the h1's accessible name stays "Don’t read the bio. Ask Aisyah."
  - `Claim({ id, label, placeholder, button, variant })`, the same signature. It is still a GET form to `/signup` with `rememberWantedHandle`. The field is 400px × 56px, a white pill with an `inset 0 0 0 1px var(--calm-ring)` ring that becomes `2px var(--calm-ink)` on focus-within. The prefix is `--cl-hint`, the input 600, the placeholder `--cl-placeholder`, and the button dark at 56px. A 78px `LivePeek` (follow) sits at `right: 34px; top: -58px` behind the field and drops 22px while the input has focus (`.45s cubic-bezier(.34,1.4,.64,1)`); the closing variant has no Peek on the field (L2:871). At ≤560px the field and button go full width. No sparks (DEVIATIONS 14 still applies).

- [ ] **Step 1: Write the failing tests:** `it('reads the rolling name once, as the first page in the deck')`; `it('shows three pages, Aisyah in front')` (`data-s` of 0, 1 and -1); `it('types the answer out on the front page, then moves the deck on')` (fake timers through 1700+450+650+900+22×len+500+2300+500, expect the front `data-s="0"` on Kek Lina); `it('a click on a side page brings it to the front')`; `it('holds the finished frame and starts no timer under reduced motion')`; `it('claims with a plain GET to /signup and remembers the handle')` (moved); `it('Peek ducks while the claim field has focus')` (focus the input and expect the wrapper's `data-typing`); `it('the closing claim field has no Peek on it')`; in `peek.test.tsx`, `it('both claim fields carry Peek')` becomes "the hero claim field carries a live Peek". Append the three modules to `CALM_MODULES`.
- [ ] **Step 2: Run** `cd apps/web && npx vitest run app/_landing/hero.test.tsx app/_peek`. Expect FAIL.
- [ ] **Step 3: Implement.** The hero is `section.hero` with `margin-top: -72px; padding-top: 72px`, a `.dotbg` 620px tall, `.hin` padding `72px 24px 0` (44px top ≤560px), the h1 at `clamp(44px,5.6vw,82px)`/600/-0.045em/1.03, the lede at `margin: 24px auto 62px; max-width: 33em`, and the fine note 13px `--cl-hint` 14px below. Reveal delays: h1 0, lede 120, claim 220, note 300, stage 380.
- [ ] **Step 4: Run** the tests, then `npx vitest run app/_landing app/_peek`. Expect PASS. Run the gates (G).
- [ ] **Step 5: Screen check (S):** the hero band (desktop 0–1180px, phone 0–1240px of the screens). The screens catch the deck on Kek Lina, so compare layout, not which name is in front. Check the typing in a viewport capture.
- [ ] **Step 6: Commit** `feat(landing): the calm hero, its deck of three pages and the claim field`.

### Task 5: Ask strip

**Files:**
- Modify: `apps/web/app/_landing/AskStrip.tsx`
- Create: `apps/web/app/_landing/ask.module.css`
- Test: `apps/web/app/_landing/ask.test.tsx`; delete "has no blur-in, scroll-reveal or blur on the rotating words" from `landing.test.tsx` (superseded by the board's reveal; Open decision 2)

**Interfaces:**
- Produces: `AskStrip({ locale })`. A `section.sec` labelled by the eyebrow holds the label, an `h2` (`clamp(34px,4.4vw,62px)`/600/-0.04em/1.18, max-width 16em) with the lead in ink and the five words as spans, then `.s2`. The interval is `ASK_WORD_MS = 1700`. The active word is `--tag-new-ink` on `--tag-new` with `scale(1.03)`, the others `--cl-ghost`, transitions `.45s` (transform `cubic-bezier(.34,1.4,.64,1)`). Under reduced motion only the first word is lit, as the board's still state shows.

- [ ] **Step 1: Write the failing tests:** `it('lights one word at a time, every 1.7s')` (fake timers, expect `data-on` to move from word 0 to word 1 at 1700ms); `it('lights only the first word, with no timer, under reduced motion')`; `it.each(LOCALES)('%s: the heading reads the lead and the five words')`. Append the module to `CALM_MODULES`.
- [ ] **Step 2: Run** `npx vitest run app/_landing/ask.test.tsx`. Expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it and `npx vitest run app/_landing`. Expect PASS. Run the gates (G).
- [ ] **Step 5: Screen check (S):** the ask strip band.
- [ ] **Step 6: Commit** `feat(landing): the calm ask strip`.

### Task 6: Who it's for: same question, their own answer

**Files:**
- Modify (rewrite): `apps/web/app/_landing/Who.tsx`
- Modify: `apps/web/app/_landing/copy.ts` (replace `who`), `personas.ts` (add `tint` and `role` to each persona)
- Create: `apps/web/app/_landing/who.module.css`
- Test: `apps/web/app/_landing/who.test.tsx`; delete 'who it is for' and 'the floating chat' from `landing.test.tsx`

**Interfaces:**
- Produces (copy): `who: { eyebrow: string; title: [string, string, string]; lede: string; asking: (n: number) => string; questions: [string, string, string, string]; answers: Record<'aisyah'|'daniel'|'farah'|'lina'|'hana', [string, string, string, string]>; roles: Record<…, string>; pageOf: (name: string) => string }`. The English is L2:651–652 and L2:996–1002 exactly, with `title` `['Same question. ', 'Their own', ' answer.']` (the middle part highlighted with `--tag-new`/`--tag-new-ink`). The Malay is in the Copy appendix.
- Produces (data): `Persona.tint` holds Aisyah #eef6f1, Daniel #f6efe6, Farah #fdefe6, Lina #fbeef1 and Hana #f8f1dc (L2:998–1002). `WHO: PersonaKey[] = ['aisyah','daniel','farah','lina','hana']`.
- Produces (scene): `whoScene: Scene<WhoState, { n: number }>` with `WhoState = { q: number; typed: string; thinking: boolean; shown: number }`. `still` is question 0 with all five answers shown. Its `run` (L2:1010–1023) types the question 38ms per character, waits 250 and presses the send button for 150, shows dots on all five for 700, reveals each answer 260ms apart with a `pop`, makes Peek hop for 520, and holds for `SQ_HOLD_MS = 4600` (`SQ_USER_HOLD_MS = 15000` after a click on a question). A click on a question chip jumps to it. The chips are a `role="tablist"` of buttons, matching the board's markup.
- Layout: `.sq-ask` is a 540×62 white pill, 21px/500, with "asking 5 pages" in 14px `--cl-faint` (hidden ≤700px), a 44px ink circle send button, and an 82px Peek at `left:50%; margin-left:286px; top:-34px` (hidden ≤1100px). `.five` is 5 columns (3 ≤1100px, 1 ≤700px), gap 14px, max 1220px. Each card is `var(--r-box)` white with a line ring. The top (`.fc-a`, 178px) is the tint with the white dot grid, a small "{Name}’s page" with an accent dot, and the answer at 15px/500/1.42. The foot has a 36px circle initial in `warm`/`accent`, the name, the role, and the handle in mono 11px. The hover lift is `translateY(-4px)`.

- [ ] **Step 1: Write the failing tests:** `it.each(LOCALES)('%s: one question, five pages, each with its own answer')` (5 cards, and each shows `answers[k][0]`); `it('a question chip shows every page’s answer to it')` (click chip 2 and expect each card's `answers[k][2]` after the run's dots, using fake timers); `it('types the question, then reveals the answers 260ms apart')`; `it('holds 15s after a visitor picks a question')`; `it('shows all five answers to the first question, with no timer, under reduced motion')`; `it('highlights only "Their own"')` (exactly one `.hl` in the section). Append the module to `CALM_MODULES`.
- [ ] **Step 2: Run** `npx vitest run app/_landing/who.test.tsx`. Expect FAIL.
- [ ] **Step 3: Implement.** Write the Malay at the same time (the Copy appendix) so "has the same shape in both languages" stays green.
- [ ] **Step 4: Run** it and `npx vitest run app/_landing`. Expect PASS. Run the gates (G).
- [ ] **Step 5: Screen check (S):** the Who band (desktop ~1740–2400, phone ~1760–3200).
- [ ] **Step 6: Commit** `feat(landing): who it's for, the same question asked of five pages`.

### Task 7: How it works: three cards that play

**Files:**
- Modify (rewrite): `apps/web/app/_landing/How.tsx`
- Create: `apps/web/app/_landing/how-scenes.tsx` ('use client'), `apps/web/app/_landing/how.module.css`
- Delete: `apps/web/app/_landing/HowParts.tsx` (after a grep)
- Modify: `apps/web/app/_landing/copy.ts` (`how`)
- Test: `apps/web/app/_landing/how.test.tsx`; delete 'how it works, pinned' (and its `howAt` import) and "no 01/02/03 watermark" (it now lives in this file as a check that no `roomN` class appears)

**Interfaces:**
- Produces (copy) `how`:
  - `{ eyebrow, title, steps: {title, body}[3], pasted, pastedText, found: (n) => string, facts, approved: (n) => string, factOf, from, usedFor, fix, approve, allApproved: {title, body}, bio: { handle, role, text, link, posts, followers }, chat: { name, handle, q, a, placeholder, time } }`.
  - The English comes from L2:671–700 and L2:1026–1054: title "Ten minutes from blank to bio link", step titles with no full stops, `fix` "Fix it", `approve` "Approve", `found(4)` "4 facts found", `allApproved` "All four approved" / "Your page answers from these, and nothing else.", time "2:14 am", "128 posts", "4.2k followers".
- Produces (scenes, each a `Scene` from `scene.ts`):
  - `pasteScene`: `still` shows all text with all four marks on and "4 facts found" in. Its `run` (L2:1030–1037) types two characters per 16ms, waits 500, lights the marks 420ms apart, shows found, and holds 3600.
  - `factsScene`: `still` shows the "All four approved" card with "4 approved". Its `run` (L2:1043–1052) waits 1300 per fact, presses Approve for 170, sends the card off `translate(70px,-46px) rotate(9deg) scale(.96)` over `.55s cubic-bezier(.3,.9,.3,1.1)`, counts up, shows the done card after 500, and holds 2600. (The board's reduced state shows fact 1; the screens show the done card, so `still` uses the done card.)
  - `bioScene`: `still` is the Curios page with the question, the answer, the time chip and Peek up. Its `run` (L2:1057–1071) moves a tap circle onto the link (`.9s cubic-bezier(.45,0,.2,1)`), presses it, slides the bio away (`.6s cubic-bezier(.65,0,.25,1)`), types the question 30ms per character, presses send, shows the question, the dots and the time chip, types the answer 16ms per character, and makes Peek rise 50px and go happy for 1700. It holds 3800.
- Layout: `.cards3` is 3 columns (1 ≤900px), gap 20px, margin-top 56px. Each card is `var(--r-box)` white with a line ring and lifts 4px on hover. The art is 310px with the white dot grid on `--cl-art-blue`/`--cl-art-peach`/`--cl-art-mint` and a 32px white step circle. The body pads `26px 28px 30px`, h3 22px/600, p 16px muted.

- [ ] **Step 1: Write the failing tests:** `it.each(LOCALES)('%s: three cards with the board’s titles and bodies')`; `it('marks the four facts in what was pasted, then says 4 facts found')`; `it('approves the four facts one by one, then says all four approved')`; `it('taps the link in the bio and the page answers')`; `it('shows every card on its finished frame, with no timer, under reduced motion')`; `it('starts a card only once it is in view')` (mock IntersectionObserver). Append `how.module.css` to `CALM_MODULES`.
- [ ] **Step 2: Run** `npx vitest run app/_landing/how.test.tsx`. Expect FAIL.
- [ ] **Step 3: Implement** with the Malay alongside (Copy appendix).
- [ ] **Step 4: Run** it and `npx vitest run app/_landing`. Expect PASS. Run the gates (G).
- [ ] **Step 5: Screen check (S):** the How band (desktop ~2530–3180, phone ~3200–5000).
- [ ] **Step 6: Commit** `feat(landing): how it works, three cards that play`.

### Task 8: What lands in your hands: the band, the zones and the service chat

**Files:**
- Create: `apps/web/app/_landing/Lands.tsx` ('use client'), `apps/web/app/_landing/lands-script.ts`, `apps/web/app/_landing/lands.module.css`
- Modify: `apps/web/app/_landing/LandingPage.tsx` (render `<Lands>` inside `section#business` in place of `<Business>`), `copy.ts` (replace `whatLands` and `business` with `lands`)
- Delete: `apps/web/app/_landing/WhatLands.tsx`, `Business.tsx`, `order-scene.ts` (after a grep; `play` already lives in `scene.ts`)
- Test: `apps/web/app/_landing/lands.test.tsx`; delete 'the order, played out', 'the order, from the link in bio', 'For business, the steps' and 'what lands in your hands' from `landing.test.tsx`, with their imports (`order-scene.js`, `WhatLands.js`)

**Interfaces:**
- Produces (copy) `lands`:
  - `{ eyebrow, title, lede, switchLabel, empty, service: LandsSide, products: LandsSide, capture: { ask: (n) => string; why: (n) => string; label: string; send: string; sent: (n) => string } }`.
  - `LandsSide = { label: string; steps: string[]; keys: [string,string,string,string]; chat: LandsLine[]; zones: LandsZones }`.
  - Words: L2:704–712 and L2:1080–1104, exactly. The visitor and page chat lines are the same in both languages (they are Malay already).
- Produces (`lands-script.ts`, pure data plus types):
  - `export type LandsLine = { r: 'v'; t: string; step?: number; pick?: number } | { r: 'p'; t: string; step?: number; cards?: LandsCard[]; capture?: string; land?: number[] } | { r: 'add'; i: number; step: number } | { r: 'checkout'; step: number } | { r: 'pay'; step: number } | { r: 'end'; step: number; land: number[] }`.
  - `export const TIMING = { start: 700, typeChar: 22, beforeSend: 240, press: 150, afterVisitor: 500, pickHold: 500, dots: 850, word: 45, cardsHold: 700, captureIn: 400, captureWait: 1100, captureChar: 55, captureSent: 600, afterPage: 500, dot: 650, betweenLands: 380, bump: 900, endHappy: 1900, hold: 4600 } as const`.
  - `export type Side = 'service' | 'products'` and `export function nextSide(current: Side, userChose: boolean): Side`.
- Produces (`Lands.tsx`): `Lands({ locale })`.
  - A toggle (`role="tablist"`, two buttons, a sliding ink thumb sized to the active button, `.4s cubic-bezier(.34,1.3,.64,1)`).
  - The band `.ld`: grid `minmax(0,1fr) 316px minmax(0,1fr)`, areas `"a c b" "d c e"`, gap `28px 60px`, max 1120px, padding `52px 44px`, `var(--r-box)`, background the side persona's `tint` with the white dot grid, `--la` the persona's accent. At ≤1100px it is 2 columns `"c c" "a b" "d e"` with the chat at max 380px. At ≤640px it is 1 column with padding `32px 16px`.
  - Four zones, each with a key (`01`–`04` pill plus a label) and a box (min 168px, empty `Waiting for a chat` over diagonal hatching). When a zone lands, the content staggers in (`--i × 90ms + 180ms`) and pops `scale(1.035)`.
  - The connector SVG paths (dashed `rgba(29,29,27,.18)` that turn solid accent at .55 opacity when landed) and a 12px dot that travels the path over 650ms. Paths and dot hide ≤1100px.
  - The chat phone: 520px tall (540 ≤640px), `--mock-r-chat`, the persona's `deep`. It has a header (avatar photo, name in the owner font, handle), the message log (masked top), and an ask bar with the accent send button.
  - The steps row under the phone (`.lsteps`) wraps ≤640px.
  - An 82px Peek at the phone's top right that aims its pupils at the landing zone (`look()`) and hops when a zone lands.
  - The service side (Studio Hana): visitor line, page reply with two package cards, the visitor picks (the zone 2 suggestion gets the accent ring and ✓), then the page reply with the capture card. The number types 55ms per character, Send presses, and the card turns into "Got it. Studio Hana will message you on WhatsApp." Then the zones land 0, 2, 3, and zone 3's own row count bumps +1.
  - The products side is built in Task 9. Until then the toggle renders it with its finished frame and does not run it.
- Run control: a generation counter (`gen`). Every wait checks it, and a switch increments it, so the old run's next wait never resolves (the `play` contract). After a run, the next side is `nextSide(side, userChose)`.
- Finished frame (server, reduced motion): the service side with the whole chat, all four zones in, and all paths on (L2:1146).

- [ ] **Step 1: Write the failing tests:** `it.each(LOCALES)('%s: one chat, four zones, the service side first')`; `it('lands the suggestion when the page suggests, then the lead, the alert and the questions')` (fake timers; expect zones `data-in` in the order 1, 0, 2, 3); `it('the capture card types the number and says it was sent')`; `it('bumps your own question’s count once it lands')`; `it('switching side mid-run stops the old run: nothing from Studio Hana reaches the Kek Lina chat')` (Review Focus); `it('alternates sides on its own, and stays on the side a visitor picked')` (`nextSide`); `it('draws the finished frame with no timer under reduced motion')`; `it('says which side is on')` (`aria-selected`); `it('wraps the steps on phones')` (the stylesheet has `flex-wrap: wrap` in the ≤640px block). Append the module to `CALM_MODULES`.
- [ ] **Step 2: Run** `npx vitest run app/_landing/lands.test.tsx`. Expect FAIL.
- [ ] **Step 3: Implement**, writing the Malay of every non-chat string alongside (Copy appendix). The capture card's words come from the public page's own capture card for that locale: grep `message you back` under `apps/web/app/[handle]` and `packages/core`, and reuse that copy rather than retyping it.
- [ ] **Step 4: Run** it and `npx vitest run app/_landing`. Expect PASS. Run the gates (G).
- [ ] **Step 5: Screen check (S):** the business band (desktop ~3300–4240, phone ~5000–7400). Check the connector lines and the dot in a viewport capture of `/#business`.
- [ ] **Step 6: Commit** `feat(landing): what lands in your hands, the calm band and the service chat`.

### Task 9: What lands in your hands: products, basket and checkout in the phone

**Files:**
- Create: `apps/web/app/_landing/LandsCheckout.tsx`
- Modify: `apps/web/app/_landing/Lands.tsx`, `lands-script.ts`, `lands.module.css`, `copy.ts` (`lands.products`, `lands.checkout`)
- Test: `apps/web/app/_landing/lands.test.tsx`

**Interfaces:**
- Consumes: Task 8's `LandsLine`, `TIMING`, the generation counter and the zones.
- Produces: `TIMING` gains `{ addWait: 400, addPress: 170, basketIn: 300, basketHold: 1100, toCheckout: 200, sheetIn: 900, scroll: 750, select: 600, fieldChar: 55, fieldGap: 250, banksIn: 700, payPress: 180, paying: 1400, paidHold: 1300 }`.
- Produces: `LandsCheckout({ copy, state })`, where `state: { screen: 'chat'|'checkout'|'paid'; y: number; pickup: boolean; day: boolean; name: string; phone: string; fpx: boolean; bank: boolean; paying: boolean }`. It is pure: the run owns the state. The screens slide `translateX(24px)` to `0` (the old one goes to `-24px`) over `.5s cubic-bezier(.2,.8,.2,1)`. The checkout sheet's inner scroll is a transform over `.7s cubic-bezier(.45,0,.2,1)`. The words are L2:733–748 exactly (Kek coklat 1kg RM95, Pickup Seksyen 7 Free, Delivery RM10, days Fri 20/Sat 21/Sun 22/Tue 24, "1 day’s notice · closed Monday", name Aida, 012-345 6789, FPX with Maybank2u, CIMB Clicks, Public Bank and RHB Now, E-wallet, Card, DuitNow QR, "Pay RM95", "Pay RM95 with Maybank2u", "Taking you to pay", "Paid. Order placed", code 7Q4M). The Malay comes from the real checkout's own copy: grep `apps/web/app/[handle]/shop/checkout`.
- The products side (Kek Lina, L2:1092–1104): visitor line, page reply with two product cards whose buttons read "Add to basket". The add presses card 0 ("In your basket", `--cl-sys`/`--cl-hl-green-ink`), and the basket bar rises ("1 item · RM95", Checkout). Then come checkout, pickup, Sat 21, the name and phone typed, FPX, Maybank2u, Pay, the spinner and the paid screen. Zones land 1 on the suggestion and 0, 2, 3 at the end.

- [ ] **Step 1: Write the failing tests:** `it('adds the cake, shows the basket, and checks out inside the phone')`; `it('picks pickup and Saturday, types Aida and her number, pays by FPX with Maybank2u')` (expect "Pay RM95 with Maybank2u" before the press); `it('ends on the paid screen with the order code, and lands the paid order')` (zone 0 shows "Order #16 · Aida" and "Paid · FPX"); `it('switching back to the service side mid-checkout leaves no checkout screen behind')`; `it('the products side’s finished frame is the paid order in all four zones')`.
- [ ] **Step 2: Run** `npx vitest run app/_landing/lands.test.tsx`. Expect FAIL on the new cases.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it and `npx vitest run app/_landing`. Expect PASS. Run the gates (G).
- [ ] **Step 5: Screen check (S):** a viewport capture of `/#business` with "I sell products" chosen (open `http://localhost:3100/#business` in a normal Chrome window, at 1440 and in device mode at 390, and click it). Compare against the board opened in Chrome. The screens show only the service side.
- [ ] **Step 6: Commit** `feat(landing): what lands in your hands, the cake bought and paid inside the chat`.

### Task 10: No cut, ever: two receipts

**Files:**
- Modify (rewrite): `apps/web/app/_landing/NoCut.tsx`
- Modify: `apps/web/app/_landing/copy.ts` (`noCut`), `LandingPage.tsx` (`NoCut` no longer takes `monthly`)
- Create: `apps/web/app/_landing/nocut.module.css`
- Test: `apps/web/app/_landing/nocut.test.tsx`; delete 'no cut, ever' from `landing.test.tsx`

**Interfaces:**
- Produces (copy): `noCut: { eyebrow, title, sub, market: { title, ref, line, fees: [string,string][], keep }, curios: { title, ref, line, commission, bank: [string,string], keep, stamp }, incl: { kicker, title, body }[3], fine }`. Words: L2:757–783 exactly. The figures are fixed sample receipts (5% RM5.00, ~4% RM4.00, 2.16% RM2.16, and FPX RM1.00 via CHIP), and they are not prices from `PlanTerms`.
- Produces: `export function keepAfter(start: number, fees: number[]): number[]`, the running totals [95, 91, 88.84] from 100 and [5, 4, 2.16], to the sen.
- Produces (scene): `receiptsScene`. `still` shows both printed, every fee in, the stamp in, the marketplace dimmed, and RM88.84 / RM99.00. Its `run` (L2:1206–1213) waits 500, prints the marketplace receipt (`clip-path` `1.1s cubic-bezier(.6,0,.3,1)`) and waits 900. For each fee it adds the line, waits 250, counts down over 380ms in 24 steps and waits 250. Then it dims and waits 500, prints the Curios receipt and waits 900, adds the commission row (`--cl-paid-wash`) and waits 700, stamps 0% (`rotate(-12deg) scale(2.4)` to `scale(1)` over `.35s`) with a Peek hop and waits 600, adds the bank fee, counts 100 to 99, makes Peek happy for 2000, and holds 9000.
- Layout: two 360px receipts in `--mock-r-receipt`, mono 13.5px, with a scalloped bottom edge (radial-gradient). The marketplace one is `rotate(-2.5deg) translateY(26px)` and the Curios one `rotate(1.5deg)`, both straightened ≤900px. A 96px Peek sits beside them. Below, three columns with line dividers (one column ≤900px), then the fine print at 28px.

- [ ] **Step 1: Write the failing tests:** `expect(keepAfter(100, [5, 4, 2.16])).toEqual([95, 91, 88.84])`; `it.each(LOCALES)('%s: two receipts, the marketplace keeping RM88.84 and Curios RM99.00')` (finished frame); `it('prints the receipts in turn and stamps 0%')`; `it('no motion and no timer under reduced motion')`; `it('the fine print keeps the fee assumptions')`. Append the module to `CALM_MODULES`.
- [ ] **Step 2: Run** `npx vitest run app/_landing/nocut.test.tsx`. Expect FAIL.
- [ ] **Step 3: Implement** with the Malay alongside.
- [ ] **Step 4: Run** it and `npx vitest run app/_landing`. Expect PASS. Run the gates (G).
- [ ] **Step 5: Screen check (S):** the no-cut band (desktop ~4380–5140).
- [ ] **Step 6: Commit** `feat(landing): no cut, ever, as two receipts`.

### Task 11: Pricing

**Files:**
- Modify: `apps/web/app/_landing/Pricing.tsx`, `copy.ts` (`pricingEn`, `pricingMs`)
- Create: `apps/web/app/_landing/pricing.module.css`
- Test: `apps/web/app/_landing/pricing.test.tsx`; move 'pricing' and 'pricing, at the prices the admin set' out of `landing.test.tsx`

**Interfaces:**
- Consumes: `PlanTerms`, `payback(orders, aov, monthlyCost)` (kept as is).
- Produces (copy changes, board words with live figures):
  - `title: [line1, line2]` is `['Free to be asked.', `${monthlyText} when you’re selling`]`, rendered with a `<br>`.
  - `business.noteYearly` is `${Capital(inWords(months))} months free. That’s ${annualAMonthText} a month.` when `months` is set, and otherwise `${annualAMonthText} a month, paid once a year.`
  - `calc.pays(percent, times)`: at `times >= 1.5` it is "Business costs about P% of that. It pays for itself N times over."; at `1 <= times < 1.5` it is "Business costs about P% of that. It pays for itself."
  - `calc.under(oneMoreCovers: boolean)`: when true, "One more order and it pays for itself."; otherwise the current line.
  - `fine` is "Business is paid by FPX, e-wallet or card, through CHIP. The calculator is an illustration, not a forecast."
  - `payment` stays for Billing: grep it before changing anything.
- Layout:
  - The toggle is a white pill with a line ring and an ink thumb; the active text is white and "−N months" is `--tag-ok-ink`, turning `--cl-mint-on-ink` when active.
  - Plans are 2 columns (1 ≤900px), gap 20px, `var(--r-box)` white, padding 34px (22px ≤560px), min-height 560px.
  - Business has `0 0 0 2px var(--calm-ink)` and a 96px Peek at `right:28px; top:-58px` that is held happy while the card is hovered.
  - The price is `clamp(60px,6vw,84px)`/600/-0.05em. On a switch it slides out `translateY(-12px)` and fades over 180ms, then comes back.
  - Ticks are 18px `--tag-ok-ink` strokes that draw in (`stroke-dashoffset` 24 to 0 over `.5s`, delay `i × 90ms + 300ms`, on reveal).
  - The chip `.o` is `--cl-art-peach`/`--cl-amber-ink`.
  - The calculator: range 1–60 at 5, typical RM50/RM95/RM150 at RM95, the total `clamp(44px,5vw,64px)`, green and ink bars on white, inside a `--calm-soft` box.

- [ ] **Step 1: Write the failing tests** (the moved ones, plus): `it.each(LOCALES)('%s: the title breaks after the first sentence and carries the price in force')`; `it('says N months free and the price a month, when yearly is on')`; `it('never prints RM49, −2 months or 3 free leads at other prices')` (Review Focus: render at `raisedSettings()` and at `{ ...TERMS, prices: { MONTHLY: 5900, ANNUAL: 70800 }, freeLeads: 1 }` in both locales, and expect the text not to match `/RM49\b|−2 months|Two months free|3 free leads|−2 bulan/`); `it('says one more order pays for it only when one more order does')`; `it('Peek is happy while the Business card is hovered')`. Append the module to `CALM_MODULES`.
- [ ] **Step 2: Run** `npx vitest run app/_landing/pricing.test.tsx`. Expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it and `npx vitest run app/_landing app/app/billing`. Expect PASS. Run the gates (G).
- [ ] **Step 5: Screen check (S):** the pricing band (desktop ~5280–6480). Toggle Yearly in a viewport capture.
- [ ] **Step 6: Commit** `feat(landing): calm pricing, the board's words at the prices in force`.

### Task 12: FAQ and closing

**Files:**
- Modify: `apps/web/app/_landing/Faq.tsx` (becomes 'use client'), `Closing.tsx`, `copy.ts` (`closing`)
- Create: `apps/web/app/_landing/faq.module.css`, `closing.module.css`
- Test: `apps/web/app/_landing/faq-closing.test.tsx`

**Interfaces:**
- Produces: `Faq({ copy })`, the same props. The grid is `420px 1fr` with gap 60px (one column ≤1100px, the heading centred). The heading is `Asked before.` / `Answered here.` split on the first full stop, with a 124px whistling Peek under it (80px centred ≤1100px). The rows have 1px line borders. Each question is a button (19px/600, padding 24px 0) with a plus that rotates into a minus (`.35s cubic-bezier(.34,1.4,.64,1)`). Answers open with `grid-template-rows` `0fr` to `1fr` over `.45s cubic-bezier(.2,.8,.2,1)`. The first is open, only one is open at a time, `aria-expanded` follows, and Peek hops on open. Every answer stays in the DOM (collapsed rows, never removed), so crawlers and FAQPage stay true without any change at mount (no layout shift).
- Produces: `Closing({ locale })`. It is a white `var(--r-box)` card with a line ring, margin-top 150px (96px ≤560px), padding `80px 24px 96px` (`56px 16px 64px` ≤560px), and a `.dotbg` masked from the bottom. It holds a 124px waving Peek, the label `closing.label` ("Tanya je." in both locales), an h2 "One page for" with a word pill that rolls through `closing.words` every 2000ms only while in view (colours `--cl-word-n`/`--cl-word-n-ink`), the claim (`variant="end"`, no Peek) and the note.
- Copy: `closing.title` is renamed `closing.label` with the value `'Tanya je.'` in both locales (Open decision 3). The OG image does not read it: grep first.

- [ ] **Step 1: Write the failing tests:** `it('opens the first answer, and one at a time')`; `it('renders every answer on the server for crawlers')` (`renderToString` contains every answer); `it('keeps FAQPage structured data equal to the questions shown')` (moved); `it.each(LOCALES)('%s: the closing reads Tanya je. and One page for, with the claim')`; `it('rolls the word every 2s while in view, and not under reduced motion')`. Append both modules to `CALM_MODULES`.
- [ ] **Step 2: Run** `npx vitest run app/_landing/faq-closing.test.tsx`. Expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it and `npx vitest run app/_landing`. Expect PASS. Run the gates (G).
- [ ] **Step 5: Screen check (S):** the FAQ and closing bands (desktop ~6580–7860).
- [ ] **Step 6: Commit** `feat(landing): calm FAQ and closing`.

### Task 13: /ms: the Malay landing, checked end to end

**Files:**
- Modify: `apps/web/app/_landing/copy.ts` (`MS`)
- Modify: `design/DEVIATIONS.md` (the Malay row)
- Test: `apps/web/app/_landing/landing.test.tsx` ('copy')

**Interfaces:**
- Consumes: every `MS` key the section tasks added.
- Produces: no new keys. Every Malay string is final in the existing register (casual, polite "anda", English loanwords as `MS` already uses them: lead, chat, checkout, freelancer).

- [ ] **Step 1: Write the failing tests** in `landing.test.tsx` → 'copy': `it('carries no English sentence on /ms outside the chat lines and brand words')`. Walk `COPY.ms` with `words()`, skipping `lands.*.chat`, `who.answers.*[3]` and persona names, and expect no string to match `/\b(the|your|and|with|you)\b/i`. Also `it('every new Malay heading matches the appendix')` checks the headings against the Copy appendix table.
- [ ] **Step 2: Run** `npx vitest run app/_landing/landing.test.tsx`. Expect FAIL wherever a section task left English or a draft in `MS`.
- [ ] **Step 3: Implement.** Fix the strings. Add the DEVIATIONS row: "Landing (calm): Malay | The board is English only | Malay drafted by an AI for Who, How, What lands, No cut, Pricing and the closing, in copy.ts's register; the chat lines stay as written | DESIGN.md needs a Malay speaker's copy | Owner reads it (as for row 10)".
- [ ] **Step 4: Run** the gates (G).
- [ ] **Step 5: Screen check (S) on `/ms`** at 1440 and 390, every band. This is the Review Focus check for long Malay at 390: the Who chips, the What lands toggle and steps, the pricing toggle, and both claim buttons. Confirm `lang="ms"` on the root, that the nav reads `EN`, and that the footer reads `English`.
- [ ] **Step 6: Commit** `feat(landing): the calm landing in Malay`.

### Task 14: Remove the old landing, the README and the deviations

**Files:**
- Delete: `apps/web/app/_landing/tanya.module.css`, and every `_landing` file with no importer left (grep each: `HowParts.tsx`, `FooterPeek.tsx`, `brand-colors.ts` only if the OG image no longer reads it, which it does today, so keep it)
- Modify: `apps/web/app/_landing/landing-tokens.css` (delete every `--tj-*`/`--l-*` token that no `.css`/`.tsx` under `apps/web/app` still reads; keep the rest for `AuthShell`), `personas.ts` and `photos.ts` and `copy.ts` (remove `aina` and its photos if unused), `apps/web/app/_landing/README.md`, `design/DEVIATIONS.md`
- Test: `apps/web/app/_landing/landing.test.tsx`

**Interfaces:**
- Produces: `landing.test.tsx` holds only page-level cases: one h1, the nav anchors, `lang`, structured data and its escaping, metadata and hreflang, copy shape, banned words, no em dashes, no Instagram import, no slice 18 markers, brand colours. Every section's cases live in its own file.

- [ ] **Step 1: Write the failing tests:** `it('no landing module imports tanya.module.css')` (it reads every `_landing/*.tsx` and expects no `tanya.module.css`); `it('landing-tokens.css declares only tokens something reads')` (every `--x:` declared in it is found as `var(--x` somewhere under `apps/web/app`).
- [ ] **Step 2: Run** `npx vitest run app/_landing/landing.test.tsx`. Expect FAIL.
- [ ] **Step 3: Implement.**
  - Delete the unused pieces.
  - Rewrite the README's section table for the calm build (nine sections, the files from the file map, scene and Peek notes, the reveal contract, "claims to make true": the Hot tag, the ping and "Not in your services yet" are still unbuilt, so row 249 still applies).
  - Add these DEVIATIONS rows: container corners 16px against the board's 18–30px; 15.5px set at 15px; prices from `PlanTerms`; the calculator's below-cost line; the footer note without "Photos from Unsplash." (Open decision 4); the skip link kept.
  - Mark the landing rows that described removed sections **Superseded by the calm landing (row N)**: 11, 12, 16, 146, 188, 189, 190, 195, 246, 248, 250–256 and 288–291. Keep 14, 15, 138, 225, 226 and 249.
- [ ] **Step 4: Run** the gates (G) and the design-rules tests: `cd packages/ui && npx vitest run src/design-rules.test.ts; echo "exit $?"`.
- [ ] **Step 5: Final screen check (S)** of `/` and `/ms`, every band, at 1440 and 390, against both screens. Load `/signin` and `/app` (signed out redirects) to prove nothing shared broke. Then measure on Linux only: build `Dockerfile.web` (`docker build -f Dockerfile.web -t curios-web-calm-landing .`), run it on port 3200, and run Lighthouse 13.5.0 mobile against `http://localhost:3200/`. The baseline is 84, CLS 0, LCP 4.0s (`devDocs/deferred-findings.md`). Record the numbers in the README. A CLS above 0 is a bug to fix before merging. Never measure a Windows build.
- [ ] **Step 6: Commit** `chore(landing): drop the old landing styles, and record the calm build`.

---

## Copy appendix: Malay for the new strings

The English is the board's own text, at the line numbers in each task. These drafts are in `copy.ts`'s existing register, and the owner reads them (Task 13's row). A key that already has Malay in `MS` keeps it (`hero`, `askStrip`, `faq`, `nav`, the closing words and note, the footer note, the What lands switch labels).

| Key | Malay |
|---|---|
| `who.title` | `['Soalan sama. Jawapan ', 'mereka sendiri', '.']` |
| `who.lede` | Setiap halaman kenal pemiliknya, dan tiada yang lain. Tanya lima daripadanya soalan yang sama. |
| `who.asking(5)` | tanya 5 halaman |
| `who.questions` | Free bulan ni? · Berapa harga? · Kat mana? · Boleh WhatsApp? |
| `who.answers.aisyah` | Ya, tinggal dua slot bulan ni. Satu potret ambil masa lebih kurang seminggu. · Potret dari RM250. Kulit buku dari RM900. · Ipoh, dan saya ambil klien dari mana-mana secara online. · *(4th as the board)* |
| `who.answers.daniel` | Saya boleh mula 1 Januari. Notis saya sebulan. · Saya cari RM7,000 hingga RM8,500 sebulan. Boleh bincang. · Kuala Lumpur. Hybrid di KL atau PJ, atau remote sepenuhnya. · *(4th as the board)* |
| `who.answers.farah` | Kelas Sabtu 8 pagi ada tiga tempat. Pelan online boleh mula bila-bila hari. · Pelan online RM150 sebulan. Kelas sekali datang RM35. · Kelas di Taman Tun. Pelan online boleh dari mana-mana. · *(4th as the board)* |
| `who.answers.lina` | Tempahan hujung minggu tutup Khamis malam. Ambil hari Sabtu masih ada. · Kek coklat 1kg RM95. Kek batik RM45. · Seksyen 7, Shah Alam. Hantar ke Klang RM15. · *(4th as the board)* |
| `who.answers.hana` | Slot projek kami yang seterusnya buka pertengahan Januari. · Starter dari RM1,800. Branding penuh dari RM3,800. · Bangsar, KL. Kami ambil klien di seluruh Malaysia. · *(4th as the board)* |
| `who.roles` | Ilustrator · Pembangun frontend · Jurulatih kecergasan · Pembuat kek rumah · Studio branding |
| `how.title` | Sepuluh minit dari kosong ke link bio |
| `how.steps[].title` | Beritahu tentang anda · Luluskan yang betul · Letak link dalam bio |
| `how.found(4)` / `fix` / `approve` | Jumpa 4 fakta / Betulkan / Luluskan |
| `how.allApproved` | Keempat-empat diluluskan / Halaman anda jawab dari fakta ini, dan tiada yang lain. |
| `how.bio` | Ilustrator · Ipoh · 128 hantaran · 4.2k pengikut |
| `how.chat` | q: Ambil tempahan November? · a: Ya, tinggal dua slot untuk November. Potret dari RM250. · time: 2:14 pagi |
| `lands.title` / `lede` | Apa yang anda dapat / Satu chat di halaman anda. Empat perkara yang anda boleh guna. |
| `lands.service.keys` | Lead, sudah ditapis · Pakej anda, dicadangkan · Dimaklumkan bila penting · Apa yang orang selalu tanya |
| `lands.products.keys` | Pesanan, sudah dibayar · Produk anda, dicadangkan · Dimaklumkan bila penting · Apa yang orang selalu tanya |
| `lands.*.steps` | Tanya · Cadang · Nombor · Lead / Tanya · Tambah · Checkout · Bayar · Pesanan |
| `lands.empty` | Menunggu chat |
| `noCut.title` / `sub` | Setiap jualan milik anda / Kek RM100 yang sama, dijual dua cara. Baca resitnya. |
| `noCut` receipt lines | Yuran platform 5% · Komisen ~4% · Yuran transaksi 2.16% · Anda dapat · Komisen Curios · Yuran bank (FPX, oleh CHIP) |
| `noCut.incl` | Ganti laman web / RM2,000+ untuk bina / Tambah lebih kurang RM420 setahun untuk hosting. Halaman anda ialah laman webnya. · Ganti borang gateway / CHIP atau QR anda sendiri / Sambung CHIP untuk FPX, e-dompet dan kad. Atau terima DuitNow QR. · Ganti orang SEO / Dijumpai di Google / Tajuk, pratonton dan peta laman, disediakan untuk anda. |
| `pricing.title` | `['Percuma untuk ditanya.', `${monthlyText} bila anda menjual`]` |
| `pricing.business.noteYearly` | `Percuma ${inWords(months)} bulan. Itu ${annualAMonthText} sebulan.` |
| `pricing.calc.pays`, 1–1.5× | Bisnes kosnya kira-kira P% daripada itu. Ia bayar balik sendiri. |
| `pricing.calc.under(true)` | Satu tempahan lagi dan ia bayar balik sendiri. |
| `pricing.fine` | Bisnes dibayar dengan FPX, e-dompet atau kad, melalui CHIP. Kalkulator ini contoh, bukan ramalan. |
| `closing.label` | Tanya je. |

## Open decisions

These are rulings already taken in this plan. The owner should confirm or overturn each one.

1. **Container corners.** The board draws the landing's cards, plans, band and closing at 18–30px. The calm rule says containers are 16px. *Ruling:* 16px for Curios's own containers, the board's radii for the depicted owner pages, phones, receipts and the Instagram bio. *Recommend* keeping that ruling, because the calm section says "one rule everywhere". One DEVIATIONS row.
2. **Scroll reveal is back.** The 23 Oct "less template" pass banned scroll reveal, and the calm board brings it back (`.rv`, 22px). *Ruling:* follow the board (the calm section wins over older notes), with content visible without JS and nothing hidden on the server. The old test is deleted.
3. **"Tanya je." in the closing.** DEVIATIONS 16 was the owner's own change to "Curious? Just ask". The board now labels the closing "Tanya je." over "One page for …". *Ruling:* the board's words win (settled), on both `/` and `/ms`. Flagged because it reverses an owner change.
4. **"Photos from Unsplash."** in the footer note. The repo's photos were supplied by the owner on 16 Oct, and their source is not recorded. *Ruling:* leave the sentence out until the owner confirms the photos are from Unsplash. One DEVIATIONS row.
5. **Section labels are uppercase again.** DEVIATIONS 195 and the 23 Oct pass set sentence case at 15px. The board sets 13px uppercase with tracking. *Ruling:* the board's look. The copy stays in sentence case and CSS uppercases it.
6. **Legal links and the operator line in the footer.** These are not on the board. *Ruling:* keep them (row 138 and the operator line are legal needs).
7. **15.5px.** It is off `SCALE`. *Ruling:* 15px. The alternative is adding 15.5px to `SCALE` with a comment, as was done for 52/54/64.
8. **Below-cost calculator line.** The board says "One more order and it pays for itself." even where that is false (for example at a raised price). *Ruling:* show it only when one more typical order covers the plan, and otherwise keep today's line.
9. **Dark mode on the landing.** The calm section builds dark mode for the app and says the mapping applies elsewhere "later". *Ruling:* the landing stays light.
10. **Kek Lina's name font** is Outfit on the board and Fraunces in the repo. *Ruling:* Outfit, as on the board (it is the sample owner's theme).
