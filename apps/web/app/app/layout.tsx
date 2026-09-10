import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
// The barrel here, unlike middleware.ts. This file runs on Node, so the
// barrel's transitive node:crypto import is fine. The split between the two
// is deliberate -- see the comment in middleware.ts.
import { SESSION_COOKIE } from '@curios/core';
import { Shell } from '@curios/ui';
import { AppNav } from './app-nav.js';
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

  // Shell, not className="app-shell" -- that class was never defined in any
  // stylesheet in this repo, so it styled nothing from the day it was written.
  return (
    <Shell>
      <AppNav />
      {children}
    </Shell>
  );
}
