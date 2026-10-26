import { config } from 'dotenv';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { prisma } from '@curios/db';
import { redrawDuitNowQr, REDRAWN_PREFIX } from '../apps/api/src/modules/store/payment-qr.js';
import { createS3Store } from '../apps/api/src/modules/pages/storage.js';

// Resolved from this file's own location rather than the cwd, same as the other scripts.
config({ path: join(import.meta.dirname, '..', '.env') });

/**
 * ONE-OFF. Redraws every payment QR uploaded before uploads were redrawn
 * (apps/api/src/modules/store/payment-qr.ts), so every order page shows the
 * pink DuitNow QR rather than the owner's photo of one.
 *
 *   pnpm exec tsx scripts/redraw-payment-qrs.ts           # says what it would do
 *   pnpm exec tsx scripts/redraw-payment-qrs.ts --write   # does it
 *
 * Against whatever DATABASE_URL and STORAGE_* point at -- check both first.
 * Safe to re-run: a redrawn QR's file name starts with REDRAWN_PREFIX and is
 * skipped. A photo with no readable DuitNow QR is left exactly as it is and
 * listed at the end, for the owner to be asked for a clearer one: the shop
 * keeps a way to pay either way.
 */
const write = process.argv.includes('--write');
const publicBase = process.env.STORAGE_PUBLIC_URL?.replace(/\/+$/, '');
if (!publicBase) throw new Error('STORAGE_PUBLIC_URL is not set');
const store = createS3Store();

const pages = await prisma.page.findMany({
  where: { paymentQrKey: { not: null } },
  select: { id: true, handle: true, paymentQrKey: true },
});
const pending = pages.filter((page) => !page.paymentQrKey!.split('/').pop()!.startsWith(REDRAWN_PREFIX));
console.log(`${pages.length} QRs, ${pending.length} not redrawn yet${write ? '' : ' (dry run: add --write to change anything)'}`);

const unreadable: string[] = [];
for (const page of pending) {
  const old = page.paymentQrKey!;
  const response = await fetch(`${publicBase}/${old}`, { signal: AbortSignal.timeout(15_000) }).catch(() => null);
  if (!response?.ok) {
    unreadable.push(`${page.handle} (could not fetch ${old})`);
    continue;
  }
  const png = await redrawDuitNowQr(Buffer.from(await response.arrayBuffer())).catch(() => null);
  if (!png) {
    unreadable.push(page.handle);
    continue;
  }
  if (!write) {
    console.log(`would redraw ${page.handle}`);
    continue;
  }
  const key = `qr/${page.id}/${REDRAWN_PREFIX}${randomUUID()}.png`;
  await store.put(key, png, 'image/png');
  // Only if the QR is still the one this read: an owner replacing it meanwhile wins.
  const { count } = await prisma.page.updateMany({ where: { id: page.id, paymentQrKey: old }, data: { paymentQrKey: key } });
  if (count === 1) {
    await store.remove(old).catch((error: unknown) => console.warn(`${page.handle}: old QR not removed (${String(error)})`));
    console.log(`redrew ${page.handle}`);
  } else {
    await store.remove(key).catch(() => undefined);
    console.log(`${page.handle} changed its QR meanwhile; left alone`);
  }
}

if (unreadable.length) console.log(`\nNo DuitNow QR could be read for ${unreadable.length}, left as they were:\n  ${unreadable.join('\n  ')}`);
await prisma.$disconnect();
