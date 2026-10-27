import type { Locale } from '../_landing/copy.js';

export type { Locale };
export type LegalDoc = 'terms' | 'privacy' | 'refunds';

/**
 * Who runs Curios: the registered business and its SSM registration number.
 * No postal address, by the owner's choice (2026-10-22): people reach us by
 * SUPPORT_EMAIL. Every page reads these from here, in both languages.
 */
export const OPERATOR = {
  name: 'BSYX LABS',
  registration: '202603086039',
  /** The same registration in SSM's old format, shown beside it in the landing's footer. */
  oldRegistration: 'TR0339989-A',
};

export const SUPPORT_EMAIL = 'support@curios.my';

/** Change with any edit to the words below. */
export const UPDATED = new Date('2026-10-23T00:00:00+08:00');

export const LEGAL_DOCS: readonly LegalDoc[] = ['terms', 'privacy', 'refunds'];

export const LEGAL_PATH: Record<Locale, Record<LegalDoc, string>> = {
  en: { terms: '/terms', privacy: '/privacy', refunds: '/refunds' },
  ms: { terms: '/ms/terms', privacy: '/ms/privacy', refunds: '/ms/refunds' },
};

/**
 * A paragraph, or a list. In either, `{terms}`, `{privacy}` and `{refunds}`
 * become a link to that page in the same language, and `{email}` a link to
 * SUPPORT_EMAIL.
 */
export type Block = string | { list: string[] };

export interface Section {
  heading: string;
  body: Block[];
}

export interface Doc {
  title: string;
  /** For search results and link previews. */
  description: string;
  lede: string;
  sections: Section[];
}

export interface Chrome {
  /** The short name in the tabs between the three pages. */
  tab: Record<LegalDoc, string>;
  /** The full name, which `{terms}` and the like are rendered as. */
  name: Record<LegalDoc, string>;
  tabsLabel: string;
  updated: string;
  other: { name: string; lang: Locale };
  home: string;
  questions: string;
  back: string;
}

const who = `${OPERATOR.name} (${OPERATOR.registration})`;

export const CHROME: Record<Locale, Chrome> = {
  en: {
    tab: { terms: 'Terms', privacy: 'Privacy', refunds: 'Refunds' },
    name: { terms: 'Terms of Service', privacy: 'Privacy Policy', refunds: 'Refund Policy' },
    tabsLabel: 'Policies',
    updated: 'Last updated',
    other: { name: 'Bahasa Melayu', lang: 'ms' },
    home: 'Curios home',
    questions: 'Questions about this page? Write to {email}.',
    back: 'Back to Curios',
  },
  ms: {
    tab: { terms: 'Terma', privacy: 'Privasi', refunds: 'Bayaran balik' },
    name: { terms: 'Terma Perkhidmatan', privacy: 'Dasar Privasi', refunds: 'Dasar Bayaran Balik' },
    tabsLabel: 'Dasar',
    updated: 'Kemas kini terakhir',
    other: { name: 'English', lang: 'en' },
    home: 'Laman utama Curios',
    questions: 'Ada soalan tentang halaman ini? Tulis kepada {email}.',
    back: 'Kembali ke Curios',
  },
};

export const DOCS: Record<Locale, Record<LegalDoc, Doc>> = {
  en: {
    terms: {
      title: 'Terms of Service',
      description: 'The agreement between you and Curios when you make a page, chat on one, or order from one.',
      lede: 'The agreement between you and Curios when you make a page, chat on one, or order from one. We wrote it to be read. If anything is unclear, ask us.',
      sections: [
        {
          heading: 'Who we are',
          body: [
            `Curios (curios.my) is run by ${who}, a business registered in Malaysia. In these terms, “we” means us, and “you” means whoever uses Curios: an owner who makes a page, or a visitor who reads, chats on or orders from one.`,
            'You can reach us at {email}.',
          ],
        },
        {
          heading: 'Using Curios',
          body: [
            'By making a page or using one, you agree to these terms and to our {privacy}. If you don’t agree, please don’t use Curios.',
            'To make a page you must be 18 or over, or have a parent’s or guardian’s permission. Keep your sign-in details to yourself: you are responsible for what happens on your account.',
          ],
        },
        {
          heading: 'Your page and what you put on it',
          body: [
            'What you put on your page stays yours: your words, photos, links, items, and the websites, text and files you give it to read.',
            'You let us store it, show it on your page, and use it to run your page. That includes having an AI model read your sources and answer your visitors from them. This permission ends when you remove the content or your page is closed, apart from backup copies, which are cleared over time.',
            'You must have the right to everything you put up, and it must not mislead. Don’t use anyone else’s words, photos or name without their permission.',
            'Your page address (your handle) is yours to use, but it is not property you own. We may take back a handle that impersonates someone or uses a name or brand that isn’t yours.',
          ],
        },
        {
          heading: 'The AI chat',
          body: [
            'A page’s chat answers visitors only from the facts its owner has approved. It can still get things wrong, or put something in a way the owner wouldn’t.',
            'Owners: you are responsible for the facts on your page. Check them, keep prices and details up to date, and list anything the chat must never say.',
            'Visitors: the chat speaks for the page’s owner, not for us. Confirm anything that matters, such as a price, a date, or a health or legal question, with the owner directly.',
          ],
        },
        {
          heading: 'Visitors’ and customers’ details',
          body: [
            'When a visitor leaves their number in a chat or places an order, their details go to the page’s owner. The owner decides what to do with them and is responsible for them under Malaysia’s Personal Data Protection Act 2010. We keep them on the owner’s behalf, as our {privacy} explains.',
            'Owners: use a visitor’s details only to reply to them and to fulfil their order. Don’t add them to marketing lists, sell them, or share them without the person’s consent.',
          ],
        },
        {
          heading: 'Shops and orders',
          body: [
            'A Business page can take orders. The sale is between the customer and the owner: we are not the seller and not a party to it.',
            'Customers pay the owner directly: by the owner’s DuitNow QR or bank transfer, or online through the owner’s own CHIP account, by FPX online banking, e-wallet or card. Curios never receives, holds or passes on that money: an online payment goes to the owner’s CHIP account, never to us.',
            'To take payments online, an owner gives us the Brand ID and secret key of their own CHIP account. We store the key encrypted and use it only to take payments for their shop. The owner is responsible for their CHIP account, including CHIP’s own terms, fees and payouts.',
            'The owner is responsible for what they sell: that it is legal, as described and as priced, ready or delivered on the day, and for any refund. A customer with a problem should raise it with the owner first, using the WhatsApp link on their order page. Our {refunds} says more.',
            'If you think an owner is using Curios to cheat customers, tell us at {email} and we will look into it.',
          ],
        },
        {
          heading: 'What you may not do',
          body: [
            'Don’t use Curios to:',
            {
              list: [
                'sell or promote anything illegal in Malaysia, such as counterfeit goods, controlled drugs, weapons, unregistered medicines, or unlicensed financial or gambling services;',
                'deceive people: scams, fake shops, fake receipts, or pretending to be someone else;',
                'post sexual content involving anyone under 18, or intimate images of anyone without their consent;',
                'harass or threaten anyone, or stir up hatred over race, religion or royalty;',
                'publish someone else’s personal details without their permission;',
                'infringe anyone’s copyright or trade mark;',
                'send spam, or try to break, overload, copy wholesale or get around the limits of Curios.',
              ],
            },
            'We may remove content, pause a shop, or suspend or close a page that breaks these rules. Where we can, we will tell you why first.',
          ],
        },
        {
          heading: 'Plans and payment',
          body: [
            'Personal pages are free. A Business page starts with a free trial: its first 3 leads and its first 3 orders cost nothing. After that, the Business plan is RM49 a month or RM490 a year.',
            'You pay through CHIP, by FPX online banking, card or e-wallet. Each payment adds a month or a year to your plan, counted from when your paid time would otherwise end. Nothing renews by itself unless you turn on auto-renew, which is for cards only: we then charge your card the same amount when each paid period ends, until you turn it off on your Billing screen. If a renewal charge fails, we try again for up to 3 days, then turn auto-renew off.',
            'When your paid time ends, your page and its chat keep working, but the chat stops taking numbers and your shop stops taking orders until you pay again.',
            'A plan may have usage limits, such as a number of new chat conversations each month; your Billing screen shows yours. We may change prices or limits, but never for time you have already paid for, and we will tell you before a change applies to you.',
            'Refunds are covered by our {refunds}.',
          ],
        },
        {
          heading: 'Closing your account',
          body: [
            'You can stop using Curios at any time. To close your account and delete your page, email {email} from the address you signed up with, and we will do it within 30 days. We keep payment records for as long as the law requires.',
            'We may suspend or close an account that breaks these terms, or where that is needed to protect visitors, customers or Curios.',
          ],
        },
        {
          heading: 'Our service and its limits',
          body: [
            'We work to keep Curios running and your content safe, but we provide it as it is, and we can’t promise it will always be available or free of mistakes.',
            'As far as the law allows, we are not liable for indirect losses such as lost sales or profit, or for what owners, customers or visitors do. Our total liability to you is limited to what you paid us in the 12 months before the claim.',
            'Nothing in these terms takes away rights you have under Malaysian law that cannot be taken away.',
          ],
        },
        {
          heading: 'Changes to these terms',
          body: [
            'We may update these terms. When we do, we change the date at the top, and for a significant change we email owners before it applies. If you keep using Curios after a change, you accept it.',
          ],
        },
        {
          heading: 'Law',
          body: [
            'These terms are governed by the laws of Malaysia, and the courts of Malaysia decide any dispute about them. They are written in English and Malay; if the two differ, the English version applies.',
          ],
        },
      ],
    },
    privacy: {
      title: 'Privacy Policy',
      description: 'What Curios collects, why, who else sees it, how long it is kept, and what you can ask of us.',
      lede: 'What we collect, why, who else sees it, how long we keep it, and what you can ask of us. This is our notice under Malaysia’s Personal Data Protection Act 2010 (PDPA).',
      sections: [
        {
          heading: 'Who we are',
          body: [
            `Curios (curios.my) is run by ${who}, a business registered in Malaysia.`,
            'For owners’ own details, we decide how they are used. For the details of a page’s visitors and customers, the page’s owner decides, and we handle them on the owner’s behalf.',
          ],
        },
        {
          heading: 'What we collect',
          body: [
            {
              list: [
                'If you make a page: your email address, and your password, which we keep only as a scrambled hash that can’t be turned back into it. If you sign in with Google, your name and email address from your Google account.',
                'What you put on your page: your name, bio, photos, links, social profiles and items. If you take orders, your DuitNow QR and your bank account name and number, which your customers see, and, if you connect CHIP, your CHIP Brand ID and secret key, which we keep encrypted and no one sees. The websites, text and files you give your page to read: we keep the facts drawn from them and short excerpts, not the files.',
                'If you pay for a plan: the plan, amount and date, the CHIP purchase and, if you turn on auto-renew, your card’s brand and last four digits. You log in to your bank or enter your card on CHIP’s and your bank’s pages; we never see those details.',
                'If you chat on a page: what you type and the page’s replies. The questions people ask are also kept without who asked them, so the owner can see what people want to know.',
                'If you leave your number in a chat: your phone number, and what the chat understood you wanted, such as a product, a date or a place.',
                'If you order from a shop: your name, your WhatsApp number, pickup or delivery, the day, your address for a delivery, any note, what you ordered, and the payment receipt you upload. If you pay online: your email address, for CHIP’s receipt, and how you paid (the bank you chose, or your card’s brand and last four digits). You log in to your bank or enter your card on CHIP’s and your bank’s pages; we never see those details.',
                'Your IP address, which our servers use to block abuse and record in their logs. We use no advertising or analytics trackers.',
              ],
            },
            'Giving us your details is up to you, but without them we can’t make your page, pass your number to the owner, or place your order.',
          ],
        },
        {
          heading: 'Why we use it',
          body: [
            {
              list: [
                'to run pages, chats and shops, and to get each message, number and order to the right owner;',
                'to have an AI answer visitors from an owner’s facts, and pick out what someone who left their number wanted;',
                'to send account emails, such as confirming your address or resetting your password, and the emails an owner turns on, such as a new lead, a new order, a receipt, or a reminder that their plan is ending;',
                'to take payment and keep accounting records;',
                'to keep Curios secure, including blocking abuse and checking new passwords against known data breaches.',
              ],
            },
            'We don’t sell personal data, and we don’t use it for advertising.',
          ],
        },
        {
          heading: 'Who else sees it',
          body: [
            {
              list: [
                'The page’s owner sees the chats on their page, the numbers left with them, and the orders and receipts sent to them.',
                'Anthropic (United States): its Claude models read chat messages and a page’s facts and sources, to write answers and pick out facts.',
                'OpenAI (United States): turns questions and facts into numbers (embeddings) so the chat can find the right fact.',
                'CHIP (Malaysia): takes Business plan payments, and receives your email address, your page’s name and the amount. Your card details go to CHIP, never to us; for auto-renew, CHIP keeps a token of your card that only works for Curios’s charges.',
                'CHIP (Malaysia): processes online payments for shop orders, through the shop owner’s own CHIP account, and receives the customer’s name, WhatsApp number and email address, what they ordered and the amount. The money goes to the owner’s CHIP account, and CHIP emails the customer the receipt.',
                'Have I Been Pwned: receives the first five characters of a hash of a new password, never the password, to check it hasn’t leaked in a breach.',
                'Our hosting, storage and email providers, who store data and send email for us.',
                'Authorities, where the law requires us to share.',
              ],
            },
            'Under their business terms, Anthropic and OpenAI don’t train their models on what we send them.',
            'Photos on a page, and receipts uploaded with an order, are stored as files at long, random addresses. Anyone who has a file’s exact link can open it, so don’t share it.',
          ],
        },
        {
          heading: 'Outside Malaysia',
          body: [
            'Some of these providers handle data outside Malaysia, including in the United States. We only use providers that protect it to a standard comparable to the PDPA, as the Act requires.',
          ],
        },
        {
          heading: 'How long we keep it',
          body: [
            {
              list: [
                'Chats, numbers left in chats, and orders with their receipts: deleted automatically 12 months after they were made. An owner can delete a lead sooner, and its chat goes with it.',
                'The questions people ask, without who asked: kept while the page exists, as part of what the page knows. The owner can delete them.',
                'Your account and page: kept until you ask us to close your account.',
                'Payment records: kept for 7 years, as Malaysian tax law requires.',
                'Server logs: kept only as long as we need them to keep Curios secure.',
              ],
            },
          ],
        },
        {
          heading: 'Cookies',
          body: [
            'We use one cookie to keep you signed in, curios_session. It signs you out after 14 days without a visit, and after 30 days at most. Three more are used only while you sign in with Google, and are gone within 10 minutes.',
            'Your browser also remembers your shop basket until you close the tab, the page address you chose before signing up, and the alerts you have closed. None of these follow you to other sites.',
          ],
        },
        {
          heading: 'Keeping it safe',
          body: [
            'Passwords are hashed, the secret in each order link is stored only as a hash, and every connection uses HTTPS. No system is perfectly secure: if a breach puts your data at risk, we will tell you and the authorities as the law requires.',
          ],
        },
        {
          heading: 'What you can ask of us',
          body: [
            'Under the PDPA you can ask to see the personal data we hold about you, to correct it, and to stop us using it or delete it where we don’t need it to run your account or to meet a legal duty. Owners can change most of their details themselves.',
            'Email {email} from the address on your account. We reply within 21 days.',
            'Visitors and customers: your details belong to the page’s owner to manage, so ask the owner first. If you can’t reach them, write to us and we will help.',
          ],
        },
        {
          heading: 'Children',
          body: [
            'Curios isn’t meant for children under 13, and owners under 18 need a parent’s or guardian’s permission. If you think a child has given us personal data, tell us and we will delete it.',
          ],
        },
        {
          heading: 'Changes to this policy',
          body: [
            'We may update this policy. When we do, we change the date at the top, and for a significant change we email owners before it applies.',
          ],
        },
        {
          heading: 'Contact',
          body: [
            'Write to {email}. This policy is written in English and Malay; if the two differ, the English version applies.',
          ],
        },
      ],
    },
    refunds: {
      title: 'Refund Policy',
      description: 'How refunds work for the Curios Business plan, and for orders from shops on Curios.',
      lede: 'How refunds work for the Curios Business plan, and for orders from the shops on Curios.',
      sections: [
        {
          heading: 'The Business plan',
          body: [
            'Each payment is for a set time. Your plan renews by itself only if you turn on auto-renew by card, and you can turn it off any time on your Billing screen.',
            {
              list: [
                'Your first payment: if you change your mind, ask within 7 days of paying and we will refund it in full, whether it was for a month or a year. Your Business plan ends when we make the refund.',
                'Later payments, which add time to a plan you have already paid for, are not refunded. Your plan keeps working until the end of the time you paid for.',
                'A renewal charged by auto-renew counts as a later payment, unless you had already turned auto-renew off, in which case we refund it in full.',
                'We always refund in full a payment made twice by mistake, or a charge for something you didn’t get because of a fault on our side.',
              ],
            },
            'Personal pages and the free trial cost nothing, so there is nothing to refund.',
          ],
        },
        {
          heading: 'How to ask',
          body: [
            'Email {email} from the address on your account, with your page address (curios.my/yourname) and the date you paid. We reply within 3 working days, and send an approved refund to your bank account within 14 days.',
          ],
        },
        {
          heading: 'Orders from a shop',
          body: [
            'When you order from a shop on Curios, you pay the shop’s owner directly. Curios never receives that money, so we can’t refund it.',
            'Each shop sets its own refund rules. Ask the owner through the WhatsApp link on your order page. If an owner cancels an order you have paid for, your order page shows “Cancelled · refund due” until they mark it “Refunded”.',
            'If you think a shop is cheating its customers, tell us at {email} and we will look into it.',
          ],
        },
      ],
    },
  },
  ms: {
    terms: {
      title: 'Terma Perkhidmatan',
      description: 'Perjanjian antara anda dan Curios apabila anda membuat halaman, bersembang di halaman, atau membuat tempahan.',
      lede: 'Perjanjian antara anda dan Curios apabila anda membuat halaman, bersembang di halaman, atau membuat tempahan daripadanya. Kami menulisnya supaya mudah dibaca. Jika ada yang kurang jelas, tanya kami.',
      sections: [
        {
          heading: 'Siapa kami',
          body: [
            `Curios (curios.my) dikendalikan oleh ${who}, sebuah perniagaan berdaftar di Malaysia. Dalam terma ini, “kami” bermaksud kami, dan “anda” bermaksud sesiapa yang menggunakan Curios: pemilik yang membuat halaman, atau pelawat yang membaca, bersembang atau membuat tempahan di halaman.`,
            'Anda boleh menghubungi kami di {email}.',
          ],
        },
        {
          heading: 'Menggunakan Curios',
          body: [
            'Dengan membuat atau menggunakan halaman, anda bersetuju dengan terma ini dan dengan {privacy} kami. Jika anda tidak bersetuju, jangan gunakan Curios.',
            'Untuk membuat halaman, anda mesti berumur 18 tahun ke atas, atau mendapat kebenaran ibu bapa atau penjaga. Rahsiakan butiran log masuk anda: anda bertanggungjawab atas apa yang berlaku pada akaun anda.',
          ],
        },
        {
          heading: 'Halaman anda dan kandungannya',
          body: [
            'Apa yang anda letak di halaman anda kekal milik anda: kata-kata, gambar, pautan, barangan, serta laman web, teks dan fail yang anda berikan untuk dibaca.',
            'Anda membenarkan kami menyimpannya, memaparkannya di halaman anda, dan menggunakannya untuk menjalankan halaman anda. Ini termasuk membenarkan model AI membaca sumber anda dan menjawab pelawat berdasarkannya. Kebenaran ini tamat apabila anda membuang kandungan itu atau halaman anda ditutup, kecuali salinan sandaran, yang dipadam dari semasa ke semasa.',
            'Anda mesti berhak ke atas semua yang anda letak, dan ia tidak boleh mengelirukan. Jangan gunakan kata-kata, gambar atau nama orang lain tanpa kebenaran mereka.',
            'Alamat halaman anda (handle) boleh anda gunakan, tetapi ia bukan harta milik anda. Kami boleh mengambil semula handle yang menyamar sebagai orang lain atau menggunakan nama atau jenama yang bukan milik anda.',
          ],
        },
        {
          heading: 'Sembang AI',
          body: [
            'Sembang di sesebuah halaman menjawab pelawat hanya berdasarkan fakta yang telah diluluskan oleh pemiliknya. Ia masih boleh tersilap, atau menyatakan sesuatu dengan cara yang pemilik tidak akan gunakan.',
            'Pemilik: anda bertanggungjawab atas fakta di halaman anda. Semak fakta itu, pastikan harga dan butiran terkini, dan senaraikan apa-apa yang tidak boleh sekali-kali disebut oleh sembang.',
            'Pelawat: sembang itu bercakap bagi pihak pemilik halaman, bukan kami. Sahkan perkara penting, seperti harga, tarikh, atau soalan kesihatan atau undang-undang, terus dengan pemiliknya.',
          ],
        },
        {
          heading: 'Butiran pelawat dan pelanggan',
          body: [
            'Apabila pelawat meninggalkan nombor dalam sembang atau membuat tempahan, butiran mereka dihantar kepada pemilik halaman. Pemilik menentukan cara butiran itu digunakan dan bertanggungjawab ke atasnya di bawah Akta Perlindungan Data Peribadi 2010. Kami menyimpannya bagi pihak pemilik, seperti yang diterangkan dalam {privacy} kami.',
            'Pemilik: gunakan butiran pelawat hanya untuk membalas mereka dan menyempurnakan tempahan mereka. Jangan masukkan mereka ke dalam senarai pemasaran, menjualnya, atau berkongsinya tanpa persetujuan orang itu.',
          ],
        },
        {
          heading: 'Kedai dan tempahan',
          body: [
            'Halaman Bisnes boleh menerima tempahan. Jualan itu antara pelanggan dan pemilik: kami bukan penjual dan bukan pihak dalam jualan itu.',
            'Pelanggan membayar terus kepada pemilik: melalui DuitNow QR atau pindahan bank pemilik, atau dalam talian melalui akaun CHIP pemilik sendiri, menggunakan perbankan dalam talian FPX, e-dompet atau kad. Curios tidak sekali-kali menerima, memegang atau memindahkan wang itu: bayaran dalam talian masuk ke akaun CHIP pemilik, tidak sekali-kali kepada kami.',
            'Untuk menerima bayaran dalam talian, pemilik memberi kami Brand ID dan kunci rahsia (secret key) akaun CHIP mereka sendiri. Kami menyimpan kunci itu dalam bentuk tersulit dan menggunakannya hanya untuk menerima bayaran bagi kedai mereka. Pemilik bertanggungjawab atas akaun CHIP mereka, termasuk terma, caj dan pembayaran keluar CHIP sendiri.',
            'Pemilik bertanggungjawab atas apa yang dijualnya: bahawa ia sah di sisi undang-undang, sama seperti yang diterangkan dan pada harga yang dinyatakan, siap atau dihantar pada hari yang dijanjikan, dan atas sebarang bayaran balik. Pelanggan yang menghadapi masalah hendaklah membangkitkannya dengan pemilik dahulu, melalui pautan WhatsApp di halaman tempahan mereka. {refunds} kami menerangkan lebih lanjut.',
            'Jika anda rasa seseorang pemilik menggunakan Curios untuk menipu pelanggan, beritahu kami di {email} dan kami akan menyiasatnya.',
          ],
        },
        {
          heading: 'Apa yang tidak dibenarkan',
          body: [
            'Jangan gunakan Curios untuk:',
            {
              list: [
                'menjual atau mempromosikan apa-apa yang menyalahi undang-undang Malaysia, seperti barang tiruan, dadah terkawal, senjata, ubat tidak berdaftar, atau perkhidmatan kewangan atau perjudian tanpa lesen;',
                'menipu orang: penipuan, kedai palsu, resit palsu, atau menyamar sebagai orang lain;',
                'menyiarkan kandungan seksual yang melibatkan sesiapa di bawah umur 18 tahun, atau imej intim sesiapa tanpa persetujuan mereka;',
                'mengganggu atau mengugut sesiapa, atau menghasut kebencian berkaitan kaum, agama atau institusi diraja;',
                'menyiarkan butiran peribadi orang lain tanpa kebenaran mereka;',
                'melanggar hak cipta atau cap dagangan sesiapa;',
                'menghantar spam, atau cuba merosakkan, membebankan, menyalin secara pukal atau memintas had Curios.',
              ],
            },
            'Kami boleh membuang kandungan, menangguhkan kedai, atau menggantung atau menutup halaman yang melanggar peraturan ini. Jika boleh, kami akan memberitahu sebabnya terlebih dahulu.',
          ],
        },
        {
          heading: 'Pelan dan bayaran',
          body: [
            'Halaman Peribadi adalah percuma. Halaman Bisnes bermula dengan percubaan percuma: 3 lead pertama dan 3 tempahan pertamanya tidak dikenakan bayaran. Selepas itu, pelan Bisnes berharga RM49 sebulan atau RM490 setahun.',
            'Anda membayar melalui CHIP, menggunakan perbankan dalam talian FPX, kad atau e-dompet. Setiap bayaran menambah sebulan atau setahun pada pelan anda, dikira dari tarikh masa berbayar anda sepatutnya tamat. Tiada apa-apa yang diperbaharui dengan sendirinya melainkan anda hidupkan auto-renew, yang hanya untuk kad: kami kemudian mengecaj kad anda dengan jumlah yang sama apabila setiap tempoh berbayar tamat, sehingga anda mematikannya di skrin Billing anda. Jika caj pembaharuan gagal, kami cuba lagi sehingga 3 hari, kemudian mematikan auto-renew.',
            'Apabila masa berbayar anda tamat, halaman dan sembangnya terus berfungsi, tetapi sembang berhenti menerima nombor dan kedai anda berhenti menerima tempahan sehingga anda membayar semula.',
            'Sesuatu pelan mungkin mempunyai had penggunaan, seperti bilangan perbualan sembang baharu setiap bulan; skrin Billing anda menunjukkan had anda. Kami boleh mengubah harga atau had, tetapi tidak sekali-kali bagi masa yang telah anda bayar, dan kami akan memberitahu anda sebelum perubahan itu terpakai kepada anda.',
            'Bayaran balik diterangkan dalam {refunds} kami.',
          ],
        },
        {
          heading: 'Menutup akaun anda',
          body: [
            'Anda boleh berhenti menggunakan Curios pada bila-bila masa. Untuk menutup akaun dan memadam halaman anda, e-mel {email} dari alamat yang anda gunakan semasa mendaftar, dan kami akan melakukannya dalam masa 30 hari. Kami menyimpan rekod bayaran selama yang dikehendaki oleh undang-undang.',
            'Kami boleh menggantung atau menutup akaun yang melanggar terma ini, atau jika perlu untuk melindungi pelawat, pelanggan atau Curios.',
          ],
        },
        {
          heading: 'Perkhidmatan kami dan hadnya',
          body: [
            'Kami berusaha memastikan Curios berjalan lancar dan kandungan anda selamat, tetapi kami menyediakannya seadanya, dan kami tidak dapat menjanjikan ia sentiasa tersedia atau bebas daripada kesilapan.',
            'Setakat yang dibenarkan oleh undang-undang, kami tidak bertanggungjawab atas kerugian tidak langsung seperti kehilangan jualan atau keuntungan, atau atas tindakan pemilik, pelanggan atau pelawat. Jumlah tanggungan kami kepada anda terhad kepada apa yang anda bayar kepada kami dalam tempoh 12 bulan sebelum tuntutan.',
            'Tiada apa-apa dalam terma ini menghapuskan hak anda di bawah undang-undang Malaysia yang tidak boleh dihapuskan.',
          ],
        },
        {
          heading: 'Perubahan pada terma ini',
          body: [
            'Kami boleh mengemas kini terma ini. Apabila kami berbuat demikian, kami menukar tarikh di bahagian atas, dan bagi perubahan yang ketara, kami akan menghantar e-mel kepada pemilik sebelum ia berkuat kuasa. Jika anda terus menggunakan Curios selepas sesuatu perubahan, anda menerimanya.',
          ],
        },
        {
          heading: 'Undang-undang',
          body: [
            'Terma ini dikawal oleh undang-undang Malaysia, dan mahkamah Malaysia memutuskan sebarang pertikaian mengenainya. Terma ini ditulis dalam bahasa Inggeris dan bahasa Melayu; jika kedua-duanya berbeza, versi bahasa Inggeris terpakai.',
          ],
        },
      ],
    },
    privacy: {
      title: 'Dasar Privasi',
      description: 'Apa yang dikumpul oleh Curios, sebabnya, siapa lagi yang melihatnya, berapa lama ia disimpan, dan apa yang boleh anda minta daripada kami.',
      lede: 'Apa yang kami kumpul, sebabnya, siapa lagi yang melihatnya, berapa lama kami menyimpannya, dan apa yang boleh anda minta daripada kami. Ini ialah notis kami di bawah Akta Perlindungan Data Peribadi 2010 (PDPA).',
      sections: [
        {
          heading: 'Siapa kami',
          body: [
            `Curios (curios.my) dikendalikan oleh ${who}, sebuah perniagaan berdaftar di Malaysia.`,
            'Bagi butiran pemilik sendiri, kami menentukan cara ia digunakan. Bagi butiran pelawat dan pelanggan sesebuah halaman, pemilik halaman yang menentukannya, dan kami mengendalikannya bagi pihak pemilik.',
          ],
        },
        {
          heading: 'Apa yang kami kumpul',
          body: [
            {
              list: [
                'Jika anda membuat halaman: alamat e-mel anda, dan kata laluan anda, yang kami simpan hanya sebagai cincangan (hash) yang tidak boleh ditukar kembali menjadi kata laluan. Jika anda log masuk dengan Google, nama dan alamat e-mel daripada akaun Google anda.',
                'Apa yang anda letak di halaman anda: nama, bio, gambar, pautan, profil media sosial dan barangan. Jika anda menerima tempahan, DuitNow QR serta nama dan nombor akaun bank anda, yang dilihat oleh pelanggan anda, dan, jika anda menyambung CHIP, Brand ID dan kunci rahsia CHIP anda, yang kami simpan dalam bentuk tersulit dan tidak dilihat oleh sesiapa. Laman web, teks dan fail yang anda berikan untuk dibaca oleh halaman anda: kami menyimpan fakta yang diambil daripadanya dan petikan pendek, bukan fail itu.',
                'Jika anda membayar pelan: pelan, jumlah dan tarikh, pembelian CHIP dan, jika anda hidupkan auto-renew, jenama kad dan empat digit terakhirnya. Anda log masuk ke bank anda atau memasukkan kad anda di halaman CHIP dan bank anda; kami tidak sekali-kali melihat butiran itu.',
                'Jika anda bersembang di halaman: apa yang anda taip dan balasan halaman itu. Soalan yang ditanya juga disimpan tanpa maklumat siapa yang bertanya, supaya pemilik dapat melihat apa yang orang ingin tahu.',
                'Jika anda meninggalkan nombor dalam sembang: nombor telefon anda, dan apa yang difahami oleh sembang tentang kehendak anda, seperti produk, tarikh atau tempat.',
                'Jika anda membuat tempahan di kedai: nama anda, nombor WhatsApp anda, ambil sendiri atau penghantaran, hari, alamat anda untuk penghantaran, sebarang nota, apa yang anda tempah, dan resit bayaran yang anda muat naik. Jika anda membayar dalam talian: alamat e-mel anda, untuk resit CHIP, dan cara anda membayar (bank yang anda pilih, atau jenama kad dan empat digit terakhirnya). Anda log masuk ke bank anda atau memasukkan kad anda di halaman CHIP dan bank anda; kami tidak sekali-kali melihat butiran itu.',
                'Alamat IP anda, yang digunakan oleh pelayan kami untuk menyekat penyalahgunaan dan direkodkan dalam log. Kami tidak menggunakan penjejak pengiklanan atau analitik.',
              ],
            },
            'Memberikan butiran anda adalah pilihan anda, tetapi tanpanya kami tidak dapat membuat halaman anda, menyampaikan nombor anda kepada pemilik, atau membuat tempahan anda.',
          ],
        },
        {
          heading: 'Mengapa kami menggunakannya',
          body: [
            {
              list: [
                'untuk menjalankan halaman, sembang dan kedai, dan memastikan setiap mesej, nombor dan tempahan sampai kepada pemilik yang betul;',
                'untuk membolehkan AI menjawab pelawat berdasarkan fakta pemilik, dan mengenal pasti kehendak orang yang meninggalkan nombor;',
                'untuk menghantar e-mel akaun, seperti mengesahkan alamat anda atau menetapkan semula kata laluan, dan e-mel yang dihidupkan oleh pemilik, seperti lead baharu, tempahan baharu, resit, atau peringatan bahawa pelan mereka akan tamat;',
                'untuk menerima bayaran dan menyimpan rekod perakaunan;',
                'untuk memastikan Curios selamat, termasuk menyekat penyalahgunaan dan menyemak kata laluan baharu terhadap kebocoran data yang diketahui.',
              ],
            },
            'Kami tidak menjual data peribadi, dan kami tidak menggunakannya untuk pengiklanan.',
          ],
        },
        {
          heading: 'Siapa lagi yang melihatnya',
          body: [
            {
              list: [
                'Pemilik halaman melihat sembang di halamannya, nombor yang ditinggalkan untuknya, dan tempahan serta resit yang dihantar kepadanya.',
                'Anthropic (Amerika Syarikat): model Claude miliknya membaca mesej sembang serta fakta dan sumber halaman, untuk menulis jawapan dan mengambil fakta.',
                'OpenAI (Amerika Syarikat): menukar soalan dan fakta kepada nombor (embedding) supaya sembang dapat mencari fakta yang betul.',
                'CHIP (Malaysia): menerima bayaran pelan Bisnes, dan menerima alamat e-mel anda, nama halaman anda dan jumlah bayaran. Butiran kad anda pergi kepada CHIP, tidak sekali-kali kepada kami; bagi auto-renew, CHIP menyimpan token kad anda yang hanya berfungsi untuk caj Curios.',
                'CHIP (Malaysia): memproses bayaran dalam talian untuk tempahan kedai, melalui akaun CHIP pemilik kedai sendiri, dan menerima nama, nombor WhatsApp dan alamat e-mel pelanggan, apa yang ditempah dan jumlah bayaran. Wang itu masuk ke akaun CHIP pemilik, dan CHIP menghantar resit kepada pelanggan melalui e-mel.',
                'Have I Been Pwned: menerima lima aksara pertama cincangan kata laluan baharu, bukan kata laluan itu, untuk menyemak sama ada ia pernah bocor.',
                'Penyedia pengehosan, storan dan e-mel kami, yang menyimpan data dan menghantar e-mel untuk kami.',
                'Pihak berkuasa, jika undang-undang mewajibkan kami berkongsi.',
              ],
            },
            'Di bawah terma perniagaan mereka, Anthropic dan OpenAI tidak melatih model mereka menggunakan apa yang kami hantar.',
            'Gambar di halaman, dan resit yang dimuat naik bersama tempahan, disimpan sebagai fail di alamat rawak yang panjang. Sesiapa yang mempunyai pautan tepat sesuatu fail boleh membukanya, jadi jangan kongsikan pautan itu.',
          ],
        },
        {
          heading: 'Di luar Malaysia',
          body: [
            'Sesetengah penyedia ini mengendalikan data di luar Malaysia, termasuk di Amerika Syarikat. Kami hanya menggunakan penyedia yang melindunginya pada tahap yang setanding dengan PDPA, seperti yang dikehendaki oleh Akta itu.',
          ],
        },
        {
          heading: 'Berapa lama kami menyimpannya',
          body: [
            {
              list: [
                'Sembang, nombor yang ditinggalkan dalam sembang, dan tempahan bersama resitnya: dipadam secara automatik 12 bulan selepas ia dibuat. Pemilik boleh memadam lead lebih awal, bersama sembangnya.',
                'Soalan yang ditanya, tanpa maklumat siapa yang bertanya: disimpan selagi halaman wujud, sebagai sebahagian daripada apa yang diketahui oleh halaman. Pemilik boleh memadamnya.',
                'Akaun dan halaman anda: disimpan sehingga anda meminta kami menutup akaun anda.',
                'Rekod bayaran: disimpan selama 7 tahun, seperti yang dikehendaki oleh undang-undang cukai Malaysia.',
                'Log pelayan: disimpan hanya selama yang kami perlukan untuk memastikan Curios selamat.',
              ],
            },
          ],
        },
        {
          heading: 'Kuki',
          body: [
            'Kami menggunakan satu kuki untuk memastikan anda kekal log masuk, curios_session. Ia melog keluar anda selepas 14 hari tanpa lawatan, dan selepas 30 hari paling lama. Tiga lagi digunakan hanya semasa anda log masuk dengan Google, dan hilang dalam masa 10 minit.',
            'Pelayar anda juga mengingati bakul kedai anda sehingga anda menutup tab, alamat halaman yang anda pilih sebelum mendaftar, dan amaran yang telah anda tutup. Tiada satu pun daripadanya mengikuti anda ke laman lain.',
          ],
        },
        {
          heading: 'Menjaga keselamatannya',
          body: [
            'Kata laluan dicincang, rahsia dalam setiap pautan tempahan disimpan hanya sebagai cincangan, dan setiap sambungan menggunakan HTTPS. Tiada sistem yang selamat sepenuhnya: jika kebocoran mengancam data anda, kami akan memberitahu anda dan pihak berkuasa seperti yang dikehendaki oleh undang-undang.',
          ],
        },
        {
          heading: 'Apa yang boleh anda minta daripada kami',
          body: [
            'Di bawah PDPA, anda boleh meminta untuk melihat data peribadi yang kami simpan tentang anda, membetulkannya, dan meminta kami berhenti menggunakannya atau memadamnya jika kami tidak memerlukannya untuk menjalankan akaun anda atau memenuhi kewajipan undang-undang. Pemilik boleh mengubah kebanyakan butiran mereka sendiri.',
            'E-mel {email} dari alamat akaun anda. Kami akan membalas dalam masa 21 hari.',
            'Pelawat dan pelanggan: butiran anda diuruskan oleh pemilik halaman, jadi tanya pemilik dahulu. Jika anda tidak dapat menghubungi mereka, tulis kepada kami dan kami akan membantu.',
          ],
        },
        {
          heading: 'Kanak-kanak',
          body: [
            'Curios bukan untuk kanak-kanak di bawah umur 13 tahun, dan pemilik di bawah umur 18 tahun memerlukan kebenaran ibu bapa atau penjaga. Jika anda rasa seorang kanak-kanak telah memberi kami data peribadi, beritahu kami dan kami akan memadamnya.',
          ],
        },
        {
          heading: 'Perubahan pada dasar ini',
          body: [
            'Kami boleh mengemas kini dasar ini. Apabila kami berbuat demikian, kami menukar tarikh di bahagian atas, dan bagi perubahan yang ketara, kami akan menghantar e-mel kepada pemilik sebelum ia berkuat kuasa.',
          ],
        },
        {
          heading: 'Hubungi kami',
          body: [
            'Tulis kepada {email}. Dasar ini ditulis dalam bahasa Inggeris dan bahasa Melayu; jika kedua-duanya berbeza, versi bahasa Inggeris terpakai.',
          ],
        },
      ],
    },
    refunds: {
      title: 'Dasar Bayaran Balik',
      description: 'Cara bayaran balik berfungsi bagi pelan Bisnes Curios, dan bagi tempahan daripada kedai di Curios.',
      lede: 'Cara bayaran balik berfungsi bagi pelan Bisnes Curios, dan bagi tempahan daripada kedai di Curios.',
      sections: [
        {
          heading: 'Pelan Bisnes',
          body: [
            'Setiap bayaran adalah untuk tempoh tertentu. Pelan anda diperbaharui dengan sendirinya hanya jika anda hidupkan auto-renew dengan kad, dan anda boleh mematikannya pada bila-bila masa di skrin Billing anda.',
            {
              list: [
                'Bayaran pertama anda: jika anda berubah fikiran, minta dalam masa 7 hari selepas membayar dan kami akan membayar balik sepenuhnya, sama ada untuk sebulan atau setahun. Pelan Bisnes anda tamat apabila kami membuat bayaran balik.',
                'Bayaran seterusnya, yang menambah masa pada pelan yang telah anda bayar, tidak dibayar balik. Pelan anda terus berfungsi sehingga tamat masa yang telah anda bayar.',
                'Pembaharuan yang dicaj oleh auto-renew dikira sebagai bayaran seterusnya, melainkan anda telah mematikan auto-renew, dalam hal itu kami membayar baliknya sepenuhnya.',
                'Kami sentiasa membayar balik sepenuhnya bayaran yang dibuat dua kali secara tidak sengaja, atau caj bagi sesuatu yang anda tidak terima akibat kesilapan pihak kami.',
              ],
            },
            'Halaman Peribadi dan percubaan percuma tidak dikenakan bayaran, jadi tiada apa-apa untuk dibayar balik.',
          ],
        },
        {
          heading: 'Cara memohon',
          body: [
            'E-mel {email} dari alamat akaun anda, bersama alamat halaman anda (curios.my/namaanda) dan tarikh anda membayar. Kami akan membalas dalam masa 3 hari bekerja, dan menghantar bayaran balik yang diluluskan ke akaun bank anda dalam masa 14 hari.',
          ],
        },
        {
          heading: 'Tempahan daripada kedai',
          body: [
            'Apabila anda membuat tempahan daripada kedai di Curios, anda membayar terus kepada pemilik kedai itu. Curios tidak sekali-kali menerima wang itu, jadi kami tidak dapat membayarnya balik.',
            'Setiap kedai menetapkan peraturan bayaran baliknya sendiri. Tanya pemilik melalui pautan WhatsApp di halaman tempahan anda. Jika pemilik membatalkan tempahan yang telah anda bayar, halaman tempahan anda menunjukkan “Dibatalkan · wang akan dipulangkan” sehingga mereka menandakannya “Wang dipulangkan”.',
            'Jika anda rasa sesebuah kedai menipu pelanggannya, beritahu kami di {email} dan kami akan menyiasatnya.',
          ],
        },
      ],
    },
  },
};
