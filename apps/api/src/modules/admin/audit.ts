import type { Prisma, PrismaClient } from '@curios/db';
import type { ADMIN_ACTIONS } from '@curios/core';

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
  tx: Prisma.TransactionClient | PrismaClient,
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
