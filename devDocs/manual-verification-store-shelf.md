# Manual verification — the shelf (slice 17)

**Status: PARTLY RUN, 2026-10-13.** Everything an HTTP call can prove was run against
`pnpm dev` that day, on the dev database, with accounts seeded for the purpose and deleted
afterwards. **Everything that needs eyes or a phone was not looked at** and is marked "for the
owner — not yet looked at" below. Nobody has seen the shop in a browser.

Slice 17 shipped with every automated gate green; this is the half a test cannot see: how the
tile, the sheet and the basket bar look on a real phone-width screen, and whether a real
WhatsApp opens with the right message. It follows `manual-verification-leads.md`.

Re-run it after any change to `store/*`, `shop.query.ts`, `shop-view.tsx`, `basket.ts`,
`items-editor.tsx`, the shop row in `links-editor.tsx`, or the SHOP block in `prompt.ts`.

## Things the shop does that look like bugs and are not

- **The basket goes to WhatsApp as a message.** There are no orders until slice 18: Curios
  stores nothing about a basket, and no payment is taken. The "Order on WhatsApp" message
  *is* the order.
- **A page with no `wa.me` or `api.whatsapp.com/send` link shows a line instead of the
  button** ("To order, contact <name> through the links on their page.").
- **An open shop with no available items still shows its tile, reading "0 items"** ("0 barang"
  in Malay), and an empty shelf. Opening it is the owner's choice; hiding the last item does not
  close it.
- A shop opens only with a way to pay *and* a way to hand over. Both are checked even though
  nothing is paid through Curios yet, because slice 18 will need them.

## What CI proves, and what still needs a person

The rules (`store.test.ts`), the routes (`store.routes.test.ts`, `item.routes.test.ts`), the
tile in the links order (`link.routes.test.ts`), the reads (`shop.query.test.ts`), the basket's
arithmetic and message (`basket.test.ts`), the sheet and basket bar under jsdom
(`shop-view.test.tsx`), the editors (`items-editor.test.tsx`, `store-settings.test.tsx`), the
SHOP block (`prompt.test.ts`) and the shop goldens (`fixtures/goldens/shop.json`) all run on
every change. jsdom has no layout, so none of them can say how anything *looks*, and none opens
WhatsApp.

## Before you start

```bash
docker compose up -d                 # postgres + redis
pnpm --filter @curios/api dev        # 3001
pnpm --filter @curios/web dev        # 3000
```

Check nothing already holds those ports — an orphaned dev server answers instead:

```bash
netstat -ano | grep -E ":(3000|3001)\s.*LISTENING"
```

You need two signed-in owners, a **business** page (published, with a `wa.me` link among its
links) and a **personal** page, and a second business page with **no** WhatsApp link. The
three-lead trial does not matter here. Storage (`STORAGE_*` in `.env`) is on for checks 2, 3
and 15 (the QR and photo uploads) and off for the switched-off half of 15; check what you have first. In dev without storage settings,
uploads are off, which is check 15.

---

## The checks

Each has an expected result. **HTTP** means it can be proved with `curl` and was run on
2026-10-13 against a seeded business page `t14shop`, a no-WhatsApp Malay page `t14nowa` and a
personal page `t14pers`; the result is beside it.

1. **A personal page cannot use the Store.** `GET /store` and `PATCH /store/settings` return
   403 `STORE_BUSINESS_ONLY`; `/app/store` renders a line saying shops are part of business
   pages and there is no Store link in the nav; `/<handle>/shop` is a 404.
   *HTTP, run 2026-10-13:* both API calls 403 `STORE_BUSINESS_ONLY`; `/app/store` 200 with
   "Shops are part of business pages"; `/t14pers/shop` 404. The absent nav link is covered by
   `app-frame.test.tsx`, not looked at.

2. **Opening a shop is refused, then allowed.** On a business page with no payment and no
   pickup: switch the shop on — refused with "Before your shop can open, add a way to pay (a
   DuitNow QR or your bank account) and turn on pickup or delivery." Add bank details only —
   still refused, naming pickup. Turn pickup on and open — allowed.
   *HTTP, run 2026-10-13:* exactly those three outcomes, `STORE_NOT_READY` 400, 400, then 200.
   The DuitNow QR route of the same check (upload an image instead of bank details) needs
   storage: for the owner — not yet looked at.

3. **Adding each kind of item.** One price (RM25.50) is stored as 2550 sen and reads "RM25.50".
   A list of options (1kg RM95, 2kg RM170) reads "from RM95" on its card. A price of 0, and an
   options item with no options, are refused with their own sentences (`INVALID_ITEM`).
   *HTTP, run 2026-10-13:* both items created 201; `RM25.50`, `from RM95` and `RM170` all on
   `/t14shop/shop`; price 0 refused "Give it a price above RM0, up to RM10,000."; empty options
   refused "Add at least one option, or give the item one price." How the add form looks and
   its validation messages as typed: for the owner — not yet looked at.

4. **Hiding an item.** Turn Available off. It leaves `/handle/shop` at once, the tile's count
   drops by one, and the chat stops offering it (check 14).
   *HTTP, run 2026-10-13:* the tile went from "2 items" to "1 item"; the item's name no
   longer appears on the shop page. The Available switch in the editor: for the owner — not yet
   looked at.

5. **The tile on the page, in both languages.** An English page's tile reads **Visit shop** and
   "N items"; a page whose language is `ms` reads **Lawati kedai** and "N barang". It links to
   `/<handle>/shop`.
   *HTTP, run 2026-10-13:* English "Visit shop" with "2 items"/"1 item", link `/t14shop/shop`;
   Malay "Lawati kedai" with "0 barang". The tile's look (its photo from the first available
   item that has one, the text over it, the caption on a photo): for the owner — not yet looked
   at.

6. **Dragging and sizing the tile in My Curios.** The links list carries a **Shop** row with
   the note about turning the shop off in Store. Dragging it, or using Move up/down, moves the
   tile on the page; choosing a size changes it; neither survives a reload wrongly. Turning the
   shop off removes the row and the tile.
   *HTTP, run 2026-10-13:* `PUT /links/order` with the ids `[link, 'shop']` returned 200; the
   same request without `'shop'` while the shop is open returned 409 `LINK_ORDER_STALE`;
   `PATCH /store/settings {"tileSize":"WIDE"}` put `data-size="WIDE"` on the public tile; an
   unknown size is a 400; closing the shop removed the tile and made `/handle/shop` a 404.
   The dragging itself, and the size picker's look: for the owner — not yet looked at.

7. **`/handle/shop` at phone width.** At 375px: the cards fit the screen without sideways
   scrolling, the back arrow returns to the front page, the pickup, delivery and notice lines
   read in the page's language, and the page uses its own accent, heading font and background.
   Tapping a card opens a sheet where an option and a quantity are chosen; `?item=<id>` opens
   with that item's sheet up.
   *HTTP, run 2026-10-13:* `/t14shop/shop` 200 with both items, "Pickup: Seksyen 7, Shah
   Alam" and "Order at least 1 day ahead"; the Malay page shows "Boleh ambil sendiri" and
   "Tempah sekurang-kurangnya 1 hari awal"; `?item=<id>` renders that item's options and "Add to
   basket". **Layout at 375px, the sheet's feel and the page's styling: for the owner — not yet
   looked at.**

8. **A basket sent to WhatsApp.** Add two items, one with an option and a quantity of 2. The
   basket bar reads "N in basket · RM…" and its button **Order on WhatsApp** opens
   `wa.me/60123456789?text=…` with this message (a Malay page says "Hai <shop>, saya nak
   tempah:" and "Jumlah:"):

   ```
   Hi <shop>, I'd like to order:
   • 2 × Kek Batik (1kg) — RM190
   • 1 × Cookie — RM25.50
   Total: RM215.50
   ```

   Reloading keeps the basket (it is in `sessionStorage` for the tab); removing an item
   removes its line; an item the owner hides after it was added vanishes from the basket
   rather than being priced.
   *Not provable over HTTP*: the basket exists only in the browser. The message text and the
   total are covered by `basket.test.ts`. For the owner — not yet looked at, including that a
   real phone opens WhatsApp with the text intact.

9. **A page without WhatsApp.** On the page with no `wa.me` or `api.whatsapp.com/send` link,
   adding an item shows, in place of the button, "To order, contact <name> through the links on
   their page." (Malay: "Untuk tempah, hubungi <name> melalui pautan di halaman mereka.").
   *Basket-driven, so not in the server HTML:* the shop page of `t14nowa` returned 200 with its
   item and no WhatsApp number to link. The line itself: for the owner — not yet looked at.

10. **An open shop with nothing available.** Hide every item. The tile still shows with
    "0 items" and the shop shows "Nothing for sale right now. Check back soon." (Malay: "Tiada
    barang dijual buat masa ini. Datang lagi nanti.")
    *HTTP, run 2026-10-13:* the Malay page `t14nowa`, opened with no items, showed "0 barang"
    and "Tiada barang dijual buat masa ini".

11. **Delivery and notice.** `FLAT` needs a fee above RM0 up to RM500
    ("Give flat delivery a fee above RM0, up to RM500."); `RIDER` keeps no fee and the shop says
    "Delivery: rider fee paid separately"; notice is a whole number of days from 0 to 30, and
    0 reads "Same-day orders welcome". These show on the shop; nothing enforces them until
    slice 18. Not run over HTTP: for the owner — not yet looked at (covered by
    `store.routes.test.ts` and `store-settings.test.tsx`).

12. **Reordering the items.** Drag, or use the up/down buttons: the shop's order follows. A
    second tab that added an item first gets "Your items changed somewhere else" (409
    `ITEM_ORDER_STALE`) and a reload. For the owner — not yet looked at.

13. **A personal page's `/app/store` and `/handle/shop`** — see check 1.

14. **Asking the chat a shop price.** With the shop open, ask "How much is the Kek Batik 2kg?"
    The answer quotes RM170 exactly and says to order from the shop; asked for the hidden item
    it says it will check with the owner and quotes nothing. Close the shop and the chat stops
    knowing the items.
    *HTTP, run 2026-10-13 (live model):* the 2kg Kek Batik was answered "RM170" with "You can
    order it from the shop here"; the hidden Cookie was answered "I'm not sure if we have a
    cookie on the menu at the moment — let me check with the owner for you." Closing the shop
    was not asked again live (`chat.service.test.ts` and `prompt.test.ts` cover it).
    `pnpm goldens` was not run for this document.

15. **Storage switched off.** With no storage settings, uploading a payment QR or an item
    photo says uploads are switched off, and bank details, items and the shop all still work.
    *HTTP, run 2026-10-13 (the dev API runs with storage off):* `POST /store/payment-qr`
    returned 503 `STORAGE_NOT_CONFIGURED`, the code the web app turns into its "switched off"
    sentence. How that sentence reads under the QR field and the photo button: for the owner —
    not yet looked at.

## Seeding, if you need accounts

A throwaway script that makes an `Account`, a `Page` and a session through `createSession`
(`apps/api/src/modules/auth/session.service.ts`), sends the value as the `curios_session`
cookie, and deletes the accounts afterwards (the page and its items go with them by cascade).
Nothing here should be left in the dev database.

---

## Recording the result

Note which checks you ran and what you saw, in this file, with the date. Report any not run
rather than leaving them ambiguous. As of 2026-10-13 the visual and phone checks (6 dragging,
7 layout, 8 and 9 in a browser, 11, 12, and the DuitNow QR upload) are **for the owner — not
yet looked at**, as are the visual remainders of checks 3 (the add form and its messages as
typed), 4 (the Available switch), 5 (the tile's photo, text and caption), 10 and 15 (how the
"switched off" sentence reads under the QR field and the photo button).
