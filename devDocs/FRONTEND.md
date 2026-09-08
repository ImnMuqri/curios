# FRONTEND.md

> Intended path: `apps/web/FRONTEND.md`

Two audiences that share zero mental models.
**Visitors** are strangers on 4G who did not choose to be here. **Owners** are shop
people, not operators. Build them as two different products in one codebase.

---

## Routes

```
/[handle]                 public page          SSR, edge, cached
/[handle]/faq             question index       static, revalidate 24h
/[handle]/faq/[slug]      single answer        static, revalidate 24h
/app                      dashboard shell      client, authed
/app/onboarding           paste a URL, wait, review facts
/app/knowledge            facts, pinned answers, never-say list
/app/links                the boring part that pays the rent
/app/leads                table + transcript drawer
/app/questions            top asked, unanswered, answer-writeback
/app/appearance           theme, avatar, badge
/app/billing               plan, usage against cap
```

**One flat namespace.** `curios.my/nadia` is the URL for a person and for a bakery
alike, and it never changes shape on upgrade. Mode is a property of the page, so this
one route renders both and the difference is in what the page shows, not where it
lives.

**Personal pages are `noindex` by default.** A privacy default, not an SEO setting:
most people do not want an AI page about themselves ranking for their own name. The
toggle lives in Appearance, off until they turn it on. Business pages index by default
and emit `FAQPage` structured data.

**Handles are a reserved namespace.** Claim-time validation rejects app, api, faq,
admin, about, pricing, help, support, blog, login, signup, settings, static, plus
profanity and trademark blocks. Publishing is gated on phone OTP only, so a page can
go live in two minutes. Verification is separate: a bio code for personal pages, an
SSM document upload for business pages. It earns the badge and nothing else: an
unverified Pro page keeps every feature, including lead capture. The badge renders the
registration number and registered name, never a bare tick. Upload sits in
`/app/appearance`, not in the payment flow, and states plainly that the file is
deleted after checking.

---

## Rendering

**Public page is the product's reputation.** Server render the shell, links, and the
FAQ content into real DOM. Hydrate chat on top. If JS fails, the page is still a
working link list with readable answers. That fallback is also the SEO artifact and
the over-cap degraded state, so it is one build serving three jobs.

Budget. *Amended by slice 3, which measured this for the first time and found the
original sentence could not be true.*

**As enforced:** the public route's own chunk stays under **40KB**, asserted in
`apps/web/app/[handle]/budget.test.ts` against the manifest Next emits after a build. It
is 7.2KB today. That is the number this codebase moves when someone adds a dependency or
statically imports something meant to be lazy.

**Originally written:** *"under 40KB JS before chat opens"*, and it said "enforced in CI"
from the day it was written, when nothing measured it at all. First Load JS for
`/[handle]` is 105KB, of which 102KB is the shared React and Next runtime. React alone is
roughly 50KB gzipped, so no amount of care in this codebase brings first load under 40KB
while React is in the page. The budget was unmeetable, not merely unmet.

**LCP under 1.5s on a Moto G** stays the target and is not machine-checked. Nothing here
measures it, and claiming otherwise is what got the line above rewritten.

Chat bundle loads on first interaction with the ask bar, never before. *Also not yet true:*
the sheet is behind a `next/dynamic` import that does not currently produce a separate
chunk, because `AskBar` is imported from the same `@curios/ui` barrel and webpack has
nothing left to defer. It costs about 4KB of a 7KB chunk. See the comment in
`apps/web/app/[handle]/ask.tsx`, which says so rather than describing a split that does
not happen.

---

## The ask bar

The signature component. Read DESIGN.md before touching it.

States: `idle` (cycling a real question from this page's facts) → `focused` →
`sheet-open` → `thinking` → `answering` (streamed) → `capture` (conditional).

Rules:
- It never presents an empty prompt with no suggestion. This is the founding
  constraint: the visitor should never have to invent the question.
- Chips come from the knowledge base at build time, not from a model call on page load.
- The sheet covers roughly 74% of the viewport. Links stay visible behind it. The AI
  pushes people back to links, it does not replace them.
- Answers can render a `LinkCard`. That is the whole point.

---

## Capture card

Renders inside the message stream only when the API returns `intent.qualified = true`.
The client never decides this. One field: phone. Everything else is extracted server
side from the transcript.

Carries a consent line in the visitor's language, above the field, not hidden in a
tooltip. It names who receives the number: the owner, not us.

If it fires on someone who only asked about opening hours, that is a backend bug and
it gets filed as one.

---

## Dashboard rules

1. **No blank prompt boxes.** Anywhere. Every input is a control with a fixed set of
   answers, except the two places a human writes real prose: a pinned answer, and a
   fact correction.
2. **One primary action per screen.** Questions has "Answer this". Leads has "WhatsApp
   them". Everything else is secondary.
3. **Empty states are instructions, not moods.** "No leads yet. Share your link and
   they will land here." Not "Nothing to see!"
4. **Numbers link to their source.** Every count is clickable through to the rows
   behind it. An unverifiable metric on a dashboard is decoration.

---

## Onboarding

One field. A URL or an `@handle`. Then a progress view while the worker runs, then a
review screen.

The review screen is the highest leverage surface in the product. Facts arrive as
editable cards, each with its source line. The owner accepts, edits, or deletes.
Never auto-publish an unreviewed price. Getting a price wrong in public is the single
failure that loses a customer permanently.

Poll the job: the ingest request returns 202 with a job id, and the review screen
polls that id until the job resolves. Nothing generative ever blocks an HTTP request.

---

## State

- Server state: TanStack Query. No global store for it.
- Chat session: local reducer, one `useReducer` per sheet instance.
- Auth: httpOnly cookie. The API issues and refreshes it; middleware only
  redirects. `apps/web` holds a SELECT-only connection and cannot write, so it
  cannot extend a session even if it wanted to.
- No client state library. If you reach for one, the dashboard has gotten too clever.

---

## i18n

Malay and English at minimum, Mandarin later. Interface strings live in
`packages/core/i18n`. The public page defaults to the owner's chosen language, but
**the AI always answers in the language it was asked in**, including Manglish and
rojak. That behaviour lives in the prompt, not in a locale switch.

Never machine-translate owner-written content. If Nadia wrote it in Malay, it ships
in Malay.

---

## Accessibility floor

Keyboard reachable ask bar, focus trap in the sheet, escape closes, visible focus
rings, `prefers-reduced-motion` respected, chat announces new messages politely.
Not negotiable and not a phase two.
