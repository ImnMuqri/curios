# Manual verification — the Google round trip

The one path in slice 2 that no test and no agent can cover. It needs real Google credentials and
a real browser following a real redirect chain. Everything *around* it is tested; the round trip
itself is unproven until someone does this.

Run it again after any change to `auth.routes.ts`'s callback, `oauth.service.ts`, or the settings
screen.

## What CI proves, and what still needs a person

The round trip through Google is still unproven end to end, for the reason given in the next
section. Most of what this walkthrough asks a person to look at along the way, though, is not.
Every test named below was checked to exist, by name, before this table was written. **No**
means tests that run on every change prove the check. **Partly** means the logic underneath is
proven, but not the thing a person would actually see. **Yes** means only your machine or real
Google can confirm it.

| # | Check | Proven by | Still needs a person |
|---|---|---|---|
| 1 | Ports 3000 and 3001 are free before starting | — | **Yes** — a property of your machine |
| 2 | Connect Google reaches Google's real consent screen | — | **Yes** — real Google |
| 3 | Path 1 lands exactly on `/app/settings?linked=google` | `link.test.ts` — 'attaches the identity to the account already signed in' | **No** |
| 4 | Path 1 shows "Google is now connected to your account." | `settings/page.test.tsx` — 'after linking, says Google is connected and offers neither form' | **No** |
| 5 | Path 1: the Connect Google link disappears | `settings/page.test.tsx` — the same test, and 'before linking, offers the Connect Google link and says nothing about it' | **No** |
| 6 | Path 1 with both methods shows the both-methods sentence and no form | `settings/page.test.tsx` — 'after linking, says Google is connected and offers neither form' | **No** |
| 7 | Path 1 writes exactly one new `AuthIdentity` row | `link.test.ts` — 'attaches the identity to the account already signed in' | **No** |
| 8 | Path 1 clears the one-time cookies | `oauth.routes.test.ts` — 'signs in and issues a session when the state matches' | **No** |
| 9 | Path 2 lands exactly on `/signin?cancelled=1` | `oauth.routes.test.ts` — 'sends someone who cancelled at Google back to the app, not to raw JSON' | **No** |
| 10 | Path 2 shows the cancelled message | `signin-form.test.tsx` — 'tells someone why they were sent here when they cancelled at Google' | **No** |
| 11 | Path 2 is not on port 3001 and not a JSON body | `oauth.routes.test.ts` — 'sends someone who cancelled at Google back to the app, not to raw JSON' | **No** |
| 12 | Path 3 lands exactly on `?error=identity_taken` | `link.test.ts` — 'refuses to move an identity that already belongs to another account' | **No** |
| 13 | Path 3 shows the already-connected message | `oauth-errors.test.ts` — 'explains an already-linked identity using the API sentence'; `settings.test.ts` — 'explains an already-linked identity using the shared table, not an invented one' | **Partly** — the message and the banner decision are proven, but the rendered banner only for the session-ended code in row 17, through the same `Callout` |
| 14 | Path 3 leaves the identity with the first account | `link.test.ts` — 'refuses to move an identity that already belongs to another account' | **No** |
| 15 | Path 4 lands on `?error=unauthenticated` and creates nothing | `link.test.ts` — 'creates no account and links nothing when the link cookie arrives without a session' | **No** |
| 16 | Path 4 may show the sign-in page instead of the message | `layout.test.tsx` — 'refuses a session the database does not recognise, before asking for a page' | **No** |
| 17 | Path 4 shows the session-ended message | `settings/page.test.tsx` — 'paints the session-ended message when a link attempt outlived its session' | **No** |
| 18 | Every callback failure is logged before the redirect | — | **Recorded as a finding** — a malformed callback takes the cancel branch and logs nothing; see `deferred-findings.md` |

Fourteen of the eighteen need no person, one is proven underneath but not rendered, two need
your machine or real Google, and one turned out not to be true.

## What still needs a person, and why

The callback's correctness depends on things only a browser does: following a 302 to an external
origin, carrying `SameSite=Lax` cookies back on a top-level navigation, and returning a `code` that
Google will actually exchange. A test can stub the exchange — and does — but stubbing it is exactly
what leaves this gap.

## Before you start

You need `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `GOOGLE_REDIRECT_URI` set in `.env`, and
the redirect URI registered in the Google Cloud console for that client. `GOOGLE_REDIRECT_URI` must
be the **API** origin — `http://localhost:3001/auth/google/callback` — not the web app's.

```bash
# All three, in separate terminals from the repo root.
pnpm --filter @curios/api dev        # 3001
pnpm --filter @curios/web dev        # 3000
docker compose up -d                 # postgres, redis and mailpit, if not already up
```

Check nothing is already holding those ports — an orphaned dev server from an earlier session will
answer instead, and you will be testing old code without knowing it:

```bash
netstat -ano | grep -E ":(3000|3001)\s.*LISTENING"
```

---

## Path 1 — the happy path

**Setup.** You need an account that has a password and no Google identity. Sign up at
`http://localhost:3000/signup`, then confirm the email via Mailpit at `http://localhost:8075` and
click through the verification link. (8075 is the host port; `docker-compose.yml` maps it to
Mailpit's internal 8025, and nothing listens on 8025 from outside the container.)

1. Go to `http://localhost:3000/app/settings`.
2. Confirm you see **"Signed in as \<your address\>"** and a **Connect Google** link, and **no**
   "Add a password" form — that account already has one.
3. Click Connect Google. You should be taken to Google's own consent screen, on
   `accounts.google.com`.
4. Complete it.

**What must be true when you land:**

- The URL is `http://localhost:3000/app/settings?linked=google` — the **web** origin, port 3000.
  If you are looking at anything on `localhost:3001`, the callback threw and the redirect did not
  happen; that is the failure mode this whole flow was rebuilt to prevent.
- The page says **"Google is now connected to your account."**
- The **Connect Google** link is gone.
- Because the account now has both methods, you should see neither form and instead: *"You can
  already sign in with your password or with Google."*

**Then check the database, because the screen is not the proof:**

```bash
docker exec -i curios-postgres psql -U curios -d curios -c \
  "SELECT a.email, i.provider, i.\"providerUserId\", i.email AS identity_email
     FROM \"AuthIdentity\" i JOIN \"Account\" a ON a.id = i.\"accountId\"
     ORDER BY i.\"createdAt\" DESC LIMIT 5;"
```

Exactly one new row, `provider = GOOGLE`, attached to **your** account, with Google's `sub` in
`providerUserId`. A screen that says "connected" while no row exists is the failure worth catching.

**And confirm the one-time cookies were spent** — they are cleared on every path out of the
callback, so after landing there must be no `curios_oauth_state`, `curios_oauth_verifier` or
`curios_oauth_link` cookie left for `localhost`. Check in the browser's devtools under
Application → Cookies. A surviving state cookie is reusable for the rest of its ten minutes.

## Path 2 — cancelling

1. Sign out, go to `http://localhost:3000/signin`, and start a Google **sign-in** (not a link).
2. On Google's screen, click **Cancel** / **Back** rather than approving.

**Must land on** `http://localhost:3000/signin?cancelled=1`, showing *"Sign-in was cancelled. Try
again when you are ready."* — and **not** on any `localhost:3001` URL, and not on a JSON body.

## Path 3 — the takeover refusal, which is the one that matters

This is the path with a real security consequence, and it is worth the five minutes.

1. Create a **second** account with a password (a different email), and sign in as it.
2. Go to `/app/settings` and click Connect Google.
3. Complete the flow with **the same Google account you already linked in Path 1.**

**Must land on** `http://localhost:3000/app/settings?error=identity_taken`, showing *"That Google
account is already connected to another Curios account."*

**Then re-run the SQL above.** The row must still point at the **first** account. If the identity
moved to the second account, a Google identity can be taken off someone else's account — and note
that the screen would still be showing you the correct error message while that happened. There is
now an automated test for exactly this, but confirm it here too: the automated one stubs the
exchange.

## Path 4 — a session that dies mid-flow

1. Sign in, go to `/app/settings`, and click Connect Google.
2. While Google's consent screen is open, delete the `curios_session` cookie in devtools.
3. Complete the consent.

**Must land on** `http://localhost:3000/app/settings?error=unauthenticated`, showing *"Your session
ended before the connection finished. Sign in and try again."* Since you are no longer signed in,
the `/app` layout will bounce you to `/signin` — that is correct, and it means you may see the
sign-in page rather than the message. What must be true is that **no new `AuthIdentity` row was
created**, because a link intent with no session must never quietly become a signup. Check with the
SQL above.

---

## Recording the result

Note in the plan's ledger which paths you ran and what you saw. If a path fails, the server-side
detail is in the API's log — every failure out of the callback is logged at error level before the
redirect, so the log has the real error even though the browser only ever sees a code in a query
string.
