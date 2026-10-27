import { getSettings } from '@curios/db-read';
import { getAiUsage } from '@curios/db-read/admin';
import { parsePeriod } from '../period.js';
import { requireAdmin } from '../require-admin.js';
import { AiScreen } from './ai-screen.js';

export const dynamic = 'force-dynamic';

export default async function AiPage({ searchParams }: { searchParams: Promise<{ period?: string | string[] }> }) {
  await requireAdmin();
  const period = parsePeriod((await searchParams).period);
  const now = new Date();
  // The cap in force, which getAiUsage measured "near the limit" against.
  const [usage, { cap }] = await Promise.all([getAiUsage(period, now), getSettings()]);

  return <AiScreen usage={usage} period={period} cap={cap} now={now} />;
}
