import { listReportGroups } from '@curios/db-read/admin';
import { requireAdmin } from '../require-admin.js';
import { ReportsScreen } from './reports-screen.js';

export const dynamic = 'force-dynamic';

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ status?: string | string[] }> }) {
  await requireAdmin();
  const asked = (await searchParams).status;
  const status = (Array.isArray(asked) ? asked[0] : asked) === 'closed' ? 'closed' : 'open';
  const now = new Date();
  const [open, closed] = await Promise.all([listReportGroups({ status: 'open', now }), listReportGroups({ status: 'closed', now })]);

  return <ReportsScreen open={open} closed={closed} status={status} now={now} />;
}
