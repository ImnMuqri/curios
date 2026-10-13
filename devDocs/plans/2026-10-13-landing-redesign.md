# Landing redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** rebuild `curios.my/` and `/ms` in Berkira's calm and motion — two scroll-pinned moments, a Lenis smooth scroll, lighter type — on our own colour bands, with the slice 17 shop given its own section and a demo visitors can try.

**Architecture:** every section renders its finished state on the server; small client components enhance it. Pinned moments are CSS `position: sticky` stages inside tall sections, with GSAP ScrollTrigger tweening one CSS variable, `--p` (0→1), scrubbed; CSS and a little React read `--p`. Lenis smooths the scroll and drives GSAP's ticker. GSAP and Lenis load by dynamic import from `app/_landing/` only.

**Tech Stack:** Next.js 15 App Router, React 19, CSS Modules, `gsap` (with `gsap/ScrollTrigger`), `lenis`, Vitest + Testing Library.

**Spec:** [`devDocs/landing-redesign-design.md`](../landing-redesign-design.md) — read it first. Also read `apps/web/app/_landing/README.md` (how the landing is built today) and `devDocs/DESIGN.md` (banned list; landing exemption).

## Global Constraints

- Palette: only existing tokens (`tokens.css`, `landing-tokens.css`). No hex outside token files; no `backdrop-filter`; no gradients behind a headline; no shadows separating bands.
- Band map (spec "The page"): nav `--paper`; hero `bandMuda`; How it works `bandSurface`; paid moment `bandBiru`; shop `bandPaper`; trust `bandKuning`; quiet parts `bandSurface`; pricing `bandPaper` (Business card `bandBiru`); FAQ `bandSurface`; closing `bandInk`.
- Display type: Bricolage Grotesque at **600–700** (`--l-weight-display: 700`), tracking `--l-tracking-display: -0.03em`; body IBM Plex Sans; data IBM Plex Mono.
- `gsap` and `lenis` are imported **only** from files in `apps/web/app/_landing/`, and only through `motion.ts`'s dynamic `loadMotion()`.
- Reduced motion (`prefers-reduced-motion: reduce`) or no JavaScript: no Lenis, no pinning, no load-in, no scrub; every scene shows its finished state; reveals show immediately.
- All captions are in the DOM in reading order; motion changes what is visible, never what a screen reader reads.
- Every claim is one the product makes true today (`copy.ts`'s header rule). Leads arrive **by email with a one-tap WhatsApp reply**; the shop's basket arrives **as a WhatsApp message**; no DuitNow/orders claims (slice 18).
- Both languages, same shape (`LandingCopy`); Malay written, not translated; no em dashes in visitor copy (existing test); banned words (existing test).
- Links on the landing may only go to `/`, `/ms`, `/signin`, `/signup`, `#main`, `#how`, `#pricing`, `#faq` (existing test); exactly two `curios.my/` claim forms.
- Verification: `pnpm --filter @curios/web test`, `typecheck`, `lint`, each read by exit status; final gates `pnpm turbo run test|typecheck|lint --concurrency=1 --force`.

## Review Focus

1. **A visitor who reaches the page mid-way** (reload halfway down, or a `#pricing` link): pinned scenes must compute their state from the current scroll, not assume they start at 0. Pinned in Task 4 and Task 6 (scene set to the progress of an already-scrolled section on mount).
2. **Reduced motion turned on**: no Lenis instance, no ScrollTrigger, finished states. Pinned in Tasks 2, 4, 6.
3. **The in-page nav links with Lenis running**: `#pricing` must land on Pricing, not overshoot into a pinned section's spacer. Pinned in Task 3 (`scrollToSection` called with the target; native fallback when no Lenis).
4. **A phone-width screen**: the hero's captions and phone fit 360px without horizontal scroll; the paid moment runs vertically. Pinned by CSS rules named in Tasks 4/6 and checked by hand in Task 10.
5. **The shop demo never leaves the page**: tapping its order button shows the message panel; no `wa.me` link is rendered on the landing. Pinned in Task 7.

---

## File map

| File | Responsibility |
|---|---|
| `_landing/motion.ts` (+ test) | `prefersReducedMotion()`, `loadMotion()` (dynamic import of gsap, ScrollTrigger, Lenis), registers ScrollTrigger once |
| `_landing/timeline.ts` (+ test) | `HERO_TIMELINE`, `PAID_TIMELINE`, `heroAsked(p, total)`, `paidStepAt(p)`, `captionAt(p, bounds)` — pure |
| `_landing/SmoothScroll.tsx` (+ test) | Starts Lenis + GSAP ticker when motion allowed; `scrollToSection(href)` |
| `_landing/useScrub.ts` | Hook: tweens `--p` on a section with ScrollTrigger scrub; returns nothing; no-op on reduced motion |
| `_landing/HeroScene.tsx`, `hero.module.css` | Pinned hero (replaces Hero + Storm + StormStage) |
| `_landing/HowItWorks.tsx`, `how.module.css` | Three cards (replaces Setup) |
| `_landing/LeadPhones.tsx` | The two phones for a given step, extracted from LeadsStory |
| `_landing/PaidMoment.tsx`, `paid.module.css` | Pinned paid moment (replaces Leads + LeadsStory) |
| `[handle]/shop/shop-view.tsx` | Optional `onOrder`, `showBack`, `storageKey` props |
| `_landing/ShopDemo.tsx`, `ShopSection.tsx`, `shop.module.css` | The shop section and its demo |
| `_landing/QuietParts.tsx`, `quiet.module.css` | Three tiles |
| `_landing/copy.ts`, `demo.ts` | New copy keys, demo shop items; old keys removed in Task 9 |
| `_landing/Header.tsx`, `SectionLinks.tsx`, `header.module.css` | Solid paper nav; links via `scrollToSection` |
| `_landing/landing-tokens.css`, `landing.module.css` | Type weight/tracking; `bandPaper`/`bandSurface` confirmed |
| `_landing/Trust.tsx`, `Pricing.tsx`, `Faq.tsx`, `Closing.tsx` (+ css) | Restyled; Closing on `bandInk` |
| `_landing/LandingPage.tsx` | New section order + `SmoothScroll` |
| `_landing/landing.test.tsx` | Updated for the new sections |
| `_landing/README.md`, `devDocs/DESIGN.md` | Docs |

**Deleted in Task 9:** `Hero.tsx`, `HeroDemo.tsx`, `Storm.tsx`, `StormStage.tsx`, `storm.module.css`, `Leads.tsx`, `LeadsStory.tsx`, `leads.module.css` (styles needed by LeadPhones move to `paid.module.css` in Task 6), `Setup.tsx`, `setup.module.css`.

---

### Task 0: Branch and baseline

- [ ] **Step 1:** `git switch -c redesign/landing`
- [ ] **Step 2:** `pnpm --filter @curios/web test; echo "EXIT: $?"` → `EXIT: 0`. If not, stop and report.
- [ ] **Step 3:** Record the landing's first-load JS before any change: `pnpm --filter @curios/web build > <scratchpad>/build-before.log 2>&1; echo "EXIT: $?"` and save the lines for `/` and `/ms` (route table "First Load JS"). If the build needs env vars it lacks, run it with `set -a; source <(grep -v '^MAIL_FROM' ../../.env); set +a` first; if it still cannot build, record why and continue (Task 10 reports the gap).

---

### Task 1: Copy and demo data for the new sections

**Files:** Modify `apps/web/app/_landing/copy.ts`, `demo.ts`; Test `landing.test.tsx` (existing copy tests cover shape/em-dash/banned words).

**Interfaces — Produces (added to `LandingCopy`; old keys stay until Task 9):**

```ts
heroScene: {
  /** Caption 2 and 3; caption 1 is hero.title + hero.sub. */
  problem: string;
  fix: string;
  scrollCue: string;
};
how: { title: string; steps: Step[] /* exactly 3 */ };
paid: {
  title: string;      // section heading (visually the first caption)
  closing: string;    // "That's what RM39 pays for."
  progressLabel: string; // accessible name for the progress line
};
shopSection: {
  title: string;
  points: string[];   // exactly 3
  demoNote: string;   // "A demo shop. Kek Lina is not a real shop."
  messageTitle: string; // heading over the message panel
  orderButton: string;  // the demo's order button
};
quiet: { title: string; tiles: Step[] /* exactly 3 */ };
```

`Demo` (demo.ts) gains `items: ShopDemoItem[]` where:

```ts
export interface ShopDemoItem {
  id: string;
  name: string;
  description: string | null;
  photoUrl: string | null;
  priceCents: number | null;
  options: { id: string; label: string; priceCents: number }[];
}
```

and `LOOK` gains nothing (the hero passes the shop tile itself).

- [ ] **Step 1: Failing test** — append to `landing.test.tsx`'s `describe('copy')`:

```ts
it('has the new sections in both languages, with the counts the layout expects', () => {
  for (const copy of [en, ms]) {
    expect(copy.how.steps).toHaveLength(3);
    expect(copy.quiet.tiles).toHaveLength(3);
    expect(copy.shopSection.points).toHaveLength(3);
    expect(copy.heroScene.problem.length).toBeGreaterThan(0);
    expect(copy.paid.closing).toMatch(/RM39/);
  }
});

it('sells the shop only as it exists today: a basket sent to WhatsApp, nothing about paying', () => {
  for (const copy of [en, ms]) {
    const text = JSON.stringify(copy.shopSection);
    expect(text).toMatch(/WhatsApp/);
    expect(text).not.toMatch(/DuitNow|FPX|receipt|resit/i);
  }
});

it('gives the demo shop the three items the spec lists, priced in sen', () => {
  for (const demo of [DEMO_EN, DEMO_MS]) {
    expect(demo.items.map((i) => i.priceCents ?? i.options.map((o) => o.priceCents))).toEqual([[9500, 17000], 2500, 3850]);
  }
});
```

Run: `pnpm --filter @curios/web exec vitest run app/_landing/landing.test.tsx; echo "EXIT: $?"` → FAIL (properties undefined).

- [ ] **Step 2: Add the copy.** In the `LandingCopy` interface add the block above. In `en`:

```ts
heroScene: {
  problem: 'Forty people. One question.',
  fix: 'Answer it once. Your page answers the rest.',
  scrollCue: 'Scroll to see it answer',
},
how: {
  title: 'Three steps from your price list to answers.',
  steps: [
    { title: 'Paste your link, or your price list', body: 'It reads your website or the text you paste. Instagram can’t be read, so paste what’s on it instead.' },
    { title: 'Tick what’s right', body: 'Every fact it found waits for you. Nothing is said until you approve it.' },
    { title: 'Put one link in your bio', body: 'curios.my/keklina answers from then on, day and night.' },
  ],
},
paid: {
  title: 'What Business does at 11:42 at night.',
  closing: 'That’s what RM39 pays for.',
  progressLabel: 'How far through the lead you are',
},
shopSection: {
  title: 'Your prices on a shelf. Their order in your WhatsApp.',
  points: [
    'One price, or sizes with their own prices',
    'The chat quotes your shelf’s prices',
    'The basket arrives as a WhatsApp message',
  ],
  demoNote: 'A demo shop. Kek Lina is not a real shop.',
  messageTitle: 'This is what Lina would get on WhatsApp',
  orderButton: 'See the order message',
},
quiet: {
  title: 'The quiet parts that save you later.',
  tiles: [
    { title: 'Malay, English or rojak', body: 'It answers in the language the customer used.' },
    { title: 'FAQ pages from real questions', body: 'Questions asked three times or more, with your answer, become pages Google can find.' },
    { title: 'Works with any bio link', body: 'Instagram, TikTok, WhatsApp Business, a QR on your counter.' },
  ],
},
```

In `ms`:

```ts
heroScene: {
  problem: 'Empat puluh orang. Satu soalan.',
  fix: 'Jawab sekali. Page anda jawab selebihnya.',
  scrollCue: 'Scroll untuk tengok ia jawab',
},
how: {
  title: 'Tiga langkah dari senarai harga ke jawapan.',
  steps: [
    { title: 'Tampal link, atau senarai harga', body: 'Ia baca laman web anda atau teks yang anda tampal. Instagram tak boleh dibaca, jadi tampal apa yang ada di situ.' },
    { title: 'Tanda yang betul', body: 'Setiap fakta yang dijumpai tunggu anda. Tiada apa disebut sampai anda luluskan.' },
    { title: 'Letak satu link di bio', body: 'curios.my/keklina jawab lepas tu, siang dan malam.' },
  ],
},
paid: {
  title: 'Apa Bisnes buat pukul 11:42 malam.',
  closing: 'Itulah yang RM39 bayar.',
  progressLabel: 'Sejauh mana anda dalam cerita lead ini',
},
shopSection: {
  title: 'Harga anda di rak. Tempahan mereka di WhatsApp anda.',
  points: [
    'Satu harga, atau saiz dengan harga sendiri',
    'Chat sebut harga dari rak anda',
    'Bakul sampai sebagai mesej WhatsApp',
  ],
  demoNote: 'Kedai demo. Kek Lina bukan kedai sebenar.',
  messageTitle: 'Ini yang Lina akan dapat di WhatsApp',
  orderButton: 'Tengok mesej tempahan',
},
quiet: {
  title: 'Benda kecil yang selamatkan anda nanti.',
  tiles: [
    { title: 'BM, English atau rojak', body: 'Ia jawab dalam bahasa yang pelanggan guna.' },
    { title: 'Page FAQ dari soalan sebenar', body: 'Soalan yang ditanya tiga kali atau lebih, dengan jawapan anda, jadi page yang Google boleh jumpa.' },
    { title: 'Guna dengan mana-mana link bio', body: 'Instagram, TikTok, WhatsApp Business, QR di kaunter.' },
  ],
},
```

Add to both `pricing.business.points` as the third point: EN `'Your own shop on your page, orders to your WhatsApp'`, MS `'Kedai sendiri di page anda, tempahan ke WhatsApp anda'`. Add to both `faq.items` (after the question about leads):

```ts
// en
{ q: 'Can I sell on my page?', a: 'Yes, on a business page. Add your items with their prices, and a Visit shop tile appears on your page. Customers fill a basket and send it to your WhatsApp.' },
// ms
{ q: 'Boleh saya jual di page saya?', a: 'Boleh, di page bisnes. Masukkan barang dengan harganya, dan tile Lawati kedai muncul di page anda. Pelanggan isi bakul dan hantar ke WhatsApp anda.' },
```

Check the FAQ wording against the real shop copy in `apps/web/app/[handle]/shop/copy.ts` ("Visit shop" / "Lawati kedai") — they must match.

- [ ] **Step 3: Demo items.** In `demo.ts` add the interface above and to `Demo` add `items: ReadonlyArray<ShopDemoItem>`. Add to `DEMO_EN`:

```ts
items: [
  { id: 'demo-batik', name: 'Kek Batik', description: 'Nutella, keeps 5 days.', photoUrl: null, priceCents: null,
    options: [{ id: 'demo-batik-1', label: '1kg', priceCents: 9500 }, { id: 'demo-batik-2', label: '2kg', priceCents: 17000 }] },
  { id: 'demo-cookies', name: 'Cookies balang', description: null, photoUrl: null, priceCents: 2500, options: [] },
  { id: 'demo-brownies', name: 'Brownies kotak', description: null, photoUrl: null, priceCents: 3850, options: [] },
],
```

and to `DEMO_MS` the same with `description: 'Nutella, tahan 5 hari.'`.

- [ ] **Step 4:** run the test file → PASS; `pnpm --filter @curios/web typecheck; echo "EXIT: $?"` → 0.
- [ ] **Step 5: Commit** `feat(landing): the words and the demo shelf for the redesign` (+ Co-Authored-By line).

---

### Task 2: Motion foundation — dependencies, `motion.ts`, `timeline.ts`, `SmoothScroll`

**Files:** Modify `apps/web/package.json` (deps); Create `_landing/motion.ts`, `motion.test.ts`, `timeline.ts`, `timeline.test.ts`, `SmoothScroll.tsx`, `SmoothScroll.test.tsx`, `useScrub.ts`, `containment.test.ts`.

**Interfaces — Produces:**

```ts
// motion.ts
export function prefersReducedMotion(): boolean;
export interface Motion { gsap: typeof import('gsap').gsap; ScrollTrigger: typeof import('gsap/ScrollTrigger').ScrollTrigger; Lenis: typeof import('lenis').default }
export function loadMotion(): Promise<Motion>;   // memoised; registers ScrollTrigger once

// timeline.ts
export const HERO_TIMELINE: { readonly bubblesFrom: 0.12; readonly bubblesTo: 0.45; readonly flyFrom: 0.45; readonly flyTo: 0.7; readonly answerFrom: 0.7; readonly answerTo: 0.85; readonly captions: readonly [0, 0.15, 0.71] };
export const PAID_TIMELINE: { readonly steps: readonly [0, 0.2, 0.4, 0.6, 0.8] };
export function heroAsked(p: number, total: number): number;
export function captionAt(p: number, starts: readonly number[]): number; // index of the caption showing at p
export function paidStepAt(p: number): 1 | 2 | 3 | 4 | 5;

// SmoothScroll.tsx
export function SmoothScroll(): null;
export function scrollToSection(href: string): void;

// useScrub.ts
export function useScrub(ref: RefObject<HTMLElement | null>, options: { scrub: number; onProgress?: (p: number) => void }): void;
```

- [ ] **Step 1: Install** — `pnpm --filter @curios/web add gsap@^3.13.0 lenis@^1.3.0; echo "EXIT: $?"`. Confirm both landed in `apps/web/package.json` dependencies and the lockfile changed.

- [ ] **Step 2: Failing tests.** `timeline.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { HERO_TIMELINE, PAID_TIMELINE, captionAt, heroAsked, paidStepAt } from './timeline.js';

describe('the hero timeline', () => {
  it('runs its acts in order', () => {
    const t = HERO_TIMELINE;
    expect(t.bubblesFrom).toBeLessThan(t.bubblesTo);
    expect(t.bubblesTo).toBeLessThanOrEqual(t.flyFrom);
    expect(t.flyFrom).toBeLessThan(t.flyTo);
    expect(t.flyTo).toBeLessThanOrEqual(t.answerFrom);
    expect(t.answerTo).toBeLessThanOrEqual(1);
  });
  it('counts nobody before the bubbles fly, all forty exactly when they land, and never goes back', () => {
    expect(heroAsked(HERO_TIMELINE.flyFrom - 0.01, 40)).toBe(0);
    expect(heroAsked(HERO_TIMELINE.flyTo, 40)).toBe(40);
    expect(heroAsked(1, 40)).toBe(40);
    let last = 0;
    for (let p = 0; p <= 1; p += 0.01) {
      const n = heroAsked(p, 40);
      expect(n).toBeGreaterThanOrEqual(last);
      last = n;
    }
  });
  it('shows caption 1, then 2, then 3', () => {
    const c = HERO_TIMELINE.captions;
    expect(captionAt(0, c)).toBe(0);
    expect(captionAt(0.3, c)).toBe(1);
    expect(captionAt(0.9, c)).toBe(2);
    expect(captionAt(1, c)).toBe(2);
  });
});

describe('the paid timeline', () => {
  it('has five steps, in order, and every progress maps to one', () => {
    expect(PAID_TIMELINE.steps).toHaveLength(5);
    expect(paidStepAt(0)).toBe(1);
    expect(paidStepAt(0.5)).toBe(3);
    expect(paidStepAt(0.99)).toBe(5);
    expect(paidStepAt(1)).toBe(5);
  });
  // Review Focus 1: a section reached part-way is in the right step at once.
  it('clamps progress outside 0..1', () => {
    expect(paidStepAt(-1)).toBe(1);
    expect(paidStepAt(2)).toBe(5);
    expect(captionAt(-1, HERO_TIMELINE.captions)).toBe(0);
  });
});
```

`motion.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { prefersReducedMotion } from './motion.js';

const stub = (matches: boolean) =>
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({ matches, media: query, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }));

afterEach(() => vi.restoreAllMocks());

describe('prefersReducedMotion', () => {
  it('reads the media query', () => {
    stub(true);
    expect(prefersReducedMotion()).toBe(true);
    stub(false);
    expect(prefersReducedMotion()).toBe(false);
  });
});
```

`SmoothScroll.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('./motion.js', async (original) => ({ ...(await original<typeof import('./motion.js')>()), loadMotion: vi.fn(), prefersReducedMotion: vi.fn() }));
const motion = await import('./motion.js');
const { SmoothScroll, scrollToSection } = await import('./SmoothScroll.js');

afterEach(() => vi.clearAllMocks());

describe('SmoothScroll', () => {
  // Review Focus 2.
  it('loads nothing when motion is reduced', () => {
    vi.mocked(motion.prefersReducedMotion).mockReturnValue(true);
    render(<SmoothScroll />);
    expect(motion.loadMotion).not.toHaveBeenCalled();
  });

  it('loads the motion libraries when motion is allowed', () => {
    vi.mocked(motion.prefersReducedMotion).mockReturnValue(false);
    vi.mocked(motion.loadMotion).mockReturnValue(new Promise(() => {}));
    render(<SmoothScroll />);
    expect(motion.loadMotion).toHaveBeenCalledTimes(1);
  });
});

describe('scrollToSection', () => {
  // Review Focus 3: with no Lenis running, it scrolls natively to the section.
  it('falls back to scrollIntoView without Lenis', () => {
    const target = document.createElement('section');
    target.id = 'pricing';
    document.body.append(target);
    const spy = vi.spyOn(target, 'scrollIntoView');
    vi.mocked(motion.prefersReducedMotion).mockReturnValue(false);
    scrollToSection('#pricing');
    expect(spy).toHaveBeenCalled();
    target.remove();
  });
});
```

`containment.test.ts`:

```ts
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const APP = join(__dirname, '..');           // apps/web/app
const WEB = join(APP, '..');                 // apps/web

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === 'node_modules' || name === '.next') return [];
    return statSync(path).isDirectory() ? files(path) : /\.(tsx?|css)$/.test(name) ? [path] : [];
  });
}

describe('the landing motion libraries', () => {
  it('are imported only from app/_landing', () => {
    const offenders = files(WEB)
      .filter((path) => !relative(APP, path).startsWith(`_landing${sep}`))
      .filter((path) => /from ['"](gsap|lenis)|import\(['"](gsap|lenis)/.test(readFileSync(path, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('never frost anything on the landing page', () => {
    const css = files(join(APP, '_landing')).filter((p) => p.endsWith('.css'));
    for (const path of css) expect(readFileSync(path, 'utf8')).not.toMatch(/backdrop-filter/);
  });
});
```

Run all four → FAIL (modules missing).

- [ ] **Step 3: `timeline.ts`**

```ts
/**
 * When things happen in the two pinned moments, as fractions of their scroll
 * (0 at the top of the section, 1 at its end). One place to tune the pace; the
 * scenes and their CSS only read these.
 */
export const HERO_TIMELINE = {
  bubblesFrom: 0.12,
  bubblesTo: 0.45,
  flyFrom: 0.45,
  flyTo: 0.7,
  answerFrom: 0.7,
  answerTo: 0.85,
  /** Where captions 1, 2 and 3 begin. */
  captions: [0, 0.15, 0.71],
} as const;

/** Where each of the paid moment's five steps begins. */
export const PAID_TIMELINE = { steps: [0, 0.2, 0.4, 0.6, 0.8] } as const;

const clamp = (p: number) => Math.min(1, Math.max(0, p));

/** How many times the one question has been asked at this point of the hero. */
export function heroAsked(p: number, total: number): number {
  const t = (clamp(p) - HERO_TIMELINE.flyFrom) / (HERO_TIMELINE.flyTo - HERO_TIMELINE.flyFrom);
  return Math.round(total * Math.min(1, Math.max(0, t)));
}

/** The index of the caption showing at p: the last one whose start has been passed. */
export function captionAt(p: number, starts: readonly number[]): number {
  const at = clamp(p);
  let index = 0;
  starts.forEach((start, i) => {
    if (at >= start) index = i;
  });
  return index;
}

export function paidStepAt(p: number): 1 | 2 | 3 | 4 | 5 {
  return (captionAt(p, PAID_TIMELINE.steps) + 1) as 1 | 2 | 3 | 4 | 5;
}
```

- [ ] **Step 4: `motion.ts`**

```ts
/**
 * The landing page's motion libraries, loaded on demand so none of them is in
 * the first paint, and only on this page -- containment.test.ts fails the
 * build if anything outside app/_landing imports them.
 */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export interface Motion {
  gsap: typeof import('gsap').gsap;
  ScrollTrigger: typeof import('gsap/ScrollTrigger').ScrollTrigger;
  Lenis: typeof import('lenis').default;
}

let loading: Promise<Motion> | null = null;

export function loadMotion(): Promise<Motion> {
  loading ??= Promise.all([import('gsap'), import('gsap/ScrollTrigger'), import('lenis')]).then(([g, st, lenis]) => {
    g.gsap.registerPlugin(st.ScrollTrigger);
    return { gsap: g.gsap, ScrollTrigger: st.ScrollTrigger, Lenis: lenis.default };
  });
  return loading;
}
```

- [ ] **Step 5: `SmoothScroll.tsx`**

```tsx
'use client';

import { useEffect } from 'react';
import { loadMotion, prefersReducedMotion } from './motion.js';

type LenisLike = { scrollTo: (target: Element, options?: { offset?: number; duration?: number }) => void };

// The running instance, for scrollToSection. Module state, not React state: the
// header's links are in a different component and need it without a context.
let lenis: LenisLike | null = null;

/** Berkira's glide: lerp 0.09, wheel 0.9, driven by GSAP's ticker so ScrollTrigger and Lenis agree on every frame. */
export function SmoothScroll(): null {
  useEffect(() => {
    if (prefersReducedMotion()) return;
    let cancelled = false;
    let teardown: (() => void) | undefined;
    void loadMotion().then(({ gsap, ScrollTrigger, Lenis }) => {
      if (cancelled) return;
      const instance = new Lenis({ lerp: 0.09, wheelMultiplier: 0.9 });
      lenis = instance;
      instance.on('scroll', ScrollTrigger.update);
      const tick = (time: number) => instance.raf(time * 1000);
      gsap.ticker.add(tick);
      gsap.ticker.lagSmoothing(0);
      teardown = () => {
        gsap.ticker.remove(tick);
        instance.destroy();
        lenis = null;
      };
    });
    return () => {
      cancelled = true;
      teardown?.();
    };
  }, []);
  return null;
}

/** Scrolls to an in-page section: smoothly through Lenis when it runs, natively otherwise. */
export function scrollToSection(href: string): void {
  const target = document.querySelector(href);
  if (!target) return;
  if (lenis && !prefersReducedMotion()) lenis.scrollTo(target, { offset: 0, duration: 1.4 });
  else target.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
}
```

- [ ] **Step 6: `useScrub.ts`**

```ts
'use client';

import { useEffect, type RefObject } from 'react';
import { loadMotion, prefersReducedMotion } from './motion.js';

/**
 * Tweens the CSS variable --p on `ref`'s element from 0 to 1 across the
 * element's scroll (its top reaching the viewport top, to its bottom reaching
 * the viewport bottom), scrubbed so it eases behind the scroll. The scene's CSS
 * reads --p. Reduced motion: does nothing, so the CSS default (--p: 1, the
 * finished state) stands.
 *
 * ScrollTrigger computes progress from the current scroll when it is created,
 * so a page reloaded half-way down starts each scene where the reader is.
 */
export function useScrub(ref: RefObject<HTMLElement | null>, options: { scrub: number; onProgress?: (p: number) => void }): void {
  const { scrub, onProgress } = options;
  useEffect(() => {
    const node = ref.current;
    if (!node || prefersReducedMotion()) return;
    let cancelled = false;
    let kill: (() => void) | undefined;
    void loadMotion().then(({ gsap }) => {
      if (cancelled) return;
      node.style.setProperty('--p', '0');
      node.dataset.motion = 'on';
      const tween = gsap.to(node, {
        '--p': 1,
        ease: 'none',
        scrollTrigger: {
          trigger: node,
          start: 'top top',
          end: 'bottom bottom',
          scrub,
          onUpdate: (self) => onProgress?.(self.progress),
        },
      });
      kill = () => {
        tween.scrollTrigger?.kill();
        tween.kill();
      };
    });
    return () => {
      cancelled = true;
      kill?.();
    };
  }, [ref, scrub, onProgress]);
}
```

Every scene's CSS: `--p` defaults to `1` on the section; the tall height and `position: sticky` apply only under `[data-motion='on']`, so without motion the section is its natural height and shows its finished state.

- [ ] **Step 7:** run the four test files → PASS. Mutation self-check: make `prefersReducedMotion` return false always (SmoothScroll reduced test goes red); let `heroAsked` skip the clamp (clamp test red); add an `import 'gsap'` to a file under `app/app/` (containment red). Restore each.
- [ ] **Step 8:** `pnpm --filter @curios/web test`, `typecheck`, `lint` → `EXIT: 0` each. **Commit** `feat(landing): the motion foundation -- Lenis, GSAP on demand, one place for timings`.

---

### Task 3: Type, bands and the nav

**Files:** Modify `landing-tokens.css`, `landing.module.css`, `Header.tsx`, `SectionLinks.tsx`, `header.module.css`, `landing.test.tsx`.

**Interfaces:** Consumes `scrollToSection` (Task 2). Produces `base.bandPaper`, `base.bandSurface`, `base.bandInk` (exist — confirm names in `landing.module.css`; add any missing with the band roles).

- [ ] **Step 1: Failing test** (append to `describe('the landing page')`):

```tsx
it('sends section links through scrollToSection, so the smooth scroll lands on them', async () => {
  const smooth = await import('./SmoothScroll.js');
  const spy = vi.spyOn(smooth, 'scrollToSection').mockImplementation(() => {});
  render(<LandingPage locale="en" />);
  fireEvent.click(screen.getAllByRole('link', { name: 'Pricing' })[0]!);
  expect(spy).toHaveBeenCalledWith('#pricing');
  spy.mockRestore();
});
```

If `vi.spyOn` on an ES module export does not intercept the call inside `SectionLinks` (ESM live bindings), instead `vi.mock('./SmoothScroll.js', …)` at the top of a new file `section-links.test.tsx` and assert there. Run → FAIL.

- [ ] **Step 2: Type.** In `landing-tokens.css`: `--l-weight-display: 700;`, `--l-tracking-display: -0.03em;`, `--l-tracking-heading: -0.025em;`. Grep `_landing/*.css` for any hard-coded `font-weight: 800` and replace with the token.

- [ ] **Step 3: Nav.** `Header.tsx`: replace the floating pill with a full-width bar — `<header className={styles.header}>` holding `<div className={`${base.wrap} ${styles.bar}`} data-pill>` (keep `data-pill`, `SectionLinks` uses it for `data-scrolled`). `header.module.css`: `.header { position: sticky; top: 0; z-index: 20; background: var(--paper); }`, `.bar { display: flex; align-items: center; gap: 24px; min-height: 64px; }`, `[data-scrolled='true']` on the bar's parent gives `box-shadow: none; border-bottom: 1px solid var(--line)` (put the border on `.header` via `.header:has([data-scrolled='true'])`). Remove the pill radius/white card styles. Keep the CTA as `base.button` (biru pill). `SectionLinks.tsx`: on click, `event.preventDefault(); scrollToSection(section.href); history.replaceState(null, '', section.href);`. Scrolled threshold 8px (Berkira's).

- [ ] **Step 4:** tests → PASS; typecheck, lint → 0. **Commit** `feat(landing): lighter display type and a solid nav that scrolls you smoothly`.

---

### Task 4: The pinned hero

**Files:** Create `_landing/HeroScene.tsx`, `_landing/HeroStage.tsx` (client), rewrite `hero.module.css`; Test `landing.test.tsx`.

**Interfaces:** Consumes `useScrub`, `HERO_TIMELINE`, `heroAsked`, `captionAt` (Task 2); `copy.hero`, `copy.heroScene`, `copy.storm.asked`, `copy.shop` (Task 1); `ClaimField`, `Device`, `BentoPage`, `PhotoSlot`; `shopCopy` from `../[handle]/shop/copy.js`. Produces `HeroScene({ copy }: { copy: LandingCopy })`.

**Rulings (from the controller, binding):**
- The hero photograph (`/landing/hero-baker.webp`) stays, behind the phone as now on screens ≥ 960px; below that it is hidden so the bubbles have room.
- The interactive "tap to ask" `HeroDemo` is retired — the hero's phone is now the scrubbed scene, and the shop demo (Task 7) is the page's interactive piece.

- [ ] **Step 1: Failing tests** (new `describe('the hero')` in `landing.test.tsx`; remove the old `describe('the hero demo')` and `describe('the storm')` in Task 9):

```tsx
describe('the hero', () => {
  it.each(LOCALES)('%s: reads as three captions in order, with the claim field in the first', (locale) => {
    const copy = COPY[locale];
    const { container } = render(<LandingPage locale={locale} />);
    const hero = container.querySelector('#hero')!;
    const text = hero.textContent!;
    expect(text.indexOf(copy.hero.title)).toBeLessThan(text.indexOf(copy.heroScene.problem));
    expect(text.indexOf(copy.heroScene.problem)).toBeLessThan(text.indexOf(copy.heroScene.fix));
    expect(hero.querySelector('form[action="/signup"]')).not.toBeNull();
  });

  it('shows the finished phone without motion: one question, asked forty times, answered, and the shop tile', () => {
    const { container } = render(<LandingPage locale="en" />);
    const hero = container.querySelector('#hero')!;
    expect(hero).toHaveTextContent(en.storm.asked(40));
    expect(hero).toHaveTextContent(DEMO_EN.qa[0]!.a);
    expect(hero.querySelector('[data-shop]')).not.toBeNull();
    expect(hero.querySelector('[data-motion="on"]')).toBeNull();
  });

  it('draws twelve of the forty wordings round the phone, in the page language', () => {
    const { container } = render(<LandingPage locale="ms" />);
    const bubbles = [...container.querySelectorAll('#hero [data-bubble]')].map((b) => b.textContent);
    expect(bubbles).toHaveLength(12);
    expect(bubbles).toEqual(DEMO_MS.storm.slice(0, 12));
  });
});
```

Run → FAIL.

- [ ] **Step 2: `HeroScene.tsx`** (server component):

```tsx
import type { CSSProperties } from 'react';
import { BentoPage } from '../_bento/BentoPage.js';
import { shopCopy } from '../[handle]/shop/copy.js';
import type { LandingCopy } from './copy.js';
import { ClaimField } from './ClaimField.js';
import { Device } from './Device.js';
import { HeroStage } from './HeroStage.js';
import { PhotoSlot } from './PhotoSlot.js';
import base from './landing.module.css';
import styles from './hero.module.css';

/** Where the twelve bubbles sit round the phone, as % of the stage from its centre. */
const SPOTS: ReadonlyArray<readonly [number, number]> = [
  [-34, -36], [33, -40], [-40, -14], [38, -18], [-31, 6], [40, 4],
  [-42, 26], [32, 24], [-30, 42], [38, 42], [-24, -46], [26, -6],
];

/**
 * The hero, pinned: Kek Lina's page beside three captions -- the promise,
 * "forty people, one question", "answer it once". Server-rendered in its
 * finished state; HeroStage scrubs it when motion is allowed.
 */
export function HeroScene({ copy }: { copy: LandingCopy }) {
  const { page, qa, storm } = copy.shop;
  const total = storm.length;
  const tile = shopCopy(copy.locale);
  const first = qa[0]!;
  return (
    <section className={`${base.bandMuda} ${styles.hero}`} id="hero" aria-labelledby="hero-title">
      <HeroStage askedLabels={Array.from({ length: total + 1 }, (_, n) => copy.storm.asked(n))} total={total}>
        <div className={`${base.wrap} ${styles.grid}`}>
          <div className={styles.captions}>
            <div className={styles.caption} data-caption="0">
              <h1 id="hero-title" className={styles.title} data-hero-line>
                {copy.hero.title}
              </h1>
              <p className={styles.sub} data-hero-fade>{copy.hero.sub}</p>
              <div data-hero-fade>
                <ClaimField id="claim-hero" label={copy.claim.label} placeholder={copy.claim.placeholder} button={copy.hero.cta} />
                <p className={styles.note}>{copy.hero.ctaNote}</p>
              </div>
            </div>
            <p className={`${styles.caption} ${styles.big}`} data-caption="1">{copy.heroScene.problem}</p>
            <p className={`${styles.caption} ${styles.big}`} data-caption="2">{copy.heroScene.fix}</p>
          </div>
          <figure className={styles.proof}>
            <PhotoSlot shot={copy.photos.hero} src="/landing/hero-baker.webp" alt="" focus="62% 22%" priority className={styles.photo} />
            <ul className={styles.bubbles} aria-hidden="true">
              {storm.slice(0, SPOTS.length).map((wording, i) => (
                <li key={wording} className={styles.bubble} data-bubble style={{ '--i': i, '--x': `${SPOTS[i]![0]}%`, '--y': `${SPOTS[i]![1]}%` } as CSSProperties}>
                  {wording}
                </li>
              ))}
            </ul>
            <div className={styles.phone}>
              <Device time="3:15" chrome="browser" url={`curios.my/${page.handle}`}>
                <div className={styles.screen}>
                  <div className={styles.idle} aria-hidden="true">
                    <BentoPage {...page} shop={{ position: 0, size: null, label: tile.visit, caption: tile.itemCount(copy.shop.items.length), photoUrl: null }} />
                  </div>
                  <div className={styles.chat}>
                    <BentoPage {...page} mode="chat">
                      <div className={styles.thread}>
                        <p className={styles.question}>{first.q}</p>
                        <p className={styles.count}>
                          <span data-hero-count>{copy.storm.asked(total)}</span>
                        </p>
                        <p className={styles.answer}>{first.a}</p>
                      </div>
                    </BentoPage>
                  </div>
                </div>
              </Device>
            </div>
            <figcaption className={styles.demoNote}>{copy.hero.demoNote}</figcaption>
          </figure>
        </div>
        <p className={styles.cue} aria-hidden="true">{copy.heroScene.scrollCue}</p>
      </HeroStage>
    </section>
  );
}
```

The idle `BentoPage` carries the shop tile (`data-shop` is rendered by BentoPage for the shop tile). Keep the photo's `alt=""` — it is decorative behind the demo now; its `shot` prop still describes it for the placeholder.

- [ ] **Step 3: `HeroStage.tsx`** (client):

```tsx
'use client';

import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { loadMotion, prefersReducedMotion } from './motion.js';
import { HERO_TIMELINE, captionAt, heroAsked } from './timeline.js';
import { useScrub } from './useScrub.js';
import styles from './hero.module.css';

/**
 * Scrubs the hero: --p drives the bubbles, the fly-in and the answer in CSS;
 * this sets which caption shows and ticks the "asked N×" count. Plays the
 * headline's load-in once. Reduced motion: nothing runs; the finished scene
 * the server drew stands.
 */
export function HeroStage({ children, askedLabels, total }: { children: ReactNode; askedLabels: ReadonlyArray<string>; total: number }) {
  const stage = useRef<HTMLDivElement>(null);

  const onProgress = useCallback(
    (p: number) => {
      const node = stage.current;
      if (!node) return;
      node.dataset.caption = String(captionAt(p, HERO_TIMELINE.captions));
      const count = node.querySelector<HTMLElement>('[data-hero-count]');
      if (count) count.textContent = askedLabels[heroAsked(p, total)] ?? '';
    },
    [askedLabels, total],
  );
  useScrub(stage, { scrub: 0.6, onProgress });

  useEffect(() => {
    const node = stage.current;
    if (!node || prefersReducedMotion()) return;
    let cancelled = false;
    void loadMotion().then(({ gsap }) => {
      if (cancelled) return;
      node.dataset.caption = '0';
      gsap.from(node.querySelectorAll('[data-hero-line]'), { yPercent: 110, duration: 1.3, ease: 'expo.out', stagger: 0.09, delay: 0.15 });
      gsap.from(node.querySelectorAll('[data-hero-fade]'), { autoAlpha: 0, y: 16, duration: 1, ease: 'power3.out', delay: 0.7, stagger: 0.08 });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div ref={stage} className={styles.stage} data-caption="all">
      {children}
    </div>
  );
}
```

- [ ] **Step 4: `hero.module.css`** — rewrite. Required rules (write the rest to match the spec's look: Bricolage `--l-weight-display`, 16px gutters on phones):

```css
/* Without motion (no JS, reduced motion): natural height, every caption shown in order, finished phone. */
.stage { --p: 1; position: relative; }
.stage[data-motion='on'] { height: 400vh; }
.stage[data-motion='on'] > .grid { position: sticky; top: 0; height: 100svh; }

.captions { display: grid; gap: 24px; }
/* With motion, the three captions share one cell and only the current one shows. */
.stage[data-motion='on'] .captions { grid-template-areas: 'c'; }
.stage[data-motion='on'] .caption { grid-area: c; opacity: 0; transform: translateY(40px); transition: opacity 0.4s, transform 0.4s; pointer-events: none; }
.stage[data-caption='0'] .caption[data-caption='0'],
.stage[data-caption='1'] .caption[data-caption='1'],
.stage[data-caption='2'] .caption[data-caption='2'] { opacity: 1; transform: none; pointer-events: auto; }

/* Bubbles: appear one by one across bubblesFrom..bubblesTo, then fly to the centre across flyFrom..flyTo. */
.bubble {
  --appear: clamp(0, calc((var(--p) - 0.12 - var(--i) * 0.0275) / 0.03), 1);
  --fly: clamp(0, calc((var(--p) - 0.45) / 0.25), 1);
  position: absolute; left: 50%; top: 50%;
  transform: translate(calc(-50% + var(--x) * (1 - var(--fly))), calc(-50% + var(--y) * (1 - var(--fly)))) scale(calc(0.6 + 0.4 * var(--appear) - 0.5 * var(--fly)));
  opacity: calc(var(--appear) * (1 - var(--fly)));
}
/* The finished state (and reduced motion): bubbles gone, the chat screen showing. */
.idle { opacity: clamp(0, calc((0.5 - var(--p)) / 0.05), 1); }
.chat { opacity: clamp(0, calc((var(--p) - 0.45) / 0.05), 1); }
.answer { opacity: clamp(0, calc((var(--p) - 0.7) / 0.05), 1); }

/* Load-in: each line rises from a clip. */
.title { overflow: hidden; }

/* Phones: phone centred, captions at the bottom of the stage. */
@media (max-width: 959px) {
  .photo { display: none; }
  .stage[data-motion='on'] > .grid { grid-template-rows: 1fr auto; padding-bottom: 8svh; }
}
.cue { display: none; }
@media (min-width: 960px) { .stage[data-motion='on'] .cue { display: block; position: absolute; bottom: 24px; left: 50%; transform: translateX(-50%); } }
```

The numbers `0.12`, `0.45`, `0.25`, `0.7` and the stagger `0.0275` (= (0.45 − 0.12) / 12) mirror `HERO_TIMELINE`; add a comment saying so. With `--p: 1` every expression yields the finished state (bubbles hidden, chat shown, answer shown).

- [ ] **Step 5:** run the hero tests → PASS. Mutation check: set `.stage { --p: 0 }` default (finished-state test still passes in jsdom — CSS isn't evaluated; so instead assert the server markup: the answer text and count are in the DOM — already done); mutate `HeroScene` to slice 10 bubbles (bubbles test red); move `problem` before `title` (order test red). Restore.
- [ ] **Step 6:** web test/typecheck/lint → 0. **Commit** `feat(landing): the hero pins, and forty DMs become one answer as you scroll`.

---

### Task 5: How it works

**Files:** Create `_landing/HowItWorks.tsx`, `how.module.css`; Test `landing.test.tsx`.

**Interfaces:** Consumes `copy.how`, `copy.setup.addressExample` (kept until Task 9; then inline `curios.my/${copy.shop.page.handle}`), `copy.photos.setup`, `PhotoSlot`, `Reveal`. Produces `HowItWorks({ copy })`, section `id="how"` on `bandSurface`.

**Ruling:** the setup photograph (`/landing/setup-laptop.webp`) stays, as a wide image above the three cards on screens ≥ 720px.

- [ ] **Step 1: Failing test:**

```tsx
it.each(LOCALES)('%s: How it works is three numbered steps, each with its snippet', (locale) => {
  const copy = COPY[locale];
  const { container } = render(<LandingPage locale={locale} />);
  const how = container.querySelector('#how')!;
  const steps = [...how.querySelectorAll('ol > li')];
  expect(steps).toHaveLength(3);
  steps.forEach((li, i) => expect(li).toHaveTextContent(copy.how.steps[i]!.title));
  expect(how.querySelectorAll('[data-snippet]')).toHaveLength(3);
});
```

- [ ] **Step 2: `HowItWorks.tsx`:**

```tsx
import type { LandingCopy } from './copy.js';
import { PhotoSlot } from './PhotoSlot.js';
import { Reveal } from './Reveal.js';
import base from './landing.module.css';
import styles from './how.module.css';

/** Three steps, each with a small piece of the real product drawn in its card. */
export function HowItWorks({ copy }: { copy: LandingCopy }) {
  const facts = copy.shop.facts.slice(0, 3);
  const snippets = [
    <p key="source" className={styles.source} data-snippet>keklina.example/menu</p>,
    <ul key="facts" className={styles.facts} data-snippet>
      {facts.map((fact, i) => (
        <li key={fact.claim} data-ticked={i === 0 ? 'yes' : 'no'}>
          {fact.claim} <span>{fact.value}</span>
        </li>
      ))}
    </ul>,
    <p key="link" className={styles.link} data-snippet>curios.my/{copy.shop.page.handle}</p>,
  ];
  return (
    <section className={`${base.bandSurface} ${styles.how}`} id="how" aria-labelledby="how-title">
      <div className={base.wrap}>
        <Reveal>
          <h2 id="how-title" className={base.h2}>{copy.how.title}</h2>
        </Reveal>
        <PhotoSlot shot={copy.photos.setup} src="/landing/setup-laptop.webp" alt="" focus="60% 50%" ratio={21 / 9} className={styles.photo} />
        <ol className={styles.steps}>
          {copy.how.steps.map((step, i) => (
            <Reveal as="li" key={step.title} className={styles.card} delay={i * 60}>
              <span className={styles.number} aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
              <h3 className={styles.title}>{step.title}</h3>
              <p className={styles.body}>{step.body}</p>
              {snippets[i]}
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  );
}
```

`how.module.css`: three columns ≥ 900px, one below; cards `--card` with `1px solid var(--line)`, radius 20px, padding 28px; `.number` Plex Mono; `.photo` hidden < 720px; ticked fact gets a biru tick (`::before` content `'✓'`, colour `--biru`); untick shows an empty box. Snippet text in Plex Mono where it is data (URL, prices).

- [ ] **Step 3:** tests → PASS; typecheck/lint → 0. **Commit** `feat(landing): How it works, in three steps with the product in each`.

---

### Task 6: The paid moment (pinned)

**Files:** Create `_landing/LeadPhones.tsx`, `_landing/PaidMoment.tsx`, `_landing/PaidStage.tsx` (client), `paid.module.css`; Test `landing.test.tsx`.

**Interfaces:** Consumes `useScrub`, `paidStepAt`, `PAID_TIMELINE` (Task 2); `copy.leads.steps` (the five step titles/bodies — kept as the paid moment's captions; they are true to the product: email + one-tap WhatsApp), `copy.leads.visitorPhone/ownerPhone/asleep/lockDate`, `copy.paid`; `copy.shop.lead`, `copy.shop.page`. Produces `LeadPhones({ step, copy, shop })`, `PaidMoment({ copy })` on `bandBiru`.

**Ruling:** the spec's step 5 wording "the WhatsApp lands on Lina's phone" is corrected to what the product does — the lead arrives **by email**, with a one-tap WhatsApp reply. The five captions are today's `copy.leads.steps`.

- [ ] **Step 1: Extract `LeadPhones.tsx`** — move the `<div className={styles.stage} …>` block (both `<figure>`s, the lock screen, the email, the WhatsApp draft) out of `LeadsStory.tsx` into `export function LeadPhones({ step, copy, shop }: { step: number; copy: LandingCopy['leads']; shop: Demo })`, unchanged except `styles` now comes from `./paid.module.css`. Copy every class it uses from `leads.module.css` into `paid.module.css` (grep the JSX for `styles.` names; the device, chat, capture, email, whatsapp, lock rules). `LeadsStory` imports `LeadPhones` until Task 9 deletes it, so existing tests stay green.

- [ ] **Step 2: Failing tests:**

```tsx
describe('the paid moment', () => {
  it.each(LOCALES)('%s: lists all five steps in order, then the closing line', (locale) => {
    const copy = COPY[locale];
    const { container } = render(<LandingPage locale={locale} />);
    const paid = container.querySelector('#paid')!;
    const steps = [...paid.querySelectorAll('ol > li')].map((li) => li.textContent);
    expect(steps).toHaveLength(5);
    copy.leads.steps.forEach((s, i) => expect(steps[i]).toContain(s.title));
    expect(paid).toHaveTextContent(copy.paid.closing);
  });

  it('shows the last step without motion: the email and the WhatsApp reply', () => {
    const { container } = render(<LandingPage locale="en" />);
    const paid = container.querySelector('#paid')!;
    expect(paid.querySelector('[data-step="5"]')).not.toBeNull();
    expect(paid).toHaveTextContent(DEMO_EN.lead.reply);
  });
});
```

- [ ] **Step 3: `PaidStage.tsx`** (client; `PaidMoment` is a server component, so it passes the captions as rendered markup and the phones' data as props):

```tsx
'use client';

import { useCallback, useRef, useState, type ReactNode } from 'react';
import type { LandingCopy } from './copy.js';
import type { Demo } from './demo.js';
import { LeadPhones } from './LeadPhones.js';
import { paidStepAt } from './timeline.js';
import { useScrub } from './useScrub.js';
import styles from './paid.module.css';

/**
 * Scrubs the paid moment and tells the phones which step to show. Starts on
 * step 5, so without motion (no JS, reduced motion) the finished lead -- the
 * email and the reply -- is what shows.
 */
export function PaidStage({
  captions,
  leads,
  shop,
  progressLabel,
}: {
  captions: ReactNode;
  leads: LandingCopy['leads'];
  shop: Demo;
  progressLabel: string;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(5);
  const onProgress = useCallback((p: number) => setStep(paidStepAt(p)), []);
  useScrub(stage, { scrub: 0.8, onProgress });
  return (
    <div ref={stage} className={styles.stage} data-step={step}>
      <div className={styles.inner}>
        <div className={styles.progress} role="progressbar" aria-label={progressLabel} aria-valuemin={1} aria-valuemax={5} aria-valuenow={step} />
        {captions}
        <LeadPhones step={step} copy={leads} shop={shop} />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: `PaidMoment.tsx`:**

```tsx
import type { LandingCopy } from './copy.js';
import { PaidStage } from './PaidStage.js';
import base from './landing.module.css';
import styles from './paid.module.css';

/** What Business pays for, as five steps on one phone, pinned while the captions move past. */
export function PaidMoment({ copy }: { copy: LandingCopy }) {
  return (
    <section className={`${base.bandBiru} ${styles.paid}`} id="paid" aria-labelledby="paid-title">
      <PaidStage
        leads={copy.leads}
        shop={copy.shop}
        progressLabel={copy.paid.progressLabel}
        captions={
          <div className={styles.copy}>
            <h2 id="paid-title" className={base.h2}>{copy.paid.title}</h2>
            <ol className={styles.track}>
              {copy.leads.steps.map((step, i) => (
                <li key={step.title} className={styles.panel} data-panel={i + 1}>
                  <span className={styles.number} aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
                  <h3 className={styles.title}>{step.title}</h3>
                  <p className={styles.body}>{step.body}</p>
                </li>
              ))}
            </ol>
            <p className={styles.closing}>{copy.paid.closing}</p>
          </div>
        }
      />
    </section>
  );
}
```

- [ ] **Step 5: `paid.module.css`** required rules:

```css
.stage { --p: 1; position: relative; }
.stage[data-motion='on'] { height: 500vh; }
.stage[data-motion='on'] > .inner { position: sticky; top: 0; height: 100svh; overflow: hidden; }
.progress { position: absolute; top: 0; left: 0; right: 0; height: 3px; background: var(--band-line); }
.progress::after { content: ''; position: absolute; inset: 0; background: var(--biru-muda); transform-origin: left; transform: scaleX(var(--p)); }
/* Without motion: the five steps as a plain numbered list. */
.track { display: grid; gap: 16px; }
@media (min-width: 960px) {
  /* Sideways: five panels in a row, sliding left as --p grows; the phone stays put. */
  .stage[data-motion='on'] .track { display: flex; width: 500%; transform: translateX(calc(var(--p) * -80%)); }
  .stage[data-motion='on'] .panel { flex: 0 0 20%; }
}
@media (max-width: 959px) {
  /* Vertical on phones: the phone pins, the current panel shows beneath it. */
  .stage[data-motion='on'] .panel { display: none; }
  .stage[data-step='1'] .panel[data-panel='1'], .stage[data-step='2'] .panel[data-panel='2'], .stage[data-step='3'] .panel[data-panel='3'], .stage[data-step='4'] .panel[data-panel='4'], .stage[data-step='5'] .panel[data-panel='5'] { display: block; }
}
```

Layout: captions left, phones right on ≥ 960px; phones top, panel below on phones.

- [ ] **Step 6:** tests → PASS (old leads tests still pass via LeadsStory). Mutation check: default `useState(1)` → finished-state test red; drop the closing line → red. Restore. Web test/typecheck/lint → 0. **Commit** `feat(landing): the paid moment pins, from 11:42pm to the reply`.

---

### Task 7: The shop section and its demo

**Files:** Modify `apps/web/app/[handle]/shop/shop-view.tsx`, `shop-view.test.tsx`; Create `_landing/ShopDemo.tsx`, `_landing/ShopSection.tsx`, `_landing/shop.module.css`; Test `landing.test.tsx`.

**Interfaces:** `ShopView` gains optional props:

```ts
/** When given, replaces the WhatsApp link with a button that hands the message here (the landing's demo). */
onOrder?: (message: string) => void;
/** Hide the "Back" link to /handle (the landing's demo has no page to go back to). Default true. */
showBack?: boolean;
/** sessionStorage key for the basket. Default `curios-basket:${handle}`. */
storageKey?: string;
/** The order button's words when `onOrder` is given. Default the shop copy's orderOnWhatsApp. */
orderLabel?: string;
/** 'embedded' keeps the basket bar inside its container (sticky) instead of fixed to the viewport. Default 'page'. */
variant?: 'page' | 'embedded';
```

Produces `ShopSection({ copy })` on `bandPaper`, `ShopDemo({ copy })` client.

- [ ] **Step 1: Failing tests** — in `shop-view.test.tsx`:

```tsx
it('hands the order message to onOrder instead of linking to WhatsApp, when asked to', async () => {
  const onOrder = vi.fn();
  render(<ShopView {...props} onOrder={onOrder} showBack={false} />); // use the file's existing base props
  // add an item to the basket the way the existing tests do, then:
  await userEvent.click(screen.getByRole('button', { name: /order on whatsapp/i }));
  expect(onOrder).toHaveBeenCalledWith(expect.stringContaining('Kek'));
  expect(screen.queryByRole('link', { name: /order on whatsapp/i })).toBeNull();
  expect(screen.queryByRole('link', { name: /back/i })).toBeNull();
});

it('keeps its basket under the storage key it is given', async () => {
  render(<ShopView {...props} storageKey="landing-demo" />);
  // add an item, then:
  expect(window.sessionStorage.getItem('landing-demo')).toContain('"quantity":1');
});
```

Write the "add an item" lines by copying them from the existing basket test in that file. In `landing.test.tsx`:

```tsx
describe('the shop section', () => {
  // Review Focus 5.
  it('runs the real shelf as a demo that never leaves the page', async () => {
    render(<LandingPage locale="en" />);
    const shop = document.querySelector('#shop') as HTMLElement;
    await userEvent.click(within(shop).getByRole('button', { name: /Cookies balang/ }));
    await userEvent.click(within(shop).getByRole('button', { name: /add to basket/i }));
    expect(shop.querySelector('a[href^="https://wa.me"]')).toBeNull();
    await userEvent.click(within(shop).getByRole('button', { name: en.shopSection.orderButton }));
    expect(within(shop).getByRole('region', { name: en.shopSection.messageTitle })).toHaveTextContent('Cookies balang');
  });
});
```

Run → FAIL.

- [ ] **Step 2: `ShopView` changes** — in the basket bar: if `props.onOrder`, render `<button type="button" className={styles.order} onClick={() => props.onOrder!(basketMessage(props.displayName, priced, copy))}>{props.orderLabel ?? copy.orderOnWhatsApp}</button>` (add `orderLabel?: string` too, so the landing can say "See the order message"); else the existing link/no-WhatsApp branch. Wrap the Back link in `props.showBack !== false`. Replace `storageKey(props.handle)` uses with `props.storageKey ?? storageKey(props.handle)`. When `onOrder` is given, the no-WhatsApp line never shows.

- [ ] **Step 3: `ShopDemo.tsx`:**

```tsx
'use client';

import { useState } from 'react';
import { ShopView } from '../[handle]/shop/shop-view.js';
import type { LandingCopy } from './copy.js';
import styles from './shop.module.css';

/** Kek Lina's shelf, the real component, as a demo: the order button shows the message instead of opening WhatsApp. */
export function ShopDemo({ copy }: { copy: LandingCopy }) {
  const [message, setMessage] = useState<string | null>(null);
  const { page, items } = copy.shop;
  return (
    <div className={styles.demo}>
      <ShopView
        handle={page.handle}
        displayName={page.displayName}
        language={copy.locale}
        items={items.map((item) => ({ ...item, photoKey: null }))}
        whatsapp={null}
        pickupEnabled
        pickupNote="Seksyen 7, Shah Alam"
        deliveryMode="RIDER"
        deliveryFeeCents={null}
        minNoticeDays={2}
        initialItemId={null}
        onOrder={setMessage}
        orderLabel={copy.shopSection.orderButton}
        showBack={false}
        storageKey="curios-landing-demo"
      />
      {message ? (
        <section className={styles.message} aria-label={copy.shopSection.messageTitle}>
          <h3 className={styles.messageTitle}>{copy.shopSection.messageTitle}</h3>
          <pre className={styles.messageText}>{message}</pre>
        </section>
      ) : null}
      <p className={styles.note}>{copy.shopSection.demoNote}</p>
    </div>
  );
}
```

`ShopItem` requires `photoKey`; the map adds it. Check the `ViewItem` type (`ShopItem & { photoUrl }`) and adjust the map to satisfy it exactly.

- [ ] **Step 4: `ShopSection.tsx`:**

```tsx
import type { LandingCopy } from './copy.js';
import { Reveal } from './Reveal.js';
import { ShopDemo } from './ShopDemo.js';
import base from './landing.module.css';
import styles from './shop.module.css';

export function ShopSection({ copy }: { copy: LandingCopy }) {
  return (
    <section className={`${base.bandPaper} ${styles.shop}`} id="shop" aria-labelledby="shop-title">
      <div className={`${base.wrap} ${styles.grid}`}>
        <Reveal className={styles.text}>
          <h2 id="shop-title" className={base.h2}>{copy.shopSection.title}</h2>
          <ul className={styles.points}>
            {copy.shopSection.points.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
        </Reveal>
        <ShopDemo copy={copy} />
      </div>
    </section>
  );
}
```

`shop.module.css`: two columns ≥ 960px (points left, demo right in a 420px-wide framed card on `--card`, radius 20px, hairline); one column below; the demo card's basket bar must be `position: sticky` inside the card, not `fixed` to the viewport — override the shop's fixed bar inside `.demo` (`.demo :global([class*='basket'])` is fragile; instead add a `variant?: 'page' | 'embedded'` prop to `ShopView` that sets `data-variant` on its root, and in `shop.module.css` of the shop route add `[data-variant='embedded'] .basket { position: sticky; }`). Add `variant="embedded"` to the ShopDemo props and the ShopView props list above.

- [ ] **Step 5:** run shop-view and landing tests → PASS; the public shop's existing tests unchanged and green. Mutation: drop `onOrder` branch (landing demo test red: a wa.me link or no button); drop `showBack` guard (back-link assertion red). Restore. Web test/typecheck/lint → 0. **Commit** `feat(landing): the shop gets its own section, with Kek Lina's shelf to try`.

---

### Task 8: Trust, quiet parts, pricing, FAQ, closing

**Files:** Create `_landing/QuietParts.tsx`, `quiet.module.css`; Modify `Trust.tsx`, `trust.module.css`, `Pricing.tsx`, `pricing.module.css`, `Faq.tsx`, `faq.module.css`, `Closing.tsx`, `closing.module.css`; Test `landing.test.tsx`.

- [ ] **Step 1: Failing tests:**

```tsx
it.each(LOCALES)('%s: the quiet parts are three tiles', (locale) => {
  const { container } = render(<LandingPage locale={locale} />);
  expect(container.querySelectorAll('#quiet li')).toHaveLength(3);
});

it.each(LOCALES)('%s: the Business plan includes the shop, and the FAQ answers selling', (locale) => {
  const copy = COPY[locale];
  const { container } = render(<LandingPage locale={locale} />);
  expect(container.querySelector('#pricing')).toHaveTextContent(copy.pricing.business.points[2]!);
  expect(container.querySelector('#faq')).toHaveTextContent(copy.faq.items.find((i) => /sell|jual/i.test(i.q))!.q);
});

it('closes on the ink band', () => {
  const { container } = render(<LandingPage locale="en" />);
  expect(container.querySelector('#final-title')!.closest('[class*="bandInk"]')).not.toBeNull();
});
```

- [ ] **Step 2: `QuietParts.tsx`:**

```tsx
import type { LandingCopy } from './copy.js';
import { Reveal } from './Reveal.js';
import base from './landing.module.css';
import styles from './quiet.module.css';

export function QuietParts({ copy }: { copy: LandingCopy }) {
  return (
    <section className={`${base.bandSurface} ${styles.quiet}`} id="quiet" aria-labelledby="quiet-title">
      <div className={base.wrap}>
        <Reveal>
          <h2 id="quiet-title" className={base.h2}>{copy.quiet.title}</h2>
        </Reveal>
        <ul className={styles.tiles}>
          {copy.quiet.tiles.map((tile, i) => (
            <Reveal as="li" key={tile.title} className={styles.tile} delay={i * 60}>
              <h3 className={styles.title}>{tile.title}</h3>
              <p className={styles.body}>{tile.body}</p>
            </Reveal>
          ))}
        </ul>
      </div>
    </section>
  );
}
```

`quiet.module.css`: 3 columns ≥ 900px, cards like How it works'.

- [ ] **Step 3: Restyle.** `Trust.tsx`: keep markup; in `trust.module.css` drop decorative weight (headline uses `base.h2`, now 700), more space (`padding-block: clamp(72px, 10vw, 128px)`), the facts card on `--card` with hairline, radius 20px. `Pricing.tsx`: section band → `base.bandPaper`; Business card stays `base.bandBiru`. `Faq.tsx`: section band → `base.bandSurface`. `Closing.tsx`: `base.bandDeep` → `base.bandInk`. Match section paddings across all bands (one `--l-section-pad` token in `landing-tokens.css`: `clamp(72px, 10vw, 128px)`).
- [ ] **Step 4:** tests → PASS; web test/typecheck/lint → 0. **Commit** `feat(landing): calmer trust, pricing and FAQ, the quiet parts, and an ink close`.

---

### Task 9: Compose the page, remove what it replaced

**Files:** Modify `LandingPage.tsx`, `copy.ts`, `demo.ts`, `landing.test.tsx`; Delete `Hero.tsx`, `HeroDemo.tsx`, `Storm.tsx`, `StormStage.tsx`, `storm.module.css`, `Leads.tsx`, `LeadsStory.tsx`, `leads.module.css`, `Setup.tsx`, `setup.module.css`.

- [ ] **Step 1: `LandingPage.tsx`** main order:

```tsx
<SmoothScroll />
<Header copy={copy} home={HOME[locale]} otherHome={HOME[other]} />
<main id="main">
  <HeroScene copy={copy} />
  <HowItWorks copy={copy} />
  <PaidMoment copy={copy} />
  <ShopSection copy={copy} />
  <Trust copy={copy} />
  <QuietParts copy={copy} />
  <Pricing copy={copy} />
  <Faq copy={copy} />
</main>
<Closing copy={copy} otherHome={HOME[other]} />
```

Update the doc comment's section list to match.

- [ ] **Step 2: Remove dead copy.** Delete from `LandingCopy`, `en`, `ms`: `storm.title`, `storm.body` (keep `storm.asked`), `leads.title`, `leads.intro`, `leads.replay`, `leads.play`, `leads.playing`, `leads.stepStatus`, `leads.footnote` (Pricing's `business.trial` already says the first three leads are free), `setup` (move `addressExample` use in HowItWorks to `curios.my/${copy.shop.page.handle}`), `hero.tryHint`, `photos.storm`. Grep `_landing/` for every removed key; zero hits.

- [ ] **Step 3: Delete the replaced files** listed above. Grep the repo for imports of each (`git grep -n "Storm\|LeadsStory\|HeroDemo\|Setup.js\|Hero.js" apps/web`); zero hits outside deleted files.

- [ ] **Step 4: Tests.** In `landing.test.tsx` delete `describe('the storm')`, `describe('the leads story')`, `describe('the hero demo')`, the HeroDemo/LeadsStory/askedAt imports, and the `'shows the address being typed on the demo page beside it'` test if it targets Setup. Keep: headings, links (allowed set unchanged — confirm `#how`, `#pricing`, `#faq` exist; `#hero`, `#paid`, `#shop`, `#quiet` are ids but nothing links to them), structured data, metadata, copy, brand colours, monthly/yearly switch, the demo shop's language. Update `"the demo shop speaks the page's language"` to read the hero's phone and the shop demo.
- [ ] **Step 5:** `pnpm --filter @curios/web test; echo "EXIT: $?"` → 0; typecheck, lint → 0. **Commit** `feat(landing): the new page, in order, with the old storm, leads and setup gone`.

---

### Task 10: Docs, size, gates, and a live check

**Files:** Modify `apps/web/app/_landing/README.md`, `devDocs/DESIGN.md`.

- [ ] **Step 1: README.md** — rewrite the Direction, section-order table, Surfaces/band table, Type and Motion sections for this design (cite `devDocs/landing-redesign-design.md`); list the files from this plan's file map; keep "Before launch" (Malay native read — now covering the new strings too).
- [ ] **Step 2: DESIGN.md** — append to the landing exemption: `*Amended 2026-10-13: the Berkira pass.* Bricolage 700 at display sizes on the landing (was 800); two pinned scroll moments (the hero, the paid moment) and a Lenis smooth scroll, landing only, loaded on demand; colour bands kept with more restraint. Frosted surfaces stay banned. Reduced motion still wins: no smooth scroll, no pinning.`
- [ ] **Step 3: Size** — `pnpm --filter @curios/web build > <scratchpad>/build-after.log 2>&1; echo "EXIT: $?"`; report `/` and `/ms` First Load JS before → after. GSAP/Lenis are dynamic imports, so they appear as separate chunks, not in First Load JS; report the chunk sizes from `.next/static/chunks` for the gsap/lenis chunks too.
- [ ] **Step 4: Gates** — `pnpm turbo run test --concurrency=1 --force`, `typecheck`, `lint`, each to a log, `EXIT: 0`, turbo summary lines read with `grep -E "^\s*(Tasks|Cached|Failed):"`.
- [ ] **Step 5: Live check** — start only `pnpm --filter @curios/web dev` in the background; `curl -s http://localhost:3000/ | grep -c` for each hero caption, the shop section title and the new FAQ question (EN), the same on `/ms` (MS); both 200. Stop only the server you started.
- [ ] **Step 6: Commit** `docs(landing): the Berkira pass in the README and DESIGN.md`.
