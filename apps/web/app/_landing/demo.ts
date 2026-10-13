import type { BentoPageProps } from '../_bento/BentoPage.js';

/**
 * Kek Lina: a made-up home bakery, the one shop every demo on the landing page
 * belongs to. Made up on purpose and labelled as such wherever it shows -- the
 * page has no real owners to show yet, and DESIGN.md bans testimonials from
 * businesses that do not exist.
 *
 * In the language of the page it sits on: English on /, Malay on /ms, so a
 * visitor reads the demo in the language they chose. Each locale's copy
 * carries its own (`copy.shop`, in copy.ts). The shop's look -- logo, cover,
 * colours, font -- is the same in both. Product chrome the real app only has
 * in English (the capture card, the lead email) stays English in both, so the
 * demo shows what an owner will really get.
 *
 * SWAP: when a real owner agrees to be shown, replace this with their page's
 * data. Nothing else on the landing page needs to change.
 */
export const DEMO_SHOP = 'Kek Lina';

export interface ShopDemoItem {
  id: string;
  name: string;
  description: string | null;
  photoUrl: string | null;
  priceCents: number | null;
  options: { id: string; label: string; priceCents: number }[];
}

export interface Demo {
  page: Omit<BentoPageProps, 'children'>;
  /** What the hero's input offers, and what each answers -- the shop's approved facts. */
  qa: ReadonlyArray<{ q: string; a: string }>;
  /** The facts card in the trust section: the same facts the answers above use. */
  facts: ReadonlyArray<{ claim: string; value: string }>;
  /** The heading on the demo shop's price list, as Lina would write it. */
  priceList: string;
  /**
   * The lead, start to finish. The phone number is a placeholder in the shape
   * a Malaysian mobile number takes; it is not anyone's.
   */
  lead: {
    time: string;
    emailTime: string;
    question: string;
    answer: string;
    phone: string;
    product: string;
    when: string;
    where: string;
    /**
     * The greeting apps/workers/src/leads/notify.ts writes for a chat in this
     * language, shown without its trailing em dash (the owner types on).
     */
    reply: string;
  };
  /**
   * The forty ways one question arrives in the storm. "Forty" in the copy is
   * a count of these, not a claim about anyone's inbox.
   */
  storm: ReadonlyArray<string>;
  /** The demo shop's shelf: one item with sizes, two with one price. */
  items: ReadonlyArray<ShopDemoItem>;
}

/** The shop's look, the same in every language. */
const LOOK = {
  displayName: DEMO_SHOP,
  handle: 'keklina',
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
} as const satisfies Partial<BentoPageProps>;

const LINK_URLS = {
  wa: 'https://wa.me/60123456789',
  menu: 'https://keklina.example/menu',
  ig: 'https://instagram.com/keklina',
} as const;

const PHONE = '012-345 6789';

export const DEMO_EN: Demo = {
  page: {
    ...LOOK,
    bio: 'Homemade cakes and desserts in Shah Alam. Order 2 days ahead.',
    links: [
      { id: 'wa', label: 'Order on WhatsApp', url: LINK_URLS.wa, size: null },
      { id: 'menu', label: 'Menu & prices', url: LINK_URLS.menu, size: null },
      { id: 'ig', label: 'Cake photos', url: LINK_URLS.ig, size: null },
    ],
  },
  qa: [
    { q: 'How much is a 1kg chocolate cake?', a: 'A 1kg chocolate cake is RM95. Please order 2 days ahead.' },
    { q: 'Do you deliver to Klang?', a: 'Yes, delivery to Klang is RM15. Shah Alam is RM10.' },
    { q: 'Are you open on Sunday?', a: 'Closed on Sundays. Monday to Saturday, 10am to 7pm.' },
    { q: 'Can you write a name on the cake?', a: 'Yes, for free. Just tell us the name when you order.' },
  ],
  facts: [
    { claim: '1kg chocolate cake', value: 'RM95' },
    { claim: 'Delivery, Shah Alam', value: 'RM10' },
    { claim: 'Delivery, Klang', value: 'RM15' },
    { claim: 'Order', value: '2 days ahead' },
  ],
  priceList: 'Price list',
  lead: {
    time: '11:42 pm',
    emailTime: '11:43 pm',
    question: 'Do you have a 1kg chocolate cake? Need it delivered to Shah Alam on Saturday.',
    answer: 'Yes, RM95. Delivery to Shah Alam is RM10. Please order by Thursday.',
    phone: PHONE,
    product: '1kg chocolate cake',
    when: 'Saturday',
    where: 'Shah Alam',
    reply: `Hi! ${DEMO_SHOP} here. About the 1kg chocolate cake you asked about,`,
  },
  storm: [
    'how much?', 'price?', 'price pls', 'how much for 1kg?', 'cost?', 'hm?',
    'how much is the chocolate one', 'rate?', "what's the price", 'price list?', 'how much ah', 'how much this',
    'quote pls', 'is it expensive?', 'chocolate 1kg price', 'price for chocolate?', '1kg how much',
    'how much sis', 'how much is it', 'can i know the price?', 'price please', 'price for 1kg?',
    'how much for chocolate', 'cost for 1kg?', 'how much ya', 'price??', 'how much now',
    'pricing?', 'how much per kg', 'what does it cost', 'how much for the cake', 'price of 1kg cake?',
    'how much is 1kg', 'may i know the price', 'cake price?', 'how much ah sis', 'chocolate cake price?',
    'how much for one', 'price ah?', 'pm price',
  ],
  items: [
    { id: 'demo-batik', name: 'Kek Batik', description: 'Nutella, keeps 5 days.', photoUrl: null, priceCents: null,
      options: [{ id: 'demo-batik-1', label: '1kg', priceCents: 9500 }, { id: 'demo-batik-2', label: '2kg', priceCents: 17000 }] },
    { id: 'demo-cookies', name: 'Cookies balang', description: null, photoUrl: null, priceCents: 2500, options: [] },
    { id: 'demo-brownies', name: 'Brownies kotak', description: null, photoUrl: null, priceCents: 3850, options: [] },
  ],
};

export const DEMO_MS: Demo = {
  page: {
    ...LOOK,
    bio: 'Kek dan dessert dari rumah, Shah Alam. Order 2 hari awal.',
    links: [
      { id: 'wa', label: 'Order di WhatsApp', url: LINK_URLS.wa, size: null },
      { id: 'menu', label: 'Menu & harga', url: LINK_URLS.menu, size: null },
      { id: 'ig', label: 'Gambar kek', url: LINK_URLS.ig, size: null },
    ],
  },
  qa: [
    { q: 'Berapa harga kek coklat 1kg?', a: 'Kek coklat 1kg RM95. Order 2 hari awal ya.' },
    { q: 'Hantar ke Klang tak?', a: 'Hantar ke Klang ada, RM15. Shah Alam RM10.' },
    { q: 'Buka hari Ahad?', a: 'Ahad tutup. Isnin sampai Sabtu, 10 pagi ke 7 petang.' },
    { q: 'Boleh tulis nama atas kek?', a: 'Boleh, percuma. Bagitahu nama masa order.' },
  ],
  facts: [
    { claim: 'Kek coklat 1kg', value: 'RM95' },
    { claim: 'Hantar Shah Alam', value: 'RM10' },
    { claim: 'Hantar Klang', value: 'RM15' },
    { claim: 'Order', value: '2 hari awal' },
  ],
  priceList: 'Senarai harga',
  lead: {
    time: '11:42 pm',
    emailTime: '11:43 pm',
    question: 'Ada kek coklat 1kg? Nak hantar Shah Alam hari Sabtu.',
    answer: 'Ada, RM95. Hantar ke Shah Alam RM10. Order sebelum Khamis ya.',
    phone: PHONE,
    product: 'kek coklat 1kg',
    when: 'Sabtu',
    where: 'Shah Alam',
    reply: `Hi! Saya dari ${DEMO_SHOP}. Pasal kek coklat 1kg tadi,`,
  },
  // How a Shah Alam customer actually types: Malay, with the English and rojak a real inbox has in it.
  storm: [
    'berapa harga?', 'hm?', 'price pls', 'how much 1kg sis', 'brp?', 'harga?',
    'kek coklat berapa ya', 'rm brp', 'pm price', 'how much ah', 'price?', 'berapa ye',
    'hrg kek coklat?', 'kak, berapa?', 'price list ada?', 'mahal tak', 'how much',
    'brp 1kg', 'harga kek 1kg?', 'cost?', 'nak tanya harga', 'berapa sis',
    'how much for 1kg?', 'price for chocolate?', 'brp ringgit', 'harga pls',
    'kek ni brp', '1kg how much', 'boleh tau harga?', 'quote pls', 'berapa kak?',
    'price ah?', 'hm berapa', 'tanya harga', 'brp ye kak', 'harga??', 'how much this',
    'chocolate 1kg price', 'brp sekarang', 'rate?',
  ],
  items: [
    { id: 'demo-batik', name: 'Kek Batik', description: 'Nutella, tahan 5 hari.', photoUrl: null, priceCents: null,
      options: [{ id: 'demo-batik-1', label: '1kg', priceCents: 9500 }, { id: 'demo-batik-2', label: '2kg', priceCents: 17000 }] },
    { id: 'demo-cookies', name: 'Cookies balang', description: null, photoUrl: null, priceCents: 2500, options: [] },
    { id: 'demo-brownies', name: 'Brownies kotak', description: null, photoUrl: null, priceCents: 3850, options: [] },
  ],
};
