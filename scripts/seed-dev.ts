import { config } from 'dotenv';
import { join } from 'node:path';
import { normalizeClaim } from '@curios/core';
import { prisma } from '@curios/db';

// Resolved from this file's own location, not the cwd, so `pnpm exec tsx
// scripts/seed-dev.ts` (and `tsx watch` in apps/api, apps/workers) all find
// the repo-root .env regardless of where the command is invoked from. Same
// trap vitest.setup.ts documents for the test suite.
config({ path: join(import.meta.dirname, '..', '.env') });

// normalizeClaim is both the fact dedupe key and the pinned-answer match key
// -- a copy of it that drifts from packages/core/src/normalize.ts is exactly
// the divergence that package exists to prevent, so it is imported from
// there rather than reimplemented locally.

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
        skeleton: 'nadia',
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
// crawled). The first 42 were sized for a ~2048-token caching minimum, which
// turned out to be wrong for this model: the Claude API reference puts
// claude-haiku-4-5's minimum cacheable prefix at 4096 tokens (the minimum is
// not monotonic across model generations — 512 on the newest models, 1024 on
// Opus 4.8 and Sonnet 5, 4096 on Haiku 4.5). The second batch below exists
// purely to push the system prompt comfortably past that real minimum, so
// the cached prefix can actually be exercised in dev instead of only in
// theory. Not exhaustive, not deduplicated against whatever a real crawl of
// the seeded sourceUrl produced; createMany with skipDuplicates makes
// re-running this script safe.
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

  // --- Second batch: pushes the system prompt past the real 4096-token
  // caching minimum for claude-haiku-4-5 (see comment above). ---
  { category: 'PRICE', claim: 'Kek marble 1kg harganya RM90.' },
  { category: 'PRICE', claim: 'Kek marble 2kg harganya RM150.' },
  { category: 'PRICE', claim: 'Kek oreo cheesecake 1kg harganya RM130.' },
  { category: 'PRICE', claim: 'Kek nutella 1kg harganya RM125.' },
  { category: 'PRICE', claim: 'Mini cupcake sekotak 24 biji harganya RM70.' },
  { category: 'PRICE', claim: 'Cookies jar 500 gram harganya RM35.' },
  { category: 'PRICE', claim: 'Kek lapis Sarawak 1kg harganya RM140.' },
  { category: 'PRICE', claim: 'Kek tart durian 8 inci harganya RM150.' },
  { category: 'PRICE', claim: 'Kek tart durian 10 inci harganya RM190.' },
  { category: 'PRICE', claim: 'Bijirin granola bar sekotak 10 keping harganya RM40.' },
  { category: 'PRICE', claim: 'Muffin pandan sedozen harganya RM55.' },
  { category: 'PRICE', claim: 'Caj hiasan fondant figure tambahan bermula RM20.' },
  { category: 'PRICE', claim: 'Caj penghantaran ekspres pada hari yang sama ialah RM25 tambahan.' },
  { category: 'PRICE', claim: 'Pakej hampers raya bermula RM120.' },
  { category: 'PRICE', claim: 'Pakej hampers krismas bermula RM130.' },
  { category: 'HOURS', claim: 'Waktu operasi semasa bulan Ramadan ialah 10 pagi hingga 4 petang.' },
  { category: 'HOURS', claim: 'Tempahan untuk acara korporat perlu dibuat sekurang-kurangnya seminggu lebih awal.' },
  { category: 'HOURS', claim: 'Talian WhatsApp dibalas dalam masa 24 jam pada waktu bekerja.' },
  { category: 'HOURS', claim: 'Kedai bercuti sepenuhnya semasa cuti tahunan pertengahan tahun selama seminggu.' },
  { category: 'HOURS', claim: 'Pesanan yang dibuat sebelum 2 petang diproses pada hari yang sama.' },
  { category: 'LOCATION', claim: 'Titik pertemuan self pick-up ialah di lobi kondominium berhampiran kedai.' },
  { category: 'LOCATION', claim: 'Kawasan penghantaran percuma ialah dalam radius 5 kilometer dari kedai.' },
  { category: 'LOCATION', claim: 'Tiada perkhidmatan penghantaran ke Pulau Pinang atau negeri utara.' },
  { category: 'LOCATION', claim: 'Tempat letak kereta tersedia berhampiran lokasi pick-up.' },
  { category: 'LOCATION', claim: 'Semua pesanan penghantaran menggunakan Lalamove atau Grab Express.' },
  { category: 'POLICY', claim: 'Pembatalan tempahan selepas bayaran disahkan dikenakan caj pemprosesan 20 peratus.' },
  { category: 'POLICY', claim: 'Kek dengan design custom memerlukan deposit 50 peratus semasa tempahan.' },
  { category: 'POLICY', claim: 'Aduan mengenai kualiti produk perlu dilaporkan dalam masa 24 jam selepas penerimaan.' },
  { category: 'POLICY', claim: 'Gambar rujukan design custom perlu dihantar sekurang-kurangnya 3 hari sebelum tarikh siap.' },
  { category: 'POLICY', claim: 'Tempahan pukal melebihi 10 kek layak untuk diskaun 10 peratus.' },
  { category: 'POLICY', claim: 'Bayaran ansuran tidak ditawarkan buat masa ini.' },
  { category: 'POLICY', claim: 'Resit rasmi disediakan atas permintaan untuk tempahan korporat.' },
  { category: 'POLICY', claim: 'Produk tidak sesuai disimpan lebih daripada 3 hari tanpa peti sejuk.' },
  { category: 'POLICY', claim: 'Setiap kek disertakan arahan penyimpanan bertulis.' },
  { category: 'POLICY', claim: 'Perubahan kuantiti pesanan selepas disahkan tertakluk kepada ketersediaan bahan.' },
  { category: 'POLICY', claim: 'Tiada caj tambahan untuk lilin hari jadi standard.' },
  { category: 'POLICY', claim: 'Susu, telur, dan gluten digunakan dalam kebanyakan produk melainkan dinyatakan sebaliknya.' },
  { category: 'POLICY', claim: 'Senarai bahan penuh boleh diminta melalui WhatsApp sebelum tempahan.' },
  { category: 'POLICY', claim: 'Kupon promosi tidak boleh digabungkan dengan diskaun pukal.' },
  { category: 'POLICY', claim: 'Deposit tidak dikembalikan jika pembatalan dibuat kurang daripada 2 hari sebelum penghantaran.' },
  { category: 'PRODUCT', claim: 'Kek marble tersedia dalam versi original dan pandan.' },
  { category: 'PRODUCT', claim: 'Kek oreo cheesecake dibuat tanpa bake dan disimpan sejuk.' },
  { category: 'PRODUCT', claim: 'Kek nutella menggunakan lapisan ganache coklat hazelnut.' },
  { category: 'PRODUCT', claim: 'Mini cupcake sesuai untuk goodie bag dan pesta kanak-kanak.' },
  { category: 'PRODUCT', claim: 'Cookies jar tersedia dalam perisa chocolate chip dan double choc.' },
  { category: 'PRODUCT', claim: 'Kek lapis Sarawak tersedia dalam corak pelangi dan corak klasik.' },
  { category: 'PRODUCT', claim: 'Kek tart durian menggunakan durian Musang King mengikut musim.' },
  { category: 'PRODUCT', claim: 'Muffin pandan menggunakan santan segar.' },
  { category: 'PRODUCT', claim: 'Semua kek boleh ditambah writing text percuma untuk ucapan ringkas.' },
  { category: 'PRODUCT', claim: 'Design fondant custom dikenakan caj berasingan mengikut tahap kerumitan.' },
  { category: 'PRODUCT', claim: 'Kek vegan tersedia atas tempahan khas dengan tempoh siap lebih lama.' },
  { category: 'PRODUCT', claim: 'Pilihan less-sugar tersedia untuk kebanyakan kek butter.' },
  { category: 'PRODUCT', claim: 'Hampers raya termasuk kombinasi kuih kering dan brownies mini.' },
  { category: 'PRODUCT', claim: 'Hampers krismas termasuk kek buah dan cookies jar.' },
  { category: 'PRODUCT', claim: 'Kek kecil dibungkus dalam kotak mika telus.' },
  { category: 'PRODUCT', claim: 'Kek besar dibungkus dalam kotak kadbod berlogo.' },
  { category: 'PRODUCT', claim: 'Topping segar seperti strawberi dan blueberi tersedia mengikut musim.' },
  { category: 'PRODUCT', claim: 'Kek boleh dipesan tanpa lapisan fondant untuk tampilan naked cake.' },
  { category: 'PRODUCT', claim: 'Saiz kek 4 inci tersedia untuk hantaran individu atau smash cake.' },
  { category: 'PRODUCT', claim: 'Kek saiz 4 inci sesuai untuk 2 hingga 4 orang.' },
  { category: 'PERSON', claim: 'Nadia mendapat latihan asas daripada kelas baking di Kuala Lumpur.' },
  { category: 'PERSON', claim: 'Nadia dibantu oleh seorang pembantu sambilan semasa musim perayaan.' },
  { category: 'PERSON', claim: 'Semua kerja hiasan fondant dilakukan sendiri oleh Nadia.' },
  { category: 'PERSON', claim: 'Nadia turut aktif menjawab soalan pelanggan melalui Instagram DM.' },
  { category: 'PERSON', claim: 'Operasi pernah ditangguhkan sementara semasa cuti bersalin Nadia pada 2021.' },
  { category: 'MISC', claim: 'Nadia Bakes memenangi anugerah peniaga rumah terbaik daerah pada 2022.' },
  { category: 'MISC', claim: 'Bahan pembungkusan sebahagian besarnya boleh dikitar semula.' },
  { category: 'MISC', claim: 'Nadia Bakes menyertai bazar Ramadan tempatan setiap tahun.' },
  { category: 'MISC', claim: 'Ulasan pelanggan dikumpul melalui borang Google Form selepas penghantaran.' },
  { category: 'MISC', claim: 'Logo Nadia Bakes direka oleh rakan sekolah Nadia pada tahun 2018.' },
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
