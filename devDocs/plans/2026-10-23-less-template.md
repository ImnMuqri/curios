# Less template, fixed stale copy: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** build the 23 Oct 2026 design update: For business starts on the link in bio, and a pass that removes the template look (icon squares, stat cards, blobs and grain, landing effects) and fixes stale copy.

**Architecture:** visual and copy changes only, one commit per task; no schema, API or payment changes.

**Tech Stack:** Next.js 15 + React 19, CSS Modules, Vitest + Testing Library.

**Spec:** `design/HANDOFF.md` sections "Update, 23 Oct 2026: less template, fixed stale copy" and the For business bullet added under "Elsewhere → Landing, For business"; the boards in `design/boards`. **What changed is exactly `git diff 1e5774a 259ed8f -- design/`** — read that diff for the board you touch; it is the spec delta. Screenshots in `design/screens` are older than this update; go by the board HTML.

## Global Constraints

- Copy SVGs, colours, spacing and copy exactly from the boards. Don't redesign. Every departure gets a row in `design/DEVIATIONS.md` (next free number: 190).
- This update overrides anything older in HANDOFF.
- The "second pass" commit (plain nav, single hero phone, underline tabs, Peek on system pages) was reverted — do not build it.
- Remove what the update removes completely (markup, CSS, keyframes, dead helpers, their tests), not just hide it.
- Every CSS selector carries a local class; colours only through tokens; reduced motion still respected.
- English and Malay copy for bilingual pages (the landing, the public page). The dashboard is English.
- Never run Prettier over whole files; keep each file's style.
- Before each commit: `pnpm turbo run typecheck lint test --concurrency=1 --force` (exit status, never piped; 0 failed, 0 cached) and `NEXT_DIST_DIR=.next-build pnpm --filter @curios/web build` (exit 0), then `git checkout -- apps/web/next-env.d.ts apps/web/tsconfig.json`. Load the changed pages on the running dev server (http://localhost:3000; never start or stop it).

## Review Focus

1. **Reduced motion and the For business timer** — the new first step (5.8 s) and the link-in-bio → shop transition still pause on hover, jump on click, and show a static frame with reduced motion. Pinned in Task 1.
2. **A removed effect leaves dead CSS or a broken layout** (e.g. a blob container with padding, a grain overlay's stacking context). Pinned in Tasks 1 and 2 by screenshots.
3. **Plain replies on light previews stay readable** (label and text colours on white/pale panels). Pinned in Task 3.

---

### Task 1: Landing

**Files:** `apps/web/app/_landing/*` (Business.tsx, order-scene.ts, Hero.tsx, Closing.tsx, How.tsx, Who.tsx, copy.ts EN + MS, tanya.module.css, landing-tokens.css) + tests; `design/DEVIATIONS.md`.

- [ ] **Step 1: Tests** — For business: the customer phone starts on the link in bio (Links tab) with the Shop link first, the cursor taps it, the shop opens; first step duration 5800 ms (the rest unchanged); the Shop link's thumbnails as the board draws them. Landing: no "01/02/03" watermark numbers; no curved marquee; no blur-in/scroll-reveal on headings and no blur on the rotating words; section labels are sentence case (not mono uppercase); no label above the hero headline; no blob/grain elements in the hero and closing sections; the Business card says "A shop paid by FPX, e-wallet, card or your own QR" (and its Malay mirror).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** from `git diff 1e5774a 259ed8f -- design/boards/TanyaJe.dc.html` and the HANDOFF bullets. Update DEVIATIONS row 1 if the pricing line changes.
- [ ] **Step 4: Run** → PASS; gates + build; capture `/` and `/ms` at 390 and 1440, and the For business section at its first and third steps.
- [ ] **Step 5: Commit** `feat(landing): less template, and For business starts on the link in bio`.

### Task 2: The app without the template look

**Files:** the dashboard screens the update names — Settings rows, Store and My Curios section titles, Alerts ("Where else it shows"), Leads list and "What they're after", the Orders / Questions / Leads stat rows, the Store and My Curios preview panels, Review, and the system pages (`apps/web/app/_system/*`) — plus tests; `design/DEVIATIONS.md`.

- [ ] **Step 1: Tests** — no tinted icon square before the named rows and section titles (text only); Orders, Questions and Leads show their three numbers in one row split by thin dividers, with no icon tiles and no sparklines; no blob/grain elements in the Store and My Curios preview panels, Review, or the system pages (SystemShell).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** from `git diff 1e5774a 259ed8f -- design/boards/{Settings,Store,MyCurios,Alerts,Leads,Orders,Questions,Review,System}.dc.html`. Remove the sparkline code and its data if nothing else uses it (the QuestionAsk logging stays — it feeds other things; check). DEVIATIONS rows for anything kept.
- [ ] **Step 4: Run** → PASS; gates + build; capture the changed screens with the dev account where reachable.
- [ ] **Step 5: Commit** `feat(app): text-only rows, plain stat lines, and no blobs or grain`.

### Task 3: Plain AI replies in the app previews

**Files:** the previews in Alerts, the Leads conversation, Questions, Review, the Facts & sources tester and My Curios (`apps/web/app/app/**`, and `packages/ui/src/chat/*` if they share it) + tests.

- [ ] **Step 1: Tests** — in each named preview the page's reply is plain text with the small "{Name}'s page" label above it, never a bubble; the customer's question may stay a bubble; readable on light panels.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** from the boards' diffs (Alerts, Leads, Questions, Review, Knowledge, MyCurios) and the public page's reply style (`packages/ui/src/chat/ChatMode.module.css` `.turn`, built in the shopfront plan) — reuse it rather than restyle each preview.
- [ ] **Step 4: Run** → PASS; gates + build.
- [ ] **Step 5: Commit** `feat(app): the previews' replies read as plain text`.

### Task 4: Stale copy

**Files:** Billing (conversation limit), Store's readiness checklist, My Curios's shop toggle, any preview still showing a Shop tab + tests.

- [ ] **Step 1: Tests** — Billing shows the conversation limit as 200 where the board said 2,000 (it must come from the real cap, not a literal — check `usage.cap` and fix only the copy that hard-codes 2,000 if any); Store's checklist shows "Online payments through CHIP" when CHIP is connected; My Curios's toggle reads "Shop link · Shown first in your links"; no preview shows a Shop tab.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** from the boards' diffs (Billing, Store, MyCurios).
- [ ] **Step 4: Run** → PASS; gates + build.
- [ ] **Step 5: Commit** `fix(copy): the limit is 200, CHIP in Store's checklist, and the shop link toggle`.
