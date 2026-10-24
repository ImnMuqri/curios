import { OWNER_MAIL_FOOTER, renderMailHtml, type MailBlock } from './mail.js';
import { formatRinggit } from './store.js';

/**
 * The emails about digital items: what the buyer gets once the order is paid
 * (files, a link, codes, a class time), and the owner's "Paid and sent". Kept
 * plain for now; the Emails board's styling arrives with its own slice.
 */

interface Mail {
  subject: string;
  text: string;
  html: string;
}

export type MailLang = 'en' | 'ms';

export interface DigitalMailItem {
  name: string;
  optionLabel: string | null;
  quantity: number;
  delivery: 'FILES' | 'LINK' | 'CODES' | 'SESSION';
  /** One per file; `url` is null when the order link is unknown, so the email carries no link. */
  downloads: { name: string; url: string | null }[];
  /** The line's link and note; `url` is the order's own redirect, or null when there is no order link. */
  link: { url: string | null; note: string | null } | null;
  /** The codes given to this line. */
  codes: string[];
  /** The class time as sold; `where` is the meeting link or the place. */
  session: { startsAt: Date; minutes: number; place: 'ONLINE' | 'IN_PERSON'; where: string } | null;
}

export interface DigitalDeliveryMailInput {
  /** The page's language. */
  lang: MailLang;
  number: number;
  shopName: string;
  customerName: string;
  items: DigitalMailItem[];
  /** The order page, or null when the order link is unknown: the email then says to use the order page. */
  orderUrl: string | null;
  appUrl?: string;
}

const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_MS = ['Jan', 'Feb', 'Mac', 'Apr', 'Mei', 'Jun', 'Jul', 'Ogo', 'Sep', 'Okt', 'Nov', 'Dis'];
const DAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAYS_MS = ['Ahd', 'Isn', 'Sel', 'Rab', 'Kha', 'Jum', 'Sab'];

/** "Sat 17 Oct, 3:00 pm" on the Malaysian clock (UTC+8, no daylight saving). */
export function sessionTimeText(startsAt: Date, lang: MailLang): string {
  const my = new Date(startsAt.getTime() + 8 * 3_600_000);
  const h = my.getUTCHours();
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  const suffix = lang === 'ms' ? (h < 12 ? 'pagi' : h < 19 ? 'petang' : 'malam') : h < 12 ? 'am' : 'pm';
  const days = lang === 'ms' ? DAYS_MS : DAYS_EN;
  const months = lang === 'ms' ? MONTHS_MS : MONTHS_EN;
  return `${days[my.getUTCDay()]} ${my.getUTCDate()} ${months[my.getUTCMonth()]}, ${hour12}:${String(my.getUTCMinutes()).padStart(2, '0')} ${suffix}`;
}

const COPY = {
  en: {
    subject: (n: number, shop: string) => `Your order #${n} from ${shop}`,
    tag: 'Paid',
    heading: (name: string) => `Thanks ${name}, here is what you bought`,
    intro: (shop: string) => `${shop} has your payment. Everything you bought is below.`,
    download: (file: string) => `Download ${file}`,
    downloadsNote: 'Each download works up to 5 times for 30 days.',
    openLink: 'Open your link',
    note: 'Note',
    code: 'Code',
    when: 'When',
    lasts: 'Lasts',
    minutes: (m: number) => `${m} minutes`,
    join: 'Join',
    place: 'Place',
    noLinks: 'Open your order page to get your downloads and links.',
    orderButton: 'Open your order page',
    footer: (shop: string) => `You get this because you ordered from ${shop}.`,
  },
  ms: {
    subject: (n: number, shop: string) => `Tempahan #${n} anda dari ${shop}`,
    tag: 'Dibayar',
    heading: (name: string) => `Terima kasih ${name}, ini yang anda beli`,
    intro: (shop: string) => `${shop} telah menerima bayaran anda. Semua yang anda beli ada di bawah.`,
    download: (file: string) => `Muat turun ${file}`,
    downloadsNote: 'Setiap muat turun boleh digunakan sehingga 5 kali dalam 30 hari.',
    openLink: 'Buka pautan anda',
    note: 'Nota',
    code: 'Kod',
    when: 'Bila',
    lasts: 'Tempoh',
    minutes: (m: number) => `${m} minit`,
    join: 'Sertai',
    place: 'Tempat',
    noLinks: 'Buka halaman tempahan anda untuk mendapatkan muat turun dan pautan.',
    orderButton: 'Buka halaman tempahan anda',
    footer: (shop: string) => `Anda terima ini kerana anda membuat tempahan dari ${shop}.`,
  },
} as const;

/** Sent to the buyer, once the order is paid, and again when the owner resends it. */
export function digitalDeliveryMail(o: DigitalDeliveryMailInput): Mail {
  const c = COPY[o.lang];
  const subject = c.subject(o.number, o.shopName);
  const heading = c.heading(o.customerName);
  const blocks: MailBlock[] = [{ kind: 'p', text: c.intro(o.shopName) }];
  const text: string[] = [`${heading}.`, '', c.intro(o.shopName)];
  let anyDownload = false;
  let needsOrderPage = false;

  for (const item of o.items) {
    const title = [item.name, item.optionLabel].filter(Boolean).join(', ') + (item.quantity > 1 ? ` × ${item.quantity}` : '');
    blocks.push({ kind: 'p', text: title });
    text.push('', title);
    for (const d of item.downloads) {
      anyDownload = true;
      if (d.url) {
        blocks.push({ kind: 'buttons', primary: { label: c.download(d.name), href: d.url } });
        text.push(`${c.download(d.name)}: ${d.url}`);
      } else {
        needsOrderPage = true;
        blocks.push({ kind: 'small', text: d.name });
        text.push(d.name);
      }
    }
    if (item.link) {
      if (item.link.url) {
        blocks.push({ kind: 'buttons', primary: { label: c.openLink, href: item.link.url } });
        text.push(`${c.openLink}: ${item.link.url}`);
      } else needsOrderPage = true;
      if (item.link.note) {
        blocks.push({ kind: 'facts', rows: [[c.note, item.link.note]] });
        text.push(`${c.note}: ${item.link.note}`);
      }
    }
    if (item.codes.length > 0) {
      blocks.push({ kind: 'facts', rows: item.codes.map((code): [string, string] => [c.code, code]) });
      for (const code of item.codes) text.push(`${c.code}: ${code}`);
    }
    if (item.session) {
      const s = item.session;
      const rows: [string, string][] = [
        [c.when, sessionTimeText(s.startsAt, o.lang)],
        [c.lasts, c.minutes(s.minutes)],
        [s.place === 'ONLINE' ? c.join : c.place, s.where],
      ];
      blocks.push({ kind: 'facts', rows });
      for (const [label, value] of rows) text.push(`${label}: ${value}`);
    }
  }
  if (anyDownload && !needsOrderPage) {
    blocks.push({ kind: 'small', text: c.downloadsNote });
    text.push('', c.downloadsNote);
  }
  if (o.orderUrl) {
    blocks.push({ kind: 'buttons', primary: { label: c.orderButton, href: o.orderUrl } });
    text.push('', `${c.orderButton}: ${o.orderUrl}`);
  } else if (needsOrderPage) {
    blocks.push({ kind: 'small', text: c.noLinks });
    text.push('', c.noLinks);
  }

  return {
    subject,
    text: text.join('\n'),
    html: renderMailHtml({
      subject,
      topRight: `#${o.number}`,
      tag: { label: c.tag, tone: 'hijau' },
      heading,
      blocks,
      footer: c.footer(o.shopName),
      appUrl: o.appUrl,
    }),
  };
}

export interface PaidAndSentOwnerMailInput {
  number: number;
  totalCents: number;
  customerName: string;
  /** How it was paid, as stored: "FPX · Maybank2u". */
  via: string;
  ref: string | null;
  lines: { itemName: string; optionLabel: string | null; quantity: number; lineCents: number }[];
  /** The owner's order screen, opened on this order. */
  url: string;
  appUrl?: string;
}

/** Sent to the owner when an order of digital items only is paid online: it is already delivered, nothing to do. */
export function paidAndSentOwnerMail(o: PaidAndSentOwnerMailInput): Mail {
  const total = formatRinggit(o.totalCents);
  const subject = `New order #${o.number} · ${total} · Paid and sent`;
  const heading = `${o.customerName} ordered and paid ${total}`;
  const said = 'We emailed them everything they bought, so there’s nothing for you to do.';
  const button = `Open order #${o.number}`;
  const paidWith = o.ref ? `${o.via} · Ref ${o.ref}` : o.via;
  return {
    subject,
    text: [
      `${heading}.`,
      '',
      said,
      '',
      ...o.lines.map((l) => `${[l.itemName, l.optionLabel].filter(Boolean).join(', ')}, ${l.quantity}×: ${formatRinggit(l.lineCents)}`),
      `Paid: ${total}`,
      `Paid with: ${paidWith}`,
      '',
      `${button}: ${o.url}`,
    ].join('\n'),
    html: renderMailHtml({
      subject,
      topRight: `Order #${o.number}`,
      tag: { label: 'Paid and sent', tone: 'hijau' },
      heading,
      blocks: [
        { kind: 'p', text: said },
        {
          kind: 'lines',
          rows: o.lines.map((l) => ({
            name: l.itemName,
            detail: [l.optionLabel, `${l.quantity}×`].filter(Boolean).join(' · '),
            amount: formatRinggit(l.lineCents),
          })),
          total: { label: 'Paid', amount: total },
        },
        { kind: 'facts', rows: [['Paid with', paidWith]] },
        { kind: 'buttons', primary: { label: button, href: o.url } },
      ],
      footer: OWNER_MAIL_FOOTER,
      appUrl: o.appUrl,
    }),
  };
}
