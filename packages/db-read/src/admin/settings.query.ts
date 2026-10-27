import { resolveSettings, type Settings } from '@curios/core/settings';
import { prismaRead } from '../client.js';

/**
 * The settings as stored, for the one screen that writes them back. Unlike `getSettings`, no cache
 * and no fallback: a read that fails throws. The Controls form sends every value on a save, so a
 * form filled from the defaults would overwrite the real values it could not read.
 */
export async function getStoredSettings(): Promise<Settings> {
  const rows = await prismaRead.systemSetting.findMany({ select: { key: true, value: true } });
  return resolveSettings(rows, (key) => console.warn(`system setting ${key} has a value of the wrong shape; using the default`));
}
