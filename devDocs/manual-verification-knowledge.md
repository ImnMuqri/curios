# Manual verification — Knowledge (slice 14)

Run against the dev server with a page that has at least one website source, one pasted source,
some accepted facts, one pinned answer, and facts from before slice 14. Run at 375px and on a laptop.

- [ ] Sidebar reads My Curios · Review · Knowledge. No "Add a source" item.
- [ ] /app/knowledge opens on Facts. Each tab's address is `?tab=…`; Back returns to the previous tab.
- [ ] Facts: grouped by category; each shows its source's name, "Added by you" or "Before tracking".
- [ ] Add a fact → it appears under its category as "Added by you", and the chat answers from it.
- [ ] Edit a fact from a source → it becomes "Added by you". Edit it back to the original → allowed.
- [ ] Remove a fact → gone from the list and from chat answers.
- [ ] Sources: Add a source opens the link/paste form in place. A new source shows "Reading…" then its count.
- [ ] Check for new facts on a link → "Reading…", then new facts (if any) wait in Review.
- [ ] Remove a source → the confirmation names the count and the shared-fact warning; afterwards its facts are gone from Facts and Review.
- [ ] A pre-slice-14 source says its facts are under Facts; removing it removes the entry only.
- [ ] Remove a source while it reads → no Remove button is offered.
- [ ] Pinned answers: edit one; remove one → its question is back on Questions as unanswered, and its FAQ page 404s within a minute.
- [ ] Never say: the honesty line shows; add "pork" → listed, "n of 50" updates; add "PORK" → "That's already on the list."; remove it.
- [ ] Every error keeps what you typed and shows beside the thing that failed.
- [ ] At 375px nothing scrolls sideways; tabs scroll horizontally if they must.

## Run 2026-10-26 (Claude, agent; headless Chrome on the dev servers, real ingestion and chat)

All passed, with the screen renamed since this list was written: the nav reads "Facts & sources", not Knowledge, and a source's re-check is "Read <source> again", not "Check for new facts". Tabs have `?tab=` addresses and Back returns to the last; facts group by category with their origin; an added fact listed as "Added by you" and the chat answered from it; an edited source fact became "Added by you" and editing it back was allowed; a removed fact left the list and the chat said it was not sure. Add a source opened in place; pasted text read into 4 facts waiting in Review; a new link showed "Reading… 10%", "51%", then "1 new fact is waiting for you", with no Remove button until it finished; removing the pasted source asked "Remove it and its 4 facts? Facts another source also says are removed too." and its facts left Facts and Review; the pre-tracking source says its facts are under Facts. Pinned answers: an edit reached the FAQ page, and removing one put the question back on Questions as "Needs answer" and 404'd its FAQ page. Never say: "pork" added (2 of 50), "PORK" refused with "That's already on the list." keeping what was typed, then removed. No sideways scroll at 375px; the tab strip scrolls.
