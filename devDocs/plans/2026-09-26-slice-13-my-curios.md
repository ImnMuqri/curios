# Slice 13 — My Curios Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** give the owner a sidebar dashboard with a My Curios module where they arrange a bento page of links, pick its style, accent, heading font and picture — and make the public page that bento.

**Architecture:** the tile arrangement, colour-readability rule, URL normalisation and link-kind detection are pure functions in a new client-safe `@curios/core/bento` entry, so the API, the public page and the editor's live preview all compute the same thing. Links and appearance get owner-scoped API routes that validate with domain error codes. One server-safe `BentoPage` component renders both the public page and the editor preview. Pictures go to S3-compatible storage through a JSON (base64) upload, switched off in development when unconfigured.

**Tech Stack:** TypeScript ESM, pnpm + turbo, Prisma 6 / Postgres, Fastify 5 + zod, Next 15 app router, React 19, vitest + Testing Library, `@dnd-kit/core` + `@dnd-kit/sortable`, `@aws-sdk/client-s3`, `next/font/google`.

**Spec:** `devDocs/slice-13-build-spec.md` — read it before Task 1. The spec is the authority; this plan is its argument. Where this plan refines the spec (the arrangement for pages of one or two links, the JSON picture upload, the bio limit), Task 10 adds a dated revision note to the spec saying so.

---

## Global Constraints

Every task's requirements implicitly include this section.

**Values. Use these names; never inline a literal where a constant exists.**

| Constant | Value | Home |
|---|---|---|
| `MAX_LINKS` | `30` | `@curios/core/bento` |
| `LABEL_MAX` | `40` (counted in code points) | `@curios/core/bento` |
| `BIO_MAX` | `160` (code points) | `@curios/core/bento` |
| `DISPLAY_NAME_MAX` | `80` | `@curios/core/bento` |
| `DEFAULT_ACCENT` | `'#0c7a62'` | `@curios/core/bento` |
| `ACCENT_PRESETS` | `['#0c7a62','#1f4fd1','#6d3fb3','#c2185b','#d8452f','#e08a1e','#2d6a4f','#10231f']` | `@curios/core/bento` |
| `AVATAR_MAX_BYTES` | `1_048_576` | `apps/api/src/modules/pages/avatar.ts` |
| `AVATAR_EDGE` | `512` | `apps/web/app/app/curios/resize-image.ts` |
| `SAVE_DEBOUNCE_MS` | `600` | `apps/web/app/app/curios/use-autosave.ts` |

**Enums, exactly:** `TileSize = SMALL | WIDE | TALL | BIG`; `PageStyle = SOFT | CONTRAST` (default `SOFT`); `HeadingFont = JAKARTA | BRICOLAGE | FRAUNCES | SPACE_GROTESK | DM_SERIF | OUTFIT` (default `JAKARTA`).

**Allowed link schemes:** `http:`, `https:`, `mailto:`, `tel:`. Nothing else, ever.

**Storage settings, exactly these names:** `STORAGE_ENDPOINT`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`, `STORAGE_PUBLIC_URL`.

**Design rules enforced by `packages/ui/src/design-rules.test.ts`:** a hex colour may appear only in `packages/ui/src/tokens.css` (the test scans every `.module.css` under `packages/ui/src` and `apps/web/app`); font sizes are the six-step scale only — use `var(--text-xs|sm|base|body|lg|display)`. Hex strings in `.ts`/`.tsx` (the presets, the default accent) are data, not stylesheets, and are allowed. The per-page accent reaches CSS as an inline custom property (`--accent`), never a stylesheet literal.

**Any component that uses a React hook needs `'use client'` as its first line.** Vitest does not enforce the server/client boundary; slice 12 broke `/reset` exactly this way with every gate green. Before a task is reported done, load every page it touched from the running dev server and confirm there is no build error:

```bash
for p in /app/curios /signin /imnmuqri; do curl -s -o /tmp/pg.html -w "$p %{http_code} " "http://127.0.0.1:3000$p"; grep -c "Build Error\|needs \`use" /tmp/pg.html; done
```

A `307` (redirect to sign-in) with `0` build errors is a pass for authed pages. If the dev server is not running, say so in the report — do not start one.

**Never accept a Prisma reset prompt.** Use `--create-only` and `prisma migrate deploy`, which never reset. If `prisma generate` fails with `EPERM` on Windows, report **BLOCKED** — do not kill the owner's running processes.

**Never edit `.env`.** It is the owner's file. `.env.example` may be edited.

**API validation lives in services, with domain codes.** Zod schemas on routes only bound payload size: a zod failure reaches the client as `INTERNAL_ERROR` (see `errorsPlugin`), so every rule an owner can break needs its own error class with a code, and every new code is added to `DOMAIN_ERROR_CODES` in `apps/api/src/plugins/errors.ts`.

**Every owner route** narrows `request.account` (throw `UnauthenticatedError`), finds the page by `accountId`, and scopes every read and write to that page's id. Another owner's link id is `404 NOT_FOUND`, never `403`.

**The gates, run from the repo root, exit code read directly, never piped:**

```bash
pnpm turbo run test --concurrency=1 --force
pnpm turbo run typecheck --concurrency=1 --force
pnpm turbo run lint --concurrency=1 --force
```

Each must report **11 successful, 11 total**.

**Tests are proven by mutation.** For every test you write, break the code it covers in the way the task names, confirm red, restore, confirm green. The mutation lists in this plan have been short in every previous slice: before reporting, re-read your diff and write a test for any line that could change with the suite still green, and say in the report what the plan missed.

**Commits.** Conventional-commit subject; every message ends with:

```
Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
```

---

## Review Focus

Inputs the spec implies but a happy-path test would never meet, most likely first. Each has its test in the owning task.

1. **Two tabs, one reorder each.** An owner reorders in one tab after adding a link in another; the second tab's `PUT /links/order` sends a stale set. Expected: `409 LINK_ORDER_STALE`, nothing changes, the editor snaps back. → Task 3.
2. **A pasted address with noise.** `"  HTTPS://WA.ME/60123  "`, `wa.me/60123`, `javascript:alert(1)`, `localhost:3000`. Expected: the first two normalise to `https://wa.me/60123`, the last two are refused. → Task 1.
3. **A label full of emoji.** `"🎂".repeat(40)` is 80 UTF-16 units but 40 characters. Expected: accepted — limits count code points. → Task 1 (the counter) and Task 3 (the API).
4. **A file that lies about its type.** A text file renamed `.png`, or JPEG bytes declared `image/webp`. Expected: `400 INVALID_IMAGE`, old picture kept. → Task 9.
5. **A page with no links.** Expected: the public page shows picture, name, bio and ask bar with no empty grid box; the editor shows an empty state that invites the first link. → Tasks 6 and 7.

---

## File Structure

**New:**

| File | Responsibility |
|---|---|
| `packages/core/src/bento.ts` | Constants, enums, `arrangeTiles`, `readableOn`, `isHexColor`, `normalizeLinkUrl`, `linkKind`, `charCount` — pure, client-safe |
| `packages/core/src/bento.test.ts` | Their tests |
| `packages/db/prisma/migrations/<stamp>_my_curios/migration.sql` | The enums and columns |
| `packages/db-read/src/my-curios.query.ts` (+ `.test.ts`) | `getMyCurios(accountId)`, `countPendingFacts(accountId)` |
| `apps/api/src/modules/links/link.service.ts` | Link rules and writes |
| `apps/api/src/modules/links/link.routes.ts` (+ `link.routes.test.ts`) | `/links` routes |
| `apps/api/src/modules/pages/appearance.service.ts` | `updateAppearance` |
| `apps/api/src/modules/pages/storage.ts` (+ `.test.ts`) | `storageDisabled`, `AvatarStore`, `createS3Store` |
| `apps/api/src/modules/pages/avatar.ts` (+ `.test.ts`) | `decodeAvatar` — size and magic-byte checks |
| `apps/web/lib/fonts.ts` | All `next/font` declarations and `HEADING_FONT_VAR` |
| `apps/web/app/_bento/BentoPage.tsx`, `Bento.module.css`, `Avatar.tsx` (+ tests) | The page renderer shared by `/[handle]` and the preview |
| `apps/web/app/app/app-frame.tsx`, `app-frame.module.css` (+ test) | Sidebar, top bar, phone fold |
| `apps/web/app/app/curios/page.tsx` | The My Curios route |
| `apps/web/app/app/curios/my-curios.tsx` (+ test) | The editor |
| `apps/web/app/app/curios/links-editor.tsx`, `appearance-editor.tsx`, `profile-editor.tsx` (+ tests) | Its three sections |
| `apps/web/app/app/curios/use-autosave.ts` (+ test) | Debounced save with status |
| `apps/web/app/app/curios/resize-image.ts` | Browser-side 512px square resize |
| `apps/web/app/app/curios/curios.module.css` | Editor layout |

**Modified:** `packages/core/package.json` (export), `packages/db/prisma/schema.prisma`, `packages/db-read/src/page.query.ts` + `index.ts`, `apps/api/src/app.ts`, `apps/api/src/plugins/errors.ts`, `apps/api/src/modules/pages/page.routes.ts`, `apps/api/package.json`, `apps/web/package.json`, `apps/web/app/layout.tsx`, `apps/web/app/app/layout.tsx` (+ test), `apps/web/app/app/page.tsx`, `apps/web/app/[handle]/page.tsx` (+ test), `packages/ui/src/tokens.css`, `.env.example`, `devDocs/FRONTEND.md`, `devDocs/DESIGN.md`, `devDocs/README.md`, `devDocs/slice-13-build-spec.md`.

**Removed:** `apps/web/app/app/app-nav.tsx` and its test (replaced by the frame); the `What people ask` section of the public page.

---

### Task 1: the pure bento rules

**Files:**
- Create: `packages/core/src/bento.ts`
- Test: `packages/core/src/bento.test.ts`
- Modify: `packages/core/package.json` (add the `./bento` export)

**Interfaces:**
- Produces (all from `@curios/core/bento`):
  - `TILE_SIZES`, `type TileSize`, `PAGE_STYLES`, `type PageStyle`, `HEADING_FONTS`, `type HeadingFont`
  - `MAX_LINKS`, `LABEL_MAX`, `BIO_MAX`, `DISPLAY_NAME_MAX`, `DEFAULT_ACCENT`, `ACCENT_PRESETS`
  - `charCount(text: string): number`
  - `normalizeLinkUrl(raw: string): string | null`
  - `linkKind(url: string): string`
  - `isHexColor(value: string): boolean`
  - `readableOn(hex: string): 'dark' | 'light'`
  - `type Tone = 'accent' | 'warm' | 'plain'`
  - `arrangeTiles<T extends { size: TileSize | null }>(links: T[]): { link: T; size: TileSize; tone: Tone }[]`

**Context:** this file must stay importable from a client component. The `@curios/core` barrel pulls `node:crypto` transitively, which is why client code never imports it (see `apps/web/app/app/onboarding/page.tsx`). `bento.ts` imports nothing.

- [ ] **Step 1: Write the failing tests**

`packages/core/src/bento.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  arrangeTiles,
  charCount,
  isHexColor,
  LABEL_MAX,
  linkKind,
  normalizeLinkUrl,
  readableOn,
  type TileSize,
} from './bento.js';

const auto = (n: number) => Array.from({ length: n }, () => ({ size: null as TileSize | null }));
const sizes = (n: number) => arrangeTiles(auto(n)).map((t) => t.size);

describe('charCount', () => {
  // "🎂" is two UTF-16 units. A limit on .length would call 20 cakes 40.
  it('counts code points, not UTF-16 units', () => {
    expect(charCount('🎂'.repeat(LABEL_MAX))).toBe(LABEL_MAX);
    expect(charCount('abc')).toBe(3);
  });
});

describe('normalizeLinkUrl', () => {
  it('adds https:// to a bare address and trims noise', () => {
    expect(normalizeLinkUrl('  wa.me/60123  ')).toBe('https://wa.me/60123');
    expect(normalizeLinkUrl('HTTPS://WA.ME/60123')).toBe('https://wa.me/60123');
  });

  it('keeps email and phone links', () => {
    expect(normalizeLinkUrl('mailto:iman@example.com')).toBe('mailto:iman@example.com');
    expect(normalizeLinkUrl('tel:+60123456789')).toBe('tel:+60123456789');
  });

  // A javascript: link on a public page runs in every visitor's browser.
  it('refuses every other scheme', () => {
    expect(normalizeLinkUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeLinkUrl('data:text/html,hi')).toBeNull();
    expect(normalizeLinkUrl('ftp://example.com')).toBeNull();
  });

  it('refuses something that is not an address', () => {
    expect(normalizeLinkUrl('')).toBeNull();
    expect(normalizeLinkUrl('   ')).toBeNull();
    expect(normalizeLinkUrl('localhost:3000')).toBeNull();
    expect(normalizeLinkUrl('not a link')).toBeNull();
  });
});

describe('linkKind', () => {
  it('names the platforms owners link to most', () => {
    expect(linkKind('https://wa.me/60123')).toBe('WhatsApp');
    expect(linkKind('https://www.instagram.com/nadia')).toBe('Instagram');
    expect(linkKind('https://my.linkedin.com/in/iman')).toBe('LinkedIn');
    expect(linkKind('https://shopee.com.my/nadia')).toBe('Shopee');
    expect(linkKind('mailto:a@b.co')).toBe('Email');
    expect(linkKind('tel:+60123')).toBe('Phone');
  });

  it('matches on the host only', () => {
    expect(linkKind('https://notinstagram.com')).toBe('Web');
    expect(linkKind('https://nadia.my/instagram.com')).toBe('Web');
  });
});

describe('isHexColor', () => {
  it('accepts six-digit hex only', () => {
    expect(isHexColor('#0c7a62')).toBe(true);
    expect(isHexColor('#0C7A62')).toBe(true);
    expect(isHexColor('#fff')).toBe(false);
    expect(isHexColor('red')).toBe(false);
    expect(isHexColor('#0c7a62; background:url(x)')).toBe(false);
  });
});

describe('readableOn', () => {
  it('puts light text on a dark accent and dark text on a light one', () => {
    expect(readableOn('#0c7a62')).toBe('light');
    expect(readableOn('#10231f')).toBe('light');
    expect(readableOn('#f2a33c')).toBe('dark');
    expect(readableOn('#ffffff')).toBe('dark');
  });
});

describe('arrangeTiles', () => {
  it('gives one link a wide tile, never a tall one with a hole beside it', () => {
    expect(sizes(1)).toEqual(['WIDE']);
  });

  it('gives two links two tiles side by side', () => {
    expect(sizes(2)).toEqual(['SMALL', 'SMALL']);
  });

  it('builds the shopfront arrangement from three links up', () => {
    expect(sizes(3)).toEqual(['TALL', 'SMALL', 'SMALL']);
    expect(sizes(6)).toEqual(['TALL', 'SMALL', 'SMALL', 'SMALL', 'SMALL', 'WIDE']);
  });

  // An odd number of cells leaves half a row empty at the bottom.
  it('widens the last automatic tile rather than leave a hole', () => {
    expect(sizes(4)).toEqual(['TALL', 'SMALL', 'SMALL', 'WIDE']);
    expect(sizes(7)).toEqual(['TALL', 'SMALL', 'SMALL', 'SMALL', 'SMALL', 'WIDE', 'WIDE']);
  });

  it('keeps a size the owner chose, and does not widen it', () => {
    const tiles = arrangeTiles([{ size: 'BIG' }, { size: null }, { size: 'SMALL' }]);
    expect(tiles.map((t) => t.size)).toEqual(['BIG', 'SMALL', 'SMALL']);
  });

  it('colours the first tile with the accent and the second warm, whatever their size', () => {
    const tones = arrangeTiles([{ size: 'SMALL' }, { size: 'BIG' }, { size: null }]).map((t) => t.tone);
    expect(tones).toEqual(['accent', 'warm', 'plain']);
  });

  it('returns nothing for no links', () => {
    expect(arrangeTiles([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @curios/core exec vitest run src/bento.test.ts`
Expected: FAIL — `Failed to resolve import "./bento.js"`.

- [ ] **Step 3: Write `bento.ts`**

```ts
/**
 * The rules of a My Curios page, shared by the API, the public page and the
 * editor's live preview -- so the preview cannot disagree with the page.
 *
 * Imports nothing. The `@curios/core` barrel reaches `node:crypto`, which a
 * client component may not load; this file is exported on its own
 * (`@curios/core/bento`) so the editor can use it.
 */

export const TILE_SIZES = ['SMALL', 'WIDE', 'TALL', 'BIG'] as const;
export type TileSize = (typeof TILE_SIZES)[number];

export const PAGE_STYLES = ['SOFT', 'CONTRAST'] as const;
export type PageStyle = (typeof PAGE_STYLES)[number];

export const HEADING_FONTS = ['JAKARTA', 'BRICOLAGE', 'FRAUNCES', 'SPACE_GROTESK', 'DM_SERIF', 'OUTFIT'] as const;
export type HeadingFont = (typeof HEADING_FONTS)[number];

export const MAX_LINKS = 30;
export const LABEL_MAX = 40;
export const BIO_MAX = 160;
export const DISPLAY_NAME_MAX = 80;

export const DEFAULT_ACCENT = '#0c7a62';
/** Chosen to look right in both styles. Custom colours are allowed too. */
export const ACCENT_PRESETS = [
  '#0c7a62',
  '#1f4fd1',
  '#6d3fb3',
  '#c2185b',
  '#d8452f',
  '#e08a1e',
  '#2d6a4f',
  '#10231f',
] as const;

/** Characters as a person counts them. "🎂" is one, though it is two UTF-16 units. */
export function charCount(text: string): number {
  return [...text].length;
}

const ALLOWED_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'tel:']);

/**
 * A link as it will be stored, or null when it cannot be one.
 *
 * Owners paste what the address bar shows, often without a scheme, so a bare
 * address gets https://. Only four schemes survive: anything else --
 * javascript:, data: -- would be a clickable link on a public page, running in
 * every visitor's browser.
 */
export function normalizeLinkUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === '' || /\s/.test(trimmed)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (!ALLOWED_SCHEMES.has(url.protocol)) return null;
  // A web address with no dot in its host is a typo or an intranet name, never
  // something a visitor can open.
  if ((url.protocol === 'http:' || url.protocol === 'https:') && !url.hostname.includes('.')) return null;

  // URL adds a trailing slash to a bare origin; keep what the owner typed.
  return url.href.endsWith('/') && !trimmed.endsWith('/') && url.pathname === '/'
    ? url.href.slice(0, -1)
    : url.href;
}

const KINDS: ReadonlyArray<readonly [host: string, name: string]> = [
  ['wa.me', 'WhatsApp'],
  ['whatsapp.com', 'WhatsApp'],
  ['instagram.com', 'Instagram'],
  ['linkedin.com', 'LinkedIn'],
  ['tiktok.com', 'TikTok'],
  ['facebook.com', 'Facebook'],
  ['x.com', 'X'],
  ['twitter.com', 'X'],
  ['youtube.com', 'YouTube'],
  ['youtu.be', 'YouTube'],
  ['github.com', 'GitHub'],
  ['shopee.com.my', 'Shopee'],
  ['lazada.com.my', 'Lazada'],
  ['linktr.ee', 'Linktree'],
];

/** The small label on a tile. Never stored: derived from the address every render. */
export function linkKind(url: string): string {
  if (url.startsWith('mailto:')) return 'Email';
  if (url.startsWith('tel:')) return 'Phone';
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return 'Web';
  }
  const match = KINDS.find(([domain]) => host === domain || host.endsWith(`.${domain}`));
  return match ? match[1] : 'Web';
}

export function isHexColor(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value);
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

/** The ink and paper tokens in tokens.css, which is where text on an accent comes from. */
const INK = luminance('#10231f');
const PAPER = luminance('#fafbfa');

/**
 * Which text colour stays readable on an accent: whichever of ink or paper has
 * the higher WCAG contrast ratio against it. This is why a custom colour cannot
 * make a page unreadable.
 */
export function readableOn(hex: string): 'dark' | 'light' {
  const l = luminance(hex);
  const withInk = (l + 0.05) / (INK + 0.05);
  const withPaper = (PAPER + 0.05) / (l + 0.05);
  return withInk >= withPaper ? 'dark' : 'light';
}

export type Tone = 'accent' | 'warm' | 'plain';

const CELLS: Record<TileSize, number> = { SMALL: 1, WIDE: 2, TALL: 2, BIG: 4 };

function autoSize(index: number, count: number): TileSize {
  // One link: a tall tile would leave its neighbour's column empty.
  if (count === 1) return 'WIDE';
  // Two links: a tall tile beside one small leaves a hole under the small.
  if (count === 2) return 'SMALL';
  if (index === 0) return 'TALL';
  if (index <= 2) return 'SMALL';
  // From the fourth: Small, Small, Wide, repeating.
  return (index - 3) % 3 === 2 ? 'WIDE' : 'SMALL';
}

/**
 * The shopfront arrangement: each link's tile size and colour.
 *
 * A link with a size keeps it. An automatic one takes its size from its
 * position, and the last automatic tile widens when the grid would otherwise
 * end with half a row empty. Tone follows position only: the first tile
 * carries the accent, the second the warm colour.
 */
export function arrangeTiles<T extends { size: TileSize | null }>(
  links: T[],
): { link: T; size: TileSize; tone: Tone }[] {
  const tiles = links.map((link, index) => ({
    link,
    size: link.size ?? autoSize(index, links.length),
    tone: (index === 0 ? 'accent' : index === 1 ? 'warm' : 'plain') as Tone,
  }));

  const last = tiles.at(-1);
  const cells = tiles.reduce((sum, tile) => sum + CELLS[tile.size], 0);
  if (last && last.link.size === null && last.size === 'SMALL' && cells % 2 === 1) last.size = 'WIDE';

  return tiles;
}
```

Add to `packages/core/package.json` `"exports"`:

```json
    "./bento": "./src/bento.ts",
```

- [ ] **Step 4: Run them and watch them pass**

Run: `pnpm --filter @curios/core exec vitest run src/bento.test.ts`
Expected: PASS.

- [ ] **Step 5: Prove by mutation**

| Mutation | Test that must go red |
|---|---|
| `charCount` returns `text.length` | `counts code points, not UTF-16 units` |
| drop `'tel:'` from `ALLOWED_SCHEMES` | `keeps email and phone links` |
| accept any scheme (delete the `has` check) | `refuses every other scheme` |
| delete the no-dot host check | `refuses something that is not an address` (localhost) |
| `host.endsWith(domain)` without the dot | `matches on the host only` |
| `isHexColor` regex without `^…$` anchors | `accepts six-digit hex only` |
| `withInk >= withPaper` → `<=` | `puts light text on a dark accent…` |
| delete the `count === 1` branch | `gives one link a wide tile…` |
| delete the parity fix | `widens the last automatic tile…` |
| apply the parity fix when `last.link.size !== null` too | `keeps a size the owner chose…` |

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/bento.ts packages/core/src/bento.test.ts packages/core/package.json
git commit -m "feat(core): the bento rules -- arrangement, readable text, link addresses"
```

---

### Task 2: the schema and the read queries

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<stamp>_my_curios/migration.sql` (generated)
- Create: `packages/db-read/src/my-curios.query.ts`, `packages/db-read/src/my-curios.query.test.ts`
- Modify: `packages/db-read/src/page.query.ts`, `packages/db-read/src/page.query.test.ts`, `packages/db-read/src/index.ts`

**Interfaces:**
- Consumes: the enum values from Task 1 (the Prisma enums must spell them identically).
- Produces:
  - `PublicPage` gains `style: 'SOFT' | 'CONTRAST'`, `accentColor: string`, `headingFont: HeadingFont`, `avatarKey: string | null`; `PublicLink` gains `size: TileSize | null`.
  - `getMyCurios(accountId: string): Promise<MyCurios | null>` where
    `MyCurios = { id: string; handle: string; displayName: string; bio: string | null; style: PageStyle; accentColor: string; headingFont: HeadingFont; avatarKey: string | null; links: { id: string; label: string; url: string; size: TileSize | null }[] }` (links ordered by `position`).
  - `countPendingFacts(accountId: string): Promise<number>` — facts with `verified: false, rejectedAt: null`, the review queue's own filter.

- [ ] **Step 1: Change the schema**

In `packages/db/prisma/schema.prisma`, add the enums beside the others:

```prisma
enum TileSize {
  SMALL
  WIDE
  TALL
  BIG
}

enum PageStyle {
  SOFT
  CONTRAST
}

enum HeadingFont {
  JAKARTA
  BRICOLAGE
  FRAUNCES
  SPACE_GROTESK
  DM_SERIF
  OUTFIT
}
```

`model Link` gains, after `position`:

```prisma
  /// Null is "automatic": arrangeTiles in @curios/core/bento decides from the
  /// tile's position.
  size     TileSize?
```

`model Page` gains, after `allowSearchIndexing`:

```prisma
  /// Soft is the default look; High contrast is the owner's alternative.
  style       PageStyle   @default(SOFT)
  /// #rrggbb, validated by isHexColor before it is written.
  accentColor String      @default("#0c7a62")
  headingFont HeadingFont @default(JAKARTA)
  /// The object key of the uploaded picture in storage. Null is no picture.
  avatarKey   String?
```

- [ ] **Step 2: Create and apply the migration**

From the repo root:

```bash
pnpm --filter @curios/db exec prisma migrate dev --name my_curios --create-only
```

If Prisma offers to reset anything, **stop and report BLOCKED**. Read the generated `migration.sql`: it must be three `CREATE TYPE` statements and `ALTER TABLE ... ADD COLUMN` statements only — no `DROP`. Then:

```bash
pnpm --filter @curios/db exec prisma migrate deploy
DATABASE_URL="$(grep '^DATABASE_URL_TEST=' .env | cut -d= -f2-)" pnpm --filter @curios/db exec prisma migrate deploy
pnpm --filter @curios/db exec prisma generate
```

- [ ] **Step 3: Write the failing query tests**

`packages/db-read/src/my-curios.query.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { countPendingFacts, getMyCurios } from './my-curios.query.js';

const write = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });
let accountId = '';

beforeAll(async () => {
  await write.$executeRawUnsafe('TRUNCATE "Account" CASCADE');
  const account = await write.account.create({
    data: {
      email: 'curios@example.com',
      pages: {
        create: {
          handle: 'iman',
          skeleton: 'iman',
          displayName: 'Iman Muqri',
          bio: 'Software developer.',
          accentColor: '#6d3fb3',
          links: {
            create: [
              { label: 'GitHub', url: 'https://github.com/iman', position: 1, size: 'WIDE' },
              { label: 'Portfolio', url: 'https://iman.dev', position: 0 },
            ],
          },
          facts: {
            create: [
              { category: 'MISC', claim: 'waiting', normalizedClaim: 'waiting', confidence: 1, verified: false },
              { category: 'MISC', claim: 'accepted', normalizedClaim: 'accepted', confidence: 1, verified: true },
              { category: 'MISC', claim: 'rejected', normalizedClaim: 'rejected', confidence: 1, verified: false, rejectedAt: new Date() },
            ],
          },
        },
      },
    },
    select: { id: true },
  });
  accountId = account.id;
});

afterAll(async () => {
  await write.$disconnect();
});

describe('getMyCurios', () => {
  it('returns the profile, appearance and links in the order visitors see them', async () => {
    const page = await getMyCurios(accountId);

    expect(page).toMatchObject({
      handle: 'iman',
      displayName: 'Iman Muqri',
      bio: 'Software developer.',
      style: 'SOFT',
      accentColor: '#6d3fb3',
      headingFont: 'JAKARTA',
      avatarKey: null,
    });
    expect(page?.links.map((l) => [l.label, l.size])).toEqual([
      ['Portfolio', null],
      ['GitHub', 'WIDE'],
    ]);
  });

  it('is null for an account with no page', async () => {
    const bare = await write.account.create({ data: { email: 'bare@example.com' }, select: { id: true } });
    expect(await getMyCurios(bare.id)).toBeNull();
  });
});

describe('countPendingFacts', () => {
  // The same filter as the review queue, or the sidebar count and the screen
  // it links to disagree.
  it('counts only facts still waiting for review', async () => {
    expect(await countPendingFacts(accountId)).toBe(1);
  });
});
```

In `packages/db-read/src/page.query.test.ts`, add a test beside the existing ones:

```ts
  it('carries the appearance and each link size the page renders with', async () => {
    const page = await getPublicPage('nadia');

    expect(page).toMatchObject({ style: 'SOFT', accentColor: '#0c7a62', headingFont: 'JAKARTA', avatarKey: null });
    expect(page?.links[0]).toMatchObject({ size: null });
  });
```

- [ ] **Step 4: Run them and watch them fail**

Run: `pnpm --filter @curios/db-read exec vitest run src/my-curios.query.test.ts src/page.query.test.ts`
Expected: FAIL — unresolved import, and the new `page.query` assertion failing on missing fields.

- [ ] **Step 5: Write the queries**

`packages/db-read/src/my-curios.query.ts`:

```ts
import type { HeadingFont, PageStyle, TileSize } from '@curios/core/bento';
import { prismaRead } from './client.js';

export interface MyCurios {
  id: string;
  handle: string;
  displayName: string;
  bio: string | null;
  style: PageStyle;
  accentColor: string;
  headingFont: HeadingFont;
  avatarKey: string | null;
  links: { id: string; label: string; url: string; size: TileSize | null }[];
}

/** Everything the My Curios editor starts from, in one query. */
export async function getMyCurios(accountId: string): Promise<MyCurios | null> {
  return prismaRead.page.findUnique({
    where: { accountId },
    select: {
      id: true,
      handle: true,
      displayName: true,
      bio: true,
      style: true,
      accentColor: true,
      headingFont: true,
      avatarKey: true,
      links: { orderBy: { position: 'asc' }, select: { id: true, label: true, url: true, size: true } },
    },
  });
}

/**
 * Facts still waiting for review, for the sidebar's count. The review queue's
 * own filter (review.query.ts), so the number matches the screen it links to.
 */
export async function countPendingFacts(accountId: string): Promise<number> {
  return prismaRead.fact.count({ where: { page: { accountId }, verified: false, rejectedAt: null } });
}
```

In `packages/db-read/src/page.query.ts`: `PublicLink` gains `size: TileSize | null;`; `PublicPage` gains

```ts
  style: PageStyle;
  accentColor: string;
  headingFont: HeadingFont;
  /** The picture's object key, or null. apps/web turns it into a URL. */
  avatarKey: string | null;
```

import `type { HeadingFont, PageStyle, TileSize } from '@curios/core/bento'`, and the `select` gains `style: true, accentColor: true, headingFont: true, avatarKey: true` and, in `links.select`, `size: true`.

`packages/db-read/src/index.ts` gains:

```ts
export { getMyCurios, countPendingFacts } from './my-curios.query.js';
export type { MyCurios } from './my-curios.query.js';
```

- [ ] **Step 6: Run them and watch them pass**

Run: `pnpm --filter @curios/db-read exec vitest run`
Expected: PASS. Then `pnpm turbo run typecheck --concurrency=1 --force` — any other file constructing a `PublicPage` literal (the web page test's fixtures) now fails typecheck; add the four fields with their defaults there (`style: 'SOFT', accentColor: '#0c7a62', headingFont: 'JAKARTA', avatarKey: null`, and `size: null` on links). Grep for them rather than trusting this sentence: `grep -rln "PublicPage\|allowSearchIndexing:" apps packages --include=*.ts --include=*.tsx`.

- [ ] **Step 7: Prove by mutation**

| Mutation | Test that must go red |
|---|---|
| drop `orderBy` from `getMyCurios` links | `returns the profile … in the order visitors see them` |
| drop `rejectedAt: null` from the count | `counts only facts still waiting for review` |
| drop `size: true` from `getPublicPage` | `carries the appearance and each link size…` |

- [ ] **Step 8: Commit**

```bash
git add packages/db packages/db-read apps/web
git commit -m "feat(db): tile sizes and page appearance, and the queries My Curios reads"
```

---

### Task 3: the links API

**Files:**
- Create: `apps/api/src/modules/links/link.service.ts`, `apps/api/src/modules/links/link.routes.ts`
- Test: `apps/api/src/modules/links/link.routes.test.ts`
- Modify: `apps/api/src/app.ts` (register in the session scope), `apps/api/src/plugins/errors.ts`

**Interfaces:**
- Consumes: `normalizeLinkUrl`, `charCount`, `LABEL_MAX`, `MAX_LINKS`, `TILE_SIZES`, `type TileSize` (Task 1); `NoPageError` from `apps/api/src/modules/pages/page.service.ts`.
- Produces (HTTP, all session-scoped):
  - `GET /links` → `200 { links: { id, label, url, size }[] }`
  - `POST /links` body `{ label: string, url: string }` → `201 { link }`
  - `PATCH /links/:id` body `{ label?, url?, size?: TileSize | null }` → `200 { link }`
  - `DELETE /links/:id` → `200 { status: 'removed' }`
  - `PUT /links/order` body `{ ids: string[] }` → `200 { status: 'reordered' }`
  - Error codes: `INVALID_LINK` (400), `LINK_LIMIT` (400), `LINK_ORDER_STALE` (409), `NOT_FOUND` (404), `NO_PAGE` (404).

- [ ] **Step 1: Write the failing tests**

`apps/api/src/modules/links/link.routes.test.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { LABEL_MAX, MAX_LINKS } from '@curios/core/bento';
import { buildApp } from '../../app.js';
import { createSession, SESSION_COOKIE } from '../auth/session.service.js';

let app: FastifyInstance;
let nth = 0;
const from = () => `203.0.113.${(nth++ % 200) + 1}`;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

async function anOwner() {
  const slug = randomUUID().slice(0, 8);
  const account = await app.prisma.account.create({
    data: {
      email: `links-${randomUUID()}@example.com`,
      emailVerifiedAt: new Date(),
      pages: { create: { handle: `ln-${slug}`, skeleton: `ln-${slug}`, displayName: 'Iman' } },
    },
    select: { id: true, pages: { select: { id: true } } },
  });
  const { value } = await createSession(app.prisma, account.id);
  return { cookie: value, pageId: account.pages[0]?.id ?? '' };
}

const call = (cookie: string, method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: object) =>
  app.inject({ method, url, remoteAddress: from(), cookies: { [SESSION_COOKIE]: cookie }, ...(payload ? { payload } : {}) });

const labels = async (cookie: string) =>
  ((await call(cookie, 'GET', '/links')).json() as { links: { label: string }[] }).links.map((l) => l.label);

describe('POST /links', () => {
  it('adds a link, normalising its address, at the end of the list', async () => {
    const owner = await anOwner();
    await call(owner.cookie, 'POST', '/links', { label: 'Portfolio', url: 'iman.dev' });

    const res = await call(owner.cookie, 'POST', '/links', { label: '  WhatsApp  ', url: ' wa.me/60123 ' });

    expect(res.statusCode).toBe(201);
    expect(res.json().link).toMatchObject({ label: 'WhatsApp', url: 'https://wa.me/60123', size: null });
    expect(await labels(owner.cookie)).toEqual(['Portfolio', 'WhatsApp']);
  });

  it('refuses a dangerous address with its own code', async () => {
    const owner = await anOwner();
    const res = await call(owner.cookie, 'POST', '/links', { label: 'x', url: 'javascript:alert(1)' });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('INVALID_LINK');
  });

  it('refuses an empty or over-long label', async () => {
    const owner = await anOwner();
    for (const label of ['   ', 'a'.repeat(LABEL_MAX + 1)]) {
      const res = await call(owner.cookie, 'POST', '/links', { label, url: 'iman.dev' });
      expect(res.json().error.code).toBe('INVALID_LINK');
    }
  });

  // Review Focus 3: the limit is characters, not UTF-16 units.
  it('accepts a label of LABEL_MAX emoji', async () => {
    const owner = await anOwner();
    const res = await call(owner.cookie, 'POST', '/links', { label: '🎂'.repeat(LABEL_MAX), url: 'iman.dev' });
    expect(res.statusCode).toBe(201);
  });

  it('stops at MAX_LINKS', async () => {
    const owner = await anOwner();
    await app.prisma.link.createMany({
      data: Array.from({ length: MAX_LINKS }, (_unused, position) => ({
        pageId: owner.pageId,
        label: `L${position}`,
        url: 'https://iman.dev',
        position,
      })),
    });

    const res = await call(owner.cookie, 'POST', '/links', { label: 'One more', url: 'iman.dev' });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('LINK_LIMIT');
  });
});

describe('PATCH /links/:id', () => {
  it('changes the label, address and size, and a null size means automatic again', async () => {
    const owner = await anOwner();
    const { link } = (await call(owner.cookie, 'POST', '/links', { label: 'A', url: 'a.com' })).json();

    const big = await call(owner.cookie, 'PATCH', `/links/${link.id}`, { label: 'B', url: 'b.com', size: 'BIG' });
    expect(big.json().link).toMatchObject({ label: 'B', url: 'https://b.com', size: 'BIG' });

    const auto = await call(owner.cookie, 'PATCH', `/links/${link.id}`, { size: null });
    expect(auto.json().link.size).toBeNull();
  });

  it("answers 404 for another owner's link, and changes nothing", async () => {
    const owner = await anOwner();
    const stranger = await anOwner();
    const { link } = (await call(owner.cookie, 'POST', '/links', { label: 'Mine', url: 'a.com' })).json();

    const res = await call(stranger.cookie, 'PATCH', `/links/${link.id}`, { label: 'Stolen' });

    expect(res.statusCode).toBe(404);
    expect(await labels(owner.cookie)).toEqual(['Mine']);
  });
});

describe('DELETE /links/:id', () => {
  it('removes the link and closes up the order', async () => {
    const owner = await anOwner();
    const ids: string[] = [];
    for (const label of ['A', 'B', 'C']) {
      ids.push((await call(owner.cookie, 'POST', '/links', { label, url: 'a.com' })).json().link.id);
    }

    await call(owner.cookie, 'DELETE', `/links/${ids[0]}`);

    const rows = await app.prisma.link.findMany({ where: { pageId: owner.pageId }, orderBy: { position: 'asc' } });
    expect(rows.map((r) => [r.label, r.position])).toEqual([['B', 0], ['C', 1]]);
  });
});

describe('PUT /links/order', () => {
  it('applies a new order', async () => {
    const owner = await anOwner();
    const ids: string[] = [];
    for (const label of ['A', 'B', 'C']) {
      ids.push((await call(owner.cookie, 'POST', '/links', { label, url: 'a.com' })).json().link.id);
    }

    const res = await call(owner.cookie, 'PUT', '/links/order', { ids: [ids[2], ids[0], ids[1]] });

    expect(res.statusCode).toBe(200);
    expect(await labels(owner.cookie)).toEqual(['C', 'A', 'B']);
  });

  // Review Focus 1: a second tab reordering a list that has since changed.
  it('refuses a stale set and changes nothing', async () => {
    const owner = await anOwner();
    const a = (await call(owner.cookie, 'POST', '/links', { label: 'A', url: 'a.com' })).json().link.id;
    const b = (await call(owner.cookie, 'POST', '/links', { label: 'B', url: 'a.com' })).json().link.id;
    await call(owner.cookie, 'POST', '/links', { label: 'C', url: 'a.com' }); // added in the other tab

    const res = await call(owner.cookie, 'PUT', '/links/order', { ids: [b, a] });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('LINK_ORDER_STALE');
    expect(await labels(owner.cookie)).toEqual(['A', 'B', 'C']);
  });

  it("refuses an order that includes another owner's link", async () => {
    const owner = await anOwner();
    const stranger = await anOwner();
    const mine = (await call(owner.cookie, 'POST', '/links', { label: 'Mine', url: 'a.com' })).json().link.id;
    const theirs = (await call(stranger.cookie, 'POST', '/links', { label: 'Theirs', url: 'a.com' })).json().link.id;

    const res = await call(owner.cookie, 'PUT', '/links/order', { ids: [theirs, mine] });

    expect(res.statusCode).toBe(409);
  });

  it('refuses a repeated id', async () => {
    const owner = await anOwner();
    const a = (await call(owner.cookie, 'POST', '/links', { label: 'A', url: 'a.com' })).json().link.id;
    await call(owner.cookie, 'POST', '/links', { label: 'B', url: 'a.com' });

    const res = await call(owner.cookie, 'PUT', '/links/order', { ids: [a, a] });

    expect(res.statusCode).toBe(409);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @curios/api exec vitest run src/modules/links`
Expected: FAIL — `404` from every route (not registered).

- [ ] **Step 3: Write the service**

`apps/api/src/modules/links/link.service.ts`:

```ts
import type { PrismaClient } from '@curios/db';
import { charCount, LABEL_MAX, MAX_LINKS, normalizeLinkUrl, type TileSize } from '@curios/core/bento';
import { NoPageError } from '../pages/page.service.js';

export class InvalidLinkError extends Error {
  readonly statusCode = 400;
  readonly code = 'INVALID_LINK';
  constructor(message: string) {
    super(message);
    this.name = 'InvalidLinkError';
  }
}

export class LinkLimitError extends Error {
  readonly statusCode = 400;
  readonly code = 'LINK_LIMIT';
  constructor() {
    super(`A page holds at most ${MAX_LINKS} links. Remove one to add another.`);
    this.name = 'LinkLimitError';
  }
}

export class LinkNotFoundError extends Error {
  readonly statusCode = 404;
  readonly code = 'NOT_FOUND';
  constructor() {
    super('No such link.');
    this.name = 'LinkNotFoundError';
  }
}

/** Another tab changed the list after this one loaded it. */
export class LinkOrderStaleError extends Error {
  readonly statusCode = 409;
  readonly code = 'LINK_ORDER_STALE';
  constructor() {
    super('Your links changed somewhere else. Reload to see the latest, then try again.');
    this.name = 'LinkOrderStaleError';
  }
}

const SELECT = { id: true, label: true, url: true, size: true } as const;
export type LinkRow = { id: string; label: string; url: string; size: TileSize | null };

async function pageIdFor(prisma: PrismaClient, accountId: string): Promise<string> {
  const page = await prisma.page.findUnique({ where: { accountId }, select: { id: true } });
  if (!page) throw new NoPageError();
  return page.id;
}

function checkLabel(raw: string): string {
  const label = raw.trim();
  if (label === '' || charCount(label) > LABEL_MAX) {
    throw new InvalidLinkError(`Give the link a name, up to ${LABEL_MAX} characters.`);
  }
  return label;
}

function checkUrl(raw: string): string {
  const url = normalizeLinkUrl(raw);
  if (!url) {
    throw new InvalidLinkError('That link does not look right. Use a web address, an email (mailto:) or a phone number (tel:).');
  }
  return url;
}

export async function listLinks(prisma: PrismaClient, accountId: string): Promise<LinkRow[]> {
  const pageId = await pageIdFor(prisma, accountId);
  return prisma.link.findMany({ where: { pageId }, orderBy: { position: 'asc' }, select: SELECT });
}

/**
 * Appended last. The count-then-create can let two simultaneous adds reach
 * MAX_LINKS + 1; the limit is a product rule, not a safety one, and one extra
 * link is not worth a lock.
 */
export async function addLink(
  prisma: PrismaClient,
  accountId: string,
  input: { label: string; url: string },
): Promise<LinkRow> {
  const label = checkLabel(input.label);
  const url = checkUrl(input.url);
  const pageId = await pageIdFor(prisma, accountId);

  const count = await prisma.link.count({ where: { pageId } });
  if (count >= MAX_LINKS) throw new LinkLimitError();

  return prisma.link.create({ data: { pageId, label, url, position: count }, select: SELECT });
}

export async function updateLink(
  prisma: PrismaClient,
  accountId: string,
  id: string,
  input: { label?: string; url?: string; size?: TileSize | null },
): Promise<LinkRow> {
  const data: { label?: string; url?: string; size?: TileSize | null } = {};
  if (input.label !== undefined) data.label = checkLabel(input.label);
  if (input.url !== undefined) data.url = checkUrl(input.url);
  if (input.size !== undefined) data.size = input.size;

  const pageId = await pageIdFor(prisma, accountId);
  const updated = await prisma.link.updateMany({ where: { id, pageId }, data });
  if (updated.count !== 1) throw new LinkNotFoundError();
  return prisma.link.findUniqueOrThrow({ where: { id }, select: SELECT });
}

export async function removeLink(prisma: PrismaClient, accountId: string, id: string): Promise<void> {
  const pageId = await pageIdFor(prisma, accountId);
  await prisma.$transaction(async (tx) => {
    const link = await tx.link.findFirst({ where: { id, pageId }, select: { position: true } });
    if (!link) throw new LinkNotFoundError();
    await tx.link.delete({ where: { id } });
    // Close the gap, so positions stay 0..n-1 and the next add lands last.
    await tx.link.updateMany({ where: { pageId, position: { gt: link.position } }, data: { position: { decrement: 1 } } });
  });
}

/**
 * The whole order in one transaction, refused unless `ids` is exactly the
 * page's current set -- no more, no fewer, no repeats. A second tab working
 * from a list that has since changed gets LINK_ORDER_STALE, not a silent
 * half-applied order.
 */
export async function reorderLinks(prisma: PrismaClient, accountId: string, ids: string[]): Promise<void> {
  const pageId = await pageIdFor(prisma, accountId);
  await prisma.$transaction(async (tx) => {
    const current = await tx.link.findMany({ where: { pageId }, select: { id: true } });
    const known = new Set(current.map((link) => link.id));
    const sent = new Set(ids);
    if (sent.size !== ids.length || sent.size !== known.size || ids.some((id) => !known.has(id))) {
      throw new LinkOrderStaleError();
    }
    for (const [position, id] of ids.entries()) {
      await tx.link.update({ where: { id }, data: { position } });
    }
  });
}
```

- [ ] **Step 4: Write the routes and register them**

`apps/api/src/modules/links/link.routes.ts`:

```ts
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { TILE_SIZES } from '@curios/core/bento';
import { UnauthenticatedError } from '../../plugins/session.js';
import { addLink, listLinks, removeLink, reorderLinks, updateLink } from './link.service.js';

// Payload bounds only. Every rule an owner can break is checked in the service,
// where it has a code and a sentence; a zod failure reaches them as INTERNAL_ERROR.
const params = z.object({ id: z.string().min(1).max(64) });
const label = z.string().max(400);
const url = z.string().max(2000);

export const linkRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/links', async (request) => {
    if (!request.account) throw new UnauthenticatedError();
    return { links: await listLinks(app.prisma, request.account.id) };
  });

  app.post('/links', { schema: { body: z.object({ label, url }) } }, async (request, reply) => {
    if (!request.account) throw new UnauthenticatedError();
    const link = await addLink(app.prisma, request.account.id, request.body);
    return reply.status(201).send({ link });
  });

  app.patch(
    '/links/:id',
    {
      schema: {
        params,
        body: z.object({ label: label.optional(), url: url.optional(), size: z.enum(TILE_SIZES).nullable().optional() }),
      },
    },
    async (request) => {
      if (!request.account) throw new UnauthenticatedError();
      return { link: await updateLink(app.prisma, request.account.id, request.params.id, request.body) };
    },
  );

  app.delete('/links/:id', { schema: { params } }, async (request) => {
    if (!request.account) throw new UnauthenticatedError();
    await removeLink(app.prisma, request.account.id, request.params.id);
    return { status: 'removed' };
  });

  app.put(
    '/links/order',
    { schema: { body: z.object({ ids: z.array(z.string().min(1).max(64)).max(200) }) } },
    async (request) => {
      if (!request.account) throw new UnauthenticatedError();
      await reorderLinks(app.prisma, request.account.id, request.body.ids);
      return { status: 'reordered' };
    },
  );
};
```

In `apps/api/src/app.ts`, import `linkRoutes` and register it inside the existing `requireSession` scope beside `pageRoutes`:

```ts
    await scope.register(linkRoutes);
```

In `apps/api/src/plugins/errors.ts`, add to `DOMAIN_ERROR_CODES` with a comment in the file's style:

```ts
  // My Curios: a link an owner typed wrong, one too many, or an order from a
  // tab that is behind. Each says what to do next.
  'INVALID_LINK',
  'LINK_LIMIT',
  'LINK_ORDER_STALE',
```

- [ ] **Step 5: Run them and watch them pass**

Run: `pnpm --filter @curios/api exec vitest run src/modules/links`
Expected: PASS.

- [ ] **Step 6: Prove by mutation**

| Mutation | Test that must go red |
|---|---|
| store `input.url` instead of the normalised url | `adds a link, normalising its address…` |
| `charCount(label)` → `label.length` | `accepts a label of LABEL_MAX emoji` |
| `>=` → `>` in the limit check | `stops at MAX_LINKS` |
| drop `pageId` from `updateLink`'s `where` | `answers 404 for another owner's link…` |
| delete the gap-closing `updateMany` | `removes the link and closes up the order` |
| delete the `sent.size !== known.size` clause | `refuses a stale set…` |
| delete the `sent.size !== ids.length` clause | `refuses a repeated id` |
| remove a code from `DOMAIN_ERROR_CODES` | the test asserting that code |

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/links apps/api/src/app.ts apps/api/src/plugins/errors.ts
git commit -m "feat(api): links an owner can add, edit, size, remove and reorder"
```

---

### Task 4: the appearance API

**Files:**
- Create: `apps/api/src/modules/pages/appearance.service.ts`
- Modify: `apps/api/src/modules/pages/page.routes.ts`, `apps/api/src/plugins/errors.ts`
- Test: `apps/api/src/modules/pages/appearance.test.ts`

**Interfaces:**
- Consumes: `isHexColor`, `charCount`, `BIO_MAX`, `DISPLAY_NAME_MAX`, `PAGE_STYLES`, `HEADING_FONTS` (Task 1).
- Produces: `PATCH /pages/appearance` body `{ style?, accentColor?, headingFont?, displayName?, bio?: string | null }` → `200 { appearance: { style, accentColor, headingFont, displayName, bio } }`; error `INVALID_APPEARANCE` (400).

- [ ] **Step 1: Write the failing tests**

`apps/api/src/modules/pages/appearance.test.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { BIO_MAX } from '@curios/core/bento';
import { buildApp } from '../../app.js';
import { createSession, SESSION_COOKIE } from '../auth/session.service.js';

let app: FastifyInstance;
let nth = 0;
const from = () => `203.0.113.${(nth++ % 200) + 1}`;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});
afterAll(async () => {
  await app.close();
});

async function anOwner() {
  const slug = randomUUID().slice(0, 8);
  const account = await app.prisma.account.create({
    data: {
      email: `look-${randomUUID()}@example.com`,
      emailVerifiedAt: new Date(),
      pages: { create: { handle: `ap-${slug}`, skeleton: `ap-${slug}`, displayName: 'Iman' } },
    },
    select: { id: true },
  });
  return (await createSession(app.prisma, account.id)).value;
}

const patch = (cookie: string, payload: object) =>
  app.inject({ method: 'PATCH', url: '/pages/appearance', remoteAddress: from(), cookies: { [SESSION_COOKIE]: cookie }, payload });

describe('PATCH /pages/appearance', () => {
  it('saves only what was sent', async () => {
    const cookie = await anOwner();
    await patch(cookie, { style: 'CONTRAST' });

    const res = await patch(cookie, { accentColor: '#6D3FB3', headingFont: 'FRAUNCES' });

    expect(res.statusCode).toBe(200);
    // Lower-cased on the way in, and the style from the first call kept.
    expect(res.json().appearance).toMatchObject({ style: 'CONTRAST', accentColor: '#6d3fb3', headingFont: 'FRAUNCES' });
  });

  it('refuses a colour that is not six-digit hex', async () => {
    const cookie = await anOwner();
    for (const accentColor of ['red', '#fff', '#0c7a62;background:url(x)']) {
      const res = await patch(cookie, { accentColor });
      expect(res.json().error.code).toBe('INVALID_APPEARANCE');
    }
  });

  it('trims the name and refuses an empty one', async () => {
    const cookie = await anOwner();
    expect((await patch(cookie, { displayName: '  Iman Muqri  ' })).json().appearance.displayName).toBe('Iman Muqri');
    expect((await patch(cookie, { displayName: '   ' })).json().error.code).toBe('INVALID_APPEARANCE');
  });

  it('clears the bio with an empty string, and refuses one over BIO_MAX', async () => {
    const cookie = await anOwner();
    await patch(cookie, { bio: 'Developer.' });

    expect((await patch(cookie, { bio: '   ' })).json().appearance.bio).toBeNull();
    expect((await patch(cookie, { bio: 'x'.repeat(BIO_MAX + 1) })).json().error.code).toBe('INVALID_APPEARANCE');
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @curios/api exec vitest run src/modules/pages/appearance.test.ts`
Expected: FAIL — route returns 404.

- [ ] **Step 3: Write the service and route**

`apps/api/src/modules/pages/appearance.service.ts`:

```ts
import type { PrismaClient } from '@curios/db';
import {
  BIO_MAX,
  charCount,
  DISPLAY_NAME_MAX,
  isHexColor,
  type HeadingFont,
  type PageStyle,
} from '@curios/core/bento';
import { NoPageError } from './page.service.js';

export class InvalidAppearanceError extends Error {
  readonly statusCode = 400;
  readonly code = 'INVALID_APPEARANCE';
  constructor(message: string) {
    super(message);
    this.name = 'InvalidAppearanceError';
  }
}

export interface Appearance {
  style: PageStyle;
  accentColor: string;
  headingFont: HeadingFont;
  displayName: string;
  bio: string | null;
}

export async function updateAppearance(
  prisma: PrismaClient,
  accountId: string,
  input: Partial<Omit<Appearance, 'bio'>> & { bio?: string | null },
): Promise<Appearance> {
  const data: Partial<Appearance> = {};
  if (input.style !== undefined) data.style = input.style;
  if (input.headingFont !== undefined) data.headingFont = input.headingFont;
  if (input.accentColor !== undefined) {
    if (!isHexColor(input.accentColor)) throw new InvalidAppearanceError('Pick a colour, or type one as six-digit hex like #0c7a62.');
    data.accentColor = input.accentColor.toLowerCase();
  }
  if (input.displayName !== undefined) {
    const name = input.displayName.trim();
    if (name === '' || charCount(name) > DISPLAY_NAME_MAX) {
      throw new InvalidAppearanceError(`Your name is needed, up to ${DISPLAY_NAME_MAX} characters.`);
    }
    data.displayName = name;
  }
  if (input.bio !== undefined) {
    const bio = input.bio?.trim() ?? '';
    if (charCount(bio) > BIO_MAX) throw new InvalidAppearanceError(`Keep the bio to ${BIO_MAX} characters.`);
    data.bio = bio === '' ? null : bio;
  }

  const updated = await prisma.page.updateMany({ where: { accountId }, data });
  if (updated.count !== 1) throw new NoPageError();
  return prisma.page.findUniqueOrThrow({
    where: { accountId },
    select: { style: true, accentColor: true, headingFont: true, displayName: true, bio: true },
  });
}
```

In `apps/api/src/modules/pages/page.routes.ts`, add:

```ts
  app.patch(
    '/pages/appearance',
    {
      schema: {
        body: z.object({
          style: z.enum(PAGE_STYLES).optional(),
          accentColor: z.string().max(40).optional(),
          headingFont: z.enum(HEADING_FONTS).optional(),
          displayName: z.string().max(400).optional(),
          bio: z.string().max(2000).nullable().optional(),
        }),
      },
    },
    async (request) => {
      if (!request.account) throw new UnauthenticatedError();
      return { appearance: await updateAppearance(app.prisma, request.account.id, request.body) };
    },
  );
```

with imports `PAGE_STYLES, HEADING_FONTS` from `@curios/core/bento` and `updateAppearance` from `./appearance.service.js`. Add `'INVALID_APPEARANCE'` to `DOMAIN_ERROR_CODES` with a one-line comment.

- [ ] **Step 4: Run them and watch them pass**

Run: `pnpm --filter @curios/api exec vitest run src/modules/pages`
Expected: PASS.

- [ ] **Step 5: Prove by mutation**

| Mutation | Test that must go red |
|---|---|
| drop `.toLowerCase()` | `saves only what was sent` |
| write every field unconditionally (`data.style = input.style`) | `saves only what was sent` (style reset) |
| drop the `isHexColor` check | `refuses a colour…` |
| drop `.trim()` on the name | `trims the name…` |
| store `''` instead of null | `clears the bio…` |

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/pages apps/api/src/plugins/errors.ts
git commit -m "feat(api): save a page's style, accent, heading font, name and bio"
```

---

### Task 5: the dashboard frame

**Files:**
- Create: `apps/web/lib/fonts.ts`, `apps/web/app/app/app-frame.tsx`, `apps/web/app/app/app-frame.module.css`, `apps/web/app/app/app-frame.test.tsx`
- Modify: `apps/web/app/layout.tsx`, `apps/web/app/app/layout.tsx`, `apps/web/app/app/layout.test.tsx`, `apps/web/app/app/page.tsx`
- Create: `apps/web/app/app/curios/page.tsx` (a placeholder that Task 7 replaces)
- Remove: `apps/web/app/app/app-nav.tsx` and `apps/web/app/app/app-nav.test.tsx`

**Interfaces:**
- Consumes: `countPendingFacts`, `getOwnerPage` (Task 2 / existing).
- Produces:
  - `AppFrame({ displayName, handle, pendingReview, children })` — client component.
  - `HEADING_FONT_VAR: Record<HeadingFont, string>` and `fontVariables: string` (all next/font `.variable` class names) from `apps/web/lib/fonts.ts`.
  - `/app` redirects to `/app/curios` when a page exists.

- [ ] **Step 1: Declare every font once**

`apps/web/lib/fonts.ts`:

```ts
import {
  Bricolage_Grotesque,
  DM_Serif_Display,
  Fraunces,
  IBM_Plex_Mono,
  Inter,
  Outfit,
  Plus_Jakarta_Sans,
  Space_Grotesk,
} from 'next/font/google';
import type { HeadingFont } from '@curios/core/bento';

/*
 * Self-hosted at build time by next/font. The heading fonts are declared with
 * preload: false: a font's file is only fetched when something on the page
 * uses it, so a visitor downloads the one face their page chose, not six.
 */
const bricolage = Bricolage_Grotesque({ subsets: ['latin'], variable: '--font-bricolage', display: 'swap' });
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const plexMono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-plex-mono', display: 'swap' });
const jakarta = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--font-jakarta', display: 'swap', preload: false });
const fraunces = Fraunces({ subsets: ['latin'], variable: '--font-fraunces', display: 'swap', preload: false });
const spaceGrotesk = Space_Grotesk({ subsets: ['latin'], variable: '--font-space-grotesk', display: 'swap', preload: false });
const dmSerif = DM_Serif_Display({ subsets: ['latin'], weight: '400', variable: '--font-dm-serif', display: 'swap', preload: false });
const outfit = Outfit({ subsets: ['latin'], variable: '--font-outfit', display: 'swap', preload: false });

export const fontVariables = [bricolage, inter, plexMono, jakarta, fraunces, spaceGrotesk, dmSerif, outfit]
  .map((font) => font.variable)
  .join(' ');

/** The CSS variable each heading font resolves through, for `--font-heading`. */
export const HEADING_FONT_VAR: Record<HeadingFont, string> = {
  JAKARTA: 'var(--font-jakarta)',
  BRICOLAGE: 'var(--font-bricolage)',
  FRAUNCES: 'var(--font-fraunces)',
  SPACE_GROTESK: 'var(--font-space-grotesk)',
  DM_SERIF: 'var(--font-dm-serif)',
  OUTFIT: 'var(--font-outfit)',
};
```

In `apps/web/app/layout.tsx`, delete the three inline font declarations and their import, import `{ fontVariables } from '../lib/fonts.js'`, and use `<html lang="en" className={fontVariables}>`. Keep the existing comment's point (self-hosted, the variable seam) on `fonts.ts`.

- [ ] **Step 2: Write the failing frame tests**

`apps/web/app/app/app-frame.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('next/navigation', () => ({ usePathname: () => '/app/curios' }));
const { AppFrame } = await import('./app-frame.js');

const frame = (pendingReview = 3) =>
  render(
    <AppFrame displayName="Iman Muqri" handle="imnmuqri" pendingReview={pendingReview}>
      <p>content</p>
    </AppFrame>,
  );

describe('AppFrame', () => {
  it('groups the modules, My Curios first', () => {
    frame();
    const nav = screen.getByRole('navigation', { name: 'Dashboard' });
    expect(within(nav).getAllByRole('link').map((a) => a.textContent)).toEqual([
      'My Curios',
      'Review3',
      'Add a source',
      'Questions',
      'Leads',
      'Billing',
      'Settings',
    ]);
  });

  it('marks where the owner is', () => {
    frame();
    expect(screen.getByRole('link', { name: 'My Curios' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: /review/i })).not.toHaveAttribute('aria-current');
  });

  it('shows no count when nothing is waiting', () => {
    frame(0);
    expect(screen.getByRole('link', { name: 'Review' }).textContent).toBe('Review');
  });

  it('links to the public page, and shows no live badge', () => {
    frame();
    expect(screen.getByRole('link', { name: /view page/i })).toHaveAttribute('href', '/imnmuqri');
    expect(screen.queryByText(/^live$/i)).toBeNull();
  });

  // On a phone the sidebar folds away behind a menu button.
  it('opens and closes the menu', async () => {
    frame();
    const toggle = screen.getByRole('button', { name: /menu/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });

  it('renders the screen it wraps', () => {
    frame();
    expect(screen.getByText('content')).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run them and watch them fail**

Run: `pnpm --filter @curios/web exec vitest run app/app/app-frame.test.tsx`
Expected: FAIL — unresolved import.

- [ ] **Step 4: Write the frame**

`apps/web/app/app/app-frame.tsx`:

```tsx
'use client';

import { useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import styles from './app-frame.module.css';

type Item = { href: string; label: string; icon: ReactNode };

const svg = (path: ReactNode) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className={styles.icon}>
    {path}
  </svg>
);

const GROUPS: { title: string; items: Item[] }[] = [
  {
    title: 'Your page',
    items: [
      { href: '/app/curios', label: 'My Curios', icon: svg(<><rect x="3" y="3" width="8" height="10" rx="2" /><rect x="13" y="3" width="8" height="6" rx="2" /><rect x="13" y="11" width="8" height="10" rx="2" /><rect x="3" y="15" width="8" height="6" rx="2" /></>) },
      { href: '/app/review', label: 'Review', icon: svg(<><path d="M9 11l3 3 8-8" /><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9" /></>) },
      { href: '/app/onboarding', label: 'Add a source', icon: svg(<path d="M12 5v14M5 12h14" />) },
    ],
  },
  {
    title: 'Visitors',
    items: [
      { href: '/app/questions', label: 'Questions', icon: svg(<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />) },
      { href: '/app/leads', label: 'Leads', icon: svg(<><circle cx="9" cy="7" r="4" /><path d="M2 21v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2" /></>) },
    ],
  },
  {
    title: 'Account',
    items: [
      { href: '/app/billing', label: 'Billing', icon: svg(<><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /></>) },
      { href: '/app/settings', label: 'Settings', icon: svg(<><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" /></>) },
    ],
  },
];

const TITLES: Record<string, string> = Object.fromEntries(
  GROUPS.flatMap((group) => group.items.map((item) => [item.href, `${group.title} / ${item.label}`])),
);

/**
 * The dashboard's frame: a sidebar of grouped modules, a top bar with where
 * you are and a way to see your page, and the screen itself.
 *
 * A client component for two reasons: it reads the pathname to mark the
 * current module, and on a phone the sidebar folds behind a menu button with
 * its own open state. The layout (a Server Component) passes plain values.
 */
export function AppFrame({
  displayName,
  handle,
  pendingReview,
  children,
}: {
  displayName: string;
  handle: string;
  pendingReview: number;
  children: ReactNode;
}) {
  const pathname = usePathname() ?? '';
  const [open, setOpen] = useState(false);
  const initials = displayName.split(/\s+/).map((part) => part[0] ?? '').join('').slice(0, 2).toUpperCase();

  return (
    <div className={styles.frame}>
      <aside className={styles.side} data-open={open}>
        <div className={styles.brand}>
          <span className={styles.mark} aria-hidden="true">c</span>curios
        </div>
        <nav aria-label="Dashboard" id="dashboard-nav">
          {GROUPS.map((group) => (
            <div key={group.title}>
              <p className={styles.group}>{group.title}</p>
              {group.items.map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  className={styles.item}
                  aria-current={pathname.startsWith(item.href) ? 'page' : undefined}
                >
                  {item.icon}
                  {item.label}
                  {item.href === '/app/review' && pendingReview > 0 ? (
                    <span className={styles.count}>{pendingReview}</span>
                  ) : null}
                </a>
              ))}
            </div>
          ))}
        </nav>
        <div className={styles.who}>
          <span className={styles.avatar} aria-hidden="true">{initials}</span>
          <span>
            {displayName}
            <small>curios.my/{handle}</small>
          </span>
        </div>
      </aside>

      <div className={styles.main}>
        <header className={styles.top}>
          <button
            type="button"
            className={styles.menu}
            aria-expanded={open}
            aria-controls="dashboard-nav"
            onClick={() => setOpen((shown) => !shown)}
          >
            Menu
          </button>
          <span className={styles.crumb}>{TITLES[Object.keys(TITLES).find((href) => pathname.startsWith(href)) ?? ''] ?? ''}</span>
          <a className={styles.view} href={`/${handle}`} target="_blank" rel="noreferrer">
            View page ↗
          </a>
        </header>
        <div className={styles.content}>{children}</div>
      </div>
    </div>
  );
}
```

`apps/web/app/app/app-frame.module.css` (tokens only, scale sizes only):

```css
/* The dashboard speaks Plus Jakarta Sans; the public page keeps its own fonts. */
.frame {
  --font-display: var(--font-jakarta), system-ui, sans-serif;
  --font-body: var(--font-jakarta), system-ui, sans-serif;
  display: flex;
  min-height: 100vh;
  background: var(--paper);
  color: var(--ink);
  font-family: var(--font-body);
}

.side {
  width: 232px;
  flex: none;
  display: flex;
  flex-direction: column;
  padding: 18px 12px;
  background: var(--card);
  border-right: 1px solid var(--line);
}

.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 2px 8px 18px;
  font-weight: 800;
  font-size: var(--text-body);
  letter-spacing: -0.02em;
}

.mark {
  width: 22px;
  height: 22px;
  border-radius: 6px;
  display: grid;
  place-items: center;
  background: var(--hijau);
  color: var(--card);
  font-size: var(--text-sm);
}

.group {
  margin: 12px 0 4px;
  padding: 0 10px;
  font-size: var(--text-xs);
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
}

.item {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 40px;
  padding: 0 10px;
  border-radius: 8px;
  font-size: var(--text-base);
  font-weight: 500;
  color: var(--ink);
  text-decoration: none;
  transition: background-color 120ms ease;
}

.item:hover {
  background: var(--surface);
}

.item[aria-current='page'] {
  background: var(--mint);
  color: var(--hijau);
  font-weight: 700;
}

.icon {
  width: 16px;
  height: 16px;
  flex: none;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.count {
  margin-left: auto;
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--kuning);
  color: var(--ink);
  font-size: var(--text-xs);
  font-weight: 700;
}

.who {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: auto;
  padding: 12px 8px 0;
  border-top: 1px solid var(--line);
  font-size: var(--text-sm);
  font-weight: 600;
}

.who small {
  display: block;
  font-weight: 400;
  color: var(--muted);
}

.avatar {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: var(--mint);
  color: var(--hijau);
  font-size: var(--text-xs);
  font-weight: 700;
}

.main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.top {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 56px;
  padding: 0 24px;
  background: var(--card);
  border-bottom: 1px solid var(--line);
  font-size: var(--text-base);
}

.crumb {
  color: var(--muted);
}

.view {
  margin-left: auto;
  padding: 7px 12px;
  border: 1.5px solid var(--ink);
  border-radius: 8px;
  color: var(--ink);
  font-size: var(--text-sm);
  font-weight: 700;
  text-decoration: none;
}

.menu {
  display: none;
}

.content {
  padding: 28px 24px 64px;
}

/* A phone: the sidebar folds behind the menu button. */
@media (max-width: 760px) {
  .frame {
    flex-direction: column;
  }

  .side {
    display: none;
    width: 100%;
    border-right: 0;
    border-bottom: 1px solid var(--line);
  }

  .side[data-open='true'] {
    display: flex;
  }

  .menu {
    display: inline-flex;
    min-height: 40px;
    align-items: center;
    padding: 0 12px;
    border: 1.5px solid var(--line);
    border-radius: 8px;
    background: var(--card);
    font: inherit;
    font-weight: 600;
  }

  .content {
    padding: 20px 16px 48px;
  }
}
```

Add the two new tokens to `packages/ui/src/tokens.css` inside `:root`, with a comment:

```css
  /* Surfaces the My Curios slice needs: a card lifted off --paper, and the hairline between panels. */
  --card: #ffffff;
  --line: #e3e8e5;
```

- [ ] **Step 5: Wire the layout and the router**

`apps/web/app/app/layout.tsx` — replace the body of `AppLayout` after `const page = await getOwnerPage(owner.accountId);` with:

```tsx
  // No page yet: onboarding, full width, no frame -- the modules would all be
  // unreachable (the reason the old nav was gated on the page, kept).
  if (!page) return <Shell>{children}</Shell>;

  const pendingReview = await countPendingFacts(owner.accountId);
  return (
    <AppFrame displayName={page.displayName} handle={page.handle} pendingReview={pendingReview}>
      {children}
    </AppFrame>
  );
```

importing `countPendingFacts` from `@curios/db-read` and `AppFrame` from `./app-frame.js`; remove the `AppNav` import and delete `app-nav.tsx` and `app-nav.test.tsx`. Keep the file's existing comment about why the frame is gated on the page, reworded from "nav" to "frame".

`apps/web/app/app/page.tsx` — `redirect(page ? '/app/curios' : '/app/onboarding');` and update its comment to say My Curios is where an owner with a page lands.

`apps/web/app/app/curios/page.tsx` (placeholder until Task 7):

```tsx
export default function MyCuriosPage() {
  return <h1>My Curios</h1>;
}
```

In `apps/web/app/app/layout.test.tsx`: the two nav tests become frame tests — mock `countPendingFacts` alongside `getOwnerPage`, assert the `Dashboard` navigation renders for an owner with a page, and is absent for an owner without one. Keep the third test unchanged.

- [ ] **Step 6: Run the web tests and watch them pass**

Run: `pnpm --filter @curios/web exec vitest run app/app`
Expected: PASS.

- [ ] **Step 7: Prove by mutation, then load it**

| Mutation | Test that must go red |
|---|---|
| `aria-current` never set (`undefined` always) | `marks where the owner is` |
| show the count when `pendingReview >= 0` | `shows no count when nothing is waiting` |
| drop `aria-expanded` toggling | `opens and closes the menu` |
| render the frame when `page` is null | the layout test for an owner without a page |

Then run the dev-server check from Global Constraints for `/app/curios` and `/app/review`.

- [ ] **Step 8: Commit**

```bash
git add apps/web packages/ui/src/tokens.css
git commit -m "feat(web): a sidebar dashboard, with My Curios where an owner lands"
```

---

### Task 6: the public bento page

**Files:**
- Create: `apps/web/app/_bento/BentoPage.tsx`, `apps/web/app/_bento/Bento.module.css`, `apps/web/app/_bento/Avatar.tsx`, `apps/web/app/_bento/BentoPage.test.tsx`
- Create: `apps/web/lib/avatar-url.ts`
- Modify: `apps/web/app/[handle]/page.tsx`, `apps/web/app/[handle]/page.test.tsx`, `apps/web/app/[handle]/page.module.css`, `packages/ui/src/tokens.css`

**Interfaces:**
- Consumes: `arrangeTiles`, `linkKind`, `readableOn`, types (Task 1); `HEADING_FONT_VAR` (Task 5); `PublicPage` fields (Task 2).
- Produces:
  - `BentoPage(props: BentoPageProps)` — server-safe (no hooks), used by `/[handle]` and the editor preview:
    ```ts
    interface BentoPageProps {
      displayName: string; handle: string; bio: string | null; avatarUrl: string | null;
      links: { id: string; label: string; url: string; size: TileSize | null }[];
      style: PageStyle; accentColor: string; headingFont: HeadingFont;
      /** false in the editor preview: tiles render as divs, not links. */
      interactive?: boolean;
      children?: ReactNode; // the ask bar slot
    }
    ```
  - `avatarUrl(key: string | null): string | null` — `${STORAGE_PUBLIC_URL}/${key}` or null.

- [ ] **Step 1: Write the failing tests**

`apps/web/app/_bento/BentoPage.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BentoPage, type BentoPageProps } from './BentoPage.js';

const base: BentoPageProps = {
  displayName: 'Iman Muqri',
  handle: 'imnmuqri',
  bio: 'Software developer.',
  avatarUrl: null,
  style: 'SOFT',
  accentColor: '#0c7a62',
  headingFont: 'JAKARTA',
  links: [
    { id: 'a', label: 'Portfolio', url: 'https://iman.dev', size: null },
    { id: 'b', label: 'Chat', url: 'https://wa.me/60123', size: null },
    { id: 'c', label: 'Code', url: 'https://github.com/iman', size: null },
  ],
};

describe('BentoPage', () => {
  it('renders every link as a real link, in order, with its kind', () => {
    render(<BentoPage {...base} />);
    const links = screen.getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['https://iman.dev', 'https://wa.me/60123', 'https://github.com/iman']);
    expect(screen.getByText('WhatsApp')).toBeInTheDocument();
  });

  it('gives each tile its arranged size and tone', () => {
    render(<BentoPage {...base} />);
    const [first, second, third] = screen.getAllByRole('link');
    expect(first).toHaveAttribute('data-size', 'TALL');
    expect(first).toHaveAttribute('data-tone', 'accent');
    expect(second).toHaveAttribute('data-tone', 'warm');
    expect(third).toHaveAttribute('data-size', 'SMALL');
  });

  it('carries the style, accent and readable text colour to the stylesheet', () => {
    const { container } = render(<BentoPage {...base} style="CONTRAST" accentColor="#f2a33c" headingFont="FRAUNCES" />);
    const page = container.firstElementChild as HTMLElement;
    expect(page).toHaveAttribute('data-style', 'CONTRAST');
    expect(page).toHaveAttribute('data-on-accent', 'dark');
    expect(page.style.getPropertyValue('--accent')).toBe('#f2a33c');
    expect(page.style.getPropertyValue('--font-heading')).toBe('var(--font-fraunces)');
  });

  // The spec: "Only show the picture if user upload."
  it('shows no picture and no placeholder when none was uploaded', () => {
    render(<BentoPage {...base} />);
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('shows the picture beside the name when there is one', () => {
    render(<BentoPage {...base} avatarUrl="https://cdn.example/avatars/p/1.webp" />);
    expect(screen.getByRole('img', { name: 'Iman Muqri' })).toHaveAttribute('src', 'https://cdn.example/avatars/p/1.webp');
  });

  // Review Focus 5.
  it('renders no empty grid for a page with no links', () => {
    const { container } = render(<BentoPage {...base} links={[]} />);
    expect(container.querySelector('[data-bento-grid]')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Iman Muqri' })).toBeInTheDocument();
  });

  it('renders tiles as plain boxes in the editor preview, so they cannot navigate', () => {
    render(<BentoPage {...base} interactive={false} />);
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(screen.getByText('Portfolio')).toBeInTheDocument();
  });
});
```

In `apps/web/app/[handle]/page.test.tsx`, add (and update fixtures per Task 2's new fields):

```tsx
  // The page is the owner's links now; facts live behind the ask bar.
  it('shows no fact list', async () => {
    getPublicPage.mockResolvedValue(pageWithFacts);
    render(await HandlePage({ params: Promise.resolve({ handle: 'nadia' }) }));
    expect(screen.queryByText(/what people ask/i)).toBeNull();
    expect(screen.queryByText(pageWithFacts.facts[0].claim)).toBeNull();
  });
```

Read the file first and use its own fixture and mock names; the names above are illustrative of the assertion, not of the file.

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @curios/web exec vitest run app/_bento "app/[handle]/page.test.tsx"`
Expected: FAIL — unresolved `./BentoPage.js`; the fact-list test fails because the section still renders.

- [ ] **Step 3: Write the renderer**

`apps/web/app/_bento/BentoPage.tsx`:

```tsx
import type { CSSProperties, ReactNode } from 'react';
import {
  arrangeTiles,
  linkKind,
  readableOn,
  type HeadingFont,
  type PageStyle,
  type TileSize,
} from '@curios/core/bento';
import { HEADING_FONT_VAR } from '../../lib/fonts.js';
import { Avatar } from './Avatar.js';
import styles from './Bento.module.css';

export interface BentoPageProps {
  displayName: string;
  handle: string;
  bio: string | null;
  avatarUrl: string | null;
  links: { id: string; label: string; url: string; size: TileSize | null }[];
  style: PageStyle;
  accentColor: string;
  headingFont: HeadingFont;
  /** False in the editor's live preview: tiles become boxes that cannot navigate. */
  interactive?: boolean;
  /** The ask bar, on the public page. */
  children?: ReactNode;
}

/**
 * A My Curios page, for visitors and for the editor's preview alike -- one
 * renderer, so the preview cannot drift from the page.
 *
 * Server-safe: no hooks. The accent and heading font arrive as inline custom
 * properties, because they are the owner's data, not the design system's; the
 * stylesheet only ever reads var(--accent) and var(--font-heading).
 */
export function BentoPage(props: BentoPageProps) {
  const { interactive = true } = props;
  const tiles = arrangeTiles(props.links);
  const vars = {
    '--accent': props.accentColor,
    '--font-heading': HEADING_FONT_VAR[props.headingFont],
  } as CSSProperties;

  return (
    <div className={styles.page} data-style={props.style} data-on-accent={readableOn(props.accentColor)} style={vars}>
      <header className={styles.head}>
        {props.avatarUrl ? <Avatar src={props.avatarUrl} name={props.displayName} /> : null}
        <div>
          <h1 className={styles.name}>{props.displayName}</h1>
          <p className={styles.handle}>curios.my/{props.handle}</p>
        </div>
      </header>
      {props.bio ? <p className={styles.bio}>{props.bio}</p> : null}

      {tiles.length > 0 ? (
        <div className={styles.grid} data-bento-grid>
          {tiles.map(({ link, size, tone }) => {
            const body = (
              <>
                <span className={styles.kind}>{linkKind(link.url)}</span>
                <span className={styles.label}>{link.label}</span>
              </>
            );
            return interactive ? (
              <a key={link.id} className={styles.tile} data-size={size} data-tone={tone} href={link.url} rel="noopener">
                {body}
              </a>
            ) : (
              <div key={link.id} className={styles.tile} data-size={size} data-tone={tone}>
                {body}
              </div>
            );
          })}
        </div>
      ) : null}

      {props.children}
    </div>
  );
}
```

`apps/web/app/_bento/Avatar.tsx`:

```tsx
'use client';

import { useState } from 'react';
import styles from './Bento.module.css';

/**
 * The owner's picture. If it fails to load -- storage down, an object removed
 * -- it disappears and the name stands alone. Never a broken-image icon.
 */
export function Avatar({ src, name }: { src: string; name: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return <img className={styles.avatar} src={src} alt={name} width={56} height={56} onError={() => setFailed(true)} />;
}
```

`apps/web/app/_bento/Bento.module.css` (tokens only; `color-mix` makes the warm tint from the accent without a hex):

```css
.page {
  --tile-radius: 16px;
  --warm: color-mix(in srgb, var(--accent) 16%, var(--card));
  --plain-bg: var(--card);
  --plain-fg: var(--ink);
  --page-bg: var(--soft-page);
  --shadow: 0 1px 3px var(--soft-shadow);
  max-width: 520px;
  margin: 0 auto;
  padding: 32px 16px 120px;
  min-height: 100vh;
  background: var(--page-bg);
  color: var(--ink);
  font-family: var(--font-body);
}

.page[data-style='CONTRAST'] {
  --tile-radius: 14px;
  --warm: var(--kuning);
  --plain-bg: var(--ink);
  --plain-fg: var(--paper);
  --page-bg: var(--paper);
  --shadow: none;
}

.page[data-on-accent='dark'] { --on-accent: var(--ink); }
.page[data-on-accent='light'] { --on-accent: var(--paper); }

.head {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 10px;
}

.avatar {
  width: 56px;
  height: 56px;
  flex: none;
  border-radius: 50%;
  object-fit: cover;
}

.name {
  margin: 0;
  font-family: var(--font-heading), var(--font-display);
  font-size: var(--text-lg);
  line-height: 1.15;
  letter-spacing: -0.01em;
}

.handle {
  margin: 2px 0 0;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--muted);
}

.bio {
  margin: 0 0 18px;
  font-size: var(--text-base);
  line-height: 1.5;
  color: var(--muted);
}

.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-auto-rows: minmax(76px, auto);
  grid-auto-flow: dense;
  gap: 10px;
  margin-bottom: 18px;
}

.tile {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 8px;
  padding: 14px;
  border-radius: var(--tile-radius);
  background: var(--plain-bg);
  color: var(--plain-fg);
  box-shadow: var(--shadow);
  text-decoration: none;
  transition: transform 120ms ease;
}

a.tile:active { transform: scale(0.98); }

.tile[data-size='WIDE'] { grid-column: span 2; }
.tile[data-size='TALL'] { grid-row: span 2; }
.tile[data-size='BIG'] { grid-column: span 2; grid-row: span 2; }

.tile[data-tone='accent'] { background: var(--accent); color: var(--on-accent); }
.tile[data-tone='warm'] { background: var(--warm); color: var(--ink); }

.kind {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  opacity: 0.8;
}

.label {
  font-family: var(--font-heading), var(--font-display);
  font-size: var(--text-base);
  font-weight: 700;
}
```

Add to `packages/ui/src/tokens.css` `:root`:

```css
  /* The Soft style's page and tile shadow -- the default look of a My Curios page. */
  --soft-page: #f4f6f5;
  --soft-shadow: rgb(16 35 31 / 6%);
```

`apps/web/lib/avatar-url.ts`:

```ts
/** The public URL of an uploaded picture, or null when there is none or storage is not configured. */
export function avatarUrl(key: string | null): string | null {
  const base = process.env.STORAGE_PUBLIC_URL;
  if (!key || !base) return null;
  return `${base.replace(/\/+$/, '')}/${key}`;
}
```

- [ ] **Step 4: Rebuild the public page on it**

In `apps/web/app/[handle]/page.tsx`, replace the `<main>` body with:

```tsx
  return (
    <main>
      <BentoPage
        displayName={page.displayName}
        handle={page.handle}
        bio={page.bio}
        avatarUrl={avatarUrl(page.avatarKey)}
        links={page.links}
        style={page.style}
        accentColor={page.accentColor}
        headingFont={page.headingFont}
      >
        {hasFaq ? (
          <a className={styles.faqLink} href={`/${page.handle}/faq`}>
            See every question we&apos;ve answered
          </a>
        ) : null}
        <Ask
          handle={page.handle}
          questions={questions}
          shopName={page.displayName}
          canCapture={canCapture({ mode: page.mode, paidUntil: page.paidUntil, leadsCaptured: page.leadsCaptured, now: new Date() })}
        />
      </BentoPage>
    </main>
  );
```

Remove the `Chip`, `LinkRow` imports and the `What people ask` section. Delete the now-unused classes (`.facts`, `.fact`, `.claim`, `.sectionLabel`, `.links`, `.name`, `.bio`, `.page`) from `page.module.css`, keeping `.faqLink`. Add a comment above `questions` saying facts now reach visitors only through the ask bar and the FAQ pages, per slice 13.

- [ ] **Step 5: Run them and watch them pass**

Run: `pnpm --filter @curios/web exec vitest run`
Expected: PASS, including `budget.test.ts` (it skips without a production build) and `@curios/ui`'s design-rules test (`pnpm --filter @curios/ui exec vitest run src/design-rules.test.ts`).

- [ ] **Step 6: Prove by mutation, then load it**

| Mutation | Test that must go red |
|---|---|
| render tiles in reverse | `renders every link as a real link, in order…` |
| hard-code `data-tone="plain"` | `gives each tile its arranged size and tone` |
| drop `data-on-accent` | `carries the style, accent and readable text colour…` |
| render `<Avatar>` when `avatarUrl` is null | `shows no picture…` |
| render the grid when `tiles` is empty | `renders no empty grid…` |
| ignore `interactive` | `renders tiles as plain boxes…` |
| keep the fact section | `shows no fact list` |

Then the dev-server check for `/imnmuqri` (200, 0 build errors) — and open it: with JavaScript disabled the tiles must still be clickable links.

- [ ] **Step 7: Commit**

```bash
git add apps/web packages/ui/src/tokens.css
git commit -m "feat(web): the public page is a bento of the owner's links, facts behind the ask bar"
```

---

### Task 7: My Curios — profile, links and live preview

**Files:**
- Create: `apps/web/app/app/curios/use-autosave.ts` (+ `use-autosave.test.tsx`), `profile-editor.tsx`, `links-editor.tsx` (+ `links-editor.test.tsx`), `my-curios.tsx` (+ `my-curios.test.tsx`), `curios.module.css`
- Modify: `apps/web/app/app/curios/page.tsx`, `apps/web/package.json`

**Interfaces:**
- Consumes: `getMyCurios` + `MyCurios` (Task 2); the `/links` and `/pages/appearance` routes (Tasks 3–4); `BentoPage` (Task 6); `avatarUrl` (Task 6); `LABEL_MAX`, `MAX_LINKS`, `TILE_SIZES`, `normalizeLinkUrl` (Task 1).
- Produces:
  - `useAutosave<T>(save: (value: T) => Promise<unknown>, delay?: number): { status: 'idle' | 'saving' | 'saved' | 'error'; schedule(value: T): void; retry(): void }`
  - `interface CuriosApi { addLink(i: { label: string; url: string }): Promise<LinkItem>; updateLink(id: string, i: Partial<{ label: string; url: string; size: TileSize | null }>): Promise<LinkItem>; removeLink(id: string): Promise<void>; reorder(ids: string[]): Promise<void>; saveAppearance(p: AppearancePatch): Promise<unknown>; uploadAvatar(file: File): Promise<string | null>; removeAvatar(): Promise<void> }` — `uploadAvatar` returns the new picture URL (Task 9 fills it).
  - `MyCuriosEditor({ initial: MyCurios & { avatarUrl: string | null }, api: CuriosApi, uploadsEnabled: boolean })`

- [ ] **Step 1: Add the dependencies**

```bash
pnpm --filter @curios/web add @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```

- [ ] **Step 2: Write the failing autosave test**

`apps/web/app/app/curios/use-autosave.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useAutosave } from './use-autosave.js';

describe('useAutosave', () => {
  it('saves once, after typing stops, and says so', async () => {
    vi.useFakeTimers();
    const save = vi.fn(async () => undefined);
    const { result } = renderHook(() => useAutosave(save, 600));

    act(() => { result.current.schedule('I'); result.current.schedule('Im'); result.current.schedule('Iman'); });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });

    expect(save).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledWith('Iman');
    expect(result.current.status).toBe('saved');
    vi.useRealTimers();
  });

  it('reports a failure and retries the same value', async () => {
    vi.useFakeTimers();
    const save = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useAutosave(save, 600));

    act(() => result.current.schedule('Iman'));
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(result.current.status).toBe('error');

    await act(async () => { result.current.retry(); await vi.runAllTimersAsync(); });
    expect(save).toHaveBeenLastCalledWith('Iman');
    expect(result.current.status).toBe('saved');
    vi.useRealTimers();
  });
});
```

- [ ] **Step 3: Write `use-autosave.ts`**

```ts
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export const SAVE_DEBOUNCE_MS = 600;

/**
 * Saves the latest value once the owner stops typing, and says how it went.
 * No Save button in My Curios -- this is what stands in for it. A failure
 * keeps the value, so retry() sends exactly what the owner last typed.
 */
export function useAutosave<T>(save: (value: T) => Promise<unknown>, delay = SAVE_DEBOUNCE_MS) {
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const latest = useRef<{ value: T } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRef = useRef(save);
  saveRef.current = save;

  const flush = useCallback(async () => {
    if (!latest.current) return;
    const { value } = latest.current;
    setStatus('saving');
    try {
      await saveRef.current(value);
      setStatus('saved');
    } catch {
      setStatus('error');
    }
  }, []);

  const schedule = useCallback(
    (value: T) => {
      latest.current = { value };
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), delay);
    },
    [delay, flush],
  );

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return { status, schedule, retry: () => void flush() };
}
```

Run: `pnpm --filter @curios/web exec vitest run app/app/curios/use-autosave.test.tsx` — PASS.

- [ ] **Step 4: Write the failing links-editor tests**

`apps/web/app/app/curios/links-editor.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LinksEditor, type LinkItem } from './links-editor.js';

const three: LinkItem[] = [
  { id: 'a', label: 'Portfolio', url: 'https://iman.dev', size: null },
  { id: 'b', label: 'WhatsApp', url: 'https://wa.me/60123', size: null },
  { id: 'c', label: 'GitHub', url: 'https://github.com/iman', size: null },
];

function setup(links = three, overrides: Partial<Parameters<typeof LinksEditor>[0]> = {}) {
  const props = {
    links,
    onChange: vi.fn(),
    addLink: vi.fn(async (i: { label: string; url: string }) => ({ id: 'n', ...i, url: `https://${i.url}`, size: null })),
    updateLink: vi.fn(async (id: string, patch: Partial<LinkItem>) => ({ ...links.find((l) => l.id === id)!, ...patch })),
    removeLink: vi.fn(async () => undefined),
    reorder: vi.fn(async () => undefined),
    ...overrides,
  };
  render(<LinksEditor {...props} />);
  return props;
}

describe('LinksEditor', () => {
  it('adds a link and hands the new list up', async () => {
    const props = setup();
    await userEvent.click(screen.getByRole('button', { name: '+ Add a link' }));
    await userEvent.type(screen.getByLabelText('Name'), 'Shop');
    await userEvent.type(screen.getByLabelText('Address'), 'shopee.com.my/iman');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(props.addLink).toHaveBeenCalledWith({ label: 'Shop', url: 'shopee.com.my/iman' });
    expect(props.onChange).toHaveBeenLastCalledWith([...three, expect.objectContaining({ label: 'Shop' })]);
  });

  it('says what is wrong with an address before sending it', async () => {
    const props = setup();
    await userEvent.click(screen.getByRole('button', { name: '+ Add a link' }));
    await userEvent.type(screen.getByLabelText('Name'), 'Bad');
    await userEvent.type(screen.getByLabelText('Address'), 'javascript:alert(1)');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(props.addLink).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/does not look right/i);
  });

  it('sets a tile size, and automatic clears it', async () => {
    const props = setup();
    const row = screen.getByRole('listitem', { name: 'Portfolio' });
    await userEvent.click(within(row).getByRole('button', { name: 'Big tile' }));
    expect(props.updateLink).toHaveBeenLastCalledWith('a', { size: 'BIG' });

    await userEvent.click(within(row).getByRole('button', { name: 'Automatic size' }));
    expect(props.updateLink).toHaveBeenLastCalledWith('a', { size: null });
  });

  it('moves a link down with the keyboard-reachable button', async () => {
    const props = setup();
    await userEvent.click(within(screen.getByRole('listitem', { name: 'Portfolio' })).getByRole('button', { name: 'Move Portfolio down' }));
    expect(props.reorder).toHaveBeenCalledWith(['b', 'a', 'c']);
    expect(props.onChange).toHaveBeenLastCalledWith([three[1], three[0], three[2]]);
  });

  // Review Focus 1, on the client: a refused reorder must not leave the screen lying.
  it('snaps back and says so when a reorder is refused', async () => {
    const props = setup(three, { reorder: vi.fn(async () => { throw new Error('Your links changed somewhere else.'); }) });
    await userEvent.click(within(screen.getByRole('listitem', { name: 'Portfolio' })).getByRole('button', { name: 'Move Portfolio down' }));

    expect(props.onChange).toHaveBeenLastCalledWith(three);
    expect(screen.getByRole('alert')).toHaveTextContent(/changed somewhere else/i);
  });

  it('asks before removing, because a removal cannot be undone', async () => {
    const props = setup();
    const row = screen.getByRole('listitem', { name: 'GitHub' });
    await userEvent.click(within(row).getByRole('button', { name: 'Remove GitHub' }));
    expect(props.removeLink).not.toHaveBeenCalled();

    await userEvent.click(within(row).getByRole('button', { name: 'Yes, remove' }));
    expect(props.removeLink).toHaveBeenCalledWith('c');
  });

  // Review Focus 5.
  it('invites the first link on an empty page', () => {
    setup([]);
    expect(screen.getByText(/add your first link/i)).toBeInTheDocument();
  });

  it('stops offering to add at the limit', () => {
    setup(Array.from({ length: 30 }, (_u, i) => ({ id: `${i}`, label: `L${i}`, url: 'https://a.co', size: null })));
    expect(screen.queryByRole('button', { name: '+ Add a link' })).toBeNull();
    expect(screen.getByText(/30 links is the most/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 5: Write `links-editor.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button, Callout, Field } from '@curios/ui';
import { LABEL_MAX, MAX_LINKS, normalizeLinkUrl, type TileSize } from '@curios/core/bento';
import styles from './curios.module.css';

export type LinkItem = { id: string; label: string; url: string; size: TileSize | null };

const SIZE_BUTTONS: { size: TileSize | null; short: string; name: string }[] = [
  { size: null, short: 'Auto', name: 'Automatic size' },
  { size: 'SMALL', short: 'S', name: 'Small tile' },
  { size: 'WIDE', short: 'W', name: 'Wide tile' },
  { size: 'TALL', short: 'T', name: 'Tall tile' },
  { size: 'BIG', short: 'B', name: 'Big tile' },
];

const message = (failure: unknown) => (failure instanceof Error ? failure.message : 'That did not save. Try again.');

/**
 * The owner's links, in the order visitors see them. Dragging reorders; so do
 * the up/down buttons, which is how the keyboard and a screen reader reach it
 * too. Every change is sent at once -- there is no Save button in My Curios.
 */
export function LinksEditor({
  links,
  onChange,
  addLink,
  updateLink,
  removeLink,
  reorder,
}: {
  links: LinkItem[];
  onChange: (links: LinkItem[]) => void;
  addLink: (input: { label: string; url: string }) => Promise<LinkItem>;
  updateLink: (id: string, patch: Partial<Omit<LinkItem, 'id'>>) => Promise<LinkItem>;
  removeLink: (id: string) => Promise<void>;
  reorder: (ids: string[]) => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  async function move(next: LinkItem[]) {
    const before = links;
    onChange(next);
    setError('');
    try {
      await reorder(next.map((link) => link.id));
    } catch (failure) {
      onChange(before);
      setError(message(failure));
    }
  }

  function onDragEnd(event: DragEndEvent) {
    if (!event.over || event.active.id === event.over.id) return;
    const from = links.findIndex((l) => l.id === event.active.id);
    const to = links.findIndex((l) => l.id === event.over?.id);
    void move(arrayMove(links, from, to));
  }

  async function add() {
    setError('');
    if (label.trim() === '' || [...label.trim()].length > LABEL_MAX) {
      setError(`Give the link a name, up to ${LABEL_MAX} characters.`);
      return;
    }
    if (!normalizeLinkUrl(url)) {
      setError('That link does not look right. Use a web address, an email (mailto:) or a phone number (tel:).');
      return;
    }
    try {
      const link = await addLink({ label, url });
      onChange([...links, link]);
      setLabel('');
      setUrl('');
      setAdding(false);
    } catch (failure) {
      setError(message(failure));
    }
  }

  async function patch(id: string, change: Partial<Omit<LinkItem, 'id'>>) {
    setError('');
    try {
      const saved = await updateLink(id, change);
      onChange(links.map((link) => (link.id === id ? saved : link)));
    } catch (failure) {
      setError(message(failure));
    }
  }

  async function remove(id: string) {
    setError('');
    try {
      await removeLink(id);
      onChange(links.filter((link) => link.id !== id));
    } catch (failure) {
      setError(message(failure));
    }
  }

  return (
    <section className={styles.section} aria-labelledby="links-title">
      <h2 id="links-title" className={styles.sectionTitle}>Links</h2>
      {links.length === 0 ? <p className={styles.empty}>Add your first link: your shop, WhatsApp, portfolio, anything.</p> : null}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={links.map((l) => l.id)} strategy={verticalListSortingStrategy}>
          <ul className={styles.links}>
            {links.map((link, index) => (
              <LinkRow
                key={link.id}
                link={link}
                first={index === 0}
                last={index === links.length - 1}
                onMove={(delta) => void move(arrayMove(links, index, index + delta))}
                onPatch={(change) => void patch(link.id, change)}
                onRemove={() => void remove(link.id)}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>

      {error ? <Callout tone="error">{error}</Callout> : null}

      {links.length >= MAX_LINKS ? (
        <p className={styles.empty}>{MAX_LINKS} links is the most a page holds. Remove one to add another.</p>
      ) : adding ? (
        <div className={styles.addForm}>
          <Field id="new-label" label="Name" value={label} onChange={setLabel} />
          <Field id="new-url" label="Address" value={url} onChange={setUrl} autoComplete="off" hint="A web address, mailto:you@… or tel:+60…" />
          <Button type="button" onClick={() => void add()}>Add</Button>
          <Button type="button" variant="secondary" onClick={() => setAdding(false)}>Cancel</Button>
        </div>
      ) : (
        <button type="button" className={styles.addButton} onClick={() => setAdding(true)}>+ Add a link</button>
      )}
    </section>
  );
}

function LinkRow({
  link,
  first,
  last,
  onMove,
  onPatch,
  onRemove,
}: {
  link: LinkItem;
  first: boolean;
  last: boolean;
  onMove: (delta: 1 | -1) => void;
  onPatch: (change: Partial<Omit<LinkItem, 'id'>>) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: link.id });
  const [confirming, setConfirming] = useState(false);

  return (
    <li
      ref={setNodeRef}
      aria-label={link.label}
      className={styles.link}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <span className={styles.grip} {...attributes} {...listeners} aria-label={`Drag ${link.label}`}>⋮⋮</span>
      <span className={styles.linkText}>
        {link.label}
        <small>{link.url}</small>
      </span>
      <span className={styles.sizes} role="group" aria-label="Tile size">
        {SIZE_BUTTONS.map((button) => (
          <button
            key={button.name}
            type="button"
            aria-label={button.name}
            aria-pressed={link.size === button.size}
            onClick={() => onPatch({ size: button.size })}
          >
            {button.short}
          </button>
        ))}
      </span>
      <button type="button" className={styles.iconButton} aria-label={`Move ${link.label} up`} disabled={first} onClick={() => onMove(-1)}>↑</button>
      <button type="button" className={styles.iconButton} aria-label={`Move ${link.label} down`} disabled={last} onClick={() => onMove(1)}>↓</button>
      {confirming ? (
        <span className={styles.confirm}>
          <button type="button" onClick={onRemove}>Yes, remove</button>
          <button type="button" onClick={() => setConfirming(false)}>Keep</button>
        </span>
      ) : (
        <button type="button" className={styles.iconButton} aria-label={`Remove ${link.label}`} onClick={() => setConfirming(true)}>×</button>
      )}
    </li>
  );
}
```

Inline label/URL editing: a tap on `.linkText` swaps it for two `Field`s wired to `useAutosave` calling `onPatch({ label })` / `onPatch({ url })`, with the status shown beside them ("Saved", or a Retry button on error). Write it inside `LinkRow`, and add a test to `links-editor.test.tsx`: tap the link text, change the name, advance fake timers by `SAVE_DEBOUNCE_MS`, expect `updateLink('a', { label: 'Work' })`.

Run: `pnpm --filter @curios/web exec vitest run app/app/curios/links-editor.test.tsx` — PASS.

- [ ] **Step 6: Write the failing editor test**

`apps/web/app/app/curios/my-curios.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MyCuriosEditor } from './my-curios.js';

const initial = {
  id: 'p1', handle: 'imnmuqri', displayName: 'Iman Muqri', bio: null, avatarUrl: null,
  style: 'SOFT' as const, accentColor: '#0c7a62', headingFont: 'JAKARTA' as const, avatarKey: null,
  links: [{ id: 'a', label: 'Portfolio', url: 'https://iman.dev', size: null }],
};

const api = () => ({
  addLink: vi.fn(async (i: { label: string; url: string }) => ({ id: 'n', label: i.label, url: `https://${i.url}`, size: null })),
  updateLink: vi.fn(async (id: string, p: object) => ({ ...initial.links[0]!, ...p })),
  removeLink: vi.fn(async () => undefined),
  reorder: vi.fn(async () => undefined),
  saveAppearance: vi.fn(async () => undefined),
  uploadAvatar: vi.fn(async () => null),
  removeAvatar: vi.fn(async () => undefined),
});

describe('MyCuriosEditor', () => {
  // The preview updates from local state, before any save returns.
  it('shows a new link in the live preview as soon as it is added', async () => {
    render(<MyCuriosEditor initial={initial} api={api()} uploadsEnabled={false} />);
    await userEvent.click(screen.getByRole('button', { name: '+ Add a link' }));
    await userEvent.type(screen.getByLabelText('Name'), 'Shop');
    await userEvent.type(screen.getByLabelText('Address'), 'shopee.com.my/iman');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));

    const preview = screen.getByRole('region', { name: 'Live preview' });
    expect(within(preview).getByText('Shop')).toBeInTheDocument();
  });

  it('shows the name in the preview while it is being typed', async () => {
    render(<MyCuriosEditor initial={initial} api={api()} uploadsEnabled={false} />);
    const name = screen.getByLabelText('Display name');
    await userEvent.clear(name);
    await userEvent.type(name, 'Iman M.');

    expect(within(screen.getByRole('region', { name: 'Live preview' })).getByRole('heading', { name: 'Iman M.' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 7: Write the editor, the profile section and the route**

`apps/web/app/app/curios/profile-editor.tsx`:

```tsx
'use client';

import { Button, Field } from '@curios/ui';
import { BIO_MAX } from '@curios/core/bento';
import { useAutosave } from './use-autosave.js';
import styles from './curios.module.css';

const STATUS = { idle: '', saving: 'Saving…', saved: 'Saved', error: '' } as const;

/** Name and bio, saved as the owner types. The picture control lives here too, from Task 9. */
export function ProfileEditor({
  displayName,
  bio,
  onChange,
  save,
}: {
  displayName: string;
  bio: string | null;
  onChange: (change: { displayName?: string; bio?: string | null }) => void;
  save: (patch: { displayName?: string; bio?: string | null }) => Promise<unknown>;
}) {
  const name = useAutosave((value: string) => save({ displayName: value }));
  const about = useAutosave((value: string) => save({ bio: value }));

  return (
    <section className={styles.section} aria-labelledby="profile-title">
      <h2 id="profile-title" className={styles.sectionTitle}>Profile</h2>
      <Field
        id="display-name"
        label="Display name"
        value={displayName}
        onChange={(value) => { onChange({ displayName: value }); name.schedule(value); }}
      />
      <SaveState status={name.status} retry={name.retry} />
      <Field
        id="bio"
        label="Bio"
        multiline
        value={bio ?? ''}
        hint={`${[...(bio ?? '')].length} of ${BIO_MAX}`}
        onChange={(value) => { onChange({ bio: value }); about.schedule(value); }}
      />
      <SaveState status={about.status} retry={about.retry} />
    </section>
  );
}

export function SaveState({ status, retry }: { status: keyof typeof STATUS; retry: () => void }) {
  if (status === 'error') {
    return (
      <p className={styles.saveError} role="alert">
        That did not save. <Button type="button" variant="secondary" onClick={retry}>Retry</Button>
      </p>
    );
  }
  return <p className={styles.saveState} aria-live="polite">{STATUS[status]}</p>;
}
```

`apps/web/app/app/curios/my-curios.tsx`:

```tsx
'use client';

import { useState } from 'react';
import type { MyCurios } from '@curios/db-read';
import type { HeadingFont, PageStyle, TileSize } from '@curios/core/bento';
import { BentoPage } from '../../_bento/BentoPage.js';
import { LinksEditor, type LinkItem } from './links-editor.js';
import { ProfileEditor } from './profile-editor.js';
import styles from './curios.module.css';

export type AppearancePatch = Partial<{ style: PageStyle; accentColor: string; headingFont: HeadingFont; displayName: string; bio: string | null }>;

export interface CuriosApi {
  addLink(input: { label: string; url: string }): Promise<LinkItem>;
  updateLink(id: string, patch: Partial<{ label: string; url: string; size: TileSize | null }>): Promise<LinkItem>;
  removeLink(id: string): Promise<void>;
  reorder(ids: string[]): Promise<void>;
  saveAppearance(patch: AppearancePatch): Promise<unknown>;
  /** Resolves to the new picture's URL. */
  uploadAvatar(file: File): Promise<string | null>;
  removeAvatar(): Promise<void>;
}

/**
 * My Curios: the owner's page, arranged. Controls on the left, the live preview
 * on the right (below on a phone), rendered by the same BentoPage visitors see.
 * State is local and optimistic; each section saves its own changes.
 */
export function MyCuriosEditor({
  initial,
  api,
  uploadsEnabled,
}: {
  initial: MyCurios & { avatarUrl: string | null };
  api: CuriosApi;
  uploadsEnabled: boolean;
}) {
  const [page, setPage] = useState(initial);
  const update = (change: Partial<typeof page>) => setPage((current) => ({ ...current, ...change }));

  return (
    <div className={styles.editor}>
      <div className={styles.controls}>
        <h1 className={styles.title}>My Curios</h1>
        <p className={styles.lede}>Your page, arranged. Changes save as you make them.</p>
        <ProfileEditor displayName={page.displayName} bio={page.bio} onChange={update} save={api.saveAppearance} />
        <LinksEditor
          links={page.links}
          onChange={(links) => update({ links })}
          addLink={api.addLink}
          updateLink={api.updateLink}
          removeLink={api.removeLink}
          reorder={api.reorder}
        />
        {/* Appearance (Task 8) and the picture (Task 9) join here. uploadsEnabled is read by Task 9. */}
        <input type="hidden" value={String(uploadsEnabled)} readOnly />
      </div>
      <section className={styles.preview} aria-label="Live preview">
        <div className={styles.phone}>
          <BentoPage {...page} interactive={false} />
        </div>
      </section>
    </div>
  );
}
```

(Task 9 removes the hidden input when it uses `uploadsEnabled` for real.)

`apps/web/app/app/curios/page.tsx`:

```tsx
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE } from '@curios/core';
import { getMyCurios } from '@curios/db-read';
import { avatarUrl } from '../../../lib/avatar-url.js';
import { resolveOwner } from '../session.js';
import { MyCurios } from './my-curios-wrapper.js';

export default async function MyCuriosPage() {
  const owner = await resolveOwner((await cookies()).get(SESSION_COOKIE)?.value);
  if (!owner) redirect('/signin');
  const page = await getMyCurios(owner.accountId);
  if (!page) redirect('/app/onboarding');

  return <MyCurios initial={{ ...page, avatarUrl: avatarUrl(page.avatarKey) }} uploadsEnabled={Boolean(process.env.STORAGE_PUBLIC_URL)} />;
}
```

Create `apps/web/app/app/curios/my-curios-wrapper.tsx` — the thin client wrapper that builds the real `CuriosApi` over `apiFetch`, in the shape of `Ingest` in `ingest-form.tsx`:

```tsx
'use client';

import type { MyCurios as MyCuriosData } from '@curios/db-read';
import { apiFetch } from '../../../lib/api.js';
import { MyCuriosEditor, type CuriosApi } from './my-curios.js';
import type { LinkItem } from './links-editor.js';

/**
 * Supplies the real API calls. Thin on purpose: a Server Component cannot hand
 * functions to a Client Component, so page.tsx passes plain values and the
 * closures over apiFetch are built here.
 */
export function MyCurios({ initial, uploadsEnabled }: { initial: MyCuriosData & { avatarUrl: string | null }; uploadsEnabled: boolean }) {
  const api: CuriosApi = {
    addLink: async (input) => (await apiFetch<{ link: LinkItem }>('/links', { method: 'POST', body: JSON.stringify(input) })).link,
    updateLink: async (id, patch) => (await apiFetch<{ link: LinkItem }>(`/links/${id}`, { method: 'PATCH', body: JSON.stringify(patch) })).link,
    removeLink: async (id) => { await apiFetch(`/links/${id}`, { method: 'DELETE' }); },
    reorder: async (ids) => { await apiFetch('/links/order', { method: 'PUT', body: JSON.stringify({ ids }) }); },
    saveAppearance: (patch) => apiFetch('/pages/appearance', { method: 'PATCH', body: JSON.stringify(patch) }),
    uploadAvatar: async () => null, // Task 9
    removeAvatar: async () => undefined, // Task 9
  };
  return <MyCuriosEditor initial={initial} api={api} uploadsEnabled={uploadsEnabled} />;
}
```

`apps/web/app/app/curios/curios.module.css` — layout only, tokens only, scale sizes only:

```css
.editor { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 28px; align-items: start; }
.controls { min-width: 0; }
.title { margin: 0 0 4px; font-family: var(--font-display); font-size: var(--text-lg); letter-spacing: -0.02em; }
.lede { margin: 0 0 20px; color: var(--muted); font-size: var(--text-base); }
.section { margin-bottom: 28px; padding: 18px; background: var(--card); border: 1px solid var(--line); border-radius: 12px; }
.sectionTitle { margin: 0 0 12px; font-size: var(--text-body); }
.empty { color: var(--muted); font-size: var(--text-base); }
.links { list-style: none; margin: 0 0 12px; padding: 0; display: grid; gap: 6px; }
.link { display: flex; align-items: center; gap: 8px; min-height: 48px; padding: 6px 10px; background: var(--paper); border: 1px solid var(--line); border-radius: 10px; }
.grip { cursor: grab; color: var(--muted); letter-spacing: -2px; touch-action: none; }
.linkText { flex: 1; min-width: 0; font-size: var(--text-base); font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.linkText small { display: block; font-weight: 400; color: var(--muted); font-size: var(--text-xs); }
.sizes { display: inline-flex; gap: 3px; }
.sizes button, .iconButton, .confirm button { min-width: 30px; min-height: 30px; padding: 0 6px; border: 1px solid var(--line); border-radius: 6px; background: var(--card); color: var(--ink); font: inherit; font-size: var(--text-xs); font-weight: 600; cursor: pointer; }
.sizes button[aria-pressed='true'] { border-color: var(--hijau); background: var(--mint); color: var(--hijau); }
.iconButton:disabled { opacity: 0.35; cursor: default; }
.confirm { display: inline-flex; gap: 4px; }
.addButton { width: 100%; min-height: 44px; border: 1.5px dashed var(--line); border-radius: 10px; background: none; color: var(--hijau); font: inherit; font-weight: 700; cursor: pointer; }
.addForm { display: grid; gap: 4px; }
.saveState { min-height: 18px; margin: -10px 0 8px; color: var(--muted); font-size: var(--text-xs); }
.saveError { margin: -10px 0 8px; color: var(--merah); font-size: var(--text-sm); }
.preview { position: sticky; top: 24px; }
.phone { border: 1px solid var(--line); border-radius: 28px; overflow: hidden; max-height: 78vh; overflow-y: auto; }
@media (max-width: 960px) { .editor { grid-template-columns: 1fr; } .preview { position: static; } }
```

- [ ] **Step 8: Run them and watch them pass**

Run: `pnpm --filter @curios/web exec vitest run app/app/curios`
Expected: PASS.

- [ ] **Step 9: Prove by mutation, then load it**

| Mutation | Test that must go red |
|---|---|
| skip the client-side `normalizeLinkUrl` check | `says what is wrong with an address before sending it` |
| drop `onChange(before)` in `move`'s catch | `snaps back and says so…` |
| call `removeLink` on the first click | `asks before removing…` |
| render the add button at `MAX_LINKS` | `stops offering to add at the limit` |
| preview reads `initial` instead of `page` | `shows a new link in the live preview…` |
| debounce without clearing the previous timer | `saves once, after typing stops…` |
| `retry` schedules instead of flushing the kept value | `reports a failure and retries the same value` |

Dev-server check for `/app/curios`.

- [ ] **Step 10: Commit**

```bash
git add apps/web pnpm-lock.yaml
git commit -m "feat(web): My Curios -- name, bio and links, arranged with a live preview"
```

---

### Task 8: Appearance — style, accent, heading font

**Files:**
- Create: `apps/web/app/app/curios/appearance-editor.tsx`, `apps/web/app/app/curios/appearance-editor.test.tsx`
- Modify: `apps/web/app/app/curios/my-curios.tsx`, `apps/web/app/app/curios/curios.module.css`

**Interfaces:**
- Consumes: `ACCENT_PRESETS`, `HEADING_FONTS`, `PAGE_STYLES`, `isHexColor` (Task 1); `HEADING_FONT_VAR` (Task 5); `CuriosApi.saveAppearance` (Task 7).
- Produces: `AppearanceEditor({ style, accentColor, headingFont, onChange, save })`.

- [ ] **Step 1: Write the failing tests**

`apps/web/app/app/curios/appearance-editor.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppearanceEditor } from './appearance-editor.js';

const setup = () => {
  const props = { style: 'SOFT' as const, accentColor: '#0c7a62', headingFont: 'JAKARTA' as const, onChange: vi.fn(), save: vi.fn(async () => undefined) };
  render(<AppearanceEditor {...props} />);
  return props;
};

describe('AppearanceEditor', () => {
  it('switches style and saves it at once', async () => {
    const props = setup();
    await userEvent.click(screen.getByRole('radio', { name: 'High contrast' }));
    expect(props.onChange).toHaveBeenCalledWith({ style: 'CONTRAST' });
    expect(props.save).toHaveBeenCalledWith({ style: 'CONTRAST' });
  });

  it('picks a preset accent', async () => {
    const props = setup();
    await userEvent.click(screen.getByRole('radio', { name: 'Accent #6d3fb3' }));
    expect(props.save).toHaveBeenCalledWith({ accentColor: '#6d3fb3' });
  });

  it('takes a custom colour typed as hex, and refuses one that is not', async () => {
    const props = setup();
    const custom = screen.getByLabelText('Custom colour');
    await userEvent.clear(custom);
    await userEvent.type(custom, 'banana');
    expect(screen.getByRole('alert')).toHaveTextContent(/six-digit hex/i);
    expect(props.save).not.toHaveBeenCalled();

    await userEvent.clear(custom);
    await userEvent.type(custom, '#123abc');
    expect(props.save).toHaveBeenLastCalledWith({ accentColor: '#123abc' });
  });

  it('picks a heading font, each shown in itself', async () => {
    const props = setup();
    const fraunces = screen.getByRole('radio', { name: 'Fraunces' });
    expect(fraunces.closest('label')).toHaveStyle({ fontFamily: 'var(--font-fraunces)' });
    await userEvent.click(fraunces);
    expect(props.save).toHaveBeenCalledWith({ headingFont: 'FRAUNCES' });
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @curios/web exec vitest run app/app/curios/appearance-editor.test.tsx`
Expected: FAIL — unresolved import.

- [ ] **Step 3: Write `appearance-editor.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { Callout } from '@curios/ui';
import { ACCENT_PRESETS, HEADING_FONTS, isHexColor, type HeadingFont, type PageStyle } from '@curios/core/bento';
import { HEADING_FONT_VAR } from '../../../lib/fonts.js';
import type { AppearancePatch } from './my-curios.js';
import styles from './curios.module.css';

const FONT_NAMES: Record<HeadingFont, string> = {
  JAKARTA: 'Jakarta',
  BRICOLAGE: 'Bricolage',
  FRAUNCES: 'Fraunces',
  SPACE_GROTESK: 'Space Grotesk',
  DM_SERIF: 'DM Serif',
  OUTFIT: 'Outfit',
};

/**
 * Style, accent and heading font. Each choice is a single click, so it saves
 * at once rather than on a debounce. A custom colour saves only once it is a
 * valid hex; text on it is made readable by the page, not by the owner.
 */
export function AppearanceEditor({
  style,
  accentColor,
  headingFont,
  onChange,
  save,
}: {
  style: PageStyle;
  accentColor: string;
  headingFont: HeadingFont;
  onChange: (change: AppearancePatch) => void;
  save: (patch: AppearancePatch) => Promise<unknown>;
}) {
  const [custom, setCustom] = useState(accentColor);
  const [error, setError] = useState('');

  const choose = (patch: AppearancePatch) => {
    setError('');
    onChange(patch);
    save(patch).catch(() => setError('That did not save. Try again.'));
  };

  return (
    <section className={styles.section} aria-labelledby="appearance-title">
      <h2 id="appearance-title" className={styles.sectionTitle}>Appearance</h2>

      <fieldset className={styles.fieldset}>
        <legend>Style</legend>
        <div className={styles.segment}>
          {(['SOFT', 'CONTRAST'] as const).map((value) => (
            <label key={value} data-checked={style === value}>
              <input type="radio" name="style" checked={style === value} onChange={() => choose({ style: value })} />
              {value === 'SOFT' ? 'Soft' : 'High contrast'}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className={styles.fieldset}>
        <legend>Accent colour</legend>
        <div className={styles.swatches}>
          {ACCENT_PRESETS.map((hex) => (
            <label key={hex} className={styles.swatch} style={{ background: hex }} data-checked={accentColor === hex}>
              <input type="radio" name="accent" aria-label={`Accent ${hex}`} checked={accentColor === hex} onChange={() => { setCustom(hex); choose({ accentColor: hex }); }} />
            </label>
          ))}
        </div>
        <label className={styles.custom}>
          Custom colour
          <input
            value={custom}
            onChange={(event) => {
              const value = event.target.value.trim();
              setCustom(value);
              if (isHexColor(value)) choose({ accentColor: value.toLowerCase() });
              else setError('Type a colour as six-digit hex, like #0c7a62.');
            }}
          />
        </label>
      </fieldset>

      <fieldset className={styles.fieldset}>
        <legend>Heading font</legend>
        <div className={styles.fonts}>
          {HEADING_FONTS.map((font) => (
            <label key={font} style={{ fontFamily: HEADING_FONT_VAR[font] }} data-checked={headingFont === font}>
              <input type="radio" name="font" checked={headingFont === font} onChange={() => choose({ headingFont: font })} />
              {FONT_NAMES[font]}
            </label>
          ))}
        </div>
      </fieldset>

      {error ? <Callout tone="error">{error}</Callout> : null}
    </section>
  );
}
```

Add to `curios.module.css`:

```css
.fieldset { margin: 0 0 16px; padding: 0; border: 0; }
.fieldset legend { margin-bottom: 8px; font-size: var(--text-xs); font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
.segment { display: inline-flex; padding: 3px; background: var(--surface); border-radius: 8px; }
.segment label { padding: 6px 12px; border-radius: 6px; font-size: var(--text-sm); cursor: pointer; }
.segment label[data-checked='true'] { background: var(--card); font-weight: 700; box-shadow: 0 1px 2px var(--soft-shadow); }
.segment input, .swatch input, .fonts input { position: absolute; opacity: 0; pointer-events: none; }
.swatches { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; }
.swatch { position: relative; width: 32px; height: 32px; border-radius: 50%; border: 2px solid var(--card); box-shadow: 0 0 0 1px var(--line); cursor: pointer; }
.swatch[data-checked='true'] { box-shadow: 0 0 0 2px var(--ink); }
.swatch:has(input:focus-visible), .fonts label:has(input:focus-visible), .segment label:has(input:focus-visible) { outline: 2px solid var(--hijau); outline-offset: 2px; }
.custom { display: flex; align-items: center; gap: 8px; font-size: var(--text-sm); }
.custom input { width: 110px; min-height: 36px; padding: 0 10px; border: 1.5px solid var(--line); border-radius: 8px; font-family: var(--font-mono); font-size: var(--text-sm); }
.fonts { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.fonts label { position: relative; padding: 10px 12px; border: 1px solid var(--line); border-radius: 10px; background: var(--paper); font-size: var(--text-body); cursor: pointer; }
.fonts label[data-checked='true'] { border-color: var(--hijau); background: var(--mint); }
```

In `my-curios.tsx`, render `<AppearanceEditor style={page.style} accentColor={page.accentColor} headingFont={page.headingFont} onChange={update} save={api.saveAppearance} />` after `LinksEditor`, and add to `my-curios.test.tsx`:

```tsx
  it('restyles the preview the moment a style is chosen', async () => {
    const { container } = render(<MyCuriosEditor initial={initial} api={api()} uploadsEnabled={false} />);
    await userEvent.click(screen.getByRole('radio', { name: 'High contrast' }));
    expect(container.querySelector('[aria-label="Live preview"] [data-style]')).toHaveAttribute('data-style', 'CONTRAST');
  });
```

- [ ] **Step 4: Run them and watch them pass**

Run: `pnpm --filter @curios/web exec vitest run app/app/curios` and `pnpm --filter @curios/ui exec vitest run src/design-rules.test.ts`
Expected: PASS. (`style={{ background: hex }}` is an inline style from data, not a stylesheet literal — the design rule does not apply.)

- [ ] **Step 5: Prove by mutation, then load it**

| Mutation | Test that must go red |
|---|---|
| save the custom colour without `isHexColor` | `takes a custom colour typed as hex…` |
| call `onChange` but not `save` | `switches style and saves it at once` |
| drop the inline `fontFamily` on font labels | `picks a heading font, each shown in itself` |
| `AppearanceEditor` not wired into the editor | `restyles the preview…` |

Dev-server check for `/app/curios`.

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "feat(web): choose Soft or High contrast, an accent colour and a heading font"
```

---

### Task 9: the picture

**Files:**
- Create: `apps/api/src/modules/pages/storage.ts` (+ `storage.test.ts`), `apps/api/src/modules/pages/avatar.ts` (+ `avatar.test.ts`), `apps/api/src/modules/pages/avatar.routes.test.ts`
- Create: `apps/web/app/app/curios/resize-image.ts`
- Modify: `apps/api/src/modules/pages/page.routes.ts`, `apps/api/src/app.ts`, `apps/api/src/plugins/errors.ts`, `apps/api/package.json`, `apps/web/app/app/curios/profile-editor.tsx`, `my-curios.tsx`, `my-curios-wrapper.tsx`, `.env.example`

**Interfaces:**
- Consumes: `CuriosApi.uploadAvatar/removeAvatar` (Task 7), `avatarUrl` (Task 6).
- Produces:
  - `STORAGE_ENV` (the five names), `storageDisabled(env?): boolean`, `interface AvatarStore { put(key: string, body: Buffer, contentType: string): Promise<void>; remove(key: string): Promise<void> }`, `createS3Store(env?): AvatarStore`.
  - `AVATAR_MAX_BYTES`, `decodeAvatar(input: { contentType: string; data: string }): { body: Buffer; ext: 'jpg' | 'png' | 'webp' }` — throws `InvalidImageError`.
  - `POST /pages/avatar` body `{ contentType: 'image/jpeg'|'image/png'|'image/webp', data: string /* base64 */ }` → `200 { avatarKey }`; `DELETE /pages/avatar` → `200 { status: 'removed' }`. Errors `INVALID_IMAGE` (400), `STORAGE_NOT_CONFIGURED` (503).
  - `AppOverrides.pages?: { store?: AvatarStore | null }`.
  - `resizeImage(file: File, edge?: number): Promise<{ contentType: 'image/webp'; data: string }>`.

**Context — why JSON, not multipart.** `apiFetch` sends `content-type: application/json` on every request on purpose: it forces a CORS preflight and is one of three mechanisms standing in for a CSRF token (see `apps/web/lib/api.ts`). A multipart upload would need a form content type and would weaken that for the one route that writes files. The browser already resizes to 512×512 (~30–60 KB as WebP), so base64 in JSON costs nothing that matters. The spec's "multipart upload" line is revised to say so.

- [ ] **Step 1: Write the failing storage and decode tests**

`apps/api/src/modules/pages/storage.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { STORAGE_ENV, storageDisabled } from './storage.js';

const all = Object.fromEntries(STORAGE_ENV.map((name) => [name, 'set']));

describe('storageDisabled', () => {
  it('switches uploads off in development when nothing is set', () => {
    expect(storageDisabled({ NODE_ENV: 'development' })).toBe(true);
    expect(storageDisabled({})).toBe(true);
  });
  it('never switches them off in production', () => {
    expect(storageDisabled({ NODE_ENV: 'production' })).toBe(false);
  });
  it('keeps them on when everything is set, and when only some is (so startup names the gap)', () => {
    expect(storageDisabled({ ...all })).toBe(false);
    expect(storageDisabled({ STORAGE_BUCKET: 'b' })).toBe(false);
  });
});
```

`apps/api/src/modules/pages/avatar.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { AVATAR_MAX_BYTES, decodeAvatar } from './avatar.js';

const b64 = (bytes: number[]) => Buffer.from(bytes).toString('base64');
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0];
const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0, 0];
const WEBP = [...Buffer.from('RIFF'), 0, 0, 0, 0, ...Buffer.from('WEBP')];

describe('decodeAvatar', () => {
  it('accepts each allowed type when the bytes agree', () => {
    expect(decodeAvatar({ contentType: 'image/png', data: b64(PNG) }).ext).toBe('png');
    expect(decodeAvatar({ contentType: 'image/jpeg', data: b64(JPEG) }).ext).toBe('jpg');
    expect(decodeAvatar({ contentType: 'image/webp', data: b64(WEBP) }).ext).toBe('webp');
  });

  // Review Focus 4: the declared type is a claim; the bytes are the evidence.
  it('refuses bytes that are not the type they claim', () => {
    expect(() => decodeAvatar({ contentType: 'image/webp', data: b64(JPEG) })).toThrow(/INVALID_IMAGE|picture/i);
    expect(() => decodeAvatar({ contentType: 'image/png', data: Buffer.from('hello').toString('base64') })).toThrow();
  });

  it('refuses anything over AVATAR_MAX_BYTES', () => {
    const big = Buffer.concat([Buffer.from(PNG), Buffer.alloc(AVATAR_MAX_BYTES)]).toString('base64');
    expect(() => decodeAvatar({ contentType: 'image/png', data: big })).toThrow();
  });

  it('refuses an empty upload', () => {
    expect(() => decodeAvatar({ contentType: 'image/png', data: '' })).toThrow();
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @curios/api exec vitest run src/modules/pages/storage.test.ts src/modules/pages/avatar.test.ts`
Expected: FAIL — unresolved imports.

- [ ] **Step 3: Write `storage.ts` and `avatar.ts`**

```bash
pnpm --filter @curios/api add @aws-sdk/client-s3
```

`apps/api/src/modules/pages/storage.ts`:

```ts
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

export const STORAGE_ENV = [
  'STORAGE_ENDPOINT',
  'STORAGE_BUCKET',
  'STORAGE_ACCESS_KEY_ID',
  'STORAGE_SECRET_ACCESS_KEY',
  'STORAGE_PUBLIC_URL',
] as const;

/**
 * Whether pictures are switched off in this process: outside production, and
 * only when none of the storage settings is set -- the rule billingDisabled
 * set for Billplz. A partial set is a mistake and falls through to the
 * per-setting check that names the missing one.
 */
export function storageDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV === 'production') return false;
  return STORAGE_ENV.every((name) => !env[name]);
}

export interface AvatarStore {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  remove(key: string): Promise<void>;
}

function required(env: NodeJS.ProcessEnv, name: (typeof STORAGE_ENV)[number]): string {
  const value = env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/** R2 or S3, through the one SDK that speaks to both. */
export function createS3Store(env: NodeJS.ProcessEnv = process.env): AvatarStore {
  const bucket = required(env, 'STORAGE_BUCKET');
  required(env, 'STORAGE_PUBLIC_URL');
  const client = new S3Client({
    region: 'auto',
    endpoint: required(env, 'STORAGE_ENDPOINT'),
    forcePathStyle: true,
    credentials: {
      accessKeyId: required(env, 'STORAGE_ACCESS_KEY_ID'),
      secretAccessKey: required(env, 'STORAGE_SECRET_ACCESS_KEY'),
    },
  });
  return {
    async put(key, body, contentType) {
      await client.send(
        new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType, CacheControl: 'public, max-age=31536000, immutable' }),
      );
    },
    async remove(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}
```

`apps/api/src/modules/pages/avatar.ts`:

```ts
export const AVATAR_MAX_BYTES = 1_048_576;

export class InvalidImageError extends Error {
  readonly statusCode = 400;
  readonly code = 'INVALID_IMAGE';
  constructor() {
    super('That picture could not be used. Upload a JPEG, PNG or WebP under 1 MB.');
    this.name = 'InvalidImageError';
  }
}

const SIGNATURES = {
  'image/jpeg': { ext: 'jpg', matches: (b: Buffer) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/png': { ext: 'png', matches: (b: Buffer) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/webp': { ext: 'webp', matches: (b: Buffer) => b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' },
} as const;

/**
 * The uploaded picture as bytes, checked. The declared content type is a
 * claim; the file's first bytes are the evidence, and they must agree.
 */
export function decodeAvatar(input: { contentType: string; data: string }): { body: Buffer; ext: 'jpg' | 'png' | 'webp' } {
  const signature = SIGNATURES[input.contentType as keyof typeof SIGNATURES];
  if (!signature) throw new InvalidImageError();
  const body = Buffer.from(input.data, 'base64');
  if (body.length === 0 || body.length > AVATAR_MAX_BYTES || !signature.matches(body)) throw new InvalidImageError();
  return { body, ext: signature.ext };
}
```

Run the two files — PASS.

- [ ] **Step 4: Write the failing route tests**

`apps/api/src/modules/pages/avatar.routes.test.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { createSession, SESSION_COOKIE } from '../auth/session.service.js';
import type { AvatarStore } from './storage.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]).toString('base64');
const store: AvatarStore & { put: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> } = {
  put: vi.fn(async () => undefined),
  remove: vi.fn(async () => undefined),
};

let app: FastifyInstance;
let off: FastifyInstance;
let nth = 0;
const from = () => `203.0.113.${(nth++ % 200) + 1}`;

beforeAll(async () => {
  app = await buildApp({ pages: { store } });
  off = await buildApp({ pages: { store: null } });
  await Promise.all([app.ready(), off.ready()]);
});
afterAll(async () => {
  await Promise.all([app.close(), off.close()]);
});

async function anOwner(on = app) {
  const slug = randomUUID().slice(0, 8);
  const account = await on.prisma.account.create({
    data: { email: `pic-${randomUUID()}@example.com`, emailVerifiedAt: new Date(), pages: { create: { handle: `pc-${slug}`, skeleton: `pc-${slug}`, displayName: 'Iman' } } },
    select: { id: true },
  });
  return { accountId: account.id, cookie: (await createSession(on.prisma, account.id)).value };
}

const upload = (on: FastifyInstance, cookie: string, payload: object) =>
  on.inject({ method: 'POST', url: '/pages/avatar', remoteAddress: from(), cookies: { [SESSION_COOKIE]: cookie }, payload });

const keyOf = async (accountId: string) =>
  (await app.prisma.page.findUniqueOrThrow({ where: { accountId }, select: { avatarKey: true } })).avatarKey;

describe('POST /pages/avatar', () => {
  it('stores the picture under a fresh key and records it', async () => {
    const owner = await anOwner();
    const res = await upload(app, owner.cookie, { contentType: 'image/png', data: PNG });

    expect(res.statusCode).toBe(200);
    const key = await keyOf(owner.accountId);
    expect(key).toMatch(/^avatars\/[^/]+\/[0-9a-f-]+\.png$/);
    expect(store.put).toHaveBeenLastCalledWith(key, expect.any(Buffer), 'image/png');
  });

  it('removes the old picture after the new one is recorded', async () => {
    const owner = await anOwner();
    await upload(app, owner.cookie, { contentType: 'image/png', data: PNG });
    const first = await keyOf(owner.accountId);

    await upload(app, owner.cookie, { contentType: 'image/png', data: PNG });

    expect(await keyOf(owner.accountId)).not.toBe(first);
    expect(store.remove).toHaveBeenLastCalledWith(first);
  });

  // Review Focus 4, end to end: the old picture stays.
  it('refuses a file that is not what it claims, and keeps the old picture', async () => {
    const owner = await anOwner();
    await upload(app, owner.cookie, { contentType: 'image/png', data: PNG });
    const kept = await keyOf(owner.accountId);

    const res = await upload(app, owner.cookie, { contentType: 'image/png', data: Buffer.from('not an image').toString('base64') });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('INVALID_IMAGE');
    expect(await keyOf(owner.accountId)).toBe(kept);
  });

  it('answers STORAGE_NOT_CONFIGURED when uploads are switched off', async () => {
    const owner = await anOwner(off);
    const res = await upload(off, owner.cookie, { contentType: 'image/png', data: PNG });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('STORAGE_NOT_CONFIGURED');
  });

  it('keeps the new picture even if removing the old one fails', async () => {
    const owner = await anOwner();
    await upload(app, owner.cookie, { contentType: 'image/png', data: PNG });
    store.remove.mockRejectedValueOnce(new Error('storage blip'));

    const res = await upload(app, owner.cookie, { contentType: 'image/png', data: PNG });

    expect(res.statusCode).toBe(200);
  });
});

describe('DELETE /pages/avatar', () => {
  it('clears the picture and removes its object', async () => {
    const owner = await anOwner();
    await upload(app, owner.cookie, { contentType: 'image/png', data: PNG });
    const key = await keyOf(owner.accountId);

    const res = await app.inject({ method: 'DELETE', url: '/pages/avatar', remoteAddress: from(), cookies: { [SESSION_COOKIE]: owner.cookie } });

    expect(res.statusCode).toBe(200);
    expect(await keyOf(owner.accountId)).toBeNull();
    expect(store.remove).toHaveBeenLastCalledWith(key);
  });
});
```

- [ ] **Step 5: Write the routes**

In `apps/api/src/modules/pages/page.routes.ts`, change the plugin to take options and add:

```ts
export interface PageRouteOptions {
  /**
   * `undefined` builds a store from the environment (or none, in development
   * with no storage settings). `null` means uploads are off. Tests pass a stub.
   */
  store?: AvatarStore | null;
}

export class StorageNotConfiguredError extends Error {
  readonly statusCode = 503;
  readonly code = 'STORAGE_NOT_CONFIGURED';
  constructor() {
    super('Pictures are switched off here: no storage settings in this environment.');
    this.name = 'StorageNotConfiguredError';
  }
}

export const pageRoutes: FastifyPluginAsyncZod<PageRouteOptions> = async (app, options) => {
  // Resolved at registration, like chat's embedder: production with a missing
  // setting fails the deploy, not an owner's upload.
  const store = options.store !== undefined ? options.store : storageDisabled() ? null : createS3Store();

  // ...existing routes unchanged...

  app.post(
    '/pages/avatar',
    {
      // A 512px WebP is ~40 KB; base64 adds a third. 2 MB is the ceiling of
      // AVATAR_MAX_BYTES encoded, with room for the JSON around it.
      bodyLimit: 2 * 1024 * 1024,
      schema: { body: z.object({ contentType: z.string().max(40), data: z.string().max(1_500_000) }) },
    },
    async (request) => {
      if (!request.account) throw new UnauthenticatedError();
      if (!store) throw new StorageNotConfiguredError();
      const { body, ext } = decodeAvatar(request.body);

      const page = await app.prisma.page.findUnique({ where: { accountId: request.account.id }, select: { id: true, avatarKey: true } });
      if (!page) throw new NoPageError();

      // Random, so a replaced picture is never served from a stale cache.
      const key = `avatars/${page.id}/${randomUUID()}.${ext}`;
      await store.put(key, body, request.body.contentType);
      await app.prisma.page.update({ where: { id: page.id }, data: { avatarKey: key } });

      // After the new key is recorded, never before: a failure here leaves an
      // orphaned object, not a page pointing at nothing.
      if (page.avatarKey) {
        await store.remove(page.avatarKey).catch((error: unknown) =>
          request.log.warn({ pageId: page.id, err: error instanceof Error ? error.message : String(error) }, 'old avatar could not be removed'),
        );
      }
      return { avatarKey: key };
    },
  );

  app.delete('/pages/avatar', async (request) => {
    if (!request.account) throw new UnauthenticatedError();
    if (!store) throw new StorageNotConfiguredError();
    const page = await app.prisma.page.findUnique({ where: { accountId: request.account.id }, select: { id: true, avatarKey: true } });
    if (!page) throw new NoPageError();

    await app.prisma.page.update({ where: { id: page.id }, data: { avatarKey: null } });
    if (page.avatarKey) {
      await store.remove(page.avatarKey).catch((error: unknown) =>
        request.log.warn({ pageId: page.id, err: error instanceof Error ? error.message : String(error) }, 'removed avatar object could not be deleted'),
      );
    }
    return { status: 'removed' };
  });
};
```

Imports: `randomUUID` from `node:crypto`; `decodeAvatar` from `./avatar.js`; `createS3Store, storageDisabled, type AvatarStore` from `./storage.js`; `NoPageError` from `./page.service.js`.

In `apps/api/src/app.ts`: `AppOverrides` gains `pages?: PageRouteOptions;` and `scope.register(pageRoutes, overrides.pages ?? {})`. Add `'INVALID_IMAGE'` and `'STORAGE_NOT_CONFIGURED'` to `DOMAIN_ERROR_CODES` — the latter a 503 listed for the same reason as `BILLING_NOT_CONFIGURED`.

`apps/api/vitest.setup.ts` pins test values for the other services; leave storage unset there so the suite never reaches a real bucket — tests that need a store inject one.

- [ ] **Step 6: The editor's picture control**

`apps/web/app/app/curios/resize-image.ts`:

```ts
export const AVATAR_EDGE = 512;

/**
 * The picture, cropped to a centred square and scaled to AVATAR_EDGE, as WebP
 * base64 -- small enough to send inside JSON (see Task 9's note on why JSON).
 */
export async function resizeImage(file: File, edge = AVATAR_EDGE): Promise<{ contentType: 'image/webp'; data: string }> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = edge;
  canvas.height = edge;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser cannot prepare the picture.');
  context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, edge, edge);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The picture could not be prepared.'))), 'image/webp', 0.85),
  );
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return { contentType: 'image/webp', data: btoa(binary) };
}
```

In `profile-editor.tsx`, add props `avatarUrl: string | null`, `uploadsEnabled: boolean`, `onAvatar(url: string | null)`, `uploadAvatar(file: File)`, `removeAvatar()`. When `uploadsEnabled`, render above the name: the current picture (or a dashed circle) with a visually-hidden `<input type="file" accept="image/jpeg,image/png,image/webp" aria-label="Upload a picture">`, a **Remove picture** button when one exists, and the line "Optional. No picture? Your page shows just your name." On change: call `uploadAvatar(file)`, then `onAvatar(url)`; on failure show the error in a `Callout` and keep the old picture. When `!uploadsEnabled`, render nothing for the picture.

Add tests to a new `profile-editor.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProfileEditor } from './profile-editor.js';

const base = { displayName: 'Iman', bio: null, onChange: vi.fn(), save: vi.fn(async () => undefined), avatarUrl: null, onAvatar: vi.fn(), removeAvatar: vi.fn(async () => undefined) };

describe('ProfileEditor picture', () => {
  it('offers no upload when storage is off', () => {
    render(<ProfileEditor {...base} uploadsEnabled={false} uploadAvatar={vi.fn()} />);
    expect(screen.queryByLabelText('Upload a picture')).toBeNull();
  });

  it('uploads a chosen file and shows the new picture', async () => {
    const onAvatar = vi.fn();
    const uploadAvatar = vi.fn(async () => 'https://cdn.example/a.webp');
    render(<ProfileEditor {...base} onAvatar={onAvatar} uploadsEnabled uploadAvatar={uploadAvatar} />);

    await userEvent.upload(screen.getByLabelText('Upload a picture'), new File(['x'], 'me.png', { type: 'image/png' }));

    expect(uploadAvatar).toHaveBeenCalled();
    expect(onAvatar).toHaveBeenCalledWith('https://cdn.example/a.webp');
  });

  it('keeps the old picture and says why when an upload fails', async () => {
    const onAvatar = vi.fn();
    const uploadAvatar = vi.fn(async () => { throw new Error('That picture could not be used.'); });
    render(<ProfileEditor {...base} avatarUrl="https://cdn.example/old.webp" onAvatar={onAvatar} uploadsEnabled uploadAvatar={uploadAvatar} />);

    await userEvent.upload(screen.getByLabelText('Upload a picture'), new File(['x'], 'me.png', { type: 'image/png' }));

    expect(onAvatar).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/could not be used/i);
  });
});
```

In `my-curios.tsx`, pass `avatarUrl={page.avatarUrl}`, `uploadsEnabled`, `onAvatar={(url) => update({ avatarUrl: url })}`, `uploadAvatar={api.uploadAvatar}`, `removeAvatar={async () => { await api.removeAvatar(); update({ avatarUrl: null }); }}` to `ProfileEditor`, and delete the hidden input. In `my-curios-wrapper.tsx`, fill the two calls:

```tsx
    uploadAvatar: async (file) => {
      const image = await resizeImage(file);
      const { avatarKey } = await apiFetch<{ avatarKey: string }>('/pages/avatar', { method: 'POST', body: JSON.stringify(image) });
      return avatarUrlFromKey(avatarKey);
    },
    removeAvatar: async () => { await apiFetch('/pages/avatar', { method: 'DELETE' }); },
```

`STORAGE_PUBLIC_URL` is server-only; pass it from `page.tsx` as a `publicBase` prop to `MyCurios`, and build `avatarUrlFromKey` from it inside the wrapper (`${publicBase}/${key}`).

`.env.example` — a storage block after Billplz's:

```
# --- Pictures -------------------------------------------------------------------
# An owner's profile picture, in S3-compatible storage (Cloudflare R2 or AWS S3).
# STORAGE_PUBLIC_URL is the bucket's public address that pictures load from.
#
# In development all five can be left out: uploads switch off and the picture
# control is hidden. All five or none -- a partial set refuses to start and names
# the missing one. Production refuses to start without them.
STORAGE_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
STORAGE_BUCKET=curios-avatars
STORAGE_ACCESS_KEY_ID=replace-this
STORAGE_SECRET_ACCESS_KEY=replace-this
STORAGE_PUBLIC_URL=https://pub-<hash>.r2.dev
```

- [ ] **Step 7: Run everything and watch it pass**

Run: `pnpm --filter @curios/api exec vitest run src/modules/pages` and `pnpm --filter @curios/web exec vitest run app/app/curios`
Expected: PASS.

- [ ] **Step 8: Prove by mutation, then load it**

| Mutation | Test that must go red |
|---|---|
| skip `signature.matches` | `refuses bytes that are not the type they claim` |
| `>` → `>=` off by one on the size limit, or drop it | `refuses anything over AVATAR_MAX_BYTES` |
| remove the old object before recording the new key | `removes the old picture after…` (order: assert with `mock.invocationCallOrder` if needed) |
| let the `remove` failure propagate | `keeps the new picture even if removing the old one fails` |
| a fixed key instead of `randomUUID()` | `stores the picture under a fresh key…` |
| `storageDisabled` ignores `NODE_ENV` | `never switches them off in production` |
| call `onAvatar` before the upload resolves | `keeps the old picture and says why…` |

Dev-server check for `/app/curios` and `/imnmuqri`.

- [ ] **Step 9: Commit**

```bash
git add apps/api apps/web .env.example pnpm-lock.yaml
git commit -m "feat: an optional profile picture, stored in R2 or S3 and shown only when uploaded"
```

---

### Task 10: the documents this slice corrects

**Files:**
- Modify: `devDocs/FRONTEND.md`, `devDocs/DESIGN.md`, `devDocs/README.md`, `devDocs/slice-13-build-spec.md`

- [ ] **Step 1: FRONTEND.md**

In **Routes**: replace `/app/links` and `/app/appearance` with `/app/curios   My Curios: profile, links, appearance, live preview`, and note `/app` lands there.

In **Rendering**: amend "Server render the shell, links, and the FAQ content into real DOM" — the public page server-renders the bento of links; readable answers now live on the FAQ pages (indexed for businesses), and the page carries no fact list. Mark it *Amended by slice 13*, keeping the original sentence quoted, in the style the section already uses for slice 3's amendment.

Add a **My Curios** section: autosave with per-control status, the live preview is the same `BentoPage` visitors see, drag plus up/down buttons for reorder, the 30-link limit.

- [ ] **Step 2: DESIGN.md**

In **Components worth naming**: replace `LinkRow`'s row with `BentoPage` / tiles — "the shopfront arrangement: an accent lead tile, a warm second, then smalls and wides; sizes automatic until the owner picks one." Add a **The two page styles** section: Soft (default, 16px, light shadow) and High contrast (14px, ink tiles), one accent per page with text colour computed for contrast, six heading fonts, and that the dashboard speaks Plus Jakarta Sans. Keep the banned list unchanged.

- [ ] **Step 3: README.md**

A **Settled decisions** row:

| Question | Decision |
|---|---|
| The page's look | Owner-arranged in My Curios: a bento of links in the shopfront arrangement, sizes automatic until chosen, Soft or High contrast, one accent colour (presets or custom, text colour computed for contrast), six curated heading fonts, an optional picture in R2/S3. No fact list on the page; facts reach visitors through the ask bar and the FAQ pages. See slice-13-build-spec.md. |

- [ ] **Step 4: The spec's revisions**

In `devDocs/slice-13-build-spec.md`, add dated `*Revised 2026-09-26: …*` notes, originals kept above them, for: the arrangement on pages of one link (Wide) and two (two Smalls), because a Tall tile there leaves a hole; the picture upload being base64 in JSON rather than multipart, to keep `apiFetch`'s JSON-only CSRF stand-in; and `BIO_MAX = 160`, which the spec left unstated.

- [ ] **Step 5: Run the gates and commit**

Run the three gates from Global Constraints; each must report 11/11.

```bash
git add devDocs
git commit -m "docs: My Curios, the bento page, and the three places that described the old one"
```

---

## Self-review

**1. Spec coverage.**

| Spec section | Task |
|---|---|
| Sidebar shell, groups, View page, no Live, phone fold, `/app` → My Curios | 5 |
| Links: add, edit, remove, reorder, size | 3 (API), 7 (editor) |
| My Curios: profile, links, appearance, live preview, autosave | 7, 8, 9 |
| The data (enums, columns, limits) | 1, 2 |
| Link icons from the host | 1 (`linkKind`), 6 (rendered) |
| The arrangement | 1 (`arrangeTiles`), 6 |
| Two styles, accent + readable text, fonts | 1 (`readableOn`), 5 (fonts), 6 (CSS), 8 (editor) |
| Public page, no fact list, no-JS links, picture fallback | 6 |
| API table | 3, 4, 9 |
| Storage + dev switch | 9 |
| Failure modes table | 3 (stale order), 7 (retry, snap back), 9 (upload keeps old, storage down) |
| Testing, dev-server check | every task |
| Documents corrected | 10 |

**2. Placeholders.** None: every code step carries its code. The two places a task says "read the file first" (Task 6's page test fixtures, Task 5's layout test) name exactly what to assert, because those files' fixture names are the file's own.

**3. Type consistency.** `TileSize`/`PageStyle`/`HeadingFont` come from `@curios/core/bento` in every task; the Prisma enums spell them identically (Task 2). `LinkItem` (Task 7) matches `MyCurios['links'][number]` (Task 2) and the API's `LinkRow` (Task 3). `CuriosApi.uploadAvatar` returns `string | null` in Tasks 7 and 9. `AppearancePatch` is defined once in `my-curios.tsx` and imported by Task 8.

**4. Review Focus.** Five inputs listed at the top, each with its test in the owning task: stale reorder (Task 3 API + Task 7 client), noisy and dangerous addresses (Task 1), emoji labels (Tasks 1 and 3), lying files (Task 9), empty pages (Tasks 6 and 7).
