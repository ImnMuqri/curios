import { getSettings } from '@curios/db-read';
import { getSourceStats, listSources, type SourceFilter } from '@curios/db-read/admin';
import { requireAdmin } from '../require-admin.js';
import { SourcesScreen } from './sources-screen.js';

export const dynamic = 'force-dynamic';

const FILTERS: SourceFilter[] = ['all', 'running', 'failed', 'done'];

export default async function SourcesPage({ searchParams }: { searchParams: Promise<{ filter?: string | string[] }> }) {
  await requireAdmin();
  const asked = (await searchParams).filter;
  const filter = FILTERS.find((f) => f === (Array.isArray(asked) ? asked[0] : asked)) ?? 'all';
  const now = new Date();
  const [rows, stats, settings] = await Promise.all([listSources({ filter }), getSourceStats(now), getSettings()]);

  return <SourcesScreen rows={rows} stats={stats} filter={filter} readingOn={settings.switches.reading} now={now} />;
}
