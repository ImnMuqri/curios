# Where the build departs from the boards

Every place the implementation of `design/HANDOFF.md` does not follow its board,
and why. Kept so each one can be revisited and either accepted, changed in the
board, or brought in line with the board later. Add to it as modules land; mark
a row **Resolved** rather than deleting it.

| # | Where | The board | What was built | Why | Revisit when |
|---|---|---|---|---|---|
| 1 | Landing: For business, pricing (Business list) | Checkout, paying by the owner's QR with a receipt, Orders in the dashboard | Built as drawn, marked `SLICE 18` in `_landing/copy.ts` and `order-scene.ts` | Not built yet; the landing promises it | Slice 18 ships, or before launch (change the copy) |
| 2 | Billing | (lists Business's features) | Lists `pointsToday`, only what exists now | An owner pays from this screen | Slice 18, or the Billing module |
| 3 | Sign in: film scenes 2 and 3 | "New order #1042 · Paid by QR, proof attached", then confirming it in Orders | A new lead, then Kek Lina's Leads screen ("Wake up to leads.", "Reply before breakfast.") | Orders are slice 18; real owners land here | Slice 18 |
| 4 | Sign up: the handle chip | "Saving curios.my/aisyahdraws for you" | "We'll fill in curios.my/aisyahdraws for you" | The handle is only pre-filled in the browser, not held | If handles are ever reserved at sign-up |
| 5 | Sign up: terms line | "By creating a page you agree to the Terms and Privacy Policy." | Left out | There are no Terms or Privacy pages | Those pages exist |
| 6 | Leads: header note | "Numbers visitors left in the chat · kept for 12 months" | "Numbers visitors left in the chat" | Nothing deletes leads after 12 months (BACKEND.md promises it; no job exists) | The retention job exists |
| 7 | Public page: ask bar on the Links tab | No ask bar on Links (only on Ask) | The sticky ask bar stays on Links | DESIGN.md: the ask bar is the one thing never to cut; the My Curios preview board shows it | Product call |
| 8 | Public page: chat composer label | Placeholder only | "Ask a question" kept for screen readers; placeholder "Ask {name} anything" | FRONTEND.md bans a placeholder as the only label | Accepted unless the rule changes |
| 9 | Type scale | ~45 sizes across the boards | `design-rules.ts` lists the boards' sizes instead of DESIGN.md's six | The six-step rule cannot hold under this design | Accepted (DESIGN.md amended) |
| 10 | Malay copy | (English boards) | Landing, public page tabs and FAQ words drafted by AI | DESIGN.md requires a Malay speaker's copy | Before launch: a native read |
| 11 | Landing: page cards with photos | Name 27% down the card | With a photo, the photo is the top half and the name sits below the face | The board's position lands on the face | Accepted unless the board changes |
| 12 | Landing: Who it's for, question bubble | Over the card at 84px | Above the card's top edge | It covered the owner's face | As 11 |
| 13 | Landing: Klinik Aina's photo | (no photo on the board) | Supplied photo shows a sign reading "PUSTAKA MEDIKA KLINIK" | Name mismatch with the sample | A photo without a sign, or rename the sample |
| 14 | Landing: click sparks, magnet button | On the claim buttons | Left out | The form navigates away at once, so they would never be seen | Accepted |
| 15 | Landing: nav | Frosted glass | Frosted, with near-opaque paper where a browser cannot blur | DESIGN.md amended to allow this one frosted surface | **Resolved** (owner chose frosted) |
| 16 | Landing: refrain | "Tanya je · just ask", close "Tanya je." | "Curious? Just ask" (close too); "Curious? Tanya je" on /ms | Owner's change | **Resolved** |
| 17 | My Curios: preview's Ask tab | A sample exchange ("Do you deliver to Klang?" and an answer with prices) | The page's own empty Ask prompt, "What do you want to know?" | An invented answer would show the owner facts their page does not have | If the preview ever runs a real question |
| 18 | My Curios: preview's tab switch | Links, Ask, Shop always | Shop only while the shop is open | A Shop tab that shows nothing is a dead end | Accepted unless the board changes |
| 19 | My Curios: cover gallery | Four stock covers | All six that ship | Hiding two would take choices away | Accepted |
| 20 | My Curios: You | The picture circle only | A quiet "Remove" under the circle when there is a picture | Owners could remove a picture before; the board has no way to | Board adds a remove |
| 21 | My Curios: Links | Rows move and remove only | A row's name opens it to edit in place (Name, Address, Done) | Owners could edit a link before; the board has no way to | Board adds an edit |
| 22 | My Curios: Social profiles | No validation shown | "That doesn't look like a WhatsApp number." etc., on leaving a field | The API refuses what it cannot read as a profile | Accepted |
| 23 | My Curios: uploads switched off | (not drawn) | Upload tile and picture circle disabled, the reason in their tooltip | Storage can be off in a deployment | Accepted |
| 24 | Public page and My Curios preview: cover | A 300px cover (Public), 54% of the preview phone (MyCurios) | The landing card's proportions everywhere: the photo as tall as the page is wide, the name starting 73% of the width down | Owner's change, so the page, its preview and the landing read alike | **Resolved** (owner chose the landing's ratio) |
| 25 | Store: header | "See your shop" always | Only while the shop is open | A closed shop's address is a 404 | Accepted |
| 26 | Store: preview's Pay screen | The order page: total, QR, bank, Upload receipt | Left out; the preview has Shop and Item | Order pages are slice 18 | Slice 18 |
| 27 | Store: preview's basket bar | "Basket is empty · Checkout" always | The real shop's basket: it appears once something is in it, and orders on WhatsApp | Checkout is slice 18; the preview is the shop customers get today | Slice 18 |
| 28 | Store: payment and notice words | "Customers scan it on their order page", "Each order page shows it...", "Shown at checkout and on the order page", "The earliest date a customer can pick is..." | "For customers to scan when they pay", "Order pages will show it...", "Your shop says where and when", "Ordering today, the earliest a customer can have it is..." | Nothing shows the QR or takes a date yet; the words say only what is true today | Slice 18 |
| 29 | Store: delivery tile | Flat fee "Added to the total" | "One fee per order" | No total is worked out with the fee in it today | Slice 18 |
| 30 | Store: a new item | "+ Add item" makes a "New item" at once | The item is created by its first save that has a name and a price | The API will not hold an item with no price | Accepted |
| 31 | Store: item editor's Done | Always closes | Stays, saying what is wrong, while the fields cannot be saved; "All items" leaves without saving | Closing would drop the owner's typing without a word | Accepted |
| 32 | Store: item picture | The picture square only | A quiet "Remove" under it when there is a picture | Owners could remove a picture before | Board adds a remove |
| 33 | Store: preview | The board's own drawing of the shop (small rows, one terms line) | The real public shop, at its own sizes, terms on three lines | One renderer, so the preview cannot disagree with the shop | Public module |
