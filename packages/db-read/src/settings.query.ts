import { createSettingsCache, resolveSettings, type Settings } from '@curios/core/settings';
import { prismaRead } from './client.js';

// Per process, 30 s, the same window as the API's reader. Two instances can differ for that long.
const cache = createSettingsCache(
  async () => {
    const rows = await prismaRead.systemSetting.findMany({ select: { key: true, value: true } });
    return resolveSettings(rows, (key) => console.warn(`system setting ${key} has a value of the wrong shape; using the default`));
  },
  { onError: (err) => console.warn('could not read system settings; using the last good value or the defaults', err) },
);

/**
 * The settings in force. Falls back to the defaults when the database can't be reached, which is
 * what lets a build with no database still produce its pages.
 */
export function getSettings(): Promise<Settings> {
  return cache.get();
}

/** For tests: forget what was read. */
export function clearSettingsCache(): void {
  cache.clear();
}
