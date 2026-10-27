import { getPayments } from '@curios/db-read/admin';
import { parsePeriod } from '../period.js';
import { requireAdmin } from '../require-admin.js';
import { PaymentsScreen } from './payments-screen.js';

export const dynamic = 'force-dynamic';

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<{ period?: string | string[] }> }) {
  await requireAdmin();
  const period = parsePeriod((await searchParams).period);
  const now = new Date();

  return <PaymentsScreen payments={await getPayments(period, now)} period={period} now={now} />;
}
