import type { BentoPageProps } from '../_bento/BentoPage.js';

/**
 * Kek Lina: a made-up home bakery, the one shop every demo on the landing page
 * belongs to. Made up on purpose and labelled as such wherever it shows -- the
 * page has no real owners to show yet, and DESIGN.md bans testimonials from
 * businesses that do not exist.
 *
 * The customer's side is in Malay in both languages of the landing page,
 * because that is how a Shah Alam customer actually types, and it shows the
 * product answering in the language it was asked in. Product chrome the real
 * app only has in English (the capture card, the lead email) stays English
 * here too, so the demo shows what an owner will really get.
 *
 * SWAP: when a real owner agrees to be shown, replace this with their page's
 * data. Nothing else on the landing page needs to change.
 */
export const DEMO_SHOP = 'Kek Lina';

export const DEMO_PAGE: Omit<BentoPageProps, 'children'> = {
  displayName: DEMO_SHOP,
  handle: 'keklina',
  bio: 'Kek dan dessert dari rumah, Shah Alam. Order 2 hari awal.',
  // Dressed as a real owner would: its own logo, a cover photo, a raspberry
  // background and accent, and a softer serif -- the customisation a page has,
  // shown rather than described. The logo is ours (public/demo); the cover is
  // one of the stock covers (public/covers/CREDITS.md).
  avatarUrl: '/demo/keklina-logo.svg',
  coverUrl: '/covers/manis.webp',
  background: 'CUSTOM',
  backgroundColor: '#fbeef1',
  style: 'SOFT',
  accentColor: '#b5294e',
  headingFont: 'FRAUNCES',
  interactive: false,
  nameAs: 'p',
  links: [
    { id: 'wa', label: 'Order di WhatsApp', url: 'https://wa.me/60123456789', size: null },
    { id: 'menu', label: 'Menu & harga', url: 'https://keklina.example/menu', size: null },
    { id: 'ig', label: 'Gambar kek', url: 'https://instagram.com/keklina', size: null },
  ],
};

/** What the ask bar cycles, and what each answers -- the shop's approved facts. */
export const DEMO_QA: ReadonlyArray<{ q: string; a: string }> = [
  { q: 'Berapa harga kek coklat 1kg?', a: 'Kek coklat 1kg RM95. Order 2 hari awal ya.' },
  { q: 'Hantar ke Klang tak?', a: 'Hantar ke Klang ada, RM15. Shah Alam RM10.' },
  { q: 'Buka hari Ahad?', a: 'Ahad tutup. Isnin sampai Sabtu, 10 pagi ke 7 petang.' },
  { q: 'Boleh tulis nama atas kek?', a: 'Boleh, percuma. Bagitahu nama masa order.' },
];

/** The facts card in the trust section: the same facts the answers above use. */
export const DEMO_FACTS: ReadonlyArray<{ claim: string; value: string }> = [
  { claim: 'Kek coklat 1kg', value: 'RM95' },
  { claim: 'Hantar Shah Alam', value: 'RM10' },
  { claim: 'Hantar Klang', value: 'RM15' },
  { claim: 'Order', value: '2 hari awal' },
];

/** The heading on the demo shop's price list, as Lina would write it. */
export const DEMO_PRICE_LIST = 'Senarai harga';

/**
 * The lead, start to finish. The phone number is a placeholder in the shape a
 * Malaysian mobile number takes; it is not anyone's.
 */
export const DEMO_LEAD = {
  time: '11:42 pm',
  emailTime: '11:43 pm',
  question: 'Ada kek coklat 1kg? Nak hantar Shah Alam hari Sabtu.',
  answer: 'Ada, RM95. Hantar ke Shah Alam RM10. Order sebelum Khamis ya.',
  phone: '012-345 6789',
  product: 'kek coklat 1kg',
  when: 'Sabtu',
  where: 'Shah Alam',
  /**
   * The greeting apps/workers/src/leads/notify.ts writes for a Malay chat,
   * shown without its trailing em dash (the owner types on from there).
   */
  reply: `Hi! Saya dari ${DEMO_SHOP}. Pasal kek coklat 1kg tadi,`,
} as const;

/**
 * The forty ways one question arrives. The 3D scene and its fallback both draw
 * exactly this many, so "forty" in the copy is a count of what is on screen,
 * not a claim about anyone's inbox.
 */
export const STORM_WORDINGS: ReadonlyArray<string> = [
  'berapa harga?', 'hm?', 'price pls', 'how much 1kg sis', 'brp?', 'harga?',
  'kek coklat berapa ya', 'rm brp', 'pm price', 'how much ah', 'price?', 'berapa ye',
  'hrg kek coklat?', 'kak, berapa?', 'price list ada?', 'mahal tak', 'how much',
  'brp 1kg', 'harga kek 1kg?', 'cost?', 'nak tanya harga', 'berapa sis',
  'how much for 1kg?', 'price for chocolate?', 'brp ringgit', 'harga pls',
  'kek ni brp', '1kg how much', 'boleh tau harga?', 'quote pls', 'berapa kak?',
  'price ah?', 'hm berapa', 'tanya harga', 'brp ye kak', 'harga??', 'how much this',
  'chocolate 1kg price', 'brp sekarang', 'rate?',
];

/** The short answer each wording gets back in the storm, from DEMO_QA[0]: the price. */
export const STORM_REPLY = 'RM95';
