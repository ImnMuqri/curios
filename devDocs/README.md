# Curios

> A curio shop is a room of objects you have to ask about. That is the page.
> Intended path: repo root `README.md`

A link-in-bio page that answers questions. The visitor gets the links they came for.
The owner stops answering "berapa harga" forty times a day.

**Free tier:** anyone gets a page with an AI that knows them.
**Paid tier:** a business gets lead capture, notifications, and a dashboard of what customers keep asking.
The free tier is distribution. The paid tier is the company.

---

## The one rule

The AI is never the paywall. Answering is free forever, on every plan.
What a business pays for is **knowing who asked**: capture, transcripts, notifications, FAQ pages, branding removal.

Corollary for engineering: inference cost is a cost of acquisition, not a billable unit.
Design every quota around that.

---

## Layout

```
curios/
├── apps/
│   ├── web/          Next.js. Public pages + owner dashboard.   → FRONTEND.md
│   └── api/          Fastify. HTTP only, never generates.       → BACKEND.md
├── workers/          BullMQ. Ingestion, lead extraction, email. → BACKEND.md
├── packages/
│   ├── db/           Prisma schema + client
│   ├── core/         Shared types, zod schemas, plan limits
│   └── ui/           Design system components                   → DESIGN.md
└── DESIGN.md         Tokens, direction, and the banned list
```

pnpm workspaces, turbo, Node 22. Three apps and three packages. `api` and `workers` are
separate processes sharing `db` and `core`, and they never import each other.

---

## Stack

| Layer | Choice | Note |
|---|---|---|
| Web | Next.js (App Router) | public pages SSR, dashboard client |
| API | Fastify + zod | returns 202 and enqueues, never blocks on a model |
| Jobs | BullMQ + Redis | ingestion, lead extraction, email |
| DB | Postgres + Prisma | facts are rows; their vectors are bytes in a column, and there is still no vector database (see BACKEND.md) |
| Files | Cloudflare R2 | avatars, OG images, scraped assets |
| Pay | Billplz | one-off bills only — recurring is card-tokenised and in beta, and FPX cannot auto-charge. See Settled decisions. |
| Models | Haiku for chat, Opus for ingestion | the asymmetry is the margin |

---

## Build order

Non-negotiable: **business first, personal second.** The personal page is the business
page with features switched off. Build it the other way and you will design a schema
around personality and then rewrite it for catalogs, hours, and prices.

1. Ingest a URL into reviewable facts
2. Public page: links, chips, ask sheet
3. Chat that cites its facts and refuses to invent prices
4. Lead capture + click-to-chat notification (email with a prefilled `wa.me` link)
5. Questions dashboard with answer-writeback
6. FAQ generation (Next ISR, 60s revalidation, not a static build)
7. Billing and caps
8. Free personal tier (a config flag, not a project)

All eight are built, the last in slice 10 — see `slice-10-build-spec.md`.

---

## Settled decisions

| Question | Decision |
|---|---|
| Chat runtime | Node on Fastify with SSE. Not edge, Prisma needs the pool. |
| Handles | Reserved list + first come, and verification required for paid pages. |
| Notifications | Click-to-chat `wa.me` link at launch. Cloud API later, not a dependency. |
| PDPA | Consent on the card, owner is controller, 12 month retention, delete endpoint. |
| Impersonation | Bio code for personal, SSM document upload for business. Badge only, gates no features. |
| Prompt quality | Mechanical golden-set assertions, run on demand by `pnpm goldens` rather than in CI — there is no CI, and a stochastic suite would spend tokens on every push. Eighty questions across four fixture pages, the fourth big enough to exercise retrieval; a refusal is asserted by absence and the language check is advisory. Model-graded tone waits for the voice slice, where it has no mechanical alternative. See slice-11-build-spec.md and slice-12-build-spec.md. |
| Fact retrieval | Each fact stores the question it answers, that question is embedded once, and a visitor's question is matched against it — the closest few facts go to the model, bounded by a character budget. Every failure sends every fact instead: a page under 25 verified facts, a missing or stale vector, a provider failure or a best match under the floor. Prompt caching is on only in that fallback, because caching does not pay on a small shop's traffic — Haiku will not cache a prefix under 4,096 tokens and an entry expires in five minutes. The fact `id` is no longer sent; nothing ever read it. See slice-12-build-spec.md. |
| Sources | Static facts vs live connectors, kept separate. See BACKEND.md. |
| Namespace | One flat `/handle` for both modes. Mode is a column, URLs never change shape. |
| Personal privacy | `noindex` by default on personal pages, opt-in only, from a switch in Settings. `shouldIndex` in `@curios/core` is the one statement of the rule. |
| Owner auth | Google, or email and password — both since slice 2. Phone OTP publishing gate deferred, not shipped. See slice-2-build-spec.md. |
| Admin auth | Its own table, its own login, its own cookie. Shares nothing with owner auth. See ADMIN.md. |
| Billing rails | Verified 2026-09-12, not assumed. Billplz recurring exists only as card tokenisation (`Agreements`, beta, billed as Auto-Deduct at 2% + RM0.75), and Billplz offers no FPX e-Mandate. FPX itself cannot auto-charge — every payment needs the payer to authenticate. So there is no auto-renew on the rail this market actually uses. |
| Plans | Monthly and annual, both as a one-off FPX bill. Monthly is renewed by hand; there is no mandate to lapse and no beta to depend on. Annual is one bill a year, and at 0.75–1.25% against Auto-Deduct's flat RM0.75+ component it is several times cheaper per subscriber-year at these ticket sizes. |
| Tiers | Chosen when the handle is claimed — personal or business, with neither pre-selected. A personal page can become a business page once, from Billing; there is no way back, because business to personal would need rules for paid time, captured leads and indexed FAQ pages that nothing needs. A personal owner with no website pastes text instead of a link. See slice-10-build-spec.md. |
| Granting paid time | One step, three callers. Billplz's callback and the browser's redirect both verify an X Signature and go through `grantPayment` (`packages/billing/src/grant.ts`), which binds the bill to the `Payment` row it was raised for, claims that row `PENDING → PAID` with a conditional update, and locks the page before extending `paidUntil`. An hourly check asks Billplz about payments still pending, because Billplz gives up after five callback attempts. Two arrivals for one bill grant once; two payments for one page both count. |
| Free trial | Three leads, then capture stops — not a time trial. A clock can expire having produced nothing, which teaches an owner the product does not work and spends the model budget proving it; a lead trial ends only once it demonstrably has. A lapse withdraws capture and nothing else: FAQ pages stay generated and indexed, chat keeps answering, the cap stays at 200. Withdrawing indexed URLs an owner earned is a punishment that outlives the lapse. `FREE_LEADS` in `packages/core/src/plan.ts`. The trial is spendable by anyone, the owner's own testing included, so the leads screen shows how much is left and the owner can reset it once, on `/app/billing`, while the page has never paid. A page that paid and lapsed owes a renewal instead. `OPERATIONS.md` keeps the `psql` reset for every other case. |
| Price | Business is RM49/month or RM490/year — two months free. Personal stays free. Anchored on one extra customer a month, not on cost: the product's own fixture prices a cake at RM95, so a single order covers it. *Amended 2026-10-16:* it was RM39, chosen because RM49 needs better than ~52% margin on that RM95 order for "one order pays for it" to hold; the owner moved to RM49 with the design handoff, so the landing's claim now reads "One RM95 order pays for it" and leans on that margin. |
| The page's look | Owner-arranged in My Curios: a bento of links in the shopfront arrangement, sizes automatic until chosen, Soft or High contrast, one accent colour (presets or custom, text colour computed for contrast), six curated heading fonts, an optional picture in R2/S3. No fact list on the page; facts reach visitors through the ask bar and the FAQ pages. See slice-13-build-spec.md. |
| Store | Business pages list items (one price or priced options) and open a shop at /handle/shop. Customers pay the owner directly by DuitNow QR or bank transfer — Curios never holds the money. Slice 17 sends the basket by WhatsApp; slice 18 adds orders. See store-design.md. |

---

## Definition of done for v1

An owner pastes an Instagram handle, fixes three wrong facts, shares the link,
and receives a WhatsApp message containing a phone number and a transcript.
Everything else is decoration until that works.
