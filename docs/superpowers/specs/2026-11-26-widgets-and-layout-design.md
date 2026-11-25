# Widgets and Layout for My Curios

Owner, 26 Nov 2026. Approved in conversation: paste-a-link widgets (no account sign-in), a new Layout
tab where everything on the page is dragged into order and sized, and a List or Bento choice.

## Why

Owners want their page to carry more than links: their music, a map to the shop, a booking calendar,
a menu. And they want to decide the order and the look of everything on it themselves ("of course
they can choose which one they want first or last, make it flexible").

## Goals

1. **Widgets.** An owner pastes a share link from a supported service and it becomes that service's
   own player or viewer on the public page.
2. **Layout tab.** One list of everything the page shows, dragged into any order, each piece sized.
3. **List or Bento.** The page draws its pieces as today's full-width list, or as a bento grid.

Built and shipped in that order, each usable on its own.

## Non-goals

- Signing in to anyone's Spotify, Apple, Google or Calendly account. Nothing here holds a token.
- Personal data from those services (now playing, top tracks, availability read by us).
- TikTok, Instagram, X or Threads posts: they need the service's script in our page, which loosens the
  security policy, slows the page and tracks visitors. Left for later, on purpose.
- Widgets inside the chat, the shop, the FAQ pages or emails.

## Anti-goals (a failure even if it works)

- **An embed of anything we did not choose.** The page must never frame an address an owner typed.
  The frame's address is built by us from a recognised service and an id we parsed.
- **A slower page for everyone.** A widget loads only when it is near the screen, and a page with none
  loads nothing extra.
- **A security policy opened wide.** Only the exact player addresses below are allowed to be framed.
- **Losing today's look.** A page that never opens Layout looks exactly as it does now: List, in
  today's order, the shop first while it is open.

## Part 1: Widgets

### Services (the owner's choice)

| Service | Links accepted (examples) | Player drawn from |
|---|---|---|
| Spotify | `open.spotify.com/{track,album,playlist,artist,episode,show}/{id}` (also `spotify.link/...` short links) | `https://open.spotify.com/embed/{type}/{id}` |
| Apple Music | `music.apple.com/{cc}/{album,playlist,song,artist}/...` | `https://embed.music.apple.com/{cc}/...` (same path) |
| YouTube Music | `music.youtube.com/watch?v=`, `music.youtube.com/playlist?list=`; also plain `youtube.com/watch`, `youtu.be/`, `youtube.com/shorts/` | `https://www.youtube-nocookie.com/embed/{id}` or `.../embed/videoseries?list={id}` (YouTube Music has no player of its own) |
| SoundCloud | `soundcloud.com/{user}/{track or sets/...}` (also `on.soundcloud.com/...`) | `https://w.soundcloud.com/player/?url={canonical}` |
| Google Maps | `google.com/maps/place/...`, `maps.google.com/...`, `maps.app.goo.gl/...` | `https://www.google.com/maps?q={place}&output=embed` (no API key) |
| Cal.com | `cal.com/{user}[/{event}]` | `https://cal.com/{user}/{event}?embed=true` |
| Calendly | `calendly.com/{user}[/{event}]` | `https://calendly.com/{user}/{event}?embed_type=Inline&hide_gdpr_banner=1` |
| Canva | `canva.com/design/{id}/{key}/view` (a design shared as "view only") | `https://www.canva.com/design/{id}/{key}/view?embed` |

The builder confirms each embed address against the service's own current docs and keeps a test per
service with real-shaped links. A link we cannot turn into a player is refused with a sentence that
names what to paste ("Paste a Spotify link to a song, album, playlist or podcast").

**Short links** (`spotify.link`, `maps.app.goo.gl`, `on.soundcloud.com`): the API follows the redirect
once, through the existing host guard (`apps/api/src/modules/ingest/host-guard.ts`), at save time only,
and parses where it lands. Never at render time.

### Data

A widget is a row in the page's existing ordered list, so Part 2 orders it with everything else.
`Link` gains:

- `kind`: `LINK` (default, every existing row) or `WIDGET`.
- `provider`: `SPOTIFY | APPLE_MUSIC | YOUTUBE | SOUNDCLOUD | GOOGLE_MAPS | CALCOM | CALENDLY | CANVA`,
  null for a link.
- `embedRef`: what the player address is built from (the parsed type and id, or the place), never a
  full URL. Null for a link.
- `url` keeps what the owner pasted, for the editor and for "Open in Spotify" fallbacks.
- `label`: optional for a widget ("My Raya playlist"), shown above it on the page.

Widgets count toward the existing 30 (`MAX_LINKS`). Migration adds the columns with today's values as
defaults; no existing row changes.

### Rendering

- One `Widget` component in `_bento` builds the frame address from `provider` + `embedRef` with one
  function per service in `@curios/core` (shared by the API's validation and the page).
- `<iframe loading="lazy">`, a `title` naming the service and the label, `referrerpolicy` set, a
  `sandbox` granting only what each player needs (scripts, same-origin for the player's own origin,
  popups for "open in app"), and `allow` limited to `encrypted-media; autoplay` where the service
  needs it. No autoplay is ever requested.
- Fixed heights per service and type (Spotify track 152, playlist 352; YouTube 16:9; Maps 300;
  Cal.com/Calendly 640; Canva 4:3; SoundCloud 166 track, 450 set). Part 3's sizes can change them.
- The page's CSP (`apps/web/lib/security-headers.ts`) gains `frame-src` with exactly:
  `https://open.spotify.com https://embed.music.apple.com https://www.youtube-nocookie.com
  https://w.soundcloud.com https://www.google.com https://cal.com https://calendly.com
  https://www.canva.com`. The dashboard's preview needs the same.
- The rounded corner and frame follow the page's button style, so a widget sits with the links.
- Ask mode hides widgets as it hides links today.
- The chat's knowledge of the page's links includes a widget as its label and pasted `url` (so "where
  are you?" can point to the map), never the frame address.
- If a frame fails, the row shows the label and "Open in {service}" linking to the pasted `url`.

### Editor (Links tab)

- "Add a link" gains "Add a widget": paste a link; the service is recognised as it is pasted and shown
  with its icon; an optional label. Saved rows show the service icon, the label and a small preview.
- The phone preview shows the real players.

## Part 2: The Layout tab

My Curios tabs become **Profile · Links · Layout**. Links is where things are added and edited;
Layout is where they are arranged. The up/down arrows leave the Links tab.

Layout holds one list of every piece the page shows, in page order:
- each link and widget (`Link.position`),
- the shop button, while the shop is open (`Page.shopTilePosition`, already interleaved by
  `withShopTile` in `@curios/core/bento`),
- "People often ask", on a business page with answered questions: new `Page.faqPosition`, default
  after the last item (today's place).

The profile head and the ask bar are not in the list: they stay at the top and the foot.

Ordering is by drag (pointer and touch, with a visible handle) and also by keyboard (focus a row,
Space to lift, arrows to move, Space to drop), announced to screen readers. One save per drop, through
the existing reorder endpoint extended to carry the shop and FAQ places. No new dependency unless the
builder finds hand-rolled drag cannot meet the keyboard and touch requirements; if so, dnd-kit.

Help guide entries `page-links` and `page-shop-tile` (`packages/core/src/help/faq.md`) change in the
same commit: links are ordered in Layout, and the shop button can be moved there.

## Part 3: List or Bento

Layout gains a choice at its top: **List** (today) or **Bento**.

- **List**: full-width pills, as now. Widgets take the column's width.
- **Bento**: a two-column grid. Each piece takes a size: **Small** (one cell), **Wide** (two cells
  across), **Tall** (two cells down), **Big** (two by two). The existing `TileSize` values and
  `arrangeTiles` in `@curios/core/bento` are the starting point; `Link.size` and `Page.shopTileSize`
  already store them. "People often ask" is always Wide.
- Sizes are chosen per piece in Layout, shown only in Bento. Widgets have a smallest size that still
  works (a Spotify playlist is at least Wide; a map at least Wide) and Layout does not offer smaller.
- New `Page.layout`: `LIST` (default) or `BENTO`.
- All four button styles (Soft, High contrast, Chunky, Outline) and both colours draw the tiles.
- On a phone the grid stays two columns; Small tiles hold an icon and a short label.

## Constraints

- Every corner follows the squircle build step and the 10px/16px corner tokens already in place.
- The public page renders on the server; widgets are plain iframes with no client code of ours beyond
  the fallback.
- Personal and business pages both get widgets and Layout (no plan gate).

## Approaches considered

1. **Paste a link, we build the player (picked).** No accounts, no tokens, works for any public link.
   We control every framed address.
2. **Sign in to each service** (OAuth) for personal data. Needs developer apps and approvals per
   service (Spotify caps unapproved apps at a small test group; Apple needs a paid account) and tokens
   to keep safe. Rejected for now: the owner wanted the simple version.
3. **Let owners paste any embed code.** Most flexible, but it puts arbitrary third-party HTML on every
   page and needs the security policy opened to everything. Rejected: the anti-goal above.

Order: widgets as rows in the existing ordered list (owner: "of course they can choose which one they
want first or last"), not a separate section under the links.

## Calls made here (the owner can overrule)

- Widgets count toward the 30-item limit rather than having their own.
- No plan gate: personal pages get widgets and Layout too.
- YouTube links in general are accepted under "YouTube Music", since they play in the same player.
- Short share links are resolved once at save, through the host guard.
- The FAQ block's place becomes movable (it was fixed under the links).

## Risks

- **Google Maps without a key** uses `?q=...&output=embed`, which works but is not Google's documented
  embed. If Google blocks it, the fallback is the Maps Embed API (free, needs a key in the web app's
  environment, restricted to curios.my). The builder keeps the address in one function so the switch
  is one change.
- **Canva** frames only designs the owner shared with a public view link; the refusal sentence says so.
- **Calendly and Cal.com** show the owner's real availability, read by their own player in the
  visitor's browser; nothing reaches us.

## Left to the builder

- The exact sandbox and `allow` flags per service, checked against each player working.
- Heights per service and type, checked visually in both List and Bento.
- Hand-rolled drag versus dnd-kit, by the keyboard and touch requirements above.
- The Bento arrangement rules for odd sizes at the end of a row.
