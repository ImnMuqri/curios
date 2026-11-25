# Widgets, Layout and Bento Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Owners paste a Spotify, Apple Music, YouTube Music, SoundCloud, Google Maps, Cal.com, Calendly or Canva link and it becomes a player on their page; a Layout tab orders everything by drag; the page draws as List or Bento.

**Architecture:** A widget is a `Link` row with `kind: WIDGET`, a `provider` and an `embedRef`; one pure module in `@curios/core` parses pasted links and builds frame addresses, used by the API (to validate) and the page (to render). The page's order becomes one list of entries (links, widgets, the shop, "People often ask") built by a core function, saved by the existing reorder endpoint. Bento reuses `TileSize` and `arrangeTiles`.

**Tech Stack:** Prisma/Postgres, Fastify + zod (apps/api), Next.js 15 App Router (apps/web), Vitest.

**Spec:** `docs/superpowers/specs/2026-11-26-widgets-and-layout-design.md`

## Global Constraints

- A framed address is only ever built by `widgetSrc()` from a stored `provider` + `embedRef`; never from what the owner typed.
- CSP `frame-src` lists exactly: `https://open.spotify.com https://embed.music.apple.com https://www.youtube-nocookie.com https://w.soundcloud.com https://www.google.com https://cal.com https://calendly.com https://www.canva.com`.
- Widgets count toward `MAX_LINKS` (30). No plan gate.
- A page that never opens Layout renders as today: List, links in order, shop first while open, "People often ask" after the links.
- Iframes: `loading="lazy"`, a `title`, `referrerPolicy="strict-origin-when-cross-origin"`, never autoplay.
- Short links (`spotify.link`, `maps.app.goo.gl`, `on.soundcloud.com`) are resolved once, at save, through `createHostGuard`; never at render.
- Ask mode hides widgets as it hides links.
- Copy is plain English; refusal sentences name what to paste.
- Edit files with targeted edits; the repo has no Prettier config, do not run Prettier.

## Review Focus

1. **A link from a supported host that is not embeddable** (a Spotify profile `/user/x`, a Maps directions URL, a Canva edit link): refused with the sentence for that service, nothing saved. Tests in Task 1.
2. **A short link that redirects somewhere else** (to a non-provider host, or a private address): refused, never stored. Test in Task 3.
3. **The shop closed after it was placed mid-list, or the FAQ block with no entries**: the order still saves and renders; the stored position is clamped, not trusted. Tests in Task 7.
4. **A frame that will not load** (blocked by an extension, service down): the row still shows its label and "Open in {service}". Test in Task 5.
5. **Bento with an odd count or sizes ending half a row**: no empty half-row at the end; a widget never shrinks below its minimum. Tests in Task 10.

---

## Part 1: Widgets

### Task 1: The widget link parser and frame builder (`@curios/core/widgets`)

**Files:**
- Create: `packages/core/src/widgets.ts`, `packages/core/src/widgets.test.ts`
- Modify: `packages/core/package.json` (export `./widgets` like the other subpaths)

**Interfaces:**
- Produces:
  - `WIDGET_PROVIDERS = ['SPOTIFY','APPLE_MUSIC','YOUTUBE','SOUNDCLOUD','GOOGLE_MAPS','CALCOM','CALENDLY','CANVA'] as const`; `type WidgetProvider`.
  - `WIDGET_NAMES: Record<WidgetProvider, string>` ("Spotify", "Apple Music", "YouTube Music", "SoundCloud", "Google Maps", "Cal.com", "Calendly", "Canva").
  - `parseWidgetLink(raw: string): { ok: true; provider: WidgetProvider; embedRef: string } | { ok: false; short: true; provider: WidgetProvider } | { ok: false; short: false; message: string }`
  - `widgetSrc(provider: WidgetProvider, embedRef: string): string`
  - `widgetHeight(provider: WidgetProvider, embedRef: string): number` (px)
  - `minWidgetSize(provider: WidgetProvider, embedRef: string): TileSize`
  - `WIDGET_FRAME_ORIGINS: readonly string[]` (the eight origins in Global Constraints)

`embedRef` formats (opaque to everything but this file): Spotify `track/{id}` etc.; Apple Music the path after the host (`my/album/name/123?i=456`); YouTube `v/{id}` or `list/{id}`; SoundCloud the canonical `https://soundcloud.com/...` URL; Google Maps the place query text; Cal.com/Calendly `{user}/{event}`; Canva `{designId}/{key}`.

- [ ] **Step 1: Write the failing tests** in `widgets.test.ts`, one `describe` per provider, each with an accepted link → exact `{provider, embedRef}` and its exact `widgetSrc`, e.g.:

```ts
expect(parseWidgetLink('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=x')).toEqual({ ok: true, provider: 'SPOTIFY', embedRef: 'playlist/37i9dQZF1DXcBWIGoYBM5M' });
expect(widgetSrc('SPOTIFY', 'playlist/37i9dQZF1DXcBWIGoYBM5M')).toBe('https://open.spotify.com/embed/playlist/37i9dQZF1DXcBWIGoYBM5M');
expect(parseWidgetLink('https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=x')).toEqual({ ok: true, provider: 'YOUTUBE', embedRef: 'v/dQw4w9WgXcQ' });
expect(widgetSrc('YOUTUBE', 'v/dQw4w9WgXcQ')).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
expect(widgetSrc('YOUTUBE', 'list/PL123')).toBe('https://www.youtube-nocookie.com/embed/videoseries?list=PL123');
expect(parseWidgetLink('https://maps.app.goo.gl/abc')).toEqual({ ok: false, short: true, provider: 'GOOGLE_MAPS' });
```

Also: Review Focus 1 refusals (`open.spotify.com/user/x`, `google.com/maps/dir/...`, `canva.com/design/ID/edit`, `calendly.com` with no user) each return `ok: false, short: false` and a message naming what to paste; `https://evil.example/open.spotify.com/track/1` and `javascript:` are refused; `widgetSrc` output always starts with one of `WIDGET_FRAME_ORIGINS`; ids with characters outside `[A-Za-z0-9_-]` are refused (no injection into the frame URL); `minWidgetSize` is `WIDE` for Spotify playlist/album/artist/show, Google Maps, Cal.com, Calendly, Canva, and `SMALL` for a Spotify track/episode.

- [ ] **Step 2: Run** `pnpm --filter @curios/core exec vitest run src/widgets.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `widgets.ts`. Parse with `new URL()`; accept only `https:`; match hosts exactly (`open.spotify.com`, `music.apple.com`, `music.youtube.com`/`www.youtube.com`/`youtube.com`/`youtu.be`, `soundcloud.com`, `www.google.com`/`google.com`/`maps.google.com`, `cal.com`, `calendly.com`, `www.canva.com`/`canva.com`); short hosts (`spotify.link`, `maps.app.goo.gl`, `goo.gl` with `/maps`, `on.soundcloud.com`) return `short: true`. Google Maps `embedRef` is the decoded place name from `/maps/place/{name}/` or the `q` param; `widgetSrc` encodes it with `encodeURIComponent` into `https://www.google.com/maps?q=…&output=embed`. Heights per the spec (Spotify track 152, else 352; YouTube 0 meaning 16:9 by aspect ratio; Maps 300; Cal.com/Calendly 640; Canva 0 meaning 4:3; SoundCloud track 166, set 450).
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): parse widget links and build their player addresses`.

### Task 2: Store a widget on a link row

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (`model Link`)
- Create: `packages/db/prisma/migrations/20261126100000_link_widgets/migration.sql`

**Interfaces:**
- Produces: `enum LinkKind { LINK WIDGET }`, `enum WidgetProvider { SPOTIFY APPLE_MUSIC YOUTUBE SOUNDCLOUD GOOGLE_MAPS CALCOM CALENDLY CANVA }`; `Link.kind LinkKind @default(LINK)`, `Link.provider WidgetProvider?`, `Link.embedRef String?`.

- [ ] **Step 1:** Add the enums and columns, each with a `///` comment as the schema does. Migration: `CREATE TYPE` ×2, three `ALTER TABLE "Link" ADD COLUMN`, every existing row `LINK`.
- [ ] **Step 2: Run** `prisma migrate deploy` against dev and test DBs (`DATABASE_URL` from `.env`, then `DATABASE_URL_TEST`), then `pnpm --filter @curios/db exec prisma generate`. Expected: "All migrations have been successfully applied." Never `migrate dev`/`diff` with the test DB as shadow.
- [ ] **Step 3: Commit** `feat(db): a link row can be a widget`.

### Task 3: API: add and edit a widget

**Files:**
- Modify: `apps/api/src/modules/links/link.service.ts`, `apps/api/src/modules/links/link.routes.ts`, `apps/api/src/app.ts` (error mapping if errors are mapped centrally)
- Create: `apps/api/src/modules/links/widget-resolve.ts`
- Test: `apps/api/src/modules/links/link.routes.test.ts` (extend), `apps/api/src/modules/links/widget-resolve.test.ts`

**Interfaces:**
- Consumes: `parseWidgetLink`, `MAX_LINKS` from core; `createHostGuard` from `../ingest/host-guard.js`.
- Produces:
  - `LinkRow = { id; label; url; size: TileSize | null; kind: 'LINK' | 'WIDGET'; provider: WidgetProvider | null; embedRef: string | null }` (every existing caller gets the new fields).
  - `resolveShortLink(url: string, deps: { fetch: typeof fetch; guard: HostGuard }): Promise<string | null>`: one `fetch(url, { redirect: 'manual' })` after `guard(host)`; returns the `Location` header, or null.
  - `addWidget(prisma, accountId, input: { url: string; label: string | null }, resolve: (url: string) => Promise<string | null>): Promise<LinkRow>`; throws `InvalidWidgetError` (400, code `INVALID_WIDGET`, the parser's message) or `LinkLimitError`.
  - Route `POST /links/widgets` body `{ url: string(max 2000), label: string(max 400).nullable() }` → `201 { link: LinkRow }`. `PATCH /links/:id` on a widget accepts `label` and `size`; a `url` on a widget re-parses through the same path.

- [ ] **Step 1: Write the failing tests:** a Spotify link saves `kind WIDGET`, `provider SPOTIFY`, the `embedRef`, the pasted `url`; label null saves `WIDGET_NAMES[provider]`; a non-embeddable link → 400 `INVALID_WIDGET` and no row; the 31st item (links + widgets) → `LinkLimitError`; a short link whose resolver returns a Spotify URL saves; **Review Focus 2:** a resolver returning `https://evil.example/x` → 400, no row; `resolveShortLink` with a guard that throws (private address) returns null; another account's widget id on PATCH → 404.
- [ ] **Step 2: Run** `cd apps/api && npx vitest run src/modules/links`. Expected: FAIL.
- [ ] **Step 3: Implement** as in Interfaces. In the route, build `resolve` from the real `fetch` and `createHostGuard()`; tests inject their own. `listLinks` selects the new fields.
- [ ] **Step 4: Run** the same tests and `npx tsc --noEmit -p .`. Expected: PASS, exit 0.
- [ ] **Step 5: Commit** `feat(api): add a widget from a pasted link`.

### Task 4: Read models carry widgets; the chat sees them as links

**Files:**
- Modify: `packages/db-read/src/page.query.ts` (`PublicLink`, the `links` select), `packages/db-read/src/my-curios.query.ts` (`links` type and select), `apps/web` fixtures that build these types
- Test: `packages/db-read/src/page.query.test.ts`, `apps/api/src/modules/chat/prompt.test.ts`

**Interfaces:**
- Produces: `PublicLink` and My Curios link items gain `kind`, `provider`, `embedRef`.

- [ ] **Step 1: Write the failing tests:** `getPublicPage` returns a widget row with its three fields; the chat PROFILE block lists a widget as `{label} -- {pasted url}` and never contains `/embed/` or `output=embed`.
- [ ] **Step 2: Run** `pnpm turbo run test --filter=@curios/db-read --force --concurrency=1` and `cd apps/api && npx vitest run src/modules/chat/prompt.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the selects and types; the chat already formats `profile.links` from `label` + `url`, so only confirm the widget's pasted `url` is what reaches it.
- [ ] **Step 4: Run** both, plus `npx tsc --noEmit -p .` in `packages/db-read`, `apps/api`, `apps/web`. Expected: PASS, exit 0.
- [ ] **Step 5: Commit** `feat(db-read): widgets on the public page and in My Curios`.

### Task 5: Draw a widget on the page

**Files:**
- Create: `apps/web/app/_bento/Widget.tsx`
- Modify: `apps/web/app/_bento/BentoPage.tsx` (link list), `apps/web/app/_bento/Bento.module.css`, `apps/web/lib/security-headers.ts`
- Test: `apps/web/app/_bento/Widget.test.tsx`, `apps/web/lib/security-headers.test.ts`

**Interfaces:**
- Consumes: `widgetSrc`, `widgetHeight`, `WIDGET_NAMES`, `WIDGET_FRAME_ORIGINS`.
- Produces: `<Widget provider embedRef label url interactive />`.

- [ ] **Step 1: Write the failing tests:** an iframe with `src === widgetSrc(...)`, `loading="lazy"`, `title` "{label}, {service name}", no `autoplay` in `allow`; with `interactive={false}` (editor preview) a non-clickable cover over the frame; **Review Focus 4:** a visible "Open in {service}" link to the pasted `url` sits under the frame (always rendered, so a blocked frame still leaves a way through); the owner's label shows as a line above the frame when given (none when it is only the service name); in `mode="chat"` no widget renders; the CSP header's `frame-src` equals the eight origins exactly.
- [ ] **Step 2: Run** `cd apps/web && npx vitest run app/_bento/Widget.test.tsx lib/security-headers.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** In `BentoPage`, a link with `kind === 'WIDGET'` renders `<li data-widget><Widget …/></li>`; the frame sits in a box with the page's button radius and frame colours (`--btn-radius`, `--pill-ring`); heights from `widgetHeight`, 0 meaning `aspect-ratio`. Add `frame-src` built from `WIDGET_FRAME_ORIGINS`. `sandbox` per service starts from `allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox` (plus `allow-forms` for Cal.com and Calendly, which take a booking) and is narrowed only as far as each player still works.
- [ ] **Step 4: Run** the tests, then load `/nadia` in `pnpm dev` with a Spotify widget row inserted for the check and deleted by its id after: the player shows, no CSP error in the console. Expected: PASS and a playing embed.
- [ ] **Step 5: Commit** `feat(page): widgets draw as their service's player`.

### Task 6: Add a widget in My Curios

**Files:**
- Modify: `apps/web/app/app/curios/links-editor.tsx`, `apps/web/app/app/curios/my-curios-wrapper.tsx` (`addWidget` in the API object), `apps/web/app/app/curios/my-curios.tsx` (`CuriosApi.addWidget`), `apps/web/app/app/curios/curios.module.css`
- Test: `apps/web/app/app/curios/links-editor.test.tsx`

**Interfaces:**
- Consumes: `POST /links/widgets`; `parseWidgetLink` (client-side recognition only; the server decides).
- Produces: `CuriosApi.addWidget(input: { url: string; label: string | null }) => Promise<LinkItem>`.

- [ ] **Step 1: Write the failing tests:** "Add a widget" opens a field; pasting a Spotify link shows "Spotify" with its icon before saving; saving calls `addWidget` with the url and label; a server `INVALID_WIDGET` shows its message; a saved widget row shows the service name, label, and no URL edit box.
- [ ] **Step 2: Run** `cd apps/web && npx vitest run app/app/curios/links-editor.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement**, reusing the add-link row's look; service icons as small inline SVGs.
- [ ] **Step 4: Run** the tests and `npx tsc --noEmit -p .`; then add a widget in the running dashboard and see it in the preview. Expected: PASS.
- [ ] **Step 5: Commit** `feat(curios): add a widget from the Links tab`. **Part 1 ships here.**

## Part 2: The Layout tab

### Task 7: One ordered list of everything on the page

**Files:**
- Modify: `packages/core/src/bento.ts`, `packages/db/prisma/schema.prisma` (+ migration `20261126110000_page_faq_position`), `apps/api/src/modules/links/link.service.ts` (`reorderLinks`)
- Test: `packages/core/src/bento.test.ts`, `apps/api/src/modules/links/link.routes.test.ts`

**Interfaces:**
- Produces:
  - `FAQ_TILE_ID = 'faq'`; `Page.faqPosition Int?` (null = after the last item).
  - `pageEntries<L extends { id: string; size: TileSize | null }>(links: L[], shop: ShopTilePlacement | null, faq: { position: number | null } | null): PageEntry<L>[]`, where `PageEntry<L> = BentoEntry<L> | { kind: 'faq'; id: typeof FAQ_TILE_ID; size: 'WIDE' }`. Shop placed as `withShopTile` does; FAQ at its clamped position, or last.
  - `reorderLinks` accepts `FAQ_TILE_ID` once exactly when the page has an FAQ block (business mode), and stores its index in `faqPosition`.

- [ ] **Step 1: Write the failing tests** — **Review Focus 3:** shop at position 9 with 3 links lands last; FAQ position null lands last; FAQ position 0 lands first; shop and FAQ both given land in the order sent; `reorderLinks` with `faq` on a personal page → `LinkOrderStaleError`; with `shop` when closed → `LinkOrderStaleError` (as today).
- [ ] **Step 2: Run** core and link tests. Expected: FAIL.
- [ ] **Step 3: Implement**; `withShopTile` stays, written in terms of `pageEntries`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): the page's pieces in one order, the FAQ block included`.

### Task 8: The page draws that order

**Files:**
- Modify: `apps/web/app/_bento/BentoPage.tsx`, `packages/db-read/src/page.query.ts` + `my-curios.query.ts` (select `faqPosition`), `apps/web/app/[handle]/page.tsx`
- Test: `apps/web/app/_bento/BentoPage.test.tsx`

- [ ] **Step 1: Write the failing tests:** with `shop.position = 2` the shop pill is the third item; with `faqPosition = 0` "People often ask" comes before the links; **Global Constraint:** with defaults (shop 0, FAQ null) the order matches today's (shop, links, FAQ).
- [ ] **Step 2: Run** `cd apps/web && npx vitest run app/_bento/BentoPage.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement:** render from `pageEntries(...)`; the FAQ section moves inside the list's flow (keep its own markup and `aria-labelledby`).
- [ ] **Step 4: Run** the tests; load `/nadia` and confirm today's look unchanged. Expected: PASS.
- [ ] **Step 5: Commit** `feat(page): draw the shop and People often ask where the owner put them`.

### Task 9: The Layout tab with drag

**Files:**
- Create: `apps/web/app/app/curios/layout-editor.tsx`, `apps/web/app/app/curios/layout-editor.test.tsx`
- Modify: `apps/web/app/app/curios/my-curios.tsx` (`TABS` gains `{ id: 'layout', label: 'Layout' }`), `apps/web/app/app/curios/links-editor.tsx` (remove the arrows and `move`), `apps/web/app/app/curios/curios.module.css`, `packages/core/src/help/faq.md` (`page-links`, `page-shop-tile`) then `pnpm --filter @curios/core gen:help`

**Interfaces:**
- Consumes: `pageEntries`, `CuriosApi.reorder(ids)` (now including `shop`/`faq` ids).
- Produces: `<LayoutEditor entries onReorder />`.

- [ ] **Step 1: Write the failing tests:** rows in page order with a drag handle each; keyboard: focus a row, Space lifts, ArrowDown moves, Space drops, then `onReorder` is called once with the new ids and a live region announces "Moved {name} to position {n} of {total}"; Escape cancels with no call; a failed save restores the previous order and shows an error; Links tab no longer shows move buttons.
- [ ] **Step 2: Run** `cd apps/web && npx vitest run app/app/curios`. Expected: FAIL.
- [ ] **Step 3: Implement** with pointer events (`setPointerCapture`, works for touch) and the keyboard flow above; one save per drop. Use dnd-kit only if touch scrolling and dragging cannot both work by hand. Update the two help entries: links are ordered in Layout by dragging; the shop button and People often ask can be moved there.
- [ ] **Step 4: Run** the tests and `gen:help`'s check; drag in the running dashboard with mouse and with the phone-sized preview. Expected: PASS, order persists after reload.
- [ ] **Step 5: Commit** `feat(curios): Layout tab, drag to order everything on the page`. **Part 2 ships here.**

## Part 3: List or Bento

### Task 10: The layout choice and tile sizes

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (+ migration `20261126120000_page_layout`), `apps/api/src/modules/pages/appearance.service.ts` + `page.routes.ts` (`layout`), `packages/core/src/bento.ts` (`arrangeTiles` respects minimums), db-read page and My Curios queries
- Test: `packages/core/src/bento.test.ts`, `apps/api/src/modules/pages/appearance.test.ts`

**Interfaces:**
- Produces: `enum PageLayout { LIST BENTO }`, `Page.layout PageLayout @default(LIST)`; appearance patch `layout?: 'LIST' | 'BENTO'`; `arrangeTiles` takes an optional `minSize(entry) => TileSize` and never returns a size smaller than it.

- [ ] **Step 1: Write the failing tests** — **Review Focus 5:** five Small tiles end with the last one Wide (no half row); a Spotify playlist widget set to Small comes back Wide; FAQ is always Wide; `layout: 'GRID'` → 400; default `LIST`.
- [ ] **Step 2: Run** core and appearance tests. Expected: FAIL.
- [ ] **Step 3: Implement.** Size order SMALL < WIDE = TALL < BIG for the minimum check (WIDE satisfies a WIDE minimum; TALL does not).
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(page): a page can be laid out as a bento grid`.

### Task 11: Draw Bento, and choose it in Layout

**Files:**
- Modify: `apps/web/app/_bento/BentoPage.tsx`, `apps/web/app/_bento/Bento.module.css`, `apps/web/app/app/curios/layout-editor.tsx`, `apps/web/app/[handle]/page.tsx`
- Test: `apps/web/app/_bento/BentoPage.test.tsx`, `apps/web/app/app/curios/layout-editor.test.tsx`

- [ ] **Step 1: Write the failing tests:** `layout="BENTO"` renders the list as a two-column grid with each item's `data-size`; a Small link tile shows its icon and a label of at most 2 lines; Layout shows List/Bento at the top and a size picker per row only in Bento, offering no size below `minWidgetSize`; choosing Bento saves `{ layout: 'BENTO' }`; choosing a size calls the existing `PATCH /links/:id` `size`, or the store `tileSize` for the shop.
- [ ] **Step 2: Run** the two test files. Expected: FAIL.
- [ ] **Step 3: Implement** the grid with CSS grid (`grid-template-columns: 1fr 1fr`, spans from size); all four button styles and both colours apply to tiles; the grid stays two columns on a phone.
- [ ] **Step 4: Run** the tests; in the running app switch Nadia's page to Bento with a link, a widget, the shop and FAQ, screenshot List and Bento in light and dark at 390px and 1440px, then switch back. Expected: PASS, no half rows, no squashed widget.
- [ ] **Step 5: Commit** `feat(curios): choose List or Bento and size each piece`. **Part 3 ships here.**
