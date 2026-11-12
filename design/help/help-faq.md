# Curios help guide (the FAQ behind the Help chat)

Written 12 Nov 2026 from the Curios system on `main` (code, devDocs and dashboard copy at `88d53a3`).
This is the **only** thing the Help chat answers from. If it is not here, the chat says it does not
know and offers support. When the product changes, this file changes in the same commit.

Format, for the builder: each entry is a `###` heading `id · question`, then the answer the chat may
use (it can shorten or reword it, never add to it), then two lines:
- `Open:` the dashboard screen the answer points to (the chat shows it as a button), or `none`.
- `Source:` where the answer was checked, for whoever edits this file. Never shown to owners.

Answers are written to the owner, in plain words, no jargon. The chat answers in the language the
owner asks in (English or Malay); this file is English only.

---

## Getting started

### start-what · What is Curios?
Curios is a link in bio people can ask. Your page shows your links, and visitors can ask it questions about you, your work, your prices or your shop. It answers only from facts you approved, in the language they ask in, and never makes anything up.
Open: none
Source: devDocs/README.md; apps/web/app/_landing/copy.ts (meta, hero)

### start-personal-business · What is the difference between a personal and a business page?
A personal page is free. It answers questions about you and your work, and it stays out of Google unless you switch that on. A business page also takes the numbers of people ready to buy (leads), runs a shop with orders, gets its own FAQ pages, and always shows in search results. Business is RM49 a month or RM490 a year after the free trial.
Open: /app/billing
Source: packages/core/src/plan.ts; apps/web/app/app/billing/page.tsx (INCLUDED); devDocs/README.md (Tiers, Price)

### start-switch · Can I switch from personal to business?
Yes, from Billing, whenever you start selling. It is one way: a business page can’t go back to personal, and it will appear in search results.
Open: /app/billing
Source: devDocs/README.md (Tiers); dashboard copy “You can switch a personal page to business later. Not the other way round.”

### start-address · Can I change my page address?
No. Your address (curios.my/yourname) is set when you claim it and can’t be changed. You can change everything about how the page looks in My Curios. Addresses are 3 to 30 lowercase letters or numbers.
Open: /app/curios
Source: packages/core/src/handle.ts; onboarding copy “You can change how it looks later, not the address.”

### start-publish · How do I get my page live?
Publish it from My Curios when you are ready. After that, facts you accept show up on it straight away; there is nothing else to publish. Then put curios.my/yourname in your Instagram, TikTok or WhatsApp bio.
Open: /app/curios
Source: dashboard copy “Publish it when you are ready. After that, facts you accept show up on it straight away.”

### start-instagram · Can Curios read my Instagram or TikTok?
Not yet. Instagram, TikTok, Facebook and LinkedIn don’t let us read profiles. Paste your bio or captions instead, or add a website or Linktree link.
Open: /app/knowledge?tab=sources
Source: devDocs/README.md (Definition of done, amended 2026-10-26); dashboard copy

---

## Your page (My Curios)

### page-look · How do I change how my page looks?
In My Curios. You can change your picture, name and the line people read first, the cover behind your name, your colours (a page colour and one accent colour), how your links look, and the font for your name. The preview beside it shows your page as visitors see it.
Open: /app/curios
Source: devDocs/slice-13-build-spec.md; My Curios copy

### page-links · How do I add, reorder or resize links?
In My Curios, on Links. Add a link (a website, WhatsApp, Instagram, an email or a phone number), drag to reorder, and pick a size for each tile. You can have up to 30 links. Your page’s chat can point people to them too.
Open: /app/curios
Source: packages/core/src/bento.ts (MAX_LINKS, TILE_SIZES)

### page-shop-tile · How do I remove the shop tile from my page?
The Visit shop tile shows whenever your shop is open. To remove it, turn the shop off in Store. You can still move it and change its size in My Curios like a link.
Open: /app/store
Source: devDocs/FRONTEND.md (The shop row in My Curios)

### page-google · Why isn’t my page on Google?
Personal pages start out of search results, because most people don’t want an AI page about themselves ranking for their name. You can switch that on in Settings. Business pages are always in search results. New pages can take Google a while to find.
Open: /app/settings
Source: devDocs/FRONTEND.md (Personal pages are noindex by default); Settings copy

---

## Knowledge: what your page knows

### know-how · How does my page know what to answer?
From facts: your prices, hours, where you are, what you offer. Add a source (a website, a menu or price list file, or a few pasted paragraphs) and Curios reads it and picks out facts. Each one waits in Review until you accept it. You can also write facts yourself in Facts & sources.
Open: /app/knowledge
Source: Knowledge copy “Facts are what the chat answers from…”

### know-review · Why didn’t my new facts show up on my page?
Facts found in a source wait in Review until you accept them, one at a time, so nothing goes live by surprise. Once you accept a fact, it is used straight away.
Open: /app/review
Source: Review copy “Nothing reaches your customers until you accept it.”

### know-own-fact · Do facts I write myself need review?
No. Facts you add yourself are trusted straight away.
Open: /app/knowledge
Source: Knowledge copy “Facts you add are trusted straight away. No review needed.”

### know-files · What can I add as a source?
A website or any page about you or the business, a Linktree, a file such as a menu, price list or brochure (PDF, Word or text, up to 5 MB), or text you paste. Reading usually takes under a minute, and you can leave while it reads.
Open: /app/knowledge?tab=sources
Source: Sources copy; “This usually takes under a minute.”

### know-wrong · My page said something wrong. How do I fix it?
Find the fact in Facts & sources and edit or remove it. Once removed, the chat stops using it and reading the source again won’t bring it back. If the answer came from Questions, edit your answer there. You can try questions in the test chat on Facts & sources to check.
Open: /app/knowledge
Source: Knowledge copy “Remove it? The chat stops using it, and a re-read won’t bring it back.”; “Test what the chat says”

### know-never-say · How do I stop my page talking about something?
Add it to Never say in Facts & sources, for example your home address. The chat is told never to bring it up. It is very reliable but not a guarantee, so don’t put anything there that must never appear. Up to 50 entries.
Open: /app/knowledge?tab=never-say
Source: packages/core/src/knowledge.ts; Never say copy

### know-invent · Will my page make things up?
No. It answers only from facts you accepted and answers you wrote. If nothing answers the question, it says it will check with you, and the question waits in Questions. It never guesses a price or rounds a number.
Open: /app/questions
Source: landing FAQ “What if it says something wrong?”

### know-language · Does my page answer in Malay?
Yes. It answers in the language the person used: Malay, English, Manglish or a mix.
Open: none
Source: landing FAQ “Does it reply in Malay?”

### know-test · How can I test what my page will say?
Use the test chat on Facts & sources. Ask the way a customer would; it answers only from what is there, the same way your page does.
Open: /app/knowledge
Source: Knowledge ask panel copy

---

## Questions and FAQ pages

### q-what · What is the Questions screen?
What visitors ask your page, grouped by topic, most asked first. Answer a topic once and the chat uses your exact words for every way people ask it. Questions the chat wasn’t sure about land here too.
Open: /app/questions
Source: devDocs/FRONTEND.md (Questions, slice 15); Questions copy

### q-faq-pages · How do FAQ pages work?
On a business page, a question asked at least 3 times that you have answered gets its own FAQ page, which Google can find. You can hide a topic from your FAQ; the chat still uses the answer.
Open: /app/questions
Source: packages/core/src/faq.ts (FAQ_MIN_ASKS); Questions copy “Hidden from your FAQ. The chat still uses the answer.”

### q-merge · Two topics are the same question. Can I join them?
Yes. Open the topic’s menu and pick Same as…, then the other topic. If both have an answer, you pick which one to keep. If a wording was grouped wrongly, use Not the same question to split it out.
Open: /app/questions
Source: devDocs/FRONTEND.md (Questions)

### q-pinned · What are pinned answers?
The answers you wrote in Questions. They are listed on the Pinned answers tab in Facts & sources. Remove one and the question goes back to Questions as unanswered.
Open: /app/knowledge?tab=pinned
Source: devDocs/FRONTEND.md; Pinned copy

---

## Leads

### lead-what · What is a lead?
A visitor who is ready to buy and leaves their phone number. When someone in the chat shows real interest, your page offers a card asking for their number. Each lead lands in Leads with what they were asking, and you can email yourself when one arrives.
Open: /app/leads
Source: packages/core/src/qualify.ts; Leads copy

### lead-none · Why am I not getting leads?
A few common reasons: the number card only shows after a real back-and-forth (a visitor asking specifics), your free leads are used up and the plan isn’t paid (the card stops showing), or the page has hit this month’s chat limit. Check Billing for your plan and this month’s use.
Open: /app/billing
Source: packages/core/src/qualify.ts (MIN_VISITOR_TURNS); packages/core/src/plan.ts (canCapture)

### lead-reply · How do I reply to a lead?
Open the lead in Leads. There is a first message written for you that you can edit, then Open WhatsApp to send it from your own WhatsApp.
Open: /app/leads
Source: Leads board and screen

### lead-delete · How long are leads kept?
They agreed to be contacted when they left their number. Delete a lead once you are done with it. Leads are kept for 12 months at most.
Open: /app/leads
Source: devDocs/README.md (PDPA: 12 month retention); Leads copy

---

## Shop and orders

### shop-open · How do I open my shop?
In Store (business pages only). Add your items, choose how customers pay and how they get their order (pickup, delivery or both), then turn on Open for orders. The switch tells you what is still missing.
Open: /app/store
Source: devDocs/FRONTEND.md (/app/store); Store copy

### shop-items · How do I add items?
In Store, under Items. Give each item a name, up to 8 photos, and one price or a list of priced options (like 1kg RM95, 2kg RM170). Turn Available off to hide an item from the shop and the chat at once.
Open: /app/store
Source: devDocs/store-design.md; packages/core/src/item-photos.ts (MAX_ITEM_PHOTOS)

### shop-ask-items · Can customers ask about an item instead of buying it?
Yes. Set the item to Ask for a price in Store. Customers send an enquiry with one message plus their name and WhatsApp, and it lands in Leads with the details picked out for you. You can give an optional starting price so your page can answer “how much?”.
Open: /app/store
Source: design/HANDOFF.md “Shop: Ask items and enquiries (8 Nov 2026)”. Check it is built before shipping this entry.

### shop-pay · How do my customers pay?
Two ways. By your own DuitNow QR or bank account: customers pay you directly and upload a receipt, and you check it and mark the order paid. Or connect your own CHIP account: customers pay by FPX, e-wallet or card at checkout and the order marks itself paid. Curios never holds your money and takes no cut.
Open: /app/store
Source: devDocs/chip-payments-design.md (Part 2); Store copy

### shop-chip · What do I need to connect CHIP?
Your own CHIP account, which needs SSM registration and a business bank account. If you don’t have one, the DuitNow QR or bank transfer way works without it.
Open: /app/store
Source: devDocs/chip-payments-design.md (Why)

### shop-fees · Does Curios take a cut of my sales?
No. You pay your plan and nothing per sale. If you take payments through your own CHIP account, CHIP charges its own payment fees. Paying your DuitNow QR has no CHIP fee.
Open: none
Source: devDocs/chip-payments-design.md (Non-goals: no Curios fee on shop orders); Store copy “No CHIP fee.”

### shop-pickup · How do I set pickup and delivery?
In Store. Pickup can have several places, and either any time that day or your own time windows, each with an optional limit. Delivery is a flat fee (up to RM500) or “rider paid separately”. You can also set the minimum days’ notice.
Open: /app/store
Source: devDocs/payment-results-and-pickup-design.md; Store copy “Give flat delivery a fee above RM0, up to RM500.”

### shop-vouchers · How do I give a discount?
Make a voucher in Store. It can apply by itself when an order fits, or only with a code the customer types. It takes a percentage or a fixed amount off the whole order or one item, with an optional minimum spend, end date and limit on uses. One discount applies per order, the one that saves most, and delivery is never discounted.
Open: /app/store
Source: devDocs/vouchers-design.md (Part A)

### order-flow · What do I do when an order comes in?
It shows in Orders. If the customer paid by QR or bank transfer, check their receipt and mark it paid. Then make it, and mark it completed. Online CHIP payments are marked paid for you. You can turn the new order and receipt emails on or off in Settings.
Open: /app/orders
Source: Orders copy “You check it, mark it paid, and make it.”; Settings notifications

### order-refund · How do I cancel or refund an order?
Cancel it in Orders. Curios doesn’t move money, so send the money back yourself (and refund the CHIP payment in CHIP if they paid online), then mark the order refunded.
Open: /app/orders
Source: Orders copy “Send it back yourself and refund the CHIP payment too, then mark it refunded.”

### order-free · Is there a limit on orders?
On the free trial, a business page can take 3 orders. After that, the shop takes no orders until you pay. Once paid, there is no limit.
Open: /app/billing
Source: packages/core/src/plan.ts (FREE_ORDERS); Billing copy “No limit. Take as many as you get.”

### digital-what · Can I sell digital things?
Yes. An item can be digital: files (up to 5, 100 MB each), a code that each buyer gets once, an access link such as a private playlist, or a booking with times and seats. Buyers get them by email after paying.
Open: /app/store
Source: packages/core/src/digital.ts; Store digital copy

### digital-links · How do download links work?
Each buyer gets their own links. They work 5 times each, for 30 days. You can resend them from the order in Orders.
Open: /app/orders
Source: packages/core/src/digital.ts (DOWNLOAD_USES, DOWNLOAD_DAYS)

### digital-codes · What happens when I run out of codes?
Each buyer gets one code nobody else gets. When they run out, the item shows Sold out until you add more.
Open: /app/store
Source: Store digital copy

### digital-bookings · How do bookings work?
Buyers pick a time. Each booking takes a seat, and a full time can’t be picked. They get a reminder email the day before. A time with bookings can’t be moved, but its seats can still change.
Open: /app/store
Source: Store digital copy

---

## Billing and your plan

### bill-price · How much is Business?
RM49 a month, or RM490 a year (two months free). Personal pages are free.
Open: /app/billing
Source: packages/core/src/billing.ts (PLAN_PRICES_CENTS); devDocs/README.md (Price). Prices can be changed in admin; the chat must read the live prices, not this line.

### bill-trial · Is there a free trial?
Yes. A business page gets 3 free leads and 3 free orders. It isn’t timed: it ends once your page has actually worked for you.
Open: /app/billing
Source: packages/core/src/plan.ts (FREE_LEADS, FREE_ORDERS); devDocs/README.md (Free trial)

### bill-trial-reset · Can I reset my free trial?
Once, from Billing, while your page has never paid. Use it if you used up the free leads or orders testing your own page.
Open: /app/billing
Source: devDocs/README.md (Free trial)

### bill-pay · How do I pay?
In Billing. Pick monthly or yearly and pay through CHIP by FPX, card or e-wallet. CHIP emails your receipt.
Open: /app/billing
Source: devDocs/chip-payments-design.md (Part 1); Billing copy

### bill-renew · Does my plan renew by itself?
Only if you turn it on. If you pay by card, you can tick Renew automatically, and your card is charged when each period ends. FPX and e-wallets can’t charge automatically, so you renew those by hand. You can turn auto-renew off any time in Billing.
Open: /app/billing
Source: devDocs/chip-payments-design.md; Billing copy “We’ll charge your card when this period ends. Turn it off any time.”

### bill-renew-failed · My auto-renew payment failed. What now?
We email you and try again the next day. You can also pay by hand from Billing. Your plan keeps running until its paid date.
Open: /app/billing
Source: devDocs/chip-payments-design.md (Goals); Billing copy “We’ll try again tomorrow.”

### bill-lapse · What happens if my plan runs out?
Your page keeps working: the chat keeps answering and your FAQ pages stay. What stops is taking numbers (the lead card) and taking new orders in the shop, until you pay again.
Open: /app/billing
Source: packages/core/src/plan.ts (canCapture, canTakeOrders); devDocs/README.md (Free trial)

### bill-limit · Is there a limit on how much my page can chat?
Every page can start 200 new conversations a month. Past that, the chat gives a short fixed reply and points people to your links until the 1st of next month. Nothing extra is charged. Billing shows this month’s use.
Open: /app/billing
Source: packages/core/src/cap.ts; apps/web/app/app/alerts.ts. The number is set in admin; read it live.

### bill-paused · My page is giving a short fixed reply but I’m under the limit.
Then chat is paused across Curios for a moment, not just your page. It isn’t your monthly limit and nothing is wrong with your page. It comes back by itself.
Open: none
Source: Knowledge ask panel copy “Chat is paused across Curios for a moment…”

---

## Account and settings

### acc-signin · How do I sign in?
With Google, or with your email and a password. You can add a password in Settings as a second way in.
Open: /app/settings
Source: devDocs/README.md (Owner auth); Settings copy

### acc-password · I forgot my password.
Use Forgot your password? on the sign-in screen. If you signed up with Google, you can always sign in with Google.
Open: none
Source: Settings copy “To change it, use Forgot your password? when you sign in.”

### acc-emails · How do I change which emails I get?
In Settings, under Email me when: a new order, a receipt uploaded, someone leaving their number, a question asked 3 times, and your plan ending. New orders and leads still show in the dashboard with the emails off.
Open: /app/settings
Source: apps/web/app/app/settings/notify-emails.tsx; Settings board

### acc-dark · Is there a dark mode?
Yes, the moon button in the top bar switches the dashboard to dark.
Open: none
Source: apps/web/app/app/dark-mode.test.ts; app-frame

### acc-delete · How do I delete my account?
Email support@curios.my from your account’s email address and we will delete it. It removes your login and your page.
Open: none
Source: devDocs/admin-design.md (Delete account is an admin action; no owner self-delete exists)

### acc-suspended · My page was taken down.
The Curios team takes a page down when it breaks the rules, for example after reports of a scam. Contact support to find out why and what to do. Customers who already ordered can still see their order.
Open: none
Source: devDocs/admin-design.md (Suspended); Alerts copy “The Curios team has taken your page down. Contact support to find out why.”

### acc-data · Who owns my customers’ data?
You do: you are the controller of the leads and orders your page collects. Customers agree to be contacted when they leave their number. Delete what you no longer need.
Open: none
Source: devDocs/README.md (PDPA)
