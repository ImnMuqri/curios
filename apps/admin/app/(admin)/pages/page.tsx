import { getAdminPage, listAdminPages, type PageFilter } from '@curios/db-read/admin';
import { requireAdmin } from '../require-admin.js';
import { PagesScreen } from './pages-screen.js';

export const dynamic = 'force-dynamic';

const FILTERS: PageFilter[] = ['all', 'business', 'personal', 'lapsed', 'flagged'];

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Rows a screen shows; `?p=2` is the next fifty, newest first (`page` is taken: the open page's id). */
const ROWS_PER_PAGE = 50;

export default async function PagesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[]; filter?: string | string[]; page?: string | string[]; p?: string | string[] }>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const q = one(sp.q)?.trim() ?? '';
  const asked = one(sp.filter);
  const filter = FILTERS.find((f) => f === asked) ?? 'all';
  const pageId = one(sp.page);
  const pageNumber = Math.max(1, Number.parseInt(one(sp.p) ?? '1', 10) || 1);

  const [rows, detail] = await Promise.all([
    // One more than a screen, only to know whether to offer the next.
    listAdminPages({ q: q || undefined, filter, limit: ROWS_PER_PAGE + 1, offset: (pageNumber - 1) * ROWS_PER_PAGE }),
    pageId ? getAdminPage(pageId) : Promise.resolve(null),
  ]);

  return (
    <PagesScreen
      rows={rows.slice(0, ROWS_PER_PAGE)}
      paging={{ page: pageNumber, hasNext: rows.length > ROWS_PER_PAGE }}
      q={q}
      filter={filter}
      selectedId={detail ? pageId : undefined}
      detail={detail}
      appUrl={(process.env.APP_URL ?? 'http://localhost:3000').replace(/\/+$/, '')}
    />
  );
}
