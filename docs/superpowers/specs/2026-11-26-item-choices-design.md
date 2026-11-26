# Choices inside options (item variants)

Owner, 26 Nov 2026. Approved in conversation: "Options inside options like Shopee" — e.g. Vanilla /
Chocolate / Red velvet cake, each in 500g / 1kg / 2kg. A price for every combination. A photo per choice of
the first group (like Shopee's colour photos), in this version.

## Goals
1. An item can have **up to two choice groups**, each named by the owner (e.g. *Flavour*, *Size*), each with
   1–10 choices (labels up to 40 chars).
2. **A price for every combination.** A "Same price for every {group one}" switch lets the owner type one price
   per group-two choice and fills it across every group-one choice.
3. **Combinations can be switched off** (not made / not sold). At least one must stay on.
4. **A photo per group-one choice**, picked from the item's own photos (up to 6 already). No new upload path.
5. The shop's item page: pick group one (photo tiles when photos are set, else chips), then group two (chips);
   switched-off combinations are greyed and not pickable; the price and the main photo follow the pick.
6. Everything downstream keeps working unchanged: basket, checkout, orders, payments, emails, owner's order list,
   order page, receipts, vouchers, Ask chat product cards.

## Non-goals
- Stock per combination (items do not count stock today).
- More than two groups.
- Per-choice photos for group two.

## Anti-goals
- Breaking existing items with a single options list, or past orders' labels.
- A basket line pointing at a combination that no longer exists or is switched off being sold anyway.

## Data (the key decision)
Each **combination is an `ItemOption` row**, as options are today: `label` = "Chocolate · 1kg" (group-one choice,
" · ", group-two choice; one group → just the choice), `priceCents`, `position`. So basket lines (`optionId`),
order lines (`optionLabel`), checkout, payments and emails need no change.
New:
- `Item.choiceGroups` — the group names: two nullable strings (`choiceGroupOne`, `choiceGroupTwo`). Null/null = a plain
  options list exactly as today (back-compatible).
- `ItemChoice { id, itemId, group (1|2), label, position, photoId? → ItemPhoto (SetNull) }` — the choices, in order.
- `ItemOption` gains `choiceOneId?`, `choiceTwoId?` (→ ItemChoice, Cascade) and `available Boolean @default(true)`.
Migration adds only nullable columns / a new table; no existing row changes.
Saving stays "replace whole" (as options are today); labels are recomputed from choices on save.

## API
The item pricing input gains a third shape next to `single`, `options`, `ask`: `choices` =
`{ groupOne: { name, choices: [{ label, photoId? }] }, groupTwo?: { name, choices: [{ label }] },
combos: [{ one: index, two?: index, priceCents, available }] }` — every combination exactly once, prices 0–the
existing max, at least one available, photoIds must belong to this item. Read models (owner editor, public shop,
chat catalog) return groups, choices (with photo square URLs) and combos (`id`, choice ids, price, available).
Placing an order with an `optionId` whose `available` is false is refused like a missing option today.
The chat's catalog text lists combinations with prices ("Chocolate · 1kg RM85"), off ones left out.

## Editor (owner)
Price section: today's **One price | Options** toggle gains a way to add a second level: in Options, "Add a choice
group" turns the list into **Group one** (name + choices) and **Group two** (name + choices), then a price table
(rows group one × columns group two on wide screens; stacked per group-one choice on phones) with a per-cell
price and an on/off. "Same price for every {group one}" collapses it to one row of prices. Each group-one choice
can pick a photo from the item's photos (small picker of the item's existing squares, or none). Removing group two
returns to a single group. Removing a choice drops its combinations. Clear validation messages.
"Customers see …" preview line reflects the lowest available price ("From RM45").

## Shop item page
Group one as photo tiles (photo + label) when any group-one choice has a photo, else chips; group two as chips;
first available combination preselected; off combinations greyed (aria-disabled) with no tap; price updates; picking
a group-one choice with a photo switches the gallery to that photo. Malay copy via the shop copy object.

## Left to the builder
Exact component structure, the phone layout of the price table, label character rules (" · " inside a label is
refused), the API size limits beyond those stated.
