# Support inbox: design

Written 31 Oct 2026 from a conversation with the owner. It covers two things that ship together:
**a support inbox in the admin app**, where mail sent to support@curios.my is read and answered,
and **Reply-To on every email Curios sends**, so replies reach someone.

Where this says *(builder's call)*, the owner did not decide it; it is the designer's recommendation
and can be changed without asking them again.

Two related projects were agreed in the same conversation and come after this one, each with its
own design: a **help chat for owners** behind the dashboard's Help button (an FAQ written from the
whole Curios system, answered by the AI, with "still stuck? email support@" as its way out), and an
**order chat with the shop owner** (after the existing order lookup in a shop's chat, the customer
can send a message about that order to the shop owner). Neither is in scope here.

---

## Why

support@curios.my is printed on the legal pages, the landing footer, the dashboard's Help and
"Help & support", and the suspended-page alert. Until now nothing in Curios received it. The admin
emails (suspend, report warning) also say "reply to this email", but every email goes out from
hello@curios.my with no Reply-To, so those replies went to an address no one read.

The owner has pointed curios.my's MX at Resend (`receive-apne1.forge.rmta.net`, the only MX record),
so all mail to any @curios.my address now arrives at Resend. Resend stores it and sends an
`email.received` webhook. The owner wants to **see what was sent, including any content of the email
(formatting, pasted images, attachments), and reply from inside the admin app.**

## Goals

- Mail to support@curios.my appears in a new **Support** screen in the admin app, as conversations.
- The admin can read the whole message as sent: the formatted body, inline images and attachments
  (view or download).
- The admin can reply from the admin app. The reply goes from support@curios.my and threads under the
  sender's email in their mail app. Their answer joins the same conversation.
- The sender is matched to an owner account when their address matches one, with a link to that page.
- Every email Curios sends has a Reply-To that a person reads (below).

## Non-goals

- Importing mail Resend received before launch. The inbox **starts empty**; anything earlier stays
  readable in Resend's dashboard (Emails → Receiving). The owner decided this.
- Mail to any address other than support@. It is not stored or shown (see "Other addresses").
- Notifications of new mail (no email, push or Slack alert). The count in the sidebar is all, for now.
- Rich replies: no formatting toolbar, no attachments from the admin. Plain text only.
- Assigning conversations to admins, canned replies, tags, SLAs. There is one admin today.
- Customers (shoppers) as a support audience. Customers reach shops, not Curios (see Reply-To).

## Anti-goals (what would make this a failure even if it works)

- **A hostile email that runs in the admin app.** Email HTML from outside must never execute script
  or reach the admin origin's cookies or API. It is rendered sandboxed, with no scripts.
- **Tracking pixels firing on open.** Remote images stay blocked until the admin chooses to show them.
- **Faked mail.** Only requests signed by Resend are accepted; anyone else posting to the webhook
  must not be able to put messages in the inbox.
- **Losing mail.** A webhook that arrives while the database or Resend's API is down must still land
  later, not be dropped.
- **A reply that goes to the wrong person,** or that silently does not send.

---

## The Support screen

Layout **A**, which the owner chose from mockups: the list and the conversation side by side, like an
email app.

- **Where:** a new **Support** item in the admin sidebar, in the **Run** group next to Reports. Its
  count is the number of **Open** conversations, hidden at 0, like the other counts.
- **List (left):** search by sender or subject; filters **Open** (default), **Done**, **All**, and
  **Spam** *(builder's call, see Spam)*. Each row: sender (the owner's name and page if matched,
  otherwise the address), subject, time of the latest message, a paperclip with the attachment count,
  and an unread marker. Newest activity first.
- **Conversation (right):** the subject; the **owner card** if matched (page handle, plan, paid
  until, a link to that page on the Pages screen); then every message in order, theirs on one side
  and the admin's replies on the other, each with who sent it and when. Under each incoming message,
  its attachments: images shown as thumbnails, others as a file chip; each can be viewed or downloaded.
- **Reply box** at the bottom: plain text, **Send reply**, and **Mark done**.
- Opening a conversation marks it read *(builder's call)*.

### Showing an email

- The HTML body is shown in a sandboxed `iframe` (`srcdoc`, `sandbox` with no `allow-scripts` and no
  `allow-same-origin`) under a Content-Security-Policy that blocks script and remote loads.
- **Remote images are blocked** until the admin clicks **Show images** for that message *(builder's
  call: per message, not remembered per sender)*. Inline images that arrived as attachments
  (`cid:`) are served from our own storage and shown straight away.
- An email with no HTML shows its text, escaped, with line breaks kept.
- Attachments download with `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff`,
  the way `private-files.ts` already serves digital products, so an HTML or SVG attachment never
  renders on our origin.

### Conversations and status

- A **conversation** is a thread of messages with one external address. An incoming email joins an
  existing conversation when its `In-Reply-To` or `References` names a message already in one (ours or
  theirs). Otherwise it starts a new one. A new subject from the same person is a new conversation
  *(builder's call)*.
- Each conversation is **Open** or **Done**. New mail opens it (or reopens a Done one). The admin's
  **Mark done** closes it. Sending a reply does not close it by itself *(builder's call)*.

### Matching the owner

When the sender's address equals an owner account's email (case-insensitive), the conversation is
linked to that account and the owner card shows. Matching happens when the conversation is created
*(builder's call: a later sign-up with that address does not relink old mail)*.

### Replying

- Sent **from** `Curios Support <support@curios.my>` *(builder's call on the display name)*, to the
  conversation's external address, subject `Re: <original subject>` (no doubled `Re:`).
- Threading headers: `In-Reply-To` = the latest incoming message's `Message-ID`; `References` = the
  thread's earlier message IDs, oldest first, latest last (Resend's documented threading).
- Our sent reply is stored as a message in the conversation with its own `Message-ID`, so a reply to
  our reply finds the thread.
- Each reply is recorded with the admin who sent it, and written to the audit log (`AdminAction`,
  new action e.g. `REPLIED_SUPPORT`) in the same transaction, like suspend and Email owner. The audit
  row keeps the address and subject, not the body.
- A reply goes through the mail queue like every other email. A reply that fails to send is shown as
  failed on that message, with a way to retry *(builder's call)*. It must not look sent when it was not.
- The admin's "Emails to owners" switch does not stop support replies: they are the admin's own mail.

---

## Receiving: how mail gets in

1. Resend POSTs `email.received` to a new API endpoint. The payload holds metadata only (`email_id`,
   `from`, `to`, `cc`, `received_for`, `message_id`, `subject`, attachment metadata), never the body.
2. The endpoint **verifies Resend's signature** (Resend signs webhooks with Svix headers, `svix-id`,
   `svix-timestamp`, `svix-signature`, and a `whsec_` secret; confirm against Resend's "verify
   webhook requests" page). Unsigned or bad: refused, like the CHIP callbacks.
3. If none of `to`/`cc`/`received_for` is support@curios.my, it is answered 200 and dropped (see
   "Other addresses"). Otherwise the endpoint records the `email_id` (idempotent: a redelivery of the
   same id does nothing) and **queues a job**, then answers 200.
4. A worker job fetches the content: `GET https://api.resend.com/emails/receiving/{id}` with
   `html_format=cid` (so images stay as attachments we store, not base64 inline in the HTML), which
   returns `html`, `text`, `headers`, `message_id`, `reply_to`, `authentication` (SPF/DKIM/DMARC) and
   the attachment list. It then fetches each attachment (Resend's download URLs last an hour), stores
   it in private storage, and writes the message into its conversation. Retries with backoff on
   failure, so a Resend or database outage delays mail instead of losing it.
5. The admin's reply goes out through the **existing mail queue and SMTP transport**, which gains
   From support@, `Message-ID`, `In-Reply-To` and `References` *(builder's call: the API only ever
   queues mail, a standing rule in `apps/api/src/lib/mailer.ts`, and the admin's own emails need a
   Message-ID we choose over the same path anyway)*. **"Sent" means the SMTP server accepted it**: the
   mail worker writes the message's status back, Sending until then, Failed once its retries run out.
   Later bounces are out of scope for this version *(builder's call)*.

**Who to reply to:** the incoming email's `Reply-To` if it has one, otherwise `From` *(builder's
call)*.

### Storage

- Attachments go to the private bucket via the existing `PrivateFiles` interface, under a
  `support/` prefix. **The dev buckets are shared with production** (see OPERATIONS.md), so tests
  and local runs must not write real objects there; use the local-disk store in dev and tests as
  digital products do.
- Size: whatever Resend accepts *(builder's call: no extra limit of ours, but a per-attachment
  ceiling that protects the worker's memory, streaming rather than buffering)*.
- The HTML body is stored as received (it is only ever shown sandboxed), plus the text body.
- Retention: kept until deleted; no automatic expiry in this version *(builder's call)*.

### Spam

Resend's received-email API has no spam flag; it gives SPF, DKIM and DMARC results. Mail that
**fails DMARC** (or fails both SPF and DKIM when DMARC is absent) goes to the **Spam** filter instead of
Open: kept, not counted, can be moved back to Open *(builder's call on the exact rule)*.

### Other addresses

Only support@curios.my is a mailbox. Mail to hello@ or any other @curios.my address is not stored.
*(Builder's call: count it, e.g. a log line or a counter on the overview, so the owner can see if
people write to the wrong address. Nothing beyond that.)*

### Configuration

New variables: Resend API key (receiving reads), the webhook signing secret, and the support address
(default `support@curios.my`). They must be added to `.env.example` and OPERATIONS.md's variable table (like `CHIP_*`, they are read
from `.env`, so turbo.json needs nothing unless a host provides them in the shell), and production
must refuse to start without them, like the other required secrets. The webhook URL is set
in Resend's dashboard to the API's public origin.

---

## Reply-To on every email Curios sends

All mail still goes **from** hello@curios.my (or "Shop via Curios" at that address). What changes is
**Reply-To**:

| Email | Reply-To |
|---|---|
| Emails to a shop's **customers** (order confirmations, delivery, digital booking and codes: the ones sent as "{Shop} via Curios") | **The shop owner's account email.** A customer who hits Reply, e.g. to change a pickup time, reaches the shop directly. |
| **Every other email** (to owners: billing, renewals, leads, the monthly limit, suspend, bring back, report warning; and sign-in, verification, password reset) | **support@curios.my**, so it lands in the new inbox. |

- Mail jobs carry an optional `replyTo`. Customer emails set it to the owner's email when queued; the
  transport defaults everything else to the support address.
- **The admin's own emails start a conversation** *(builder's call)*. Suspend, bring back, report
  warning and Email owner ask the owner to reply, so each is also stored as the first (outgoing)
  message of a Done support conversation with its `Message-ID`. An owner's reply then threads under
  what it answers instead of arriving out of context. The write happens in the same service call that
  queues the email.
- The owner agreed that later, when the order chat exists, customer emails may also point customers to
  it. Not in this project.

---

## Constraints

- **Support mail is personal data and is withheld from the read-only role.** `curios_readonly` is
  shared with the public web app, and the repo's rule (ChipWebhookEvent.body, Report.reporterIpHash)
  is that personal columns are revoked from it. The new tables' address, subject, body, header and
  attachment-name columns are revoked inline in the migration and in `readonly-role.sql`, with
  `readonly-role.test.ts` covering them. So the Support screen reads **through authenticated
  `/admin` API routes**, not the admin read path. The sidebar's Open count, which holds no personal
  data, may still come from the read path *(builder's call)*.
- Writes go through the API service layer with the audit row in the same transaction.
- Prisma already has `Conversation` and `Message` (the shop chat); the new models need other names,
  e.g. `SupportThread` and `SupportMessage`.
- Schema migrations are hand-written, like the others.
- Copy is English (the admin app is English-only).
- Restyle and visual tokens follow the existing admin screens (Reports and Pages are the nearest).

## Left to the builder

Everything marked *(builder's call)* above, plus: the schema (a conversation table, a message table
with direction, a table for attachments, and the received `email_id` for idempotency), job and queue
names, the endpoint paths, the exact HTML sanitising/CSP mechanics within the rules above, and paging
of the list.
