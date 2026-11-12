# Contributing

Conventions that are not in a test. The rest of the rules live in `devDocs/`.

## The help guide changes with the product

The dashboard's Help chat answers owners only from the help guide,
`packages/core/src/help/faq.md`. When a change makes an entry wrong — a renamed button or tab, a
moved setting, a new limit, a feature added or taken away — **change the entry in the same commit.**
A wrong guide is worse than no guide: Help repeats it to every owner who asks.

- Each entry is `### id · question`, the answer, then `Open:` (a dashboard path, or `none`) and
  `Source:` (where you checked it). Ids are permanent: the Help log and the admin's counts keep them.
- Prices and the numbers the admin can change are placeholders (`{monthlyPrice}`, `{annualPrice}`,
  `{annualSaving}`, `{freeLeads}`, `{freeOrders}`, `{conversationCap}`), never digits.
- After editing, run `pnpm --filter @curios/core gen:help`. `guide.test.ts` fails until you do, and
  also checks every `Open:` is a real screen and tab and every id is unique.
- The four questions each screen suggests are `HELP_SUGGESTIONS` in `packages/core/src/help/guide.ts`.
- What owners asked that the guide could not answer is on the admin's AI & usage screen, under
  "What the guide missed". Write new entries from there.
