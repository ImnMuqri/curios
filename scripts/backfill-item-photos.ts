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
 * Against whatever DATABASE_URL and STORAGE_* point at -- check both first; the first line it
 * prints names the private store and public base it will use. --write refuses to run unless
 * STORAGE_PRIVATE_BUCKET is set (or NODE_ENV=production), so originals never land on local disk.
 * Safe to re-run: only items with no photo rows are picked. A cover that cannot
 * be fetched or read is left exactly as it is and listed at the end.
 */
const write = process.argv.includes('--write');
const publicBase = process.env.STORAGE_PUBLIC_URL?.replace(/\/+$/, '');
if (!publicBase) throw new Error('STORAGE_PUBLIC_URL is not set');

// resolvePrivateFiles falls back to apps/api/.files on this machine unless the private bucket is
// set or NODE_ENV is production. Against a production database that would put every original on
// the disk of whoever ran the script, with rows pointing at keys the deployed API cannot read.
const privateBucket = process.env.STORAGE_PRIVATE_BUCKET;
const privateIsS3 = Boolean(privateBucket) || process.env.NODE_ENV === 'production';
console.log(
  `Targets -- private originals: ${privateIsS3 ? `S3 bucket ${privateBucket ?? '(STORAGE_PRIVATE_BUCKET not set)'}` : 'local disk (apps/api/.files)'}; ` +
    `public squares and covers: bucket ${process.env.STORAGE_BUCKET ?? '(STORAGE_BUCKET not set)'}, served at ${publicBase}`,
);
if (write && !privateIsS3) {
  console.error(
    'Refusing to --write: the originals would go to local disk. Set STORAGE_PRIVATE_BUCKET (or NODE_ENV=production) to the bucket the deployed API reads.',
  );
  process.exit(1);
}

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
