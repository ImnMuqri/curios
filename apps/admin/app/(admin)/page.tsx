import { conversationCap } from '@curios/core';
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
  const overview = await getOverview(period, new Date());

  return <Overview overview={overview} period={period} cap={conversationCap()} />;
}
