import type { Prisma } from '@curios/db';
import type { ADMIN_ACTIONS } from '@curios/core';

/** Who is acting, and from where: the audit row's first columns. */
export interface AdminActor {
  adminId: string;
  ip: string;
}

/**
 * The actor of an admin request. Only behind requireAdmin, which has already refused a request with
 * no admin, so `admin` is there.
 */
export function adminActor(request: { admin: { id: string } | null; ip: string }): AdminActor {
  return { adminId: request.admin!.id, ip: request.ip };
}

export interface AuditEntry {
  adminUserId: string;
  action: (typeof ADMIN_ACTIONS)[keyof typeof ADMIN_ACTIONS];
  targetType: string;
  targetId: string;
  /** What a person reads in the audit table: the handle or email as it was then. */
  targetLabel: string;
  reason: string;
  metadata?: Prisma.InputJsonValue;
  ip: string;
}

/**
 * The only writer of AdminAction. It takes the transaction client so the row
 * lands in the same transaction as the change it records; there is no update
 * or delete for the table anywhere.
 */
export async function writeAudit(
  tx: Prisma.TransactionClient,
  entry: AuditEntry,
): Promise<void> {
  await tx.adminAction.create({
    data: {
      adminUserId: entry.adminUserId,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      targetLabel: entry.targetLabel,
      reason: entry.reason,
      metadata: entry.metadata,
      ip: entry.ip,
    },
  });
}
