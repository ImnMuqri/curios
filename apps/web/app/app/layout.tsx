import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE } from '@curios/core';
import { resolveOwner } from './session.js';

/**
 * The second of the three session layers, and the first that proves anything.
 *
 * Middleware already redirected anyone with no cookie at all. What reaches
 * here is a cookie that exists and may still be expired, revoked or forged,
 * and this is where the database is asked.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const value = (await cookies()).get(SESSION_COOKIE)?.value;
  const owner = await resolveOwner(value);

  if (!owner) redirect('/signin');

  return <main className="app-shell">{children}</main>;
}
