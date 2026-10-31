import { requireAdmin } from '../require-admin.js';
import { SupportScreen } from './support-screen.js';

export const dynamic = 'force-dynamic';

/**
 * Only the admin check runs here. Support mail is withheld from the read-only role, so the admin's
 * own database reads cannot see it: the screen loads everything from the API in the browser.
 */
export default async function SupportPage() {
  await requireAdmin();
  return <SupportScreen />;
}
