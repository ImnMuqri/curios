import { monthsFree } from '@curios/core/billing';
import { ringgit } from '@curios/core/money';
import type { PlanTerms } from '@curios/core/settings';
import type { LandsCard, LandsLine } from './lands-script.js';

/**
 * Every word on the landing page, in both languages, in one shape. From the
 * design handoff's TanyaJe board (design/boards/TanyaJe.dc.html), which
 * replaced the shop-first landing on 2026-10-16.
 *
 * The Malay was drafted by an AI and read by the owner, a Malay speaker, on
 * 2026-10-22 (DEVIATIONS 10). New Malay copy needs the same read.
 *
 * Every claim should be one the product makes true today. Checkout,
 * paying through CHIP (or the owner's own QR with a receipt), and orders
 * landing in the dashboard are as the board draws them.
 *
 * Client-safe: nothing here reads a database. The prices and free leads are
 * the admin's (`PlanTerms`, from `getSettings()` in the page), so the pricing
 * section is built from them by `landingCopy` and `pricingCopy`; the client
 * sections read their words from here by locale (several are functions, which
 * cannot cross from a server component).
 */

export type Locale = 'en' | 'ms';

export interface Faq {
  q: string;
  a: string;
}

/** The plan's numbers as the pricing copy prints them, from the prices in force. */
function figures(terms: PlanTerms) {
  const months = monthsFree(terms.prices);
  return {
    // In ringgit: Controls sets the prices in whole ringgit, so these print as published (RM49).
    monthly: terms.prices.MONTHLY / 100,
    annual: terms.prices.ANNUAL / 100,
    /** The annual price a month, to the sen: RM40.83 at RM490. */
    annualAMonth: (terms.prices.ANNUAL / 12 / 100).toFixed(2),
    /** Whole months a year saves, or null when the prices give none (DEVIATIONS 225). */
    months,
    /** The prices as text, from the one formatter: RM49, or RM49.50 when a price has sen. */
    monthlyText: ringgit(terms.prices.MONTHLY),
    annualText: ringgit(terms.prices.ANNUAL),
    annualAMonthText: ringgit(Math.round(terms.prices.ANNUAL / 12)),
    /** Whether one RM95 order (the example the tag names) still covers a month. */
    rm95Covers: terms.prices.MONTHLY <= 9500,
    leads: terms.freeLeads,
  };
}

const EN_NUMBERS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const MS_NUMBERS = ['sifar', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'lapan', 'sembilan', 'sepuluh'];
/** A count in words up to ten, as the board writes "three"; digits above. */
const inWords = (n: number, words: string[]) => words[n] ?? String(n);
const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export interface PersonaWords {
  q: string;
  a: string;
  links: [string, string, string];
}

/** One side of What lands in your hands: its chat, its steps and its four zones. */
export interface LandsSideCopy {
  label: string;
  steps: string[];
  keys: [string, string, string, string];
  /** The label over the page's replies. */
  who: string;
  placeholder: string;
  /** The button on each card in the chat, and what it says once pressed. */
  cardButton: string;
  cardDone: string;
  chat: LandsLine[];
  /** 01: the lead or the order. */
  first: { title: string; tag: string; tone: 'hot' | 'ok'; big: string; kv?: [string, string][]; lines?: [string, string][]; action: string };
  /** 02: the cards the page suggested. */
  suggested: LandsCard[];
  /** 03: the ping on the owner's phone. */
  ping: { from: string; when: string; text: string; foot: string };
  /** 04: what people keep asking; `me` is this chat's question, `miss` one the page could not answer. */
  asked: { q: string; n: number; me?: boolean; miss?: boolean }[];
  missTag: string;
}

/** Kek Lina's checkout in the phone: the words the real checkout does not have (it supplies the rest). */
export interface LandsCheckoutCopy {
  price: string;
  item: string;
  itemSub: string;
  pickupWhere: string;
  deliveryWhere: string;
  free: string;
  deliveryFee: string;
  dayTitle: string;
  dayHint: string;
  days: [string, string, string, string];
  dayLong: string;
  banks: [string, string, string, string];
  pay: (total: string) => string;
  buyer: { name: string; phone: string };
  code: string;
  keep: (code: string) => string;
}

export interface LandingCopy {
  locale: Locale;
  meta: { title: string; description: string; ogAlt: string; ogLocale: string };
  skip: string;
  nav: {
    sections: string;
    who: string;
    how: string;
    business: string;
    pricing: string;
    faq: string;
    signIn: string;
    cta: string;
    other: { href: string; short: string; name: string; lang: Locale };
  };
  hero: {
    line: string;
    ask: string;
    /** The whole headline with the first page's name, for the share card. */
    title: string;
    lede: string;
    claimLabel: string;
    placeholder: string;
    button: string;
    note: string;
    deck: string;
    next: string;
    /** A side page's button: "Show Kek Lina’s page". */
    show: (name: string) => string;
    kinds: { personal: string; business: string; creator: string };
    askAnything: (name: string) => string;
    /** The label over a page's reply: "{Name}’s page". */
    replyLabel: (name: string) => string;
    linksTab: string;
    askTab: string;
  };
  askStrip: { eyebrow: string; lead: string; words: string[]; body: string };
  who: {
    eyebrow: string;
    /** "Same question. ", "Their own" (highlighted), " answer." */
    title: [string, string, string];
    lede: string;
    asking: (n: number) => string;
    questionsLabel: string;
    questions: [string, string, string, string];
    answers: Record<WhoKey, [string, string, string, string]>;
    roles: Record<WhoKey, string>;
    pageOf: (name: string) => string;
  };
  how: {
    eyebrow: string;
    title: string;
    steps: { title: string; body: string }[];
    pasted: string;
    /** What the illustrator pasted, with the four facts it finds marked. */
    pastedText: (string | { fact: number; text: string })[];
    found: (n: number) => string;
    facts: { text: string; topic: string }[];
    approved: (n: number) => string;
    factOf: (n: number, total: number) => string;
    from: string;
    usedFor: (topic: string) => string;
    fix: string;
    approve: string;
    allApproved: { title: string; body: string };
    /** The Instagram bio the third card taps. */
    bio: { handle: string; role: string; text: string; link: string; posts: [string, string]; followers: [string, string] };
    /** Aisyah's page, asked from the bio. */
    chat: { name: string; q: string; a: string; placeholder: string; time: string };
  };
  lands: {
    eyebrow: string;
    title: string;
    lede: string;
    /** The switch's name, for screen readers. */
    switchLabel: string;
    /** An empty zone, before anything lands. */
    empty: string;
    service: LandsSideCopy;
    products: LandsSideCopy;
    /** The page's "message you back" card, as the public page words it. */
    capture: { ask: (name: string) => string; why: (name: string) => string; label: string; send: string; sent: (name: string) => string };
    checkout: LandsCheckoutCopy;
  };
  /** No cut, ever: what a RM100 order leaves you, and what the plan already covers. */
  noCut: {
    eyebrow: string;
    title: string;
    sub: string;
    /** Two sample receipts for the same RM100 cake: fixed figures, not prices from PlanTerms. */
    market: { title: string; ref: string; line: [string, number]; fees: [string, number][]; keep: string };
    curios: { title: string; ref: string; line: [string, number]; commission: string; bank: [string, number]; keep: string; stamp: string };
    incl: { kicker: string; title: string; body: string }[];
    fine: string;
  };
  pricing: {
    eyebrow: string;
    /** Two lines: "Free to be asked." and the price in force "when you’re selling". */
    title: [string, string];
    billing: string;
    monthly: string;
    yearly: string;
    twoMonths: string;
    personal: { name: string; tag: string; price: string; per: string; body: string; ticks: string[]; cta: string };
    business: {
      name: string;
      tag: string;
      monthly: string;
      yearly: string;
      perMonth: string;
      perYear: string;
      noteMonthly: string;
      noteYearly: string;
      plus: string;
      /** Business's features, as the landing sells them. */
      points: string[];
      cta: string;
    };
    calc: {
      eyebrow: string;
      title: string;
      orders: string;
      typical: string;
      takeIn: string;
      yours: string;
      /** `amount` is written already: RM49, RM40.83. */
      cost: (amount: string) => string;
      /** `times` is what the orders take in over what Business costs, unrounded. */
      pays: (percent: number, times: number) => string;
      /** Below cost; `oneMoreCovers` when one more typical order would pay for Business (plan, Open decision 8). */
      under: (oneMoreCovers: boolean) => string;
      typicalLabel: string;
    };
    /** How Business is paid. Billing shows this line too. */
    payment: string;
    disclaimer: string;
    /** The line under the calculator. */
    fine: string;
    /** Numbers the calculator needs, from the prices in force. */
    monthlyRinggit: number;
    annualAMonth: string;
    /** The same two, written: RM49.50, RM40.88. */
    monthlyText: string;
    annualAMonthText: string;
  };
  faq: { label: string; title: string; items: Faq[] };
  /** `label` reads "Tanya je." on both landings (plan, Open decision 3). */
  closing: { label: string; onePageFor: string; words: string[]; button: string; note: string };
  footer: { note: string; signIn: string };
  personas: Record<PersonaKey, PersonaWords>;
}

export type PersonaKey = 'aisyah' | 'lina' | 'hana' | 'daniel' | 'farah';
/** The five pages Who asks, in the board's order. */
export type WhoKey = 'aisyah' | 'daniel' | 'farah' | 'lina' | 'hana';

/** The chats on What lands in your hands. Visitors and pages talk in Malay on both landings, as on the board. */
const SERVICE_CHAT: LandsLine[] = [
  { r: 'v', t: 'Hi, nak buat branding untuk kafe baru. Ada package?', step: 0 },
  { r: 'p', t: 'Ada dua. Full branding siap dalam dua minggu.', cards: [{ swatch: 'starter', name: 'Starter', price: 'from RM1,800' }, { swatch: 'full', name: 'Full branding', price: 'from RM3,800' }], land: [1], step: 1 },
  { r: 'v', t: 'Full branding. Saya Farhan, kafe buka Januari, budget dalam RM4k.', pick: 1 },
  { r: 'p', t: 'Boleh. Hana boleh WhatsApp untuk mula.', capture: '012-554 8190', step: 2 },
  { r: 'end', land: [0, 2, 3], step: 3 },
];
const PRODUCTS_CHAT: LandsLine[] = [
  { r: 'v', t: 'Kek birthday budak bawah RM100 ada?', step: 0 },
  { r: 'p', t: 'Ada! Budak suka dua ni:', cards: [{ swatch: 'coklat', name: 'Kek coklat · 1kg', price: 'RM95' }, { swatch: 'batik', name: 'Kek batik', price: 'RM45' }], land: [1] },
  { r: 'add', i: 0, step: 1 },
  { r: 'checkout', step: 2 },
  { r: 'pay', step: 3 },
  { r: 'end', land: [0, 2, 3], step: 4 },
];
const SERVICE_ASKED = [
  { q: 'Ada package?', n: 22, me: true },
  { q: 'Berapa lama siap?', n: 14 },
  { q: 'Boleh buat logo je?', n: 9 },
  { q: 'Do you design menus?', n: 4, miss: true },
];
const PRODUCTS_ASKED = [
  { q: 'Kek bawah RM100?', n: 14, me: true },
  { q: 'Boleh tulis nama atas kek?', n: 12 },
  { q: 'Hantar Klang tak?', n: 8 },
  { q: 'Ada kek pandan?', n: 5, miss: true },
];

const EN: LandingBase = {
  locale: 'en',
  meta: {
    title: 'Curios: a link in bio people can ask',
    description:
      'Curios is a link in bio people can ask. About you, your work, your rates, your shop. It answers from facts you approve, in Malay or English. Free for anyone.',
    ogAlt: 'Aisyah’s Curios page, asked if she is taking commissions, answering that two November slots are left.',
    ogLocale: 'en_MY',
  },
  skip: 'Skip to content',
  nav: {
    sections: 'Sections',
    who: 'Who it’s for',
    how: 'How it works',
    business: 'For business',
    pricing: 'Pricing',
    faq: 'FAQ',
    signIn: 'Sign in',
    cta: 'Make your page',
    other: { href: '/ms', short: 'BM', name: 'Bahasa Melayu', lang: 'ms' },
  },
  hero: {
    line: 'Don’t read the bio.',
    ask: 'Ask',
    title: 'Don’t read the bio. Ask Aisyah.',
    lede: 'Curios is a link in bio people can ask. About you, your work, your rates, your shop. It answers from facts you approve, in Malay or English, and never makes anything up.',
    claimLabel: 'The address you want for your page',
    placeholder: 'yourname',
    button: 'Claim it, free',
    note: 'Free for anyone. Business pages also get every ready buyer’s number.',
    deck: 'Curios pages answering questions',
    next: 'Show the next page',
    show: (name) => `Show ${name}’s page`,
    kinds: { personal: 'Personal', business: 'Business', creator: 'Creator' },
    askAnything: (name) => `Ask ${name} anything`,
    replyLabel: (name) => `${name}’s page`,
    linksTab: 'Links',
    askTab: 'Ask',
  },
  askStrip: {
    eyebrow: 'What people ask a Curios page',
    lead: 'Ask about my',
    words: ['rates', 'services', 'hours', 'experience', 'prices'],
    body: 'Whatever you put in, it can answer. Whatever you didn’t, it says it’ll check with you, and the question waits on your list.',
  },
  who: {
    eyebrow: 'Who it’s for',
    title: ['Same question. ', 'Their own', ' answer.'],
    lede: 'Each page knows its owner, and nothing else. Ask five of them the same thing.',
    asking: (n) => `asking ${n} pages`,
    questionsLabel: 'Questions',
    questions: ['Are you free this month?', 'How much?', 'Where are you?', 'Boleh WhatsApp?'],
    answers: {
      aisyah: ['Yes, two slots left this month. A portrait takes about a week.', 'Portraits from RM250. Book covers from RM900.', 'Ipoh, and I work with clients anywhere online.', 'Boleh, tekan WhatsApp di bawah nama saya.'],
      daniel: ['I can start 1 January. My notice period is one month.', 'Looking at RM7,000 to RM8,500 a month. Open to talk.', 'Kuala Lumpur. Hybrid in KL or PJ, or fully remote.', 'Email lebih baik, ada di page saya. LinkedIn pun boleh.'],
      farah: ['The Saturday 8am class has three spots. Online plans start any day.', 'Online plans are RM150 a month. A drop-in class is RM35.', 'Classes at Taman Tun park. Online plans work anywhere.', 'Boleh, tekan butang WhatsApp di page saya.'],
      lina: ['Weekend orders close Thursday night. Saturday pickup is open.', 'Kek coklat 1kg is RM95. Kek batik is RM45.', 'Seksyen 7, Shah Alam. Delivery to Klang is RM15.', 'Boleh. Tinggalkan nombor, Kek Lina akan WhatsApp anda.'],
      hana: ['Our next project slot opens in mid-January.', 'Starter from RM1,800. Full branding from RM3,800.', 'Bangsar, KL. We work with clients across Malaysia.', 'Boleh. Tinggalkan nombor, Studio Hana akan hubungi anda.'],
    },
    roles: { aisyah: 'Illustrator', daniel: 'Frontend developer', farah: 'Fitness coach', lina: 'Home baker', hana: 'Branding studio' },
    pageOf: (name) => `${name}’s page`,
  },
  how: {
    eyebrow: 'How it works',
    title: 'Ten minutes from blank to bio link',
    steps: [
      { title: 'Tell it about you', body: 'Paste your website, your Linktree, or just a few honest paragraphs. It reads them and pulls out the facts.' },
      { title: 'Approve what’s right', body: 'Each fact comes up as a card. Keep the right ones, fix the rest. It never says anything you didn’t approve.' },
      { title: 'Put the link in your bio', body: 'Share curios.my/yourname on Instagram, TikTok or WhatsApp. Anyone who taps it can ask, day or night.' },
    ],
    pasted: 'You pasted',
    pastedText: [
      'I’m an illustrator in Ipoh. ',
      { fact: 0, text: 'Portraits from RM250' },
      ', ',
      { fact: 1, text: 'book covers from RM900' },
      '. I take ',
      { fact: 2, text: 'four commissions a month' },
      ' and ',
      { fact: 3, text: 'reply within two days' },
      '.',
    ],
    found: (n) => `${n} facts found`,
    facts: [
      { text: 'Portraits from RM250', topic: 'portrait prices' },
      { text: 'Book covers from RM900', topic: 'book covers' },
      { text: 'Four commissions a month', topic: 'availability' },
      { text: 'Replies within two days', topic: 'reply times' },
    ],
    approved: (n) => `${n} approved`,
    factOf: (n, total) => `Fact ${n} of ${total}`,
    from: 'from aisyahdraws.com',
    usedFor: (topic) => `Used when someone asks about ${topic}.`,
    fix: 'Fix it',
    approve: 'Approve',
    allApproved: { title: 'All four approved', body: 'Your page answers from these, and nothing else.' },
    bio: {
      handle: 'aisyahdraws',
      role: 'Illustrator · Ipoh',
      text: 'Portraits, book covers, editorial. Commissions open for November.',
      link: 'curios.my/aisyahdraws',
      posts: ['128', 'posts'],
      followers: ['4.2k', 'followers'],
    },
    chat: {
      name: 'Aisyah',
      q: 'Taking commissions in November?',
      a: 'Yes, two slots left for November. Portraits start at RM250.',
      placeholder: 'Ask Aisyah anything',
      time: '2:14 am',
    },
  },
  lands: {
    eyebrow: 'For business',
    title: 'What lands in your hands',
    lede: 'One chat on your page. Four things you can use.',
    switchLabel: 'Show it for',
    empty: 'Waiting for a chat',
    service: {
      label: 'I offer a service',
      steps: ['Ask', 'Suggest', 'Number', 'Lead'],
      keys: ['The lead, qualified', 'Your packages, suggested', 'Told the moment it matters', 'What people keep asking'],
      who: 'Studio Hana’s page',
      placeholder: 'Ask Studio Hana anything',
      cardButton: 'Ask',
      cardDone: 'Asked',
      chat: SERVICE_CHAT,
      first: {
        title: 'Farhan · new lead · 11:42 pm',
        tag: 'Hot',
        tone: 'hot',
        big: '+60 12-554 8190',
        kv: [['Wants', 'Full branding'], ['Budget', 'RM4,000'], ['For', 'A new café'], ['Starts', 'January']],
        action: 'Open WhatsApp',
      },
      suggested: [{ swatch: 'starter', name: 'Starter', price: 'from RM1,800' }, { swatch: 'full', name: 'Full branding', price: 'from RM3,800' }],
      ping: { from: 'Curios', when: 'now', text: 'New lead: Farhan wants Full branding, budget RM4,000, starting January.', foot: 'Also in your email, with the whole chat.' },
      asked: SERVICE_ASKED,
      missTag: 'Not in your services yet',
    },
    products: {
      label: 'I sell products',
      steps: ['Ask', 'Add', 'Check out', 'Pay', 'Order'],
      keys: ['The order, paid', 'Your products, suggested', 'Told the moment it matters', 'What people keep asking'],
      who: 'Kek Lina’s page',
      placeholder: 'Ask Kek Lina anything',
      cardButton: 'Add to basket',
      cardDone: 'In your basket',
      chat: PRODUCTS_CHAT,
      first: {
        title: 'Order #16 · Aida',
        tag: 'Paid · FPX',
        tone: 'ok',
        big: 'RM95',
        lines: [['1× Kek coklat · 1kg', 'RM95'], ['Pickup', 'Sat 21 Nov']],
        action: 'Nothing to check',
      },
      suggested: [{ swatch: 'coklat', name: 'Kek coklat · 1kg', price: 'RM95' }, { swatch: 'batik', name: 'Kek batik', price: 'RM45' }],
      ping: { from: 'Curios', when: 'now', text: 'New order #16 · RM95 paid by FPX · pickup Sat 21 Nov.', foot: 'Already in Orders, marked paid.' },
      asked: PRODUCTS_ASKED,
      missTag: 'Not on your menu yet',
    },
    capture: {
      ask: (name) => `Want ${name} to message you back?`,
      why: (name) => `Your number goes to ${name} so they can reply on WhatsApp. Nobody else sees it.`,
      label: 'Your WhatsApp number',
      send: 'Send my number',
      sent: (name) => `Got it. ${name} will message you on WhatsApp.`,
    },
    checkout: {
      price: 'RM95',
      item: 'Kek coklat',
      itemSub: '1kg · RM95 each',
      pickupWhere: 'Seksyen 7, Shah Alam',
      deliveryWhere: 'Shah Alam and Klang',
      free: 'Free',
      deliveryFee: 'RM10',
      dayTitle: 'Day',
      dayHint: '1 day’s notice · closed Monday',
      days: ['Fri 20', 'Sat 21', 'Sun 22', 'Tue 24'],
      dayLong: 'Sat 21 Nov',
      banks: ['Maybank2u', 'CIMB Clicks', 'Public Bank', 'RHB Now'],
      pay: (total) => `Pay ${total}`,
      buyer: { name: 'Aida', phone: '012-345 6789' },
      code: '7Q4M',
      keep: (code) => `Keep this code. Ask Kek Lina’s page “where is my order ${code}?” any time and it shows you the status.`,
    },
  },
  noCut: {
    eyebrow: 'No cut, ever',
    title: 'Every sale is yours',
    sub: 'The same RM100 cake, sold two ways. Read the receipts.',
    market: {
      title: 'On a marketplace',
      ref: 'Order #A-55210 · 1 item',
      line: ['Kek coklat · 1kg', 100],
      fees: [['Platform fee 5%', 5], ['Commission ~4%', 4], ['Transaction fee 2.16%', 2.16]],
      keep: 'You keep',
    },
    curios: {
      title: 'On Curios',
      ref: 'Order #16 · keklina · 1 item',
      line: ['Kek coklat · 1kg', 100],
      commission: 'Curios commission',
      bank: ['Bank fee (FPX, by CHIP)', 1],
      keep: 'You keep',
      stamp: '0%',
    },
    incl: [
      { kicker: 'Instead of a website', title: 'RM2,000+ to build', body: 'Plus about RM420 a year to host. Your page is the website.' },
      { kicker: 'Instead of a gateway form', title: 'Your own CHIP or QR', body: 'Connect CHIP for FPX, e-wallet and card. Or take DuitNow QR.' },
      { kicker: 'Instead of an SEO person', title: 'Found on Google', body: 'Titles, previews and a sitemap, done for you.' },
    ],
    fine: 'Marketplace example uses typical 2026 Malaysian fees: 5% platform fee, 2–6% commission and a 2.16% transaction fee. Card and e-wallet payments cost 1–2% through CHIP.',
  },
  faq: {
    label: 'FAQ',
    title: 'Asked before. Answered here.',
    items: [
      { q: 'Can I use it for myself, not a business?', a: 'Yes. Personal is free: a page with an AI that answers questions about you, your work and your rates. It stays hidden from Google unless you switch it on.' },
      { q: 'What if it says something wrong?', a: 'It only answers from facts you approved. If nothing you approved answers the question, it says it will check with you. It never guesses, and never rounds a number.' },
      { q: 'Can it read my Instagram?', a: 'Not yet. Instagram and TikTok don’t let us read profiles. Paste your bio or a few paragraphs instead, or a website or Linktree link.' },
      { q: 'Does it reply in Malay?', a: 'It answers in the language the person used: Malay, English, Manglish or a mix.' },
      { q: 'Can I switch from Personal to Business later?', a: 'Yes, from Billing, whenever you start selling. It is a one-way switch: a business page can’t go back to personal.' },
    ],
  },
  closing: {
    label: 'Tanya je.',
    onePageFor: 'One page for',
    words: ['freelancers', 'home bakers', 'job seekers', 'clinics', 'coaches', 'studios'],
    button: 'Claim it, free',
    note: 'Free. No card. About ten minutes to set up.',
  },
  footer: { note: 'Every person, shop and order on this page is a made-up sample.', signIn: 'Sign in' },
  personas: {
    aisyah: { q: 'Are you taking commissions in November?', a: 'Yes, two slots left for November. Portraits start at RM250.', links: ['Portfolio', 'Commission rates', 'Book a slot'] },
    lina: { q: 'Do you deliver to Klang?', a: 'Yes, delivery to Klang is RM15. Shah Alam is RM10.', links: ['Order on WhatsApp', 'Menu & prices', 'Cake photos'] },
    hana: { q: 'What’s in your branding package?', a: 'Logo, colour and type system, and social templates. Two weeks, from RM3,800.', links: ['Case studies', 'Packages', 'Start a project'] },
    daniel: { q: 'Are you open to hybrid roles?', a: 'Yes, hybrid in KL or Petaling Jaya, or fully remote.', links: ['Resume', 'GitHub', 'LinkedIn'] },
    farah: { q: 'Do you do online coaching?', a: 'Yes, monthly online plans with weekly check-ins on WhatsApp.', links: ['Online plans', 'Class schedule', 'Meal guides'] },
  },
};

const MS: LandingBase = {
  locale: 'ms',
  meta: {
    title: 'Curios: link bio yang orang boleh tanya',
    description:
      'Curios ialah link bio yang orang boleh tanya. Tentang anda, kerja anda, harga anda, kedai anda. Ia jawab ikut fakta yang anda luluskan, dalam BM atau English. Percuma untuk semua.',
    ogAlt: 'Halaman Curios Aisyah, ditanya sama ada dia ambil tempahan, menjawab tinggal dua slot November.',
    ogLocale: 'ms_MY',
  },
  skip: 'Langkau ke kandungan',
  nav: {
    sections: 'Bahagian',
    who: 'Untuk siapa',
    how: 'Cara ia berfungsi',
    business: 'Untuk bisnes',
    pricing: 'Harga',
    faq: 'Soalan lazim',
    signIn: 'Log masuk',
    cta: 'Buat halaman anda',
    other: { href: '/', short: 'EN', name: 'English', lang: 'en' },
  },
  hero: {
    line: 'Tak payah baca bio.',
    ask: 'Tanya',
    title: 'Tak payah baca bio. Tanya Aisyah.',
    lede: 'Curios ialah link bio yang orang boleh tanya. Tentang anda, kerja anda, harga anda, kedai anda. Ia jawab ikut fakta yang anda luluskan, dalam BM atau English, dan tak pernah reka jawapan.',
    claimLabel: 'Alamat yang anda mahu untuk halaman anda',
    placeholder: 'namaanda',
    button: 'Ambil, percuma',
    note: 'Percuma untuk semua. Halaman bisnes juga dapat nombor setiap pembeli yang sedia beli.',
    deck: 'Halaman Curios yang menjawab soalan',
    next: 'Tunjuk halaman seterusnya',
    show: (name) => `Tunjuk halaman ${name}`,
    kinds: { personal: 'Peribadi', business: 'Bisnes', creator: 'Kreator' },
    askAnything: (name) => `Tanya ${name} apa saja`,
    replyLabel: (name) => `Halaman ${name}`,
    linksTab: 'Pautan',
    askTab: 'Tanya',
  },
  askStrip: {
    eyebrow: 'Apa orang tanya halaman Curios',
    lead: 'Tanya pasal',
    words: ['harga', 'servis', 'waktu buka', 'pengalaman', 'pakej'],
    body: 'Apa yang anda masukkan, ia boleh jawab. Apa yang tiada, ia kata akan semak dengan anda, dan soalan itu tunggu dalam senarai anda.',
  },
  who: {
    eyebrow: 'Untuk siapa',
    title: ['Soalan sama. Jawapan ', 'mereka sendiri', '.'],
    lede: 'Setiap halaman kenal pemiliknya, dan tiada yang lain. Tanya lima daripadanya soalan yang sama.',
    asking: (n) => `tanya ${n} halaman`,
    questionsLabel: 'Soalan',
    questions: ['Free bulan ni?', 'Berapa harga?', 'Kat mana?', 'Boleh WhatsApp?'],
    answers: {
      aisyah: ['Ya, tinggal dua slot bulan ni. Satu potret ambil masa lebih kurang seminggu.', 'Potret dari RM250. Kulit buku dari RM900.', 'Ipoh, dan saya ambil klien dari mana-mana secara online.', 'Boleh, tekan WhatsApp di bawah nama saya.'],
      daniel: ['Saya boleh mula 1 Januari. Notis saya sebulan.', 'Saya cari RM7,000 hingga RM8,500 sebulan. Boleh bincang.', 'Kuala Lumpur. Hybrid di KL atau PJ, atau remote sepenuhnya.', 'Email lebih baik, ada di page saya. LinkedIn pun boleh.'],
      farah: ['Kelas Sabtu 8 pagi ada tiga tempat. Pelan online boleh mula bila-bila hari.', 'Pelan online RM150 sebulan. Kelas sekali datang RM35.', 'Kelas di Taman Tun. Pelan online boleh dari mana-mana.', 'Boleh, tekan butang WhatsApp di page saya.'],
      lina: ['Tempahan hujung minggu tutup Khamis malam. Ambil hari Sabtu masih ada.', 'Kek coklat 1kg RM95. Kek batik RM45.', 'Seksyen 7, Shah Alam. Hantar ke Klang RM15.', 'Boleh. Tinggalkan nombor, Kek Lina akan WhatsApp anda.'],
      hana: ['Slot projek kami yang seterusnya buka pertengahan Januari.', 'Starter dari RM1,800. Branding penuh dari RM3,800.', 'Bangsar, KL. Kami ambil klien di seluruh Malaysia.', 'Boleh. Tinggalkan nombor, Studio Hana akan hubungi anda.'],
    },
    roles: { aisyah: 'Ilustrator', daniel: 'Pembangun frontend', farah: 'Jurulatih kecergasan', lina: 'Pembuat kek rumah', hana: 'Studio branding' },
    pageOf: (name) => `Halaman ${name}`,
  },
  how: {
    eyebrow: 'Cara ia berfungsi',
    title: 'Sepuluh minit dari kosong ke link bio',
    steps: [
      { title: 'Beritahu tentang anda', body: 'Tampal laman web anda, Linktree anda, atau beberapa perenggan jujur. Ia baca dan keluarkan faktanya.' },
      { title: 'Luluskan yang betul', body: 'Setiap fakta keluar sebagai kad. Simpan yang betul, betulkan yang lain. Ia tak cakap apa yang anda tak luluskan.' },
      { title: 'Letak link dalam bio', body: 'Kongsi curios.my/namaanda di Instagram, TikTok atau WhatsApp. Sesiapa yang tekan boleh tanya, siang atau malam.' },
    ],
    pasted: 'Anda tampal',
    pastedText: [
      'Saya ilustrator di Ipoh. ',
      { fact: 0, text: 'Potret dari RM250' },
      ', ',
      { fact: 1, text: 'kulit buku dari RM900' },
      '. Saya ambil ',
      { fact: 2, text: 'empat tempahan sebulan' },
      ' dan ',
      { fact: 3, text: 'balas dalam dua hari' },
      '.',
    ],
    found: (n) => `Jumpa ${n} fakta`,
    facts: [
      { text: 'Potret dari RM250', topic: 'harga potret' },
      { text: 'Kulit buku dari RM900', topic: 'kulit buku' },
      { text: 'Empat tempahan sebulan', topic: 'kekosongan' },
      { text: 'Balas dalam dua hari', topic: 'masa balas' },
    ],
    approved: (n) => `${n} diluluskan`,
    factOf: (n, total) => `Fakta ${n} daripada ${total}`,
    from: 'dari aisyahdraws.com',
    usedFor: (topic) => `Digunakan bila orang tanya pasal ${topic}.`,
    fix: 'Betulkan',
    approve: 'Luluskan',
    allApproved: { title: 'Keempat-empat diluluskan', body: 'Halaman anda jawab dari fakta ini, dan tiada yang lain.' },
    bio: {
      handle: 'aisyahdraws',
      role: 'Ilustrator · Ipoh',
      text: 'Potret, kulit buku, editorial. Tempahan dibuka untuk November.',
      link: 'curios.my/aisyahdraws',
      posts: ['128', 'hantaran'],
      followers: ['4.2k', 'pengikut'],
    },
    chat: {
      name: 'Aisyah',
      q: 'Ambil tempahan November?',
      a: 'Ya, tinggal dua slot untuk November. Potret dari RM250.',
      placeholder: 'Tanya Aisyah apa saja',
      time: '2:14 pagi',
    },
  },
  lands: {
    eyebrow: 'Untuk bisnes',
    title: 'Apa yang anda dapat',
    lede: 'Satu chat di halaman anda. Empat perkara yang anda boleh guna.',
    switchLabel: 'Tunjuk untuk',
    empty: 'Menunggu chat',
    service: {
      label: 'Saya beri servis',
      steps: ['Tanya', 'Cadang', 'Nombor', 'Lead'],
      keys: ['Lead, sudah ditapis', 'Pakej anda, dicadangkan', 'Dimaklumkan bila penting', 'Apa yang orang selalu tanya'],
      who: 'Halaman Studio Hana',
      placeholder: 'Tanya Studio Hana apa saja',
      cardButton: 'Tanya',
      cardDone: 'Ditanya',
      chat: SERVICE_CHAT,
      first: {
        title: 'Farhan · lead baru · 11:42 malam',
        tag: 'Panas',
        tone: 'hot',
        big: '+60 12-554 8190',
        kv: [['Mahu', 'Full branding'], ['Bajet', 'RM4,000'], ['Untuk', 'Kafe baru'], ['Mula', 'Januari']],
        action: 'Buka WhatsApp',
      },
      suggested: [{ swatch: 'starter', name: 'Starter', price: 'dari RM1,800' }, { swatch: 'full', name: 'Full branding', price: 'dari RM3,800' }],
      ping: { from: 'Curios', when: 'baru tadi', text: 'Lead baru: Farhan mahu Full branding, bajet RM4,000, mula Januari.', foot: 'Juga dalam emel anda, bersama seluruh chat.' },
      asked: SERVICE_ASKED,
      missTag: 'Belum ada dalam servis anda',
    },
    products: {
      label: 'Saya jual produk',
      steps: ['Tanya', 'Tambah', 'Checkout', 'Bayar', 'Pesanan'],
      keys: ['Pesanan, sudah dibayar', 'Produk anda, dicadangkan', 'Dimaklumkan bila penting', 'Apa yang orang selalu tanya'],
      who: 'Halaman Kek Lina',
      placeholder: 'Tanya Kek Lina apa saja',
      cardButton: 'Masuk bakul',
      cardDone: 'Dalam bakul',
      chat: PRODUCTS_CHAT,
      first: {
        title: 'Pesanan #16 · Aida',
        tag: 'Dibayar · FPX',
        tone: 'ok',
        big: 'RM95',
        lines: [['1× Kek coklat · 1kg', 'RM95'], ['Ambil sendiri', 'Sab 21 Nov']],
        action: 'Tiada apa nak disemak',
      },
      suggested: [{ swatch: 'coklat', name: 'Kek coklat · 1kg', price: 'RM95' }, { swatch: 'batik', name: 'Kek batik', price: 'RM45' }],
      ping: { from: 'Curios', when: 'baru tadi', text: 'Pesanan baru #16 · RM95 dibayar dengan FPX · ambil Sab 21 Nov.', foot: 'Sudah dalam Pesanan, ditanda dibayar.' },
      asked: PRODUCTS_ASKED,
      missTag: 'Belum ada dalam menu anda',
    },
    capture: {
      ask: (name) => `Nak ${name} mesej anda semula?`,
      why: (name) => `Nombor anda pergi kepada ${name} supaya mereka boleh balas di WhatsApp. Orang lain tak nampak.`,
      label: 'Nombor WhatsApp anda',
      send: 'Hantar nombor saya',
      sent: (name) => `Baik. ${name} akan mesej anda di WhatsApp.`,
    },
    checkout: {
      price: 'RM95',
      item: 'Kek coklat',
      itemSub: '1kg · RM95 seunit',
      pickupWhere: 'Seksyen 7, Shah Alam',
      deliveryWhere: 'Shah Alam dan Klang',
      free: 'Percuma',
      deliveryFee: 'RM10',
      dayTitle: 'Hari',
      dayHint: 'Notis 1 hari · tutup hari Isnin',
      days: ['Jum 20', 'Sab 21', 'Ahd 22', 'Sel 24'],
      dayLong: 'Sab 21 Nov',
      banks: ['Maybank2u', 'CIMB Clicks', 'Public Bank', 'RHB Now'],
      pay: (total) => `Bayar ${total}`,
      buyer: { name: 'Aida', phone: '012-345 6789' },
      code: '7Q4M',
      keep: (code) => `Simpan kod ini. Tanya halaman Kek Lina “mana pesanan saya ${code}?” bila-bila masa dan ia tunjuk statusnya.`,
    },
  },
  noCut: {
    eyebrow: 'Tiada potongan, selamanya',
    title: 'Setiap jualan milik anda',
    sub: 'Kek RM100 yang sama, dijual dua cara. Baca resitnya.',
    market: {
      title: 'Di marketplace',
      ref: 'Pesanan #A-55210 · 1 barang',
      line: ['Kek coklat · 1kg', 100],
      fees: [['Yuran platform 5%', 5], ['Komisen ~4%', 4], ['Yuran transaksi 2.16%', 2.16]],
      keep: 'Anda dapat',
    },
    curios: {
      title: 'Di Curios',
      ref: 'Pesanan #16 · keklina · 1 barang',
      line: ['Kek coklat · 1kg', 100],
      commission: 'Komisen Curios',
      bank: ['Yuran bank (FPX, oleh CHIP)', 1],
      keep: 'Anda dapat',
      stamp: '0%',
    },
    incl: [
      { kicker: 'Ganti laman web', title: 'RM2,000+ untuk bina', body: 'Tambah lebih kurang RM420 setahun untuk hosting. Halaman anda ialah laman webnya.' },
      { kicker: 'Ganti borang gateway', title: 'CHIP atau QR anda sendiri', body: 'Sambung CHIP untuk FPX, e-dompet dan kad. Atau terima DuitNow QR.' },
      { kicker: 'Ganti orang SEO', title: 'Dijumpai di Google', body: 'Tajuk, pratonton dan peta laman, disediakan untuk anda.' },
    ],
    fine: 'Contoh marketplace guna yuran biasa di Malaysia pada 2026: yuran platform 5%, komisen 2–6% dan yuran transaksi 2.16%. Bayaran kad dan e-dompet dikenakan 1–2% melalui CHIP.',
  },
  faq: {
    label: 'Soalan lazim',
    title: 'Pernah ditanya. Dijawab di sini.',
    items: [
      { q: 'Boleh guna untuk diri sendiri, bukan bisnes?', a: 'Boleh. Peribadi percuma: halaman dengan AI yang jawab soalan tentang anda, kerja anda dan harga anda. Ia tersembunyi dari Google kecuali anda hidupkan.' },
      { q: 'Kalau ia cakap benda yang salah?', a: 'Ia hanya jawab dari fakta yang anda luluskan. Kalau tiada fakta yang menjawab, ia kata akan semak dengan anda. Ia tak meneka, dan tak bundarkan nombor.' },
      { q: 'Boleh ia baca Instagram saya?', a: 'Belum. Instagram dan TikTok tak benarkan kami baca profil. Tampal bio anda atau beberapa perenggan, atau link laman web atau Linktree.' },
      { q: 'Ia balas dalam BM?', a: 'Ia jawab dalam bahasa yang orang itu guna: BM, English, Manglish atau campur.' },
      { q: 'Boleh tukar dari Peribadi ke Bisnes nanti?', a: 'Boleh, dari Bayaran, bila-bila anda mula menjual. Ia sehala: halaman bisnes tak boleh kembali ke peribadi.' },
    ],
  },
  closing: {
    label: 'Tanya je.',
    onePageFor: 'Satu halaman untuk',
    words: ['freelancer', 'pembuat kek', 'pencari kerja', 'klinik', 'jurulatih', 'studio'],
    button: 'Ambil, percuma',
    note: 'Percuma. Tiada kad. Lebih kurang sepuluh minit.',
  },
  footer: { note: 'Setiap orang, kedai dan tempahan di halaman ini hanyalah contoh rekaan.', signIn: 'Log masuk' },
  personas: {
    aisyah: { q: 'Ambil tempahan untuk November?', a: 'Ya, tinggal dua slot untuk November. Potret dari RM250.', links: ['Portfolio', 'Harga tempahan', 'Tempah slot'] },
    lina: { q: 'Boleh hantar ke Klang?', a: 'Boleh, hantar ke Klang RM15. Shah Alam RM10.', links: ['Tempah di WhatsApp', 'Menu & harga', 'Gambar kek'] },
    hana: { q: 'Pakej branding ada apa?', a: 'Logo, sistem warna dan fon, dan templat media sosial. Dua minggu, dari RM3,800.', links: ['Kajian kes', 'Pakej', 'Mula projek'] },
    daniel: { q: 'Terbuka untuk kerja hybrid?', a: 'Ya, hybrid di KL atau Petaling Jaya, atau remote sepenuhnya.', links: ['Resume', 'GitHub', 'LinkedIn'] },
    farah: { q: 'Ada coaching online?', a: 'Ada, pelan online bulanan dengan semakan mingguan di WhatsApp.', links: ['Pelan online', 'Jadual kelas', 'Panduan makan'] },
  },
};

/** Every section but pricing, which depends on the prices in force: see `landingCopy`. */
export type LandingBase = Omit<LandingCopy, 'pricing'>;

function pricingEn(terms: PlanTerms): LandingCopy['pricing'] {
  const f = figures(terms);
  return {
    eyebrow: 'Pricing',
    title: ['Free to be asked.', `${f.monthlyText} when you’re selling`],
    billing: 'Business billing',
    monthly: 'Monthly',
    yearly: 'Yearly',
    twoMonths: f.months === null ? '' : `−${f.months} ${f.months === 1 ? 'month' : 'months'}`,
    personal: {
      name: 'Personal',
      tag: 'For you',
      price: 'RM0',
      per: 'forever',
      body: 'A page people can ask about you. For freelancers, job seekers and creators.',
      ticks: ['Answers in Malay, English or both', 'Only from facts you approve', 'Your cover, colours and fonts', 'Hidden from Google unless you switch it on'],
      cta: 'Make your free page',
    },
    business: {
      name: 'Business',
      // Left out once a month costs more than the RM95 order it names (DEVIATIONS 226).
      tag: f.rm95Covers ? 'One RM95 order pays for it' : '',
      monthly: f.monthlyText,
      yearly: f.annualText,
      perMonth: 'a month',
      perYear: 'a year',
      noteMonthly: f.months === null ? `Or ${f.annualText} a year.` : `Or ${f.annualText} a year: ${inWords(f.months, EN_NUMBERS)} ${f.months === 1 ? 'month' : 'months'} free.`,
      noteYearly:
        f.months === null
          ? `${f.annualAMonthText} a month, paid once a year.`
          : `${capital(inWords(f.months, EN_NUMBERS))} ${f.months === 1 ? 'month' : 'months'} free. That’s ${f.annualAMonthText} a month.`,
      plus: 'Everything in Personal, plus',
      points: [
        'A shop paid by FPX, e-wallet, card or your own QR',
        'Orders land in your dashboard',
        'Every lead emailed with their number and chat',
        'FAQ pages Google can find',
        f.leads === 1 ? 'Your first lead is free' : `Your first ${inWords(f.leads, EN_NUMBERS)} leads are free`,
      ],
      cta: `Start with ${f.leads} free ${f.leads === 1 ? 'lead' : 'leads'}`,
    },
    calc: {
      eyebrow: 'Will it pay for itself?',
      title: 'Drag to your usual month.',
      orders: 'Orders a month',
      typical: 'A typical order',
      typicalLabel: 'Typical order value',
      takeIn: 'You’d take in',
      yours: 'Your orders',
      cost: (amount) => `Curios Business · ${amount}`,
      pays: (percent, times) => `Business costs about ${percent}% of that. It pays for itself${times >= 1.5 ? ` ${Math.floor(times)} times over` : ''}.`,
      under: (oneMore) => (oneMore ? 'One more order and it pays for itself.' : 'That’s less than Business costs. Stay on Personal until orders pick up.'),
    },
    payment: 'Pay by FPX, card or e-wallet. Nothing renews unless you turn on auto-renew by card.',
    disclaimer: 'The calculator is an illustration, not a forecast.',
    fine: 'Business is paid by FPX, e-wallet or card, through CHIP. The calculator is an illustration, not a forecast.',
    monthlyRinggit: f.monthly,
    annualAMonth: f.annualAMonth,
    monthlyText: f.monthlyText,
    annualAMonthText: f.annualAMonthText,
  };
}

function pricingMs(terms: PlanTerms): LandingCopy['pricing'] {
  const f = figures(terms);
  return {
    eyebrow: 'Harga',
    title: ['Percuma untuk ditanya.', `${f.monthlyText} bila anda menjual`],
    billing: 'Bayaran bisnes',
    monthly: 'Bulanan',
    yearly: 'Tahunan',
    twoMonths: f.months === null ? '' : `−${f.months} bulan`,
    personal: {
      name: 'Peribadi',
      tag: 'Untuk anda',
      price: 'RM0',
      per: 'selamanya',
      body: 'Halaman yang orang boleh tanya tentang anda. Untuk freelancer, pencari kerja dan kreator.',
      ticks: ['Jawab dalam BM, English atau campur', 'Hanya dari fakta yang anda luluskan', 'Kulit, warna dan fon anda sendiri', 'Tersembunyi dari Google kecuali anda hidupkan'],
      cta: 'Buat halaman percuma',
    },
    business: {
      name: 'Bisnes',
      tag: f.rm95Covers ? 'Satu tempahan RM95 dah cukup bayar' : '',
      monthly: f.monthlyText,
      yearly: f.annualText,
      perMonth: 'sebulan',
      perYear: 'setahun',
      noteMonthly: f.months === null ? `Atau ${f.annualText} setahun.` : `Atau ${f.annualText} setahun: percuma ${inWords(f.months, MS_NUMBERS)} bulan.`,
      noteYearly:
        f.months === null
          ? `${f.annualAMonthText} sebulan, bayar sekali setahun.`
          : `Percuma ${inWords(f.months, MS_NUMBERS)} bulan. Itu ${f.annualAMonthText} sebulan.`,
      plus: 'Semua dalam Peribadi, dan',
      points: [
        'Kedai yang dibayar melalui FPX, e-dompet, kad atau QR anda sendiri',
        'Tempahan masuk dalam dashboard anda',
        'Setiap lead diemel dengan nombor dan perbualan mereka',
        'Halaman soalan lazim yang Google boleh jumpa',
        f.leads === 1 ? 'Lead pertama percuma' : `${capital(inWords(f.leads, MS_NUMBERS))} lead pertama percuma`,
      ],
      cta: `Mula dengan ${f.leads} lead percuma`,
    },
    calc: {
      eyebrow: 'Berbaloi tak?',
      title: 'Seret ke bulan biasa anda.',
      orders: 'Tempahan sebulan',
      typical: 'Tempahan biasa',
      typicalLabel: 'Nilai tempahan biasa',
      takeIn: 'Anda akan terima',
      yours: 'Tempahan anda',
      cost: (amount) => `Curios Bisnes · ${amount}`,
      pays: (percent, times) =>
        `Bisnes kosnya kira-kira ${percent}% daripada itu. ${times >= 1.5 ? `Ia bayar balik ${Math.floor(times)} kali ganda.` : 'Ia bayar balik sendiri.'}`,
      under: (oneMore) => (oneMore ? 'Satu tempahan lagi dan ia bayar balik sendiri.' : 'Itu kurang dari kos Bisnes. Kekal di Peribadi sampai tempahan naik.'),
    },
    payment: 'Bayar dengan FPX, kad atau e-dompet. Tiada pembaharuan automatik melainkan anda hidupkan auto-renew dengan kad.',
    disclaimer: 'Kalkulator ini contoh, bukan ramalan.',
    fine: 'Bisnes dibayar dengan FPX, e-dompet atau kad, melalui CHIP. Kalkulator ini contoh, bukan ramalan.',
    monthlyRinggit: f.monthly,
    annualAMonth: f.annualAMonth,
    monthlyText: f.monthlyText,
    annualAMonthText: f.annualAMonthText,
  };
}

/** The words that do not depend on a price, for the client sections that read them by locale. */
export const COPY: Record<Locale, LandingBase> = { en: EN, ms: MS };

/** The pricing section at the prices and free leads in force (`getSettings()`, in the page). */
export function pricingCopy(locale: Locale, terms: PlanTerms): LandingCopy['pricing'] {
  return locale === 'ms' ? pricingMs(terms) : pricingEn(terms);
}

/** The whole landing page's words, pricing included, at the prices in force. */
export function landingCopy(locale: Locale, terms: PlanTerms): LandingCopy {
  return { ...COPY[locale], pricing: pricingCopy(locale, terms) };
}
