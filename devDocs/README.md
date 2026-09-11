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
| DB | Postgres + Prisma | facts are rows, not a vector store (see BACKEND.md) |
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

---

## Settled decisions

| Question | Decision |
|---|---|
| Chat runtime | Node on Fastify with SSE. Not edge, Prisma needs the pool. |
| Handles | Reserved list + first come, and verification required for paid pages. |
| Notifications | Click-to-chat `wa.me` link at launch. Cloud API later, not a dependency. |
| PDPA | Consent on the card, owner is controller, 12 month retention, delete endpoint. |
| Impersonation | Bio code for personal, SSM document upload for business. Badge only, gates no features. |
| Prompt quality | Mechanical golden-set assertions in CI now, model-graded tone later. |
| Sources | Static facts vs live connectors, kept separate. See BACKEND.md. |
| Namespace | One flat `/handle` for both modes. Mode is a column, URLs never change shape. |
| Personal privacy | `noindex` by default on personal pages, opt-in only. |
| Owner auth | Google, or email and password — both since slice 2. Phone OTP publishing gate deferred, not shipped. See slice-2-build-spec.md. |
| Admin auth | Its own table, its own login, its own cookie. Shares nothing with owner auth. See ADMIN.md. |
| Billing rails | Verified 2026-09-12, not assumed. Billplz recurring exists only as card tokenisation (`Agreements`, beta, billed as Auto-Deduct at 2% + RM0.75), and Billplz offers no FPX e-Mandate. FPX itself cannot auto-charge — every payment needs the payer to authenticate. So there is no auto-renew on the rail this market actually uses. |
| Plans | Monthly and annual, both as a one-off FPX bill. Monthly is renewed by hand; there is no mandate to lapse and no beta to depend on. Annual is one bill a year, and at 0.75–1.25% against Auto-Deduct's flat RM0.75+ component it is several times cheaper per subscriber-year at these ticket sizes. |
| Price | Business is RM39/month or RM390/year — two months free. Personal stays free. Anchored on one extra customer a month, not on cost: the product's own fixture prices a cake at RM95, so a single order covers RM39 even at a thin margin, and the claim survives an owner checking it. RM49 was the rounder number and needed better than ~52% margin on that order to stay true, which is a worse trade than RM10. |

---

## Definition of done for v1

An owner pastes an Instagram handle, fixes three wrong facts, shares the link,
and receives a WhatsApp message containing a phone number and a transcript.
Everything else is decoration until that works.
