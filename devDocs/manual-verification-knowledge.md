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
