# Slice 13 — My Curios: a bento page the owner arranges

**Goal:** make the public page what a link-in-bio page should be — the owner's picture and name,
a bento grid of their links, and the ask bar — and give the owner a place to arrange it. Today the
page can show nothing but a list of facts, because the links half of the product was never built:
there is no links API and no screen to add one. `/imnmuqri` had zero links and no bio when this was
written.

Designed with the owner on 2026-09-26, with mockups; the choices below are theirs.

---

## What is in, what is out

**In:**

1. **A dashboard shell with a sidebar.** Light sidebar, Plus Jakarta Sans, line icons, three groups:
   *Your page* (My Curios, Review with its waiting count, Add a source), *Visitors* (Questions,
   Leads), *Account* (Billing, Settings). Owner's name and page link at the bottom. A top bar with a
   breadcrumb and **View page ↗** — no "Live" badge. On a phone the sidebar folds into a top bar with
   a menu button. `/app` opens My Curios. Existing screens move inside the shell unchanged.
2. **Links.** Add, edit, remove, reorder, and a size per tile.
3. **My Curios**, one screen with a live preview always visible: profile (picture, display name,
   bio), links, appearance.
4. **The public page as a bento grid**, in one of two styles, with no fact list.
5. **Appearance:** style, accent colour, heading font, optional picture.

**Out, and why:**

- **Removing a source in Settings.** Its own spec next. A fact does not record which ingestion
  produced it (`Fact.sourceUrl` is the crawled sub-page, and pasted-text facts carry nothing), so
  "remove this source and its facts" needs a schema change and has open questions of its own —
  chiefly what happens to facts written before the link existed.
- **Owner-uploaded link icons.** Icons are detected from the address. `Link.icon` stays unused.
- **Per-tile colours.** One accent colour drives the page.
- **Analytics** (visits, clicks). Nothing measures them today and this slice does not start.
- **Dark mode.** DESIGN.md's banned list, unchanged.

---

## Decisions the owner made

| Question | Decision |
|---|---|
| What of the facts shows on the public page | None as a list. The ask bar's rotating suggestions come from facts' questions; business pages keep the FAQ link. |
| Bento arrangement | The "shopfront" arrangement: a tall accent lead tile, a warm second tile, then smalls and wides. |
| Styles | Two: **Soft** (default) and **High contrast**, same arrangement, different treatment. Soft's corners were judged too round at 22px; 16px. |
| Who decides tile sizes | Automatic by position, and the owner can override any tile with Small / Wide / Tall / Big. |
| Dashboard sidebar | Light. |
| Dashboard font | Plus Jakarta Sans. |
| Picture | Optional. Shown only when uploaded; otherwise the name stands alone. Stored in object storage (R2 or S3). |
| Colour | Eight curated accents plus a custom colour picker. |
| Heading font | Six curated: Jakarta, Bricolage Grotesque, Fraunces, Space Grotesk, DM Serif Display, Outfit. |

---

## The data

All additive; no existing column changes meaning.

**`Link`** gains:

```prisma
enum TileSize { SMALL WIDE TALL BIG }

model Link {
  // existing: id, pageId, label, url, icon, position
  /// Null is "automatic": the arrangement decides from the tile's position.
  size TileSize?
}
```

`position` remains the order and is rewritten as a whole on reorder (see the API).

**`Page`** gains:

```prisma
enum PageStyle { SOFT CONTRAST }
enum HeadingFont { JAKARTA BRICOLAGE FRAUNCES SPACE_GROTESK DM_SERIF OUTFIT }

model Page {
  // existing: displayName, bio, ...
  style       PageStyle   @default(SOFT)
  /// #rrggbb. Curios green unless the owner picks another.
  accentColor String      @default("#0c7a62")
  headingFont HeadingFont @default(JAKARTA)
  /// The object key of the uploaded picture. Null is no picture.
  avatarKey   String?
}
```

**Limits and rules, enforced in the API and mirrored in the editor:**

- A page holds at most **30** links.
- A label is required, 1–40 characters after trimming.
- A URL without a scheme gets `https://`. Only `http:`, `https:`, `mailto:` and `tel:` are
  accepted — anything else (`javascript:`, `data:`) would be a clickable link on a public page.
- `accentColor` must match `^#[0-9a-f]{6}$` (lower-cased on write).
- The picture: JPEG, PNG or WebP, at most 1 MB, resized to 512×512 in the browser before upload.

*Revised 2026-09-26: `BIO_MAX = 160` (code points), left unstated above. `LABEL_MAX`,
`DISPLAY_NAME_MAX` and the rest are as listed; the bio limit is the one this section
never gave a number.*

---

## Link icons

Detected from the URL's host, never stored: WhatsApp (`wa.me`, `whatsapp.com`), Instagram,
LinkedIn, TikTok, Facebook, X/Twitter, YouTube, GitHub, Shopee, Lazada, Linktree, email
(`mailto:`), phone (`tel:`), otherwise a generic web label. Shown as the small mono label on a tile
(as in the mockups), not as an emoji — DESIGN.md bans emoji as an icon system.

---

## The arrangement

A two-column grid with `grid-auto-flow: dense`, so tiles pack without holes.

**Automatic sizes, by position (1-based), for a link whose `size` is null:**

1. **Tall**, in the accent colour.
2. **Small**, in the warm second accent.
3. onward: Small, Small, Wide, repeating — and the final tile becomes **Wide** when it would
   otherwise leave an empty half-row.

*Revised 2026-09-26: the numbered rule above is the arrangement from three links onward.
A page with exactly **one** link renders it as a single **Wide** tile, and a page with
exactly **two** renders both as **Small** — a Tall lead tile at either of those counts
would leave a hole (its neighbouring column empty at one link, or a gap under the small
at two), which the position rule alone does not avoid.*

A link with a `size` uses it. Sizes map to grid spans: Small 1×1, Wide 2×1, Tall 1×2, Big 2×2. A pure
function (`arrangeTiles(links) → { link, span, tone }[]`) lives in `@curios/core` and is what both
the public page and the editor's live preview render, so the preview cannot disagree with the page.

---

## The two styles

Same arrangement; only the treatment differs.

| | Soft (default) | High contrast |
|---|---|---|
| Page background | pale grey-green | near-white |
| Tiles | white and pale accent tints | ink, with accent tiles |
| Corner radius | 16px | 14px |
| Depth | a light shadow | none; contrast does the work |
| Ask bar | white pill, soft | outlined in ink |

**The accent colour** paints the lead tile, the ask bar's emphasis and the chat sheet's highlights.
Text on any accent is black or white, whichever has the higher WCAG contrast ratio against it
(`readableOn(hex)` in `@curios/core`), so no custom colour can make a page unreadable. The warm
second tile uses a tint derived from the accent in Soft and the product's kuning in High contrast.

**Fonts.** The heading font applies to the name and tile labels; body text stays Inter. All six
are declared with `next/font` (`display: swap`, `preload: false`), so a visitor downloads only the
face their page uses.

---

## The public page

Top to bottom: picture (only when `avatarKey` is set) beside the display name, with the
`curios.my/handle` line under it; the bio; the bento grid; the ask bar; on a business page with
entries, the FAQ link.

**No fact list.** The `What people ask` section is removed. Facts reach visitors through the ask bar
and, for businesses, the FAQ pages.

**Without JavaScript** the grid is plain server-rendered anchors, so the page still works as a link
page; only the ask bar needs JS. This moves FRONTEND.md's "readable answers on the page" promise to
the FAQ pages, which stay indexed for businesses; personal pages are noindex by default. Both
documents are corrected (see the end).

**The picture** loads from the bucket's public URL (`STORAGE_PUBLIC_URL` + key), with explicit
width and height so it cannot shift the layout. If it fails to load, it is hidden and the name
stands alone — never a broken-image icon.

---

## My Curios

One screen, the live preview fixed on the right (below the controls on a phone).

1. **Profile** — picture (upload, replace, remove), display name, bio.
2. **Links** — a list, drag to reorder (`@dnd-kit/sortable`, keyboard included), S / W / T / B per
   tile with "automatic" until touched, tap a link to edit its label and URL inline, remove with a
   confirmation, **+ Add a link**.
3. **Appearance** — Soft / High contrast, accent (eight presets + Custom…), heading font (six).

**Saving is automatic.** Each change saves on its own and shows a brief "Saved" beside it; a failed
save shows a retry beside that control and keeps what the owner typed. No Save button. The preview
updates on every keystroke, from local state, before the save returns.

**Publishing is unchanged.** My Curios edits the page directly; a published page shows changes at
once.

---

## The API

All routes sit behind the session and check that the page belongs to the caller.

| Route | Does |
|---|---|
| `GET /links` | the caller's links, in order |
| `POST /links` | add one (appended last) |
| `PATCH /links/:id` | label, url, size |
| `DELETE /links/:id` | remove one; positions close up |
| `PUT /links/order` | the full list of ids in the new order, applied in one transaction; refused unless it is exactly the page's current set |
| `PATCH /pages/appearance` | style, accentColor, headingFont, displayName, bio |
| `POST /pages/avatar` | multipart upload; replaces and deletes any previous object |
| `DELETE /pages/avatar` | removes the picture and its object |

*Revised 2026-09-26: `POST /pages/avatar` takes the picture as base64 inside the same
JSON body every other route uses, not multipart — `apiFetch`'s CSRF stand-in only
covers JSON requests, and a second request shape would have needed its own. The
browser resizes to 512×512 WebP and checks the 1 MB limit before sending; the API
re-checks the byte length and matches the declared type against the file's magic
bytes (`decodeAvatar` in `apps/api/src/modules/pages/avatar.ts`), so a renamed or
mislabelled file is refused with `400 INVALID_IMAGE` regardless of what the browser
already did.*

**Storage** uses `@aws-sdk/client-s3`, which speaks to both R2 and S3. Settings: `STORAGE_ENDPOINT`,
`STORAGE_BUCKET`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`, `STORAGE_PUBLIC_URL`.
Following the billing precedent (`billingDisabled`): outside production with **none** of them set,
upload is switched off — the avatar routes answer `STORAGE_NOT_CONFIGURED` and the editor hides the
upload control. Production, or a partial set, refuses to start and names the missing setting.

Object keys are `avatars/<pageId>/<random>.webp|png|jpg`: random so a replaced picture is never
served from a stale cache.

---

## Failure modes, in one place

| What fails | What the owner or visitor sees |
|---|---|
| A save | a retry beside the control; their input kept |
| A reorder | the list snaps back to the saved order, with a message |
| An upload | the previous picture stays |
| Storage unreachable on the public page | no picture; the name stands alone |
| A link removed by mistake | nothing to undo — hence the confirmation |
| A custom colour with poor contrast | impossible: text colour is computed |
| A URL with a dangerous scheme | refused on save, in the editor and the API |

---

## Testing

- **API:** every route — rules, limits, ownership (another owner's link is a 404), the reorder
  being all-or-nothing and refusing a partial or foreign set, storage switched off in development
  and required in production.
- **Pure functions:** `arrangeTiles` (automatic sizes, overrides, the final-tile rule),
  `readableOn`, URL normalisation and scheme refusal, icon detection.
- **Components:** the editor (add, edit, remove with confirmation, reorder by keyboard, size
  buttons, autosave states), the public grid in both styles, the picture's absent and failed
  states, the sidebar's active module and its phone fold.
- **The existing budget and accessibility tests** keep running.
- **In the running dev server**, before any step is called done: every new or changed page loads
  without a build error. Vitest does not enforce the server/client component boundary; slice 12's
  show-password toggle broke `/reset` exactly that way while every gate was green.
- No golden run: the chat is untouched.

---

## Build order

Each step ships on its own.

1. **The shell** — sidebar, top bar, phone fold; existing screens inside it; My Curios empty.
2. **Links** — schema, API, the editor's list without sizes.
3. **The public bento** — `arrangeTiles` with automatic sizes, the grid in Soft, the fact list removed.
4. **Tile sizes** — the S / W / T / B control and its overrides.
5. **Appearance** — style, accent (presets and custom, `readableOn`), heading font, name and bio.
6. **Picture** — storage settings, upload and removal, the public image and its fallbacks.

---

## Done means

An owner opens `/app`, lands in My Curios, adds five links, drags them into order, makes one Big,
switches to High contrast, picks a custom brand colour and Fraunces, uploads a photo, and sees each
change in the preview as they make it and on `/handle` when they open it — on a phone as well as a
laptop. The public page shows no fact list, works as a link page with JavaScript off, and the three
workspace gates pass.

---

## Documents corrected by this slice

- **FRONTEND.md** — the public page section: bento and no fact list; "readable answers" move to the
  FAQ pages; `/app/links` and `/app/appearance` become My Curios.
- **DESIGN.md** — `LinkRow` "boring on purpose" is replaced by the bento tiles; the two styles, the
  accent rule and the heading fonts are recorded; the dashboard font becomes Plus Jakarta Sans.
- **`.env.example`** — the five storage settings, with the development switch explained.
- **README.md** — a settled-decisions row for the page's look being owner-arranged.
