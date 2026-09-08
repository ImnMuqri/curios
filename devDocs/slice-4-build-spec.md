# Slice 4 — Lead capture, and the message that pays for it

> Intended path: `devDocs/slice-4-build-spec.md`

Slice 1 built a page that answers. Slice 2 made the owner real. Slice 3 made both look
like a product. None of them capture anything, which means the product currently gives a
shop owner a better FAQ and no reason to pay.

This slice closes the v1 definition of done from `README.md`:

> An owner pastes an Instagram handle, fixes three wrong facts, shares the link,
> **and receives a WhatsApp message containing a phone number and a transcript.**

Everything before the bold clause already works. This slice is the clause.

---

## What is in, what is out

| In | Out (and where it goes) |
|---|---|
| Multi-turn conversations: API, gateway, and the sheet | Web push — a subsystem, and not needed for the done condition |
| Server-side qualification, returned as `intent.qualified` | `/app/leads` table and transcript drawer (slice 5) |
| `Lead`, `CaptureCard`, E.164 Malaysian validation | Link-tap signals — nothing tracks taps today |
| Slot extraction at capture time, in a queued job | 12-month retention cron; owner-facing delete |
| Email notification: transcript plus a prefilled `wa.me` link | WhatsApp Cloud API — named in BACKEND.md as not a launch dependency |

---

## The prerequisite nobody listed

**There are no multi-turn conversations.** `POST /chat/:handle` accepts `{ question }` and
`answer()` creates a fresh `Conversation` on every call. It returns a `conversationId` on
the `done` event that nothing ever sends back, and the sheet slice 3 shipped asks its seed
question and offers no way to ask another.

This is invisible in the roadmap and load-bearing for everything here. BACKEND.md's lead
design assumes threads throughout: the signals include `turn_3`, capture is deduped *"one
capture attempt per conversation"*, and the notification's whole selling point is that the
owner *"opens WhatsApp already knowing what they want"* — the transcript. With
single-exchange conversations there is no transcript, and turn count is always one.

So conversations become real first, in plan 1. It ships nothing a visitor would name, which
is the same shape as slice 2's first plan and the same justification: it is the half of a
slice that the visible half requires.

### The invariant that becomes load-bearing

`chat.service.ts` carries this comment on its `UsageCounter` upsert:

> *The meter counts conversations, not messages, so a chatty visitor costs the owner one
> unit.*

That is true today **by accident**, because every call creates a conversation. The moment
threads are real it becomes a rule someone has to keep: the counter increments when a
conversation is created and never when one is appended to. Miss it and a talkative visitor
costs the owner a unit per question, on the one meter the paid plan is priced against.

---

## Qualification

### Why the server decides, and why no model call

BACKEND.md specifies an intent block returned by the model alongside the answer, carrying
`slots`, `signals` and a `confidence`. **That is not what this slice builds**, and
BACKEND.md's section is amended rather than quietly contradicted.

Three reasons, in the order they matter:

**Cost lands on the wrong side.** `README.md` makes the asymmetry the margin — Haiku for
chat, Opus for ingestion — and inference is a cost of acquisition. A per-turn intent block
taxes every turn of every conversation, including the overwhelming majority that are
someone checking whether the shop opens on Sunday. Slot extraction at capture time spends
model tokens only where a lead already exists.

**A streamed structured block can leak into the answer.** Getting JSON out of a streaming
text response means a sentinel and a tail buffer, and the failure mode is a visitor
watching `<intent>{"qualified"` type itself out mid-sentence. Leaving the answer path
untouched removes the possibility rather than managing it.

**Conservatism is the requirement, and code is where it can be enforced.** BACKEND.md:
*"Be conservative. An inflated lead count is how you lose trust in every other number you
show."* A deterministic rule is unit-testable without a network, tunable in one place, and
answerable when an owner asks why something became a lead. A `confidence: 0.81` is none of
those three.

**The contract the frontend depends on does not change.** FRONTEND.md says the capture card
renders only when *"the API returns `intent.qualified = true`"* and that *"the client never
decides this."* Both still hold. Only the source of the boolean moves — and BACKEND.md
already said *"server decides capture."*

### What actually qualifies

All of these, or no card:

1. The page is `BUSINESS`. Personal pages have capture off, per BACKEND.md's plan matrix.
2. The conversation has reached **three or more visitor turns**.
3. At least one of the visitor's own messages carries a **specificity marker** — a quantity,
   a number, or a date-shaped token. This is BACKEND.md's `own_specifics`, computed from
   what the visitor typed rather than inferred by a model.

### The signal that could not be used, and why

The obvious fourth rule is *"a cited fact was `PRICE` or `PRODUCT`"*. It cannot be used,
because `Message.citedFactIds` does not mean what its name says: `chat.service.ts` writes

```ts
citedFactIds: facts.map((f) => f.id)
```

— **every verified fact on the page**, on every message. The column is a placeholder that
reads like data. Nothing depends on it today, so nothing is broken, but any future feature
that trusts the name will be wrong, and this slice records that rather than discovering it
twice. Real citation tracking needs the model to name what it used, which reopens exactly
the structured-output problem this slice avoided; it belongs with whichever slice wants it.

---

## The lead

`Lead` carries the phone, the slots, a score, and a status. `conversationId` is unique:
BACKEND.md's *"one capture attempt per conversation"* is an index, not a check someone
remembers to write.

**Score is how many slots are filled, not a model opinion.** Straight from BACKEND.md, and
worth preserving precisely because it is unglamorous: a number an owner can verify by
looking beats a number they have to trust.

### Guards

- **E.164 Malaysian validation**, in `packages/core` beside `handle.ts`, where the other
  format rule with a test table already lives. `013-xxx xxxx`, `6013…`, `+6013…` and
  `013xxxxxxx` all normalise to one stored form; anything else is refused.
- **One capture per conversation** — the unique index above.
- **Dedupe by number per page per 24 hours**, which cannot be an index because it has a
  time window, so it is a query and it is tested.

### Slots, and why they are a job

Extracting `{product, date, location}` needs a model call, and nothing generative runs
inside an HTTP request in this codebase. `POST /leads` writes the row and returns; a queued
job extracts the slots, updates the row, and enqueues the mail.

This ordering also means the notification is never sent before the slots exist, so the
owner never receives a second email correcting the first.

---

## The notification

Email, to the account that owns the page. It carries the transcript and a
`wa.me/60XXXXXXXXX?text=…` link with the reply already typed. One tap opens WhatsApp.

The mail queue already exists from slice 2 and takes `{ to, subject, text }`, so this is one
more enqueued job rather than a new delivery path.

Web push is deferred. BACKEND.md names it alongside email, and it would get the lead to an
owner in seconds rather than whenever they next check mail — which matters, because a lead
goes cold. It is deferred anyway: VAPID keys, a service worker, subscription storage,
permission UX and a silent-failure mode on iOS unless the page is installed, none of which
the done condition requires.

---

## PDPA, and what is honestly missing

**In this slice:**

- A consent line on the capture card, above the field, naming who receives the number: the
  page owner, not us. Not in a tooltip.
- **Phone numbers never reach application logs.** BACKEND.md asks for this explicitly, and
  it is easy to violate accidentally by logging a request body.

**Not in this slice, and named so nobody assumes otherwise:**

- 12-month retention with hard delete by cron.
- The owner-facing delete endpoint per lead and per page. It has no screen to live on until
  `/app/leads` arrives in slice 5, and an endpoint with no caller is a claim rather than a
  control.

Both are obligations, not features. They are due before volume, not before this slice
compiles — the same posture BACKEND.md takes on getting the terms reviewed.

---

## Testing, and its limits

Testable, and tested:

- The qualification rule as a table: turn counts either side of the threshold, a page in
  each mode, messages with and without a specificity marker. It is a pure function and it
  should be tested like one.
- Phone normalisation across the four Malaysian spellings, and refusal of everything else.
- The dedupe window: same number, same page, 23 hours later, refused; 25 hours later,
  accepted.
- One capture per conversation, asserted against the database rather than the handler.
- The usage meter incrementing once across a three-turn conversation. This is the invariant
  that a passing suite would otherwise let rot.
- The notification's content: the transcript is present, and the `wa.me` link carries the
  number in the form WhatsApp expects.

**Not covered:** whether the qualification rule fires on real conversations at a rate an
owner finds useful. That needs traffic, and the honest answer is that the first tuning pass
happens after real visitors, using the Questions dashboard slice 5 builds. Shipping a rule
that under-captures is the intended failure direction.

---

## Two plans

1. **Conversations become real.** The API's `conversationId`, the gateway's `messages[]`,
   the usage-meter invariant, and the sheet's thread and composer.
2. **Capture.** Qualification, `Lead`, the capture card, phone validation, slot extraction,
   and the notification.

---

## Documents corrected by this slice

| Document | Correction |
|---|---|
| `BACKEND.md` | The intent block section: rewritten to describe server-side qualification with capture-time slots, keeping the original design and the reason it was traded away |
| `BACKEND.md` | A note that `Message.citedFactIds` currently stores every verified fact, not the cited ones |
| `FRONTEND.md` | Unchanged, deliberately: `intent.qualified` still comes from the API and the client still never decides it |
