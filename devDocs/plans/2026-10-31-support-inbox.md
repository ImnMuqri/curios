# Support inbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mail to support@curios.my lands in a new admin **Support** screen as conversations that the admin reads in full and answers from there; every email Curios sends gets a Reply-To a person reads.

**Architecture:** Resend POSTs `email.received` to a signed API endpoint, which only queues a `support-inbound` job. A worker fetches the body and attachments from Resend's API, stores attachments in private storage (the API's `PrivateFiles`, moved to a shared package so the worker can use it) and files the message into a `SupportThread`. The admin screen reads threads through authenticated `/admin/support/*` API routes (the read-only role cannot see them). Replies and the admin's own emails go out through the existing mail queue, which learns From support@, Message-ID and threading headers and writes each support message's send status back.

**Tech Stack:** Prisma/Postgres (hand-written migration), Fastify + zod, BullMQ, nodemailer over SMTP, R2/S3 via `@aws-sdk`, Next 15 / React 19 admin app, vitest + Testing Library.

**Spec:** `devDocs/support-inbox-design.md`

## Global Constraints

- The mailbox is `SUPPORT_EMAIL` (default `support@curios.my`). Only mail with that address in `to`, `cc` or `received_for` (case-insensitive) is stored. Anything else is answered 200, logged once as `support mail to another address` with the address list, and dropped.
- New env: `RESEND_WEBHOOK_SECRET` (API; `whsec_...`), `RESEND_API_KEY` (workers), `SUPPORT_EMAIL` (API and workers). Production refuses to start without the first two. Outside production, a missing one switches that half off with one warn line, like `CHIP_*`.
- Support content (addresses, names, subjects, bodies, headers, attachment names) is **revoked from `curios_readonly`**. Only `SupportThread`'s `id`, `status`, `unread`, `accountId`, `lastMessageAt` and `createdAt` are granted (the sidebar count).
- The API never sends mail and never calls Resend. It only queues work (`apps/api/src/lib/mailer.ts`).
- Email HTML is shown only in `<iframe sandbox="allow-popups allow-popups-to-escape-sandbox" srcdoc=...>`, never with `allow-scripts` or `allow-same-origin`, under a CSP `<meta>` that `buildEmailDocument` (Task 9) writes.
- Attachment downloads are served by `PrivateFiles.deliver`, with `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff`.
- Dev and test storage is the local disk store. **The dev R2 buckets are shared with production: nothing in this plan writes to R2 outside production.**
- Admin copy is English. Visual style follows the Reports and Pages screens' CSS modules.
- Formatting follows the repo's Prettier config; run `pnpm lint` before each commit.
- Verify with `pnpm turbo run typecheck lint --concurrency=1 --force` and `pnpm turbo run test --concurrency=1 --force`. After the migration, the test DB needs `pnpm --filter @curios/db exec prisma migrate deploy` against `DATABASE_URL_TEST` and the readonly role re-applied (see the repo memory on the ephemeral test DB). Generate Prisma from `packages/db`.

## Review Focus

1. **Resend delivers the same `email.received` twice, or the worker dies halfway through attachments:** exactly one message appears, with every attachment, and only once all are stored. Tests: Task 5 (same `email_id` gives one job id), Task 6 (rerun after a failed attachment).
2. **A forged or replayed POST to the webhook** (no `svix-*` headers, a wrong signature, a timestamp over 5 minutes old): 400, nothing queued. Test: Task 5.
3. **An email whose HTML carries `<script>`, `onerror=`, a `<form>` and a remote tracking `<img>`:** in the admin, no script runs and nothing remote loads until Show images. Even then, only images load and script still does not run. Tests: Task 9 (`buildEmailDocument` CSP strings and sandbox attribute).
4. **An owner replies to a suspend email, or replies twice to our reply:** each message joins the existing conversation and reopens it if it was Done. A new subject from the same address starts a new one. Tests: Task 6, Task 8.
5. **SMTP down when the admin presses Send reply:** the message shows Sending, then Failed after the queue's last attempt, never Sent. Retry queues it again. Tests: Task 4 (worker writes FAILED only on the final attempt), Task 7 (retry route).

---

### Task 1: Private storage as a shared package

The inbound worker must store attachments where the API's admin routes can read them back, so `PrivateFiles` moves out of `apps/api`.

**Files:**
- Create: `packages/storage/package.json` (name `@curios/storage`, shaped like `packages/billing/package.json`, `exports: { "./private-files": "./src/private-files.ts" }`, deps `@aws-sdk/client-s3`, `@aws-sdk/lib-storage`, `@aws-sdk/s3-request-presigner` at the versions `apps/api` uses), `packages/storage/tsconfig.json`, `packages/storage/vitest.config.ts` (copy billing's)
- Move: `apps/api/src/modules/store/private-files.ts` → `packages/storage/src/private-files.ts`, and its test → `packages/storage/src/private-files.test.ts`
- Modify: `apps/api/src/modules/store/private-files.ts` becomes `export * from '@curios/storage/private-files';`. Add `@curios/storage` to `apps/api` and `apps/workers` dependencies.

**Interfaces:**
- Produces: `@curios/storage/private-files`, the same exports as before (`PrivateFiles`, `resolvePrivateFiles`, `createDiskPrivateFiles`, `createS3PrivateFiles`, `attachmentDisposition`, `assertSafeKey`, `PRIVATE_LINK_SECONDS`).

- [ ] **Step 1:** Move the files with `git mv`, so history follows. Keep `DEFAULT_ROOT` pointing at the **same folder as before**: `fileURLToPath(new URL('../../../apps/api/.files', import.meta.url))`. That way dev digital-product files stay readable.
- [ ] **Step 2:** `pnpm install`, then `pnpm --filter @curios/storage exec vitest run`. Expected: the moved tests PASS unchanged.
- [ ] **Step 3:** `pnpm turbo run typecheck --concurrency=1 --force`. Expected: PASS, with no import outside the shim changed.
- [ ] **Step 4: Commit** `refactor(storage): private files move to @curios/storage so the workers can write them`

---

### Task 2: Tables, grants and shared names

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/20261031120000_support_inbox/migration.sql` (hand-written, like the others)
- Modify: `packages/db/prisma/sql/readonly-role.sql`, `packages/db-read/src/readonly-role.test.ts`
- Modify: `packages/core/src/types.ts` (queue name, job type, `MailJobData` fields), `packages/core/src/admin.ts` (`ADMIN_ACTIONS`), `packages/core/src/index.ts`

**Interfaces:**
- Produces (schema):
  ```prisma
  enum SupportStatus { OPEN DONE SPAM }
  enum SupportDirection { IN OUT }
  enum SupportSendStatus { SENDING SENT FAILED }

  model SupportThread {
    id            String          @id @default(cuid())
    address       String          // the other side, lower-cased
    name          String?         // their display name, from the latest incoming message
    subject       String
    status        SupportStatus   @default(OPEN)
    unread        Boolean         @default(true)
    accountId     String?
    account       Account?        @relation(fields: [accountId], references: [id], onDelete: SetNull)
    lastMessageAt DateTime
    createdAt     DateTime        @default(now())
    messages      SupportMessage[]
    @@index([status, lastMessageAt])
  }

  model SupportMessage {
    id            String             @id @default(cuid())
    threadId      String
    thread        SupportThread      @relation(fields: [threadId], references: [id], onDelete: Cascade)
    direction     SupportDirection
    messageId     String             // RFC 5322 Message-ID, with angle brackets
    resendEmailId String?            @unique
    fromAddress   String
    fromName      String?
    toAddresses   String[]
    subject       String
    text          String?
    html          String?
    sendStatus    SupportSendStatus? // OUT only
    sentById      String?
    sentBy        AdminUser?         @relation(fields: [sentById], references: [id], onDelete: Restrict)
    createdAt     DateTime           @default(now())
    attachments   SupportAttachment[]
    @@index([messageId])
    @@index([threadId, createdAt])
  }

  model SupportAttachment {
    id                 String         @id @default(cuid())
    messageId          String
    message            SupportMessage @relation(fields: [messageId], references: [id], onDelete: Cascade)
    resendAttachmentId String
    fileName           String
    contentType        String
    sizeBytes          Int
    contentId          String?        // without angle brackets, for cid: references
    inline             Boolean
    storageKey         String         @unique
    @@unique([messageId, resendAttachmentId])
  }
  ```
  Back-relations: `Account.supportThreads`, `AdminUser.supportReplies`.
- Produces (core): `SUPPORT_INBOUND_QUEUE = 'support-inbound'`; `interface SupportInboundJobData { emailId: string }`; `ADMIN_ACTIONS.REPLIED_SUPPORT = 'REPLIED_SUPPORT'`. `MailJobData` gains:
  - `replyTo?: string`
  - `from?: 'support'`
  - `messageId?: string`
  - `inReplyTo?: string`
  - `references?: string[]`
  - `supportMessageId?: string`

- [ ] **Step 1: Write the failing grant tests** in `readonly-role.test.ts`, in its existing style:
  - `curios_readonly` can select `SupportThread`'s `id, status, unread, "accountId", "lastMessageAt", "createdAt"`.
  - It is refused `SupportThread.address`, `.name` and `.subject`.
  - It is refused every column of `SupportMessage` and `SupportAttachment`.
- [ ] **Step 2:** Run `pnpm --filter @curios/db-read exec vitest run src/readonly-role.test.ts`. Expected: FAIL (the tables do not exist).
- [ ] **Step 3:** Write the schema and the migration. In the migration, add the grants inline, after the `CREATE TABLE`s: `REVOKE SELECT ON` all three tables, then `GRANT SELECT (...)` on the six `SupportThread` columns only. Add the same blocks to `readonly-role.sql`, in its `DO $$ ... to_regclass` style. Add the core names.
- [ ] **Step 4:** Apply the migration to dev and test, re-apply the readonly role, then `pnpm --filter @curios/db exec prisma generate`. Run the test again. Expected: PASS.
- [ ] **Step 5: Commit** `feat(db): support threads, messages and attachments, withheld from the readonly role`

---

### Task 3: Support rules in core

Pure functions shared by the worker, the API and their tests.

**Files:**
- Create: `packages/core/src/support.ts`, `packages/core/src/support.test.ts`
- Modify: `packages/core/package.json` (`"./support": "./src/support.ts"`)

**Interfaces:**
- Produces (`@curios/core/support`):
  - `supportAddress(env = process.env): string`: `SUPPORT_EMAIL`, trimmed and lower-cased, default `'support@curios.my'`
  - `parseAddress(raw: string): { address: string; name: string | null }`: handles `Name <a@b>`, `"Quoted, Name" <a@b>` and bare `a@b`. The address is lower-cased.
  - `isForSupport(lists: { to?: string[]; cc?: string[]; received_for?: string[] }, support: string): boolean`
  - `replySubject(subject: string): string`: adds `Re: ` unless the subject already starts with `re:` in any case. An empty subject gives `Re: (no subject)`.
  - `threadingIds(headers: Record<string, string | string[] | undefined>): string[]`: `In-Reply-To` then `References`, split on whitespace, each kept with its `<>`, de-duplicated. Header names are matched case-insensitively.
  - `referencesFor(messageIds: string[]): string[]`: the thread's ids oldest first, de-duplicated, at most the last 20
  - `newMessageId(domain = 'curios.my'): string`: `<${randomUUID()}@${domain}>`
  - `isSpam(auth: unknown): boolean`: true when DMARC is `fail`, or when DMARC is absent or `unknown` and both SPF and DKIM are `fail`. Anything unparsable is false (never hide mail on a shape we did not expect). **Confirm the `authentication` field's exact shape** against `GET https://api.resend.com/emails/receiving/{id}` (https://resend.com/docs/api-reference/emails/retrieve-received-email) and write the fixtures to match it.

- [ ] **Step 1: Write the failing tests**, including:

```ts
expect(parseAddress('"Lina, Kek" <Lina@Example.com>')).toEqual({ address: 'lina@example.com', name: 'Lina, Kek' });
expect(replySubject('RE: Help')).toBe('RE: Help');
expect(replySubject('')).toBe('Re: (no subject)');
expect(isForSupport({ to: ['hello@curios.my'], received_for: ['Support@Curios.my'] }, 'support@curios.my')).toBe(true);
expect(isForSupport({ to: ['hello@curios.my'] }, 'support@curios.my')).toBe(false);
expect(threadingIds({ 'in-reply-to': '<a@x>', References: '<b@x> <a@x>' })).toEqual(['<a@x>', '<b@x>']);
expect(referencesFor(Array.from({ length: 25 }, (_, i) => `<${i}@x>`))).toHaveLength(20);
expect(isSpam(null)).toBe(false);
```

  Add `isSpam` cases for DMARC fail, SPF+DKIM fail with no DMARC, and SPF fail with DKIM pass (false).
- [ ] **Step 2:** `pnpm --filter @curios/core exec vitest run src/support.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. `support.ts` imports only `node:crypto`.
- [ ] **Step 4:** Run again. Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): support address, threading and spam rules`

---

### Task 4: Mail learns Reply-To, the support sender and send status

**Files:**
- Modify: `apps/workers/src/mail/transport.ts`, `apps/workers/src/mail/transport.test.ts`
- Modify: `apps/workers/src/mail/mail.worker.ts`, `apps/workers/src/mail/mail.worker.test.ts`, `apps/workers/src/main.ts`
- Modify: `apps/api/src/modules/orders/deliver.service.ts:172`, `apps/workers/src/housekeeping/session-reminders.ts:129` and their tests (customer emails get Reply-To set to the owner)
- Modify: `.env.example` (`SUPPORT_EMAIL=support@curios.my`, with a comment), `devDocs/OPERATIONS.md` variable table

**Interfaces:**
- Consumes: the `MailJobData` fields (Task 2), `supportAddress` (Task 3).
- Produces:
  - `Transport.sendMail` options gain `replyTo`, `messageId`, `inReplyTo` and `references`, which are nodemailer's own option names.
  - `createMailWorker` deps gain `onSupportStatus?: (supportMessageId: string, status: 'SENT' | 'FAILED') => Promise<void>`. `main.ts` passes one that updates `SupportMessage.sendStatus` through its prisma client.

- [ ] **Step 1: Write the failing tests** in `transport.test.ts`:
  - A plain job is sent with `replyTo: 'support@curios.my'`.
  - A job with `replyTo: 'owner@x.test'` keeps it.
  - `from: 'support'` sends from `Curios Support <support@curios.my>` and ignores `fromName`.
  - `messageId`, `inReplyTo` and `references` pass through. Nothing is set when they are absent.

  In `mail.worker.test.ts`:
  - `onSupportStatus(id, 'SENT')` runs after a successful send of a job with `supportMessageId`.
  - A job that fails on its final attempt (`job.attemptsMade + 1 >= job.opts.attempts`) gets `onSupportStatus(id, 'FAILED')`, and the error is still thrown.
  - A non-final failure writes nothing.
  - The "Emails to owners" switch never holds back a `from: 'support'` job.

  In the deliver and session-reminder tests: the customer's job carries `replyTo` equal to the page owner's account email.
- [ ] **Step 2:** Run `pnpm --filter @curios/workers exec vitest run src/mail` plus the two touched test files. Expected: FAIL.
- [ ] **Step 3:** Implement. Pass the job (not only `job.data`) to the processor, so the final-attempt check can read `attemptsMade` and `opts.attempts`. Customer jobs select `page.account.email` and set `replyTo` to it.
- [ ] **Step 4:** Run again. Expected: PASS.
- [ ] **Step 5: Commit** `feat(mail): every email has a Reply-To; customers reach the shop, everyone else reaches support`

---

### Task 5: The signed inbound webhook

**Files:**
- Create: `apps/api/src/modules/support/resend-signature.ts`, `resend-signature.test.ts`, `support-inbound.routes.ts`, `support-inbound.routes.test.ts`
- Modify: `apps/api/src/plugins/queue.ts` (decorate `supportInboundQueue`), `apps/api/src/app.ts` (register it with no session and no rate limit, next to `shopChipCallbackRoutes`; add `supportInbound?: SupportInboundRouteOptions` to `AppOverrides`)
- Modify: `.env.example` (`RESEND_WEBHOOK_SECRET=`), `devDocs/OPERATIONS.md` (the variable, plus a short "Support inbox" section: in Resend's dashboard, add a webhook for `email.received` pointing at `<API origin>/support/inbound`, and paste its signing secret)

**Interfaces:**
- Produces:
  - `verifyResendSignature(input: { id?: string; timestamp?: string; signature?: string; rawBody: string; secret: string; now?: Date }): boolean`. This is Svix's scheme:
    - the secret is base64-decoded after stripping `whsec_`;
    - it signs `${id}.${timestamp}.${rawBody}` with HMAC-SHA256;
    - the result is compared, with `timingSafeEqual`, against each space-separated `v1,<base64>` entry in `svix-signature`;
    - the timestamp must be within 5 minutes of `now`.

    Check it against Resend's "Verify webhooks requests" page.
  - `POST /support/inbound`, reading the headers `svix-id`, `svix-timestamp` and `svix-signature`:
    - missing or bad: 400 `BAD_SIGNATURE`, with one warn line;
    - a `type` other than `email.received`: 200 `{ ok: true }`;
    - not `isForSupport`: 200, dropped and logged;
    - otherwise `supportInboundQueue.add(SUPPORT_INBOUND_QUEUE, { emailId }, { jobId: emailId, attempts: 8, backoff: { type: 'exponential', delay: 30_000 }, removeOnComplete: true, removeOnFail: { age: 7 * 86_400 } })`, then 200.

    A queue error surfaces as a 500, so Resend sends the webhook again.
  - `SupportInboundRouteOptions { queue?: { add(...): Promise<unknown> }; secret?: string }`. With no secret outside production, the route is not registered and one warn line is logged. In production, a missing `RESEND_WEBHOOK_SECRET` throws at start.

- [ ] **Step 1: Write the failing tests.**
  - Signature: a fixture signed in the test with a known secret passes; one changed byte fails; a timestamp 301 s old fails; and a header with two signatures where only the second matches passes.
  - Routes, through `buildApp({ supportInbound: { queue, secret } })` and `app.inject`:
    - no headers gives 400 and no `add`;
    - a valid `email.received` to support@ gives one `add`, with `jobId` equal to the `email_id`;
    - the same delivery twice gives two `add` calls, both with the same `jobId` (BullMQ de-duplicates);
    - a valid one addressed only to `hello@curios.my` gives 200 and no `add`;
    - `queue.add` rejecting gives 500.
- [ ] **Step 2:** `pnpm --filter @curios/api exec vitest run src/modules/support`. Expected: FAIL.
- [ ] **Step 3:** Implement. The raw body comes from the existing `raw-json` plugin (`request.rawBody`), the same as the CHIP callbacks.
- [ ] **Step 4:** Run again. Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): Resend's signed email.received webhook queues support mail`

---

### Task 6: The inbound worker

**Files:**
- Create: `apps/workers/src/support/resend-client.ts`, `apps/workers/src/support/inbound.ts`, `apps/workers/src/support/inbound.test.ts`
- Modify: `apps/workers/src/main.ts` (start the worker when `RESEND_API_KEY` is set; production throws without it), `apps/workers/src/queues.ts` (`QUEUE_CONCURRENCY.supportInbound = 2`), `.env.example` (`RESEND_API_KEY=`), `devDocs/OPERATIONS.md`

**Interfaces:**
- Consumes: `PrivateFiles` (Task 1), the schema (Task 2), and `parseAddress`, `threadingIds`, `isSpam` and `supportAddress` (Task 3).
- Produces:
  - `createResendClient({ apiKey, baseUrl = 'https://api.resend.com', fetch? })`, which returns:
    - `getReceived(id)`: `GET /emails/receiving/{id}?html_format=cid`, returning `{ from, to, cc, reply_to, subject, html, text, headers, message_id, authentication, attachments: { id, filename, content_type, content_disposition, content_id, size }[] }`;
    - `attachmentStream(emailId, attachmentId)`, which resolves the attachment's `download_url` through Resend's attachments API and returns `{ stream, contentType, size }`.

    Any non-2xx throws an error carrying the status. Confirm both endpoint paths against https://resend.com/docs/dashboard/receiving/attachments.
  - `processInbound(deps: { prisma; resend; files: PrivateFiles; support: string; log }, emailId: string): Promise<'stored' | 'duplicate' | 'not-support'>`.
  - `createSupportInboundWorker(deps & { connection })`.

- [ ] **Step 1: Write the failing tests** against the test DB, with a fake `resend` and `createDiskPrivateFiles(tmpdir)`:
  1. **A new email from an owner's address:**
     - it creates an OPEN, unread thread with `accountId` set and `address` lower-cased;
     - the message is IN, with `html` and `text`;
     - one attachment is stored at key `support/<emailId>/<attachmentId>`, and its bytes read back equal.
  2. **A `Reply-To` header** makes `thread.address` the Reply-To address, not From.
  3. **Threading:** an email whose `In-Reply-To` names an existing message's `messageId` joins that thread. A DONE thread becomes OPEN and unread again, and `lastMessageAt` moves.
  4. **A new subject from the same address**, with no threading headers, makes a second thread.
  5. **Resumable attachments:** the second attachment's stream throws, so `processInbound` rejects and no `SupportMessage` row exists. A rerun with a working fake stores both, with one message, and returns `'stored'`. The first attachment's key is overwritten, not duplicated.
  6. **A rerun after success** returns `'duplicate'` and writes nothing.
  7. **`isSpam` true:** the thread is created with status SPAM and does not count as OPEN.
  8. **No `message_id` from Resend:** the message gets `newMessageId()`.

  The `afterAll` deletes the threads by the ids it created. Truncate cleanup needs an `afterAll` (repo memory).
- [ ] **Step 2:** `pnpm --filter @curios/workers exec vitest run src/support`. Expected: FAIL.
- [ ] **Step 3:** Implement `processInbound` in this order:
  1. If a `SupportMessage` with this `resendEmailId` exists, return `'duplicate'`.
  2. Fetch the email from Resend. If it is not for support, return `'not-support'`.
  3. Upload every attachment to its deterministic key by streaming it into `files.put`, so a rerun overwrites rather than duplicates.
  4. In **one transaction**:
     - find the thread through `threadingIds`, using the newest `SupportMessage` whose `messageId` is in them;
     - otherwise create a thread, with `accountId` from `Account.email` equal to the address (case-insensitive);
     - insert the message and its attachment rows;
     - set the thread to `status: isSpam ? 'SPAM' : 'OPEN'` (a thread already SPAM stays SPAM, and DONE reopens), `unread: true`, `lastMessageAt`, and update `name`.

  The message row is written only after every upload succeeds, so a half-stored email never appears.
- [ ] **Step 4:** Run again. Expected: PASS.
- [ ] **Step 5: Commit** `feat(workers): support mail is fetched from Resend, its attachments stored privately, and filed into a thread`

---

### Task 7: Admin support API

**Files:**
- Create: `apps/api/src/modules/admin/admin-support.service.ts`, `admin-support.routes.ts`, `admin-support.routes.test.ts`
- Modify: `apps/api/src/app.ts` (register it inside the `requireAdmin` scope, with `mailQueue` and `privateFiles` as `adminPagesRoutes` gets them)

**Interfaces:**
- Consumes: the schema, `replySubject`, `referencesFor`, `newMessageId` and `supportAddress`, `MailJobData`, and `adminActor` plus the audit write used by `admin-reports.service.ts`.
- Produces (every route is admin-only, with JSON shapes that the screen in Task 9 types against):
  - `GET /admin/support/threads?status=open|done|spam|all&q=&before=<ISO>` returns `{ threads: { id, address, name, subject, status, unread, lastMessageAt, attachmentCount, owner: { pageId, handle, displayName } | null }[], next: string | null }`.
    - 50 per page, ordered by `lastMessageAt desc`.
    - `q` matches address, name or subject (case-insensitive contains).
    - `owner` is the account's first page.
  - `GET /admin/support/counts` returns `{ open, done, spam }`.
  - `GET /admin/support/threads/:id` returns:
    ```
    {
      thread,
      owner: { pageId, handle, displayName, plan, paidUntil } | null,
      messages: {
        id, direction, fromAddress, fromName, createdAt, text, html,
        sendStatus, sentBy: { name } | null,
        attachments: { id, fileName, contentType, sizeBytes, inline }[]
      }[]
    }
    ```
    In each `html`, every `cid:<contentId>` is replaced with a `data:` URI of that stored attachment when it is an image of at most 2 MB, with at most 8 MB per message. Anything over those limits keeps `cid:` and is only listed as an attachment.
  - `GET /admin/support/attachments/:id` sends the file through `PrivateFiles.deliver` (a redirect, or a stream with the disposition and `nosniff`).
  - `POST /admin/support/threads/:id/read` returns 204.
  - `POST /admin/support/threads/:id/status { status: 'OPEN' | 'DONE' }` returns 204. Moving a SPAM thread to OPEN is how it is rescued.
  - `POST /admin/support/threads/:id/reply { text: string (1..20000, trimmed) }` returns `{ message }`. In one transaction it:
    - creates an OUT message (`sendStatus: SENDING`, `messageId: newMessageId()`, `subject: replySubject(thread.subject)`, `sentById`);
    - writes an `AdminAction` (`REPLIED_SUPPORT`, `targetType: 'SupportThread'`, `targetLabel: address`, `metadata: { subject }`, `reason: ''`) with no body.

    After the commit, it queues a mail job:
    ```
    {
      to: thread.address,
      from: 'support',
      subject,
      text,
      messageId,
      inReplyTo: latestIncomingMessageId,
      references: referencesFor(threadMessageIds),
      supportMessageId
    }
    ```
    with `attempts: 5` and backoff. A queue error marks the message FAILED and answers 500 `REPLY_NOT_QUEUED`.
  - `POST /admin/support/messages/:id/retry` works only on a FAILED OUT message. It sets SENDING and queues the same job again (204). Otherwise it answers 409 `NOT_FAILED`.
  - Unknown ids answer 404 `SUPPORT_NOT_FOUND`.

- [ ] **Step 1: Write the failing tests** in the style of `admin-reports.routes.test.ts` (an admin cookie, `mailQueue` as `vi.fn`, seeded rows):
  - **Auth:** a request with no cookie gets 401 on every route.
  - **List:**
    - `status=open` excludes DONE and SPAM;
    - `q` finds a thread by subject;
    - the owner is joined when `accountId` is set.
  - **Inline images:** the thread's `html` has `cid:img1` replaced by `data:image/png;base64,` when an inline attachment with `contentId: 'img1'` is stored, and keeps `cid:` for a 3 MB one.
  - **Download:** the attachment route sends `content-disposition: attachment` and `x-content-type-options: nosniff` for an `image/svg+xml` file.
  - **Reply:**
    - it creates one SENDING message and one `REPLIED_SUPPORT` audit row with no body in it;
    - the queued job has `from: 'support'`, `inReplyTo` equal to the last IN message's id, `references` in thread order, and `subject` `Re: <subject>` (not `Re: Re:`).
  - **Queue down:** reply with `mailQueue.add` rejecting gives 500, and the message is FAILED.
  - **Retry:** on FAILED it queues again; on SENT it gives 409.
  - **Status:** it moves DONE to OPEN, and `read` clears `unread`.
- [ ] **Step 2:** `pnpm --filter @curios/api exec vitest run src/modules/admin/admin-support`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run again. Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): admin reads, answers and closes support conversations`

---

### Task 8: The admin's own emails open a conversation

**Files:**
- Modify: `apps/api/src/modules/admin/admin-pages.service.ts` (`mailOwner`, around line 97), plus `admin-pages.routes.test.ts` and `admin-reports.routes.test.ts`

**Interfaces:**
- Consumes: `newMessageId` and `supportAddress` (Task 3), and the mail status write-back (Task 4).
- Produces: `mailOwner(deps, page, build, reason, actor?)`. Before queueing, it creates:
  - a `SupportThread` with `address` set to the owner's email (lower-cased), `accountId`, `subject: mail.subject`, `status: 'DONE'` and `unread: false`;
  - an OUT `SupportMessage` with `sendStatus: 'SENDING'`, `messageId`, `text: mail.text`, `html: null` and `sentById: actor.adminUserId`.

  The job then carries `messageId` and `supportMessageId`. A failure in either the write or the queue is still caught and logged, and it never undoes the suspend.

- [ ] **Step 1: Write the failing tests:**
  - Suspending a page leaves one DONE thread for the owner, holding one OUT message.
  - The queued job's `messageId` equals that message's.
  - Then `processInbound` (Task 6) with `In-Reply-To` set to that `messageId` joins the thread and reopens it. Put this part in `apps/workers/src/support/inbound.test.ts`, seeding the same rows.
  - Email owner (report warning) does the same.
- [ ] **Step 2:** Run the touched tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run again. Expected: PASS.
- [ ] **Step 5: Commit** `feat(admin): suspend, bring-back and report emails start a support conversation, so replies thread`

---

### Task 9: The Support screen (layout A)

**Files:**
- Modify: `packages/db-read/src/admin/nav.query.ts` and its test (`openSupport` = `supportThread.count({ where: { status: 'OPEN' } })`), `apps/admin/app/(admin)/shell.tsx` (`NavKey` gains `'support'`; a **Support** item in the **Run** group after Reports, with `href: '/support'`, `count: 'openSupport'` and an envelope icon path)
- Create in `apps/admin/app/(admin)/support/`:
  - `page.tsx` (server: `requireAdmin()`, then `<SupportScreen />`)
  - `support-screen.tsx` (`'use client'`)
  - `email-frame.tsx` (`'use client'`)
  - `email-document.ts`
  - `support.module.css`
  - `support-screen.test.tsx`, `email-document.test.ts`
- Modify: `devDocs/ADMIN.md` (a Support section: what it shows, what is withheld from the readonly role, and the reply path)

**Interfaces:**
- Consumes: the Task 7 routes through `apiFetch`, and `NavCounts.openSupport`.
- Produces:
  - `buildEmailDocument(input: { html: string | null; text: string | null; showRemoteImages: boolean }): string`, which returns a full HTML document for `srcdoc`:
    - `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:{remote}">`, where `{remote}` is ` https:` only when `showRemoteImages` is set;
    - `<base target="_blank">`;
    - then the email's HTML.

    With no HTML, it shows the text HTML-escaped inside `<pre style="white-space:pre-wrap">`.
  - `EmailFrame({ html, text })` renders `<iframe sandbox="allow-popups allow-popups-to-escape-sandbox" srcdoc={...} title="Email">`. It has a **Show images** button only when the HTML contains `http:` or `https:` image sources, and it resizes to the content height on load. A sandboxed frame without `allow-same-origin` cannot be measured, so it uses a fixed `min(70vh, 900px)` height with its own scrollbar. *(Builder's call within that rule.)*

- [ ] **Step 1: Write the failing tests.**
  - `email-document.test.ts`:
    - the CSP has `img-src data:` and no `https:` by default, and `img-src data: https:` with `showRemoteImages`;
    - `script-src` never appears, and `default-src 'none'` is always present;
    - text-only `<b>hi</b>` comes out escaped.
  - `support-screen.test.tsx`, with mocked `apiFetch`:
    - the list renders sender (the owner's name and handle when matched), subject, paperclip count and unread marker;
    - the filters show Open (with its count), Done, All and Spam;
    - clicking a row loads the conversation, which shows the owner card linking to `/pages?page=<pageId>`;
    - opening an unread thread posts `/read` once, and its unread marker clears;
    - messages show in order, and an attachment has a download link to the API's `/admin/support/attachments/:id`;
    - the iframe's `sandbox` attribute is exactly `allow-popups allow-popups-to-escape-sandbox`;
    - typing a reply and pressing **Send reply** posts `{ text }` and appends the message as "Sending…";
    - a FAILED message shows "Not sent" and a **Retry** button, which calls the retry route;
    - **Mark done** posts `status: 'DONE'`;
    - a SPAM thread shows **Not spam** (status OPEN) instead.
  - The nav test: the Support count shows when `openSupport > 0`.
- [ ] **Step 2:** `pnpm --filter @curios/admin exec vitest run app/\(admin\)/support` (via `MSYS_NO_PATHCONV=1` in Git Bash). Expected: FAIL.
- [ ] **Step 3:** Implement layout A. On a narrow screen (under 900px) the list and the conversation stack, with a Back link.
- [ ] **Step 4:** Run again. Expected: PASS. Then `pnpm --filter @curios/admin exec tsc --noEmit` after loading the page once in `next dev` (the repo memory on `.next/types`).
- [ ] **Step 5: Commit** `feat(admin): Support screen, a list and conversation side by side`

---

### Task 10: In the running app

- [ ] **Step 1:** Run the full gates, `pnpm turbo run typecheck lint --concurrency=1 --force` and `pnpm turbo run test --concurrency=1 --force`. Check the exit codes themselves, not output piped through anything. Expected: all PASS.
- [ ] **Step 2:** Make sure Docker is up and `pnpm dev` is running. Seed one thread with an HTML body that has a `cid:` image, a remote `<img>` and a `<script>`, plus one attachment on the disk store, using a one-off `tsx` script that prints the ids it created.
- [ ] **Step 3:** Open the admin's `/support` and check:
  - the sidebar count;
  - the owner card;
  - the inline image shows and the remote one does not until **Show images**;
  - the script did not run (put an `alert` in it);
  - the attachment downloads.
- [ ] **Step 4:** Send a reply. It arrives in Mailpit from `Curios Support <support@curios.my>`, with `In-Reply-To` and `References` set, and the message turns Sent. Stop Mailpit's SMTP, send again, and watch it go Failed after the retries. Retry it once SMTP is back.
- [ ] **Step 5:** Delete the seeded rows **by the ids the script printed** (never by a time window), and stop the dev servers by killing `Projects\curios\` processes. Then check that ports 3000 to 3002 are free.
- [ ] **Step 6:** Tell the owner what to set in production:
  - `RESEND_WEBHOOK_SECRET` on the API;
  - `RESEND_API_KEY` on the workers;
  - the `email.received` webhook in Resend's dashboard, pointing at `<API origin>/support/inbound`.

  Production refuses to start without the two secrets, so they must be set before deploying.
