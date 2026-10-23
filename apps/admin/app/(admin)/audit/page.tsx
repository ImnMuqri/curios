import { getAuditLog } from '@curios/db-read/admin';
import { requireAdmin } from '../require-admin.js';
import { AuditLog, AUDIT_PAGE_SIZE } from './audit-log.js';

export const dynamic = 'force-dynamic';

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ before?: string | string[] }>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const raw = Array.isArray(sp.before) ? sp.before[0] : sp.before;
  const parsed = raw ? new Date(raw) : null;
  const before = parsed && !Number.isNaN(parsed.getTime()) ? parsed : undefined;

  const rows = await getAuditLog({ limit: AUDIT_PAGE_SIZE, ...(before ? { before } : {}) });
  return <AuditLog rows={rows} paged={Boolean(before)} />;
}
