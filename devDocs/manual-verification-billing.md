# Manual verification — getting paid

**Status: RUN against CHIP test mode on 2026-10-26, all but checks 2 and 11** (see the record at the
bottom). Check 2 needs the webhook registered in CHIP's portal and a public tunnel; check 11 needs a
declining test card. Both are still for a person with access to the CHIP portal.

Re-run it after any change to `packages/billing`, `apps/api/src/modules/billing`, or
`apps/workers/src/billing`, and before any live CHIP key goes into an environment.

## What CI proves, and what still needs a person

**No** means tests that run on every change prove the check. **Partly** means the logic underneath is
proven, but not the thing a person would actually see. **Yes** means only CHIP itself can confirm it.

| # | Check | Still needs a person |
|---|---|---|
| 1 | Paying monthly on a business page lands on CHIP's checkout for RM49.00 | **Partly** — the real CHIP page |
| 2 | The webhook and callback verify CHIP's signature and grant | **Yes** — only a real CHIP signature proves we verify the way CHIP signs |
| 3 | The return redirect confirms the purchase with CHIP and shows the paid banner | **Partly** |
| 4 | The payment is granted once, extending `paidUntil` by a calendar month | **Partly** — the rows after a real payment |
| 5 | A failed payment shows the failed banner and grants nothing | **Partly** |
| 6 | A paid purchase whose messages never arrived is granted by the hourly check | **Partly** — the real schedule firing |
| 7 | A personal page is offered nothing to pay for | **No** |
| 8 | The renewal reminder reaches the owner's inbox three days out, and says what will happen | **Yes** — only a real mail run proves an email arrives |
| 9 | The owner can reset a spent trial once, and only before they have ever paid | **Partly** |
| 10 | Ticking the auto-renew box keeps the card, and the next period is charged by the job | **Yes** — needs recurring payments enabled on the CHIP account |
| 11 | A failed renewal retries daily for 3 days, then turns auto-renew off and emails the owner | **Partly** |
| 12 | The owner turns auto-renew off on Billing, and nothing is charged afterwards | **Partly** |

## Before you start

1. **A CHIP test account.** From its portal, Developers: the test secret key and the Brand ID. A
   test key never moves real money. In test mode FPX is simulated, and these cards work with CVC
   `123` and any future expiry: `4444 3333 2222 1111` and `5555 5555 5555 4444`.
2. **A tunnel to the API on port 443**, so CHIP can reach the callback and webhook. CHIP refuses a
   callback address with a port, so `localhost:3001` cannot be used directly:

   ```bash
   cloudflared tunnel --url http://localhost:3001
   ```

   Note the `https://....trycloudflare.com` address it prints.
3. **Register the webhook** in CHIP's portal: events `purchase.paid` and `purchase.payment_failure`,
   URL `https://<tunnel address>/billing/chip/webhook`. Copy the public key CHIP shows for it.
4. **Your `.env`:**

   ```bash
   CHIP_SECRET_KEY=<test secret key>
   CHIP_BRAND_ID=<brand id>
   CHIP_BASE_URL=https://gate.chip-in.asia/api/v1
   CHIP_CALLBACK_BASE_URL=https://<tunnel address>
   CHIP_WEBHOOK_PUBLIC_KEY=<the webhook's public key>
   ```

   The return redirect is sent by CHIP to the same base URL, so the tunnel carries it too.
5. **Everything running** — `docker compose up -d`, then the API, the web app and the workers, each
   in its own terminal. The API and the workers refuse to start if a CHIP value is half set.
6. **A signed-in owner with a business page**, whose `paidUntil` you know:

   ```bash
   docker exec -i curios-postgres psql -U curios -d curios -c \
     "SELECT handle, mode, \"paidUntil\" FROM \"Page\" WHERE handle = 'YOURHANDLE';"
   ```

## The checks

### 1. Paying lands on CHIP's checkout

On `/app/billing`, press **Pay RM49 for a month**, leave the auto-renew box unticked and press
**Continue to CHIP**. The browser must arrive at a CHIP checkout showing **RM49.00** and
`Curios Business, 1 month — <display name>`, offering FPX, card and e-wallet.

### 2. The webhook verifies and grants

Pay with a test card above, or FPX and choose success. In the API's log, look for
`chip purchase handled` with `source: "webhook"` (or `"callback"`) and `outcome: "granted"` — or
`already-granted` if the return redirect arrived first.

**If the log says `chip message refused: bad signature`, stop.** Every genuine payment would be
refused. Check `CHIP_WEBHOOK_PUBLIC_KEY` is the key of the webhook you registered, then record the
failure; do not change the signature code to make it pass.

### 3. The return redirect shows the paid banner

After paying, the browser must land on `/app/billing?payment=paid` with the paid banner. The API's
log shows `chip purchase handled` with `source: "return"`. If the page lands on `pending` and the log
says `chip purchase could not be confirmed`, read the error and record CHIP's response.

### 4. Granted exactly once

```bash
docker exec -i curios-postgres psql -U curios -d curios -c \
  "SELECT p.provider, p.status, p.\"amountCents\", p.\"paidAt\", p.\"grantedUntil\", g.\"paidUntil\" FROM \"Payment\" p JOIN \"Page\" g ON g.id = p.\"pageId\" WHERE g.handle = 'YOURHANDLE' ORDER BY p.\"createdAt\" DESC LIMIT 3;"
```

The newest row must be `CHIP`, `PAID`, `4900`, with `grantedUntil` equal to the page's `paidUntil` —
exactly one calendar month after whichever was later: the moment of payment, or the `paidUntil` you
noted before starting. Both the webhook and the redirect ran; the value moved once.

### 5. A failed payment grants nothing

Pay again and this time fail the payment at CHIP. The browser must land on
`/app/billing?payment=failed`, and the query from check 4 must show the new row not `PAID`, with
`paidUntil` unchanged.

### 6. The hourly check grants what the messages never did

Make both deliveries fail: point `CHIP_CALLBACK_BASE_URL` at `http://localhost:3001` (CHIP's
callback cannot reach it), and remove or pause the webhook in CHIP's portal for this check. Restart
the API. Pay successfully, then close the tab before the redirect. The row stays `PENDING`. Age it
past the check's two-hour floor:

```bash
docker exec -i curios-postgres psql -U curios -d curios -c \
  "UPDATE \"Payment\" SET \"createdAt\" = now() - interval '3 hours' WHERE status = 'PENDING' AND \"providerRef\" IS NOT NULL AND provider = 'CHIP' AND \"pageId\" = (SELECT id FROM \"Page\" WHERE handle = 'YOURHANDLE');"
```

With the workers running, wait for the top of the hour. The workers' log must show
`pending payment granted by the hourly check`, and the query from check 4 must show the row `PAID`.
Put the settings and the webhook back afterwards.

### 7. A personal page is offered nothing

Covered by CI. Worth a glance if you have a personal page to hand: `/app/billing` says there is
nothing to pay for, and shows no buttons.

### 8. The renewal reminder

The schedule fires at 10:00 Malaysian time, so run the job against a page you have set up:

```bash
docker exec -i curios-postgres psql -U curios -d curios -c \
  "UPDATE \"Page\" SET \"paidUntil\" = now() + interval '2 days', \"renewalReminderFor\" = NULL WHERE handle = 'YOURHANDLE';"
```

With the workers running, wait for the next 10:00, or restart them after setting the schedule's
pattern to `'* * * * *'` locally — and put it back afterwards. In the workers' log, look for
`renewal reminder queued` with that page's id, and in Mailpit (`http://localhost:8075`) for a
message whose subject names the shop and the end date.

For a page **without** auto-renew the email must **not** say anything will be charged. For a page with
auto-renew on (check 10) it must say the card will be charged. Either mismatch fails this check.

Run the job a second time without changing anything. No second email may appear.

### 9. The trial reset, once

On a business page that has never paid, capture a lead (or set `"leadsCaptured" = 3` directly), then
open `/app/billing`. Press **Reset my free trial**. The count returns to zero on the leads screen.
Press it again — the button should be gone. A direct second call must answer 409 `TRIAL_RESET_USED`.

### 10. Auto-renew keeps the card, and the job charges it

Pay RM49 for a month with **Renew automatically by card** ticked. CHIP's page must offer card only.
Back on Billing, the auto-renew block shows the saved card. Then bring the plan to its end:

```bash
docker exec -i curios-postgres psql -U curios -d curios -c \
  "UPDATE \"Page\" SET \"paidUntil\" = now() + interval '12 hours' WHERE handle = 'YOURHANDLE';"
```

Once the workers' auto-renew job runs (it charges on the Kuala Lumpur day the plan ends, never the day before, and may charge until 3 days after; a card no run tried is still charged up to 7 days late, see BACKEND.md), the log shows
`renewal granted`, a new `Payment` row with `autoRenewal = true` is `PAID`, and `paidUntil` moved a
month. **If the log shows a charge failure instead, check that recurring card payments are enabled on
the CHIP account**; without that CHIP refuses the token charge.

### 11. A failed renewal retries, then stops

With auto-renew on, make the saved card's charge fail (CHIP's test mode has a declining test card, or
revoke the token from CHIP's portal) and set `paidUntil` to the past. The log shows
`renewal charge failed` once a day. After 3 days (age the attempts in the database to hurry it),
auto-renew turns off and the owner's "auto-renew is off" email reaches Mailpit.

### 12. Turning auto-renew off

On Billing turn auto-renew off. The block changes to off, the API log shows
`auto-renew turned off by owner`, and the saved card is dropped. Set `paidUntil` to the next 12 hours
as in check 10: no charge must follow, and the reminder email must no longer promise one.

## Recording the result

Add a line per run, newest first.

| Date | Who | Checks passed | Checks failed, and what was seen |
|---|---|---|---|
| 2026-10-26 | Claude (agent), CHIP test keys, no tunnel; checkout driven in headless Chrome, jobs run by hand with `now` moved | 1, 3, 4, 5, 6, 7*, 8, 9*, 10, 12 | None failed. **Not run:** 2 (webhook: needs it registered in the portal and a tunnel on 443; the callback is skipped without one) and 11 (needs a declining test card). Seen: RM49.00 on CHIP's page; "Test Success" granted once from the return (`outcome: granted`), a replayed return said `already-granted` and changed nothing; `paidUntil` moved one calendar month; "Test Failure" left the payment unpaid and CHIP's status `error` (the failed banner); a paid purchase with its return blocked was granted by the hourly check run 3 hours ahead, and the failed one marked EXPIRED; the reminder reached Mailpit 3 days out saying nothing is charged; auto-renew on a card page offered card only with "Remember my card", kept "Visa ending 1111", and the job charged it on the last day (a second run that day charged nothing); turning it off dropped the card and the next period's run charged nothing. *7 and 9 rest on their tests. The test account does keep cards, so recurring payments are on in test; **confirm the live account has them too.** |

### Shops paying through their own CHIP account (2026-10-26, same run)

Not a numbered check above; recorded here because no other walkthrough covers it. The seeded page
connected the same test key in Store → Payment (`connected: true`, the RM1 key check passed, methods
read, key stored sealed); a voucher item (`kind: DIGITAL`, `delivery: CODES`) was ordered with an email;
`POST /store/orders/<token>/pay` with FPX and Maybank returned CHIP's page, test mode completed it, the
browser came back to the order page reading "Dibayar · Dihantar ke e-mel anda" with "RM10 melalui FPX"
and CHIP's reference, the order was `PAID` via `CHIP`, and the buyer's email in Mailpit carried the
code. Found on the way and fixed: a shop selling only digital items could not open without pickup or
delivery (`storeGaps`).
