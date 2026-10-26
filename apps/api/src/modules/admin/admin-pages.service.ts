import {
  ADMIN_ACTIONS,
  currentPeriod,
  extendPaidUntil,
  MAIL_QUEUE,
  pageRestoredMail,
  pageSuspendedMail,
  type MailJobData,
} from '@curios/core';
import { stockCoverName } from '@curios/core/bento';
import type { Prisma, PrismaClient } from '@curios/db';
import type { AvatarStore } from '../pages/storage.js';
import type { PrivateFiles } from '../store/private-files.js';
import { writeAudit } from './audit.js';

export interface AdminPagesDeps {
  prisma: PrismaClient;
  mailQueue: { add(name: string, data: MailJobData, opts?: unknown): Promise<unknown> };
  /** Null: uploads are off here, so there are no files to remove. */
  store: AvatarStore | null;
  /** Null: private storage is off, so there are no digital files to remove. */
  privateFiles?: PrivateFiles | null;
  log?: { warn?: (o: object, m: string) => void };
}

/** Who is acting, and from where: the audit row's first columns. */
export interface AdminActor {
  adminId: string;
  ip: string;
}

export class PageNotFoundError extends Error {
  readonly statusCode = 404;
  readonly code = 'PAGE_NOT_FOUND';

  constructor() {
    super('That page does not exist.');
    this.name = 'PageNotFoundError';
  }
}

export class PageStateError extends Error {
  readonly statusCode = 409;
  readonly code = 'PAGE_STATE';

  constructor(message: string) {
    super(message);
    this.name = 'PageStateError';
  }
}

export class HandleMismatchError extends Error {
  readonly statusCode = 400;
  readonly code = 'HANDLE_MISMATCH';

  constructor() {
    super('Type the page’s handle exactly to delete it.');
    this.name = 'HandleMismatchError';
  }
}

const PAGE_SELECT = {
  id: true,
  handle: true,
  displayName: true,
  language: true,
  paidUntil: true,
  suspendedAt: true,
  account: { select: { email: true } },
} satisfies Prisma.PageSelect;

type AdminPage = Prisma.PageGetPayload<{ select: typeof PAGE_SELECT }>;

async function loadPage(tx: Prisma.TransactionClient, id: string): Promise<AdminPage> {
  const page = await tx.page.findUnique({ where: { id }, select: PAGE_SELECT });
  if (!page) throw new PageNotFoundError();
  return page;
}

function audit(
  tx: Prisma.TransactionClient,
  actor: AdminActor,
  page: { id: string; handle: string },
  action: (typeof ADMIN_ACTIONS)[keyof typeof ADMIN_ACTIONS],
  reason: string,
  metadata?: Prisma.InputJsonValue,
) {
  return writeAudit(tx, {
    adminUserId: actor.adminId,
    action,
    targetType: 'Page',
    targetId: page.id,
    targetLabel: page.handle,
    reason,
    metadata,
    ip: actor.ip,
  });
}

/** After the change has committed; a mail that cannot be queued never undoes it. */
async function mailOwner(
  deps: AdminPagesDeps,
  page: AdminPage,
  build: typeof pageSuspendedMail,
  reason: string,
): Promise<void> {
  try {
    const mail = build({
      displayName: page.displayName,
      reason,
      appUrl: process.env.APP_URL ?? 'http://localhost:3000',
      language: page.language,
    });
    await deps.mailQueue.add(
      MAIL_QUEUE,
      { to: page.account.email, ...mail },
      { attempts: 5, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: true },
    );
  } catch (error) {
    deps.log?.warn?.(
      { pageId: page.id, err: error instanceof Error ? error.message : String(error) },
      'could not queue the admin email',
    );
  }
}

export async function suspendPage(deps: AdminPagesDeps, actor: AdminActor, id: string, reason: string): Promise<void> {
  const page = await deps.prisma.$transaction(async (tx) => {
    const found = await loadPage(tx, id);
    // Conditional, so two admins suspending together write one row.
    const claimed = await tx.page.updateMany({
      where: { id, suspendedAt: null },
      data: { suspendedAt: new Date(), suspendReason: reason },
    });
    if (claimed.count === 0) throw new PageStateError('That page is already suspended.');
    await audit(tx, actor, found, ADMIN_ACTIONS.SUSPENDED_PAGE, reason);
    return found;
  });
  await mailOwner(deps, page, pageSuspendedMail, reason);
}

export async function unsuspendPage(deps: AdminPagesDeps, actor: AdminActor, id: string, reason: string): Promise<void> {
  const page = await deps.prisma.$transaction(async (tx) => {
    const found = await loadPage(tx, id);
    const claimed = await tx.page.updateMany({
      where: { id, suspendedAt: { not: null } },
      data: { suspendedAt: null, suspendReason: null },
    });
    if (claimed.count === 0) throw new PageStateError('That page is not suspended.');
    await audit(tx, actor, found, ADMIN_ACTIONS.UNSUSPENDED_PAGE, reason);
    return found;
  });
  await mailOwner(deps, page, pageRestoredMail, reason);
}

export async function grantMonth(deps: AdminPagesDeps, actor: AdminActor, id: string, reason: string): Promise<void> {
  await deps.prisma.$transaction(async (tx) => {
    // Lock the row first and read paidUntil after, so a second grant at the same moment
    // waits, then extends from the first's result: two rows, two months, no disagreement.
    await tx.$queryRaw`SELECT "id" FROM "Page" WHERE "id" = ${id} FOR UPDATE`;
    const page = await loadPage(tx, id);
    const now = new Date();
    const grantedUntil = extendPaidUntil({ paidUntil: page.paidUntil, plan: 'MONTHLY', now });
    await tx.payment.create({
      data: {
        pageId: page.id,
        pageHandle: page.handle,
        ownerEmail: page.account.email,
        provider: 'GRANT',
        plan: 'MONTHLY',
        amountCents: 0,
        status: 'PAID',
        paidAt: now,
        grantedUntil,
      },
    });
    await tx.page.update({ where: { id }, data: { paidUntil: grantedUntil } });
    await audit(tx, actor, page, ADMIN_ACTIONS.GRANTED_MONTH, reason, { paidUntil: grantedUntil.toISOString() });
  });
}

export async function resetConversations(deps: AdminPagesDeps, actor: AdminActor, id: string, reason: string): Promise<void> {
  await deps.prisma.$transaction(async (tx) => {
    const page = await loadPage(tx, id);
    const period = currentPeriod();
    await tx.usageCounter.upsert({
      where: { pageId_period: { pageId: id, period } },
      create: { pageId: id, period, count: 0, capMailedAt: null },
      update: { count: 0, capMailedAt: null },
    });
    await audit(tx, actor, page, ADMIN_ACTIONS.RESET_CONVERSATIONS, reason, { period });
  });
}

export async function viewAsOwner(deps: AdminPagesDeps, actor: AdminActor, id: string, reason: string): Promise<void> {
  await deps.prisma.$transaction(async (tx) => {
    const page = await loadPage(tx, id);
    await audit(tx, actor, page, ADMIN_ACTIONS.VIEWED_AS_OWNER, reason);
  });
}

export async function deleteAccount(
  deps: AdminPagesDeps,
  actor: AdminActor,
  id: string,
  reason: string,
  handle: string,
): Promise<void> {
  const { keys, digitalKeys } = await deps.prisma.$transaction(async (tx) => {
    // Lock the row first: a second delete at the same moment waits, then finds no page.
    await tx.$queryRaw`SELECT "id" FROM "Page" WHERE "id" = ${id} FOR UPDATE`;
    const page = await loadPage(tx, id);
    if (handle.trim().toLowerCase() !== page.handle.toLowerCase()) throw new HandleMismatchError();

    // Everything stored for the page, read before the rows go.
    const [row, items, orders, digital] = await Promise.all([
      tx.page.findUniqueOrThrow({
        where: { id },
        select: { accountId: true, avatarKey: true, coverKey: true, paymentQrKey: true },
      }),
      tx.item.findMany({ where: { pageId: id, photoKey: { not: null } }, select: { photoKey: true } }),
      tx.order.findMany({ where: { pageId: id, receiptKey: { not: null } }, select: { receiptKey: true } }),
      tx.itemFile.findMany({ where: { item: { pageId: id } }, select: { key: true } }),
    ]);

    // Payments outlive the page (pageId goes null). Checkout does not fill these two
    // columns yet, so they are copied here, covering rows made after any backfill.
    await tx.payment.updateMany({
      where: { pageId: id },
      data: { pageHandle: page.handle, ownerEmail: page.account.email },
    });
    await audit(tx, actor, page, ADMIN_ACTIONS.DELETED_ACCOUNT, reason, { email: page.account.email });
    await tx.account.delete({ where: { id: row.accountId } });

    const stored = [
      row.avatarKey,
      row.coverKey && !stockCoverName(row.coverKey) ? row.coverKey : null,
      row.paymentQrKey,
      ...items.map((i) => i.photoKey),
      ...orders.map((o) => o.receiptKey),
    ];
    return { keys: stored.filter((key): key is string => Boolean(key)), digitalKeys: digital.map((f) => f.key) };
  });

  const priv = deps.privateFiles;
  if (priv) {
    await Promise.all(
      digitalKeys.map((key) =>
        priv.remove(key).catch((error: unknown) =>
          deps.log?.warn?.(
            { pageId: id, key, err: error instanceof Error ? error.message : String(error) },
            'a deleted page’s file could not be removed',
          ),
        ),
      ),
    );
  }

  const store = deps.store;
  if (!store) return;
  await Promise.all(
    keys.map((key) =>
      store.remove(key).catch((error: unknown) =>
        deps.log?.warn?.(
          { pageId: id, key, err: error instanceof Error ? error.message : String(error) },
          'a deleted page’s file could not be removed',
        ),
      ),
    ),
  );
}
