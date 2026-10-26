# Manual verification — question topics (slice 15)

Run against the dev server after `pnpm --filter @curios/workers group:backfill`, on a business page.

- [ ] Questions shows one row per topic with its total count; most asked first.
- [ ] "+N other wordings" folds out the wordings, each with its own count.
- [ ] Answer a topic; ask the chat each of its wordings — every one gets your answer word for word.
- [ ] Ask a brand-new wording of an answered topic: the first time the AI answers; after a few seconds, asking again gives your answer.
- [ ] Not the same question → the wording becomes its own row and never rejoins.
- [ ] Same as… → two rows become one; with two answers you are asked which to keep.
- [ ] A topic that inherited two answers shows "Two answers — pick one"; Keep this settles it.
- [ ] Rename a topic; it keeps the name as counts change.
- [ ] Delete a wording; delete a whole topic (the confirm names how many wordings go).
- [ ] A topic with 3+ asks and an answer has a FAQ page; after merging it into another FAQ'd topic, its old address redirects to the survivor's page.
- [ ] Knowledge → Pinned answers lists answered topics; edit and withdraw work.
- [ ] At 375px nothing scrolls sideways; row actions wrap below the text.

## Run 2026-10-26 (Claude, agent; headless Chrome on the dev servers, real chat and grouping)

All but the "Two answers, pick one" item passed; that state comes only from the one-off grouping job and its tests cover it. Rows are one per topic with totals, most asked first; the wordings and their counts show in the topic's panel (the "+N other wordings" fold this list names was replaced by that panel). An answer was repeated word for word for each of three wordings; a brand-new wording got the model's own reply first and the owner's answer on the next ask, joined to the topic. "Not the same question" made a pinned row of its own that stayed apart when asked again. "Same question as…" merged two answered topics after saying "Both have an answer. The one you merge into keeps its answer." (the screen no longer asks which to keep); merging an FAQ'd topic into another made its old address answer 308 to the survivor's page. Rename held as new asks came in; a wording and a whole topic deleted (the topic's confirmation reads "Delete this topic and all its wordings?", without a count). Pinned answers in Knowledge listed, edited and withdrew. No sideways scroll at 375px.
