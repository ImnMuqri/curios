import { DEMO_EN, DEMO_MS, type Demo } from './demo.js';
/**
 * Every word on the landing page, in both languages, in one shape.
 *
 * The Malay is written to be read, not translated from the English -- but it
 * was drafted by an AI, and DESIGN.md is clear that Malay copy comes from a
 * Malay speaker. It needs a native read before launch (README.md, "Before
 * launch").
 *
 * Every claim here is one the product makes true today, checked against the
 * code on 2026-10-03: the lead notification is an email with a WhatsApp reply
 * link (apps/workers/src/leads/notify.ts), the AI refuses to guess a price
 * (apps/api/src/modules/chat/prompt.ts), Instagram cannot be read
 * (apps/workers/src/sources/instagram.adapter.ts), three leads are free
 * (packages/core/src/plan.ts), and Business is RM39/RM390 by FPX with no
 * auto-renew (devDocs/README.md). Change the product, change this file.
 */

export type Locale = 'en' | 'ms';

export interface Step {
  title: string;
  body: string;
}

export interface Faq {
  q: string;
  a: string;
}

export interface LandingCopy {
  locale: Locale;
  meta: { title: string; description: string; ogAlt: string; ogLocale: string };
  nav: {
    home: string;
    signIn: string;
    otherLocaleLabel: string;
    otherLocaleName: string;
    cta: string;
    /** The header button on a phone, where the full label does not fit beside the name. */
    ctaShort: string;
    /** In-page links in the header, wide screens only. */
    sections: { href: '#how' | '#pricing' | '#faq'; label: string }[];
  };
  /** The curios.my/ field in the hero and the closing band. */
  claim: { label: string; placeholder: string };
  /** What each photograph should show, until the real ones arrive. */
  photos: { hero: string; setup: string };
  heroScene: {
    /** Caption 2 and 3; caption 1 is hero.title + hero.sub. */
    problem: string;
    fix: string;
    scrollCue: string;
  };
  how: { title: string; steps: Step[] };
  paid: {
    title: string;
    closing: string;
    /** Accessible name for the progress line. */
    progressLabel: string;
  };
  shopSection: {
    title: string;
    points: string[];
    demoNote: string;
    /** Heading over the message panel. */
    messageTitle: string;
    /** The demo's order button. */
    orderButton: string;
  };
  quiet: { title: string; tiles: Step[] };
  hero: {
    title: string;
    sub: string;
    cta: string;
    ctaNote: string;
    demoNote: string;
  };
  storm: {
    /** Beside the merged question, the way the Questions screen counts: "asked 40×". */
    asked: (n: number) => string;
  };
  leads: {
    steps: Step[];
    visitorPhone: string;
    ownerPhone: string;
    asleep: string;
    lockDate: string;
  };
  trust: {
    title: string;
    body: string;
    /** The line under the price list card. */
    approvedBy: string;
    unsureQuestion: string;
    unsureAnswer: string;
  };
  pricing: {
    title: string;
    personal: { name: string; price: string; blurb: string; points: string[]; cta: string };
    business: {
      name: string;
      price: string;
      per: string;
      annual: string;
      /** The Monthly / Yearly switch. */
      billing: { label: string; monthly: string; yearly: string; yearPrice: string; perYear: string; yearNote: string };
      trial: string;
      points: string[];
      cta: string;
    };
    payment: string;
    math: string;
  };
  faq: { title: string; items: Faq[] };
  final: { title: string; sub: string; cta: string };
  footer: { signIn: string; start: string; demoNote: string };
  demo: { label: string };
  /** Kek Lina, the demo shop, in this page's language (demo.ts). */
  shop: Demo;
}

export const en: LandingCopy = {
  locale: 'en',
  meta: {
    title: 'Curios: a link in bio that answers your customers',
    description:
      'Your link in bio answers “berapa harga” in Malay or English, from prices you approved. Free to answer. Business gets every lead by email. RM39 a month.',
    ogAlt: 'A Curios page answering “Berapa harga kek coklat 1kg?” with “RM95”.',
    ogLocale: 'en_MY',
  },
  nav: {
    home: 'Curios home',
    signIn: 'Sign in',
    otherLocaleLabel: 'Baca dalam Bahasa Melayu',
    otherLocaleName: 'BM',
    cta: 'Create your free page',
    ctaShort: 'Create page',
    sections: [
      { href: '#how', label: 'How it works' },
      { href: '#pricing', label: 'Pricing' },
      { href: '#faq', label: 'FAQ' },
    ],
  },
  claim: { label: 'The address you want for your page', placeholder: 'yourshop' },
  photos: {
    hero: 'A home baker at her counter, holding her phone with her Curios page open',
    setup: 'An owner pasting her shop’s link into Curios on a laptop, phone beside her',
  },
  heroScene: {
    problem: 'Forty people. One question.',
    fix: 'Answer it once. Your page answers the rest.',
    scrollCue: 'Scroll to see it answer',
  },
  how: {
    title: 'Three steps from your price list to answers.',
    steps: [
      { title: 'Paste your link, or your price list', body: 'It reads your website or the text you paste. Instagram can’t be read, so paste what’s on it instead.' },
      { title: 'Tick what’s right', body: 'Every fact it found waits for you. Nothing is said until you approve it.' },
      { title: 'Put one link in your bio', body: 'curios.my/keklina answers from then on, day and night.' },
    ],
  },
  paid: {
    title: 'What Business does at 11:42 at night.',
    closing: 'That’s what RM39 pays for.',
    progressLabel: 'How far through the lead you are',
  },
  shopSection: {
    title: 'Your prices on a shelf. Their order in your WhatsApp.',
    points: [
      'One price, or sizes with their own prices',
      'The chat quotes your shelf’s prices',
      'The basket arrives as a WhatsApp message',
    ],
    demoNote: 'A demo shop. Kek Lina is not a real shop.',
    messageTitle: 'This is what Lina would get on WhatsApp',
    orderButton: 'See the order message',
  },
  quiet: {
    title: 'The quiet parts that save you later.',
    tiles: [
      { title: 'Malay, English or rojak', body: 'It answers in the language the customer used.' },
      { title: 'FAQ pages from real questions', body: 'Questions asked three times or more, with your answer, become pages Google can find.' },
      { title: 'Works with any bio link', body: 'Instagram, TikTok, WhatsApp Business, a QR on your counter.' },
    ],
  },
  hero: {
    title: 'Your link in bio answers “berapa harga” for you.',
    sub: 'For shops that sell on Instagram and WhatsApp. Curios answers your customers in Malay or English from the prices and details you approve, and sends you the number of anyone ready to order.',
    cta: 'Create your free page',
    ctaNote: 'Answering is free on every plan. No card needed.',
    demoNote: 'A demo page. Kek Lina is not a real shop.',
  },
  storm: {
    asked: (n) => `asked ${n}×`,
  },
  leads: {
    steps: [
      { title: 'They ask, any time', body: 'A customer asks at 11:42 at night and gets an answer straight away.' },
      { title: 'It answers from your facts', body: 'It quotes the RM95 price and RM10 delivery charge you approved.' },
      { title: 'It asks for their number', body: 'It shows one field for their WhatsApp number.' },
      { title: 'You get an email with everything', body: 'The email has their number, the order, the day, the area and the full chat.' },
      { title: 'One tap to reply on WhatsApp', body: 'WhatsApp opens with a greeting already typed in the language they used.' },
    ],
    visitorPhone: 'The customer’s phone',
    ownerPhone: 'Your phone',
    asleep: 'You, asleep',
    lockDate: 'Friday',
  },
  trust: {
    title: 'It only quotes prices you approved.',
    body: 'The same goes for dates and addresses. When it doesn’t know, it tells the customer it will check with you, and the question waits on your list until you answer. You can also give it words it must never use about your shop.',
    approvedBy: 'Every line approved by you',
    unsureQuestion: 'Ada kek tanpa gula?',
    unsureAnswer: 'Tak pasti. Saya check dengan Lina dulu ya.',
  },
  pricing: {
    title: 'Answering is free. Leads are RM39 a month.',
    personal: {
      name: 'Personal',
      price: 'Free',
      blurb: 'A page with an AI that answers questions about you.',
      points: [
        'Answers in Malay, English or both',
        'Hidden from Google unless you switch it on',
        'Switch to Business when you start selling',
      ],
      cta: 'Create your free page',
    },
    business: {
      name: 'Business',
      price: 'RM39',
      per: 'a month',
      annual: 'or RM390 a year, two months free',
      billing: { label: 'Billing', monthly: 'Monthly', yearly: 'Yearly', yearPrice: 'RM390', perYear: 'a year', yearNote: 'Two months free, paid once a year' },
      trial: 'Your first three leads are free.',
      points: [
        'Every lead emailed to you with their number and the whole chat',
        'Reply on WhatsApp in one tap',
        'FAQ pages Google can find, built from what customers ask',
        'Questions grouped by meaning, so you answer each one once',
        'Your own shop on your page, orders to your WhatsApp',
      ],
      cta: 'Create a page with 3 free leads',
    },
    payment: 'Paid by FPX online banking. No card and no automatic charge, so nothing renews without you.',
    math: 'One RM95 order a month pays for it.',
  },
  faq: {
    title: 'Questions owners ask',
    items: [
      {
        q: 'Is answering really free?',
        a: 'Yes. The AI answers your customers on every plan, for as long as you have a page. Business pays for the leads: the number, the chat, and the email that brings them to you.',
      },
      {
        q: 'What if it gives a wrong price?',
        a: 'It can only quote prices, dates and addresses that you approved. If nothing you approved answers the question, it tells the customer it will check with you. It never guesses, and never rounds a number.',
      },
      {
        q: 'Can it read my Instagram?',
        a: 'Not yet. Instagram and TikTok don’t let us read profiles. Paste your bio or a few paragraphs about your shop, or a website or Linktree link if you have one.',
      },
      {
        q: 'Does it reply in Malay?',
        a: 'It answers in the language the customer used: Malay, English, Manglish or a mix.',
      },
      {
        q: 'How do I pay?',
        a: 'By FPX online banking, RM39 a month or RM390 a year. There is no card on file and no automatic charge.',
      },
      {
        q: 'What happens after my three free leads?',
        a: 'Your page keeps answering. To keep receiving leads, switch on Business.',
      },
      {
        q: 'Can I sell on my page?',
        a: 'Yes, on a business page. Add your items with their prices, and a Visit shop tile appears on your page. Customers fill a basket and send it to your WhatsApp.',
      },
      {
        q: 'Can I start with a personal page and switch later?',
        a: 'Yes, from Billing, whenever you start selling. It is a one-way switch: a business page can’t go back to personal.',
      },
    ],
  },
  final: {
    title: 'Put your price list in your bio link.',
    sub: 'Paste your website or a few paragraphs about your shop, approve the facts it finds, and share the link.',
    cta: 'Create your free page',
  },
  footer: {
    signIn: 'Sign in',
    start: 'Create your free page',
    demoNote: 'Kek Lina is a demo shop made up for this page.',
  },
  demo: { label: 'Demo of a Curios page for a home bakery' },
  shop: DEMO_EN,
};

export const ms: LandingCopy = {
  locale: 'ms',
  meta: {
    title: 'Curios: link bio yang jawab soalan pelanggan',
    description:
      'Link bio anda jawab “berapa harga” dalam BM atau English, ikut harga yang anda luluskan. Menjawab percuma. Bisnes dapat setiap lead lewat emel, RM39.',
    ogAlt: 'Page Curios menjawab “Berapa harga kek coklat 1kg?” dengan “RM95”.',
    ogLocale: 'ms_MY',
  },
  nav: {
    home: 'Laman utama Curios',
    signIn: 'Log masuk',
    otherLocaleLabel: 'Read in English',
    otherLocaleName: 'EN',
    cta: 'Buat page percuma',
    ctaShort: 'Buat page',
    sections: [
      { href: '#how', label: 'Cara guna' },
      { href: '#pricing', label: 'Harga' },
      { href: '#faq', label: 'Soalan' },
    ],
  },
  claim: { label: 'Alamat yang anda nak untuk page anda', placeholder: 'kedaianda' },
  photos: {
    hero: 'A home baker at her counter, holding her phone with her Curios page open',
    setup: 'An owner pasting her shop’s link into Curios on a laptop, phone beside her',
  },
  heroScene: {
    problem: 'Empat puluh orang. Satu soalan.',
    fix: 'Jawab sekali. Page anda jawab selebihnya.',
    scrollCue: 'Scroll untuk tengok ia jawab',
  },
  how: {
    title: 'Tiga langkah dari senarai harga ke jawapan.',
    steps: [
      { title: 'Tampal link, atau senarai harga', body: 'Ia baca laman web anda atau teks yang anda tampal. Instagram tak boleh dibaca, jadi tampal apa yang ada di situ.' },
      { title: 'Tanda yang betul', body: 'Setiap fakta yang dijumpai tunggu anda. Tiada apa disebut sampai anda luluskan.' },
      { title: 'Letak satu link di bio', body: 'curios.my/keklina jawab lepas tu, siang dan malam.' },
    ],
  },
  paid: {
    title: 'Apa Bisnes buat pukul 11:42 malam.',
    closing: 'Itulah yang RM39 bayar.',
    progressLabel: 'Sejauh mana anda dalam cerita lead ini',
  },
  shopSection: {
    title: 'Harga anda di rak. Tempahan mereka di WhatsApp anda.',
    points: [
      'Satu harga, atau saiz dengan harga sendiri',
      'Chat sebut harga dari rak anda',
      'Bakul sampai sebagai mesej WhatsApp',
    ],
    demoNote: 'Kedai demo. Kek Lina bukan kedai sebenar.',
    messageTitle: 'Ini yang Lina akan dapat di WhatsApp',
    orderButton: 'Tengok mesej tempahan',
  },
  quiet: {
    title: 'Benda kecil yang selamatkan anda nanti.',
    tiles: [
      { title: 'BM, English atau rojak', body: 'Ia jawab dalam bahasa yang pelanggan guna.' },
      { title: 'Page FAQ dari soalan sebenar', body: 'Soalan yang ditanya tiga kali atau lebih, dengan jawapan anda, jadi page yang Google boleh jumpa.' },
      { title: 'Guna dengan mana-mana link bio', body: 'Instagram, TikTok, WhatsApp Business, QR di kaunter.' },
    ],
  },
  hero: {
    title: 'Biar link bio yang jawab “berapa harga”.',
    sub: 'Untuk kedai yang berniaga di Instagram dan WhatsApp. Curios jawab pelanggan dalam BM atau English ikut harga dan maklumat yang anda luluskan, dan hantar nombor sesiapa yang nak order.',
    cta: 'Buat page percuma',
    ctaNote: 'Menjawab percuma untuk semua pelan. Tak perlu kad.',
    demoNote: 'Page demo. Kek Lina bukan kedai sebenar.',
  },
  storm: {
    asked: (n) => `ditanya ${n}×`,
  },
  leads: {
    steps: [
      { title: 'Dia tanya, bila-bila masa', body: 'Pelanggan tanya pukul 11:42 malam dan terus dapat jawapan.' },
      { title: 'Page jawab ikut fakta anda', body: 'Dia sebut harga RM95 dan caj hantar RM10 yang anda luluskan.' },
      { title: 'Page minta nombor dia', body: 'Dia tunjuk satu ruang untuk nombor WhatsApp.' },
      { title: 'Anda dapat emel yang lengkap', body: 'Emel tu ada nombor, order, hari, kawasan dan seluruh chat.' },
      { title: 'Sekali tekan, balas di WhatsApp', body: 'WhatsApp buka dengan ucapan yang dah ditaip dalam bahasa dia.' },
    ],
    visitorPhone: 'Telefon pelanggan',
    ownerPhone: 'Telefon anda',
    asleep: 'Anda, tengah tidur',
    lockDate: 'Jumaat',
  },
  trust: {
    title: 'Dia cuma sebut harga yang anda luluskan.',
    body: 'Begitu juga tarikh dan alamat. Kalau tak tahu, dia beritahu pelanggan dia akan tanya anda dulu, dan soalan tu tunggu dalam senarai anda sampai anda jawab. Anda juga boleh senaraikan perkataan yang dia tak boleh guna pasal kedai anda.',
    approvedBy: 'Setiap baris diluluskan oleh anda',
    unsureQuestion: 'Ada kek tanpa gula?',
    unsureAnswer: 'Tak pasti. Saya check dengan Lina dulu ya.',
  },
  pricing: {
    title: 'Menjawab percuma. Lead RM39 sebulan.',
    personal: {
      name: 'Peribadi',
      price: 'Percuma',
      blurb: 'Page dengan AI yang jawab soalan pasal anda.',
      points: [
        'Jawab dalam BM, English atau campur',
        'Tersembunyi daripada Google kecuali anda buka',
        'Tukar ke Bisnes bila anda mula berniaga',
      ],
      cta: 'Buat page percuma',
    },
    business: {
      name: 'Bisnes',
      price: 'RM39',
      per: 'sebulan',
      annual: 'atau RM390 setahun, percuma dua bulan',
      billing: { label: 'Bayaran', monthly: 'Bulanan', yearly: 'Tahunan', yearPrice: 'RM390', perYear: 'setahun', yearNote: 'Percuma dua bulan, bayar sekali setahun' },
      trial: 'Tiga lead pertama percuma.',
      points: [
        'Setiap lead diemel pada anda, dengan nombor dan seluruh chat',
        'Balas di WhatsApp dengan sekali tekan',
        'Page FAQ yang Google boleh jumpa, dari soalan pelanggan',
        'Soalan dikumpul ikut maksud, jadi anda jawab sekali sahaja',
        'Kedai sendiri di page anda, tempahan ke WhatsApp anda',
      ],
      cta: 'Buat page dengan 3 lead percuma',
    },
    payment: 'Bayar dengan FPX perbankan online. Tak ada kad dan tak ada caj automatik, jadi tiada apa yang diperbaharui tanpa anda.',
    math: 'Satu order RM95 sebulan dah cukup bayar.',
  },
  faq: {
    title: 'Soalan yang pemilik kedai tanya',
    items: [
      {
        q: 'Betul ke menjawab percuma?',
        a: 'Betul. AI jawab pelanggan anda untuk semua pelan, selagi anda ada page. Bisnes bayar untuk lead: nombor, chat, dan emel yang bawa mereka pada anda.',
      },
      {
        q: 'Kalau dia bagi harga salah?',
        a: 'Dia cuma boleh sebut harga, tarikh dan alamat yang anda luluskan. Kalau tiada fakta yang menjawab, dia beritahu pelanggan dia akan tanya anda dulu. Dia tak pernah teka, dan tak pernah bundarkan nombor.',
      },
      {
        q: 'Boleh dia baca Instagram saya?',
        a: 'Belum lagi. Instagram dan TikTok tak bagi kami baca profil. Tampal bio anda atau beberapa perenggan pasal kedai, atau link website atau Linktree kalau ada.',
      },
      {
        q: 'Dia jawab dalam BM?',
        a: 'Dia jawab dalam bahasa yang pelanggan guna: BM, English, Manglish atau campur.',
      },
      {
        q: 'Macam mana nak bayar?',
        a: 'Dengan FPX perbankan online, RM39 sebulan atau RM390 setahun. Tak ada kad disimpan dan tak ada caj automatik.',
      },
      {
        q: 'Apa jadi lepas tiga lead percuma?',
        a: 'Page anda terus menjawab. Untuk terus terima lead, buka Bisnes.',
      },
      {
        q: 'Boleh saya jual di page saya?',
        a: 'Boleh, di page bisnes. Masukkan barang dengan harganya, dan tile Lawati kedai muncul di page anda. Pelanggan isi bakul dan hantar ke WhatsApp anda.',
      },
      {
        q: 'Boleh saya mula dengan page peribadi, dan tukar kemudian?',
        a: 'Boleh, dari Billing, bila anda mula berniaga. Tukar sekali sahaja: page bisnes tak boleh balik jadi peribadi.',
      },
    ],
  },
  final: {
    title: 'Letak senarai harga dalam link bio anda.',
    sub: 'Tampal website atau beberapa perenggan pasal kedai anda, luluskan fakta yang dia jumpa, dan kongsi link.',
    cta: 'Buat page percuma',
  },
  footer: {
    signIn: 'Log masuk',
    start: 'Buat page percuma',
    demoNote: 'Kek Lina ialah kedai demo yang direka untuk page ini.',
  },
  demo: { label: 'Demo page Curios untuk kedai kek dari rumah' },
  shop: DEMO_MS,
};

export const COPY: Record<Locale, LandingCopy> = { en, ms };
