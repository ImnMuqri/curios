import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ADMIN_COOKIE } from '@curios/core/admin';
import { getAdminSession } from '@curios/db-read/admin';
import { Shell } from './shell.js';

// Reads the cookie and the database on every request.
export const dynamic = 'force-dynamic';

/**
 * The real gate: middleware only checks the cookie is present. A missing,
 * forged, expired or disabled-admin session is treated as signed out.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const value = (await cookies()).get(ADMIN_COOKIE)?.value;
  const session = value ? await getAdminSession(value) : null;
  if (!session) redirect('/signin');

  return <Shell adminName={session.name}>{children}</Shell>;
}
