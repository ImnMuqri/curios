# Manual verification — getting paid

**Status: NOT RUN.** Written at the end of slice 9's plan 1. **Plan 1 is not done until checks 1–4
below have been run against the Billplz sandbox and recorded at the bottom of this file.**

Re-run it after any change to `packages/billing`, `apps/api/src/modules/billing`, or
`apps/workers/src/billing`, and before any real Billplz key goes into an environment.

## What CI proves, and what still needs a person

Every test named below was checked to exist, by name, before this table was written. **No** means
tests that run on every change prove the check. **Partly** means the logic underneath is proven, but
not the thing a person would actually see. **Yes** means only Billplz itself can confirm it.

| # | Check | Proven by | Still needs a person |
|---|---|---|---|
| 1 | Paying monthly on a business page lands on Billplz's bill for RM39.00 | `billing.routes.test.ts` — 'raises a bill for the owner's page, bound to a new pending payment'; `pay-buttons.test.tsx` — 'raises a bill for the plan pressed, and sends the browser to it' | **Partly** — the real Billplz bill page |
| 2 | The sandbox payment's callback verifies and grants | `signature.test.ts` — 'accepts a correctly signed callback'; `billing.routes.test.ts` — 'grants a signed, paid callback sent as a form' | **Yes** — only a real Billplz signature proves we verify the way Billplz signs |
| 3 | The redirect verifies and shows the paid banner | `signature.test.ts` — 'verifies a correctly signed redirect'; `billing.routes.test.ts` — 'fetches the bill, grants it, and sends the owner back to the paid banner'; `page.test.tsx` — 'shows the banner the API redirected back with' | **Yes** — same reason, and the redirect's key format is the docs' claim, not a tested one |
| 4 | The payment is granted once, extending `paidUntil` by a calendar month | `grant.test.ts` — 'grants a paid bill: the payment is paid and paidUntil moves a month from now'; 'grants once when the same bill arrives twice at once' | **Partly** — the rows after a real payment |
| 5 | A failed sandbox payment shows the failed banner and grants nothing | `billing.routes.test.ts` — 'sends a signed but unpaid redirect to the failed banner, without fetching' | **Partly** |
| 6 | A paid bill whose callback never arrived is granted by the hourly check | `pending-check.test.ts` — 'grants a payment whose callbacks never arrived' | **Partly** — the real schedule firing |
| 7 | A personal page is offered nothing to pay | `page.test.tsx` — 'offers nothing to pay for on a personal page'; `billing.routes.test.ts` — 'refuses a personal page, and raises no bill' | **No** |

## Before you start

1. **A Billplz sandbox account** at `https://www.billplz-sandbox.com`. From its settings: the API
   Secret Key, and the X Signature Key (turn X Signature on if it is off). Create a collection and
   note its id.
2. **A tunnel to the API**, so the sandbox can reach the callback:

   ```bash
   cloudflared tunnel --url http://localhost:3001
   ```

   Note the `https://....trycloudflare.com` address it prints.
3. **Your `.env`:**

   ```bash
   BILLPLZ_API_KEY=<sandbox secret key>
   BILLPLZ_COLLECTION_ID=<collection id>
   BILLPLZ_X_SIGNATURE_KEY=<sandbox X Signature key>
   BILLPLZ_BASE_URL=https://www.billplz-sandbox.com
   BILLPLZ_CALLBACK_URL=https://<tunnel address>/billing/billplz/callback
   BILLPLZ_REDIRECT_URL=http://localhost:3001/billing/billplz/return
   ```

   The redirect stays on `localhost`: it is the browser that follows it, and the browser is on your
   machine.
4. **Everything running** — `docker compose up -d`, then the API, the web app and the workers, each
   in its own terminal. The API and the workers refuse to start if a Billplz value is missing.
5. **A signed-in owner with a business page**, whose `paidUntil` you know:

   ```bash
   docker exec -i curios-postgres psql -U curios -d curios -c \
     "SELECT handle, mode, \"paidUntil\" FROM \"Page\" WHERE handle = 'YOURHANDLE';"
   ```

## The checks

### 1. Paying lands on Billplz's bill

On `http://localhost:3000/app/billing`, press **Pay RM39 for a month**. The browser must arrive at a
`billplz-sandbox.com` bill showing **RM39.00**, the page's display name, and a description of
`Curios Business, 1 month — <display name>`.

### 2. The callback verifies and grants

Pay with the sandbox's test bank and choose success. In the API's log, look for
`billplz bill handled` with `source: "callback"` and `outcome: "granted"` — or `already-granted` if the
redirect happened to arrive first.

**If the log says `billplz signature did not verify` with `source: "callback"`, stop.** Every genuine
payment would be refused. Record the failure; do not change the signature code to make it pass.

### 3. The redirect verifies and shows the paid banner

After paying, the browser must land on `/app/billing?payment=paid` with **Payment received. Your plan
is active.** In the API's log, there must be no `billplz signature did not verify` with
`source: "redirect"`.

**If the callback verified but the redirect did not,** suspect `paid_at` first. Billplz sends it like
`2026-09-14 15:15:09 +0800`. If Billplz puts a literal `+` in the query string rather than `%2B`, the
query parser reads it as a space, and the signature will not match. Record the raw redirect URL from
the browser's address bar; do not guess at a fix.

**If the browser lands on `pending` and the log says `billplz bill could not be confirmed`,** read the
error. `does not recognise` means Billplz's bill JSON is not the shape `client.ts` expects — `amount`
as a string, say. Record the response.

### 4. Granted exactly once

```bash
docker exec -i curios-postgres psql -U curios -d curios -c \
  "SELECT p.status, p.\"amountCents\", p.\"paidAt\", p.\"grantedUntil\", g.\"paidUntil\" FROM \"Payment\" p JOIN \"Page\" g ON g.id = p.\"pageId\" WHERE g.handle = 'YOURHANDLE' ORDER BY p.\"createdAt\" DESC LIMIT 3;"
```

The newest row must be `PAID`, `3900`, with `grantedUntil` equal to the page's `paidUntil` — and that
`paidUntil` exactly one calendar month after whichever was later: the moment of payment, or the
`paidUntil` you noted before starting. Both the callback and the redirect ran; the value moved once.

### 5. A failed payment grants nothing

Press **Pay RM39 for a month** again, and this time choose failure in the sandbox bank. The browser
must land on `/app/billing?payment=failed`, and the query from check 4 must show the new row still
`PENDING`, with `paidUntil` unchanged.

### 6. The hourly check grants what the callback and redirect never did

Make both deliveries fail: set `BILLPLZ_CALLBACK_URL` back to `http://localhost:3001/...`, which the
sandbox cannot reach, and `BILLPLZ_REDIRECT_URL` to `http://localhost:3000/app/billing`, which grants
nothing. Restart the API. Pay successfully. The row stays `PENDING`.

Age it past the check's two-hour floor:

```bash
docker exec -i curios-postgres psql -U curios -d curios -c \
  "UPDATE \"Payment\" SET \"createdAt\" = now() - interval '3 hours' WHERE status = 'PENDING' AND \"billplzBillId\" IS NOT NULL AND \"pageId\" = (SELECT id FROM \"Page\" WHERE handle = 'YOURHANDLE');"
```

With the workers running, wait for the top of the hour. The workers' log must show
`pending payment granted by the hourly check`, and the query from check 4 must show the row `PAID`.
Put both URLs back afterwards.

### 7. A personal page is offered nothing

Covered by CI. Worth a glance if you have a personal page to hand: `/app/billing` says there is nothing
to pay for, and shows no buttons.

## Recording the result

Add a line per run, newest first. Plan 1 is done when a run records checks 1–4 as passing.

| Date | Who | Checks passed | Checks failed, and what was seen |
|---|---|---|---|
