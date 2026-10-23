import { getAdminPage, listAdminPages, type PageFilter } from '@curios/db-read/admin';
import { requireAdmin } from '../require-admin.js';
import { PagesScreen } from './pages-screen.js';

export const dynamic = 'force-dynamic';

const FILTERS: PageFilter[] = ['all', 'business', 'personal', 'lapsed', 'flagged'];

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function PagesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[]; filter?: string | string[]; page?: string | string[] }>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const q = one(sp.q)?.trim() ?? '';
  const asked = one(sp.filter);
  const filter = FILTERS.find((f) => f === asked) ?? 'all';
  const pageId = one(sp.page);

  const [rows, detail] = await Promise.all([
    listAdminPages({ q: q || undefined, filter }),
    pageId ? getAdminPage(pageId) : Promise.resolve(null),
  ]);

  return (
    <PagesScreen
      rows={rows}
      q={q}
      filter={filter}
      selectedId={detail ? pageId : undefined}
      detail={detail}
      appUrl={(process.env.APP_URL ?? 'http://localhost:3000').replace(/\/+$/, '')}
    />
  );
}
