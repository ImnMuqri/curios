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
