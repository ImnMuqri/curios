import { getSettings } from '@curios/db-read';
import { getOverview } from '@curios/db-read/admin';
import { Overview } from './overview.js';
import { parsePeriod } from './period.js';
import { requireAdmin } from './require-admin.js';

export const dynamic = 'force-dynamic';

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string | string[] }>;
}) {
  await requireAdmin();
  const period = parsePeriod((await searchParams).period);
  // The cap in force, the admin's, which getOverview counted "at the limit" against.
  const [overview, { cap }] = await Promise.all([getOverview(period, new Date()), getSettings()]);

  return <Overview overview={overview} period={period} cap={cap} />;
}
