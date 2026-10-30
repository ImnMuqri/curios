# Item photos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An item has up to 8 square photos, each framed by its owner in a crop window and re-croppable any time; customers swipe them on the item page, with small photos under it and full screen on tap.

**Architecture:** A new `ItemPhoto` table holds each photo's private original, its public 1080 square and its frame. The API cuts squares with sharp; `Item.photoKey` stays the cover, now a 512 copy of the first photo's square, so every existing reader of `photoKey` is untouched. The web editor gets a photo strip and a crop window; the item page gets a gallery and a full-screen viewer.

**Tech Stack:** Prisma/Postgres, Fastify + zod, sharp 0.35, R2/S3 (`AvatarStore` public, `PrivateFiles` private), Next 15 / React 19, vitest + Testing Library.

**Spec:** `devDocs/item-photos-design.md`

## Global Constraints

- Every photo is square. Up to **8** photos per item, enforced by the API.
- Square photos: **1080x1080 WebP**. Cover (`Item.photoKey`): **512x512 WebP**, a copy of the first photo's square.
- Originals: shrunk in the browser to at most **2400px** on the longest side; stored only in `PrivateFiles`; never in a public page or a public API response.
- A frame is `{ x, y, size }`: `x` = left / original width, `y` = top / original height, `size` = side / min(width, height), all in (0, 1]. The square must lie inside the original, and its side must be at least **200px** (`MIN_FRAME_PX`).
- Accepted originals: JPEG, PNG, WebP, checked by magic bytes (`SIGNATURES` in `apps/api/src/modules/pages/avatar.ts`). Up to **8 MB** (`ITEM_PHOTO_ORIGINAL_MAX_BYTES`).
- Every new square or cover goes under a **new key**; the old file is deleted after the database has moved on.
- `Item.photoKey` is always the 512 copy of the first photo's square, or null with no photos.
- Customer-facing strings go in `shopCopy` (`apps/web/app/[handle]/shop/copy.ts`) in English and Malay. Owner editor strings are English, like the rest of the editor.
- Formatting follows the repo's Prettier config; run `pnpm lint` before each commit.
- Verify with `pnpm turbo run typecheck lint --concurrency=1 --force` and `pnpm turbo run test --concurrency=1 --force` (see the repo's notes on why both flags).

## Review Focus

1. **A phone photo straight from the camera, 4000x3000 and 6 MB, sometimes EXIF-rotated:** the browser shrinks it to 2400px before upload, and the square is cut from the upright picture, never sideways. Tests: Task 3 (rotated JPEG), Task 8 (`prepareOriginal` caps at 2400).
2. **A picture the browser cannot decode (HEIC on Chrome/Windows, a renamed PDF):** the owner reads one plain sentence, and nothing is uploaded. Test: Task 8.
3. **Two tabs adding the 8th photo at once:** one succeeds, the other gets the limit sentence, and the item never holds 9. Test: Task 4.
4. **Removing or moving the cover:** the next first photo becomes the cover, `photoKey` changes to a new key, and the old cover file is deleted; removing the last photo clears `photoKey`. Test: Task 5.
5. **Someone other than the owner asks for an original** (another owner, or nobody signed in): 404, and no original's key ever appears in `GET /store/items` for another account or in any public read. Tests: Task 4, Task 6.

---

### Task 1: Photo rules in core

**Files:**
- Create: `packages/core/src/item-photos.ts`, `packages/core/src/item-photos.test.ts`
- Modify: `packages/core/package.json` (add `"./item-photos": "./src/item-photos.ts"` to `exports`)

**Interfaces:**
- Produces (imported by Tasks 3, 4, 8, 9 as `@curios/core/item-photos`; the module imports nothing, so client components can load it):
  - `MAX_ITEM_PHOTOS = 8`, `ITEM_PHOTO_EDGE = 1080`, `ITEM_COVER_EDGE = 512`, `ORIGINAL_MAX_EDGE = 2400`, `MIN_FRAME_PX = 200`, `ITEM_PHOTO_ORIGINAL_MAX_BYTES = 8_388_608`
  - `type Frame = { x: number; y: number; size: number }`
  - `framePixels(frame: Frame, width: number, height: number): { left: number; top: number; side: number }`, rounded to whole pixels, clamped so the square lies inside
  - `fullFrame(width: number, height: number): Frame`, the largest centred square
  - `frameProblem(frame: Frame, width: number, height: number): string | null`, the owner-facing sentence, or null
  - `moveFrame(frame: Frame, dxPx: number, dyPx: number, width: number, height: number): Frame` and `zoomFrame(frame: Frame, side: number, width: number, height: number): Frame`. Both return a frame that passes `frameProblem`, zooming about the square's centre and clamping to the picture and to `MIN_FRAME_PX`.
  - `TOO_SMALL_SENTENCE = 'This picture is too small. Pick one at least 200 pixels on each side.'`

- [ ] **Step 1: Write the failing tests** in `item-photos.test.ts`:

```ts
it('fullFrame is the largest centred square', () => {
  expect(fullFrame(800, 600)).toEqual({ x: 0.125, y: 0, size: 1 });
  expect(framePixels(fullFrame(800, 600), 800, 600)).toEqual({ left: 100, top: 0, side: 600 });
  expect(framePixels(fullFrame(600, 800), 600, 800)).toEqual({ left: 0, top: 100, side: 600 });
});
it('frameProblem refuses a square outside the picture, a side under 200px, and non-finite numbers', () => {
  expect(frameProblem({ x: 0.5, y: 0, size: 1 }, 800, 600)).toMatch(/inside the picture/);
  expect(frameProblem({ x: 0, y: 0, size: 0.3 }, 800, 600)).toMatch(/200 pixels/); // 180px
  expect(frameProblem({ x: Number.NaN, y: 0, size: 1 }, 800, 600)).not.toBeNull();
  expect(frameProblem(fullFrame(150, 150), 150, 150)).toBe(TOO_SMALL_SENTENCE);
  expect(frameProblem({ x: 0.25, y: 0, size: 0.5 }, 800, 600)).toBeNull();
});
it('moveFrame stops at the edges; zoomFrame keeps the centre and the 200px floor', () => {
  const f = { x: 0.25, y: 0.25, size: 0.5 }; // 300px square at 200,150 on 800x600
  expect(framePixels(moveFrame(f, 10_000, -10_000, 800, 600), 800, 600)).toEqual({ left: 500, top: 0, side: 300 });
  expect(framePixels(zoomFrame(f, 100, 800, 600), 800, 600)).toEqual({ left: 250, top: 200, side: 200 });
  expect(framePixels(zoomFrame(f, 5_000, 800, 600), 800, 600).side).toBe(600);
});
```

- [ ] **Step 2: Run them, expect FAIL** (module missing): `pnpm --filter @curios/core exec vitest run src/item-photos.test.ts`
- [ ] **Step 3: Implement** the module and its export entry.
- [ ] **Step 4: Run them, expect PASS.**
- [ ] **Step 5: Commit:** `feat(core): item photo rules -- a square frame on the original, its limits, and how dragging and zooming move it`

### Task 2: The table, and reading a private file back

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (new model, back-relation `photos ItemPhoto[]` on `Item`)
- Create: `packages/db/prisma/migrations/20261031090000_item_photos/migration.sql`
- Modify: `apps/api/src/modules/store/private-files.ts`, plus every test double typed `PrivateFiles` (grep `PrivateFiles =` and `: PrivateFiles` in `apps/api/src`)
- Test: `apps/api/src/modules/store/private-files.test.ts` (create it if it does not exist)

**Interfaces:**
- Produces: model `ItemPhoto { id String @id @default(cuid()); itemId String; item Item @relation(onDelete: Cascade); position Int; originalKey String; squareKey String; width Int; height Int; frameX Float; frameY Float; frameSize Float; createdAt DateTime @default(now()); @@index([itemId, position]) }`. `width`/`height` are the original's after EXIF rotation. Document each field in `///` comments like the neighbouring models.
- Produces: `PrivateFiles.read: (key: string) => Promise<Buffer>` on the disk store (readFile through `locate`) and the S3 store (`GetObjectCommand`, then `Body.transformToByteArray()`).

- [ ] **Step 1: Write the failing test:** `createDiskPrivateFiles(tmp)` put, then `read` returns the same bytes; `read('../x')` rejects with `Invalid file key`.
- [ ] **Step 2: Run it, expect FAIL.**
- [ ] **Step 3: Add the model and migration, run `prisma generate` from `packages/db`, and implement `read`** on both stores. Add `read: vi.fn()` (or the equivalent) to each test double so typecheck passes.
- [ ] **Step 4: Apply the migration** to the dev and test databases (`migrate deploy` with each URL; never use the test database as a shadow), then run the test: expect PASS. `pnpm --filter @curios/api exec tsc --noEmit` passes.
- [ ] **Step 5: Commit:** `feat(db): item photos -- each with its private original, its square and its frame`

### Task 3: Cutting squares

**Files:**
- Create: `apps/api/src/lib/item-photo-image.ts`, `apps/api/src/lib/item-photo-image.test.ts`

**Interfaces:**
- Consumes: Task 1 (`Frame`, `framePixels`, `frameProblem`, edges and limits).
- Produces:
  - `readPicture(body: Buffer, contentType: string): Promise<{ width: number; height: number; ext: 'jpg' | 'png' | 'webp' }>`. It checks magic bytes against `contentType`, the 8 MB limit, and that sharp can read the picture; it returns the dimensions after `.rotate()`. Otherwise it throws `InvalidItemPhotoError` (new, in `store.errors.ts`: statusCode 400, code `INVALID_PHOTO`, message `'Use a JPEG, PNG or WebP picture, up to 8 MB.'`).
  - `cutSquare(original: Buffer, frame: Frame, edge: number): Promise<Buffer>`, i.e. `sharp(original).rotate().extract(framePixels(...)).resize(edge, edge).webp({ quality: 82 })`.

- [ ] **Step 1: Write the failing tests,** with pictures made by `sharp({ create: { width, height, channels: 3, background } })`:
  - `readPicture` of an 800x600 PNG returns `{ width: 800, height: 600, ext: 'png' }`.
  - A JPEG of 600x800 pixels stored as 800x600 with EXIF orientation 6 (`.withMetadata({ orientation: 6 })`) reads as `{ width: 600, height: 800 }`.
  - PNG bytes declared `image/jpeg`, random bytes, and a 9 MB body each reject with `InvalidItemPhotoError`.
  - `cutSquare(png, fullFrame(800, 600), 1080)` is a WebP whose metadata says 1080x1080.
  - Cutting the left half of a picture whose left half is red and right half blue gives a red square: check the mean of channel 0 from `sharp(out).stats()` is above 200.
- [ ] **Step 2: Run them, expect FAIL.**
- [ ] **Step 3: Implement.** Reuse `SIGNATURES` from `pages/avatar.ts`: export it if needed, and do not copy it.
- [ ] **Step 4: Run them, expect PASS.**
- [ ] **Step 5: Commit:** `feat(api): cut an item photo's square from its original, upright, at any size`

### Task 4: Adding, re-cropping, replacing, and the owner's originals

**Files:**
- Create: `apps/api/src/modules/store/item-photo.service.ts`, `apps/api/src/modules/store/item-photo.routes.test.ts`
- Modify: `apps/api/src/modules/store/store.routes.ts` (new routes; the raw-body ones in the existing `uploadRoutes` scope). Delete `POST/DELETE /store/items/:id/photo`, `setItemPhoto` and `clearItemPhoto`, and their tests in `item.routes.test.ts`; the web stops calling them in Task 8.
- Modify: `apps/api/src/modules/store/item.service.ts` (`ItemRow.photos`, `SELECT`)

**Interfaces:**
- Consumes: Tasks 1-3; `AvatarStore` (public), `PrivateFiles` (private), `storePageFor`.
- Produces:
  - `type OwnerPhoto = { id: string; squareKey: string; width: number; height: number; frame: Frame }`. `ItemRow` gains `photos: OwnerPhoto[]` in position order. The original's key is never in it.
  - `type PhotosResult = { photos: OwnerPhoto[]; photoKey: string | null }`, the body of every photo mutation.
  - `type PhotoDeps = { prisma: PrismaClient; store: AvatarStore; privateFiles: PrivateFiles; log: { warn: (o: object, msg: string) => void } }`
  - `addItemPhoto(deps, accountId, itemId, picture: { body: Buffer; contentType: string }, frame: Frame): Promise<PhotosResult>`
  - `recropItemPhoto(deps, accountId, itemId, photoId, frame): Promise<PhotosResult>`
  - `replaceItemPhoto(deps, accountId, itemId, photoId, picture, frame): Promise<PhotosResult>`
  - Routes:
    - `POST /store/items/:id/photos`: raw body, `content-type` image type, header `x-photo-frame: <x>,<y>,<size>`. Returns 201 `PhotosResult`.
    - `PUT /store/items/:id/photos/:photoId/frame`: JSON `{ x, y, size }`. Returns `PhotosResult`.
    - `POST /store/items/:id/photos/:photoId/picture`: raw body plus `x-photo-frame`. Returns `PhotosResult`.
    - `GET /store/items/:id/photos/:photoId/original`: the owner only, through `privateFiles.deliver` like `downloadRoutes`. Send `Cache-Control: private, no-store`.
  - Keys: originals `item-photos/<pageId>/<itemId>/<uuid>.<ext>` (private); squares `items/<pageId>/<uuid>.webp`; covers `items/<pageId>/cover-<uuid>.webp`.
  - New errors in `store.errors.ts`: `PhotoLimitError` (409, `PHOTO_LIMIT`, `'An item holds up to 8 photos.'`), `PhotoNotFoundError` (404, `PHOTO_NOT_FOUND`), and `InvalidFrameError` (400, `INVALID_FRAME`, message from `frameProblem`).

**Approach:** Check the picture and frame first; then put the files (original, square, plus a new cover when the photo will be first); then commit one transaction. That transaction takes `SELECT ... FROM "Item" WHERE id = $1 AND "pageId" = $2 FOR UPDATE`, counts against `MAX_ITEM_PHOTOS`, writes the row and sets `photoKey`. After the commit, delete what it replaced. If the transaction throws, delete the new files. Re-crop reads the original with `privateFiles.read`. An item that has a `photoKey` and no photo rows (before the Task 6 script) keeps its old file as the cover until a first photo is added; then that old file is deleted like any replaced cover.

- [ ] **Step 1: Write the failing route tests** (stub `AvatarStore` as in `item.routes.test.ts`; `createDiskPrivateFiles(tmp)` as in `digital-item.routes.test.ts`; pictures from sharp):
  - Adding an 800x600 PNG with frame `0.125,0,1` gives 201. `photos` is one `{ width: 800, height: 600, frame: { x: 0.125, y: 0, size: 1 } }`. `photoKey` matches `^items/.+/cover-.+\.webp$`. `store.put` was called with the square and the cover. The response JSON contains no `item-photos/`.
  - A second photo goes last and leaves `photoKey` unchanged.
  - The 9th is 409 `PHOTO_LIMIT`. Two concurrent adds when there are 7 make exactly one 201 and one 409, and the database holds 8 (Review Focus 3).
  - Frame `0.5,0,1` on 800x600 is 400 `INVALID_FRAME` and puts nothing. A 150x150 picture is 400 with `TOO_SMALL_SENTENCE`.
  - Re-cropping the first photo changes its `squareKey` and `photoKey` to new keys, and `store.remove` gets both old ones. Re-cropping the second leaves `photoKey` alone.
  - Replace keeps the photo's id and position, has new keys, and removes the old original from the private store (its `read` rejects afterwards).
  - `GET .../original` returns the original's bytes for the owner, and 404 for another owner and for no session (Review Focus 5).
  - Another owner's item: add, re-crop and replace are all 404, and nothing is put.
- [ ] **Step 2: Run them, expect FAIL.**
- [ ] **Step 3: Implement** the service and routes, and remove the old photo routes and their tests.
- [ ] **Step 4: Run** `pnpm --filter @curios/api exec vitest run src/modules/store`. Expect PASS.
- [ ] **Step 5: Commit:** `feat(store): an item's photos -- add up to eight, crop and re-crop each from its kept original, replace one in place`

### Task 5: Removing and reordering photos, and cleaning up with the item

**Files:**
- Modify: `apps/api/src/modules/store/item-photo.service.ts`, `store.routes.ts`, `item.service.ts` (`removeItem`), `apps/api/src/modules/admin/admin-pages.service.ts` (page deletion)
- Test: `item-photo.routes.test.ts`, `item.routes.test.ts`, `apps/api/src/modules/admin/admin-pages.routes.test.ts` (or wherever page deletion is tested now)

**Interfaces:**
- Produces:
  - `removeItemPhoto(deps, accountId, itemId, photoId): Promise<PhotosResult>` and `reorderItemPhotos(deps, accountId, itemId, ids: string[]): Promise<PhotosResult>`. `ids` must be exactly the item's photo ids, or it fails with `ItemOrderStaleError`, like `reorderItems`.
  - `DELETE /store/items/:id/photos/:photoId` and `PUT /store/items/:id/photos/order` (`{ ids }`).
  - `removeItem` returns `{ photoKey, fileKeys, photoFiles: { originalKey: string; squareKey: string }[] }`; the item delete route removes each from its store.
  - Admin page deletion adds every photo's `squareKey` to the public keys and its `originalKey` to the private ones.
- [ ] **Step 1: Write the failing tests** (Review Focus 4):
  - Removing the first of three closes the gap (positions 0, 1). `photoKey` becomes a new cover cut from the new first photo, and the old cover, square and original are deleted.
  - Removing the only photo sets `photoKey` to null.
  - Reordering `[c, a, b]` gives a new cover from `c`; reordering without changing the first leaves `photoKey` as it was.
  - Reordering with a missing or foreign id is 409 and changes nothing.
  - Deleting an item with two photos removes 2 squares and the cover from the public store, and 2 originals from the private store.
  - Deleting a page through admin removes its items' squares and originals.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the api store and admin tests. Expect PASS.
- [ ] **Step 5: Commit:** `feat(store): remove and reorder an item's photos, the cover following the first; their files go with the item`

### Task 6: Reads for the editor and the item page

**Files:**
- Modify: `packages/db-read/src/shop.query.ts` (`OwnerItem.photos`, `getOwnerStore`), `packages/db-read/src/orders.query.ts` (`getShopItem`)
- Test: `packages/db-read/src/shop.query.test.ts`, and the `getShopItem` tests where they live now

**Interfaces:**
- Produces:
  - `OwnerItem.photos: { id: string; squareKey: string; width: number; height: number; frame: { x: number; y: number; size: number } }[]` in position order (same shape as `OwnerPhoto`).
  - `getShopItem(...)` returns `{ shop, item, photoKeys: string[] }`: the squares in order, or `[item.photoKey]` when the item has a cover and no photo rows, or `[]`.
  - `PublicItem` and `getPublicShop` do not change.
- [ ] **Step 1: Write the failing tests:**
  - An item with two photo rows gives them to `getOwnerStore` in position order, with frames, and `JSON.stringify(store)` does not contain the original keys.
  - `getShopItem` gives the two square keys in order. A seeded item with only a `photoKey` gives `[photoKey]`.
  - `JSON.stringify(await getPublicShop(...))` contains no square or original key of a second photo (Review Focus 5).
- [ ] **Step 2: Run, expect FAIL.**  **Step 3: Implement.**  **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit:** `feat(db-read): an item's photos for its owner's editor, and its squares for the item page`

### Task 7: The deploy script for existing photos

**Files:**
- Create: `scripts/backfill-item-photos.ts`

**Interfaces:**
- Consumes: `createS3Store`, `createS3PrivateFiles`, `readPicture` (Task 3), `fullFrame` (Task 1).
- Produces: a one-off script in the style of `scripts/redraw-payment-qrs.ts`:
  - It is a dry run unless given `--write`.
  - For each item with a `photoKey` and no photo rows, it fetches `${STORAGE_PUBLIC_URL}/${photoKey}`, puts the bytes as a new private original and as a new public square under new keys, and creates one row with `fullFrame`. It leaves `photoKey` as it is.
  - It is safe to re-run, because it only picks items with no rows.
  - Unreadable ones are listed at the end and left alone.
  - The header comment says to run it right after the deploy that ships Task 4.
- [ ] **Step 1:** Run it against the dev database with dev storage (`STORAGE_*` pointing at your local or dev bucket). Expect the dry run to list the items it would copy and write nothing.
- [ ] **Step 2:** Run with `--write`. Expect a row for each listed item with keys that differ from `photoKey`, and a second run to report 0 to do.
- [ ] **Step 3: Commit:** `chore(scripts): one-off -- give each existing item photo its own original and square`

### Task 8: The browser side of uploads, and the editor's API

**Files:**
- Modify: `apps/web/app/app/curios/resize-image.ts` (add `prepareOriginal`), `apps/web/lib/send-file.ts` (allow extra headers), `apps/web/app/app/store/store-types.ts`, `store-screen.tsx`, `store-editor.tsx` (the `track` wrapper)
- Test: `apps/web/app/app/curios/resize-image.test.ts` (create if absent), `store-screen.test.tsx`

**Interfaces:**
- Consumes: the Task 4 and 5 routes and `PhotosResult`.
- Produces:
  - `prepareOriginal(file: File): Promise<{ blob: Blob; width: number; height: number }>`. It scales so the longest side is at most `ORIGINAL_MAX_EDGE` and never upscales. It encodes WebP, falling back to whatever the browser makes (Safari PNG), and stays under `ITEM_PHOTO_ORIGINAL_MAX_BYTES` by stepping the quality down as `prepare` does. If the picture cannot be decoded it throws `Error('This picture could not be opened. Try a JPEG or PNG.')`.
  - `sendFile` gains an optional `headers?: Record<string, string>` parameter that is sent as given.
  - `EditorItem.photos` comes through from `OwnerItem`, as `ItemRow.photos`.
  - `ItemsApi` drops `uploadPhoto` and `removePhoto`, and gains:
    - `addPhoto: (id: string, blob: Blob, frame: Frame) => Promise<PhotosResult>`
    - `recropPhoto: (id: string, photoId: string, frame: Frame) => Promise<PhotosResult>`
    - `replacePhoto: (id: string, photoId: string, blob: Blob, frame: Frame) => Promise<PhotosResult>`
    - `removePhoto: (id: string, photoId: string) => Promise<PhotosResult>`
    - `reorderPhotos: (id: string, ids: string[]) => Promise<PhotosResult>`
    - `photoUrl: (key: string) => string`
    - `originalUrl: (id: string, photoId: string) => string`
  - `PhotosResult` and `Frame` are declared web-side in `store-types.ts`; the web never imports from apps/api.
- [ ] **Step 1: Write the failing tests:**
  - `prepareOriginal` on a mocked 4000x3000 bitmap draws a 2400x1800 canvas (Review Focus 1), and on a 1000x800 one draws 1000x800.
  - When `createImageBitmap` rejects, it throws the sentence above (Review Focus 2).
  - `addPhoto` posts the blob to `/store/items/a/photos` with `x-photo-frame: 0.125,0,1`.
- [ ] **Step 2: Run, expect FAIL.**  **Step 3: Implement.** Fix every test fixture typecheck reports for the new `photos` field.  **Step 4: Run** web tests and `tsc`. Expect PASS.
- [ ] **Step 5: Commit:** `feat(store): the editor's photo calls -- originals shrunk to 2400px in the browser, sent with their frame`

### Task 9: The crop window

**Files:**
- Create: `apps/web/app/app/store/photo-cropper.tsx`, `photo-cropper.test.tsx`; styles in `store.module.css`

**Interfaces:**
- Consumes: `moveFrame`, `zoomFrame`, `framePixels`, `fullFrame` (Task 1).
- Produces: `PhotoCropper(props: { src: string; width: number; height: number; frame: Frame; busy?: boolean; onSave: (frame: Frame) => void; onCancel: () => void; onRemove?: () => void; onReplace?: (file: File) => void })`
  - A modal `role="dialog"` with `aria-label="Adjust photo"`. The picture sits under a fixed square frame: dragging with a pointer moves it, a range input labelled "Zoom" sets the side, two pointers pinch, and the wheel zooms.
  - Arrow keys move it 10px on the original, and `+`/`-` zoom.
  - Buttons: Save, Cancel, then "Replace picture" (a hidden file input) and "Remove photo", shown only when their handlers are given. Escape cancels.
  - Focus is trapped while it is open and goes back to the opener on close.
- [ ] **Step 1: Write the failing tests:**
  - Save with no change returns the given frame.
  - ArrowRight then Save returns a frame whose `framePixels` left is 10 more.
  - Setting Zoom to its minimum and saving gives side `MIN_FRAME_PX`.
  - Escape calls `onCancel`.
  - Remove and Replace are absent without their handlers.
  - Choosing a file under "Replace picture" calls `onReplace` with it.
- [ ] **Step 2: Run, expect FAIL.**  **Step 3: Implement.**  **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit:** `feat(store): the crop window -- drag, zoom and pinch a photo under a square frame`

### Task 10: The photos in the item editor (layout A)

**Files:**
- Create: `apps/web/app/app/store/item-photos.tsx`, `item-photos.test.tsx`
- Modify: `apps/web/app/app/store/item-editor.tsx` (replace the single-photo button, `upload` and `removePicture` with `<ItemPhotos>`), `store.module.css`, `item-editor.test.tsx`

**Interfaces:**
- Consumes: `PhotoCropper` (Task 9), `prepareOriginal` and the `ItemsApi` photo calls (Task 8).
- Produces: `ItemPhotos(props: { item: EditorItem | null; tint: number; uploadsEnabled: boolean; api: ItemsApi; onChange: (result: PhotosResult) => void; onError: (message: string) => void })`
  - Layout A:
    - The cover is a 148px square button labelled "Crop cover photo", with a "Cover" badge, or "Add a picture" when there are none.
    - Under it are small square buttons labelled "Crop photo N", then a "+" button labelled "Add a photo" while under 8, then "N of 8".
    - Disabled until the item exists, with the editor's existing reasons as the title.
  - Adding a photo: pick the file, `prepareOriginal`, open the cropper on an object URL with `fullFrame`, and send `addPhoto` on Save. Cancel uploads nothing.
  - Tapping a photo opens the cropper on `originalUrl` with its frame, with Replace and Remove available.
  - Reordering: pointer drag between the squares (and onto the cover), and Alt+ArrowLeft / Alt+ArrowRight on a focused photo. Each sends `reorderPhotos` and announces "Photo moved to position N" in an `aria-live` region.
  - The editor's `onSaved` gets the item with the new `photos` and `photoUrl` (from `photoKey`), so the list thumbnail and the preview follow.
  - An item with a `photoUrl` and no `photos` (before the Task 7 script has run) shows that picture as the cover, labelled "Change picture". Tapping it starts the add flow, and the new photo replaces it, as Task 4 describes.
- [ ] **Step 1: Write the failing tests** (mock `ItemsApi` and `prepareOriginal`):
  - With two photos it shows the cover, one small photo, "Add a photo" and "2 of 8". With eight, there is no add button and it says "8 of 8".
  - Adding then Save calls `addPhoto` once with the prepared blob and `fullFrame`, and `onChange` gets the result. Adding then Cancel calls nothing.
  - Clicking "Crop photo 2" opens the cropper with `src` = `originalUrl('a', 'p2')`, and Save calls `recropPhoto('a', 'p2', frame)`.
  - Alt+ArrowLeft on photo 2 calls `reorderPhotos('a', ['p2', 'p1'])`.
  - A rejected call passes its message to `onError`.
  - An item with `photoUrl` set and `photos: []` shows that picture and a "Change picture" button.
- [ ] **Step 2: Run, expect FAIL.**  **Step 3: Implement,** and update `item-editor.test.tsx` where it relied on the old single photo.  **Step 4: Run** the web store tests. Expect PASS.
- [ ] **Step 5: Commit:** `feat(store): an item's photos in its editor -- the cover large, the rest beneath, each one a tap from its crop`

### Task 11: The item page gallery and full screen (option B)

**Files:**
- Create: `apps/web/app/[handle]/shop/[slug]/product-gallery.tsx`, `photo-viewer.tsx`, `product-gallery.test.tsx`
- Modify: `product-view.tsx` (the `.hero` becomes `<ProductGallery>`), `product.module.css` (square, not 4:3), `[slug]/page.tsx` (pass `photoUrls` from `photoKeys`), `apps/web/app/app/store/store-editor.tsx` (the preview passes the editor item's square URLs), `apps/web/app/[handle]/shop/copy.ts`

**Interfaces:**
- Consumes: `getShopItem().photoKeys` (Task 6); `EditorItem.photos` (Task 8).
- Produces:
  - `ProductItem` gains `photoUrls?: string[]`; without it, the gallery shows `[photoUrl]` when there is one.
  - `ProductGallery(props: { name: string; urls: string[]; copy: ShopCopy })`:
    - A square scroll-snap track, swipeable, with `aria-roledescription="carousel"`.
    - A "1 / N" count, and a row of small photos (buttons labelled with `copy.photoOf(i, n)`) that jump to one; the current one is outlined.
    - With one photo there is no count and no row; with none, the letter as today.
    - Tapping the big photo opens `PhotoViewer`.
  - `PhotoViewer(props: { urls: string[]; start: number; copy: ShopCopy; onClose: () => void })`:
    - A modal dialog on black with swipe between photos and pinch to zoom.
    - It closes with × (`copy.closePhoto`), Escape, or a downward swipe of more than 80px.
  - `shopCopy` gains, in English and Malay:
    - `photoOf: (i: number, n: number) => string`: `Photo ${i} of ${n}` / `Gambar ${i} daripada ${n}`
    - `closePhoto`: `Close` / `Tutup`
    - `photos`: `Photos` / `Gambar`
- [ ] **Step 1: Write the failing tests:**
  - Three URLs render three slides, "1 / 3" and three small-photo buttons. Clicking "Photo 3 of 3" scrolls to slide 3 and the count reads "3 / 3" (stub `scrollTo`, then fire the track's `scroll`).
  - One URL renders no count and no row.
  - Clicking the photo opens the dialog, and Escape closes it.
  - In Malay the small-photo label is "Gambar 2 daripada 3".
  - `ProductView` with only `photoUrl` shows that one photo.
- [ ] **Step 2: Run, expect FAIL.**  **Step 3: Implement.** Keep `'use client'` on the new components.  **Step 4: Run** web tests. Then `pnpm --filter @curios/web exec tsc --noEmit` again after loading an item page in `next dev`, since page prop types only appear once Next has generated them.
- [ ] **Step 5: Commit:** `feat(shop): an item's photos on its page -- swipe them, jump by the small ones, open one full screen`

### Task 12: In the running app

**Files:** none new. This task checks the integration and fixes what it finds.

- [ ] **Step 1:** Start `pnpm dev` in the worktree (check that ports 3000/3001 are free first; another session may hold them) and sign in as a dev shop owner.
- [ ] **Step 2:** On a phone-sized viewport:
  - Add three photos, one of them a portrait JPEG with EXIF rotation.
  - Re-crop the cover, replace the second photo, and drag the third to first.
  - Confirm that the shop card, the basket and the profile's shop pill all show the new first photo, and that the item page swipes, jumps and opens full screen.
- [ ] **Step 3:** In devtools, confirm that no request from the item page or the shop page asks for `item-photos/`, and that shop cards load `cover-` files (512), not 1080 squares.
- [ ] **Step 4:** Run the full gates: `pnpm turbo run typecheck lint --concurrency=1 --force` and `pnpm turbo run test --concurrency=1 --force`. Expect everything green, apart from failures already known on main, which must be named in the hand-off.
- [ ] **Step 5:** Commit any fixes, each with a message that says what was wrong.
