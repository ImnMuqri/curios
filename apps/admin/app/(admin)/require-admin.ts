import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ADMIN_COOKIE } from '@curios/core/admin';
import { getAdminSession } from '@curios/db-read/admin';

/**
 * The admin session behind this request, or a redirect to /signin. Next does not stop a
 * page from running because its layout redirected, so every page calls this before it
 * reads anything.
 */
export async function requireAdmin(): Promise<{ adminUserId: string; name: string; email: string }> {
  const value = (await cookies()).get(ADMIN_COOKIE)?.value;
  const session = value ? await getAdminSession(value) : null;
  if (!session) redirect('/signin');
  return session;
}
