# Slice 10 — The free personal tier

> Intended path: `devDocs/slice-10-build-spec.md`

README's build order ends with "free personal tier (a config flag, not a project)". Most of the
flag already exists. Every gate in the product reads `Page.mode`: a personal page never offers the
capture card (`canCapture`), never qualifies a visitor (`qualifies`), never generates FAQ pages
(`qualifiesForFaq`, `getFaqIndex`), is refused by billing (`NOT_A_BUSINESS_PAGE`), is skipped by
the renewal reminder, and renders `noindex`.

What does not exist is any way to *be* personal. `claimHandle` never sets `mode`, the column
defaults to `BUSINESS`, and personal pages appear only in test fixtures. Behind that gap sits a
second one: onboarding assumes a website. Every fact comes from crawling a URL, and a person whose
presence is an Instagram profile — which the crawler cannot read — would finish onboarding with an
empty page.

This slice makes the free tier real: an owner chooses personal when they claim a handle, can get
facts onto the page without a website, sees a dashboard that tells the truth about a personal page,
can opt into search engines, and can upgrade to business when they start selling.

One spec, one plan. Nothing here depends on a third party behaving.

---

## What is in, what is out

| In | Out |
|---|---|
| Choosing personal or business when claiming a handle | Bio-code verification — its own slice; the badge gates nothing |
| A one-way upgrade, personal to business | Going back from business to personal |
| Pasting text as an ingestion source | Writing facts by hand |
| Reading `og:` and meta tags when a page's body is thin | Real social ingestion — a headless browser or platform APIs |
| An owner's opt-in to search indexing | An Appearance screen |
| Honest copy for personal pages on Leads, Billing and Questions | Hiding nav items by mode |
| | Learning how the owner writes, so the page sounds like them — its own slice, next |

**Voice is out, and deliberately next.** Capturing how an owner texts and feeding it to the chat
prompt touches every answer on every page, has to coexist with the never-invent-prices rule, and
needs the quality harness to prove tone without becoming a taste test. It deserves its own spec.

---

## Settled before this slice, and not reopened

- **Business first, personal second** — README's build order. The personal page is the business
  page with features switched off; nothing here adds a personal-only feature.
- **What mode changes** — BACKEND.md's table: capture never, FAQ pages never, `noindex` by default,
  no billing. This slice adds no new difference between the tiers.
- **The trial rule does not change.** `canCapture` and `planState` are untouched.
- **Personal privacy** — README: `noindex` by default, opt-in only. This slice builds the opt-in; it
  does not change the default.

---

## Data

On `Page`:

```prisma
  /// Whether a personal page may appear in search results. Off by default: most
  /// people do not want an AI page about themselves ranking for their own name.
  /// Business pages are always indexed, so this is read only for personal pages.
  allowSearchIndexing Boolean @default(false)
```

`mode` already exists (`PERSONAL | BUSINESS`, default `BUSINESS`). Claiming now sets it.

On `Ingestion`:

```prisma
  /// The page crawled. Null when the owner pasted text instead.
  sourceUrl      String?
  /// What the owner pasted. Null when a URL was crawled.
  sourceText     String?
```

**Exactly one of the two is set**, enforced by a `CHECK` constraint written by hand into the
migration — Prisma cannot express it, and a row with both or neither would leave the worker with
nothing to decide on:

```sql
ALTER TABLE "Ingestion" ADD CONSTRAINT "Ingestion_one_source"
  CHECK (("sourceUrl" IS NULL) <> ("sourceText" IS NULL));
```

`Fact.sourceUrl` is already nullable. A fact extracted from pasted text has none.

In `@curios/core`:

```ts
export function shouldIndex(input: {
  mode: 'PERSONAL' | 'BUSINESS';
  allowSearchIndexing: boolean;
}): boolean;
```

`true` for every business page, and for a personal page only when it has opted in. The public
page's metadata calls this rather than restating the rule, for `canCapture`'s reason: two
expressions of one rule are how a page and a test end up disagreeing about it.

`SourceDocument.url` becomes `string | null`, and `IngestJobData.sourceUrl` becomes optional.

---

## API

**`POST /pages` — claim.** The body gains `mode: 'PERSONAL' | 'BUSINESS'`, defaulting to
`BUSINESS` — the column's own default — so existing callers keep working. The onboarding form
always sends it.

**`POST /pages/upgrade`** — personal to business, behind the session guard. One conditional
update, `where: { accountId, mode: 'PERSONAL' }`. A page that is already business succeeds without
change: there is nothing to refuse, and a second click must not produce an error. An owner with no
page gets the existing `NoPageError` (`NO_PAGE`, 404).

What the upgrade gives the page, with no further writes:

- **The full trial.** A personal page never captures, so `leadsCaptured` is still 0: three free
  leads, then RM39 a month. The one-time trial reset stays available, because `trialResetAt` is
  still null.
- **FAQ pages**, from the next question that qualifies. Questions asked while the page was personal
  count toward the three asks.
- **Search indexing.** Business pages are always indexed, whatever `allowSearchIndexing` holds.

There is no route back. Going from business to personal would need rules for paid time, captured
leads and indexed FAQ pages that nothing needs yet.

**`PATCH /pages/search-indexing`** with `{ allow: boolean }` — sets the column, behind the session
guard. Accepted for any page; the column's meaning is "if this page is personal, index it", so a
business page setting it changes nothing a visitor or a crawler sees.

**`POST /ingest`** accepts either `{ pageId, sourceUrl }` or `{ pageId, sourceText }`, never both
and never neither — refused as a validation error before anything is written. `sourceText` is
capped at **20,000 characters**. The SSRF host guard runs only for URLs; there is no host to guard
for pasted text. The per-page ingest limiter applies to both, because pasted text still costs a
model call.

---

## Onboarding and the crawler

**The claim form** offers two choices, neither pre-selected, and will not submit until one is
picked:

- **Personal** — "About you. Free. Hidden from search engines unless you choose otherwise."
- **Business** — "For selling. Three free leads, then RM39 a month."

No pre-selection on purpose: nobody should land in a tier by default and find out later.

**The ingest form** gains "Paste text instead" — a text box for a bio, captions, an About section,
with a live count against the cap. The URL field's hint adapts to the tier; a personal owner reads
"A link to your site, Linktree or profile — or paste a few paragraphs about yourself."

**Job status with nothing found.** Today it says "Found 0 facts." and stops. When an ingestion
extracts nothing, it says we could not read anything useful from that page and offers the paste
box. This is where most social profile URLs will land, so it must not be a dead end.

**The og/meta fallback.** `extractText` in `apps/workers/src/sources/website.adapter.ts` reads the
`<title>` and the `<body>` text today and ignores `<meta>` entirely. It gains a fallback: when the
body text is under **200 characters**, it also reads `og:title`, `og:description` and
`<meta name="description">`. Fallback only, so every existing business crawl and its tests are
unaffected.

**The honest limit.** Instagram and TikTok render their content in JavaScript and commonly serve a
login wall — or refuse outright — to an unfamiliar bot, and the crawler identifies itself as
`CuriosBot/0.1`. When a platform refuses, even the meta tags are unreachable, and the paste box is
the answer. The walkthrough records what real profile URLs return; this spec does not promise it.

**The text path in the worker.** When a job has no URL, the worker reads `sourceText` from the
`Ingestion` row — the text lives in one place, and the Redis payload stays small. A new
`apps/workers/src/sources/text.adapter.ts` turns it into one `SourceDocument` with no URL.
Everything after — extraction, fact writing, Review — is unchanged, except that facts from a
null-URL document are written with a null `sourceUrl`, and Review shows them as "From text you
pasted".

---

## What a personal owner sees

The nav keeps all five screens. Each tells the truth about a personal page.

**Leads** — instead of an empty list: "Personal pages don't collect phone numbers. Visitors can
still chat with your page. If you start selling, you can make this a business page from Billing",
linking to Billing.

**Billing carries the upgrade.** Under "Personal pages are free", a section headed "Selling
something?" says exactly what changes: the capture card appears, with three free leads and then
RM39 a month; questions asked three or more times get their own FAQ pages; and **the page will
appear in search results**. The button is a two-step confirm — "Make this a business page", then
"Yes, switch — this can't be undone". It is one-way and it ends the privacy default, so one click
must not do it.

**Questions** — the answer form's hint depends on mode. Today it tells every owner that saving
"publishes the question and your answer at /faq, where search engines can find them", which is
false for a personal page. A personal page reads: "Saving this lets your page answer the question
the way you wrote it."

**Settings** gains "Search engines". A personal page gets one switch, "Show my page in search
results", off by default, under a sentence saying why it starts off. A business page gets one line:
business pages always appear in search. BACKEND.md places this in an Appearance screen that does
not exist; one switch does not justify a screen, so it lives in Settings and the document is
corrected.

**The public page** sends `noindex` exactly when `shouldIndex` says not to. There is no sitemap, so
the meta tag is the whole of the control. Nothing else a visitor sees changes.

---

## Failure modes, in one place

| What happens | Result |
|---|---|
| A social site blocks `CuriosBot`, or serves a login wall | Zero facts; job status offers the paste box |
| A page's body is thin but its meta tags are rich | The fallback reads them; facts go to Review |
| The owner pastes both a URL and text | 400 before anything is written |
| A row somehow has both sources, or neither | The database refuses it (`Ingestion_one_source`) |
| Pasted text over 20,000 characters | 400 |
| Pasted text that tries to steer the model | The same trust as the owner's own website: it is their text about their page, and every extracted fact goes through Review before it appears |
| The upgrade is clicked twice | The second succeeds without change |
| A business page sets `allowSearchIndexing` | Stored; nothing a visitor or crawler sees changes |

---

## Testing, and its limits

Every test below is proven by a mutation that makes it fail, as slices 8 and 9 did. A test that
asserts an absence — "does not render", "is not called" — passes before the code exists, so it
needs a mutation more than any other.

| Layer | What is proven |
|---|---|
| `packages/core` | `shouldIndex` in all four combinations |
| `packages/db` | `allowSearchIndexing` defaults to false; `Ingestion_one_source` refuses both and neither, asserted on SQLSTATE `23514` with raw SQL |
| `apps/api` | Claim sets personal, and defaults to business; upgrade switches personal to business, succeeds without change on business, answers `NO_PAGE` without a page; the indexing switch; ingest accepts text, refuses both, neither and over-cap, and never consults the host guard for text |
| `apps/workers` | The fallback reads meta tags only when the body is thin; the text adapter; the worker picks the adapter from the row; facts from text carry no `sourceUrl` |
| `apps/web` | The claim form requires a choice and sends it; the paste box; job status with zero facts; the leads empty state; the upgrade's two steps; the Questions hint by mode; the Settings switch; the public page's robots tag in each case |

**What no test covers.** What a real Instagram, TikTok or Linktree URL returns to `CuriosBot`
today — only a real request tells us, and the answer changes whenever the platforms do. Whether
extraction from a two-line bio produces anything worth publishing.

---

## Done means

The three workspace gates pass — `pnpm turbo run test --concurrency=1 --force`, and `typecheck` and
`lint` called through turbo with `--force` — and `devDocs/manual-verification-personal-tier.md`
exists **with its "what CI proves, and what still needs a person" table from the start**.

Running the walkthrough is recommended, not a gate. Slice 9's sandbox run was a gate because a
signature check we could not test against Billplz would refuse every genuine payment; nothing in
this slice's correctness depends on a third party.

---

## Documents corrected by this slice

| Document | Correction |
|---|---|
| `README.md` | Build order item 8 marked built. Settled decisions: the tier is chosen at claim, and the upgrade is one-way. The Personal privacy row points at the opt-in in Settings. |
| `BACKEND.md` | The mode table's Indexing row: `noindex` unless the owner opts in. "It is a toggle in Appearance" becomes Settings. The upgrade, and its effect on the trial. Ingestion's two new ways in: pasted text, and the meta-tag fallback. |
| `FRONTEND.md` | Onboarding's tier choice and paste box. The `/app/appearance` line in the screen list, which names a screen that does not exist. The personal-pages paragraph. |
| `manual-verification-personal-tier.md` | New, with its coverage table from the start. |
