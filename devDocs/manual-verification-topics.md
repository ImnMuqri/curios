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
