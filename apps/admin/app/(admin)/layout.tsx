import type { ReactNode } from 'react';
import { requireAdmin } from './require-admin.js';
import { Shell } from './shell.js';

// Reads the cookie and the database on every request.
export const dynamic = 'force-dynamic';

/**
 * The real gate: middleware only checks the cookie is present. A missing,
 * forged, expired or disabled-admin session is treated as signed out.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await requireAdmin();

  return <Shell adminName={session.name}>{children}</Shell>;
}
