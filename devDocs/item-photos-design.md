# Item photos: several per item, cropped by the owner: design

Written 31 Oct 2026 from a conversation with the owner. Today a shop item has one photo, and the
owner has no say in how it is framed: the browser cuts the centre square out of whatever they pick
and shrinks it to 512px. This gives an item up to eight photos, each framed by the owner in a crop
window, shown to customers as a carousel on the item page.

Where this says *(builder's call)*, the owner did not decide it; it is the designer's recommendation
and can be changed without asking them again.

---

## Why

An owner selling clothes, cakes or gadgets wants to show more than one angle: the front and back of
a shirt, a cake whole and sliced. And the photo they upload is rarely framed the way the shop shows
it: the automatic centre crop cuts off heads and edges, and they cannot fix it. Customers, for their
part, expect to swipe through an item's photos and look closely at one, as on Shopee.

## What the owner gets

- **Up to 8 photos per item** *(builder's call on the number)*. All square.
- **The first photo is the cover**: the one on the shop card, in the basket, at checkout, in order
  emails and anywhere else an item's picture shows today. Reordering the photos changes the cover.
- **A crop window for every photo**, the cover included. It opens when a photo is added, and again
  whenever the owner taps a photo already uploaded. The owner drags the picture and zooms (slider,
  and pinch on a phone) under a fixed square frame, then saves. Remove photo is in the same window.
- **Replace picture**, also in the crop window: the owner picks a new file, frames it, and saves.
  The photo keeps its place (a replaced cover stays the cover); its old original and square are
  deleted. The owner asked for this.
- **Re-cropping any time.** The original picture is kept, so the owner can reframe a photo later
  without picking it again; only the new frame is sent.

### Where the photos sit in the editor (owner chose layout A)

In the item editor, the cover stays where the single photo is today, at the same size, with a
"Cover" badge and a "Crop" hint. Under it is a row of small squares, one per other photo, then a
"+" square to add one while there is room, and "N of 8". Dragging the small squares, or dragging one
onto the cover, reorders them *(builder's call on the exact reorder gesture; keyboard reorder must
also work)*. The editor's shop preview shows the photos as the customer will.

A photo can only be added once the item exists (has a name and price), as today.

## What the customer gets (owner chose layout B)

- On the item page the photo area is **square** (today it is 4:3; with square photos a 4:3 frame
  would crop them a second time). Swiping moves between photos; a "1 / 4" count sits in a corner.
- **Small photos under it**, one per photo; the current one is outlined, and tapping one jumps to it.
  With one photo there are no small photos and no count.
- **Tapping the photo opens it full screen**: black background, swipe between photos, pinch to zoom,
  close with × or by swiping down. Full screen shows the same square the owner framed, larger; it
  never shows the uncropped original (the owner may have cropped something out on purpose).
- Everywhere else (shop card, shop list, basket, checkout, order page, emails, the profile's shop
  pill) shows the cover only, exactly as today.

## How it works (designer's calls)

- **Originals are kept**, shrunk in the browser to at most 2400px on the longest side before upload
  so storage stays modest, and stored in the private store digital files already use
  (`apps/api/src/modules/store/private-files.ts`): customers are only ever sent the cropped square,
  and the editor gets the original through the owner's authenticated API.
- **A crop is a frame on the original**, stored with the photo: where the square's corner sits and
  how big it is, as fractions of the original's width and height, so it survives any resizing.
- **The server makes the square** from the original and the frame, with sharp (already used in the
  API by `lib/cover-tint.ts`): rotated by its EXIF orientation first, cut, scaled to 1080x1080, saved
  as WebP. 1080 rather than today's 512: a 512 square is stretched on a phone's item page and looks
  soft. Each new crop gets a **new storage key**, and the old square is deleted, so a cached old
  square is never shown under the new frame.
- **Uploading** an original is likely over the JSON body limits the current photo route uses, so it
  goes as a raw body like digital files do (`apps/web/lib/send-file.ts`, which also gives progress).
  Re-cropping sends only the frame, as JSON.
- **A small cover for everywhere but the item page.** Besides its 1080 square, the first photo also
  has a 512x512 copy of that square, made in the same step. Cards, the shop list, the basket,
  checkout, orders, emails and the profile's shop pill load this small cover, as they load a 512
  photo today; only the item page and full screen load the 1080 squares. Otherwise a shop page of
  20 items would carry about 3-4 MB of photos instead of about 1 MB, slow on mobile data. The owner
  asked for this.
- **The small cover lives on `Item.photoKey`.** `photoKey` is read in eleven places outside the web
  app (orders, chat, admin, db-read queries); rather than change them all, it keeps holding the
  cover, now the 512 copy of the first photo's square. It is remade, under a new key, whenever the
  first photo changes (reorder, re-crop, replace, remove, add to an empty item), and the old one is
  deleted. The photo list itself is a new table, one row per photo: item, position, original key,
  square key, frame.
- **Existing items** have only their 512px square and no original. A one-off script run at deploy
  (like `scripts/backfill-*.ts`) copies each item's photo twice: to a new private original, and to a
  new square key. The item gets one photo row with those two, and a full frame; `photoKey` keeps the
  file it has, which is already a 512 cover. So every file has one owner (no key is both an original
  and a square, or a square and the cover), and nothing special-cases migrated photos. The owner can
  re-crop within the old 512px picture, or reframe fully with Replace picture. Nothing for owners to
  redo. Until the script has run, an item with a `photoKey` and no photo rows must still show its
  photo everywhere, the item page included. *(Script, not a SQL-only migration: designer's call,
  since an SQL migration cannot copy files.)*
- **Removing an item, or a photo, deletes its files** from storage (original, square, and the small
  cover when it was the first), as removing an item's photo does today.

## Rules (constraints)

- No more than 8 photos per item, checked by the API, not only the editor.
- A frame must be square on the original (in pixels) and lie inside it, and not be smaller than
  some minimum so a square is never a blown-up handful of pixels *(builder's call on the minimum)*.
- Accepted originals: the same JPEG, PNG and WebP the API accepts today, checked by magic bytes as
  today. Safari's PNG-for-WebP behaviour (see `apps/web/app/app/curios/resize-image.ts`) applies here
  too.
- Only the item's owner can add, crop, reorder or remove its photos.
- `Item.photoKey` is always the 512 copy of the first photo's current square, or null with no
  photos.
- A crop window cancelled before its first Save leaves nothing behind: no photo row, and no
  uploaded original left in storage *(builder's call whether the original uploads before or at Save)*.

## Non-goals

- Photos of different shapes. Every photo is square; the owner chose this.
- Filters, rotation by hand, or drawing on photos. The crop window frames, nothing more.
- Video.
- Photos per option (a different photo for the 1kg and 2kg).
- Photos for anything other than shop items (avatars and covers keep their own flows).

## Anti-goals

It would be a failure, even working, if:

- a customer can reach an owner's uncropped original;
- the cover shown on the shop card differs from the first photo in the editor;
- re-cropping shows customers the old framing afterwards (a cached square under a reused key);
- an existing item loses its photo, or its owner has to re-upload it, because of the migration;
- removing a photo or an item leaves its files in storage.

## What already exists to build on

- Item photo today: `POST/DELETE /store/items/:id/photo` and `setItemPhoto`
  (`apps/api/src/modules/store/store.routes.ts`, `item.service.ts`); the editor's photo button and
  `upload`/`removePicture` (`apps/web/app/app/store/item-editor.tsx`); `uploadPhoto`/`removePhoto` in
  `ItemsApi` (`store-types.ts`, `store-screen.tsx`).
- Browser-side resize and encode: `resizeImage`/`prepare` in `apps/web/app/app/curios/resize-image.ts`.
- Raw-body upload with progress: `sendFile` (`apps/web/lib/send-file.ts`) and the digital files route.
- Image processing: sharp in `apps/api/src/lib/cover-tint.ts`. Storage: the `store.put/remove` the
  photo route uses.
- Item page: `apps/web/app/[handle]/shop/[slug]/product-view.tsx` and `product.module.css` (`.hero`).
- Owner item data: `getOwnerStore` and `OwnerItem` (`packages/db-read/src/shop.query.ts`); public
  item data: `getPublicShop`/`PublicItem` in the same file.

## Left to the builder

Table and field names; the crop window's drawing (canvas, or a positioned image under a frame) and
whether to use a small library for drag and pinch or write it; the full-screen viewer's build; copy
(in English and Malay, as every shop string is); how reorder looks while dragging; the order of
tasks.
