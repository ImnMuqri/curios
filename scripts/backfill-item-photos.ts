import { config } from 'dotenv';
import { join } from 'node:path';
import { prisma } from '@curios/db';
import { backfillItemPhotos } from '../apps/api/src/modules/store/backfill-item-photos.js';
import { resolveStore } from '../apps/api/src/modules/pages/storage.js';
import { resolvePrivateFiles } from '../apps/api/src/modules/store/private-files.js';

// Resolved from this file's own location rather than the cwd, same as the other scripts.
config({ path: join(import.meta.dirname, '..', '.env') });

/**
 * ONE-OFF. Run right after the deploy that ships item photos.
 *
 * Every item that had a cover before photos existed has a `photoKey` and no
 * photo rows. This gives each one a row of its own: the old cover's bytes as a
 * new private original and as a new public square, under new keys, framed as the
 * largest centred square. `photoKey` is left as it is.
 *
 *   pnpm exec tsx scripts/backfill-item-photos.ts           # says what it would do
 *   pnpm exec tsx scripts/backfill-item-photos.ts --write   # does it
 *
 * Against whatever DATABASE_URL and STORAGE_* point at -- check both first.
 * Safe to re-run: only items with no photo rows are picked. A cover that cannot
 * be fetched or read is left exactly as it is and listed at the end.
 */
const write = process.argv.includes('--write');
const publicBase = process.env.STORAGE_PUBLIC_URL?.replace(/\/+$/, '');
if (!publicBase) throw new Error('STORAGE_PUBLIC_URL is not set');
const store = resolveStore(undefined);
if (!store) throw new Error('Public storage is not configured (STORAGE_*)');
const privateFiles = resolvePrivateFiles(undefined);
if (!privateFiles) throw new Error('Private storage is not configured (STORAGE_* / private files)');

const result = await backfillItemPhotos({
  prisma,
  store,
  privateFiles,
  write,
  log: (line) => console.log(line),
  fetchPublic: async (key) => {
    const response = await fetch(`${publicBase}/${key}`, { signal: AbortSignal.timeout(15_000) }).catch(() => null);
    return response?.ok ? Buffer.from(await response.arrayBuffer()) : null;
  },
});

console.log(
  `\n${result.candidates} item(s) with a cover and no photo rows, ${result.copied} copied${write ? '' : ' (dry run: add --write to change anything)'}`,
);
if (result.unreadable.length) console.log(`\nNot readable, left as they were:\n  ${result.unreadable.join('\n  ')}`);
await prisma.$disconnect();
