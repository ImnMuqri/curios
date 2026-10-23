import { prismaRead } from '../client.js';

export interface AuditRow {
  id: string;
  createdAt: Date;
  adminName: string;
  action: string;
  targetLabel: string;
  reason: string;
}

/** The audit log, newest first. `before` pages backwards: rows strictly older than it. */
export async function getAuditLog(options: { limit?: number; before?: Date } = {}): Promise<AuditRow[]> {
  const rows = await prismaRead.adminAction.findMany({
    where: options.before ? { createdAt: { lt: options.before } } : {},
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: Math.min(Math.max(options.limit ?? 100, 1), 500),
    select: { id: true, createdAt: true, action: true, targetLabel: true, reason: true, adminUser: { select: { name: true } } },
  });

  return rows.map((row) => ({
    id: row.id,
    createdAt: row.createdAt,
    adminName: row.adminUser.name,
    action: row.action,
    targetLabel: row.targetLabel,
    reason: row.reason,
  }));
}
