import { config } from 'dotenv';
import { join } from 'node:path';
import { prisma } from '@curios/db';

// Resolved from this file's own location, not the cwd, so `pnpm exec tsx
// scripts/seed-dev.ts` (and `tsx watch` in apps/api, apps/workers) all find
// the repo-root .env regardless of where the command is invoked from. Same
// trap vitest.setup.ts documents for the test suite.
config({ path: join(import.meta.dirname, '..', '.env') });

// Mirrors packages/core/src/normalize.ts's normalizeClaim without adding
// another workspace dependency to this script.
function normalizeClaim(input: string): string {
  return input
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

const account = await prisma.account.upsert({
  where: { email: 'nadia@example.com' },
  update: {},
  create: {
    email: 'nadia@example.com',
    name: 'Nadia',
    identities: {
      create: { provider: 'GOOGLE', providerUserId: 'dev-sub-1', email: 'nadia@example.com' },
    },
    pages: {
      create: {
        handle: 'nadia',
        displayName: 'Nadia Bakes',
        bio: 'Kek butter dan brownies, Shah Alam',
        language: 'ms',
        published: true,
        links: {
          create: [
            { label: 'WhatsApp', url: 'https://wa.me/60123456789', position: 0 },
            { label: 'Instagram', url: 'https://instagram.com/example', position: 1 },
          ],
        },
        neverSay: { create: { phrase: 'halal certified' } },
      },
    },
  },
  include: { pages: true },
});

const pageId = account.pages[0]?.id;

// Realistic, directly owner-verified facts (as if reviewed by hand, not
// crawled) — enough volume to clear Haiku's ~2048-token prompt-caching
// minimum, so the cached system-prompt prefix can actually be exercised in
// dev instead of only in theory. Not exhaustive, not deduplicated against
// whatever a real crawl of the seeded sourceUrl produced; createMany with
// skipDuplicates makes re-running this script safe.
type SeedCategory = 'PRICE' | 'HOURS' | 'LOCATION' | 'POLICY' | 'PRODUCT' | 'PERSON' | 'MISC';

const seedFacts: Array<{ category: SeedCategory; claim: string }> = [
  { category: 'PRICE', claim: 'Kek butter 1kg harganya RM95.' },
  { category: 'PRICE', claim: 'Kek butter 2kg harganya RM160.' },
  { category: 'PRICE', claim: 'Brownies fudge kotak 12 keping harganya RM45.' },
  { category: 'PRICE', claim: 'Caramel brownies kotak 12 keping harganya RM50.' },
  { category: 'PRICE', claim: 'Cupcake sedozen harganya RM60.' },
  { category: 'PRICE', claim: 'Kek coklat lava 1kg harganya RM110.' },
  { category: 'PRICE', claim: 'Kek red velvet 1kg harganya RM120.' },
  { category: 'PRICE', claim: 'Kek pandan gula Melaka 1kg harganya RM100.' },
  { category: 'PRICE', claim: 'Minimum tempahan untuk penghantaran ialah RM80.' },
  { category: 'PRICE', claim: 'Caj penghantaran dalam kawasan Shah Alam ialah RM10.' },
  { category: 'PRICE', claim: 'Caj penghantaran ke kawasan Klang Valley bermula dari RM15.' },
  { category: 'PRICE', claim: 'Caj tambahan untuk pilihan tanpa gluten ialah RM10 setiap kek.' },
  { category: 'HOURS', claim: 'Kedai beroperasi Isnin hingga Jumaat, 9 pagi hingga 6 petang.' },
  { category: 'HOURS', claim: 'Kedai tutup pada hari Sabtu dan Ahad.' },
  { category: 'HOURS', claim: 'Tempahan segera pada hari yang sama hanya diterima sebelum 12 tengahari.' },
  { category: 'HOURS', claim: 'Waktu ambil sendiri di kedai ialah 10 pagi hingga 5 petang.' },
  { category: 'HOURS', claim: 'Tiada operasi pada cuti hari kelepasan am.' },
  { category: 'LOCATION', claim: 'Kedai terletak di Seksyen 7, Shah Alam, Selangor.' },
  { category: 'LOCATION', claim: 'Alamat penuh ialah No 12, Jalan Kristal 7, Seksyen 7, 40000 Shah Alam.' },
  { category: 'LOCATION', claim: 'Tiada kedai fizikal untuk walk-in, semua tempahan dibuat secara online.' },
  { category: 'LOCATION', claim: 'Penghantaran hanya meliputi kawasan Shah Alam dan Klang Valley.' },
  { category: 'LOCATION', claim: 'Buat masa ini tiada perkhidmatan penghantaran ke luar Semenanjung Malaysia.' },
  { category: 'POLICY', claim: 'Tempahan mesti dibuat sekurang-kurangnya 3 hari sebelum tarikh penghantaran.' },
  { category: 'POLICY', claim: 'Bayaran penuh diperlukan semasa tempahan disahkan.' },
  { category: 'POLICY', claim: 'Tiada bayaran balik selepas tempahan disahkan.' },
  { category: 'POLICY', claim: 'Pertukaran tarikh penghantaran dibenarkan jika dimaklumkan sekurang-kurangnya 2 hari lebih awal.' },
  { category: 'POLICY', claim: 'Kek dengan design custom memerlukan tempoh penyediaan 5 hari.' },
  { category: 'POLICY', claim: 'Semua produk dibuat segar mengikut tempahan, tiada stok simpanan beku.' },
  { category: 'POLICY', claim: 'Pembayaran diterima melalui online transfer dan DuitNow QR sahaja.' },
  { category: 'PRODUCT', claim: 'Kek butter tersedia dalam perisa original, pandan, dan coklat.' },
  { category: 'PRODUCT', claim: 'Brownies fudge tersedia dalam versi classic dan walnut.' },
  { category: 'PRODUCT', claim: 'Cupcake tersedia dalam enam perisa: vanilla, coklat, red velvet, pandan, oreo, dan salted caramel.' },
  { category: 'PRODUCT', claim: 'Saiz kek yang ditawarkan ialah 6 inci, 8 inci, dan 10 inci.' },
  { category: 'PRODUCT', claim: 'Kek saiz 6 inci sesuai untuk 6 hingga 8 orang.' },
  { category: 'PRODUCT', claim: 'Kek saiz 8 inci sesuai untuk 12 hingga 15 orang.' },
  { category: 'PRODUCT', claim: 'Semua brownies dibungkus dalam kotak mesra alam.' },
  { category: 'PRODUCT', claim: 'Produk tidak menggunakan sebarang pewarna makanan buatan.' },
  { category: 'PERSON', claim: 'Nadia ialah pengasas dan baker utama Nadia Bakes.' },
  { category: 'PERSON', claim: 'Nadia mempunyai pengalaman membuat kek sejak tahun 2015.' },
  { category: 'PERSON', claim: 'Semua tempahan diuruskan terus oleh Nadia melalui WhatsApp.' },
  { category: 'MISC', claim: 'Nadia Bakes bermula sebagai perniagaan rumah pada tahun 2018.' },
  { category: 'MISC', claim: 'Susu pekat dan mentega yang digunakan adalah jenama tempatan berkualiti.' },
];

if (pageId) {
  const { count } = await prisma.fact.createMany({
    data: seedFacts.map((f) => ({
      pageId,
      category: f.category,
      claim: f.claim,
      normalizedClaim: normalizeClaim(f.claim),
      confidence: 1,
      verified: true,
    })),
    skipDuplicates: true,
  });
  console.log('facts inserted:', count, '(of', seedFacts.length, 'candidates)');
}

console.log('page id:', pageId);
console.log('visit:   http://localhost:3000/nadia');
await prisma.$disconnect();
