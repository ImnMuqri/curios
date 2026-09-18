# Manual verification — the free personal tier

**Status: NOT RUN.** Written at the end of slice 10. Running it is recommended, not a gate:
nothing in this slice's correctness depends on a third party. It exists because one thing only a
real request can tell us — what a social profile actually returns to our crawler.

Re-run it after any change to `apps/workers/src/sources`, to onboarding, or to the crawler's user
agent.

## What CI proves, and what still needs a person

Every test named below was checked to exist, by name, before this table was written.

| # | Check | Proven by | Still needs a person |
|---|---|---|---|
| 1 | Claiming a personal page | `page.routes.test.ts` — 'claims a personal page when the owner asks for one'; `claim-form.test.tsx` — 'sends the tier the owner chose' | **Partly** — the form as an owner sees it |
| 2 | A social profile URL | `website.adapter.test.ts` — 'reads the meta tags when the body has almost nothing'; `extract.service.test.ts` — 'makes no model call when there is nothing to read'; `ingest-form.test.tsx` — 'goes back to the paste box when the link gave us nothing' | **Yes** — only a real request shows what Instagram, TikTok and Linktree return to `CuriosBot` today |
| 3 | Pasted text becomes facts | `ingest.service.test.ts` — 'starts an ingestion from pasted text, with no website address anywhere'; `extract.service.test.ts` — 'reads pasted text from the row when the job has no website address' | **Partly** — whether a short bio yields facts worth publishing |
| 4 | Opting into search | `indexing.test.ts` — 'indexes a personal page whose owner opted in'; `page.test.tsx` under `app/[handle]` — 'lets a personal page that opted in be indexed'; `search-indexing.test.tsx` — 'sends the owner’s choice, and shows it straight away' | **Partly** — the robots tag in a real page's source |
| 5 | The upgrade | `page.routes.test.ts` — 'makes a personal page a business page'; `upgrade-button.test.tsx` — 'asks before switching, and says it cannot be undone' | **Partly** |
| 6 | Honest screens for a personal page | `leads/page.test.tsx` — 'tells a personal page why it has no leads, and where that changes'; `billing/page.test.tsx` — 'offers a personal page the upgrade, and says what changes'; `question-list.test.tsx` — 'tells a personal owner their answer is not published anywhere'; `questions/page.test.tsx` — 'tells the list a personal page publishes no FAQ pages' | **No** |

## Before you start

Everything running — `docker compose up -d`, then the API, the web app and the workers. A fresh
account with no page yet.

## The checks

### 1. Claim a personal page

On `/app/onboarding`, confirm neither tier is selected, and that pressing **Claim** without one
says to choose. Choose **Personal**, claim a handle, and confirm:

```bash
docker exec -i curios-postgres psql -U curios -d curios -c \
  "SELECT handle, mode, \"allowSearchIndexing\" FROM \"Page\" WHERE handle = 'YOURHANDLE';"
```

Expect `PERSONAL` and `f`.

### 2. Give it a social profile

Paste an Instagram profile URL, then a TikTok profile, then a Linktree page. For each, record in
the table below what happened: facts found, zero facts with the paste box offered, or a failure
and its message. For any that found nothing, look at what the crawler actually received:

```bash
curl -sA 'CuriosBot/0.1 (+https://curios.my/bot)' 'THE_URL' | head -c 2000
```

A login wall, a 403, or a page with `og:` tags but no body text are all expected; say which.

### 3. Paste text

Choose **Paste text instead**, paste a short bio, and confirm the facts on `/app/review` came from
it — the quoted line under each fact, and no Source link.

### 4. Search results

In Settings, confirm the switch reads off. View the public page's source and find
`<meta name="robots" content="noindex, nofollow">`. Turn the switch on, reload the source, and
confirm the tag is gone.

### 5. Upgrade

On `/app/billing`, press **Make this a business page**, read the warning, press **Keep it
personal**, and confirm nothing changed. Press it again and confirm. The page is now business:
the plan summary shows the free trial, and the query from check 1 shows `BUSINESS`.

### 6. The other screens

Before upgrading, glance at Leads and Questions: Leads explains why there are no leads, and the
answer box on Questions does not mention `/faq`.

## Recording the result

Add a line per run, newest first. For check 2, record each URL tried and what came back.

| Date | Who | Checks passed | What social URLs returned | Checks failed, and what was seen |
|---|---|---|---|---|
