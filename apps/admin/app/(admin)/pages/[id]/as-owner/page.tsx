import { notFound } from 'next/navigation';
import { getOwnerView } from '@curios/db-read/admin';
import { requireAdmin } from '../../../require-admin.js';
import { OwnerView } from './owner-view.js';

export const dynamic = 'force-dynamic';

/**
 * Read-only and writes nothing. The VIEWED_AS_OWNER audit row is written by the dialog's
 * POST /admin/pages/:id/view-as-owner before it navigates here, so a direct visit to this
 * URL renders without leaving a row.
 */
export default async function AsOwnerPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const view = await getOwnerView(id);
  if (!view) notFound();

  return <OwnerView view={view} pageId={id} />;
}
