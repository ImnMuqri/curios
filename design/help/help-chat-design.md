# Help chat for owners: design

Written 12 Nov 2026. It follows the support inbox (`devDocs/support-inbox-design.md` on `main`),
which named this as one of two projects to come after it. The owner's decisions, from 31 Oct:

- **A help chat for owners behind the dashboard's Help button.**
- **It answers from an FAQ written from the whole Curios system, using the AI.**
- **When the answer doesn't help, it offers "still stuck? email support@".**

Where this says *(builder's call)*, the owner did not decide it. It is the designer's recommendation
and can be changed without asking them again.

Board: `design/boards/Help.dc.html` (on the canvas as "App · Help"). Its preview bar shows every
state. The FAQ is `design/help/help-faq.md`. Screens: `design/screens/Help-*.jpg`.

---

## Why

Today the Help button and "Help & support" are `mailto:support@curios.my`
(`apps/web/app/app/app-frame.tsx`, `const SUPPORT`). Every question, even "how do I turn off the
lead emails", becomes an email to Iman, who runs Curios alone. Most of these questions have a short,
fixed answer that the product already knows. The help chat answers those in seconds, and sends the
rest to the support inbox with the question already written.

## Goals

- An owner opens Help from any dashboard screen, asks in their own words (English or Malay), and gets
  a short answer with a button to the screen it talks about.
- Every answer comes from the help guide (`help-faq.md`). Nothing else.
- When the answer doesn't help, or there is no answer, the owner can send the question to support
  in one step, and the team's reply comes to their email.
- Iman can see which questions the guide failed, so the guide gets better *(builder's call, below)*.

## Non-goals

- **Doing things for the owner.** The chat explains and links. It never changes a setting, refunds an
  order or edits a page.
- **Reading the owner's data.** It doesn't look at their orders, leads, facts or payments. It knows
  only what a screen needs to pick the right answer: their name, page mode (personal or business),
  plan state, and which screen they are on *(builder's call)*.
- **Live chat with a person.** Support stays email, through the support inbox.
- **Help for customers or visitors.** This is for owners in the dashboard only.
- **A public help centre page.** Possible later from the same file; not now.

## Anti-goals (what would make this a failure even if it works)

- **Making something up.** An invented setting, limit or price is worse than "I don't know". The chat
  answers only from guide entries and says plainly when none fits.
- **A dead end.** Every state has a way to support: under an answer that didn't help, under "not in
  the guide", and at the bottom of the topics list.
- **Asking for secrets.** It never asks for a password, card number or CHIP key, and says so if asked.
- **Help that costs the owner.** Help questions never count against the page's monthly conversations.

---

## Where it opens

- **Top bar → Help** (desktop and tablet). The button shows as pressed while the panel is open.
- **Account popover → Help & support.** It replaces the `mailto:` there too.
- **Phone:** from the account popover, since the phone's top bar has no Help button. On a phone the
  panel takes the whole screen and the bottom pill hides while it is open.
- **The billing failed page's** "Need help? Email us" becomes "Ask for help", opening the panel
  *(builder's call)*.
- The panel opens over the current screen and keeps it underneath, so the owner can read the answer
  and follow it.

## The panel

Follow the board for layout, sizes and copy.

- **Size and place:**
  - Desktop: a 420px panel on the right, under the top bar, with the sheet's 16px top-left corner.
  - Under 1100px the screen behind gets a light scrim; tapping it closes the panel.
  - Phone: full screen.
- **Header:** "Help", the line "Answers from the Curios help guide", a **topics** button and a close
  button. Esc closes the panel.
- **Start state:**
  - Peek, gently bobbing (still under reduced motion).
  - "Hi {first name}. What can I help with?"
  - The line "I answer from the Curios help guide. If something isn't in it, I'll say so and you can
    ask our team."
  - Four suggestions for the screen they are on ("People on Settings often ask"), then **Browse all
    topics**.
- **Suggestions per screen** are chosen in the guide file: each section maps to the screens it helps
  most *(builder's call: a small map in code, from screen to four entry ids)*.
- **The composer** is pinned at the bottom: "Ask about Curios…" and a send button. Enter sends.
- **The conversation:**
  - The owner's question is a grey bubble on the right.
  - The answer sits under a Peek-eyes label, "Curios help". It is streamed and short: two or three
    sentences, with bold only on screen and button names.
  - Under the answer, a grey strip names the entry it came from ("From the guide · How do I give a
    discount?") and has a button to that entry's `Open:` screen ("Open Store").
  - Then **Did this help? Yes / No**.
    - **Yes** shows "Glad that helped."
    - **No** opens the support card.
- **Not in the guide:** the answer says "That isn't in the help guide, so I won't guess. Our team can
  tell you for sure.", and the support card shows straight away, with no Yes/No.
- **The support card ("Still stuck? Email support"):**
  - "We'll send this question and the answer above to the Curios team. They reply to {account email}."
  - An optional "Anything to add?" box.
  - **Send to support**, plus a plain link, "or email support@curios.my", for people who prefer
    their own mail app.
  - After sending: a green "Sent to support. We'll reply to {email} by email. You can keep asking
    here in the meantime."
- **Topics:**
  - A search box ("Search the guide") filters entries by words in the question and answer. No AI,
    so it works when chat is off.
  - Below it, the guide's sections, each with its question count. One opens at a time and lists its
    questions. Tapping a question shows that entry as an answer in the chat, with the same strip and
    Yes/No.
  - Last line: "Can't find it? Email support".
- **Keep the thread** while the panel is closed and across screens, for the browser session. A new
  session starts fresh *(builder's call)*.

## How it answers

- **The guide is the whole knowledge.** `help-faq.md` has about 60 entries, around 6,000 tokens.
  - Send **the whole guide** with every question, as a system prompt that is the same for every
    owner. Use prompt caching. Unlike a shop page, it is one shared prefix across all owners, so
    the cache pays: it is over Haiku's minimum and gets traffic from everyone.
  - No retrieval and no embeddings in this version *(builder's call)*.
- **Model:** the chat model the pages use (Haiku).
- **Context:** the system prompt also gets the owner's first name, page mode, plan state and the
  current screen. Personal and business answers differ ("Why isn't my page on Google?").
- **Output:** the model returns which entry it used (an id from the guide, or none) and the answer
  text. The panel builds the source strip and button from the id, never from model text.
  - An id that isn't in the guide is treated as none.
  - None shows the "not in the guide" state *(builder's call: structured output, so the UI never
    trusts a link the model wrote)*.
- **Rules in the prompt:**
  - Answer only from the guide. Keep its numbers exactly.
  - Answer in the owner's language.
  - Two or three sentences.
  - Never promise what support will do or how fast.
  - Never ask for or accept passwords, card numbers or keys.
  - If the question is about something the owner must do elsewhere (CHIP, their bank, Google),
    say so.
- **Live numbers:** prices, free leads, free orders and the conversation cap can change in admin.
  - The guide writes them as placeholders (`{monthlyPrice}`, `{freeLeads}`…).
  - They are filled from the live settings before the prompt is built, so the help chat never
    quotes an old price *(builder's call)*.
- **When the chat can't run** (the admin's chat kill switch, or the model failing):
  - The composer shows a line: "Help chat is resting. Search the guide instead."
  - It opens Topics.
  - Support stays reachable.
- **Limits:** a per-owner rate limit (for example 30 questions an hour) *(builder's call)*. Help
  never counts toward the page's 200 conversations.

## Sending to support

- **Send to support** posts to an authenticated owner route, which creates a **support thread
  directly** in the support inbox:
  - It comes from the owner's account email.
  - It is matched to their account, so the owner card shows.
  - Subject: "Help: {their question, shortened}".
  - Body: their note, then the question, the answer they got, the entry id (or "not in the guide"),
    and the screen they were on.
  - The admin replies from the inbox as usual. The reply goes to the owner's email and threads there.
- This needs a small addition to the support inbox: an incoming message that starts in the app, not
  by email. Store it as an incoming message with a generated `Message-ID`, so the owner's email reply
  to the admin's answer threads under it *(builder's call)*.
- The `mailto:` link stays as a fallback.
- Rate limit sends, for example 5 an hour per owner.

## What Iman sees *(builder's call)*

- Every help question is logged with: the account, the screen, the entry id used (or none),
  Yes/No/blank, and whether it was sent to support.
  - The question text is kept for 90 days, then deleted. The counts are kept.
- Admin gets a small **Help** section on the existing AI & usage screen:
  - questions this week
  - share answered from the guide
  - share marked "No"
  - a list of the latest questions with no entry or a "No", to write new entries from
- The log is personal data. Withhold it from the read-only role, the same rule as the support
  inbox.

## The guide file

- `design/help/help-faq.md` is the first version, written from `main` at `88d53a3`. Every entry has
  `Open:` (the screen) and `Source:` (where it was checked).
- Move it into the repo where both the API and admin can read it, for example
  `packages/core/src/help/faq.md` parsed at build time *(builder's call)*.
  - A test parses it and checks that every `Open:` path is a real dashboard route and ids are unique.
- **Rule:** a change to the product that makes an entry wrong changes the entry in the same commit.
  Put this in CONTRIBUTING or the slice checklist.
- **Before shipping:**
  - Drop or rewrite any entry about something not built. `shop-ask-items` depends on the 8 Nov Ask
    items.
  - Check every `Source:` against `main`.

## Copy

English, like the rest of the dashboard; the chat answers in Malay when asked in Malay. Peek appears
only in the start state.

## Left to the builder

Everything marked *(builder's call)*, plus:

- route names
- the log table
- how the guide is parsed
- streaming details
- the exact prompt wording within the rules above
