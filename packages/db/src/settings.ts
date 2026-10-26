import type { PrismaClient } from '@prisma/client';
import { createSettingsCache, resolveSettings, type Settings } from '@curios/core/settings';

/**
 * The API's and the workers' view of the settings, cached for `ttlMs` (30 s). The writer calls
 * `clear()` after a change so the instance that made it sees it at once; others catch up within
 * the window. Never throws: a database that can't be reached gives the last good value or the
 * defaults, and a warning.
 */
export function createSettingsReader(
  prisma: Pick<PrismaClient, 'systemSetting'>,
  opts: { ttlMs?: number; log?: { warn: (obj: object, msg?: string) => void } } = {},
): { get(): Promise<Settings>; clear(): void } {
  return createSettingsCache(
    async () => {
      const rows = await prisma.systemSetting.findMany({ select: { key: true, value: true } });
      return resolveSettings(rows, (key) => opts.log?.warn({ key }, 'system setting has a value of the wrong shape; using the default'));
    },
    { ttlMs: opts.ttlMs, onError: (err) => opts.log?.warn({ err }, 'could not read system settings; using the last good value or the defaults') },
  );
}
