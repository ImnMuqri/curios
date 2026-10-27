import { getStoredSettings } from '@curios/db-read/admin';
import { requireAdmin } from '../require-admin.js';
import { ControlsScreen, ControlsUnavailable } from './controls-screen.js';

export const dynamic = 'force-dynamic';

export default async function ControlsPage() {
  await requireAdmin();
  // The stored rows, read fresh and with no fallback: the form sends every value on a save, so one
  // filled from defaults after a failed read would overwrite the real values with them.
  try {
    return <ControlsScreen settings={await getStoredSettings()} />;
  } catch (err) {
    console.error('could not read the settings for the Controls screen', err);
    return <ControlsUnavailable />;
  }
}
