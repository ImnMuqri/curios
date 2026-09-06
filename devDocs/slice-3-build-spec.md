# Slice 3 — The design system, and the signature it exists for

> Intended path: `devDocs/slice-3-build-spec.md`

Slice 1 built a page that answers questions. Slice 2 made the owner real. Neither made
anything look like a product: `packages/ui` does not exist, and every screen slice 2
shipped — sign in, sign up, verify, reset, onboarding, review, settings — carries
**zero** `className`. They are raw browser defaults. The public page has a little
styling, borrowed from a 48-line `globals.css` that is currently doing the job of a
design system by accident.

This slice implements `DESIGN.md`, which has been waiting since before slice 1 and is
more specific than most design systems ever get: a palette where two accents each own
exactly one job, a six-step type scale, a motion budget, a banned list, and one
component it tells you not to cut.

`slice-2-build-spec.md` deferred this with a parenthesis — *"Design system —
`packages/ui` (its own slice)"*. This is that slice.

---

## What is in, what is out

| In | Out (and where it goes) |
|---|---|
| `packages/ui`: tokens, fonts, primitives | `CaptureCard` — needs `intent.qualified` (slice 4) |
| The public page: `LinkRow`, `Chip`, `AskBar`, the sheet, `AnswerBubble`, `LinkCard` | `GapCard` — needs the questions dashboard (slice 5) |
| All eight owner screens | Owner accent themes — needs `/app/appearance`, which does not exist |
| `Fact.question`, generated at ingestion, plus a backfill | Dark mode — banned before launch by DESIGN.md, deliberately |
| The accessibility floor from FRONTEND.md | `packages/core/i18n` — see the note below |
| Busy and disabled states on the review actions | `/app/links`, `/app/leads`, `/app/questions`, `/app/knowledge`, `/app/billing` |

### The i18n tension, named rather than skipped

FRONTEND.md says *"Malay and English at minimum"* and puts interface strings in
`packages/core/i18n`. That package does not exist and this slice does not create it.

The reason is not size. It is that DESIGN.md says Malay copy is *"written by a Malay
speaker, not translated"* and that *"if a string sounds like a translation, it is
wrong."* Building the extraction mechanism now means either shipping empty Malay
strings or shipping translated ones, and the second is worse than the delay. What this
slice does instead is write every interface string as a literal in one place per
component, so the later extraction is mechanical rather than archaeological.

Recorded here so that the gap between this spec and FRONTEND.md is a decision and not
an oversight.

---

## The package

```
packages/ui/
├── src/
│   ├── tokens.css          the palette, the scale, the font variables
│   ├── reset.css           box-sizing, margin, the small global floor
│   ├── button/             Button.tsx + Button.module.css
│   ├── ask-bar/            the signature, and the sheet it opens
│   └── …                   one directory per component
└── package.json
```

Tokens move out of `apps/web/app/globals.css`, which stops pretending to be a design
system and keeps only what is genuinely app-level. **The rule DESIGN.md states — never
hardcode a hex in a component — becomes mechanically checkable once every colour has
exactly one home**, and a test checks it.

### CSS Modules, and why not the alternatives

Scoped class names, no runtime, and Server Components work untouched — which is not a
detail here, because the public page is SSR and the review screen is a Server
Component. It also extends the plain-CSS-with-custom-properties approach already in the
repo rather than replacing it.

Tailwind was considered and rejected on one specific ground: this design's rules are
things like *"`kuning` means a human needs to act; if it shows up anywhere decorative,
delete it."* That is enforceable in a stylesheet a reviewer can read top to bottom, and
unenforceable when scattered across `className` strings in fifteen files.

**Cost, stated:** consuming CSS from a workspace package needs
`transpilePackages: ['@curios/ui']` in `next.config.ts`.

### Fonts, and the seam that keeps Next out of the package

Bricolage Grotesque, Inter and IBM Plex Mono load through `next/font/google`, which
self-hosts them at build time. Two reasons, both practical rather than ideological: no
runtime request to Google from a visitor on 4G in Malaysia, and no layout shift.

`packages/ui` declares `--font-display`, `--font-body` and `--font-mono` and uses
nothing else. `apps/web` binds them on `<html>` from next/font's variable output. The
package therefore never imports Next and stays testable in plain vitest.

### The six-step scale

`11 / 12.5 / 14 / 17 / 22 / 32`. DESIGN.md says a seventh is a smell. A test asserts no
`.module.css` declares a `font-size` outside that set, because a rule stated in a
document decays and a rule stated in a test does not.

---

## The question field

DESIGN.md's argument for the ask bar is that it *"demonstrates what it knows before
anyone touches it, and it is different on every single page in the product because it
is generated from that page's data."*

The database cannot currently do that. It stores claims — `"Kek coklat RM45"` — and the
slice-1 AskBar cycles those claims in a slot that asks for questions. A placeholder
reading `Kek coklat RM45` invites a visitor to type a price at it.

**`Fact` gains `question String?`.** Extraction already sends every crawled page to Opus
and parses a line-prefixed block back; a `question:` line joins `category:`,
`confidence:` and `source:`. No additional model call and no additional spend — one
more field in a response already being paid for. The parser treats it as optional, so a
response that omits it yields a fact rather than dropping one.

**Why store rather than derive.** A pure function from category to question template is
cheaper and needs no migration, and it produces the same six questions on every page in
the product with the nouns swapped. That is precisely the property the ask bar exists to
not have. It also matches FRONTEND.md: *"chips come from the knowledge base at build
time, not from a model call on page load."*

**The review screen shows the question.** An owner verifying `RM45` should see the
question a customer will be shown, because that pair is what reaches the public
together.

### The backfill, and why it needs a script

Extraction writes with `skipDuplicates` against `@@unique([pageId, normalizedClaim])`.
A re-crawl therefore does **not** update an existing row, so re-ingesting a page will
not fill in its questions. The ~114 facts already verified would stay null forever.

A one-off script in `scripts/` reads facts with a null question, asks the model for one
per fact in batches, and writes them back. It costs a model call per fact, once.

It is a script that exists to be run once and will confuse someone in six months, so it
says so at the top of the file, in the same place it says which environment variable
points at which database.

---

## The public page

`LinkRow` is 44px minimum and boring on purpose. `Chip` carries a generated question,
with a `lead` variant in `mint`, one per page maximum.

### The ask bar

FRONTEND.md gives the states: `idle` → `focused` → `sheet-open` → `thinking` →
`answering`. (`capture` is slice 4 and is not built here.)

- 1.5px `hijau` border, solid, never a shadow. It should read as a stamped field on a
  form.
- Idle cycles this page's questions, one every 4 seconds, soft vertical wipe.
- **It never presents an empty prompt with no suggestion.** FRONTEND.md calls this the
  founding constraint. With zero questions available — every fact null, a page not yet
  re-ingested — it falls back to a written placeholder rather than an empty box.
- `prefers-reduced-motion` shows one question and stops. Already honoured in the slice-1
  component; it stays honoured.

### The sheet

One orchestrated moment: 260ms spring upward, the dim behind fading over 180ms,
messages arriving with an 8px rise and no stagger beyond 40ms. It covers roughly 74% of
the viewport and the links stay visible behind it, because the AI pushes people back to
the links rather than replacing them.

Everything else in the product gets 120ms colour transitions on press states and
nothing more. No scroll reveals, no parallax, no entrance animations on the dashboard.

`AnswerBubble` streams text as it arrives and can contain a `LinkCard` — which is not a
decoration but the reason the sheet exists. FRONTEND.md: *"answers can render a
`LinkCard`. That is the whole point."* An answer that mentions a product and gives no
way to reach it has returned a visitor to where they started.

### The budget is a design constraint, not a checklist item

FRONTEND.md: **under 40KB JS before chat opens, LCP under 1.5s on a Moto G**, with the
chat bundle loading on first interaction and never before.

This shapes the build rather than auditing it afterwards. The sheet, the streaming
parser and the answer bubbles are behind a dynamic import triggered by first
interaction with the bar. The idle bar itself is close to the only JavaScript on a cold
public page.

The budget is not currently enforced anywhere, and "enforced in CI" has therefore been
untrue since it was written. This slice makes it true the cheap way: a test reads the
route manifest Next already emits into `.next/` after a build, sums the First Load JS
for `/[handle]`, and fails over 40KB. No new tooling, no bundle analyzer, and it fails
on the pull request that adds the weight rather than during a performance review three
months later.

LCP on a Moto G is not measurable this way and is not claimed to be. It stays a manual
check.

---

## The owner surface

`Button`, `Input`, `Field` and `Callout`, then the eight screens. FRONTEND.md's
dashboard rules hold: one primary action per screen, and empty states are instructions
rather than moods.

### The rough edges this slice fixes, listed so the list cannot grow

Restyling a screen means editing the component, and some of what is wrong with these
screens is not visual. Only these, and only because the slice already has the file
open:

1. **The review actions have no busy or disabled state.** Recorded as a known rough
   edge when slice 2's task 6 shipped. An owner can double-click Accept and watch
   nothing happen. `Button` ships with `busy` and `disabled` from the start — a button
   that cannot express *working* is an incomplete button, and it is a state a component
   has to be designed with rather than have bolted on.
2. **Inline styles on the public page move into modules.** `page.tsx` currently carries
   `style={{ … }}` objects with hardcoded values, which the no-hex test would fail.

Anything else found along the way is written down, not fixed.

### The accessibility floor

FRONTEND.md calls it *"not negotiable and not a phase two"*, so it is in this slice and
not the one after: keyboard-reachable ask bar, focus trap in the sheet, escape closes
it, visible focus rings, `prefers-reduced-motion` respected, and new chat messages
announced politely.

Focus rings deserve a specific warning, because removing them is the single most common
way a design system quietly breaks a product. `:focus-visible` is styled to match the
design; it is never set to `none`.

---

## Testing, and what it cannot do

**No test in this slice proves a screen looks right.** Anyone reporting slice 3 "fully
tested" is describing behaviour, not appearance, and the difference matters more here
than in any slice so far.

What is testable, and tested:

- Component behaviour and state: a busy button is disabled and announces itself, `Chip`
  renders its `lead` variant, the sheet traps focus and closes on escape, reduced motion
  stops the cycle.
- The ask bar never renders an empty prompt, including with zero questions available.
- `question:` parsing, including a response that omits it.
- The two mechanical guards DESIGN.md's own rules imply: **no hex literal outside
  `tokens.css`**, and **no `font-size` outside the six-step scale**.
- The JS budget, measured rather than asserted by eye.

What is not covered, stated plainly: whether the shopfront reference actually reads as a
shopfront. That is a judgement, it needs a person looking at a phone, and it belongs in
a manual pass at the end of each plan rather than in a green checkmark.

---

## Two plans

The same seam as slice 2, for the same reason — the halves genuinely depend on each
other but the specification should stay whole.

1. **The system and the signature.** `packages/ui`, tokens, fonts, the reset, the
   `Fact.question` field with its backfill, and the public page including the sheet.
   Ships something a stranger can be shown.
2. **The owner surface.** The primitives, the eight screens, the rough edges above.
   Ships something an owner can stand to use.

---

## Documents corrected by this slice

| Document | Correction |
|---|---|
| `DESIGN.md` | Its header says tokens are implemented in `packages/ui`, which was aspirational until now; the palette comment in `globals.css` stops being the source of truth |
| `FRONTEND.md` | The i18n section gains a note that `packages/core/i18n` is deferred, with the reason |
| `slice-1-build-spec.md` | Its component list said `CaptureCard` and `GapCard` "wait for the slices that use them" — still true, and now dated: slice 4 and slice 5 |
