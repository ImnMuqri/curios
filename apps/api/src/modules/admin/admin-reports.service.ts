import { ADMIN_ACTIONS, reportWarningMail } from '@curios/core';
import type { Prisma } from '@curios/db';
import { audit, loadPage, mailOwner, type AdminActor, type AdminPagesDeps } from './admin-pages.service.js';

export class NoOpenReportsError extends Error {
  readonly statusCode = 409;
  readonly code = 'NO_OPEN_REPORTS';

  constructor() {
    super('That page has no open reports.');
    this.name = 'NoOpenReportsError';
  }
}

/** Every OPEN report on the page becomes `status`; returns how many, and throws when none were open. */
async function closeOpenReports(
  tx: Prisma.TransactionClient,
  actor: AdminActor,
  pageId: string,
  status: 'DISMISSED' | 'ACTED',
): Promise<number> {
  // Conditional, so two admins deciding together write one audit row.
  const closed = await tx.report.updateMany({
    where: { pageId, status: 'OPEN' },
    data: { status, decidedById: actor.adminId, decidedAt: new Date() },
  });
  if (closed.count === 0) throw new NoOpenReportsError();
  return closed.count;
}

export async function dismissReports(deps: AdminPagesDeps, actor: AdminActor, id: string, reason: string): Promise<void> {
  await deps.prisma.$transaction(async (tx) => {
    const page = await loadPage(tx, id);
    const count = await closeOpenReports(tx, actor, id, 'DISMISSED');
    await audit(tx, actor, page, ADMIN_ACTIONS.DISMISSED_REPORTS, reason, { count });
  });
}

export async function emailOwnerAboutReports(
  deps: AdminPagesDeps,
  actor: AdminActor,
  id: string,
  reason: string,
): Promise<void> {
  const page = await deps.prisma.$transaction(async (tx) => {
    const found = await loadPage(tx, id);
    const count = await closeOpenReports(tx, actor, id, 'ACTED');
    await audit(tx, actor, found, ADMIN_ACTIONS.EMAILED_OWNER, reason, { count });
    return found;
  });
  await mailOwner(deps, page, reportWarningMail, reason);
}
