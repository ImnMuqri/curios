import { clearSettingsCache, getSettings } from '@curios/db-read';
import { requireAdmin } from '../require-admin.js';
import { ControlsScreen } from './controls-screen.js';

export const dynamic = 'force-dynamic';

export default async function ControlsPage() {
  await requireAdmin();
  // The reader keeps what it read for 30 seconds. This screen is where the admin has just changed
  // a setting and expects to see it, so it asks the database each time.
  clearSettingsCache();
  const settings = await getSettings();
  return <ControlsScreen settings={settings} />;
}
