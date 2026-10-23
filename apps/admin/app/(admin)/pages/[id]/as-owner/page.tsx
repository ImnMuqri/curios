import { notFound, redirect } from 'next/navigation';
import { getOwnerView, hasRecentOwnerView } from '@curios/db-read/admin';
import { requireAdmin } from '../../../require-admin.js';
import { OwnerView } from './owner-view.js';

export const dynamic = 'force-dynamic';

/** How long after the dialog's logged reason this admin may keep opening the view. */
const LOGGED_FOR_MS = 15 * 60_000;

/**
 * Read-only and writes nothing itself. Seeing a page as its owner must leave an audit row, and
 * the VIEWED_AS_OWNER row is written by the dialog's POST /admin/pages/:id/view-as-owner before
 * it navigates here. So this page renders only while this admin has such a row for this page
 * from the last 15 minutes (a refresh still works); a bookmark, history entry or shared link
 * goes back to the page panel, where the dialog asks for a reason.
 */
export default async function AsOwnerPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  const { id } = await params;
  const logged = await hasRecentOwnerView({
    adminUserId: admin.adminUserId,
    pageId: id,
    since: new Date(Date.now() - LOGGED_FOR_MS),
  });
  if (!logged) redirect(`/pages?page=${encodeURIComponent(id)}`);

  const view = await getOwnerView(id);
  if (!view) notFound();

  return <OwnerView view={view} pageId={id} />;
}
