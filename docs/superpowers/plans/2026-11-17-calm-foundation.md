# Calm Foundation and App Frame Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the dashboard (and the auth screens that share its tokens) the calm look: warm neutrals, Inter, black pill actions, the one corner rule, the calm dark mode, and the Dash board's frame, without changing what any customer sees.

**Architecture:** The app already swaps tokens per scope: `app-frame.module.css` maps `--dark-*` onto the base tokens on the dashboard frame only, and previews of customer pages (`data-island`) take the `--light-*` values back. This plan uses the same seam. New `--calm-*` values go in `tokens.css`; a calm scope on the app frame and the auth shell maps them onto `--paper`, `--ink`, `--line`… Owners' public pages and emails never enter the scope, so they keep their look. Role tokens (`--action`, `--r-box`) replace direct uses of `--biru` for buttons and of ad-hoc radii, and design-rule tests hold the line.

**Tech Stack:** Next.js 15 app router, CSS modules, `next/font`, vitest + Testing Library, `packages/ui` design rules (`design-rules.ts`).

**Spec:** `design/HANDOFF.md` → "Start here: the calm redesign (14 Nov 2026)" on branch `design-digital-products` (commit `b237f29`), board `design/boards/Dash.dc.html`, screens `design/screens/Calm-Dash-*.jpg`. A local copy of the boards is in `.superpowers/calm/` (git-ignored); line numbers below refer to `.superpowers/calm/Dash.html`.

## Global Constraints

- Look: quiet and flat; colour only where it carries meaning (status tags, money, stops).
- Font: Inter for the app and auth; headings weight 600, big titles `letter-spacing: -0.045em`; body 400–500; mono (IBM Plex Mono) stays for codes and handles. The wordmark stays Bricolage.
- Corners: anything clicked or typed into is `999px`; containers (cards, panels, popovers, sheets, banners, tables) are `16px`; circles stay `50%`; grouped fields share one box.
- Light tokens: page `#fbfaf7`, surface `#ffffff`, ink `#1d1d1b`, muted `#6f6d68`, line `#ece9e3`, soft `#f4f2ed`, input ring `#e2ded6`, badge `#b5294e`.
- Dark mapping: page `#151514`, surface `#1f1f1d`, soft `#262624`, line `#2e2d2a`, input ring `#3a3936`, ink `#f2f0ea`, muted `#a3a09a`; primary button `#f2f0ea` bg with `#151514` text; pastel tag fills keep their hue, dark (green `#e6f3ec` → `#1f3928`).
- Status tags: `t-ok` `#e3f3ea`/`#1d7a4c`, `t-wait` `#fdf0d8`/`#a1640c`, `t-new` `#e5ecff`/`#2340c8`, `t-grey` soft/muted, `t-red` `#fbe3ea`/`#b5294e` (Dash.html:816).
- Hex literals live only in `packages/ui/src/tokens.css` (`design-rules.test.ts`). Font sizes stay on `SCALE`.
- The owner's page preview and every customer page keep the owner's own theme, in light and dark.
- Motion: screens fade up 8px, popovers scale from 0.98, lists stagger; all of it off under `prefers-reduced-motion`.
- Do not build the canvas-only switchers (the "Plan state" picker).
- Every departure from the board goes in `design/DEVIATIONS.md`.

## Review Focus

- Dark mode on the My Curios preview: the phone preview must keep the owner's colours, never the calm dark ones. Test: Task 2 asserts `[data-island]` re-maps `--paper`/`--ink` to `--light-*` inside the calm dark scope.
- An owner with no cookie and a dark OS: the first paint must already be dark (no light flash). Test: Task 5 renders the layout with no cookie and `prefers-color-scheme: dark` and asserts `data-theme="system"` reaches the frame, with the CSS media rule present.
- A long account name and email in the sidebar card: they must truncate, not push the sidebar wider. Test: Task 4 asserts the card's text has `text-overflow: ellipsis` and `min-width: 0` in the stylesheet.
- A badge count of 100 or more: it reads `99+` everywhere (sidebar, bell, dock). Test: Task 4 and Task 6 render 150 and expect `99+`.
- Keyboard use of the account menu and notifications: Escape closes and focus returns to the opener. Test: Task 4 and Task 6.

---

### Task 1: Calm tokens and role tokens

**Files:**
- Modify: `packages/ui/src/tokens.css`
- Modify: `packages/ui/src/design-rules.ts` (add `findOffRuleRadii`)
- Test: `packages/ui/src/design-rules.test.ts`

**Interfaces:**
- Produces (CSS): `--calm-bg`, `--calm-surface`, `--calm-ink`, `--calm-muted`, `--calm-line`, `--calm-soft`, `--calm-ring`, `--calm-badge`; their dark twins `--calm-dark-*` with the Global Constraints values; tag pairs `--tag-ok`, `--tag-ok-ink`, `--tag-wait`, `--tag-wait-ink`, `--tag-new`, `--tag-new-ink`, `--tag-red`, `--tag-red-ink` and `--calm-dark-tag-*`; role tokens `--action`, `--action-fg`, `--action-hover` (default `--biru`/`--paper`/`--biru-deep`, so nothing changes until a scope sets them), `--r-box: 16px`, `--r-pill: 999px`.
- Produces (TS): `findOffRuleRadii(css: string): string[]` returns every `border-radius` value that is not `999px`, `50%`, `var(--r-box)`, `var(--r-pill)`, `0`, `inherit`, or a `var(--btn-radius)`-style custom property.

- [ ] **Step 1: Write the failing tests** in `design-rules.test.ts`: `it('defines every calm token, light and dark')` reads `tokens.css` and expects each name above to be declared once; `it('finds radii off the calm rule')` expects `findOffRuleRadii('a{border-radius:12px}b{border-radius:999px}c{border-radius:var(--r-box)}')` to equal `['12px']`.
- [ ] **Step 2: Run** `cd packages/ui && npx vitest run src/design-rules.test.ts` — expect FAIL (tokens missing, function undefined).
- [ ] **Step 3: Add the tokens** to `tokens.css` under a comment naming the handoff section, and implement `findOffRuleRadii`.
- [ ] **Step 4: Run** the same command — expect PASS; also `npx vitest run` in `packages/ui` stays green.
- [ ] **Step 5: Commit** `feat(ui): the calm tokens, light and dark, and the corner rule check`.

### Task 2: The calm scope on the app frame and auth shell

**Files:**
- Modify: `apps/web/app/app/app-frame.module.css` (the frame root and its dark block)
- Modify: `packages/ui/src/shell/Shell.module.css` (auth and onboarding shell root)
- Test: `apps/web/app/app/dark-mode.test.ts` (extend), `packages/ui/src/shell/Shell.test.tsx` (extend or create)

**Interfaces:**
- Consumes: Task 1 tokens.
- Produces: inside `.frame` (and the shell root) the base tokens resolve to calm values: `--paper: var(--calm-bg)`, `--card: var(--calm-surface)`, `--ink: var(--calm-ink)`, `--muted: var(--calm-muted)`, `--line: var(--calm-line)`, `--surface: var(--calm-soft)`, `--edge: var(--calm-ring)`, `--ground: var(--calm-bg)`, `--nav-on: var(--calm-surface)`, `--action: var(--calm-ink)`, `--action-fg: var(--calm-surface)`, `--action-hover: #000` via a token (`--calm-ink-deep`). In the dark block the same names take `--calm-dark-*`; `--action` becomes `--calm-dark-ink`, `--action-fg` `--calm-dark-bg`. `[data-island]` keeps taking `--light-*` back, unchanged.

- [ ] **Step 1: Write the failing tests:** in `dark-mode.test.ts`, `it('maps the calm values onto the base tokens on the frame')` reads the stylesheet and expects `--paper:\s*var\(--calm-bg\)` and `--action:\s*var\(--calm-ink\)` inside `.frame {…}`; `it('maps the calm dark values in dark mode, and the preview island keeps the owner light')` expects `--paper:\s*var\(--calm-dark-bg\)` in the dark block and the existing `[data-island]` rule still mapping `--paper` to `var(--light-paper)`.
- [ ] **Step 2: Run** `cd apps/web && npx vitest run app/app/dark-mode.test.ts` — expect FAIL.
- [ ] **Step 3: Implement** the mappings (update the existing `--dark-*` mapping to point at `--calm-dark-*`; keep the `--dark-*` tokens only where something outside the frame still uses them, else delete them).
- [ ] **Step 4: Run** the test, then `npx vitest run app/app` — expect PASS.
- [ ] **Step 5: Commit** `feat(app): the dashboard and auth take the calm tokens`.

### Task 3: Inter, black pill actions, and the corner rule on shared pieces

**Files:**
- Modify: `apps/web/lib/fonts.ts` (drop `IBM_Plex_Sans` once Step 3's grep shows no consumer), the frame/shell font variable
- Modify: `packages/ui/src/button/Button.module.css`, `packages/ui/src/field/Field.module.css`, `apps/web/app/app/_ui/{pill-tabs,popover,toast,alert-slot,page-head,empty-state,inbox,editor}.module.css`, `apps/web/app/app/panel.module.css`, `apps/web/app/auth.module.css`, `apps/web/app/_auth/scene.module.css`
- Test: `packages/ui/src/design-rules.test.ts` (new cases)

**Interfaces:**
- Consumes: Task 1 (`--action*`, `--r-box`, `--r-pill`, `findOffRuleRadii`), Task 2 scope.
- Produces: shared CSS that reads `--action`, `--action-fg`, `--r-box`, `--r-pill`. `--font-body` inside the calm scope resolves to `--font-inter`; page titles in `page-head` are 48px/600/-0.045em on desktop (Dash.html:796) and step down on phone.

- [ ] **Step 1: Write the failing tests** in `design-rules.test.ts`: `it('paints primary actions with --action, not --biru, in the app and auth')` globs the files listed above plus `apps/web/app/app/**/*.module.css` and `apps/web/app/_auth/*.css`, and expects no `background:\s*var\(--biru\)` outside an allow-list naming the brand marks (Peek, the wordmark, `t-new` tags); `it('keeps the shared pieces on the calm corner rule')` runs `findOffRuleRadii` on the shared files listed above and expects `[]`.
- [ ] **Step 2: Run** `cd packages/ui && npx vitest run src/design-rules.test.ts` — expect FAIL listing the offenders.
- [ ] **Step 3: Implement:** swap each primary-action `var(--biru)` for `var(--action)` (text `var(--action-fg)`, hover `var(--action-hover)`); set the shared radii to `var(--r-pill)` for controls and `var(--r-box)` for containers; point the scope's `--font-body` at Inter; set page-head title sizes. Page modules outside the shared list may still fail the radius check: that is the page-by-page phase, and the radius test only covers the shared list.
- [ ] **Step 4: Run** the design-rules tests, `cd apps/web && npx vitest run`, `npm run typecheck`, `npm run lint` — expect all PASS.
- [ ] **Step 5: Screenshot check:** run the app (`pnpm dev`), sign in as the seeded owner, capture `/app/curios`, `/app/orders`, `/app/settings` at 1440×900 and 390×844, light and dark, and compare with `Calm-Dash-mycurios`, `-orders`, `-settings` (`.desktop`/`.phone`, `-dark`). Note differences that belong to page tasks; fix any that belong to tokens or shared pieces.
- [ ] **Step 6: Commit** `feat(app): Inter, black pill actions and the calm corners on the shared pieces`.

### Task 4: Sidebar and account menu

**Files:**
- Modify: `apps/web/app/app/app-frame.tsx`, `apps/web/app/app/app-frame.module.css`
- Modify: `apps/web/app/app/_ui/theme-switch.tsx` (becomes `DarkModeRow`: one switch, on/off)
- Test: `apps/web/app/app/app-frame.test.tsx`

**Interfaces:**
- Consumes: `ThemeContext` (`theme: 'system' | 'light' | 'dark'`, `choose(theme)`), `PlanBlock`, `NavBadges`.
- Produces: `DarkModeRow()` — a `role="switch"` labelled "Dark mode"; checked when the resolved theme is dark; pressing it calls `choose('dark' | 'light')` (an explicit choice; `system` stays the default until the first press). Sidebar per Dash.html:719–731: wordmark; the account card (`who4`: initial avatar, name, "{first name} · {plan}") as a button opening the account menu; groups Page (My Curios, Store), Inbox (Orders, Questions, Leads), Knowledge (Review, Facts & sources), Account (Billing, Settings); pill links (`nv`, 38px, `999px`), count chips; current page white with line and soft shadow.
- Account menu (popover, `16px`, scale-from-0.98): name and email; conversations used this month with a bar and the plan with "Manage" → `/app/billing`; Settings, Help & support, Dark mode row, Sign out.

- [ ] **Step 1: Write the failing tests** in `app-frame.test.tsx`: `it('opens the account menu from the sidebar card, with usage, plan, and the four items')`; `it('closes the account menu on Escape and gives focus back to the card')`; `it('switches dark mode from the account menu')` (expects `choose('dark')` then `choose('light')`); `it('shows 99+ for a count of 150')`; `it('marks the current page')` (`aria-current="page"` on My Curios at `/app/curios`); `it('truncates a long name in the card')` (stylesheet has `text-overflow: ellipsis` and `min-width: 0` on the card text).
- [ ] **Step 2: Run** `cd apps/web && npx vitest run app/app/app-frame.test.tsx` — expect FAIL.
- [ ] **Step 3: Implement** in `app-frame.tsx`/`.module.css`. Remove the top bar's name-and-plan cluster (the account card replaces it) and the old three-way theme control.
- [ ] **Step 4: Run** the test file and `npx vitest run app/app` — expect PASS.
- [ ] **Step 5: Commit** `feat(app): the calm sidebar, with the account menu and dark mode in it`.

### Task 5: Dark mode follows the device until chosen, with no flash

**Files:**
- Modify: `apps/web/app/app/theme.ts`, `apps/web/app/app/layout.tsx`, `apps/web/app/app/app-frame.module.css`
- Test: `apps/web/app/app/layout.test.tsx`, `apps/web/app/app/dark-mode.test.ts`

**Interfaces:**
- Consumes: `THEME_COOKIE = 'curios_theme'`, `parseTheme(value): Theme`.
- Produces: the frame root carries `data-theme` = the cookie's value or `system`; the stylesheet applies the calm dark block for `[data-theme='dark']` and for `[data-theme='system']` inside `@media (prefers-color-scheme: dark)`. No change to the cookie name, so existing choices survive.

- [ ] **Step 1: Write the failing tests:** `layout.test.tsx` → `it('renders data-theme="system" with no cookie and the stored choice with one')`; `dark-mode.test.ts` → `it('applies calm dark for system under a dark device setting')` (the media block exists and maps `--paper` to `--calm-dark-bg`).
- [ ] **Step 2: Run** both — expect FAIL where the media mapping or attribute is missing (skip any assertion that already passes and note it).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run app/app` — expect PASS.
- [ ] **Step 5: Commit** `feat(app): dark mode follows the device until the owner picks`.

### Task 6: Top bar, notifications, plan banners, phone menu, help panel

**Files:**
- Modify: `apps/web/app/app/app-frame.tsx`, `apps/web/app/app/app-frame.module.css`, `apps/web/app/app/_ui/alert-slot.tsx`, `apps/web/app/app/_ui/alert-slot.module.css`, `apps/web/app/app/help/help.module.css`
- Test: `apps/web/app/app/app-frame.test.tsx`, `apps/web/app/app/_ui/alert-slot.test.tsx`

**Interfaces:**
- Consumes: `alertsFor(...)`, `writeBellSeen(value)`, `BELL_COOKIE`, the existing help context (`help-context.tsx`).
- Produces:
  - Top bar (Dash.html:733–734): Help text link and the bell (36px circle, badge `--calm-badge`, `99+`).
  - Notifications (Dash.html:903–965): popover from the bell on desktop, bottom sheet on phone; sections "Waiting on you" (orders, questions, leads, facts) and "Heads up" (plan alerts); each row a link to its page; "Mark all as read" clears only the badge (writes the bell-seen cookie), rows stay; empty state "Nothing needs you right now."
  - Plan banners (Dash.html:1077–1082): `AlertSlot` renders one banner: icon or count badge, title, one line, one button, ×; tones `info` (blue), `warn` (amber), `stop` (red); `16px`. Mapping: 1 or 2 of 3 free leads used → info on Leads; free leads used → warn on Leads; near the chat limit → warn on Questions; free orders used → stop on Orders; plan ended → stop on Billing.
  - Phone menu under 1100px (Dash.html:883–902): tabs Page, Store, Orders, Questions, More; only the active tab shows its label; one spring drives the pill and tab widths (leading edge faster than trailing); icon scales to 0.84 on press; More opens a sheet with staggered items; hides on scroll down, returns on scroll up; badges `99+`.
  - Help panel (Dash.html:1062–1075): 420px panel from the right, bottom sheet on phone, restyled only (behaviour unchanged).

- [ ] **Step 1: Write the failing tests:** `it('opens notifications from the bell, in two sections, each row a link')`; `it('marks all as read without removing the rows')`; `it('says Nothing needs you right now when empty')`; `it('closes notifications on Escape and returns focus to the bell')`; `alert-slot.test.tsx` → `it('maps each plan state to its banner tone')` (table-driven over the five rows above, expecting `data-tone`); `it('shows only the active tab label in the phone menu')`; `it('hides the phone menu on scroll down and shows it on scroll up')` (fire `scroll` with increasing then decreasing `scrollY`, expect `data-away`).
- [ ] **Step 2: Run** `cd apps/web && npx vitest run app/app/app-frame.test.tsx app/app/_ui/alert-slot.test.tsx` — expect FAIL.
- [ ] **Step 3: Implement.** Spring motion is CSS (`cubic-bezier(.3,1.7,.5,1)` as on the board) and is disabled under `prefers-reduced-motion`.
- [ ] **Step 4: Run** `npx vitest run app/app`, then the Task 3 screenshot check for the bell open, a banner of each tone (`Calm-Dash-banner-*`), the phone menu and the More sheet (`Calm-Dash-more-menu`), light and dark.
- [ ] **Step 5: Commit** `feat(app): the calm top bar, notifications, plan banners, phone menu and help panel`.

### Task 7: Our two additions, restyled, and the deviations

**Files:**
- Modify: `apps/web/app/app/curios/curios.module.css` (`.styleTiles`, `.styleTile`, `.styleMini`), `apps/web/app/app/curios/appearance-editor.tsx` (four tiles, layout only)
- Modify: `apps/web/app/app/settings/settings.module.css` (`.pushTest`), `apps/web/app/app/settings/page.tsx` (Notify this device as a card group like "Email me when")
- Modify: `design/DEVIATIONS.md`
- Test: `apps/web/app/app/curios/appearance-editor.test.tsx`, `apps/web/app/app/settings/push-device.test.tsx`, `packages/ui/src/design-rules.test.ts`

**Interfaces:**
- Consumes: the calm scope and role tokens.
- Produces: the Buttons picker shows Soft, High contrast, Chunky and Outline as four calm tiles (white, 1px line, `16px`, the chosen one with an ink ring), two across on phone, four across on desktop, each mini preview in the owner's accent. Notify this device sits in its own 16px card group under "Email me when", its switch and "Send a test" (`lite` pill) styled like the email rows.

- [ ] **Step 1: Write the failing tests:** `it('keeps the four button style tiles on the calm corner rule')` (`findOffRuleRadii` on the tile rules → `[]`); the existing editor and push-device tests stay as they are (behaviour unchanged) and must pass after.
- [ ] **Step 2: Run** — expect FAIL on the radius check.
- [ ] **Step 3: Implement**, then add two rows to `DEVIATIONS.md`: "Dash: My Curios → Buttons has four styles (board shows Soft and High contrast)" and "Dash: Settings has Notify this device (not on the board)", each with what the board shows, what was built, and why (rows 311 and 312 hold the feature history).
- [ ] **Step 4: Run** the three test files and a screenshot of `/app/curios` and `/app/settings`, light and dark.
- [ ] **Step 5: Commit** `feat(app): the button styles and Notify this device in the calm look`.
