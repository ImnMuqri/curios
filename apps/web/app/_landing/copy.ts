import { PLAN_PRICES_CENTS } from '@curios/core/billing';

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
 * Client-safe: the price comes from the @curios/core/billing subpath, which
 * imports nothing, so the client sections read their words from here by
 * locale (several are functions, which cannot cross from a server component).
 */

export type Locale = 'en' | 'ms';

export interface Faq {
  q: string;
  a: string;
}

const MONTHLY = PLAN_PRICES_CENTS.MONTHLY / 100;
const ANNUAL = PLAN_PRICES_CENTS.ANNUAL / 100;
/** The annual price a month, to the sen: RM40.83 at RM490. */
const ANNUAL_A_MONTH = (PLAN_PRICES_CENTS.ANNUAL / 12 / 100).toFixed(2);

export interface PersonaWords {
  q: string;
  a: string;
  links: [string, string, string];
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
    title: string;
    lede: string;
    rows: { key: PersonaKey; label: string; qs: string[] }[];
    pageOf: (name: string) => string;
  };
  how: {
    eyebrow: string;
    title: string;
    keep: string;
    steps: { title: string; body: string }[];
    pasted: string;
    /** What the illustrator pasted, with the four facts it finds marked. */
    pastedText: (string | { fact: number; text: string })[];
    found: string;
    facts: { text: string; topic: string }[];
    approved: (n: number) => string;
    factOf: (n: number, total: number) => string;
    from: string;
    usedFor: (topic: string) => string;
    fix: string;
    approve: string;
    approvedStamp: string;
    ring: string;
    card: { name: string; role: string; bio: string };
  };
  business: {
    eyebrow: string;
    title: string;
    caps: { title: string; body: string }[];
    stage: string;
    customer: string;
    yours: string;
    shopPath: string;
    lib: { bio: string; shop: string; shopSub: string; shopPhoto: string; links: string[]; foot: string };
    open: string;
    facts: string;
    cats: string[];
    bestSeller: string;
    items: { name: string; price: string }[];
    basketEmpty: string;
    basket: (n: number, total: number) => string;
    checkout: string;
    itemsTotal: string;
    name: string;
    phone: string;
    pickup: string;
    delivery: string;
    continueToPay: string;
    howPay: string;
    ways: { label: string; sub: string; mark: string }[];
    yourBank: string;
    banks: string[];
    pay: string;
    payWith: string;
    opening: string;
    openingNote: string;
    approved: string;
    approvedNote: string;
    paidChip: string;
    processed: string;
    received: string;
    receivedNote: string;
    orders: string;
    seeShop: string;
    toCheck: string;
    paidWeek: string;
    seg: [string, string, string, string];
    mira: string;
    miraSub: string;
    paidOnline: string;
    completed: string;
    actTitle: string;
    actNote: string;
    markDone: string;
    done: string;
    hakim: string;
    hakimSub: string;
    awaiting: string;
    weiLing: string;
    weiLingSub: string;
    paid: string;
    newOrder: string;
    now: string;
  };
  pricing: {
    eyebrow: string;
    title: string;
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
      cost: (amount: string) => string;
      pays: (percent: number, times: number) => string;
      under: string;
      typicalLabel: string;
    };
    /** How Business is paid. Billing shows this line too. */
    payment: string;
    disclaimer: string;
    /** Numbers the calculator needs, from PLAN_PRICES_CENTS. */
    monthlyRinggit: number;
    annualAMonth: string;
  };
  faq: { title: string; items: Faq[] };
  closing: { title: string; onePageFor: string; words: string[]; button: string; note: string };
  footer: { note: string; signIn: string };
  personas: Record<PersonaKey, PersonaWords>;
}

export type PersonaKey = 'aisyah' | 'lina' | 'hana' | 'daniel' | 'aina' | 'farah';

const EN: LandingCopy = {
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
    title: 'One page for whoever’s asking.',
    lede: 'Pick who you are. Each page knows its owner, and nothing else.',
    rows: [
      { key: 'aisyah', label: 'Freelancers', qs: ['taking commissions?', 'rate for a portrait?', 'ada slot Disember?', 'how long does it take?'] },
      { key: 'daniel', label: 'Job seekers', qs: ['open to hybrid?', 'notice period?', 'what stack do you use?', 'expected salary range?'] },
      { key: 'farah', label: 'Creators & coaches', qs: ['online coaching ada?', 'beginner friendly?', 'collab rates?', 'class schedule?'] },
      { key: 'lina', label: 'Home businesses', qs: ['hantar Klang tak?', 'berapa harga 1kg?', 'boleh tulis nama?', 'buka hari Ahad?'] },
      { key: 'hana', label: 'Studios & services', qs: ['what’s in the package?', 'how long does it take?', 'boleh buat logo je?', 'do you work remote?'] },
    ],
    pageOf: (name) => `${name}’s Curios page`,
  },
  how: {
    eyebrow: 'How it works',
    title: 'Ten minutes from blank to bio link.',
    keep: 'Keep scrolling →',
    steps: [
      { title: 'Tell it about you.', body: 'Paste your website, your Linktree, or just a few honest paragraphs. It reads them and pulls out the facts.' },
      { title: 'Approve what’s right.', body: 'Each fact comes up as a card. Keep the right ones, fix the rest. It never says anything you didn’t approve.' },
      { title: 'Put the link in your bio.', body: 'Share curios.my/yourname on Instagram, TikTok or WhatsApp. Anyone who taps it can ask, day or night.' },
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
    found: 'It found',
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
    fix: '← Fix it',
    approve: 'Approve →',
    approvedStamp: 'Approved',
    ring: 'CURIOS.MY/AISYAHDRAWS · CURIOUS? JUST ASK · ',
    card: { name: 'aisyahdraws', role: 'Illustrator · Ipoh', bio: 'Portraits, book covers, editorial. Commissions open for November.' },
  },
  business: {
    eyebrow: 'For business',
    title: 'Have a business? Your page becomes a shop.',
    caps: [
      { title: 'Tap to add', body: 'Your shop gets its own page, with pictures, prices and sizes. Link it from your page or straight from Instagram.' },
      { title: 'Check out', body: 'Name, WhatsApp number, pickup or delivery. No account needed.' },
      { title: 'Pay their way', body: 'FPX, e-wallet or card through CHIP, confirmed straight away. Or your own DuitNow QR with a receipt.' },
      { title: 'Order received', body: 'They get a confirmation with the order number.' },
      { title: 'It lands in your Orders', body: 'Already paid, nothing to check. Mark it completed when they collect.' },
    ],
    stage: 'A customer opens the shop from Lina’s link in bio, adds items, checks out and pays from their bank through CHIP; the order arrives in Lina’s Curios Orders, already paid',
    customer: 'The customer’s phone',
    yours: 'Your phone',
    shopPath: 'curios.my/keklina/shop',
    lib: {
      bio: 'Homemade cakes and desserts in Shah Alam.',
      shop: 'Shop',
      shopSub: '8 items · pickup Sat',
      shopPhoto: 'Kek Lina baking',
      links: ['Order on WhatsApp', 'Cake photos on Instagram', 'Find us in Seksyen 7'],
      foot: 'Questions · Made with Curios',
    },
    open: 'Open for orders',
    facts: 'Seksyen 7, Shah Alam · Pickup or delivery',
    cats: ['All', 'Kek', 'Kuih', 'Raya'],
    bestSeller: 'Best seller',
    items: [
      { name: 'Kek coklat · 1kg', price: 'RM95' },
      { name: 'Kek batik', price: 'RM45' },
      { name: 'Cookies balang', price: 'RM25' },
      { name: 'Brownies, box of 9', price: 'RM30' },
    ],
    basketEmpty: 'Basket is empty',
    basket: (n, total) => `${n} in basket · RM${total}`,
    checkout: 'Checkout',
    itemsTotal: '3 items · RM235',
    name: 'Your name',
    phone: 'WhatsApp number',
    pickup: 'Pickup · Sat',
    delivery: 'Delivery RM10',
    continueToPay: 'Continue to pay',
    howPay: 'How you’ll pay',
    ways: [
      { label: 'Online banking', sub: 'FPX · Maybank2u, CIMB, RHB', mark: 'FPX' },
      { label: 'E-wallet', sub: 'Touch ’n Go, GrabPay, ShopeePay', mark: 'TNG' },
      { label: 'Card', sub: 'Debit or credit card', mark: 'VISA' },
      { label: 'DuitNow QR', sub: 'Scan, then upload your receipt', mark: 'QR' },
    ],
    yourBank: 'Your bank',
    banks: ['Maybank2u', 'CIMB Clicks', 'Public Bank', 'RHB Now'],
    pay: 'Pay RM235',
    payWith: 'Pay RM235 with Maybank2u',
    opening: 'Opening Maybank2u…',
    openingNote: 'Approve RM235 in your bank, then you’ll come straight back to Kek Lina.',
    approved: 'Approved in Maybank2u',
    approvedNote: 'Taking you back to Kek Lina…',
    paidChip: 'RM235 paid',
    processed: 'Payment processed by CHIP',
    received: 'Order received',
    receivedNote: '#14 · RM235 · paid by FPX',
    orders: 'Orders',
    seeShop: 'See your shop',
    toCheck: 'Receipts to check',
    paidWeek: 'Paid this week',
    seg: ['All', 'To check', 'Paid', 'Refunds'],
    mira: 'Mira Hassan',
    miraSub: '#14 · 3 items · Pickup Sat',
    paidOnline: 'Paid online',
    completed: 'Completed',
    actTitle: 'Paid by FPX. Ready on Sat 17 Oct',
    actNote: 'Nothing to check. Mark it completed once Mira has it.',
    markDone: '✓ Mark completed',
    done: 'Completed ✓',
    hakim: 'Hakim Rahman',
    hakimSub: '#13 · 1 item · Delivery Sat',
    awaiting: 'Awaiting payment',
    weiLing: 'Wei Ling',
    weiLingSub: '#12 · 2 items · Pickup Fri',
    paid: 'Paid',
    newOrder: 'New order · RM235',
    now: 'now',
  },
  pricing: {
    eyebrow: 'Pricing',
    title: `Free to be asked. RM${MONTHLY} when you’re selling.`,
    billing: 'Business billing',
    monthly: 'Monthly',
    yearly: 'Yearly',
    twoMonths: '−2 months',
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
      tag: 'One RM95 order pays for it',
      monthly: `RM${MONTHLY}`,
      yearly: `RM${ANNUAL}`,
      perMonth: 'a month',
      perYear: 'a year',
      noteMonthly: `Or RM${ANNUAL} a year: two months free.`,
      noteYearly: `RM${ANNUAL_A_MONTH} a month, paid once a year.`,
      plus: 'Everything in Personal, plus',
      points: [
        'A shop paid by FPX, e-wallet, card or your own QR',
        'Orders land in your dashboard',
        'Every lead emailed with their number and chat',
        'FAQ pages Google can find',
        'Your first three leads are free',
      ],
      cta: 'Start with 3 free leads',
    },
    calc: {
      eyebrow: 'Will it pay for itself?',
      title: 'Drag to your usual month.',
      orders: 'Orders a month',
      typical: 'A typical order',
      typicalLabel: 'Typical order value',
      takeIn: 'You’d take in',
      yours: 'Your orders',
      cost: (amount) => `Curios Business · RM${amount}`,
      pays: (percent, times) => `Business costs about ${percent}% of that. It pays for itself ${times >= 2 ? `${times} times over.` : 'once.'}`,
      under: 'That’s less than Business costs. Stay on Personal until orders pick up.',
    },
    payment: 'Pay by FPX, card or e-wallet. Nothing renews unless you turn on auto-renew by card.',
    disclaimer: 'The calculator is an illustration, not a forecast.',
    monthlyRinggit: MONTHLY,
    annualAMonth: ANNUAL_A_MONTH,
  },
  faq: {
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
    title: 'Curious? Just ask',
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
    aina: { q: 'Are you open on Saturday?', a: 'Yes, 9am to 1pm on Saturdays. Walk-ins welcome.', links: ['Book on WhatsApp', 'Directions', 'Panel companies'] },
    farah: { q: 'Do you do online coaching?', a: 'Yes, monthly online plans with weekly check-ins on WhatsApp.', links: ['Online plans', 'Class schedule', 'Meal guides'] },
  },
};

const MS: LandingCopy = {
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
    title: 'Satu halaman untuk sesiapa yang bertanya.',
    lede: 'Pilih siapa anda. Setiap halaman kenal pemiliknya, dan tiada yang lain.',
    rows: [
      { key: 'aisyah', label: 'Freelancer', qs: ['ambil tempahan lagi?', 'harga potret berapa?', 'ada slot Disember?', 'berapa lama siap?'] },
      { key: 'daniel', label: 'Pencari kerja', qs: ['ok kerja hybrid?', 'notis berapa lama?', 'guna stack apa?', 'gaji yang diharap?'] },
      { key: 'farah', label: 'Kreator & jurulatih', qs: ['online coaching ada?', 'sesuai untuk baru mula?', 'kadar collab?', 'jadual kelas?'] },
      { key: 'lina', label: 'Bisnes dari rumah', qs: ['hantar Klang tak?', 'berapa harga 1kg?', 'boleh tulis nama?', 'buka hari Ahad?'] },
      { key: 'hana', label: 'Studio & servis', qs: ['pakej ada apa?', 'berapa lama siap?', 'boleh buat logo je?', 'boleh kerja remote?'] },
    ],
    pageOf: (name) => `Halaman Curios ${name}`,
  },
  how: {
    eyebrow: 'Cara ia berfungsi',
    title: 'Sepuluh minit dari kosong ke link bio.',
    keep: 'Terus skrol →',
    steps: [
      { title: 'Ceritakan tentang anda.', body: 'Tampal laman web anda, Linktree anda, atau beberapa perenggan jujur. Ia baca dan keluarkan faktanya.' },
      { title: 'Luluskan yang betul.', body: 'Setiap fakta keluar sebagai kad. Simpan yang betul, betulkan yang lain. Ia tak cakap apa yang anda tak luluskan.' },
      { title: 'Letak link dalam bio.', body: 'Kongsi curios.my/namaanda di Instagram, TikTok atau WhatsApp. Sesiapa yang tekan boleh tanya, siang atau malam.' },
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
    found: 'Ia jumpa',
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
    fix: '← Betulkan',
    approve: 'Luluskan →',
    approvedStamp: 'Lulus',
    ring: 'CURIOS.MY/AISYAHDRAWS · CURIOUS? TANYA JE · ',
    card: { name: 'aisyahdraws', role: 'Ilustrator · Ipoh', bio: 'Potret, kulit buku, editorial. Tempahan dibuka untuk November.' },
  },
  business: {
    eyebrow: 'Untuk bisnes',
    title: 'Ada bisnes? Halaman anda jadi kedai.',
    caps: [
      { title: 'Tekan untuk tambah', body: 'Kedai anda ada halamannya sendiri, dengan gambar, harga dan saiz. Pautkan dari halaman anda atau terus dari Instagram.' },
      { title: 'Isi butiran', body: 'Nama, nombor WhatsApp, ambil sendiri atau hantar. Tak perlu akaun.' },
      { title: 'Bayar cara mereka', body: 'FPX, e-dompet atau kad melalui CHIP, disahkan serta-merta. Atau QR DuitNow anda sendiri dengan resit.' },
      { title: 'Tempahan diterima', body: 'Mereka dapat pengesahan dengan nombor tempahan.' },
      { title: 'Masuk dalam Tempahan anda', body: 'Sudah dibayar, tiada apa perlu disemak. Tandakan selesai bila mereka ambil.' },
    ],
    stage: 'Pelanggan buka kedai daripada link bio Lina, tambah barang, isi butiran dan bayar dari bank mereka melalui CHIP; tempahan sampai dalam Tempahan Curios Lina, sudah dibayar',
    customer: 'Telefon pelanggan',
    yours: 'Telefon anda',
    shopPath: 'curios.my/keklina/shop',
    lib: {
      bio: 'Kek dan pencuci mulut buatan sendiri di Shah Alam.',
      shop: 'Kedai',
      shopSub: '8 barang · ambil Sabtu',
      shopPhoto: 'Kek Lina sedang membakar kek',
      links: ['Tempah di WhatsApp', 'Gambar kek di Instagram', 'Jumpa kami di Seksyen 7'],
      foot: 'Soalan · Dibuat dengan Curios',
    },
    open: 'Buka untuk tempahan',
    facts: 'Seksyen 7, Shah Alam · Ambil sendiri atau hantar',
    cats: ['Semua', 'Kek', 'Kuih', 'Raya'],
    bestSeller: 'Paling laris',
    items: [
      { name: 'Kek coklat · 1kg', price: 'RM95' },
      { name: 'Kek batik', price: 'RM45' },
      { name: 'Cookies balang', price: 'RM25' },
      { name: 'Brownies, kotak 9', price: 'RM30' },
    ],
    basketEmpty: 'Bakul kosong',
    basket: (n, total) => `${n} dalam bakul · RM${total}`,
    checkout: 'Bayar',
    itemsTotal: '3 barang · RM235',
    name: 'Nama anda',
    phone: 'Nombor WhatsApp',
    pickup: 'Ambil · Sabtu',
    delivery: 'Hantar RM10',
    continueToPay: 'Teruskan bayar',
    howPay: 'Cara anda bayar',
    ways: [
      { label: 'Perbankan dalam talian', sub: 'FPX · Maybank2u, CIMB, RHB', mark: 'FPX' },
      { label: 'E-dompet', sub: 'Touch ’n Go, GrabPay, ShopeePay', mark: 'TNG' },
      { label: 'Kad', sub: 'Kad debit atau kredit', mark: 'VISA' },
      { label: 'QR DuitNow', sub: 'Imbas, kemudian muat naik resit anda', mark: 'QR' },
    ],
    yourBank: 'Bank anda',
    banks: ['Maybank2u', 'CIMB Clicks', 'Public Bank', 'RHB Now'],
    pay: 'Bayar RM235',
    payWith: 'Bayar RM235 dengan Maybank2u',
    opening: 'Membuka Maybank2u…',
    openingNote: 'Luluskan RM235 dalam bank anda, kemudian anda terus kembali ke Kek Lina.',
    approved: 'Diluluskan dalam Maybank2u',
    approvedNote: 'Membawa anda kembali ke Kek Lina…',
    paidChip: 'RM235 dibayar',
    processed: 'Bayaran diproses oleh CHIP',
    received: 'Tempahan diterima',
    receivedNote: '#14 · RM235 · dibayar dengan FPX',
    orders: 'Tempahan',
    seeShop: 'Lihat kedai anda',
    toCheck: 'Resit untuk disemak',
    paidWeek: 'Dibayar minggu ini',
    seg: ['Semua', 'Untuk disemak', 'Dibayar', 'Bayaran balik'],
    mira: 'Mira Hassan',
    miraSub: '#14 · 3 barang · Ambil Sabtu',
    paidOnline: 'Dibayar dalam talian',
    completed: 'Selesai',
    actTitle: 'Dibayar dengan FPX. Siap pada Sabtu 17 Okt',
    actNote: 'Tiada apa perlu disemak. Tandakan selesai bila Mira sudah terima.',
    markDone: '✓ Tandakan selesai',
    done: 'Selesai ✓',
    hakim: 'Hakim Rahman',
    hakimSub: '#13 · 1 barang · Hantar Sabtu',
    awaiting: 'Menunggu bayaran',
    weiLing: 'Wei Ling',
    weiLingSub: '#12 · 2 barang · Ambil Jumaat',
    paid: 'Dibayar',
    newOrder: 'Tempahan baru · RM235',
    now: 'baru',
  },
  pricing: {
    eyebrow: 'Harga',
    title: `Percuma untuk ditanya. RM${MONTHLY} bila anda menjual.`,
    billing: 'Bayaran bisnes',
    monthly: 'Bulanan',
    yearly: 'Tahunan',
    twoMonths: '−2 bulan',
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
      tag: 'Satu tempahan RM95 dah cukup bayar',
      monthly: `RM${MONTHLY}`,
      yearly: `RM${ANNUAL}`,
      perMonth: 'sebulan',
      perYear: 'setahun',
      noteMonthly: `Atau RM${ANNUAL} setahun: percuma dua bulan.`,
      noteYearly: `RM${ANNUAL_A_MONTH} sebulan, bayar sekali setahun.`,
      plus: 'Semua dalam Peribadi, dan',
      points: [
        'Kedai yang dibayar melalui FPX, e-dompet, kad atau QR anda sendiri',
        'Tempahan masuk dalam dashboard anda',
        'Setiap lead diemel dengan nombor dan perbualan mereka',
        'Halaman soalan lazim yang Google boleh jumpa',
        'Tiga lead pertama percuma',
      ],
      cta: 'Mula dengan 3 lead percuma',
    },
    calc: {
      eyebrow: 'Berbaloi tak?',
      title: 'Seret ke bulan biasa anda.',
      orders: 'Tempahan sebulan',
      typical: 'Tempahan biasa',
      typicalLabel: 'Nilai tempahan biasa',
      takeIn: 'Anda akan terima',
      yours: 'Tempahan anda',
      cost: (amount) => `Curios Bisnes · RM${amount}`,
      pays: (percent, times) => `Bisnes kosnya kira-kira ${percent}% daripada itu. Ia bayar balik ${times >= 2 ? `${times} kali ganda.` : 'sekali.'}`,
      under: 'Itu kurang dari kos Bisnes. Kekal di Peribadi sampai tempahan naik.',
    },
    payment: 'Bayar dengan FPX, kad atau e-dompet. Tiada pembaharuan automatik melainkan anda hidupkan auto-renew dengan kad.',
    disclaimer: 'Kalkulator ini contoh, bukan ramalan.',
    monthlyRinggit: MONTHLY,
    annualAMonth: ANNUAL_A_MONTH,
  },
  faq: {
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
    title: 'Curious? Tanya je',
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
    aina: { q: 'Buka hari Sabtu?', a: 'Buka, 9 pagi hingga 1 tengah hari pada Sabtu. Walk-in dialu-alukan.', links: ['Tempah di WhatsApp', 'Arah ke klinik', 'Syarikat panel'] },
    farah: { q: 'Ada coaching online?', a: 'Ada, pelan online bulanan dengan semakan mingguan di WhatsApp.', links: ['Pelan online', 'Jadual kelas', 'Panduan makan'] },
  },
};

export const COPY: Record<Locale, LandingCopy> = { en: EN, ms: MS };
