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
--ink        #10231F   near-black with green in it. text, dark surfaces.
--paper      #FAFBFA   cool white. never cream.
--surface    #EFF2F0   cards, resting links.
--hijau      #0C7A62   primary. actions, the ask bar, the owner's voice.
--mint       #E3F5EF   hijau at 8%. quiet emphasis.
--kuning     #F2A33C   lead capture, unanswered questions. money and attention only.
--merah      #D8452F   destructive and errors. nothing else.
--muted      #6B7C7F   secondary text. minimum size 12px.
```

Two accents, and each owns exactly one job. `kuning` means *a human needs to act*.
If it shows up anywhere decorative, delete it.

Owner themes change the accent hue only. Structure, type, and spacing never change.
Ten thousand pages that look related is a brand. Ten thousand pages that look like
anything is a theme picker.

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
- 1.5px `hijau` border. Solid, not a shadow. It should read like a stamped field on a
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

---

## Components worth naming

| Component | Job |
|---|---|
| `AskBar` | the signature. see above. |
| `LinkRow` | 44px min target, label left, arrow right. boring on purpose. |
| `Chip` | generated question. `lead` variant uses mint, one per page maximum. |
| `AnswerBubble` | streams, can contain a `LinkCard`. |
| `LinkCard` | how chat returns people to the links. |
| `CaptureCard` | kuning. one input. never more than one input. business mode only. |
| `FactCard` | claim, source line, accept/edit/delete. onboarding lives or dies here. |
| `GapCard` | unanswered question plus one button. the dashboard's whole point. |

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
