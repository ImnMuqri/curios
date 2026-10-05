# DESIGN.md

> Intended path: repo root, tokens implemented in `packages/ui`

## The direction: shopfront, not SaaS

Every competitor in link-in-bio looks like a Figma template with rounded corners and a
gradient. Curios lives in a different world: the **Malaysian shopfront**. The laminated
price list taped to the glass. The handwritten "BUKA" sign. The banner outside a kedai
with too much information on it and complete confidence about it. Warm, dense,
unembarrassed, legible from across the street.

That is the reference. Not the aesthetic to copy literally, the *attitude* to steal:
**this is a real business, run by a real person, and here is exactly what you need to
know.**

Practical translation: high contrast, confident type, information stated plainly, no
apologising with whitespace. A page should feel like a person answering, not a brand
communicating.

---

## Palette

```
--ink        #191F2C   near-black with biru in it. text, dark surfaces.
--paper      #FAFBFC   cool white. never cream.
--surface    #F0F1F4   cards, resting links.
--biru       #2340C8   primary. actions, the ask bar, the owner's voice.
--biru-muda  #EAF0FF   biru, pale. quiet emphasis.
--kuning     #F2A33C   lead capture, unanswered questions. money and attention only.
--merah      #D8452F   destructive and errors. nothing else.
--muted      #696E7B   secondary text. minimum size 12px.
```

*Amended 2026-10-03: hijau to biru.* The primary is now biru enamel, the cobalt of old
enamel shop signs and kopitiam cups; green is what every AI-made palette reaches for.
`--biru` is the brand and is never adjusted. Every neutral is derived from it in OKLCH:
the old ramp's lightness and chroma, turned to biru's hue (267), so the greys belong to
the blue. `--muted` sits one step darker than that so it clears 4.5:1 on `--surface`
(the green-era muted did not). Contrast: paper on biru 7.7:1, biru on biru-muda 7.0:1,
ink on kuning 7.9:1. Known short: `--merah` on paper is 4.2:1, so small error text
needs an icon or ink beside it. Hijau stays one of the owner accent presets.

Two accents, and each owns exactly one job. `kuning` means *a human needs to act*.
If it shows up anywhere decorative, delete it.

Owner themes change the accent hue only. Structure, type, and spacing never change.
Ten thousand pages that look related is a brand. Ten thousand pages that look like
anything is a theme picker.

*Amended by slice 13.* An owner also chooses one of two page styles and one of six
curated heading fonts, alongside the accent — see **The two page styles**, below.
Spacing, the six-step type scale and the shopfront layout structure within a style
still never change: a theme changes treatment, not structure.

---

## Type

```
Display   Bricolage Grotesque   600/700, tracking -0.02em
Body      Inter                 400/500/600
Utility   IBM Plex Mono         labels, counts, timestamps, uppercase, 0.13em
```

Bricolage carries a slight sign-painter irregularity in its wider optical sizes, which
is exactly the shopfront reference and is not the face everyone else reaches for.
Use it for the owner's name, page headings, and nothing under 15px.

*Amended by slice 13.* The owner's name and tile labels on the public page now use
whichever of six curated fonts the owner picked (Bricolage remains one; Jakarta, not
Bricolage, is the default a page carries until an owner chooses another) — see **The
two page styles**, below. Bricolage keeps one older job: it is still the sitewide
`--font-display` a stylesheet falls back to if `--font-heading` itself is ever unset,
which is why it alone of the six preloads regardless of which heading font a page
picks. The dashboard's own chrome no longer uses Bricolage at all: it speaks Plus
Jakarta Sans, a deliberate split from the public page's type.

Body is Inter because Malay runs long and Inter stays legible when a caption wraps to
four lines on a small phone. This is a legibility decision, not a taste one.

Mono is the utility voice: counts, "asked 9×", timestamps, section labels. It signals
*this is data* and keeps the dashboard from feeling chatty.

Scale: 11 / 12.5 / 14 / 17 / 22 / 32. Six sizes. Adding a seventh is a smell.

---

## The signature: the ask bar

One component carries the whole product. Everything else stays quiet so this can be
loud.

- Always present, sticky to the bottom of the public page, never scrolls away.
- 1.5px `biru` border. Solid, not a shadow. It should read like a stamped field on a
  form, something you are meant to fill in.
- **Idle state cycles real questions from this page's facts**, one every 4 seconds,
  with a soft vertical wipe. "Berapa harga kek 1kg?" then "Open hari Ahad?" This is
  the risk worth taking: the bar demonstrates what it knows before anyone touches it,
  and it is different on every single page in the product because it is generated from
  that page's data.
- Respects `prefers-reduced-motion` by showing one question and stopping.

If you cut one thing from this document, do not cut this.

---

## Motion

One orchestrated moment: the sheet. 260ms, spring, opening upward with the dim behind
it fading in over 180ms. Messages arrive with an 8px rise and no stagger delay beyond
40ms.

Everything else: 120ms colour transitions on press states, and nothing more.
No scroll reveals. No parallax. No entrance animations on the dashboard. The dashboard
is a tool that a busy person opens at 11pm, and it should be instant, not theatrical.

*Amended by slice 13.* The one orchestrated moment is now entering chat mode, not the
sheet -- and not a layer fading in over the bento either. The bio and the bento grid
fold upward in place: a single-row CSS grid animating its own row track from `1fr` to
`0fr`, fading at the same time, so the page transitions rather than something new
appearing on top of it. Same budget, moved: 260ms, the same spring curve. Messages still
arrive with the 8px rise and no stagger delay beyond 40ms.

*Amended 2026-10-03: the landing page is exempt.* `curios.my/` and `/ms` sell the
product to someone who has never seen it, so the owner allowed them what the product
never gets: a scroll-linked ticker moment, two small scroll reveals (280ms, 12px, once),
and their own 1.25 type scale with display sizes above 32px. Later the same day the
owner also chose a linktr.ee-style layout for it: full-width colour bands built only from
this palette (kuning-100 included, on the section about unanswered questions), Bricolage
at 800, pill buttons, and IBM Plex Sans for its body text. On 2026-10-04 the five
sign-in screens (sign in, sign up, forgot, reset, verify) took the same look, through
`app/_auth/AuthShell.tsx`. The exemption stops at
`app/_landing/` and `app/_auth/`; the dashboard and every public page keep every rule above. Reduced
motion still wins everywhere. See `apps/web/app/_landing/README.md`.

*Amended 2026-10-04: the dashboard joins the landing page's family, quieter.* At the
owner's request the dashboard took the landing page's look without its motion: Bricolage
800 page titles with a one-line lede, IBM Plex Sans for everything read, white cards on a
hairline, pill buttons, sentence-case field labels, and segmented pill switches. It is
set in one place, `app/app/app-frame.module.css`, through `--button-*`, `--field-*`,
`--callout-*` and `--shell-*` hooks that `@curios/ui` components read (their defaults are
the old look, so the public page and anything else outside the frame are unchanged).
This retires the dashboard's Plus Jakarta Sans and its mono uppercase labels; mono stays
for data only (a phone number, a published address). The motion rule above still holds
for the dashboard: no entrance animations. Claiming a page, before any dashboard exists,
uses `AuthShell`, as the next step after sign-up.

*Amended 2026-10-05: colour bands.* The owner found the dashboard too plain, so each
screen's title now sits on a full-width band from the palette, the landing page's
bands, quieter, with the first cards rising over its foot: cobalt for My Curios, Leads
and Add a source, pale blue for Review, Knowledge, Questions and Settings, and ink for
Billing. (Warm was tried on Review and Leads; the owner did not like it, so no band is
warm and kuning keeps to its one job.) Set in `app-frame.tsx` (BANDS) and drawn by `app-frame.module.css`; each
band sets the title and lede colours through Shell's hooks. Flat colour, no gradient.

---

## Components worth naming

| Component | Job |
|---|---|
| `AskBar` | the signature. see above. |
| `BentoPage` / tiles | *replaces `LinkRow`, slice 13.* the shopfront arrangement: an accent lead tile, a warm second, then smalls and wides; sizes automatic until the owner picks one. One renderer for the public page and the editor's live preview, so the two cannot disagree. |
| `Chip` | *retired, slice 13 fix round 2.* generated question. `lead` variant used mint, one per page maximum. Deleted with `Nav` and `LinkRow`, the dashboard's old nav row (both replaced by the shell and the bento grid) once a grep across `apps/` found no import of any of the three left. |
| `AnswerBubble` | streams, can contain a `LinkCard`. |
| `LinkCard` | how chat returns people to the links. |
| `CaptureCard` | kuning. one input. never more than one input. business mode only. |
| `FactCard` | claim, source line, accept/edit/delete. onboarding lives or dies here. |
| `GapCard` | unanswered question plus one button. the dashboard's whole point. |

---

## The two page styles

*Added by slice 13.* Same shopfront arrangement in both; only the treatment differs.

| | Soft (default) | High contrast |
|---|---|---|
| Corner radius | 16px | 14px |
| Depth | a light shadow | none — contrast does the work |
| Tiles | white and pale accent tints | ink, with accent tiles |

**One accent colour per page** — eight curated presets plus a custom picker — paints the
lead tile, the ask bar's emphasis and chat mode's highlights. Text on it is never
the owner's problem: `readableOn(hex)` in `@curios/core` picks black or white ink,
whichever has the higher WCAG contrast ratio against that colour, so no custom colour
can make a page unreadable.

**Six curated heading fonts** — Jakarta (default), Bricolage Grotesque, Fraunces, Space
Grotesk, DM Serif Display, Outfit — apply to the owner's name and tile labels only; body
text stays Inter regardless. Each is declared with `next/font` (`display: swap`); five
of the six set `preload: false`, so a visitor downloads only the face their page
actually uses. Bricolage is the exception — it is the sitewide `--font-display`
default (see the amendment in **Type**, above) and so preloads regardless of which
heading font a page picks.

**The dashboard itself speaks Plus Jakarta Sans**, not Bricolage — a deliberate split
from the public page's type, which keeps this document's own fonts.

---

## Background and cover photo

*Added 2026-10-04.* Two more owner choices on the public page, both in My Curios.

**Background** is one of five bands from the palette, the same ones the landing page
is built from: Paper (the look every page had before), Pale blue (`--biru-muda`), Warm
(`--kuning` at 20% on paper), Cobalt (`--biru`) and Dark (`--ink`). Like the accent,
contrast is never the owner's problem: each band sets the page's own text colours
(`--page-fg`, `--page-soft`), chat mode reads the same roles, and on the two dark
bands High contrast's ink tiles are lifted a step and an accent tile gets a fine edge,
so a cobalt accent on a cobalt page is still a tile.

**Cover photo** is a wide picture at the top of the page: one of six that ship with
Curios (`/covers/*.webp`, from Unsplash, credited in `apps/web/public/covers/CREDITS.md`)
or the owner's own upload (2 MB, cropped to 16:10). It fades into the band behind it
with an alpha mask, not a coloured gradient, and is gone before the name: the name
rides up onto the faded foot, so it always sits on the page colour, never on the
photo. That is where the line on "any gradient behind a headline" falls: nothing
coloured is behind the name, only the page. A cover that fails to load disappears,
like the picture.

---

## The banned list

Delete on sight, no discussion:

- Purple to blue gradients. Any gradient behind a headline.
- Glassmorphism, frosted panels, floating 3D blobs, mesh backgrounds.
- "Supercharge", "Unleash", "Effortlessly", "in seconds", "10x".
- A hero with a big number, a small label, and a gradient accent.
- Emoji used as an icon system anywhere in the dashboard. Owner-chosen link icons are
  fine, that is their voice.
- Cream backgrounds with a high contrast serif and a terracotta accent. It is the
  current default look of AI-generated design and it will date within a year.
- Testimonials from businesses that do not exist yet.
- A robot mascot. This product's personality is the *owner's*, not ours.
- Dark mode before launch. It doubles the surface area and no shop owner asked.

---

## Copy voice

Plain, direct, a bit dry. Sentence case everywhere. Active verbs. The button says what
happens: "Answer this", "WhatsApp them", "Publish page".

Errors explain and instruct, they do not apologise. "That page took too long to load.
Try the Instagram handle instead." Never "Oops! Something went wrong."

Empty states are invitations: "No questions yet. They will show up here once people
start asking."

Malay copy is written by a Malay speaker, not translated. Rojak is fine where a real
person would use it. If a string sounds like a translation, it is wrong.

---

## The mirror test

Before shipping a screen, remove one thing. If the screen still works, it stays
removed. Chanel's rule, and it applies hardest to dashboards, which accumulate
decoration faster than anything else in software.
