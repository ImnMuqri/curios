# Widgets section, Pictures and GIF widgets

Owner, 27 Nov 2026: "Build it all" from the design board `design/boards/Dash.dc.html` on
`design/brand-sky-pink-2026-11-24` (commits 330c7645, 2a16d0cf). Read that board's Links screen (search the file for
`widgets: a section of its own`, `wpick`, `wup`, `pgal`) for the exact look.

## Goals
1. **My Curios → Links tab gets two boxes:** *Links* (links and the shop link, as today) and, under it, *Widgets*
   ("Pictures and GIFs that show on your page as they are. Set their order in Layout." — adjust to cover songs/videos
   too, see rulings) listing every widget row with a real thumbnail and a type line ("Gallery · 3 pictures · Carousel",
   "GIF · Full width", "Spotify · Song"). "+ Add link" stays under Links; "+ Add a widget" moves under Widgets.
2. **"+ Add a widget" opens a picker:** Video, Song, Pictures, GIF (4 tiles, 2 on phones). Video and Song open
   today's paste-a-link widget form (Video: YouTube; Song: Spotify, Apple Music, YouTube Music, SoundCloud). Pictures
   and GIF open the new Pictures panel.
3. **Pictures widget:** 1–6 pictures (JPG, PNG, WEBP; up to 10 MB each as uploaded), reorder (drag + keyboard),
   remove, a caption (shown on the page, = the row's label), "Describe them for screen readers" (alt text),
   and **Show as**: *Carousel* (swipe one by one, the next picture peeks in, dots) or *Grid* (one large, two small;
   with more than 3 the third shows "+N"; tap opens full screen). With a single picture the choice is *Full width*
   (its own aspect) or *Square*.
4. **GIF widget:** one GIF up to 10 MB, kept animated (stored as uploaded), *Full width* or *Square*, caption and
   description as above. Visitors with reduced-motion preference get it too (owner-chosen content), no autoplay
   control needed in this version.
5. **Everywhere widgets already work, these do too:** ordered in Layout, sized in Bento (Pictures/GIF smallest size
   WIDE; Square GIF may be SMALL), hidden in Ask mode, counted toward the 30-item limit, shown in the phone preview.
   The chat knows a gallery by its caption ("a picture gallery: Fresh out of the oven") and never sees file URLs.

## Data
- `Link.kind` stays `WIDGET`; `WidgetProvider` gains `PICTURES` and `GIF` (Postgres enum ADD VALUE, own migration).
  `embedRef` is null for them; `widgetSrc`/frame code must never be reached for them.
- `Link` gains `pictureMode` (nullable enum `CAROUSEL | GRID | FULL | SQUARE`) and `altText` (nullable, ≤ 300).
  Caption = `label` (≤ existing label max).
- New `LinkPicture { id, linkId → Link (Cascade), key, contentType, width, height, bytes, position }`, index
  `[linkId, position]`.
- Storage: JPG/PNG/WEBP are decoded, auto-rotated, stripped of metadata and stored as WEBP no larger than 1600px on the
  long edge; GIF stored as uploaded after checking it is a GIF (magic bytes) ≤ 10 MB. Keys `links/{pageId}/{uuid}.{ext}`
  in the public store (as item photos). Deleting a picture, a widget or a page removes its objects (follow how item
  photos are cleaned up, including any page-deletion sweep).

## API
Follow item photos (`apps/api/src/modules/store/item-photo.service.ts` + routes): create the widget row first
(POST with provider PICTURES|GIF, mode, caption, alt), then add pictures (multipart, one per request), remove,
reorder, and PATCH mode/caption/alt. Limits: 6 pictures (1 for GIF); 10 MB; rate limits like item photos. A Pictures
widget with 0 pictures is not shown on the public page. Owner-only, same auth/CSRF as link routes.

## Public page
`apps/web/app/_bento/Widget.tsx` branches for PICTURES/GIF (no iframe): carousel = CSS scroll-snap track, slides
~82% wide so the next peeks, dots that follow the scroll, previous/next buttons for keyboard/mouse; grid = 2fr/1fr,
first spans two rows; tap/Enter opens a full-screen viewer (reuse the shop's `photo-viewer.tsx` if it is generic
enough, else a small dialog with the same behaviour: Escape closes, arrows move, focus returns). Corners follow the
page's button radius like other widgets. `alt` on every image from altText (+ " (n of N)"); caption shown as the
widget label is today. Images `loading="lazy"`, explicit width/height to avoid layout shift. Works in List and Bento.

## Rulings (owner can overrule)
- The Widgets box lists ALL widgets (songs, videos, maps, calendars, pictures, GIFs); Links lists links + shop only.
- "Video" = YouTube (TikTok needs its script on the page: a non-goal since the widgets spec).
- GIFs stay animated; photos are resized to WEBP.

## Not in this version
TikTok/Instagram embeds, video uploads, per-picture captions, autoplaying carousels.
